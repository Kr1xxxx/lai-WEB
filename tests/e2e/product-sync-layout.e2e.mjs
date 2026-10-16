// 产品设置里的「同步」和「布局」，用真实页面和真实后端：从表格文件同步（预览、确认、撤销），自建布局并用到产品详情和表单。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

let app;
let temp;
before(async () => {
  temp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lai-test-sync-'));
  app = await startApp();
  await app.open('customers');
  await openProducts();
});
after(async () => { await app?.close(); fs.rmSync(temp, { recursive: true, force: true }); });

const openProducts = async () => {
  await app.page.locator('.rail-item[data-rail-menu="交易"]').click();
  await app.page.locator('.subnav .nav-row:has(.nav-label:text-is("产品"))').click();
  await app.page.locator('[data-prod-panel]').waitFor();
};
const settle = (ms = 350) => app.page.waitForTimeout(ms);
const tab = async (id) => { await app.page.locator(`[data-prod-tab="${id}"]`).click(); await settle(); };
const products = async () => (await app.readData()).laiProducts || [];
const tasks = async () => (await app.readData()).laiProductSyncTasks || [];
const settings = async () => (await app.readData()).laiSettings.productSettings;
const csv = (name, text) => { const file = path.join(temp, name); fs.writeFileSync(file, text); return file; };

test('the product page has six tabs in the 小满 order', async () => {
  assert.deepEqual(await app.page.locator('[data-prod-tab]').allInnerTexts(), ['产品列表', '产品分组', '导入产品', '产品字段', '规格管理', '布局']);
});

test('sync from a CSV: preview shows 新建 2 / 更新 1, confirm writes, the task is listed, undo restores', async () => {
  const { page } = app;
  // one product that the file will update
  await page.locator('[data-prod-action="new"]').click();
  await settle();
  await page.locator('#product-form [name="name"]').fill('旧胶水');
  await page.locator('#product-form [name="code"]').fill('E-1');
  await page.locator('#product-form [name="fob"]').fill('1');
  await page.locator('#product-form [name="remark"]').fill('保留的备注');
  await page.locator('button[type="submit"][form="product-form"]').click();
  await settle();
  assert.equal((await products()).length, 1);

  await tab('sync');
  assert.match(await page.locator('.cs-empty').innerText(), /还没有导入过/);
  await page.locator('[data-prod-action="sync-open"]').click();
  await page.locator('#prod-sync-file').waitFor();
  const file = csv('products.csv', '产品名称,产品编号,离岸价,没用的列\n新睫毛,N-1,2.5,x\n新胶水,N-2,,x\n胶水新名,E-1,3,x\n,N-3,4,x\n');
  await page.locator('#prod-sync-file').setInputFiles(file);
  await page.locator('.ps-summary').waitFor();
  const summary = await page.locator('.ps-summary').innerText();
  assert.match(summary, /新建 2/);
  assert.match(summary, /更新 1/);
  assert.match(summary, /跳过 1/);
  assert.match(await page.locator('.prod-sync').innerText(), /没有用到：没用的列/);
  assert.match(await page.locator('.ps-skip').innerText(), /缺产品名称/);
  assert.equal((await products()).length, 1, 'the preview writes nothing');

  // switching to 全部新建 re-checks the same rows: the known code is skipped
  await page.locator('input[name="prod-sync-mode"][value="new"]').check();
  assert.match(await page.locator('.ps-summary').innerText(), /更新 0/);
  await page.locator('input[name="prod-sync-mode"][value="code"]').check();
  assert.match(await page.locator('.ps-summary').innerText(), /更新 1/);

  await page.locator('[data-prod-action="sync-commit"]').click();
  await settle(500);
  const after = await products();
  assert.equal(after.length, 3);
  const updated = after.find((p) => p.code === 'E-1');
  assert.deepEqual([updated.name, updated.fob, updated.remark], ['胶水新名', '3', '保留的备注']);
  const log = await tasks();
  assert.equal(log.length, 1);
  assert.deepEqual([log[0].name, log[0].status, log[0].created, log[0].updated, log[0].skipped, log[0].source], ['products.csv', '已完成', 2, 1, 1, '表格文件']);
  const row = page.locator('.cs-sync tbody tr').first();
  assert.match(await row.innerText(), /products\.csv/);
  assert.match(await row.innerText(), /已完成/);

  // undo needs a second click
  await page.locator('[data-prod-action="sync-undo"]').click();
  await settle();
  assert.equal((await products()).length, 3, 'first click only arms the undo');
  await page.locator('[data-prod-action="sync-undo"]').click();
  await settle(500);
  const back = await products();
  assert.equal(back.length, 1);
  assert.deepEqual([back[0].name, back[0].fob, back[0].remark], ['旧胶水', '1', '保留的备注']);
  assert.equal((await tasks())[0].status, '已撤销');
  assert.match(await page.locator('.cs-sync tbody tr').first().innerText(), /已撤销/);
  assert.equal(await page.locator('[data-prod-action="sync-undo"]').count(), 0);

  // reload keeps the log
  await page.reload();
  await page.waitForLoadState('networkidle');
  await openProducts();
  await tab('sync');
  assert.equal(await page.locator('.cs-sync tbody tr').count(), 1);
});

