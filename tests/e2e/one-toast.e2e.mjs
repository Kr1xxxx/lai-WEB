// One toast at a time: after a 商机 card is dropped on another stage, the page shows exactly one toast (the old
// bottom undo bar is gone). That toast carries the 撤销 button, stays long enough to click, and its 撤销 puts the
// card back. The toast sits at the top centre and does not cover the page's buttons or the header tabs.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { root, startApp } from './harness.mjs';

const require = createRequire(import.meta.url);
const O = require(`${root}/src/opportunity-model.js`);

let app;
before(async () => {
  app = await startApp();
  // Two opportunities on sample customers, both in 未成单.
  const state = await (await app.api('/api/data')).json();
  const now = new Date().toISOString();
  let data = state.data;
  data = O.upsert(data, 'toast-1', { client: 'Northwind Lash Studio', contact: 'Avery Brooks', amount: '1200', currency: 'USD', endDate: '2030-01-31', owner: 'Kris' }, { now, today: now.slice(0, 10) });
  data = O.upsert(data, 'toast-2', { client: 'Bluebell Beauty Supply', contact: 'Harriet Lane', amount: '800', currency: 'USD', endDate: '2030-02-15', owner: 'Kris' }, { now, today: now.slice(0, 10) });
  const saved = await app.api('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: { ...state, data }, baseRevision: state.revision }) });
  assert.equal(saved.status, 200, await saved.text());
});
after(async () => { await app?.close(); });

const stageOf = async (id) => ((await app.readData()).laiOpportunities || []).find((o) => o.id === id)?.stage;
// Toasts: anything with role=status that floats over the page (fixed), is shown and has text.
const visibleToasts = () => app.page.evaluate(() => [...document.querySelectorAll('[role="status"]')].filter((el) => {
  const box = el.getBoundingClientRect(), css = getComputedStyle(el);
  let fixed = false;
  for (let n = el; n && n !== document.body; n = n.parentElement) if (getComputedStyle(n).position === 'fixed') fixed = true;
  return fixed && box.width > 0 && box.height > 0 && css.visibility !== 'hidden' && Number(css.opacity) > 0.5 && el.innerText.trim();
}).map((el) => el.innerText.replace(/\s+/g, ' ').trim()));
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function openBoard() {
  await app.open('customers');
  await app.page.locator('.rail-item[data-rail-menu="商机"]').click();
  await app.page.locator('.opp-page').waitFor();
}

for (const [width, height] of [[1440, 900], [1280, 800]]) {
  test(`${width}x${height}: a kanban drop shows exactly one toast, with a 撤销 that works`, async () => {
    const { page } = app;
    await page.setViewportSize({ width, height });
    await openBoard();
    const card = page.locator('.opp-card[data-opp-id="toast-1"]');
    await card.dragTo(page.locator('[data-opp-drop="unpaid"]'));
    const toast = page.locator('#toast.show');
    await toast.filter({ hasText: '已移到「付款未到账」' }).waitFor();
    assert.equal(await stageOf('toast-1'), 'unpaid');
    await page.waitForTimeout(400); // let the open transition finish
    assert.deepEqual(await visibleToasts(), ['已移到「付款未到账」 撤销'], 'exactly one toast, and it has the 撤销 button');
    assert.equal(await page.locator('.opp-undo, #opp-undo').count(), 0, 'no separate undo bar');

    // The toast does not cover the header buttons, the header tabs or the board toolbar.
    const toastBox = await toast.boundingBox();
    for (const selector of ['.k-pageheader button', '.opp-page button', '.opp-page input']) {
      for (const el of await page.locator(selector).all()) {
        if (!(await el.isVisible())) continue;
        const box = await el.boundingBox();
        assert.ok(!overlaps(toastBox, box), `the toast covers ${selector} "${(await el.innerText().catch(() => '')).trim()}"`);
      }
    }

    // A toast with a button stays longer than a plain one (3 seconds), so there is time to click.
    await page.waitForTimeout(3500);
    assert.equal(await toast.getByRole('button', { name: '撤销' }).isVisible(), true, 'still there after 3.5 s');

    await toast.getByRole('button', { name: '撤销' }).click();
    await toast.filter({ hasText: '已撤销' }).waitFor();
    assert.equal(await stageOf('toast-1'), 'open');
    assert.equal(await page.locator('[data-opp-drop="open"] .opp-card[data-opp-id="toast-1"]').count(), 1);
    await page.waitForTimeout(400); // let the open transition finish, as above (it fades in from opacity 0)
    assert.deepEqual(await visibleToasts(), ['已撤销'], 'the new toast replaced the old one and has no button');
    assert.equal(await page.locator('#toast button').count(), 0);
    assert.deepEqual(app.errors, []);
  });
}

test('leaving the board takes the 撤销 toast away, and a hidden toast cannot be reached with Tab', async () => {
  const { page } = app;
  await page.setViewportSize({ width: 1440, height: 900 });
  await openBoard();
  await page.locator('.opp-card[data-opp-id="toast-2"]').dragTo(page.locator('[data-opp-drop="unpaid"]'));
  await page.locator('#toast.show', { hasText: '已移到「付款未到账」' }).waitFor();
  await page.locator('.section-tabs .section-tab:text-is("商机分析")').click();
  await page.waitForFunction(() => !document.querySelector('#toast.show'));
  assert.equal(await page.locator('#toast').evaluate((el) => el.inert), true, 'the hidden toast and its button are inert');
  assert.equal(await stageOf('toast-2'), 'unpaid', 'leaving does not undo anything');
  assert.deepEqual(app.errors, []);
});
