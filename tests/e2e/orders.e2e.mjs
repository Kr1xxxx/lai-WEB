// 订单 in the real page with the real backend: create, edit, change stage, validation, search / filters, archive and
// restore, paging, the order on the customer detail, and persistence after a reload. Test data: docs/samples customers.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

let app;
before(async () => { app = await startApp(); await openOrders(); });
after(async () => { await app?.close(); });

const settle = (ms = 300) => app.page.waitForTimeout(ms);
const form = () => app.page.locator('#biz-order-form');
const rows = () => app.page.locator('[data-order-row]');
const orders = async () => (await app.readData()).orders || [];
const byNum = async (num) => (await orders()).find((o) => o.num === num);

async function openOrders() {
  const { page } = app;
  await app.open('customers');
  await page.locator('.rail-item[data-rail-menu="交易"]').click();
  await page.locator('.subnav .nav-row:has(.nav-label:text-is("全部订单"))').click();
  await page.locator('.op-page').waitFor();
}

// Fills the open order form; only the fields that are given are touched.
async function fillOrder(f) {
  const set = (name, value) => form().locator(`[name="${name}"]`).fill(String(value));
  for (const name of ['num', 'client', 'productType', 'amount', 'paidAmount', 'owner', 'trackingNumber', 'carrier', 'note']) {
    if (f[name] !== undefined) await set(name, f[name]);
  }
  if (f.currency) await form().locator('[name="currency"]').selectOption(f.currency, { force: true });
  if (f.stage) await form().locator('[name="stage"]').selectOption(f.stage, { force: true });
  if (f.isDraft !== undefined) await form().locator('[name="isDraft"]').setChecked(f.isDraft, { force: true });
}
const submit = async () => {
  await app.page.locator('button[type=submit][form="biz-order-form"]').click();
  await settle(700);
};
async function createOrder(f) {
  await app.page.locator('[data-biz-action="new-order"]').first().click();
  await form().waitFor();
  await fillOrder({ isDraft: false, ...f });
  await submit();
  await form().waitFor({ state: 'detached' });
}
async function openOrder(num) {
  await app.page.locator('[data-order-row]', { hasText: num }).locator('.op-link').first().click();
  await form().waitFor();
}
async function openCustomer(name) {
  await app.page.locator('[data-order-row] [data-biz-customer]', { hasText: name }).first().click();
  await app.page.getByText('客户详情', { exact: true }).first().waitFor({ timeout: 5000 });
}
const rowText = async (num) => (await app.page.locator('[data-order-row]', { hasText: num }).innerText()).replace(/\s+/g, ' ');
const search = async (text) => {
  const box = app.page.locator('#biz-search');
  await box.fill(text);
  await settle(400);
};
const clearFilters = async () => { await app.page.locator('[data-biz-action="clear-filters"]').click(); await settle(300); };
const nums = async () => (await rows().locator('.op-num .op-link').allInnerTexts());

test('an order is created for a sample customer, shows in the list and the backend, and survives a reload', async () => {
  const { page } = app;
  assert.equal(await rows().count(), 0);
  assert.match(await page.locator('.op-page .k-pageheader-desc').innerText(), /有效订单 0 笔/);
  await createOrder({ num: 'E2E-001', client: 'Northwind Lash Studio', productType: 'Cloud Lash', amount: 1000, paidAmount: 300, owner: 'Kris' });
  assert.equal(await rows().count(), 1);
  const text = await rowText('E2E-001');
  for (const part of ['Northwind Lash Studio', 'Cloud Lash', '1,000.00 USD', '300.00 USD', '700.00 USD', '报价', 'Kris']) assert.ok(text.includes(part), part + ' in ' + text);
  assert.match(await page.locator('.op-page .k-pageheader-desc').innerText(), /有效订单 1 笔 · 草稿 0 笔 · 未完成 1 笔/);
  assert.match(await page.locator('.op-foot .op-total').first().innerText(), /共 1 笔订单/);
  const saved = await byNum('E2E-001');
  assert.deepEqual([saved.client, saved.amount, saved.paidAmount, saved.currency, saved.stage, saved.isDraft], ['Northwind Lash Studio', 1000, 300, 'USD', 'quote', false]);
  await openOrders();
  assert.equal(await rows().count(), 1);
  assert.ok((await rowText('E2E-001')).includes('1,000.00 USD'));
  assert.deepEqual(app.errors, []);
});

