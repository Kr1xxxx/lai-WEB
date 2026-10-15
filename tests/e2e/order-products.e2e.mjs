// 订单选产品 and documents from an order, in the real page with the real backend.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

let app;
before(async () => {
  app = await startApp();
  await app.open('customers');
  const ctx = app.page.context().request;
  const state = await (await ctx.get(app.base + '/api/data')).json();
  state.data.laiProducts = [
    { id: 'p-lash', code: 'LASH-01', name: 'Cloud Lash', unit: '盒', fob: '2.5', specs: [] },
    { id: 'p-glue', code: 'GLUE-02', name: 'Lash Glue', unit: '瓶', fob: '', specs: [] },
  ];
  state.data.laiSettings = { ...(state.data.laiSettings || {}), docTemplates: { company: { name: 'Comely Beauty Inc.' } } };
  const res = await ctx.post(app.base + '/api/save', { data: { state, baseRevision: state.revision } });
  assert.equal(res.status(), 200, await res.text());
  await app.open('customers');
});
after(async () => { await app?.close(); });

const settle = (ms = 300) => app.page.waitForTimeout(ms);
const form = () => app.page.locator('#biz-order-form');
const pick = async (row, value) => { await form().locator(`[data-item-product="${row}"]`).selectOption(value, { force: true }); await settle(); };

test('a new order picks products, the amount follows the items, and a quotation is previewed from the form', async () => {
  const { page } = app;
  await page.locator('.rail-item', { hasText: '交易' }).first().click();
  await page.getByRole('button', { name: /新建订单/ }).first().click();
  await form().waitFor();
  await form().locator('[name="client"]').fill('Lumen Lash Lab');
  await form().locator('[data-biz-action="order-item-add"]').click();
  await pick(0, 'p-lash');
  await form().locator('[data-item-field="qty"][data-item-index="0"]').fill('100');
  await form().locator('[data-biz-action="order-item-add"]').click();
  await pick(1, 'p-glue');
  // Lash Glue has no 离岸价, so its price is typed by hand.
  await form().locator('[data-item-field="price"][data-item-index="1"]').fill('4');
  await form().locator('[data-item-field="qty"][data-item-index="1"]').fill('5');
  assert.equal(await form().locator('[name="amount"]').inputValue(), '270');
  assert.equal(await form().locator('[name="amount"]').evaluate((el) => el.readOnly), true);
  assert.equal(await form().locator('[name="productType"]').inputValue(), 'Cloud Lash、Lash Glue');
  assert.match(await form().locator('[data-items-total]').innerText(), /270\.00 USD/);
  if (process.env.LAI_SHOTS) await page.screenshot({ path: `${process.env.LAI_SHOTS}/order-items.png` });
  // The order card is narrow: nothing may stick out sideways.
  assert.equal(await page.locator('#biz-order-form').evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true);
  await form().locator('[data-biz-action="order-doc"][data-type="quote"]').click();
  const doc = form().locator('[data-order-doc="quote"]');
  await doc.waitFor();
  assert.match(await doc.locator('.dt-title h2').innerText(), /报价单/);
  assert.match(await doc.locator('.dt-co strong').innerText(), /Comely Beauty Inc\./);
  assert.match(await doc.locator('.dt-meta').innerText(), /Lumen Lash Lab/);
  assert.deepEqual(await doc.locator('.dt-table tbody tr td:nth-child(2)').allInnerTexts(), ['Cloud Lash', 'Lash Glue']);
  assert.match(await doc.locator('.dt-total').innerText(), /USD 270\.00/);
  // Editing a quantity updates the open preview.
  await form().locator('[data-item-field="qty"][data-item-index="1"]').fill('10');
  assert.match(await doc.locator('.dt-total').innerText(), /USD 290\.00/);
  await doc.locator('.dt-paper').scrollIntoViewIfNeeded();
  if (process.env.LAI_SHOTS) await page.screenshot({ path: `${process.env.LAI_SHOTS}/order-doc.png` });
  await page.locator('button[type=submit][form="biz-order-form"]').click();
  await form().waitFor({ state: 'detached' });
  const saved = (await app.readData()).orders.find((o) => o.client === 'Lumen Lash Lab' && Array.isArray(o.items) && o.items.length);
  assert.equal(saved.amount, 290);
  assert.equal(saved.productType, 'Cloud Lash、Lash Glue');
  assert.deepEqual(saved.items.map((i) => [i.productId, i.code, i.unit, i.qty, i.price]), [['p-lash', 'LASH-01', '盒', 100, 2.5], ['p-glue', 'GLUE-02', '瓶', 10, 4]]);
  assert.deepEqual(app.errors, []);
});

test('the saved order reopens with its items and makes a PI; removing every item goes back to a typed amount', async () => {
  const { page } = app;
  const { num, id } = (await app.readData()).orders.find((o) => Array.isArray(o.items) && o.items.length);
  await app.open('customers');
  await page.locator('.rail-item[data-rail-menu="交易"]').click();
  await page.locator('.subnav .nav-row:has(.nav-label:text-is("全部订单"))').click();
  await page.locator(`[data-biz-order="${id}"]`).first().click();
  await form().waitFor();
  assert.equal(await form().locator('[data-item-row]').count(), 2);
  await form().locator('[data-biz-action="order-doc"][data-type="pi"]').click();
  const doc = form().locator('[data-order-doc="pi"]');
  await doc.waitFor();
  assert.match(await doc.locator('.dt-title h2').innerText(), /形式发票/);
  assert.match(await doc.locator('.dt-meta').innerText(), new RegExp(num));
  await form().locator('[data-biz-action="order-doc-close"]').click();
  assert.equal(await form().locator('[data-order-doc]').count(), 0);
  await form().locator('[data-biz-action="order-item-remove"]').first().click();
  await form().locator('[data-biz-action="order-item-remove"]').first().click();
  assert.equal(await form().locator('[name="amount"]').evaluate((el) => el.readOnly), false);
  await form().locator('[name="amount"]').fill('123');
  await page.locator('button[type=submit][form="biz-order-form"]').click();
  await form().waitFor({ state: 'detached' });
  const saved = (await app.readData()).orders.find((o) => o.num === num);
  assert.equal(saved.amount, 123);
  assert.deepEqual(saved.items, []);
  assert.deepEqual(app.errors, []);
});
