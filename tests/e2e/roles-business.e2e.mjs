// 角色权限 in the business pages, in the real page with the real backend: the same data is opened as 业务 (Amy)
// and as 系统管理员 (Kris). 业务 only sees her own leads, opportunities and orders and has no delete / new / sync buttons.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { startApp } from './harness.mjs';

const require = createRequire(import.meta.url);
const B = require('../../src/business-model.js');
const O = require('../../src/opportunity-model.js');
const L = require('../../src/lead-model.js');
const NOW = '2026-10-01T00:00:00.000Z';

// Two members; `current` decides who is looking at the page.
async function start(current) {
  const app = await startApp();
  await app.open('customers');
  const ctx = app.page.context().request;
  const loaded = await (await ctx.get(app.base + '/api/data')).json();
  let data = loaded.data;
  data.laiSettings = { ...(data.laiSettings || {}), defaultOwner: current === 'm-kris' ? 'Kris' : 'Amy', roles: { roles: [], members: [{ id: 'm-kris', name: 'Kris', roleId: 'admin' }, { id: 'm-amy', name: 'Amy', roleId: 'sales' }], current } };
  for (const [id, owner] of [['a', 'Amy'], ['k', 'Kris']]) {
    data = L.upsert(data, `lead-${id}`, { name: `${owner} Lead`, owner }, { now: NOW });
    data = B.upsertOrder(data, `order-${id}`, { num: `L-${owner}`, client: `${owner} Buyer`, country: 'US', productType: 'Lash', amount: '100', currency: 'USD', paidAmount: '0', stage: 'quote', createdAt: '2026-10-01', owner, isDraft: false, items: [] });
    data = O.upsert(data, `opp-${id}`, { client: `${owner} Buyer`, amount: '10', currency: 'USD', owner, stage: 'open', endDate: '2026-11-05' }, { now: NOW, today: '2026-10-01' });
  }
  const res = await ctx.post(app.base + '/api/save', { data: { state: { ...loaded, data }, baseRevision: loaded.revision } });
  assert.equal(res.status(), 200, await res.text());
  await app.open('customers');
  return app;
}
const settle = (app, ms = 400) => app.page.waitForTimeout(ms);
// 和页面里 data-lai-route 按钮一样的跳转（不依赖左侧菜单有没有这一项）。
const go = async (app, route) => {
  await app.page.evaluate((target) => { const b = document.createElement('button'); b.dataset.laiRoute = target; document.body.appendChild(b); b.click(); b.remove(); }, route);
  await settle(app, 600);
};
const count = (app, selector) => app.page.locator(selector).count();
const body = (app) => app.page.locator('body').innerText();

test('业务 (Amy) sees only her own records and has no delete, new or sync buttons', async () => {
  const app = await start('m-amy');
  try {
    const { page } = app;
    await go(app, 'leads');
    assert.equal(await count(app, '.lead-table tbody tr'), 1);
    let text = await body(app);
    assert.ok(text.includes('Amy Lead') && !text.includes('Kris Lead'));
    await page.locator('.lead-table [data-lead-action="open"]').first().click();
    await settle(app);
    assert.equal(await count(app, '.lead-detail-actions [data-lead-action="edit"]'), 1);
    assert.equal(await count(app, '.lead-detail-actions [data-lead-action="trash"]'), 0, '线索没有删除按钮');
    await page.locator('[data-action="close-modal"]').first().click();

    await go(app, 'opportunities');
    assert.equal(await count(app, '.opp-card'), 1);
    text = await body(app);
    assert.ok(text.includes('Amy') && !text.includes('Kris'), '看板只有 Amy 的商机');
    await page.locator('.opp-card [data-opp-action="menu"]').first().click();
    await settle(app);
    assert.equal(await count(app, '[data-opp-action="edit"]'), 1);
    assert.equal(await count(app, '[data-opp-action="archive"]'), 1);
    assert.equal(await count(app, '[data-opp-action="delete"]'), 0, '商机没有删除按钮');
    await page.locator('[data-action="close-modal"]').first().click();
    await settle(app);

    await go(app, 'opp-analysis');
    text = await body(app);
    assert.ok(!text.includes('Kris'), '商机分析也只算自己的');

    await go(app, 'order-list');
    text = await body(app);
    assert.ok(text.includes('L-Amy') && !text.includes('L-Kris'), '订单只有自己的');
    assert.equal(await count(app, '[data-biz-action="archive-order"]'), 0, '订单没有归档（删除）按钮');
    assert.match(text, /共 1 笔订单/);

    await go(app, 'products');
    assert.equal(await count(app, '[data-prod-action="new"]'), 0, '产品没有新建');
    assert.equal(await count(app, '[data-prod-tab="sync"]'), 0, '产品没有同步');
    assert.equal(await count(app, '[data-prod-tab="groups"]'), 0, '产品没有设置页签');

    await go(app, 'settings');
    assert.equal(await count(app, '#biz-settings-form'), 0);
    assert.match(await page.locator('.role-blocked strong').innerText(), /没有“设置/);

    await go(app, 'opp-flows');
    assert.equal(await count(app, '.opp-set'), 0);
    assert.match(await page.locator('.role-blocked strong').innerText(), /商机设置/);

    await go(app, 'dashboard');
    text = await body(app);
    assert.ok(!text.includes('本月成交') && !text.includes('经营统计'), '工作台没有团队目标（本月成交、经营统计）');
    assert.ok(!text.includes('Kris'), '工作台只算自己的');
    assert.deepEqual(app.errors.filter((error) => !error.includes('/api/mail/')), [], '工作台读邮件时没绑定邮箱的 409 不算');
  } finally { await app.close(); }
});

test('系统管理员 (Kris) sees everything and keeps every button', async () => {
  const app = await start('m-kris');
  try {
    const { page } = app;
    await go(app, 'leads');
    assert.equal(await count(app, '.lead-table tbody tr'), 2);
    await page.locator('.lead-table [data-lead-action="open"]').first().click();
    await settle(app);
    assert.equal(await count(app, '.lead-detail-actions [data-lead-action="trash"]'), 1);
    await page.locator('[data-action="close-modal"]').first().click();

    await go(app, 'opportunities');
    assert.equal(await count(app, '.opp-card'), 2);
    await page.locator('.opp-card [data-opp-action="menu"]').first().click();
    await settle(app);
    assert.equal(await count(app, '[data-opp-action="delete"]'), 1);
    await page.locator('[data-action="close-modal"]').first().click();

    await go(app, 'order-list');
    const text = await body(app);
    assert.ok(text.includes('L-Amy') && text.includes('L-Kris'));
    assert.equal(await count(app, '[data-biz-action="archive-order"]'), 2);

    await go(app, 'products');
    assert.equal(await count(app, '[data-prod-action="new"]'), 1);
    assert.equal(await count(app, '[data-prod-tab="sync"]'), 1);

    await go(app, 'settings');
    assert.equal(await count(app, '#biz-settings-form'), 1);
    assert.deepEqual(app.errors.filter((error) => !error.includes('/api/mail/')), [], '工作台读邮件时没绑定邮箱的 409 不算');
  } finally { await app.close(); }
});
