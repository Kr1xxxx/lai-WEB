// Business page fixes, in the real page with the real backend:
// prices with more than two decimals, order numbers that never repeat (also after archiving),
// an opportunity opened from 单据记录 whose buttons work, the opportunity filter reset, and a saved 小满 theme that opens as 科技蓝 with a working 时间 filter.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

const require = createRequire(import.meta.url);
const B = require('../../src/business-model.js');
const O = require('../../src/opportunity-model.js');
const DM = require('../../src/doc-template-model.js');

const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const TODAY_DASH = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const TODAY = TODAY_DASH.replaceAll('-', '');

async function seed(app, change) {
  await app.open('customers');
  const ctx = app.page.context().request;
  const loaded = await (await ctx.get(app.base + '/api/data')).json();
  const data = change(loaded.data);
  const res = await ctx.post(app.base + '/api/save', { data: { state: { ...loaded, data }, baseRevision: loaded.revision } });
  assert.equal(res.status(), 200, await res.text());
  await app.open('customers');
}

let app, tmp;
before(async () => {
  app = await startApp();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lai-test-fixes-'));
  await seed(app, (data) => {
    data.laiProducts = [{ id: 'p-tiny', code: 'TINY-01', name: 'Tiny Lash', unit: '盒', fob: '0.125', specs: [] }];
    data = O.upsert(data, 'opp-1', { client: 'Lumen Lash Lab', contact: 'Greta Vogel', amount: '1200', currency: 'USD', owner: 'Amy', stage: 'open', endDate: '2030-01-31' }, { now: '2026-10-01T00:00:00.000Z', today: '2026-10-01' });
    const result = DM.saveDocument(data, { type: 'pi', client: 'Lumen Lash Lab', currency: 'USD', date: TODAY_DASH, today: TODAY_DASH, lines: [{ name: 'Tiny Lash', qty: 2, price: 5 }], reference: { label: '商机', value: 'Lumen' }, source: { kind: 'opportunity', id: 'opp-1', label: 'Lumen' } });
    return result.state;
  });
});
after(async () => { await app?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const settle = (ms = 350) => app.page.waitForTimeout(ms);
const form = () => app.page.locator('#biz-order-form');
const openOrders = async () => {
  await app.page.locator('.rail-item', { hasText: '交易' }).first().click();
  await settle(500);
};
const newOrder = async () => {
  await openOrders();
  await app.page.getByRole('button', { name: /新建订单/ }).first().click();
  await form().waitFor();
};
const save = async () => {
  await app.page.locator('button[type=submit][form="biz-order-form"]').click();
  await form().waitFor({ state: 'detached' });
  await settle();
};

test('a product price with three decimals saves in the order form', async () => {
  const { page } = app;
  await newOrder();
  assert.equal(await form().locator('[name="num"]').inputValue(), `L${TODAY}-001`);
  await form().locator('[name="client"]').fill('Fraction Buyer');
  await form().locator('[data-biz-action="order-item-add"]').click();
  await form().locator('[data-item-product="0"]').selectOption('p-tiny', { force: true });
  await settle();
  assert.equal(await form().locator('[data-item-field="price"][data-item-index="0"]').inputValue(), '0.125');
  // The browser must not reject the value on submit.
  assert.equal(await form().evaluate((el) => el.checkValidity()), true);
  await save();
  const order = (await app.readData()).orders.find((o) => o.client === 'Fraction Buyer');
  assert.ok(order, 'the order is saved');
  assert.equal(order.items[0].price, 0.125);
  assert.deepEqual(app.errors, []);
});

test('the suggested order number never repeats, also after an order is archived', async () => {
  const { page } = app;
  const suggested = async () => {
    await newOrder();
    return form().locator('[name="num"]').inputValue();
  };
  assert.equal(await suggested(), `L${TODAY}-002`);
  await form().locator('[name="client"]').fill('Second Buyer');
  await form().locator('[name="amount"]').fill('5');
  await save();
  assert.equal(await suggested(), `L${TODAY}-003`);
  await form().locator('[name="client"]').fill('Third Buyer');
  await form().locator('[name="amount"]').fill('7');
  await save();
  // Archive the third order: its number must not come back.
  const third = (await app.readData()).orders.find((o) => o.client === 'Third Buyer');
  await page.locator(`[data-biz-order="${third.id}"]`).first().click();
  await form().waitFor();
  await page.locator('.drawer [data-biz-action="archive-order"]').click();
  await page.locator('.drawer [data-biz-action="confirm-archive"]').click();
  await settle(600);
  const data = await app.readData();
  assert.equal(data.orders.some((o) => o.client === 'Third Buyer'), false);
  assert.equal(data.trashOrders.some((o) => o.client === 'Third Buyer'), true);
  assert.equal(await suggested(), `L${TODAY}-004`);
  await form().locator('[name="client"]').fill('Fourth Buyer');
  await form().locator('[name="amount"]').fill('9');
  await save();
  const nums = (await app.readData()).orders.map((o) => o.num);
  assert.equal(new Set(nums).size, nums.length);
  assert.deepEqual(app.errors, []);
});

test('an opportunity opened from 单据记录 → 来源 has working buttons', async () => {
  const { page } = app;
  await page.locator('.rail-item[data-rail-menu="交易"]').click();
  await page.locator('.subnav .nav-row:has(.nav-label:text-is("单据模板"))').click();
  await page.locator('[data-doc-panel]').waitFor();
  await page.locator('[data-doc-tab="records"]').click();
  await settle();
  await page.locator('[data-doc-action="source"]').first().click();
  await page.locator('.opp-detail').waitFor();
  // 更多操作 opens the menu although the page behind is not the opportunity page.
  await page.locator('[data-opp-action="menu"]').click();
  await page.locator('.opp-menu').waitFor();
  assert.equal(await page.locator('.opp-detail').count(), 0);
  await page.locator('[data-action="close-modal"]').first().click();
  await settle();
  // 编辑商机 opens the form.
  await page.locator('[data-doc-action="source"]').first().click();
  await page.locator('.opp-detail').waitFor();
  await page.locator('[data-opp-action="edit"]').click();
  await page.locator('#opp-form').waitFor();
  await page.locator('[data-action="close-modal"]').first().click();
  await settle();
  // An attachment can be added there too.
  await page.locator('[data-doc-action="source"]').first().click();
  await page.locator('.opp-detail').waitFor();
  const file = path.join(tmp, 'from-records.txt');
  fs.writeFileSync(file, 'price list');
  await page.locator('#opp-attach-input').setInputFiles(file);
  await page.locator('[data-att]').first().waitFor({ timeout: 8000 });
  assert.match(await page.locator('#opp-attach').innerText(), /from-records\.txt/);
  const saved = (await app.readData()).laiOpportunities.find((o) => o.id === 'opp-1');
  assert.equal(saved.attachments.length, 1);
  await page.locator('[data-action="close-modal"]').first().click();
  assert.deepEqual(app.errors, []);
});

test('opening 商机 from the left rail clears an old search', async () => {
  const { page } = app;
  await page.locator('.rail-item[data-rail-menu="商机"]').click();
  await settle(700);
  await page.locator('#opp-search').fill('zzz-nothing');
  await page.locator('#opp-search').dispatchEvent('change');
  await settle(500);
  assert.equal(await page.locator('.opp-card').count(), 0);
  await openOrders();
  await page.locator('.rail-item[data-rail-menu="商机"]').click();
  await settle(700);
  assert.equal(await page.locator('#opp-search').inputValue(), '');
  assert.equal(await page.locator('.opp-card').count(), 1);
  assert.deepEqual(app.errors, []);
});

test('the opportunity search filters while typing', async () => {
  const { page } = app;
  await page.locator('.rail-item[data-rail-menu="商机"]').click();
  await settle(700);
  await page.locator('#opp-search').click();
  await page.keyboard.type('zzz', { delay: 30 });
  await settle(600);
  assert.equal(await page.locator('.opp-card').count(), 0, 'filtered without leaving the field');
  assert.equal(await page.locator('#opp-search').inputValue(), 'zzz');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'opp-search');
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await settle(600);
  assert.equal(await page.locator('.opp-card').count(), 1);
  assert.deepEqual(app.errors, []);
});

test('the order prefix only takes letters, digits and a hyphen, and the page raises no pattern error', async () => {
  const { page } = app;
  await page.evaluate(() => { const b = document.createElement('button'); b.dataset.laiRoute = 'settings'; document.body.appendChild(b); b.click(); b.remove(); });
  await settle(700);
  const input = page.locator('#biz-settings-form [name="orderPrefix"]');
  await input.waitFor();
  assert.equal(await input.evaluate((el) => el.validity.patternMismatch), false);
  await input.fill('AB-1');
  assert.equal(await input.evaluate((el) => el.checkValidity()), true);
  await input.fill('A_B');
  assert.equal(await input.evaluate((el) => el.validity.patternMismatch), true);
  await page.locator('#biz-settings-form button[type=submit]').click();
  await settle(500);
  const saved = (await app.readData()).laiSettings || {};
  assert.notEqual(saved.orderPrefix, 'A_B');
  assert.deepEqual(app.errors, []);
});

test('a saved 小满 theme opens as 科技蓝 (nothing written on load), and the order list 时间 filter works', async () => {
  const legacy = await startApp();
  try {
    await seed(legacy, (data) => {
      data.laiSettings = { ...(data.laiSettings || {}), theme: 'xiaoman' };
      data = B.upsertOrder(data, 'old', { num: 'OLD-1', client: 'Old Buyer', amount: 1, createdAt: '2020-01-05' });
      return B.upsertOrder(data, 'new', { num: 'NEW-1', client: 'New Buyer', amount: 1, createdAt: TODAY_DASH });
    });
    const page = legacy.page;
    await page.locator('.rail-item', { hasText: '交易' }).first().click();
    await page.waitForTimeout(500);
    assert.deepEqual(await page.evaluate(() => ({ ...document.documentElement.dataset })), { theme: 'tech', skin: 'glass' });
    assert.equal((await legacy.readData()).laiSettings.theme, 'xiaoman', 'opening the page does not rewrite the saved value');
    const period = page.locator('#biz-period');
    await period.waitFor();
    assert.equal(await page.locator('[data-order-row]').count(), 2);
    await period.selectOption('month', { force: true });
    await page.waitForTimeout(400);
    assert.equal(await page.locator('[data-order-row]').count(), 1);
    assert.match(await page.locator('.op-list').innerText(), /NEW-1/);
    await page.locator('[data-biz-action="clear-filters"]').click();
    await page.waitForTimeout(300);
    assert.equal(await page.locator('[data-order-row]').count(), 2);
    assert.deepEqual(legacy.errors, []);
  } finally {
    await legacy.close();
  }
});
