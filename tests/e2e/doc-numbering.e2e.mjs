// 单据编号、单据记录和从商机生成单据, in the real page with the real backend.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

let app;
const now = new Date();
const TODAY = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;

before(async () => {
  app = await startApp();
  await app.open('customers');
  const ctx = app.page.context().request;
  const state = await (await ctx.get(app.base + '/api/data')).json();
  state.data.laiProducts = [{ id: 'p-lash', code: 'LASH-01', name: 'Cloud Lash', model: 'CL-9', unit: '盒', fob: '2.5', specs: [] }];
  state.data.laiSettings = { ...(state.data.laiSettings || {}), docTemplates: { company: { name: 'Comely Beauty Inc.' } } };
  const res = await ctx.post(app.base + '/api/save', { data: { state, baseRevision: state.revision } });
  assert.equal(res.status(), 200, await res.text());
  await app.open('customers');
});
after(async () => { await app?.close(); });

const settle = (ms = 350) => app.page.waitForTimeout(ms);
const form = () => app.page.locator('#biz-order-form');
const openDocPage = async () => {
  await app.page.locator('.rail-item[data-rail-menu="交易"]').click();
  await app.page.locator('.subnav .nav-row:has(.nav-label:text-is("单据模板"))').click();
  await app.page.locator('[data-doc-panel]').waitFor();
};
const tab = async (id) => { await app.page.locator(`[data-doc-tab="${id}"]`).click(); await settle(); };

test('numbering rule: live example, a wrong prefix is explained, the rule is saved', async () => {
  const { page } = app;
  await openDocPage();
  await tab('numbering');
  const card = page.locator('[data-doc-form="numbering"][data-type="quote"]');
  assert.match(await card.locator('[data-doc-example]').innerText(), new RegExp(`下一张：QT-${TODAY}-001`));
  await card.locator('[name="prefix"]').fill('BJ');
  assert.match(await card.locator('[data-doc-example]').innerText(), new RegExp(`下一张：BJ-${TODAY}-001`));
  await card.locator('[name="digits"]').selectOption('4', { force: true });
  assert.match(await card.locator('[data-doc-example]').innerText(), new RegExp(`BJ-${TODAY}-0001`));
  await card.locator('[name="prefix"]').fill('报价');
  assert.match(await card.locator('[data-doc-example]').innerText(), /前缀要填 1 到 10 个字符/);
  await card.locator('[name="digits"]').selectOption('3', { force: true });
  await card.locator('[name="prefix"]').fill('BJ');
  await card.locator('button[type=submit]').click();
  await settle();
  const saved = (await app.readData()).laiSettings.docTemplates.numbering.quote;
  assert.equal(saved.prefix, 'BJ');
  assert.equal(saved.digits, 3);
  // The other types keep their defaults.
  assert.match(await page.locator('[data-doc-example="pi"]').innerText(), new RegExp(`PI-${TODAY}-001`));
  assert.deepEqual(app.errors, []);
});

