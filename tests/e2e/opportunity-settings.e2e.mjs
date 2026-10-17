// 商机设置 in the real page with the real backend: 输单原因, 商机字段 (custom field), then a new opportunity that uses
// 商机来源 / 商机类型 / the custom field, and its detail with the OPP- number.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

let app;
before(async () => { app = await startApp(); await app.open('customers'); });
after(async () => { await app?.close(); });

const settle = (ms = 400) => app.page.waitForTimeout(ms);
const settings = async () => (await app.readData()).laiSettings?.opportunitySettings || {};
const openSettings = async () => {
  const { page } = app;
  await page.locator('.rail-item[data-rail-menu="商机"]').click();
  await page.locator('.section-tabs .section-tab:text-is("商机设置")').click();
  await page.locator('.opp-set').waitFor();
};
const setTab = async (id) => { await app.page.locator(`[data-opp-set-tab="${id}"]`).click(); await app.page.locator(`[data-opp-set-panel="${id}"]`).waitFor(); };

test('the shared source list gets two sources (customer settings, used by 商机来源)', async () => {
  const { page } = app;
  await page.locator('.subnav .nav-row:has(.nav-label:text-is("客户设置"))').click();
  await page.locator('.cs-page').waitFor();
  await page.locator('[data-cs-tab="sources"]').click();
  await page.locator('[data-cs-panel="sources"]').waitFor();
  await page.locator('[data-cs-form="add-source"] input').fill('常规获客');
  await page.locator('[data-cs-form="add-source"] button[type=submit]').click();
  await page.locator('.cs-group', { hasText: '常规获客' }).waitFor();
  await page.locator('[data-cs-source-sub]').first().click();
  await page.locator('[data-cs-form="add-source"][data-parent] input').fill('展会');
  await page.locator('[data-cs-form="add-source"][data-parent] button[type=submit]').click();
  await page.locator('.cs-child', { hasText: '展会' }).waitFor();
});

test('商机设置 has three tabs; the flows tab is the old flows page', async () => {
  const { page } = app;
  await openSettings();
  assert.equal(await page.locator('h1').first().innerText(), '商机设置');
  assert.deepEqual(await page.locator('[data-opp-set-tab]').allInnerTexts(), ['销售流程', '输单原因', '商机字段']);
  assert.ok(await page.locator('#opp-flow-add').count(), 'flows tab keeps the flow editor');
  assert.deepEqual(await page.locator('[data-stage-rename]').evaluateAll((list) => list.map((input) => input.value)), ['未成单', '付款未到账', '待付尾款', '已完成', '输单']);
});

test('a lost reason can be added, renamed, moved and is saved', async () => {
  const { page } = app;
  await setTab('reasons');
  assert.equal(await page.locator('[data-set-rename="reasons"]').count(), 6);
  await page.locator('#opp-reasons-add input').fill('客户关系');
  await page.locator('#opp-reasons-add button[type=submit]').click();
  await page.locator('[data-set-rename="reasons"][data-key="客户关系"]').waitFor();
  assert.equal((await settings()).lostReasons.at(-1), '客户关系');
  await page.locator('#opp-reasons-add input').fill('价格原因');
  await page.locator('#opp-reasons-add button[type=submit]').click();
  await settle();
  assert.equal(await page.locator('#opp-set-error').innerText(), '已经有同名的输单原因');
  await page.locator('[data-set-action="up"][data-key="客户关系"]').click();
  await settle();
  assert.deepEqual((await settings()).lostReasons.slice(-2), ['客户关系', '其他']);
});

test('a custom 单选 field is added in 商机字段 and saved', async () => {
  const { page } = app;
  await setTab('fields');
  assert.equal(await page.locator('[data-set-field="client"][data-prop="show"]').isDisabled(), true, 'fixed fields cannot be switched off');
  await page.locator('#opp-cf-add [name="name"]').fill('付款方式');
  await page.locator('#opp-cf-add [name="type"]').selectOption('select', { force: true });
  await page.locator('#opp-cf-add [name="options"]').fill('T/T\nL/C');
  await page.locator('#opp-cf-add button[type=submit]').click();
  await page.locator('[data-cf-rename]').waitFor();
  const saved = (await settings()).customFields;
  assert.deepEqual([saved[0].name, saved[0].type, saved[0].options, saved[0].required], ['付款方式', 'select', ['T/T', 'L/C'], false]);
  // the field type 商机类型 list comes with three defaults
  assert.equal(await page.locator('[data-set-rename="types"]').count(), 3);
});