test('the template downloads as an xlsx and a bad file shows a message', async () => {
  const { page } = app;
  await page.locator('[data-prod-action="sync-open"]').click();
  await page.locator('#prod-sync-file').waitFor();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-prod-action="sync-template"]').click()]);
  // headless Chromium on Linux drops non-ASCII download names, so check the file itself: an xlsx is a zip.
  assert.equal(fs.readFileSync(await download.path()).subarray(0, 2).toString(), 'PK');
  await page.locator('#prod-sync-file').setInputFiles(csv('bad.csv', '乱七八糟\nx\n'));
  await page.locator('#prod-sync-error.visible').waitFor();
  assert.match(await page.locator('#prod-sync-error').innerText(), /认得的产品字段/);
  assert.equal(await page.locator('[data-prod-action="sync-commit"]').isDisabled(), true);
  await page.locator('[data-action="close-modal"]').first().click();
  await settle();
});

test('layout: copy the default, put 价格信息 first, use it for 产品详情; the detail drawer shows that order', async () => {
  const { page } = app;
  await tab('layouts');
  // default layout is view-only
  await page.locator('[data-prod-lay="open"][data-layout="default"]').click();
  assert.equal(await page.locator('[data-prod-lay="field-hide"]').count(), 0);
  await page.locator('[data-prod-lay="copy"][data-layout="default"]').click();
  await page.locator('[data-prod-layout-editor] [data-prod-lay="section-move"]').first().waitFor();
  const layoutName = '默认布局 副本';
  assert.equal((await settings()).layouts[0].name, layoutName);
  await page.locator('[data-prod-lay="section-move"][data-index="1"][data-delta="-1"]').click();
  await settle();
  assert.deepEqual((await settings()).layouts[0].sections.map((s) => s.name).slice(0, 2), ['价格信息', '基本信息']);
  // a field can be moved into another section with the select
  await page.locator('select[data-prod-sel="move"][data-key="size"]').selectOption({ label: '价格信息' });
  await settle();
  assert.deepEqual((await settings()).layouts[0].sections[0].fields, ['fob', 'size']);
  // a layout in use cannot be deleted
  await page.locator('select[data-prod-sel="use"][data-place="detail"]').selectOption({ label: layoutName });
  await settle();
  assert.equal((await settings()).layoutUse.detail, (await settings()).layouts[0].id);
  await page.locator('[data-prod-lay="delete"]').click();
  await page.locator('#prod-error.visible').waitFor();
  assert.match(await page.locator('#prod-error').innerText(), /先把用到它的地方换成别的布局/);

  await tab('list');
  await page.locator('[data-prod-action="edit"]').first().click();
  await settle();
  await page.locator('#product-form [name="size"]').fill('1*2*3');
  await page.locator('#product-form [name="fob"]').fill('7.5');
  await page.locator('button[type="submit"][form="product-form"]').click();
  await settle();
  assert.deepEqual((await products()).map((p) => [p.fob, p.size, p.remark]), [['7.5', '1*2*3', '保留的备注']]);

  // clicking the name opens the read-only detail in the layout's order; the edit button opens the form
  await page.locator('.cs-prod .company-link').first().click();
  await page.locator('[data-prod-detail]').waitFor();
  const heads = await page.locator('[data-prod-detail] .pd-section h3').allInnerTexts();
  assert.equal(heads[0], '价格信息');
  assert.ok(heads.indexOf('基本信息') > 0);
  assert.deepEqual(await page.locator('[data-prod-detail] .pd-section').first().locator('dt').allInnerTexts(), ['离岸价', '产品尺寸(长*宽*高cm)']);
  assert.match(await page.locator('[data-prod-detail]').innerText(), /7\.5/);
  assert.equal(await page.locator('[data-prod-detail] input, [data-prod-detail] textarea').count(), 0, 'read-only');
  await page.locator('.drawer-footer [data-prod-action="edit"]').click();
  await page.locator('#product-form').waitFor();
  assert.equal(await page.locator('#product-form [name="name"]').inputValue(), '旧胶水');
  // the form still uses the default layout: 基本信息 comes first
  assert.equal(await page.locator('#product-form legend').first().innerText(), '基本信息');
  await page.locator('[data-action="close-modal"]').first().click();
  await settle();
});

test('layout used by the form: the form follows it, and a required field cannot be hidden there', async () => {
  const { page } = app;
  await tab('layouts');
  await page.locator('select[data-prod-sel="use"][data-place="form"]').selectOption({ label: '默认布局 副本' });
  await settle();
  await tab('list');
  await page.locator('[data-prod-action="new"]').click();
  await settle();
  assert.equal(await page.locator('#product-form legend').first().innerText(), '价格信息');
  await page.locator('[data-action="close-modal"]').first().click();
  await settle();

  await tab('fields');
  await page.locator('[data-prod-field="model"][data-prop="required"]').check();
  await settle();
  await tab('layouts');
  // the copy's editor stays open between tabs; open it only if it is closed
  if (!(await page.locator('[data-prod-layout-editor]').count())) await page.locator('[data-prod-lay="open"]:not([data-layout="default"])').click();
  await page.locator('[data-prod-lay="field-hide"][data-key="model"]').click();
  await page.locator('#prod-error.visible').waitFor();
  assert.match(await page.locator('#prod-error').innerText(), /“产品型号”是必填字段，新建\/编辑用的布局里不能隐藏/);
  // an optional field can be hidden; the edit form then keeps its old value
  await page.locator('[data-prod-lay="field-hide"][data-key="remark"]').click();
  await settle();
  await tab('list');
  await page.locator('[data-prod-action="edit"]').first().click();
  await settle();
  assert.equal(await page.locator('#product-form [name="remark"]').count(), 0);
  await page.locator('#product-form [name="model"]').fill('M-1');
  await page.locator('button[type="submit"][form="product-form"]').click();
  await settle();
  const [saved] = await products();
  assert.deepEqual([saved.model, saved.remark], ['M-1', '保留的备注']);
  assert.deepEqual(app.errors, []);
});