test('an order makes two saved quotations with running numbers and lists them', async () => {
  const { page } = app;
  await page.locator('.rail-item', { hasText: '交易' }).first().click();
  await page.getByRole('button', { name: /新建订单/ }).first().click();
  await form().waitFor();
  await form().locator('[name="client"]').fill('Lumen Lash Lab');
  await form().locator('[data-biz-action="order-item-add"]').click();
  await form().locator('[data-item-product="0"]').selectOption('p-lash', { force: true });
  await settle();
  await form().locator('[data-item-field="qty"][data-item-index="0"]').fill('100');
  await form().locator('[data-biz-action="order-doc"][data-type="quote"]').click();
  const draft = form().locator('[data-order-doc="quote"]');
  await draft.waitFor();
  assert.match(await draft.locator('.dt-meta').innerText(), /保存后生成编号/);
  assert.match(await draft.locator('.dt-meta').innerText(), /订单号/);
  await draft.locator('[data-biz-action="order-doc-save"]').click();
  const saved = form().locator('[data-order-doc-saved]');
  await saved.waitFor();
  assert.match(await saved.locator('.dt-meta').innerText(), new RegExp(`BJ-${TODAY}-001`));
  assert.equal(await saved.locator('[data-biz-action="docrec-print"]').count(), 1);
  assert.equal(await form().locator('#biz-order-saved li').count(), 1);
  // A second quotation gets the next number.
  await form().locator('[data-biz-action="order-doc"][data-type="quote"]').click();
  await form().locator('[data-order-doc="quote"] [data-biz-action="order-doc-save"]').click();
  await form().locator('[data-order-doc-saved]').waitFor();
  assert.match(await form().locator('[data-order-doc-saved] .dt-meta').innerText(), new RegExp(`BJ-${TODAY}-002`));
  assert.equal(await form().locator('#biz-order-saved li').count(), 2);
  // A PI uses its own counter and prefix.
  await form().locator('[data-biz-action="order-doc"][data-type="pi"]').click();
  await form().locator('[data-order-doc="pi"] [data-biz-action="order-doc-save"]').click();
  await form().locator('[data-order-doc-saved]').waitFor();
  assert.match(await form().locator('[data-order-doc-saved] .dt-meta').innerText(), new RegExp(`PI-${TODAY}-001`));
  // 查看 shows an earlier one again without closing the form.
  await form().locator('#biz-order-saved li', { hasText: `BJ-${TODAY}-001` }).locator('[data-biz-action="docrec-view"]').click();
  assert.match(await form().locator('[data-order-doc-saved] .dt-meta').innerText(), new RegExp(`BJ-${TODAY}-001`));
  assert.match(await form().locator('[data-order-doc-saved] .dt-table').innerText(), /Cloud Lash/);
  await page.locator('button[type=submit][form="biz-order-form"]').click();
  await form().waitFor({ state: 'detached' });
  const data = await app.readData();
  assert.deepEqual(data.laiDocuments.map((d) => d.number), [`PI-${TODAY}-001`, `BJ-${TODAY}-002`, `BJ-${TODAY}-001`]);
  const order = data.orders.find((o) => o.client === 'Lumen Lash Lab');
  assert.ok(data.laiDocuments.every((d) => d.source.kind === 'order' && d.source.id === order.id));
  assert.equal(data.laiDocuments[2].total, 250);
  assert.equal(data.laiSettings.docTemplates.counters.quote.seq, 2);
  assert.deepEqual(app.errors, []);
});

test('the saved order shows its documents again after reopening it', async () => {
  const { page } = app;
  const order = (await app.readData()).orders.find((o) => o.client === 'Lumen Lash Lab');
  await app.open('customers');
  await page.locator('.rail-item[data-rail-menu="交易"]').click();
  await page.locator('.subnav .nav-row:has(.nav-label:text-is("全部订单"))').click();
  await page.locator(`[data-biz-order="${order.id}"]`).first().click();
  await form().waitFor();
  assert.equal(await form().locator('#biz-order-saved li').count(), 3);
  await page.locator('[data-biz-action="close-editor"]').click();
});

test('单据记录 lists both, filters, views a snapshot and voids one without freeing its number', async () => {
  const { page } = app;
  await openDocPage();
  await tab('records');
  assert.equal(await page.locator('.dt-records tbody tr').count(), 3);
  assert.match(await page.locator('.dt-records tbody').innerText(), /Lumen Lash Lab/);
  assert.match(await page.locator('.dt-records tbody').innerText(), /订单 /);
  // Filter by type and by number.
  await page.locator('[data-doc-filter="type"]').selectOption('pi', { force: true });
  await settle();
  assert.equal(await page.locator('.dt-records tbody tr').count(), 1);
  await page.locator('[data-doc-filter="type"]').selectOption('', { force: true });
  await settle();
  await page.locator('[data-doc-filter="query"]').fill(`bj-${TODAY}-002`);
  await settle();
  assert.equal(await page.locator('.dt-records tbody tr').count(), 1);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset?.docFilter), 'query', 'typing keeps the focus');
  // View the snapshot; changing the template afterwards does not change it.
  await page.locator('[data-doc-action="view"]').first().click();
  await page.locator('.doc-view').waitFor();
  assert.match(await page.locator('.doc-view .dt-meta').innerText(), new RegExp(`BJ-${TODAY}-002`));
  assert.equal(await page.locator('.drawer [data-biz-action="docrec-print"]').count(), 1);
  await page.locator('[data-action="close-modal"]').first().click();
  await settle();
  // Void needs a second click.
  const row = page.locator('.dt-records tbody tr').first();
  await row.locator('[data-doc-action="void"]').click();
  assert.match(await row.locator('[data-doc-action="void"]').innerText(), /确定作废/);
  await row.locator('[data-doc-action="void"]').click();
  await settle();
  assert.equal(await page.locator('.dt-records tbody tr.is-void').count(), 1);
  assert.match(await page.locator('.dt-records tbody tr.is-void').innerText(), /已作废/);
  assert.equal(await page.locator('.dt-records tbody tr.is-void [data-doc-action="void"]').count(), 0);
  const data = await app.readData();
  assert.equal(data.laiDocuments.find((d) => d.number === `BJ-${TODAY}-002`).status, '已作废');
  assert.equal(data.laiDocuments.length, 3, 'nothing is deleted');
  // The voided number is not used again.
  await tab('numbering');
  assert.match(await page.locator('[data-doc-example="quote"]').innerText(), new RegExp(`BJ-${TODAY}-003`));
  // The 来源 link opens the order.
  await tab('records');
  await page.locator('[data-doc-filter="query"]').fill('');
  await settle();
  await page.locator('[data-doc-action="source"]').first().click();
  await form().waitFor();
  await page.locator('[data-biz-action="close-editor"]').click();
  assert.deepEqual(app.errors, []);
});

