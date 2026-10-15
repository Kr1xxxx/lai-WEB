// Customer-list speed measurement: loads synthetic customers of several sizes into a throwaway backend and times
// the real page. Not part of `npm run test:e2e` (slow); run: node tests/e2e/perf-customers.mjs [sizes] (default 1000,5000,10000,20000).
// Set PERF_JSON=<file> to also write the numbers. Uses the harness (needs Playwright, see AGENTS.md).
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { startApp } from './harness.mjs';
const M = createRequire(import.meta.url)('../../src/model.js');
import { syntheticData } from './perf-data.mjs';

export async function measure(count, { pageChecks = true } = {}) {
  const app = await startApp({ seed: false });
  const out = { count };
  const { page, base } = app;
  const time = async (fn) => { const t = performance.now(); await fn(); return Math.round(performance.now() - t); };
  try {
    const request = page.context().request;
    await app.open('customers'); // learn the session cookie
    const { customers, orders } = syntheticData(count);
    const state = await (await request.get(base + '/api/data')).json();
    Object.assign(state.data.customers, customers);
    state.data.orders.push(...orders);
    out.seedMs = await time(async () => {
      const res = await request.post(base + '/api/save', { data: { state, baseRevision: state.revision } });
      if (res.status() !== 200) throw new Error('seed failed ' + res.status() + ' ' + (await res.text()).slice(0, 200));
    });
    // Backend only
    let payload;
    out.apiGetMs = await time(async () => { payload = await (await request.get(base + '/api/data')).text(); });
    out.payloadMB = +(payload.length / 1048576).toFixed(1);
    const saved = JSON.parse(payload);
    saved.data.customers['Synthetic Trading 00001'].note = 'edited';
    out.apiSaveMs = await time(async () => {
      const res = await request.post(base + '/api/save', { data: { state: saved, baseRevision: saved.revision } });
      if (res.status() !== 200) throw new Error('save failed ' + res.status());
    });
    // Changes only: the same one-customer edit through the route the page uses.
    const delta = JSON.parse(payload);
    const before = JSON.parse(payload);
    delta.data.customers['Synthetic Trading 00002'].note = 'edited again';
    const diff = M.diffState(M.snapshotState(before.data), delta.data);
    out.deltaKB = Math.round(JSON.stringify(diff.changes).length / 1024);
    out.apiDeltaMs = await time(async () => {
      const res = await request.post(base + '/api/save-changes', { data: { changes: diff.changes, baseRevision: saved.revision + 1 } });
      if (res.status() !== 200) throw new Error('delta save failed ' + res.status() + ' ' + (await res.text()).slice(0, 200));
    });
    if (!pageChecks) return out;
    // Page
    const firstRow = page.locator('tbody tr').first();
    out.loadMs = await time(async () => { await app.open('customers'); await firstRow.waitFor(); });
    out.reloadMs = await time(async () => { await page.reload(); await firstRow.waitFor(); });
    await page.waitForLoadState('networkidle');
    const heap = await page.evaluate(() => performance.memory?.usedJSHeapSize || 0);
    out.heapMB = Math.round(heap / 1048576);
    out.domNodes = await page.evaluate(() => document.getElementsByTagName('*').length);
    // Search: global search box
    const search = page.locator('#global-search-form input[name=query]');
    out.searchMs = await time(async () => { await search.fill('Synthetic Trading 0042'); await search.press('Enter'); await page.locator('tbody tr', { hasText: 'Synthetic Trading 0042' }).first().waitFor(); });
    await search.fill(''); await search.press('Enter'); await firstRow.waitFor();
    // Sort by the first sortable column header
    const header = page.locator('.column-header[data-sort-field]').first();
    out.sortMs = await time(async () => { await header.click(); await page.waitForFunction(() => document.querySelector('th[aria-sort]')); });
    // Next page
    const next = page.locator('[data-page="next"], .pagination .next, button[aria-label="下一页"]').first();
    if (await next.count()) out.nextPageMs = await time(async () => { await next.click(); await page.waitForTimeout(0); await firstRow.waitFor(); });
    // Open detail
    await search.fill('Synthetic Trading 00100'); await search.press('Enter');
    const link = page.locator('tbody tr', { hasText: 'Synthetic Trading 00100' }).getByText('Synthetic Trading 00100').first();
    await link.waitFor();
    out.detailMs = await time(async () => { await link.click(); await page.locator('.lcd-root').waitFor(); });
    // Save a follow-up from the page
    await page.locator('.lcd-tabs [data-tab="activity"]').click();
    await page.locator('#followup-text').fill('性能测试：新增一条跟进');
    out.pageSaveMs = await time(async () => { await page.locator('#followup-form button[type=submit]').click(); await page.getByText('已保存到来财').first().waitFor(); });
    out.errors = app.errors.length;
  } finally {
    await app.close();
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sizes = (process.argv[2] || '1000,5000,10000,20000').split(',').map(Number);
  const results = [];
  for (const n of sizes) { const r = await measure(n); results.push(r); console.log(JSON.stringify(r)); }
  if (process.env.PERF_JSON) fs.writeFileSync(process.env.PERF_JSON, JSON.stringify(results, null, 2));
}
