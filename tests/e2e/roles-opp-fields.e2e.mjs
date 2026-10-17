// 字段权限 for 商机, in the real page with the real backend. A 业务 account whose role hides or locks some
// opportunity fields: hidden fields are absent from board, detail and form, read-only ones are disabled, and the
// stored values survive a save. A 部门管理员 sees department members' records. (The 线索 half went with D-030.)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { startApp } from './harness.mjs';

const require = createRequire(import.meta.url);
const B = require('../../src/business-model.js');
const O = require('../../src/opportunity-model.js');
const NOW = '2026-10-01T00:00:00.000Z';
const SHOT = '/tmp/claude-0/-home-claude/6da1c5b4-76a6-5a98-ae73-9564668943b5/scratchpad';

const SALES_PERMS = Object.fromEntries(['opp.view', 'opp.create', 'opp.edit', 'customer.view', 'order.view'].map((key) => [key, true]));

// Seeds opportunities / roles through the API, then opens the page as `current`.
async function start({ roles, departments, members, current, seed }) {
  const app = await startApp();
  await app.open('customers');
  const request = app.page.context().request;
  const loaded = await (await request.get(app.base + '/api/data')).json();
  let data = loaded.data;
  data.laiSettings = { ...(data.laiSettings || {}), defaultOwner: members.find((m) => m.id === current).name, roles: { roles, departments, members, current } };
  data = seed(data);
  const res = await request.post(app.base + '/api/save', { data: { state: { ...loaded, data }, baseRevision: loaded.revision } });
  assert.equal(res.status(), 200, await res.text());
  await app.open('customers');
  return app;
}
const settle = (app, ms = 400) => app.page.waitForTimeout(ms);
const go = async (app, route) => {
  await app.page.evaluate((target) => { const b = document.createElement('button'); b.dataset.laiRoute = target; document.body.appendChild(b); b.click(); b.remove(); }, route);
  await settle(app, 600);
};
const count = (app, selector) => app.page.locator(selector).count();
const body = (app) => app.page.locator('body').innerText();
const closeDialog = async (app) => { await app.page.locator('[data-action="close-modal"]').first().click(); await settle(app); };

const amyMembers = [{ id: 'm-kris', name: 'Kris', roleId: 'admin' }, { id: 'm-amy', name: 'Amy', roleId: 'sales' }];
const fieldRole = (fields, perms = SALES_PERMS) => [{ id: 'sales', name: '业务', scope: 'self', perms, v: 2, fields }];

function seedAmy(data) {
  data.customers = { ...data.customers, 'Amy Buyer': { client: 'Amy Buyer', country: 'US', owner: 'Amy', contacts: [] } };
  data = O.addCustomField(data, { name: '客户等级', type: 'text' }, { id: 'c1' });
  data = O.upsert(data, 'opp-a', { client: 'Amy Buyer', amount: '10', currency: 'USD', owner: 'Amy', stage: 'open', endDate: '2026-11-05', note: 'secret opp note', tags: 'vip', custom: { c1: 'gold' } }, { now: NOW, today: '2026-10-01' });
  return data;
}

const oppsOf = async (app) => (await app.readData()).laiOpportunities;