test('a PI is made from an opportunity menu, saved, and listed in its detail', async () => {
  const { page } = app;
  await page.locator('.rail-item[data-rail-menu="商机"]').click();
  await settle(700);
  await page.locator('[data-opp-action="new"]').first().click();
  await settle();
  await page.locator('#opp-form [name="client"]').fill('Lumen');
  await page.locator('.lai-suggestion').first().waitFor();
  await page.locator('.lai-suggestion').first().click();
  await page.waitForFunction(() => document.querySelector('#opp-form select[name="contact"]')?.options.length > 1);
  await settle(300);
  await page.locator('#opp-form [name="owner"]').fill('Amy');
  await page.locator('#opp-form [name="amount"]').fill('1200');
  await page.locator('#opp-form [name="products"]').fill('Cloud Lash, 20, 2.5\nBrush, 3, 1');
  await page.locator('#opp-form [name="endDate"]').evaluate((el) => { el.value = '2030-01-31'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.locator('#opp-form select[name="contact"]').selectOption({ index: 1 });
  await page.locator('button[type="submit"][form="opp-form"], #opp-form button[type="submit"]').first().click();
  await settle(900);
  await page.locator('.opp-card [data-opp-action="menu"]').first().click();
  await page.locator('[data-opp-doc="pi"]').waitFor();
  assert.equal(await page.locator('[data-opp-doc]').count(), 2);
  await page.locator('[data-opp-doc="pi"]').click();
  const box = page.locator('#opp-doc-box');
  await box.waitFor();
  // Library product fills the code and model; the typed one has no code. Total 20 x 2.5 + 3 x 1.
  assert.match(await box.locator('.dt-meta').innerText(), /保存后生成编号/);
  assert.match(await box.locator('.dt-meta').innerText(), /商机/);
  assert.match(await box.locator('.dt-table').innerText(), /LASH-01/);
  assert.match(await box.locator('.dt-total').innerText(), /USD 53\.00/);
  await box.locator('[data-biz-action="oppdoc-save"]').click();
  await settle();
  assert.match(await box.locator('.dt-meta').innerText(), new RegExp(`PI-${TODAY}-002`));
  assert.equal(await box.locator('[data-biz-action="oppdoc-print"]').count(), 1);
  await page.locator('[data-action="close-modal"]').first().click();
  await settle();
  // The detail drawer lists it.
  await page.locator('.opp-card-name').first().click();
  await page.locator('.opp-detail').waitFor();
  assert.match(await page.locator('.opp-docs').innerText(), new RegExp(`PI-${TODAY}-002`));
  await page.locator('.opp-docs [data-biz-action="docrec-view"]').click();
  await page.locator('.doc-view').waitFor();
  assert.match(await page.locator('.doc-view .dt-title h2').innerText(), /形式发票/);
  const doc = (await app.readData()).laiDocuments.find((d) => d.number === `PI-${TODAY}-002`);
  assert.equal(doc.source.kind, 'opportunity');
  assert.equal(doc.total, 53);
  assert.deepEqual(app.errors, []);
});