test('the order shows on the customer detail, and the detail opens it again', async () => {
  const { page } = app;
  await openCustomer('Northwind Lash Studio');
  const side = page.locator('.lcd-side-order').filter({ hasText: 'E2E-001' });
  await side.waitFor();
  assert.match(await side.innerText(), /1,000/);
  assert.match(await side.innerText(), /报价/);
  assert.match(await page.locator('.lcd-side-card', { hasText: '销售订单' }).first().innerText(), /销售订单\s*（1）/);
  await side.locator('[data-lai-order]').click();
  await form().waitFor();
  assert.equal(await form().locator('[name="num"]').inputValue(), 'E2E-001');
  assert.equal(await form().locator('[name="client"]').inputValue(), 'Northwind Lash Studio');
  // The order opened from the customer detail remembers the customer: closing it goes back to that customer.
  await page.locator('[data-biz-action="close-editor"]').first().click();
  await form().waitFor({ state: 'detached' });
  await page.getByText('客户详情', { exact: true }).first().waitFor({ timeout: 5000 });
  await page.locator('.lcd-side-order').filter({ hasText: 'E2E-001' }).waitFor();
  assert.equal(await page.locator('.op-page').count(), 0);
  // Back to the order list for the next steps.
  await openOrders();
  assert.deepEqual(app.errors, []);
});

test('a new order can be started from the customer detail with the customer filled in', async () => {
  const { page } = app;
  await openCustomer('Northwind Lash Studio');
  await page.locator('[data-new-customer-order]').first().click();
  await form().waitFor();
  assert.equal(await form().locator('[name="client"]').inputValue(), 'Northwind Lash Studio');
  await fillOrder({ num: 'E2E-004', productType: 'Lash Glue', amount: 80, isDraft: false });
  await submit();
  await form().waitFor({ state: 'detached' });
  const saved = await byNum('E2E-004');
  assert.equal(saved.client, 'Northwind Lash Studio');
  await page.locator('.lcd-side-order').filter({ hasText: 'E2E-004' }).waitFor();
  assert.match(await page.locator('.lcd-side-card', { hasText: '销售订单' }).first().innerText(), /销售订单\s*（2）/);
  assert.deepEqual(app.errors, []);
});

test('editing an order changes the amounts and the stage in the list and the backend', async () => {
  const { page } = app;
  await openOrders();
  await openOrder('E2E-001');
  await fillOrder({ amount: 1500, paidAmount: 500, stage: 'production', trackingNumber: 'TRK-778', carrier: 'DHL', note: '加急' });
  await submit();
  await form().waitFor({ state: 'detached' });
  const text = await rowText('E2E-001');
  for (const part of ['1,500.00 USD', '500.00 USD', '1,000.00 USD', '生产中', 'DHL TRK-778']) assert.ok(text.includes(part), part + ' in ' + text);
  const saved = await byNum('E2E-001');
  assert.deepEqual([saved.amount, saved.paidAmount, saved.stage, saved.trackingNumber, saved.carrier, saved.note], [1500, 500, 'production', 'TRK-778', 'DHL', '加急']);
  // The form shows the saved values again.
  await openOrder('E2E-001');
  assert.equal(await form().locator('[name="amount"]').inputValue(), '1500');
  assert.equal(await form().locator('[name="stage"]').inputValue(), 'production');
  assert.equal(await form().locator('[name="note"]').inputValue(), '加急');
  await page.locator('[data-biz-action="close-editor"]').first().click();
  await form().waitFor({ state: 'detached' });
  assert.deepEqual(app.errors, []);
});

