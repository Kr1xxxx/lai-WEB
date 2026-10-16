// 角色的产品字段权限、产品编号权限、产品布局权限，以及团队数据里的“编辑目标值”“导出成员排行”，用真实页面和真实后端。
// 业务（Amy）：产品型号、计量单位只读，备注、离岸价隐藏，不能改已有产品的编号，新建/编辑和详情各用一个自己的布局。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { startApp } from './harness.mjs';

const SHOTS = process.env.SHOT_DIR || '';
const NOW = '2026-10-01T00:00:00.000Z';
const SALES_PERMS = { 'product.view': true, 'product.create': true, 'product.edit': true, 'product.codeNew': true, 'team.view': true, 'team.wall': true, 'customer.view': true };
const PRODUCT = { id: 'p1', name: '云朵睫毛', nameCn: '云朵', code: 'C-1', model: 'M-1', group: '睫毛', fob: '2.5', unit: '对', remark: '内部备注', link: 'https://example.test/p1', specs: [], createdAt: NOW, updatedAt: NOW };
const LAYOUTS = [
  { id: 'lf', name: '业务表单', sections: [{ name: '业务资料', fields: ['name', 'code', 'model', 'unit', 'remark', 'fob'] }] },
  { id: 'ld', name: '业务详情', sections: [{ name: '概览', fields: ['name', 'nameCn', 'code', 'model', 'unit', 'remark', 'fob'] }] },
];

