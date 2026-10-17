// Browser end-to-end test: no page overlaps itself, cuts text off without an ellipsis, or sticks out of the window.
// The detection code is shared with the command-line sweep (scripts/ui-audit/overlap-sweep.cjs): both load
// scripts/ui-audit/overlap-checks.js and walk the pages with scripts/ui-audit/overlap-sweep-lib.cjs. Intentional
// overlaps (counter badges on icons, the frozen action column, icons inside inputs ...) are listed, with a reason,
// in the allowlist at the top of overlap-checks.js. Why this exists: the search box once slid over the version badge
// at ~1200px and the older audit (3 window sizes, centre-point test only) missed it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { root, startApp } from './harness.mjs';

const require = createRequire(import.meta.url);
const lib = require('../../scripts/ui-audit/overlap-sweep-lib.cjs');

const THEMES = ['pink', 'xiaoman']; // glass skin and classic skin
const SIZES = [[1024, 800], [1200, 800], [1366, 800], [1680, 800]];
const WORKERS = 4;

let app;
before(async () => {
  app = await startApp();
  await app.open('customers');
  await seedDemoData();
});
after(async () => { await app?.close(); });

// Fill the isolated backend with the same demo data the web trial ships (customers, orders, opportunities, tasks,
// targets), so tables and cards have real content to overflow. Company and contact names are made long on purpose
// ("Shenzhen Hongxin Lashes International Trading Co., Ltd." is a normal customer name): layouts must cope with that.
async function seedDemoData() {
  const { page } = app;
  await page.addScriptTag({ path: path.join(root, 'scripts/web-trial/demo-seed.js') });
  const built = await page.evaluate(() => {
    let text = JSON.stringify(window.LaiWebTrialDemoSeed.build(new Date()));
    for (const company of window.LaiWebTrialDemoSeed.companies) {
      text = text.split(JSON.stringify(company.name).slice(1, -1)).join(company.name + ' International Trading Co., Ltd. 国际贸易有限公司');
      text = text.split(JSON.stringify(company.contact).slice(1, -1)).join(company.contact + ' Alexandra-Montgomery');
    }
    return text;
  });
  const state = await (await app.api('/api/data')).json();
  const demo = JSON.parse(built);
  const settings = { ...(state.data.laiSettings || {}), ...(demo.laiSettings || {}) };
  Object.assign(state.data, demo, { laiSettings: settings });
  const saved = await app.api('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, baseRevision: state.revision }) });
  assert.equal(saved.status, 200, 'demo data saved');
  await app.open('customers');
}

test('the checker itself finds an overlap, clipped text and an off-screen element (so a broken checker cannot pass silently)', async () => {
  const { page } = app;
  await page.setViewportSize({ width: 1200, height: 800 });
  await lib.gotoRoute(page, 'settings');
  await page.evaluate(() => {
    const box = document.createElement('div');
    box.id = 'overlap-selftest';
    box.style.cssText = 'position:fixed;left:300px;top:300px;z-index:99999;background:#fff;width:880px;height:300px';
    box.innerHTML = `
      <button style="position:absolute;left:10px;top:10px">按钮一二三四五</button>
      <span style="position:absolute;left:40px;top:14px">被压住的文字</span>
      <div style="position:absolute;left:10px;top:80px;width:50px;overflow:hidden;white-space:nowrap">这是一段很长很长的没有省略号的文字</div>
      <div style="position:absolute;left:10px;top:120px;width:50px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">这是一段很长很长的有省略号的文字</div>
      <div style="position:absolute;left:10px;top:160px;width:120px;height:20px;overflow:hidden"><span style="white-space:nowrap">外层切掉的一段长长长长文字文字</span></div>
      <div style="position:absolute;left:800px;top:200px;width:200px;white-space:nowrap">伸出窗口右边的文字文字</div>`;
    document.body.appendChild(box);
  });
  try {
    const found = await lib.check(page, '#overlap-selftest');
    const has = (list, text) => list.some((f) => JSON.stringify(f).includes(text));
    assert.ok(has(found.overlap, '被压住的文字'), 'overlap found');
    assert.ok(has(found.clipped, '没有省略号'), 'text cut off without ellipsis found');
    assert.ok(!found.clipped.some((f) => f.text.startsWith('这是一段很长很长的有省略号')), 'text with an ellipsis is not reported');
    assert.ok(has(found.clipped, '外层切掉'), 'text cut by an outer box found');
    assert.ok(has(found.offscreen, '伸出窗口右边'), 'element sticking out of the window found');
  } finally {
    await page.evaluate(() => document.getElementById('overlap-selftest')?.remove());
  }
});

test('no page overlaps, cuts text off or sticks out, in the glass and the classic skin from 1024 to 1680px wide', async () => {
  const { page } = app;
  const jobs = [];
  for (const theme of THEMES) for (const [width, height] of SIZES) jobs.push({ theme, width, height });
  const routes = await lib.discoverRoutes(page);
  assert.ok(routes.length >= 30, `found the app's pages (${routes.length})`);
  const findings = [];
  let views = 0, candidates = 0;
  // Several pages scan at once. Each one gets its own browser context (own renderer process), otherwise they would
  // share one process and the scan would not get faster; the session cookie is copied from the first page.
  const pages = [page], contexts = [];
  const cookies = await page.context().cookies();
  while (pages.length < WORKERS) {
    const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
    await context.addCookies(cookies);
    const extra = await context.newPage();
    extra.on('pageerror', (error) => app.errors.push('pageerror: ' + error.message));
    await extra.goto(`${app.base}/trade-order-system.html#customers`);
    await extra.waitForLoadState('networkidle');
    contexts.push(context);
    pages.push(extra);
  }
  await Promise.all(pages.map(async (p) => {
    for (let job = jobs.shift(); job; job = jobs.shift()) {
      await p.setViewportSize({ width: job.width, height: job.height });
      await lib.setTheme(p, job.theme);
      await lib.settle(p, 250);
      // tab-by-tab states are walked at the two outer widths only (keeps the test short)
      const result = await lib.sweepView(p, { theme: job.theme, routes, tabs: job.width === 1024 || job.width === 1366 });
      findings.push(...result.findings);
      views += result.counts.views;
      candidates += result.counts.candidates;
    }
  }));
  assert.ok(views >= THEMES.length * SIZES.length * 30, `scanned the pages (${views} views)`);
  assert.ok(candidates > views * 20, `looked at real content (${candidates} elements)`);
  for (const context of contexts) await context.close();
  assert.equal(findings.length, 0, '\n' + lib.summarize(findings));
  // The mail page asks the mailbox endpoints, which answer 409 while no mailbox is bound: that is the normal empty state.
  assert.deepEqual(app.errors.filter((message) => !/^HTTP 409: .*\/api\/mail\//.test(message)), []);
});

test('a short window (1280x720) does not cut off the bottom of the customer settings page', async () => {
  const { page } = app;
  await page.setViewportSize({ width: 1280, height: 720 });
  await lib.setTheme(page, 'pink');
  await lib.gotoRoute(page, 'customers');
  await lib.gotoScreen(page, 'customer-settings', 300);
  const found = await lib.check(page, null);
  const all = [...found.overlap, ...found.clipped, ...found.offscreen];
  assert.equal(all.length, 0, JSON.stringify(all.slice(0, 5)));
  // the page itself scrolls, so the last entry of the left list can be reached
  const reachable = await page.evaluate(() => { const main = document.querySelector('.customer-main'); return main.scrollHeight > main.clientHeight ? getComputedStyle(main).overflowY : 'fits'; });
  assert.ok(reachable === 'auto' || reachable === 'scroll' || reachable === 'fits', `customer settings page scrolls (${reachable})`);
});
