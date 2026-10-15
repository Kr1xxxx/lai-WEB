// 订单产品明细 and 报价单 / PI from an order, in the real page with the real backend.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

let app;
before(async () => { app = await startApp(); await app.open('customers'); });
after(async () => { await app?.close(); });

const settle = (ms = 350) => app.page.waitForTimeout(ms);
const openMenu = async (name) => {
  await app.page.locator('.rail-item[data-rail-menu="交易"]').click();
  await app.page.locator(`.subnav .nav-row:has(.nav-label:text-is("${name}"))`).click();
  await settle(500);
};

test('add a product, then pick it into a new order: amount follows the lines', async () => {
  const { page } = app;
  await openMenu('产品');
  await page.locator('[data-prod-action="new"]').click();
  await page.locator('#product-form [name="name"]').fill('云朵睫毛');
  await page.locator('#product-form [name="fob"]').fill('2.5');
  await page.locator('button[type="submit"][form="product-form"]').click();
  await settle();
  await openMenu('全部订单');
  await page.locator('[data-biz-action="new-order"]').first().click();
  await settle();
  await page.locator('#biz-order-form [name="client"]').fill('Northwind GmbH');
  await page.locator('#ol-pick').selectOption({ label: '云朵睫毛' });
  await page.locator('[data-biz-line="add"]').click();
  await page.locator('.ol-row .ol-qty').fill('100');
  await settle(100);
  assert.equal(await page.locator('#biz-order-form [name="amount"]').inputValue(), '250.00');
  assert.equal(await page.locator('#biz-order-form [name="amount"]').evaluate((el) => el.readOnly), true);
  await page.locator('[data-biz-line="add"]').click();
  await page.locator('.ol-row').nth(1).locator('.ol-name').fill('手填胶水');
  await page.locator('.ol-row').nth(1).locator('.ol-price').fill('10');
  await settle(100);
  assert.equal(await page.locator('#biz-order-form [name="amount"]').inputValue(), '260.00');
  await page.locator('button[type="submit"][form="biz-order-form"]').click();
  await settle(600);
  const saved = (await app.readData()).orders[0];
  assert.equal(saved.amount, 260);
  assert.equal(saved.lines.length, 2);
  assert.equal(saved.lines[0].name, '云朵睫毛');
});

test('the order row makes a 报价单 and a PI from the lines', async () => {
  const { page } = app;
  await page.locator('[data-biz-doc="quote"]').first().click();
  await settle();
  assert.match(await page.locator('.dt-title h2').innerText(), /报价单/);
  assert.match(await page.locator('.dt-meta').innerText(), /Northwind GmbH/);
  assert.match(await page.locator('.dt-table').innerText(), /云朵睫毛/);
  assert.match(await page.locator('.dt-total').innerText(), /260\.00/);
  await page.locator('[data-action="close-modal"]').first().click();
  await settle();
  await page.locator('[data-biz-doc="pi"]').first().click();
  await settle();
  assert.match(await page.locator('.dt-title h2').innerText(), /形式发票/);
  await page.locator('[data-action="close-modal"]').first().click();
  assert.deepEqual(app.errors, []);
});

test('an order without lines has no document buttons', async () => {
  const { page } = app;
  await page.locator('[data-biz-action="new-order"]').first().click();
  await settle();
  await page.locator('#biz-order-form [name="client"]').fill('Plain Co');
  await page.locator('#biz-order-form [name="amount"]').fill('50');
  await page.locator('button[type="submit"][form="biz-order-form"]').click();
  await settle(600);
  const row = page.locator('[data-order-row]', { hasText: 'Plain Co' });
  assert.equal(await row.locator('[data-biz-doc]').count(), 0);
  assert.equal(await page.locator('[data-order-row]', { hasText: 'Northwind GmbH' }).locator('[data-biz-doc]').count(), 2);
});
