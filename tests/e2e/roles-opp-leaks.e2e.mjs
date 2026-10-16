// 字段权限 for 商机 outside the opportunity pages: the customer detail 进行中的商机 row, and a 报价单 made from an
// opportunity. A 业务 account whose role hides 结束日期, 备注 and 关联产品 must not see them there; the admin still does.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { startApp } from './harness.mjs';

const require = createRequire(import.meta.url);
const O = require('../../src/opportunity-model.js');
const TODAY = '2026-10-01';

const PERMS = Object.fromEntries(['opp.view', 'opp.create', 'opp.edit', 'customer.view', 'order.view', 'order.create', 'doc.create'].map((key) => [key, true]));
const members = [{ id: 'm-kris', name: 'Kris', roleId: 'admin' }, { id: 'm-amy', name: 'Amy', roleId: 'sales' }];

async function start(current, fields, extra = (data) => data) {
  const app = await startApp();
  await app.open('customers');
  const request = app.page.context().request;
  const loaded = await (await request.get(app.base + '/api/data')).json();
  let data = loaded.data;
  const roles = [{ id: 'sales', name: '业务', scope: 'self', perms: PERMS, v: 2, fields }];
  data.laiSettings = { ...(data.laiSettings || {}), defaultOwner: 'Amy', roles: { roles, departments: [], members, current } };
  data.customers = { ...data.customers, 'Amy Buyer': { client: 'Amy Buyer', country: 'US', owner: 'Amy', contacts: [] } };
  data = O.upsert(data, 'opp-a', { client: 'Amy Buyer', amount: '10', currency: 'USD', owner: 'Amy', stage: 'open', endDate: '2026-11-05', note: 'secret opp note', products: 'Cloud Lash, 20, 2.5' }, { now: '2026-10-01T00:00:00.000Z', today: TODAY });
  data = extra(data);
  const res = await request.post(app.base + '/api/save', { data: { state: { ...loaded, data }, baseRevision: loaded.revision } });
  assert.equal(res.status(), 200, await res.text());
  await app.open('customers');
  return app;
}
const settle = (app, ms = 400) => app.page.waitForTimeout(ms);
const hide = { opp: { endDate: 'hidden', note: 'hidden', products: 'hidden' } };

async function openAmy(app) {
  await app.page.locator('tbody tr', { hasText: 'Amy Buyer' }).locator('.company-link').click();
  await app.page.locator('.lcd-opportunity-row').waitFor();
}

test('customer detail 进行中的商机 row hides the end date and note when the role hides them', async () => {
  const app = await start('m-amy', hide);
  try {
    await openAmy(app);
    const row = await app.page.locator('.lcd-opportunity-row').innerText();
    assert.ok(row.includes('销售金额'), '金额还在');
    assert.ok(!row.includes('结束日期') && !row.includes('2026-11-05'), '没有结束日期');
    assert.ok(!row.includes('备注') && !row.includes('secret opp note'), '没有备注');
    assert.deepEqual(app.errors.filter((error) => !error.includes('/api/mail/')), []);
  } finally { await app.close(); }
});

test('customer detail 进行中的商机 row keeps read-only fields; admin sees everything', async () => {
  const readOnly = await start('m-amy', { opp: { endDate: 'read', note: 'read' } });
  try {
    await openAmy(readOnly);
    const row = await readOnly.page.locator('.lcd-opportunity-row').innerText();
    assert.ok(row.includes('2026-11-05') && row.includes('secret opp note'));
  } finally { await readOnly.close(); }
  const admin = await start('m-kris', hide);
  try {
    await openAmy(admin);
    const row = await admin.page.locator('.lcd-opportunity-row').innerText();
    assert.ok(row.includes('2026-11-05') && row.includes('secret opp note'));
  } finally { await admin.close(); }
});

test('customer detail 商机和订单 tab: hidden 结束日期 column, and only opportunities the account may see', async () => {
  // Kris 负责的商机也挂在 Amy 的客户上：本人范围的 Amy 在客户详情里不该看到它。
  const withKrisOpp = (data) => O.upsert(data, 'opp-k', { client: 'Amy Buyer', amount: '77', currency: 'USD', owner: 'Kris', stage: 'open', endDate: '2026-12-09', note: '', products: '' }, { now: '2026-10-02T00:00:00.000Z', today: TODAY });
  const tradeTable = async (app) => {
    await openAmy(app);
    await app.page.locator('[data-tab="trade"]').first().click();
    const table = app.page.locator('.lcd-opportunity-table');
    await table.waitFor();
    return table.innerText();
  };
  const app = await start('m-amy', hide, withKrisOpp);
  try {
    const text = await tradeTable(app);
    assert.ok(text.includes('负责人') && text.includes('Amy'), '自己的商机在');
    assert.ok(!text.includes('结束日期') && !text.includes('2026-11-05'), '没有结束日期');
    assert.ok(!text.includes('Kris') && !text.includes('2026-12-09'), '看不到别人负责的商机');
    assert.deepEqual(app.errors.filter((error) => !error.includes('/api/mail/')), []);
  } finally { await app.close(); }
  const admin = await start('m-kris', hide, withKrisOpp);
  try {
    const text = await tradeTable(admin);
    assert.ok(text.includes('结束日期') && text.includes('2026-11-05') && text.includes('Kris'), '管理员看到全部');
  } finally { await admin.close(); }
});

async function makeQuote(app) {
  await app.page.evaluate(() => { const b = document.createElement('button'); b.dataset.laiRoute = 'opportunities'; document.body.appendChild(b); b.click(); b.remove(); });
  await settle(app, 700);
  await app.page.locator('.opp-card [data-opp-action="menu"]').first().click();
  await app.page.locator('[data-opp-doc="quote"]').click();
  const box = app.page.locator('#opp-doc-box');
  await box.waitFor();
  return box;
}

test('a 报价单 made from an opportunity leaves out the products when the role hides them', async () => {
  const app = await start('m-amy', hide);
  try {
    const box = await makeQuote(app);
    const table = await box.locator('.dt-table').innerText();
    assert.ok(!table.includes('Cloud Lash'), '没有商机里的产品');
    assert.ok(!(await box.innerText()).includes('secret opp note'), '没有备注');
    await box.locator('[data-biz-action="oppdoc-save"]').click();
    await settle(app, 700);
    const doc = (await app.readData()).laiDocuments[0];
    assert.ok(doc && !JSON.stringify(doc).includes('Cloud Lash') && !JSON.stringify(doc).includes('secret opp note'));
    assert.deepEqual(app.errors.filter((error) => !error.includes('/api/mail/')), []);
  } finally { await app.close(); }
  const admin = await start('m-kris', hide);
  try {
    const box = await makeQuote(admin);
    assert.ok((await box.locator('.dt-table').innerText()).includes('Cloud Lash'), '管理员还是看到产品');
  } finally { await admin.close(); }
});
