// Settings that must take effect on the customer side, and scope leaks, in the real page with the real backend:
// 默认跟进人 / 默认币种 on a new customer, 商机和订单 on the customer detail for each role, who can open 客户设置 and
// which tabs they get, and the 客户设置 click guard not leaking onto the product page.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

const require = createRequire(import.meta.url);
const B = require('../../src/business-model.js');
const O = require('../../src/opportunity-model.js');
const NOW = '2026-10-01T00:00:00.000Z';
const CLIENT = 'Maple & Moss Cosmetics';

// Roles: 业务 (built in, scope self) plus two custom ones. r-dedupe only holds 判重设置, r-prod can use products but not 客户设置,
// r-noview may open customers but has neither 商机 nor 订单 view permission.
const ROLES = [
  { id: 'r-dedupe', name: '判重专员', scope: 'all', perms: { 'settings.dedupe': true } },
  { id: 'r-prod', name: '产品专员', scope: 'all', perms: { 'customer.view': true, 'product.view': true, 'settings.product': true } },
  { id: 'r-noview', name: '客服', scope: 'all', perms: { 'customer.view': true, 'customer.edit': true } },
];
const MEMBERS = [
  { id: 'm-kris', name: 'Kris', roleId: 'admin' },
  { id: 'm-amy', name: 'Amy', roleId: 'sales' },
  { id: 'm-dee', name: 'Dee', roleId: 'r-dedupe' },
  { id: 'm-pat', name: 'Pat', roleId: 'r-prod' },
  { id: 'm-nov', name: 'Nova', roleId: 'r-noview' },
];

let app;
before(async () => {
  app = await startApp();
  await app.open('customers');
  await mutate((data) => {
    data.customers[CLIENT].owner = 'Amy';
    data.laiSettings = { ...(data.laiSettings || {}), defaultOwner: 'Dana', defaultCurrency: 'EUR', roles: { roles: ROLES, members: MEMBERS, current: 'm-kris' } };
    for (const [id, owner] of [['a', 'Amy'], ['k', 'Kris']]) {
      data = Object.assign(data, B.upsertOrder(data, `order-${id}`, { num: `L-${owner}`, client: CLIENT, country: 'US', productType: 'Lash', amount: '100', currency: 'USD', paidAmount: '0', stage: 'quote', createdAt: '2026-10-01', owner, isDraft: false, items: [] }));
      data = Object.assign(data, O.upsert(data, `opp-${id}`, { client: CLIENT, contact: data.customers[CLIENT].contact, name: `${owner} Deal`, amount: '10', currency: 'USD', owner, stage: 'open', endDate: '2026-11-05' }, { now: NOW, today: '2026-10-01' }));
    }
    return data;
  });
});
after(async () => { await app?.close(); });

// Read, change and save the data through the API (the page is reloaded afterwards by app.open).
async function mutate(change) {
  const request = app.page.context().request;
  const loaded = await (await request.get(app.base + '/api/data')).json();
  const data = change(loaded.data) || loaded.data;
  const res = await request.post(app.base + '/api/save', { data: { state: { ...loaded, data }, baseRevision: loaded.revision } });
  assert.equal(res.status(), 200, await res.text());
}
const as = async (memberId, hash = 'customers') => {
  await mutate((data) => { data.laiSettings.roles.current = memberId; });
  await app.open(hash);
  await app.page.waitForTimeout(300);
};
const settle = (ms = 400) => app.page.waitForTimeout(ms);
const bodyText = () => app.page.locator('body').innerText();
const openDetail = async (name = CLIENT) => {
  const url = new URL(app.page.url());
  url.searchParams.set('customer', name);
  url.hash = 'customers';
  await app.page.goto(url.toString());
  await app.page.waitForLoadState('networkidle');
  await app.page.locator('.lcd-root').waitFor();
};
const go = async (route) => {
  await app.page.evaluate((target) => { const b = document.createElement('button'); b.dataset.laiRoute = target; document.body.appendChild(b); b.click(); b.remove(); }, route);
  await settle(600);
};
const csNav = () => app.page.locator('.cs-nav [data-cs-tab]');
const openCustomerSettings = async () => {
  await app.page.locator('.subnav .nav-row:has(.nav-label:text-is("客户设置"))').click();
  await settle(500);
};