async function start({ perms = SALES_PERMS, fields = { product: { model: 'read', unit: 'read', remark: 'hidden', fob: 'hidden' } }, layouts = { product: { form: 'lf', detail: 'ld' } } } = {}) {
  const app = await startApp();
  await app.open('customers');
  const ctx = app.page.context().request;
  const loaded = await (await ctx.get(app.base + '/api/data')).json();
  const data = loaded.data;
  data.laiProducts = [PRODUCT];
  data.laiSettings = {
    ...(data.laiSettings || {}),
    defaultOwner: 'Amy',
    productSettings: { groups: [{ id: 'g1', name: '睫毛', children: [] }], layouts: LAYOUTS },
    roles: {
      roles: [{ id: 'sales', name: '业务', scope: 'all', perms, fields, layouts, v: 2 }],
      members: [{ id: 'm-kris', name: 'Kris', roleId: 'admin' }, { id: 'm-amy', name: 'Amy', roleId: 'sales' }],
      current: 'm-amy',
    },
  };
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
const count = (app, selector) => app.page.locator(selector).count();
const shot = async (app, name) => { if (SHOTS) { await settle(app, 4500); fs.mkdirSync(SHOTS, { recursive: true }); await app.page.screenshot({ path: `${SHOTS}/${name}.png` }); } };
const products = async (app) => (await app.readData()).laiProducts || [];

test('业务: hidden / read-only product fields, read-only code, own layouts, values survive a save', async () => {
  const app = await start();
  try {
    const { page } = app;
    await go(app, 'products');
    // 列表：隐藏的离岸价没有列，型号（只读）还在
    const head = await page.locator('.cs-prod thead').innerText();
    assert.ok(head.includes('产品型号') && head.includes('计量单位'));
    assert.ok(!head.includes('离岸价'), '离岸价被隐藏');
    assert.ok(!(await page.locator('.cs-prod tbody').innerText()).includes('2.5'));

    // 详情：用角色自己的“业务详情”布局，没有隐藏的备注和离岸价，也没有布局里没放的产品分组
    await page.locator('[data-prod-action="view"]').first().click();
    await page.locator('[data-prod-detail]').waitFor();
    const detail = await page.locator('[data-prod-detail]').innerText();
    assert.ok(detail.includes('概览'), '用了“业务详情”布局');
    assert.ok(detail.includes('M-1') && detail.includes('C-1'));
    assert.ok(!detail.includes('内部备注') && !detail.includes('2.5') && !detail.includes('离岸价') && !detail.includes('产品备注'), '隐藏的字段不显示');
    assert.ok(!detail.includes('产品分组'), '布局里没有放的字段不显示');
    await shot(app, 'd2-detail-sales');
    await page.locator('[data-prod-detail]').locator('xpath=ancestor::*[contains(@class,"drawer")]').locator('[data-prod-action="edit"]').click();
    await page.locator('#product-form').waitFor();

    // 表单：用“业务表单”布局；型号、单位、编号只读；备注、离岸价不在
    const form = page.locator('#product-form');
    assert.ok((await form.innerText()).includes('业务资料'), '用了“业务表单”布局');
    assert.equal(await form.locator('[name="model"]').isDisabled(), true);
    assert.equal(await form.locator('[name="unit"]').isDisabled(), true);
    assert.equal(await form.locator('[name="code"]').isDisabled(), true, '没有“编辑产品编号（编辑产品）”');
    assert.equal(await form.locator('[name="name"]').isDisabled(), false);
    assert.equal(await count(app, '#product-form [name="remark"]'), 0);
    assert.equal(await count(app, '#product-form [name="fob"]'), 0);
    await shot(app, 'd2-form-sales');
    await form.locator('[name="name"]').fill('云朵睫毛 新');
    await page.locator('button[type="submit"][form="product-form"]').click();
    await settle(app, 600);
    const [saved] = await products(app);
    assert.equal(saved.name, '云朵睫毛 新');
    for (const key of ['code', 'model', 'unit', 'remark', 'fob', 'nameCn', 'group', 'link']) assert.equal(saved[key], PRODUCT[key], `${key} 保存后不变`);

    // 新建：有“编辑产品编号（新建产品）”，编号可以填；型号只读所以留空；隐藏字段留空
    await page.locator('[data-prod-action="new"]').click();
    await page.locator('#product-form').waitFor();
    assert.equal(await page.locator('#product-form [name="code"]').isDisabled(), false);
    await page.locator('#product-form [name="name"]').fill('新品');
    await page.locator('#product-form [name="code"]').fill('N-1');
    await page.locator('button[type="submit"][form="product-form"]').click();
    await settle(app, 600);
    const fresh = (await products(app)).find((p) => p.name === '新品');
    assert.ok(fresh);
    assert.deepEqual([fresh.code, fresh.model, fresh.unit, fresh.remark, fresh.fob], ['N-1', '', '', '', '']);
    assert.deepEqual(app.errors, []);
  } finally { await app.close(); }
});

test('业务 without the code permissions cannot type a code; with codeEdit she can change it', async () => {
  const app = await start({ perms: { ...SALES_PERMS, 'product.codeNew': false } });
  try {
    await go(app, 'products');
    await app.page.locator('[data-prod-action="new"]').click();
    await app.page.locator('#product-form').waitFor();
    assert.equal(await app.page.locator('#product-form [name="code"]').isDisabled(), true, '新建也不能填编号');
    await app.page.locator('#product-form [name="name"]').fill('没编号');
    await app.page.locator('button[type="submit"][form="product-form"]').click();
    await settle(app, 600);
    assert.equal((await products(app)).find((p) => p.name === '没编号').code, '');
  } finally { await app.close(); }
  const edit = await start({ perms: { ...SALES_PERMS, 'product.codeEdit': true } });
  try {
    await go(edit, 'products');
    await edit.page.locator('[data-prod-action="edit"]').first().click();
    await edit.page.locator('#product-form').waitFor();
    assert.equal(await edit.page.locator('#product-form [name="code"]').isDisabled(), false);
    await edit.page.locator('#product-form [name="code"]').fill('C-77');
    await edit.page.locator('button[type="submit"][form="product-form"]').click();
    await settle(edit, 600);
    assert.equal((await products(edit))[0].code, 'C-77');
  } finally { await edit.close(); }
});

test('product 布局 tab shows which roles use a layout, and a used layout cannot be deleted (as 系统管理员)', async () => {
  const app = await start();
  try {
    // 切到管理员
    const ctx = app.page.context().request;
    const loaded = await (await ctx.get(app.base + '/api/data')).json();
    loaded.data.laiSettings.roles.current = 'm-kris';
    loaded.data.laiSettings.defaultOwner = 'Kris';
    const res = await ctx.post(app.base + '/api/save', { data: { state: loaded, baseRevision: loaded.revision } });
    assert.equal(res.status(), 200, await res.text());
    await app.open('customers');
    await go(app, 'products');
    await app.page.locator('[data-prod-tab="layouts"]').click();
    await settle(app);
    const row = app.page.locator('[data-prod-layout-roles="lf"]');
    assert.match(await row.innerText(), /角色：业务（新建\/编辑产品）/);
    await app.page.locator('.cs-group:has([data-prod-layout-roles="lf"]) [data-prod-lay="delete"]').click();
    await settle(app);
    assert.match(await app.page.locator('#prod-error').innerText(), /角色“业务”正在用这个布局/);
    assert.equal((await app.readData()).laiSettings.productSettings.layouts.some((l) => l.id === 'lf'), true);
    // 管理员自己不受字段权限影响：型号能改
    await app.page.locator('[data-prod-tab="list"]').click();
    await app.page.locator('[data-prod-action="edit"]').first().click();
    await app.page.locator('#product-form').waitFor();
    assert.equal(await app.page.locator('#product-form [name="model"]').isDisabled(), false);
    assert.equal(await app.page.locator('#product-form [name="code"]').isDisabled(), false);
  } finally { await app.close(); }
});

test('目标完成情况: 设置目标值 / 新建目标 only with 编辑目标值; 导出 only with 导出成员排行', async () => {
  const goalOnly = await start({ perms: { 'team.view': true, 'team.goalEdit': true }, fields: {}, layouts: {} });
  try {
    await go(goalOnly, 'team-goals');
    assert.ok(await count(goalOnly, '[data-team-target="added"]') > 0, '有设置目标值');
    assert.equal(await count(goalOnly, '[data-team-target="new"]'), 1);
    assert.equal(await count(goalOnly, '[data-team-export]'), 0, '没有导出');
    assert.equal(await count(goalOnly, 'button[data-lai-route="team-targets"]:text-is("目标设置")'), 0, '没有目标管理的入口');
    await goalOnly.page.locator('[data-team-target="added"]').click();
    await goalOnly.page.locator('#biz-target-form').waitFor();
    await goalOnly.page.locator('#biz-target-form [name="value"]').fill('5');
    await goalOnly.page.locator('button[type="submit"][form="biz-target-form"]').click();
    await settle(goalOnly, 600);
    const targets = (await goalOnly.readData()).laiTargets || [];
    assert.deepEqual(targets.map((t) => [t.metric, Number(t.value)]), [['added', 5]]);
    assert.match(await goalOnly.page.locator('body').innerText(), /目标 5/);
  } finally { await goalOnly.close(); }

  const targetsOnly = await start({ perms: { 'team.view': true, 'team.targets': true, 'team.export': true }, fields: {}, layouts: {} });
  try {
    await go(targetsOnly, 'team-goals');
    assert.equal(await count(targetsOnly, '[data-team-target]'), 0, '只有目标管理时，这里不能设置目标值');
    assert.equal(await count(targetsOnly, '[data-team-export="board"]'), 1);
    assert.equal(await count(targetsOnly, 'button[data-lai-route="team-targets"]:text-is("目标设置")'), 1);
    await go(targetsOnly, 'team-targets');
    assert.ok(await count(targetsOnly, '[data-team-target="new"]') > 0, '目标管理页自己的新建目标还在');
    await targetsOnly.page.locator('[data-team-target="new"]').first().click();
    await targetsOnly.page.locator('#biz-target-form').waitFor();
  } finally { await targetsOnly.close(); }
});