test('业务 with hidden and read-only opportunity fields: absent from board, detail and form, values survive a save, new records get defaults', async () => {
  const fields = { opp: { note: 'hidden', tags: 'hidden', endDate: 'read', 'custom.c1': 'read' } };
  const app = await start({ roles: fieldRole(fields), members: amyMembers, current: 'm-amy', seed: seedAmy });
  try {
    const { page } = app;
    await go(app, 'opportunities');
    assert.equal(await count(app, '.opp-card'), 1);
    assert.equal(await count(app, '.opp-card .opp-due'), 1, '结束日期只读，卡片上还显示');
    assert.match(await page.locator('#opp-search').getAttribute('placeholder'), /^搜索名称、客户、联系人$/);

    await page.locator('.opp-card [data-opp-action="detail"]').click();
    await settle(app);
    let text = await body(app);
    assert.ok(!text.includes('secret opp note') && !text.includes('vip'), '详情里没有备注和标签');
    assert.ok(text.includes('gold') && text.includes('2026-11-05'), '只读的字段还能看到');
    await closeDialog(app);

    await page.locator('.opp-card [data-opp-action="menu"]').click();
    await settle(app);
    await page.locator('[data-opp-action="edit"]').first().click();
    await settle(app);
    assert.equal(await count(app, '#opp-form [name="note"]'), 0);
    assert.equal(await count(app, '#opp-form [name="tags"]'), 0);
    assert.equal(await page.locator('#opp-form [name="endDate"]').isDisabled(), true);
    assert.equal(await page.locator('#opp-form [name="custom:c1"]').isDisabled(), true);
    assert.equal(await page.locator('#opp-form [name="amount"]').isDisabled(), false);
    await page.screenshot({ path: `${SHOT}/c2-opp-form.png` });
    await page.locator('#opp-form [name="amount"]').fill('250');
    await page.locator('button[type="submit"][form="opp-form"]').click();
    await settle(app, 700);

    const opp = (await oppsOf(app)).find((item) => item.id === 'opp-a');
    assert.equal(opp.amount, 250);
    assert.equal(opp.note, 'secret opp note', '隐藏的备注没有被清空');
    assert.deepEqual(opp.tags, ['vip'], '隐藏的标签没有被清空');
    assert.equal(opp.endDate, '2026-11-05', '只读的结束日期没有变');
    assert.deepEqual(opp.custom, { c1: 'gold' }, '只读的自定义字段没有变');

    // A new opportunity: the read-only end date is filled with the default, hidden fields stay empty.
    await page.locator('[data-opp-action="new"]').first().click();
    await settle(app);
    await page.locator('#opp-form [name="client"]').selectOption('Amy Buyer', { force: true });
    await page.locator('#opp-form [name="amount"]').fill('77');
    await page.locator('button[type="submit"][form="opp-form"]').click();
    await settle(app, 700);
    const made = (await oppsOf(app)).find((item) => item.id !== 'opp-a');
    assert.ok(made, await body(app));
    assert.equal(made.amount, 77);
    assert.match(made.endDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(made.note, '');
    assert.deepEqual(app.errors.filter((error) => !error.includes('/api/mail/')), []);
  } finally { await app.close(); }
});

test('a hidden opportunity end date leaves the list column, the date filter and the sort', async () => {
  const app = await start({ roles: fieldRole({ opp: { endDate: 'hidden' } }), members: amyMembers, current: 'm-amy', seed: seedAmy });
  try {
    await go(app, 'opportunities');
    assert.equal(await count(app, '.opp-card .opp-due'), 0);
    assert.equal(await count(app, '#opp-date-field option[value="endDate"]'), 0);
    assert.equal(await count(app, '#opp-sort option[value^="endDate"]'), 0);
    await app.page.locator('[data-opp-view="list"]:visible').first().click();
    await settle(app);
    assert.ok(!(await app.page.locator('.opp-list thead').innerText()).includes('结束日期'));
    await app.page.locator('.opp-list [data-opp-action="menu"]').click();
    await settle(app);
    await app.page.locator('[data-opp-action="edit"]').first().click();
    await settle(app);
    assert.equal(await count(app, '#opp-form [name="endDate"]'), 0);
    await app.page.locator('#opp-form [name="amount"]').fill('99');
    await app.page.locator('button[type="submit"][form="opp-form"]').click();
    await settle(app, 700);
    const opp = (await oppsOf(app)).find((item) => item.id === 'opp-a');
    assert.equal(opp.amount, 99);
    assert.equal(opp.endDate, '2026-11-05');
  } finally { await app.close(); }
});

test('a 部门管理员 sees the records of department members, not of other departments', async () => {
  const departments = [{ id: 'd1', name: '销售一部', parentId: '' }, { id: 'd2', name: '销售二部', parentId: '' }];
  const members = [
    { id: 'm-kris', name: 'Kris', roleId: 'admin' },
    { id: 'm-dan', name: 'Dan', roleId: 'deptAdmin', deptId: 'd1' },
    { id: 'm-eve', name: 'Eve', roleId: 'sales', deptId: 'd1' },
    { id: 'm-fay', name: 'Fay', roleId: 'sales', deptId: 'd2' },
  ];
  const app = await start({
    roles: [], departments, members, current: 'm-dan',
    seed(data) {
      for (const owner of ['Dan', 'Eve', 'Fay']) {
        data = B.upsertOrder(data, `order-${owner}`, { num: `L-${owner}`, client: `${owner} Buyer`, country: 'US', productType: 'Lash', amount: '100', currency: 'USD', paidAmount: '0', stage: 'quote', createdAt: '2026-10-01', owner, isDraft: false, items: [] });
        data = O.upsert(data, `opp-${owner}`, { client: `${owner} Buyer`, amount: '10', currency: 'USD', owner, stage: 'open', endDate: '2026-11-05' }, { now: NOW, today: '2026-10-01' });
      }
      return data;
    },
  });
  try {
    const { page } = app;
    await go(app, 'opportunities');
    assert.equal(await count(app, '.opp-card'), 2);
    const owners = await page.locator('#opp-owner option').allInnerTexts();
    assert.deepEqual(owners.filter((name) => name !== '全部负责人').sort(), ['Dan', 'Eve'], '负责人筛选里是能看到的人');

    await go(app, 'order-list');
    const text = await body(app);
    assert.ok(text.includes('L-Dan') && text.includes('L-Eve') && !text.includes('L-Fay'));
    assert.match(text, /共 2 笔订单/);
    assert.deepEqual(app.errors.filter((error) => !error.includes('/api/mail/')), []);
  } finally { await app.close(); }
});