test('a new customer gets the default owner and default currency from the settings', async () => {
  await as('m-kris');
  await app.page.locator('[data-action="create-menu"]').click();
  await app.page.locator('.popover [data-action="new"]').click();
  await app.page.locator('#customer-form').waitFor();
  assert.equal(await app.page.locator('#customer-form [name="owner"]').inputValue(), 'Dana', '默认跟进人 prefilled');
  assert.equal(await app.page.locator('#customer-form [name="currency"]').inputValue(), 'EUR', '默认币种 prefilled');
  await app.page.locator('[data-action="close-modal"]').first().click();
  // An existing customer keeps what it has stored (nothing stored: the default is shown, never another customer's value).
  await app.page.locator('.company-link', { hasText: 'Northwind Lash Studio' }).click();
  await app.page.locator('.lcd-root [data-action="edit"]').first().click();
  await app.page.locator('#customer-form').waitFor();
  assert.notEqual(await app.page.locator('#customer-form [name="owner"]').inputValue(), 'Dana', 'an edit keeps the stored owner');
  assert.deepEqual(app.errors, []);
});

test('a 本人 account creating a customer is the owner, whatever the default owner says', async () => {
  await as('m-amy');
  await app.page.locator('[data-action="create-menu"]').click();
  await app.page.locator('.popover [data-action="new"]').click();
  await app.page.locator('#customer-form').waitFor();
  assert.equal(await app.page.locator('#customer-form [name="owner"]').inputValue(), 'Amy');
});

test('the 商机和订单 tab shows 业务 only her own orders and opportunities; the administrator sees both', async () => {
  await as('m-amy');
  await openDetail();
  await app.page.locator('.lcd-tabs [data-tab="trade"]').click();
  await settle();
  let text = await app.page.locator('.lcd-root').innerText();
  assert.ok(text.includes('L-Amy') && !text.includes('L-Kris'), 'only her order');
  const oppOwners = await app.page.locator('.lcd-opportunity-table tbody tr td:last-child').allInnerTexts();
  assert.deepEqual(oppOwners.map((t) => t.trim()), ['Amy'], 'only her opportunity');
  assert.match(text, /共 1 条/);
  assert.match(text, /销售订单 \(1\)/);
  assert.equal(await app.page.locator('.lcd-side-card [data-lai-order]').count(), 1, 'the side card is scoped too');
  // Her own order still opens from the detail page.
  await app.page.locator('.lcd-tabs-card [data-lai-order]').first().click();
  await settle(700);
  assert.match(await bodyText(), /L-Amy/);
  assert.deepEqual(app.errors, []);

  await as('m-kris');
  await openDetail();
  await app.page.locator('.lcd-tabs [data-tab="trade"]').click();
  await settle();
  text = await app.page.locator('.lcd-root').innerText();
  assert.ok(text.includes('L-Amy') && text.includes('L-Kris'));
  const owners = await app.page.locator('.lcd-opportunity-table tbody tr td:last-child').allInnerTexts();
  assert.deepEqual(owners.map((t) => t.trim()).sort(), ['Amy', 'Kris']);
});

test('a role without 订单查看 / 商机查看 gets no 商机和订单 tab, no order links and cannot open an order from the detail', async () => {
  await as('m-nov');
  await openDetail();
  assert.equal(await app.page.locator('.lcd-tabs [data-tab="trade"]').count(), 0, 'the tab is gone');
  assert.equal(await app.page.locator('[data-lai-order]').count(), 0);
  assert.equal(await app.page.locator('.lcd-opportunity').count(), 0, 'the in-progress opportunity card is gone');
  const text = await app.page.locator('.lcd-root').innerText();
  assert.ok(!text.includes('L-Amy') && !text.includes('L-Kris'));
  // Even a stale button cannot open the order page.
  await app.page.evaluate((id) => { const b = document.createElement('button'); b.dataset.laiOrder = id; document.querySelector('.lcd-root').appendChild(b); b.click(); }, 'order-a');
  await settle(600);
  assert.ok(await app.page.locator('.lcd-root').count() > 0, 'stays on the customer');
  assert.match(await app.page.locator('#toast').innerText(), /订单/);
  assert.deepEqual(app.errors, []);
});

