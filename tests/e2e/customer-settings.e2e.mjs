// Browser end-to-end test: 客户设置 (客户分组/阶段/类型/建档黑名单/客户上限/查重展示/布局) with real saves.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

let app;
before(async () => { app = await startApp(); await app.open('customers'); });
after(async () => { await app?.close(); });

const settle = (ms = 400) => app.page.waitForTimeout(ms);
const openSettings = async () => {
  const { page } = app;
  await app.open('customers'); // a fresh page also drops any editor a previous test left open
  await page.locator('.subnav .nav-row:has(.nav-label:text-is("客户设置"))').click();
  await page.locator('.cs-page').waitFor();
};
const tab = async (id) => { await app.page.locator(`[data-cs-tab="${id}"]`).click(); await app.page.locator(`[data-cs-panel="${id}"]`).waitFor(); };
const settings = async () => (await app.readData()).laiSettings?.customerSettings || {};
const openEditor = async (name) => {
  const { page } = app;
  await page.locator('.subnav .nav-row:has(.nav-label:text-is("客户列表"))').click();
  await page.locator('tbody tr', { hasText: name }).getByText(name).first().click();
  await page.getByText('客户详情', { exact: true }).first().waitFor();
  await page.locator('[data-action="edit"]').first().click();
  await page.locator('#customer-form').waitFor();
};
const save = () => app.page.locator('button[type=submit][form="customer-form"]').first().click();
const setSelect = (name, value) => app.page.locator(`#customer-form [name="${name}"]`).selectOption(value, { force: true });

test('the settings page has seven real tabs and no placeholder entries', async () => {
  await openSettings();
  assert.deepEqual(await app.page.locator('.cs-nav button').allInnerTexts(),
    ['客户分组', '客户阶段', '客户类型', '建档黑名单', '客户上限', '客户查重', '布局设置']);
  assert.equal(await app.page.locator(".cs-page [data-feature]").count(), 0, 'no “功能入口已保留” buttons');
  assert.deepEqual(app.errors, []);
});

test('stages: add, reorder, rename, and a stage in use cannot be deleted', async () => {
  const { page } = app;
  await tab('stages');
  await page.locator('[data-cs-form="add-stages"] input').fill('试样中');
  await page.locator('[data-cs-form="add-stages"] button[type=submit]').click();
  await page.locator('.cs-row', { hasText: '试样中' }).waitFor();
  assert.ok((await settings()).stages.includes('试样中'));
  // Use it on a customer through the editor.
  await openEditor('Northwind Lash Studio');
  await setSelect('customerStage', '试样中');
  await save();
  await settle(800);
  assert.equal((await app.readData()).customers['Northwind Lash Studio'].customerStage, '试样中');
  await openSettings();
  await tab('stages');
  const row = page.locator('.cs-row', { hasText: '试样中' });
  await row.getByText('1 位客户在用').waitFor();
  await row.getByRole('button', { name: '删除' }).click();
  await page.locator('#cs-error.visible').waitFor();
  assert.match(await page.locator('#cs-error').innerText(), /1 位客户在用/);
  assert.ok((await settings()).stages.includes('试样中'), 'still there');
  // Rename flows through to the customer.
  await row.getByRole('button', { name: '改名' }).click();
  await page.locator('.cs-inline input').fill('样品确认');
  await page.locator('.cs-inline button[type=submit]').click();
  await page.locator('.cs-row', { hasText: '样品确认' }).waitFor();
  const data = await app.readData();
  assert.equal(data.customers['Northwind Lash Studio'].customerStage, '样品确认');
  assert.match(data.customers['Northwind Lash Studio'].history[0].text, /客户阶段改名/);
  assert.deepEqual(app.errors, []);
});

test('types: a customer can be given a type and it shows on the detail page', async () => {
  const { page } = app;
  await openEditor('Lumen Lash Lab');
  await setSelect('customerType', '贸易商');
  await save();
  await settle(800);
  assert.equal((await app.readData()).customers['Lumen Lash Lab'].customerType, '贸易商');
  await page.getByText('贸易商').first().waitFor();
  assert.deepEqual(app.errors, []);
});

