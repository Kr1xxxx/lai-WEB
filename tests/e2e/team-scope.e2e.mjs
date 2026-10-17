// 团队数据按账号的可见范围显示（D-022）：业务 Amy（本人）只看到自己的数字、排行、目标和明细；系统管理员看到全部。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startApp } from './harness.mjs';

const now = new Date();
const MONTH = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const DAY = `${MONTH}-05`;
const PERMS = { 'team.view': true, 'team.wall': true, 'team.export': true, 'customer.view': true, 'order.view': true };
const customer = (owner) => ({ owner, source: '展会', createdAt: DAY, history: [{ type: 'followup', time: DAY, text: '跟进' }] });
const order = (id, client, owner, amount) => ({ id, num: id.toUpperCase(), client, owner, amount, paidAmount: 0, currency: 'USD', stage: 'quote', orderMonth: MONTH, createdAt: DAY });

async function start(current) {
  const app = await startApp();
  await app.open('customers');
  const ctx = app.page.context().request;
  const loaded = await (await ctx.get(app.base + '/api/data')).json();
  const data = loaded.data;
  data.customers = { 'Amy Client': customer('Amy'), 'Bob Client': customer('Bob'), 'Orphan Client': customer('') };
  data.orders = [order('a1', 'Amy Client', 'Amy', 100), order('b1', 'Bob Client', 'Bob', 5000), order('u1', 'Orphan Client', '', 7)];
  data.laiTasks = [];
  data.laiTargets = [
    { metric: 'orders', period: MONTH, owner: null, value: 99 },
    { metric: 'added', period: MONTH, owner: 'Amy', value: 4 },
    { metric: 'added', period: MONTH, owner: 'Bob', value: 6 },
  ];
  data.laiSettings = {
    ...(data.laiSettings || {}),
    roles: {
      roles: [{ id: 'sales', name: '业务', scope: 'self', perms: PERMS, fields: {}, layouts: {}, v: 2 }],
      members: [{ id: 'm-kris', name: 'Kris', roleId: 'admin' }, { id: 'm-amy', name: 'Amy', roleId: 'sales' }, { id: 'm-bob', name: 'Bob', roleId: 'sales' }],
      current,
    },
  };
  const res = await ctx.post(app.base + '/api/save', { data: { state: { ...loaded, data }, baseRevision: loaded.revision } });
  assert.equal(res.status(), 200, await res.text());
  await app.open('customers');
  return app;
}
const go = async (app, route) => {
  await app.page.evaluate((target) => { const b = document.createElement('button'); b.dataset.laiRoute = target; document.body.appendChild(b); b.click(); b.remove(); }, route);
  await app.page.waitForTimeout(600);
};
const body = (app) => app.page.locator('body').innerText();

test('业务 Amy (本人): every 团队数据 view shows only her own figures', async () => {
  const app = await start('m-amy');
  try {
    for (const route of ['team-goals', 'team-wall', 'team-assets', 'team-followups', 'team-tasks', 'team-orders']) {
      await go(app, route);
      const text = await body(app);
      assert.ok(text.includes('只显示你自己的数据'), route + ' note');
      assert.ok(!text.includes('Bob'), route + ' leaks another owner');
      assert.equal(await app.page.locator('td, li, .team-rank-name', { hasText: /^未分配$/ }).count(), 0, route + ' has an 未分配 row');
      assert.ok(!text.includes('5,000'), route + " leaks another owner's amount");
    }
    // 订单业绩：明细里只有自己的订单
    await go(app, 'team-orders');
    await app.page.locator('[data-team-detail^="tile:"]').first().click();
    const detail = await app.page.locator('.team-detail').innerText();
    assert.ok(detail.includes('Amy Client') && !detail.includes('Bob Client') && !detail.includes('Orphan Client'));
    await app.page.locator('[data-action="close-modal"]').first().click();
    // 客户资产：明细里只有自己的客户
    await go(app, 'team-assets');
    await app.page.locator('[data-team-detail="tile:customers"]').first().click();
    const assets = await app.page.locator('.team-detail').innerText();
    assert.ok(assets.includes('Amy Client') && !assets.includes('Bob Client') && !assets.includes('Orphan Client'));
    await app.page.locator('[data-action="close-modal"]').first().click();
    // 目标完成情况：只有自己的目标，没有企业目标
    await go(app, 'team-goals');
    const goals = await body(app);
    assert.ok(goals.includes('Amy') && goals.includes('我的数据'));
    assert.ok(!goals.includes('99') && !goals.includes('我的企业'));
    // 导出的排行榜只有自己
    await app.page.evaluate(() => {
      window.__exported = null;
      const original = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (blob) => { window.__exported = blob; return original(blob); };
    });
    await app.page.locator('[data-team-export="board"]').click();
    await app.page.waitForTimeout(400);
    const sheet = await app.page.evaluate(async () => {
      if (!window.__exported) return null;
      const book = window.XLSX.read(await window.__exported.arrayBuffer(), { type: 'array' });
      return JSON.stringify(window.XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1 }));
    });
    assert.ok(sheet, 'export produced a workbook');
    assert.ok(sheet.includes('Amy') && !sheet.includes('Bob') && !sheet.includes('未分配'));
    // 目标管理：只列自己的目标
    await go(app, 'team-targets');
    const targets = await body(app);
    assert.ok(!targets.includes('Bob') && !targets.includes('企业整体'));
  } finally { await app.close(); }
});

test('系统管理员 (全公司): sees everyone, 未分配 and company targets', async () => {
  const app = await start('m-kris');
  try {
    await go(app, 'team-orders');
    const orders = await body(app);
    assert.ok(orders.includes('Amy') && orders.includes('Bob') && orders.includes('未分配'));
    assert.ok(!orders.includes('只显示你自己的数据'));
    await go(app, 'team-goals');
    const goals = await body(app);
    assert.ok(goals.includes('Bob') && goals.includes('我的企业') && goals.includes('99'));
  } finally { await app.close(); }
});
