// 产品 module in the real page with the real backend: groups, specs, field settings, create/edit/delete, reload.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

let app;
before(async () => { app = await startApp(); await app.open('customers'); await openProducts(); });
after(async () => { await app?.close(); });

const openProducts = async () => {
  await app.page.locator('.rail-item[data-rail-menu="交易"]').click();
  await app.page.locator('.subnav .nav-row:has(.nav-label:text-is("产品"))').click();
  await app.page.locator('[data-prod-panel]').waitFor();
};
const settle = (ms = 350) => app.page.waitForTimeout(ms);
const tab = async (id) => { await app.page.locator(`[data-prod-tab="${id}"]`).click(); await settle(); };
const settings = async () => (await app.readData()).laiSettings.productSettings;
const products = async () => (await app.readData()).laiProducts || [];

test('the 产品 entry sits under 交易 and starts empty', async () => {
  const { page } = app;
  assert.equal(await page.locator('.cs-empty').first().innerText().then((t) => t.includes('还没有产品')), true);
  assert.deepEqual(await page.locator('[data-prod-tab]').allInnerTexts(), ['产品列表', '产品分组', '同步', '产品字段', '规格管理', '布局']);
});

test('groups and specs can be created, a product uses them, and in-use ones cannot be deleted', async () => {
  const { page } = app;
  await tab('groups');
  await page.locator('[data-prod-form="group-add"]:not([data-parent]) input').fill('睫毛');
  await page.locator('[data-prod-form="group-add"]:not([data-parent]) button[type=submit]').click();
  await page.locator('.cs-group', { hasText: '睫毛' }).waitFor();
  await page.locator('[data-prod-sub]').first().click();
  await page.locator('[data-prod-form="group-add"][data-parent] input').fill('单根');
  await page.locator('[data-prod-form="group-add"][data-parent] button[type=submit]').click();
  await page.locator('.cs-child', { hasText: '单根' }).waitFor();
  await tab('specs');
  await page.locator('[data-prod-form="spec-add"] input').fill('颜色');
  await page.locator('[data-prod-form="spec-add"] button[type=submit]').click();
  await page.locator('.cs-group', { hasText: '颜色' }).waitFor();
  await page.locator('[data-prod-form="value-add"] input').fill('黑色');
  await page.locator('[data-prod-form="value-add"] button[type=submit]').click();
  await page.locator('.cs-chip', { hasText: '黑色' }).waitFor();
  assert.deepEqual((await settings()).groups[0].children.map((c) => c.name), ['单根']);
  assert.deepEqual((await settings()).specs[0].values, ['黑色']);

  await tab('list');
  await page.locator('[data-prod-action="new"]').click();
  await settle();
  await page.locator('#product-form [name="name"]').fill('云朵睫毛');
  await page.locator('#product-form [name="code"]').fill('LASH-01');
  await page.locator('#product-form [name="group"]').selectOption('睫毛 / 单根');
  await page.locator('#product-form [name="spec:颜色"]').selectOption('黑色');
  await page.locator('button[type="submit"][form="product-form"]').click();
  await settle();
  const saved = await products();
  assert.equal(saved.length, 1);
  assert.deepEqual([saved[0].name, saved[0].group, saved[0].specs], ['云朵睫毛', '睫毛 / 单根', [{ type: '颜色', value: '黑色' }]]);

  await tab('groups');
  await page.locator('.cs-child', { hasText: '单根' }).getByRole('button', { name: '删除' }).click();
  await page.locator('#prod-error.visible').waitFor();
  assert.match(await page.locator('#prod-error').innerText(), /1 个产品/);
  await tab('specs');
  await page.locator('[data-prod-value-remove]').click();
  await page.locator('#prod-error.visible').waitFor();
  assert.match(await page.locator('#prod-error').innerText(), /1 个产品/);
});

test('field settings: a required field blocks saving and a hidden field leaves the form', async () => {
  const { page } = app;
  await tab('fields');
  await page.locator('[data-prod-field="model"][data-prop="required"]').check();
  await settle();
  assert.equal((await settings()).fields.model.required, true);
  await page.locator('[data-prod-field="remark"][data-prop="visible"]').uncheck();
  await settle();
  assert.equal((await settings()).fields.remark.visible, false);
  await tab('list');
  await page.locator('[data-prod-action="new"]').click();
  await settle();
  assert.equal(await page.locator('#product-form [name="remark"]').count(), 0);
  await page.locator('#product-form [name="name"]').fill('胶水');
  await page.locator('#product-form').evaluate((form) => { form.noValidate = true; });
  await page.locator('button[type="submit"][form="product-form"]').click();
  await page.locator('#product-error.visible').waitFor();
  assert.match(await page.locator('#product-error').innerText(), /请填写产品型号/);
  await page.locator('#product-form [name="model"]').fill('G-9');
  await page.locator('button[type="submit"][form="product-form"]').click();
  await settle();
  assert.equal((await products()).length, 2);
});

test('search, edit, delete (two clicks) and reload keep the data', async () => {
  const { page } = app;
  await page.locator('#prod-search').fill('G-9');
  await page.locator('#prod-search').press('Enter');
  await page.locator('#prod-search').blur();
  await settle();
  assert.equal(await page.locator('.cs-table tbody tr').count(), 1);
  await page.locator('[data-prod-action="delete"]').click();
  await settle();
  assert.equal((await products()).length, 2, 'first click only arms the delete');
  await page.locator('[data-prod-action="delete"]').click();
  await settle();
  assert.equal((await products()).length, 1);
  await app.page.reload();
  await app.page.waitForLoadState('networkidle');
  await openProducts();
  assert.equal(await page.locator('.cs-table tbody tr').count(), 1);
  assert.deepEqual(app.errors, []);
});