test('a bad order is refused with a plain message and nothing is saved', async () => {
  const { page } = app;
  await page.locator('[data-biz-action="new-order"]').first().click();
  await form().waitFor();
  await fillOrder({ num: 'E2E-BAD', client: 'Lumen Lash Lab', amount: 100, paidAmount: 200, isDraft: false });
  await submit();
  assert.equal(await page.locator('#biz-order-error').innerText(), '已收款不能超过订单金额');
  assert.equal(await byNum('E2E-BAD'), undefined);
  // A number that is already used is refused too.
  await fillOrder({ num: 'E2E-001', paidAmount: 0 });
  await submit();
  assert.match(await page.locator('#biz-order-error').innerText(), /订单号已存在/);
  assert.equal((await orders()).length, 2);
  // A missing customer is stopped by the form itself.
  await fillOrder({ num: 'E2E-BAD', client: '' });
  await submit();
  assert.equal(await form().locator('[name="client"]').evaluate((el) => el.validity.valueMissing), true);
  assert.equal(await byNum('E2E-BAD'), undefined);
  await page.locator('[data-biz-action="close-editor"]').first().click();
  await form().waitFor({ state: 'detached' });
  assert.equal(await rows().count(), 2);
  assert.deepEqual(app.errors, []);
});

test('moving an order to 已发货 counts it as fully paid; drafts are counted apart', async () => {
  const { page } = app;
  await createOrder({ num: 'E2E-002', client: 'Bluebell Beauty Supply', productType: 'Lash Tray', amount: 2500, currency: 'EUR', paidAmount: 0, owner: 'Amy' });
  await createOrder({ num: 'E2E-003', client: 'Lumen Lash Lab', productType: 'Sample Box', amount: 90, isDraft: true });
  assert.match(await page.locator('.op-page .k-pageheader-desc').innerText(), /有效订单 3 笔 · 草稿 1 笔 · 未完成 3 笔/);
  assert.ok((await rowText('E2E-003')).includes('草稿'));
  assert.ok((await rowText('E2E-002')).includes('2,500.00 EUR'));
  assert.ok((await rowText('E2E-002')).includes('0.00 EUR'));
  await openOrder('E2E-002');
  await fillOrder({ stage: 'shipment' });
  await submit();
  await form().waitFor({ state: 'detached' });
  const text = await rowText('E2E-002');
  assert.ok(text.includes('已发货'), text);
  assert.equal((text.match(/2,500\.00 EUR/g) || []).length, 2, 'amount and received are both the full amount: ' + text);
  assert.equal((await byNum('E2E-002')).stage, 'shipment');
  await openOrder('E2E-002');
  await fillOrder({ stage: 'done' });
  await submit();
  await form().waitFor({ state: 'detached' });
  assert.match(await page.locator('.op-page .k-pageheader-desc').innerText(), /有效订单 3 笔 · 草稿 1 笔 · 未完成 2 笔/);
  assert.deepEqual(app.errors, []);
});

test('rows are newest first; search, stage, currency and clear-filters narrow the list', async () => {
  const { page } = app;
  assert.deepEqual(await nums(), ['E2E-003', 'E2E-002', 'E2E-004', 'E2E-001']);
  assert.equal(await rows().count(), 4);
  await search('Bluebell');
  assert.deepEqual(await nums(), ['E2E-002']);
  await search('trk-778');
  assert.deepEqual(await nums(), ['E2E-001']);
  await search('e2e-003');
  assert.deepEqual(await nums(), ['E2E-003']);
  await search('没有这个订单');
  assert.equal(await rows().count(), 0);
  await page.locator('.op-list .k-empty').getByText('没有符合条件的订单').waitFor();
  assert.match(await page.locator('.op-foot .op-total').first().innerText(), /共 0 笔订单/);
  await clearFilters();
  assert.equal(await rows().count(), 4);
  assert.equal(await page.locator('#biz-search').inputValue(), '');
  await page.locator('#biz-stage').selectOption('done', { force: true });
  await settle();
  assert.deepEqual(await nums(), ['E2E-002']);
  await page.locator('#biz-stage').selectOption('production', { force: true });
  await settle();
  assert.deepEqual(await nums(), ['E2E-001']);
  await page.locator('#biz-stage').selectOption('', { force: true });
  await page.locator('#biz-currency').selectOption('EUR', { force: true });
  await settle();
  assert.deepEqual(await nums(), ['E2E-002']);
  // Stage and currency together: no EUR order is in production.
  await page.locator('#biz-stage').selectOption('production', { force: true });
  await settle();
  assert.equal(await rows().count(), 0);
  await clearFilters();
  assert.equal(await rows().count(), 4);
  assert.deepEqual(app.errors, []);
});

