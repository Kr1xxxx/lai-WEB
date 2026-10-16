// 客户自定义字段和必填（客户设置 → 字段设置）in the real page with the real backend: add fields, fill them in the
// editor and see them on the detail page; make 联系人邮箱 required and fail to save without it; 批量建档 is not checked;
// a 业务 account with a hidden custom field does not see it.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

const require = createRequire(import.meta.url);
const R = require('../../src/role-model.js');

let app;
const MAPLE = 'Maple & Moss Cosmetics';
const LUMEN = 'Lumen Lash Lab';
const shot = (name) => (process.env.SHOT_DIR ? { path: `${process.env.SHOT_DIR}/${name}.png` } : undefined);

before(async () => {
  app = await startApp();
  const request = async (route, init) => app.api(route, init);
  const state = await (await request('/api/data')).json();
  state.data.laiSettings = { ...(state.data.laiSettings || {}), defaultOwner: 'Kris' };
  state.data.customers[MAPLE].owner = 'Amy';
  // An old customer without any email: an untouched empty required field must not block its edits.
  Object.assign(state.data.customers[LUMEN], { email: '', emails: [] });
  const saved = await request('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, baseRevision: state.revision }) });
  assert.equal(saved.status, 200, await saved.text());
  await app.open('customers');
});
after(async () => { await app?.close(); });

const settle = (ms = 400) => app.page.waitForTimeout(ms);
const openSettings = async () => {
  const { page } = app;
  await app.open('customers');
  await page.locator('.subnav .nav-row:has(.nav-label:text-is("客户设置"))').click();
  await page.locator('.cs-page').waitFor();
  await page.locator('[data-cs-tab="fields"]').click();
  await page.locator('[data-cs-panel="fields"]').waitFor();
};
const openCustomer = async (name) => {
  const { page } = app;
  await app.open('customers');
  await page.locator('tbody tr', { hasText: name }).locator('.company-link').first().click();
  await page.locator('.lcd-root').waitFor();
};
const openEditor = async (name) => {
  await openCustomer(name);
  await app.page.locator('.lcd-root [data-action="edit"]').first().click();
  await app.page.locator('#customer-form').waitFor();
};
const save = () => app.page.locator('button[type=submit][form="customer-form"][value="save"]').click();
const fieldSettings = async () => (await app.readData()).laiSettings?.fieldSettings?.customer || {};
const fieldId = async (name) => (await fieldSettings()).customFields.find((f) => f.name === name).id;
const switchTo = async (label) => {
  await app.page.locator('[data-action="profile-menu"]').click();
  await app.page.locator('.popover.account-menu [data-lai-switch-member]', { hasText: label }).click();
  await app.page.locator('#toast.show', { hasText: '已切换到' }).waitFor();
  await settle();
};

test('add custom fields in 字段设置, fill them in the editor and see them on the detail page', async () => {
  const { page } = app;
  await openSettings();
  const add = page.locator('[data-cf-form="add"]');
  await add.locator('[name="name"]').fill('工厂规模');
  await add.locator('[name="type"]').selectOption('text');
  await add.locator('button[type="submit"]').click();
  await page.locator('[data-cf-rename]').first().waitFor();
  await add.locator('[name="name"]').fill('认证');
  await add.locator('[name="type"]').selectOption('multi');
  await add.locator('[name="options"]').fill('ISO, CE');
  await add.locator('button[type="submit"]').click();
  await page.locator('[data-cf-form="option"]').waitFor();
  // Options can be added and reordered; the type cannot be changed.
  await page.locator('[data-cf-form="option"] [name="option"]').fill('FDA');
  await page.locator('[data-cf-form="option"] button[type="submit"]').click();
  await page.locator('.cf-options strong', { hasText: 'FDA' }).waitFor();
  await page.locator('[data-cf-action="opt-up"][data-option="FDA"]').click();
  await settle();
  const fields = (await fieldSettings()).customFields;
  assert.deepEqual(fields.map((f) => [f.name, f.type]), [['工厂规模', 'text'], ['认证', 'multi']]);
  assert.deepEqual(fields[1].options, ['ISO', 'FDA', 'CE']);
  if (shot('custom-fields-settings')) await page.screenshot(shot('custom-fields-settings'));

  await openEditor(MAPLE);
  await page.locator('[data-custom-fields] h3', { hasText: '自定义字段' }).waitFor();
  const scale = await fieldId('工厂规模'), cert = await fieldId('认证');
  await page.locator(`[name="custom.${scale}"]`).fill('200 人');
  await page.locator(`[name="custom.${cert}"][value="CE"]`).check();
  if (shot('custom-fields-editor')) await page.screenshot(shot('custom-fields-editor'));
  await save();
  await page.locator('#toast.show', { hasText: '已保存到来财' }).waitFor();
  const custom = (await app.readData()).customers[MAPLE].custom;
  assert.deepEqual(custom, { [scale]: '200 人', [cert]: ['CE'] });
  await page.locator('.lcd-tabs [data-tab="info"]').click();
  const section = page.locator('[data-info-section="custom-fields"]');
  await section.waitFor();
  assert.match(await section.innerText(), /工厂规模\s*200 人/);
  assert.match(await section.innerText(), /认证\s*CE/);
  assert.deepEqual(app.errors, []);
});

test('make 联系人邮箱 required: clearing it blocks the save; an old empty email does not block other edits', async () => {
  const { page } = app;
  await openSettings();
  await page.locator('[data-cf-sys="email"]').check();
  await page.locator('#toast.show', { hasText: '已保存到来财' }).waitFor();
  assert.equal((await fieldSettings()).required.email, true);

  await openEditor(MAPLE);
  const before = (await app.readData()).customers[MAPLE].email;
  await page.locator('#ce-email-0').fill('');
  await save();
  const error = page.locator('#form-error.visible');
  await error.waitFor();
  assert.match(await error.innerText(), /请填写联系人邮箱/);
  assert.equal((await app.readData()).customers[MAPLE].email, before, 'nothing was saved');
  await page.locator('#ce-email-0').fill('owen@maplemoss.example');
  await save();
  await page.locator('#toast.show', { hasText: '已保存到来财' }).waitFor();

  // Lumen never had an email: editing another field still saves.
  await openEditor(LUMEN);
  await page.locator('#ce-website').fill('lumen.example');
  await save();
  await page.locator('#toast.show', { hasText: '已保存到来财' }).waitFor();
  assert.equal((await app.readData()).customers[LUMEN].website, 'lumen.example');
  assert.deepEqual(app.errors, []);
});

test('批量建档 is not checked against required fields', async () => {
  const { page } = app;
  await openSettings();
  await page.locator(`[data-cf-required="${await fieldId('工厂规模')}"]`).check();
  await page.locator('#toast.show', { hasText: '已保存到来财' }).waitFor();
  await app.open('customers');
  await page.locator('[data-action="create-menu"]').click();
  await page.locator('.popover [data-action="batch-create"]').click();
  await page.locator('#batch-create-form textarea[name="text"]').fill('Omega Trading Ltd，Olly，，+1 555 0101，美国');
  await page.locator('button[form="batch-create-form"]').click();
  const done = page.locator('.drawer button.primary', { hasText: '完成' });
  await done.waitFor();
  await done.click();
  const data = await app.readData();
  assert.ok(data.customers['Omega Trading Ltd'], 'created without email or 工厂规模');
  assert.deepEqual(app.errors, []);
});

test('a 业务 account with a hidden custom field does not see it in the editor or on the detail page', async () => {
  const { page } = app;
  const scale = await fieldId('工厂规模'), cert = await fieldId('认证');
  const state = await (await app.api('/api/data')).json();
  state.data = R.updateRole(state.data, 'sales', { fields: { customer: { ['custom.' + scale]: 'hidden' } } });
  const saved = await app.api('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, baseRevision: state.revision }) });
  assert.equal(saved.status, 200, await saved.text());
  await app.open('customers');
  await switchTo('Amy');
  await openCustomer(MAPLE);
  await page.locator('.lcd-tabs [data-tab="info"]').click();
  const section = page.locator('[data-info-section="custom-fields"]');
  await section.waitFor();
  assert.doesNotMatch(await section.innerText(), /工厂规模/);
  assert.match(await section.innerText(), /认证/);
  await page.locator('.lcd-root [data-action="edit"]').first().click();
  await page.locator('#customer-form').waitFor();
  assert.equal(await page.locator(`[data-custom-id="${scale}"]`).count(), 0);
  assert.equal(await page.locator(`[data-custom-id="${cert}"]`).count(), 1);
  // 工厂规模 is required but hidden for this account: saving is not blocked and the stored value is kept.
  await page.locator(`[name="custom.${cert}"][value="ISO"]`).check();
  await save();
  await page.locator('#toast.show', { hasText: '已保存到来财' }).waitFor();
  const custom = (await app.readData()).customers[MAPLE].custom;
  assert.deepEqual(custom, { [scale]: '200 人', [cert]: ['ISO', 'CE'] });
  assert.deepEqual(app.errors, []);
});