test('groups: a two-level group can be picked in the editor, renamed and then protected from deletion', async () => {
  const { page } = app;
  await openSettings();
  await tab('groups');
  await page.locator('[data-cs-group-add=""]').click();
  await page.locator('#cs-group-form input[name=name]').fill('重点客户');
  await page.locator('button[type=submit][form="cs-group-form"]').click();
  await page.locator('.cs-group', { hasText: '重点客户' }).waitFor();
  await page.locator('.cs-group', { hasText: '重点客户' }).getByRole('button', { name: '添加子分组' }).click();
  await page.locator('#cs-group-form input[name=name]').fill('A类');
  await page.locator('button[type=submit][form="cs-group-form"]').click();
  await page.locator('.cs-child', { hasText: 'A类' }).waitFor();
  await openEditor('Maple & Moss Cosmetics');
  await setSelect('previewGroup', '重点客户 / A类');
  await save();
  await settle(800);
  assert.equal((await app.readData()).customers['Maple & Moss Cosmetics'].previewGroup, '重点客户 / A类');
  await openSettings();
  await tab('groups');
  await page.locator('.cs-group > .cs-row', { hasText: '重点客户' }).getByRole('button', { name: '编辑' }).click();
  await page.locator('#cs-group-form input[name=name]').fill('核心客户');
  await page.locator('button[type=submit][form="cs-group-form"]').click();
  await page.locator('.cs-group', { hasText: '核心客户' }).waitFor();
  assert.equal((await app.readData()).customers['Maple & Moss Cosmetics'].previewGroup, '核心客户 / A类');
  await page.locator('.cs-child', { hasText: 'A类' }).getByRole('button', { name: '删除' }).click();
  await page.locator('#cs-error.visible').waitFor();
  assert.match(await page.locator('#cs-error').innerText(), /1 位客户在“核心客户 \/ A类”里/);
  assert.deepEqual(app.errors, []);
});

test('blacklist: a blocked domain cannot be added to a customer', async () => {
  const { page } = app;
  await openSettings();
  await tab('blacklist');
  await page.locator('[data-cs-form="add-blacklist"] input').fill('@blocked.example');
  await page.locator('[data-cs-form="add-blacklist"] button[type=submit]').click();
  await page.locator('.cs-row', { hasText: '@blocked.example' }).waitFor();
  await page.locator('[data-cs-form="add-blacklist"] input').fill('not an email');
  await page.locator('[data-cs-form="add-blacklist"] button[type=submit]').click();
  await page.locator('#cs-error.visible').waitFor();
  await openEditor('Lumen Lash Lab');
  await page.locator('#customer-form [name="email"]').fill('someone@blocked.example');
  await save();
  await page.locator('#form-error.visible').waitFor();
  assert.match(await page.locator('#form-error').innerText(), /黑名单/);
  assert.notEqual((await app.readData()).customers['Lumen Lash Lab'].email, 'someone@blocked.example');
});

test('caps: a full owner cannot get another customer, and the message says why', async () => {
  const { page } = app;
  await openSettings();
  await tab('caps');
  const full = (await app.readData()).customers;
  const owned = Object.values(full).filter((c) => c.owner === 'Kris').length;
  await page.locator('input[name="defaultLimit"]').fill(String(owned));
  await page.locator('[data-cs-form="caps"] button[type=submit]').click();
  await page.locator('.cs-table .cs-full').waitFor();
  assert.equal((await settings()).caps.defaultLimit, owned);
  await page.locator('.subnav .nav-row:has(.nav-label:text-is("客户列表"))').click();
  await page.locator('[data-action="create-menu"]').first().click();
  await page.locator('[data-action="batch-create"]').click();
  await page.locator('#batch-create-form').waitFor();
  await page.locator('#batch-create-form [name="text"]').fill('Cap Test Trading，Amy，amy@captest.example');
  await page.locator('#batch-create-form [name="country"]').fill('美国');
  await page.locator('#batch-create-form [name="owner"]').fill('Kris');
  await page.locator('button[type=submit][form="batch-create-form"]').click();
  await settle(1000);
  const message = await page.locator('#batch-create-result, #workspace-error').allInnerTexts();
  assert.match(message.join(' '), /上限/);
  assert.equal((await app.readData()).customers['Cap Test Trading'], undefined);
});

test('duplicates tab and layout tab save, and the layout reaches the detail page', async () => {
  const { page } = app;
  await openSettings();
  await tab('duplicates');
  await page.locator('input[name="field"][value="owner"]').check();
  await page.locator('[data-cs-form="duplicates"] button[type=submit]').click();
  await settle(500);
  assert.deepEqual((await settings()).duplicateFields.sort(), ['country', 'owner']);
  await tab('layout');
  await page.locator('[data-cs-layout="left-large"]').click();
  await page.locator('[data-cs-layout="left-large"].active').waitFor();
  assert.equal((await settings()).layout, 'left-large');
  await page.locator('.subnav .nav-row:has(.nav-label:text-is("客户列表"))').click();
  await page.locator('tbody tr', { hasText: 'Lumen Lash Lab' }).getByText('Lumen Lash Lab').first().click();
  await page.locator('.lcd-columns[data-layout="left-large"]').waitFor();
  assert.deepEqual(app.errors.filter((e) => !/HTTP 4/.test(e)), []);
});