test('the time filter keeps this month and drops an old order', async () => {
  const { page } = app;
  const ctx = page.context().request;
  const state = await (await ctx.get(app.base + '/api/data')).json();
  state.data.orders.find((o) => o.num === 'E2E-001').createdAt = '2020-02-10';
  const res = await ctx.post(app.base + '/api/save', { data: { state, baseRevision: state.revision } });
  assert.equal(res.status(), 200, await res.text());
  await openOrders();
  assert.equal(await rows().count(), 4);
  await page.locator('#biz-period').selectOption('month', { force: true });
  await settle();
  assert.equal(await rows().count(), 3);
  assert.ok(!(await nums()).includes('E2E-001'));
  await page.locator('#biz-period').selectOption('year', { force: true });
  await settle();
  assert.equal(await rows().count(), 3);
  await clearFilters();
  await page.locator('#biz-period').selectOption('', { force: true });
  await settle();
  assert.equal(await rows().count(), 4);
  assert.ok((await rowText('E2E-001')).includes('02-10'));
  assert.deepEqual(app.errors, []);
});

test('archiving moves an order to the trash and restoring brings it back, also after a reload', async () => {
  const { page } = app;
  await page.locator('[data-order-row]', { hasText: 'E2E-003' }).locator('[data-biz-action="archive-order"]').click();
  await page.getByRole('button', { name: '确认归档' }).click();
  await settle(700);
  assert.deepEqual(await nums(), ['E2E-002', 'E2E-004', 'E2E-001']);
  assert.match(await page.locator('.op-page .k-pageheader-desc').innerText(), /草稿 0 笔/);
  const trash = page.locator('.op-trash-row', { hasText: 'E2E-003' });
  await trash.waitFor();
  assert.match(await page.locator('.op-trash .k-card-head').innerText(), /1 笔/);
  assert.equal((await orders()).some((o) => o.num === 'E2E-003'), false);
  assert.equal((await app.readData()).trashOrders.some((o) => o.num === 'E2E-003'), true);
  await openOrders();
  assert.deepEqual(await nums(), ['E2E-002', 'E2E-004', 'E2E-001']);
  await page.locator('.op-trash-row', { hasText: 'E2E-003' }).waitFor();
  await page.locator('.op-trash-row', { hasText: 'E2E-003' }).getByRole('button', { name: '恢复订单' }).click();
  await settle(700);
  assert.equal(await rows().count(), 4);
  assert.equal(await page.locator('.op-trash-row').count(), 0);
  assert.equal((await byNum('E2E-003')).client, 'Lumen Lash Lab');
  assert.deepEqual(app.errors, []);
});

test('the archive dialog can go back to editing; the order from the editor can be archived too', async () => {
  const { page } = app;
  await openOrder('E2E-004');
  await page.locator('[data-biz-action="archive-order"]').last().click();
  await page.getByRole('button', { name: '返回编辑' }).click();
  await form().waitFor();
  assert.equal(await form().locator('[name="num"]').inputValue(), 'E2E-004');
  await page.locator('[data-biz-action="archive-order"]').last().click();
  await page.getByRole('button', { name: '确认归档' }).click();
  await settle(700);
  assert.equal(await rows().count(), 3);
  assert.equal((await orders()).some((o) => o.num === 'E2E-004'), false);
  // Archived orders leave the customer detail as well, and a draft is not listed there.
  await openCustomer('Northwind Lash Studio');
  await page.locator('.lcd-side-order').filter({ hasText: 'E2E-001' }).waitFor();
  assert.equal(await page.locator('.lcd-side-order').filter({ hasText: 'E2E-004' }).count(), 0);
  assert.match(await page.locator('.lcd-side-card', { hasText: '销售订单' }).first().innerText(), /销售订单\s*（1）/);
  await page.locator('.rail-item[data-rail-menu="交易"]').click();
  await page.locator('.subnav .nav-row:has(.nav-label:text-is("全部订单"))').click();
  await page.locator('.op-page').waitFor();
  await openCustomer('Lumen Lash Lab');
  await page.locator('.lcd-side-card', { hasText: '销售订单' }).first().getByText('暂无销售订单').waitFor();
  assert.deepEqual(app.errors, []);
});