test('客户设置 opens for a role holding only 判重设置, with only that tab', async () => {
  await as('m-dee');
  await openCustomerSettings();
  assert.equal(await app.page.locator('.cs-page').count(), 1, 'the page opened');
  assert.deepEqual(await csNav().allInnerTexts(), ['判重设置']);
  assert.equal(await app.page.locator('.cs-shortcuts').count(), 0, 'the shortcut row belongs to 客户设置');
  // Saving on its own tab works: switch 座机 to 判重 and save.
  await app.page.locator('[data-cs-form="dedupe"] input[name="dedupe:landline"][value="allow"]').check();
  await app.page.locator('[data-cs-form="dedupe"] button[type="submit"]').click();
  await app.page.locator('#toast.show', { hasText: '已保存' }).waitFor();
  const saved = (await app.readData()).laiSettings.customerSettings.dedupe;
  assert.equal(saved.landline, 'allow');
  assert.deepEqual(app.errors, []);
});

test('客户设置 shows 业务 (来源设置 only) just that tab', async () => {
  await as('m-amy');
  await openCustomerSettings();
  assert.deepEqual(await csNav().allInnerTexts(), ['来源设置']);
  await app.page.locator('[data-cs-form="add-source"] input[name="name"]').first().fill('展会');
  await app.page.locator('[data-cs-form="add-source"] button[type="submit"]').first().click();
  await app.page.locator('#toast.show', { hasText: '已保存' }).waitFor();
  assert.ok(JSON.stringify((await app.readData()).laiSettings.customerSettings).includes('展会'));
  assert.deepEqual(app.errors, []);
});

test('客户设置 keeps every tab for the administrator, and 客户查重 names the fields really compared', async () => {
  await as('m-kris');
  await openCustomerSettings();
  assert.ok((await csNav().count()) > 10);
  await app.page.locator('.subnav .nav-row:has(.nav-label:text-is("客户查重"))').click();
  await settle(500);
  const note = await app.page.locator('.module-note').first().innerText();
  assert.match(note, /完全相同的邮箱、电话、客户编号或座机查找疑似重复客户/, '座机 was switched on by the previous test');
});

test('clicking on the product page is not blocked by the 客户设置 permission', async () => {
  await as('m-pat', 'products');
  await go('products');
  assert.equal(await app.page.locator('.cs-page').count(), 1, 'the product page reuses the cs-page style');
  await app.page.locator('[data-prod-tab="groups"]').click();
  await settle();
  assert.equal(await app.page.locator('[data-prod-tab="groups"].active').count(), 1, 'the tab switched');
  assert.ok(!/客户设置/.test(await app.page.locator('#toast').innerText()), 'no misleading toast about 客户设置');
  assert.deepEqual(app.errors, []);
});

test('the 客户回收站 page opens only for a role that may move customers to the trash', async () => {
  await as('m-nov');
  await app.page.evaluate(() => { const b = document.createElement('button'); b.dataset.laiScreen = 'trash'; document.body.appendChild(b); b.click(); b.remove(); });
  await settle(600);
  assert.match(await bodyText(), /没有“客户·移入回收站”权限/);
  assert.equal(await app.page.locator('.module-table-wrap').count(), 0, 'the trash table is not drawn');
  await as('m-kris');
  await app.page.evaluate(() => { const b = document.createElement('button'); b.dataset.laiScreen = 'trash'; document.body.appendChild(b); b.click(); b.remove(); });
  await settle(600);
  assert.equal(await app.page.locator('.module-table-wrap').count(), 1);
  assert.deepEqual(app.errors, []);
});
