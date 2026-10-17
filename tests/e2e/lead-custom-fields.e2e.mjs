// 线索自定义字段 in the real page with the real backend: add fields in 线索设置, fill them on a new lead, see them in the
// detail, find them in the export columns, edit an old lead whose new required field is empty, convert and the customer
// gets the matching field, then delete a field (the value stays in the data but is not shown).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

const require = createRequire(import.meta.url);
const L = require('../../src/lead-model.js');
const FM = require('../../src/field-model.js');

let app;
before(async () => {
  app = await startApp();
  // The customer side already has 采购量 (number): a lead value for the same name and type is carried over.
  const state = await (await app.api('/api/data')).json();
  state.data.laiSettings = { ...(state.data.laiSettings || {}), defaultOwner: 'Kris', fieldSettings: { customer: { customFields: [{ id: 'cqty', name: '采购量', type: 'number', options: [], required: false }], required: {} } } };
  const saved = await app.api('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, baseRevision: state.revision }) });
  assert.equal(saved.status, 200, await saved.text());
  await app.open('customers');
});
after(async () => { await app?.close(); });

const settle = (ms = 450) => app.page.waitForTimeout(ms);
const stored = async () => await app.readData();
const go = async (route) => {
  await app.page.evaluate((target) => { const b = document.createElement('button'); b.dataset.laiRoute = target; document.body.appendChild(b); b.click(); b.remove(); }, route);
  await settle(700);
};
const leadFields = async () => (await stored()).laiSettings.fieldSettings.lead.customFields;
const idOf = async (name) => (await leadFields()).find((field) => field.name === name).id;
async function addField({ name, type, options = '', required = false }) {
  const form = app.page.locator('[data-ls-cf-form="add"]');
  await form.locator('[name="name"]').fill(name);
  await form.locator('[name="type"]').selectOption(type);
  if (options) await form.locator('[name="options"]').fill(options);
  if (required) await form.locator('[name="required"]').check();
  await form.locator('button[type="submit"]').click();
  await settle();
}
const submitLead = async () => { await app.page.locator('button[type="submit"][form="lead-form"]').click(); await settle(); };
const closeDialog = async () => { await app.page.locator('[data-action="close-modal"]').first().click(); await settle(); };

test('线索设置 has a 自定义字段 section; fields of every type are added, renamed, reordered', async () => {
  const { page } = app;
  await go('lead-settings');
  await page.locator('[data-ls-section="custom"]').waitFor();
  assert.match(await page.locator('[data-ls-section="custom"] h2').innerText(), /自定义字段（0\/30）/);
  await addField({ name: '采购量', type: 'number' });
  await addField({ name: '客户类型', type: 'select', options: '贸易商，零售商' });
  await addField({ name: '关注品类', type: 'multi', options: '睫毛，假发，工具' });
  await addField({ name: '展会名', type: 'text', required: true });
  await addField({ name: '交期', type: 'date' });
  await addField({ name: '需求说明', type: 'textarea' });
  assert.deepEqual((await leadFields()).map((f) => [f.name, f.type, f.required]), [['采购量', 'number', false], ['客户类型', 'select', false], ['关注品类', 'multi', false], ['展会名', 'text', true], ['交期', 'date', false], ['需求说明', 'textarea', false]]);
  assert.equal((await page.locator('[data-ls-cf-field]').count()), 6);
  // A name that is already a built-in lead field is refused.
  await addField({ name: '邮箱', type: 'text' });
  assert.match(await page.locator('#ls-error').innerText(), /同名/);
  // Rename and move.
  const rename = page.locator('input[data-ls-cf-rename]').nth(5);
  await rename.fill('需求备注');
  await rename.press('Enter');
  await settle();
  assert.equal((await leadFields())[5].name, '需求备注');
  await page.locator('[data-ls-cf="up"]').nth(5).click();
  await settle();
  assert.deepEqual((await leadFields()).slice(4).map((f) => f.name), ['需求备注', '交期']);
  await page.locator('[data-ls-cf="down"]').nth(4).click();
  await settle();
  assert.deepEqual((await leadFields()).slice(4).map((f) => f.name), ['交期', '需求备注']);
  // Options: add one to the select field.
  const option = page.locator('[data-ls-cf-form="option"]').first();
  await option.locator('[name="option"]').fill('品牌商');
  await option.locator('button[type="submit"]').click();
  await settle();
  assert.deepEqual((await leadFields())[1].options, ['贸易商', '零售商', '品牌商']);
});

test('a new lead shows the fields, refuses a missing required one, and saves cleaned values', async () => {
  const { page } = app;
  await go('leads');
  await page.locator('[data-lead-action="new"]').first().click();
  await settle();
  assert.equal(await page.locator('#lead-form [data-lead-custom]').count(), 6);
  assert.deepEqual(await page.locator('#lead-form [data-lead-custom] .opp-field-label').allInnerTexts(), ['采购量', '客户类型', '关注品类', '展会名*', '交期', '需求备注']);
  const qty = await idOf('采购量'), kind = await idOf('客户类型'), cat = await idOf('关注品类'), fair = await idOf('展会名'), due = await idOf('交期');
  await page.locator('#lead-form [name="name"]').fill('Sunrise Beauty Ltd');
  await page.locator('#lead-form [name="email"]').fill('buyer@sunrise.example');
  await page.locator(`#lead-form [name="custom.${qty}"]`).fill('1200');
  await page.locator(`#lead-form [name="custom.${kind}"]`).selectOption('零售商');
  await page.locator(`#lead-form input[name="custom.${cat}"][value="睫毛"]`).check();
  await page.locator(`#lead-form input[name="custom.${cat}"][value="假发"]`).check();
  await page.locator(`#lead-form [name="custom.${due}"]`).fill('2026-12-01');
  // The browser's own check stops an empty required field; with it off, the app's message shows.
  await page.locator('#lead-form').evaluate((form) => { form.noValidate = true; form.removeAttribute('data-form-check'); });
  await submitLead();
  assert.match(await page.locator('#lead-error').innerText(), /请填写展会名/);
  await page.locator(`#lead-form [name="custom.${qty}"]`).fill('12,00');
  await page.locator(`#lead-form [name="custom.${fair}"]`).fill('广交会');
  await submitLead();
  assert.match(await page.locator('#lead-error').innerText(), /请填写数字/);
  await page.locator(`#lead-form [name="custom.${qty}"]`).fill('1200');
  await submitLead();
  const lead = (await stored()).laiLeads[0];
  assert.equal(lead.name, 'Sunrise Beauty Ltd');
  assert.deepEqual(lead.custom, { [qty]: 1200, [kind]: '零售商', [cat]: ['睫毛', '假发'], [fair]: '广交会', [due]: '2026-12-01' });
});

test('the detail shows the filled values and the required field; empty optional ones are left out', async () => {
  const { page } = app;
  await page.locator('.lead-table tbody tr .company-link').first().click();
  await settle();
  const infos = await page.locator('[data-lead-custom-infos] .lead-info').allInnerTexts();
  assert.deepEqual(infos.map((t) => t.replace(/\s+/g, ' ').trim()), ['采购量 1200', '客户类型 零售商', '关注品类 睫毛、假发', '展会名 广交会', '交期 2026-12-01']);
  await closeDialog();
});

test('the export window lists the custom fields as columns with the values', async () => {
  const { page } = app;
  await page.locator('button[data-export-kind="lead"]').click();
  await settle();
  const header = await page.locator('.export-table thead th').allInnerTexts();
  assert.deepEqual(header.slice(-6), ['采购量', '客户类型', '关注品类', '展会名', '交期', '需求备注']);
  const row = await page.locator('.export-table tbody tr').first().locator('td').allInnerTexts();
  assert.deepEqual(row.slice(-6), ['1200', '零售商', '睫毛、假发', '广交会', '2026-12-01', '']);
  await closeDialog();
});

test('an old lead whose new required field is empty can still be edited and saved', async () => {
  const { page } = app;
  // A lead made before the field becomes required (saved straight into the data, as an older version would).
  const state = await (await app.api('/api/data')).json();
  state.data.laiLeads.push({ id: 'old-lead', name: 'Old Lead Co', status: 'new', createdAt: '2026-09-01T00:00:00.000Z', history: [], trashed: false });
  const saved = await app.api('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, baseRevision: state.revision }) });
  assert.equal(saved.status, 200, await saved.text());
  await app.open('customers');
  await go('leads');
  await page.locator('.lead-table tr', { hasText: 'Old Lead Co' }).locator('.company-link').click();
  await settle();
  await page.locator('[data-lead-action="edit"]').click();
  await settle();
  const fair = await idOf('展会名');
  // Old lead: nothing filled in, the required field carries no native "required" and is not checked.
  assert.equal(await page.locator(`#lead-form [name="custom.${fair}"]`).getAttribute('required'), null);
  await page.locator('#lead-form [name="note"]').fill('老线索，只改备注');
  await submitLead();
  const old = (await stored()).laiLeads.find((item) => item.id === 'old-lead');
  assert.equal(old.note, '老线索，只改备注');
  assert.equal(old.custom, undefined);
});

test('converting copies the value into the customer field with the same name and type', async () => {
  const { page } = app;
  await go('leads');
  await page.locator('.lead-table tr', { hasText: 'Sunrise Beauty Ltd' }).locator('[data-lead-action="convert"]').click();
  await settle();
  await page.locator('#lead-convert-form [name="country"]').fill('英国');
  await page.locator('#lead-convert-form [name="source"]').fill('展会');
  await page.locator('button[type="submit"][form="lead-convert-form"]').click();
  await settle(700);
  const data = await stored();
  const customer = data.customers['Sunrise Beauty Ltd'];
  assert.deepEqual(customer.custom, { cqty: 1200 }, 'only the field that exists on the customer side with the same name and type');
  assert.equal(data.laiLeads.find((item) => item.name === 'Sunrise Beauty Ltd').status, 'converted');
  await closeDialog();
});

test('deleting a field needs a second click; the value stays in the data but leaves the detail and export', async () => {
  const { page } = app;
  await go('lead-settings');
  const fair = await idOf('展会名');
  const remove = page.locator(`[data-ls-cf-field="${fair}"] [data-ls-cf="delete"]`);
  await remove.click();
  await settle(200);
  assert.equal((await leadFields()).length, 6, 'the first click only asks');
  await remove.click();
  await settle();
  assert.equal((await leadFields()).length, 5);
  const lead = (await stored()).laiLeads.find((item) => item.name === 'Sunrise Beauty Ltd');
  assert.equal(lead.custom[fair], '广交会', 'old values stay in the data');
  await go('leads');
  await page.locator('.lead-table tr', { hasText: 'Sunrise Beauty Ltd' }).locator('[data-lead-action="open"]').first().click();
  await settle();
  assert.doesNotMatch(await page.locator('.lead-detail').innerText(), /展会名|广交会/);
  await closeDialog();
  await page.locator('button[data-export-kind="lead"]').click();
  await settle();
  assert.ok(!(await page.locator('.export-table thead th').allInnerTexts()).includes('展会名'));
  await closeDialog();
  assert.deepEqual(app.errors, []);
});

// A 业务 account: one custom field hidden, one read-only, both required (the role wins: neither is checked, hidden is not
// drawn, read-only is disabled), and what the account cannot change survives a save and stays out of the export.
test('a role that hides or locks custom fields: not drawn, not exported, stored values survive a save', async () => {
  const sales = await startApp();
  try {
    await sales.open('customers');
    const request = sales.page.context().request;
    const loaded = await (await request.get(sales.base + '/api/data')).json();
    let data = loaded.data;
    data = L.upsert(data, 'l1', { name: 'Locked Lead', owner: 'Amy' }, { now: '2026-10-01T00:00:00.000Z' });
    data.laiLeads = data.laiLeads.map((lead) => ({ ...lead, custom: { p1: 99, p2: 'A级' } }));
    for (const [id, name] of [['p1', '底价'], ['p2', '内部评级'], ['p3', '行业']]) data = FM.addField(data, 'lead', { name, type: id === 'p1' ? 'number' : 'text' }, { id });
    data = FM.setRequired(FM.setRequired(data, 'lead', 'p1', true), 'lead', 'p2', true);
    data.laiSettings = { ...data.laiSettings, defaultOwner: 'Amy', roles: {
      roles: [{ id: 'sales', name: '业务', scope: 'self', v: 2, perms: Object.fromEntries(['lead.view', 'lead.create', 'lead.edit', 'lead.export', 'customer.view'].map((key) => [key, true])), fields: { lead: { 'custom.p1': 'hidden', 'custom.p2': 'read' } } }],
      members: [{ id: 'm-kris', name: 'Kris', roleId: 'admin' }, { id: 'm-amy', name: 'Amy', roleId: 'sales' }], current: 'm-amy' } };
    const saved = await request.post(sales.base + '/api/save', { data: { state: { ...loaded, data }, baseRevision: loaded.revision } });
    assert.equal(saved.status(), 200, await saved.text());
    await sales.open('customers');
    const { page } = sales;
    await page.evaluate(() => { const b = document.createElement('button'); b.dataset.laiRoute = 'leads'; document.body.appendChild(b); b.click(); b.remove(); });
    await page.waitForTimeout(700);
    await page.locator('.lead-table [data-lead-action="open"]').first().click();
    await page.waitForTimeout(400);
    const detail = await page.locator('.lead-detail').innerText();
    assert.ok(detail.includes('A级') && !detail.includes('底价') && !detail.includes('99'));
    await page.locator('[data-lead-action="edit"]').click();
    await page.waitForTimeout(400);
    assert.equal(await page.locator('#lead-form [name="custom.p1"]').count(), 0, 'hidden');
    assert.equal(await page.locator('#lead-form [name="custom.p2"]').isDisabled(), true, 'read-only');
    await page.locator('#lead-form [name="custom.p3"]').fill('美妆');
    await page.locator('button[type="submit"][form="lead-form"]').click();
    await page.waitForTimeout(700);
    const lead = (await sales.readData()).laiLeads.find((item) => item.id === 'l1');
    assert.deepEqual(lead.custom, { p1: 99, p2: 'A级', p3: '美妆' }, 'hidden and read-only values are kept');
    await page.locator('[data-action="close-modal"]').first().click();
    await page.waitForTimeout(300);
    await page.locator('button[data-export-kind="lead"]').click();
    await page.waitForTimeout(400);
    const header = await page.locator('.export-table thead th').allInnerTexts();
    assert.ok(header.includes('内部评级') && header.includes('行业') && !header.includes('底价'));
    assert.deepEqual(sales.errors.filter((error) => !error.includes('/api/mail/')), []);
  } finally { await sales.close(); }
});