test('the workbench shows the orders on the line and the money for the main currency, without the draft', async () => {
  const { page } = app;
  await page.locator('.rail-item', { hasText: '工作台' }).first().click();
  await page.locator('.wb').waitFor();
  const clean = (text) => text.replace(/\s+/g, ' ').trim();
  // E2E-001 (production, USD) is unfinished; E2E-002 (done, EUR) is finished; E2E-003 is a draft; E2E-004 is archived.
  assert.equal(await page.locator('.wb-ocard').count(), 1);
  assert.match(clean(await page.locator('.wb-ocard').innerText()), /Northwind Lash Studio \$1,500/);
  assert.equal(await page.locator('li[data-stage="production"] .wb-ocard').count(), 1, 'the card sits under 生产中');
  assert.match(clean(await page.locator('li[data-stage="done"]').innerText()), /已完成 1 已完成 1 笔，EUR 2,500/);
  assert.match(clean(await page.locator('.wb-orders .wb-ph').innerText()), /1 笔未完成，共 USD 1,500/);
  // One order in each currency: the bigger total (EUR 2,500) is the main currency; the other is counted, never converted.
  const money = clean(await page.locator('.wb-moneyp').innerText());
  assert.match(money, /€2,500 已收款（100%）/);
  assert.match(money, /€0 待收款，0 笔订单/);
  assert.match(money, /另有 1 种币种，各币种分别统计、不折算/);
  // The workbench asks for the mailbox, and no mailbox is set up in this test.
  assert.deepEqual(app.errors.filter((e) => !e.includes('/api/mail/')), []);
  app.errors.length = 0;
});

test('more than one page of orders: next and previous move between pages', async () => {
  const { page } = app;
  const ctx = page.context().request;
  const state = await (await ctx.get(app.base + '/api/data')).json();
  for (let i = 1; i <= 20; i++) {
    state.data.orders.push({ id: `seed-${i}`, num: `S-${String(i).padStart(2, '0')}`, client: 'Maple & Moss Cosmetics', amount: i * 10, paidAmount: 0, currency: 'USD', stage: 'quote', isDraft: false, createdAt: '2026-01-01', orderMonth: '2026-01' });
  }
  const res = await ctx.post(app.base + '/api/save', { data: { state, baseRevision: state.revision } });
  assert.equal(res.status(), 200, await res.text());
  await openOrders();
  assert.equal(await rows().count(), 20);
  assert.match(await page.locator('.op-foot .op-total').first().innerText(), /共 23 笔订单/);
  assert.equal(await page.locator('.op-foot .k-pager [aria-current="page"]').innerText(), '1');
  assert.equal(await page.locator('[data-biz-action="prev"]').isDisabled(), true);
  await page.locator('[data-biz-action="next"]').click();
  await settle();
  assert.equal(await page.locator('.op-foot .k-pager [aria-current="page"]').innerText(), '2');
  assert.equal(await rows().count(), 3);
  assert.equal(await page.locator('[data-biz-action="next"]').isDisabled(), true);
  await page.locator('[data-biz-action="prev"]').click();
  await settle();
  assert.equal(await rows().count(), 20);
  // A search narrows to one page again.
  await search('S-05');
  assert.deepEqual(await nums(), ['S-05']);
  assert.deepEqual(app.errors, []);
});