test('a new opportunity records 商机来源, 商机类型 and the custom field; its detail shows them with an OPP- number', async () => {
  const { page } = app;
  await page.locator('.section-tabs .section-tab:text-is("商机看板")').click();
  await page.locator('[data-opp-action="new"]').first().click();
  await page.locator('#opp-form').waitFor();
  await settle();
  assert.match(await page.locator('#opp-number').innerText(), /保存后自动生成/);
  await page.locator('#opp-form [name="client"]').fill('Lumen');
  await page.locator('.lai-suggestion').first().waitFor();
  await page.locator('.lai-suggestion').first().click();
  await page.waitForFunction(() => document.querySelector('#opp-form select[name="contact"]')?.options.length > 1);
  await settle(300);
  await page.locator('#opp-form [name="owner"]').fill('Amy');
  await page.locator('#opp-form [name="amount"]').fill('1200');
  await page.locator('#opp-form [name="endDate"]').evaluate((el) => { el.value = '2030-01-31'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.locator('#opp-form select[name="contact"]').selectOption({ index: 1 }, { force: true });
  await page.locator('[data-multi="sources"] input[value="常规获客 / 展会"]').check();
  await page.locator('#opp-form select[name="type"]').selectOption('样品单', { force: true });
  await page.locator('#opp-form select[name^="custom:"]').selectOption('T/T', { force: true });
  await page.locator('button[type="submit"][form="opp-form"], #opp-form button[type="submit"]').first().click();
  await settle(800);
  const [saved] = (await app.readData()).laiOpportunities;
  assert.deepEqual(saved.sources, ['常规获客 / 展会']);
  assert.equal(saved.type, '样品单');
  assert.match(saved.number, /^OPP-\d{8}-001$/);
  const fieldId = (await settings()).customFields[0].id;
  assert.deepEqual(saved.custom, { [fieldId]: 'T/T' });
  await page.locator('.opp-card-name').first().click();
  await page.locator('.opp-detail').waitFor({ timeout: 5000 });
  const text = await page.locator('.opp-detail').innerText();
  assert.match(text, /OPP-\d{8}-001/);
  for (const part of ['商机来源', '常规获客 / 展会', '商机类型', '样品单', '付款方式', 'T/T']) assert.ok(text.includes(part), part);
  assert.deepEqual(app.errors, []);
});

test('reasons in use cannot be deleted, and the lost dialog offers the new reason', async () => {
  const { page } = app;
  await page.keyboard.press('Escape');
  await settle();
  await page.locator('.opp-card-menu').first().click();
  await page.locator('[data-opp-action="move"][data-stage="lost"]').click();
  await page.locator('#opp-lost-form').waitFor();
  assert.ok((await page.locator('#opp-lost-form select[name="lostReason"] option').allInnerTexts()).includes('客户关系'));
  await page.locator('#opp-lost-form select[name="lostReason"]').selectOption('客户关系', { force: true });
  await page.locator('button[type="submit"][form="opp-lost-form"]').click();
  await settle(700);
  await openSettings();
  await setTab('reasons');
  await page.locator('[data-set-action="remove"][data-key="客户关系"]').click();
  await settle();
  assert.equal(await page.locator('#opp-set-error').innerText(), '还有 1 个商机用了这个原因，先改掉它们');
  // renaming follows the opportunity
  const input = page.locator('[data-set-rename="reasons"][data-key="客户关系"]');
  await input.fill('关系问题');
  await input.press('Enter');
  await settle(700);
  assert.equal((await app.readData()).laiOpportunities[0].lostReason, '关系问题');
  assert.deepEqual(app.errors, []);
});
