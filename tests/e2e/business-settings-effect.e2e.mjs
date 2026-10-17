// 业务页的范围和设置 in the real page with the real backend: a 业务 account (Amy, scope 本人) only gets her own customers
// in the new-record forms and cannot save a record for someone else's customer; the administrator sees everyone.
// Stored leads (the 线索 module was removed, D-030) are never offered and survive the saves untouched.
// Also the 设置 page (currency list, owner hint, local-data note) and voiding a saved document from the order form.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { startApp } from './harness.mjs';

const require = createRequire(import.meta.url);
const B = require('../../src/business-model.js');
const O = require('../../src/opportunity-model.js');
const D = require('../../src/doc-template-model.js');
const NOW = '2026-10-01T00:00:00.000Z';
const NO_SCOPE = '这个客户不在你的范围内';
const STORED_LEADS = [{ id: 'lead-a', name: 'Amy Lead', owner: 'Amy', status: 'new', createdAt: NOW }, { id: 'lead-k', name: 'Kris Lead', owner: 'Kris', status: 'following', createdAt: NOW }];

async function start(current, extra = (data) => data) {
  const app = await startApp();
  await app.open('customers');
  const ctx = app.page.context().request;
  const loaded = await (await ctx.get(app.base + '/api/data')).json();
  let data = loaded.data;
  data.customers = {
    AmyCo: { client: 'AmyCo', country: 'US', owner: 'Amy', contact: 'Ann', history: [] },
    KrisCo: { client: 'KrisCo', country: 'DE', owner: 'Kris', contact: 'Karl', history: [] },
  };
  data.laiSettings = { ...(data.laiSettings || {}), defaultOwner: current === 'm-kris' ? 'Kris' : 'Amy', roles: { roles: [], members: [{ id: 'm-kris', name: 'Kris', roleId: 'admin' }, { id: 'm-amy', name: 'Amy', roleId: 'sales' }], current } };
  data.laiLeads = STORED_LEADS;
  for (const [id, owner] of [['a', 'Amy'], ['k', 'Kris']]) {
    data = B.upsertOrder(data, `order-${id}`, { num: `L-${owner}`, client: `${owner}Co`, country: 'US', productType: 'Lash', amount: '100', currency: 'USD', paidAmount: '0', stage: 'quote', createdAt: '2026-10-01', owner, isDraft: false, items: [] });
    data = O.upsert(data, `opp-${id}`, { client: `${owner}Co`, contact: owner === 'Amy' ? 'Ann' : 'Karl', amount: '10', currency: 'USD', owner, stage: 'open', endDate: '2026-11-05' }, { now: NOW, today: '2026-10-01' });
  }
  data = extra(data);
  const res = await ctx.post(app.base + '/api/save', { data: { state: { ...loaded, data }, baseRevision: loaded.revision } });
  assert.equal(res.status(), 200, await res.text());
  await app.open('customers');
  return app;
}
const settle = (app, ms = 400) => app.page.waitForTimeout(ms);
const go = async (app, route) => {
  await app.page.evaluate((target) => { const b = document.createElement('button'); b.dataset.laiRoute = target; document.body.appendChild(b); b.click(); b.remove(); }, route);
  await settle(app, 600);
};
// The client dropdown only lists the customers this account may see; choosing one also fills the contact list.
const pickClient = async (page, name) => {
  await page.locator('#opp-form [name="client"]').selectOption(name, { force: true });
  await page.waitForFunction(() => document.querySelector('#opp-form select[name="contact"]')?.options.length > 1);
  // Leaving the client box makes the form reset the contact list: move on first, then choose the contact.
  await page.locator('#opp-form [name="amount"]').fill('50');
  await page.waitForTimeout(400);
  await page.locator('#opp-form [name="endDate"]').evaluate((el) => { el.value = '2026-12-01'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.locator('#opp-form select[name="contact"]').selectOption({ index: 1 }, { force: true });
};
const savedToast = async (page) => {
  try {
    await page.locator('#toast.show', { hasText: '已保存' }).waitFor({ timeout: 8000 });
  } catch {
    throw new Error('not saved: ' + (await page.locator('.error.visible').allInnerTexts()).join(' | ') + ' invalid: ' + (await page.evaluate(() => [...document.querySelectorAll(':invalid')].map((e) => e.name + '=' + e.value))).join(','));
  }
};
const optionValues = (app, selector) => app.page.locator(`${selector} option`).evaluateAll((list) => list.map((o) => o.value || o.textContent));

test('业务 (Amy): new opportunity and new order only offer her customers, and refuse KrisCo', async () => {
  const app = await start('m-amy');
  try {
    const { page } = app;
    await go(app, 'opportunities');
    await page.locator('[data-opp-action="new"]').click();
    await page.locator('#opp-form').waitFor();
    assert.deepEqual(await optionValues(app, '#opp-client'), ['请选择客户', 'AmyCo'], '客户名单只有自己的');
    const form = await page.locator('#opp-form').innerHTML();
    assert.ok(!form.includes('Amy Lead') && !form.includes('Kris Lead') && !form.includes('来源线索'), '来源线索 is gone (D-030)');
    assert.ok(!form.includes('KrisCo'));
    // KrisCo is not in the dropdown; a stale page that still offers it is refused on save.
    await page.locator('#opp-client').evaluate((el) => { el.add(new Option('KrisCo', 'KrisCo')); el.value = 'KrisCo'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.locator('#opp-form [name="amount"]').fill('50');
    await page.locator('button[form="opp-form"]').click();
    await page.locator('#opp-error.visible', { hasText: NO_SCOPE }).waitFor();
    assert.equal((await app.readData()).laiOpportunities.length, 2, '没有保存');
    await pickClient(page, 'AmyCo');
    await page.locator('button[form="opp-form"]').click();
    await savedToast(page);
    assert.equal((await app.readData()).laiOpportunities.length, 3, '自己的客户可以保存');
    assert.deepEqual((await app.readData()).laiLeads, STORED_LEADS, 'stored leads survive the save untouched');

    await go(app, 'order-list');
    await page.locator('[data-biz-action="new-order"]').first().click();
    await page.locator('#biz-order-form').waitFor();
    assert.deepEqual(await optionValues(app, '#biz-customer-names'), ['AmyCo']);
    await page.locator('#biz-order-form [name="client"]').fill('KrisCo');
    await page.locator('#biz-order-form [name="amount"]').fill('80');
    await page.locator('button[form="biz-order-form"]').click();
    await page.locator('#biz-order-error.visible', { hasText: NO_SCOPE }).waitFor();
    assert.equal((await app.readData()).orders.length, 2, '没有保存');
  } finally {
    await app.close();
  }
});

test('管理员 (Kris) sees every customer in the same forms, and may save for any customer', async () => {
  const app = await start('m-kris');
  try {
    const { page } = app;
    await go(app, 'opportunities');
    await page.locator('[data-opp-action="new"]').click();
    await page.locator('#opp-form').waitFor();
    const names = await optionValues(app, '#opp-client');
    assert.ok(names.includes('AmyCo') && names.includes('KrisCo'));
    const form = await page.locator('#opp-form').innerHTML();
    assert.ok(!form.includes('Amy Lead') && !form.includes('Kris Lead'));
    await page.locator('#opp-form [name="amount"]').fill('50');
    await pickClient(page, 'AmyCo');
    await page.locator('button[form="opp-form"]').click();
    await savedToast(page);
    assert.equal((await app.readData()).laiOpportunities.length, 3);
    assert.deepEqual((await app.readData()).laiLeads, STORED_LEADS);
  } finally {
    await app.close();
  }
});

test('设置: currency list is longer and keeps an unusual saved currency; owner hint and short local-data note', async () => {
  const app = await start('m-kris', (data) => ({ ...data, laiSettings: { ...data.laiSettings, defaultCurrency: 'THB' } }));
  try {
    const { page } = app;
    await go(app, 'settings');
    const codes = await optionValues(app, '#biz-settings-form [name="defaultCurrency"]');
    assert.equal(codes[0], 'THB', '已存的币种在选项里');
    for (const code of ['USD', 'JPY', 'HKD', 'SGD', 'RUB', 'AED', 'INR', 'BRL', 'MXN']) assert.ok(codes.includes(code), code);
    assert.equal(await page.locator('#biz-settings-form [name="defaultCurrency"]').inputValue(), 'THB');
    await page.locator('#biz-settings-form button[type="submit"]').click();
    await page.locator('#toast.show', { hasText: '已保存' }).waitFor();
    assert.equal((await app.readData()).laiSettings.defaultCurrency, 'THB', '保存设置不会悄悄换掉币种');
    const text = await page.locator('body').innerText();
    assert.ok(text.includes('新建客户、商机、订单时默认填这个人。只能看本人或本部门客户的账号，会默认填自己。'));
    assert.ok(text.includes('客户、订单、日程都保存在来财里，可以随时备份。'));
    assert.ok(!text.includes('这台电脑') && !text.includes('打开数据目录'));
    assert.ok(!text.includes('统一客户与经营界面') && !text.includes('数据库'));
  } finally {
    await app.close();
  }
});

test('单据: a saved document opened from the order form can be voided there (two clicks)', async () => {
  const app = await start('m-kris', (data) => D.saveDocument(data, { type: 'quote', client: 'AmyCo', lines: [{ name: 'Lash', qty: 1, price: 100 }], currency: 'USD', today: '2026-10-01', source: { kind: 'order', id: 'order-a', label: 'L-Amy' } }).state);
  try {
    const { page } = app;
    await go(app, 'order-list');
    await page.locator('[data-biz-order="order-a"]').first().click();
    await page.locator('#biz-order-form').waitFor();
    await page.locator('[data-biz-action="docrec-view"]').first().click();
    const void1 = page.locator('[data-biz-action="docrec-void"]');
    await void1.waitFor();
    await void1.click();
    assert.equal((await void1.innerText()).trim(), '确定作废');
    assert.equal((await app.readData()).laiDocuments[0].status, '有效');
    await void1.click();
    await page.locator('.dt-void-note').waitFor();
    assert.equal((await app.readData()).laiDocuments[0].status, '已作废');
    assert.equal(await page.locator('[data-biz-action="docrec-void"]').count(), 0, '已作废的不再有作废按钮');
  } finally {
    await app.close();
  }
});
