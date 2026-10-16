// 客户自定义字段进入列表、筛选、客群和导出 (CF-2) in the real page with the real backend: add a 单选 field in 字段设置,
// fill it on two customers, show it as a column, sort and filter by it (quick and advanced), build a 客群 on it, export it,
// get the delete blocked while a 客群 uses it, and check that a 业务 account with the field hidden gets no column,
// no filter, no 客群 rule field and no export column.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { startApp } from './harness.mjs';

const require = createRequire(import.meta.url);
const XLSX = require('../../vendor/sheetjs-0.20.3/xlsx.full.min.js');
const R = require('../../src/role-model.js');

let app;
const MAPLE = 'Maple & Moss Cosmetics';
const LUMEN = 'Lumen Lash Lab';
const NORTH = 'Northwind Lash Studio';
let fieldKey = '';
const shot = (name) => (process.env.SHOT_DIR ? { path: `${process.env.SHOT_DIR}/${name}.png` } : undefined);

before(async () => {
  app = await startApp();
  const state = await (await app.api('/api/data')).json();
  state.data.laiSettings = { ...(state.data.laiSettings || {}), defaultOwner: 'Kris' };
  state.data.customers[MAPLE].owner = 'Amy';
  state.data.customers[LUMEN].owner = 'Amy';
  state.data.customers[NORTH].owner = 'Kris';
  const saved = await app.api('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, baseRevision: state.revision }) });
  assert.equal(saved.status, 200, await saved.text());
  await app.open('customers');
});
after(async () => { await app?.close(); });

const settle = (ms = 400) => app.page.waitForTimeout(ms);
const rows = () => app.page.locator('tbody tr');
const names = async () => (await rows().locator('.company-link').allInnerTexts()).sort();
// The page replaces native selects with its own menu; set the hidden native one and fire the change the page listens to.
const setSelect = (selector, value) => app.page.evaluate(([sel, val]) => {
  const el = document.querySelector(sel);
  el.value = val;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}, [selector, value]);
const fieldSettings = async () => (await app.readData()).laiSettings?.fieldSettings?.customer || {};
const switchTo = async (label) => {
  await app.page.locator('[data-action="profile-menu"]').click();
  await app.page.locator('.popover.account-menu [data-lai-switch-member]', { hasText: label }).click();
  await app.page.locator('#toast.show', { hasText: '已切换到' }).waitFor();
  await settle();
};
const openSettings = async () => {
  const { page } = app;
  await app.open('customers');
  await page.locator('.subnav .nav-row:has(.nav-label:text-is("客户设置"))').click();
  await page.locator('.cs-page').waitFor();
  await page.locator('[data-cs-tab="fields"]').click();
  await page.locator('[data-cs-panel="fields"]').waitFor();
};
const openEditor = async (name) => {
  const { page } = app;
  await app.open('customers');
  await page.locator('tbody tr', { hasText: name }).locator('.company-link').first().click();
  await page.locator('.lcd-root').waitFor();
  await page.locator('.lcd-root [data-action="edit"]').first().click();
  await page.locator('#customer-form').waitFor();
};
const setChannel = async (name, value) => {
  await openEditor(name);
  await setSelect(`[name="custom.${fieldKey.slice(7)}"]`, value);
  await app.page.locator('button[type=submit][form="customer-form"][value="save"]').click();
  await app.page.locator('#toast.show', { hasText: '已保存到来财' }).waitFor();
};
const openColumns = async () => {
  const { page } = app;
  await page.locator('[data-action="table-options"]').click();
  await page.locator('[data-action="settings"]').first().click();
  await page.locator('.columns-dialog').waitFor();
};
const headers = async () => (await app.page.locator('.customer-table thead .column-label').allInnerTexts());
const cellOf = async (name, label) => {
  const index = (await headers()).indexOf(label);
  assert.ok(index >= 0, `column ${label} is shown`);
  return (await app.page.locator('tbody tr', { hasText: name }).locator('td').nth(index + 1).innerText()).trim();
};
const resetFilters = async () => {
  const reset = app.page.locator('[data-action="reset-all"]');
  if (await reset.count()) { await reset.click(); await settle(); }
};

test('add a 单选 field and fill it on two customers', async () => {
  const { page } = app;
  await openSettings();
  const add = page.locator('[data-cf-form="add"]');
  await add.locator('[name="name"]').fill('合作渠道');
  await add.locator('[name="type"]').selectOption('select');
  await add.locator('[name="options"]').fill('线上, 线下, 展会');
  await add.locator('button[type="submit"]').click();
  await page.locator('[data-cf-rename]').first().waitFor();
  const field = (await fieldSettings()).customFields.find((f) => f.name === '合作渠道');
  assert.deepEqual(field.options, ['线上', '线下', '展会']);
  fieldKey = 'custom:' + field.id;
  await setChannel(MAPLE, '线上');
  await setChannel(LUMEN, '线下');
  const data = await app.readData();
  assert.equal(data.customers[MAPLE].custom[field.id], '线上');
  assert.equal(data.customers[LUMEN].custom[field.id], '线下');
  assert.deepEqual(app.errors, []);
});

test('the field is offered in 列表字段; choosing it shows the column with the values and sorts', async () => {
  const { page } = app;
  await app.open('customers');
  await rows().first().waitFor();
  assert.ok(!(await headers()).includes('合作渠道'), 'not shown until chosen');
  await openColumns();
  assert.match(await page.locator('.columns-dialog .available-fields h4', { hasText: '自定义字段' }).innerText(), /自定义字段/);
  await page.locator(`.columns-dialog [data-column-toggle="${fieldKey}"]`).check();
  await page.locator('.columns-dialog [data-action="save-columns"]').click();
  await page.locator('.customer-table th .column-label', { hasText: '合作渠道' }).waitFor();
  assert.equal(await cellOf(MAPLE, '合作渠道'), '线上');
  assert.equal(await cellOf(LUMEN, '合作渠道'), '线下');
  assert.equal(await cellOf(NORTH, '合作渠道'), '—', 'no value shows a dash');
  const saved = (await app.readData()).previewTable.order;
  assert.ok(saved.includes(fieldKey), 'the choice is saved with the list columns');
  if (shot('custom-fields-column')) await page.screenshot(shot('custom-fields-column'));
  // Sorting: 线上 < 线下 (pinyin order), customers without a value go last.
  const header = page.locator(`.column-header[data-sort-field="${fieldKey}"]`);
  await header.click();
  await settle();
  const order = await rows().locator('.company-link').allInnerTexts();
  assert.deepEqual(order.slice(0, 2).sort(), [LUMEN, MAPLE].sort());
  const first = await cellOf(order[0], '合作渠道'), second = await cellOf(order[1], '合作渠道');
  assert.ok(first !== '—' && second !== '—');
  assert.equal(await cellOf(order.at(-1), '合作渠道'), '—');
  await header.click();
  await header.click();
  await settle();
  assert.deepEqual(app.errors, []);
});

test('quick filter: the field is in the list and picks one of its options', async () => {
  const { page } = app;
  await app.open('customers');
  await rows().first().waitFor();
  assert.equal(await page.locator(`#search-field option[value="${fieldKey}"]`).count(), 1);
  await setSelect('#search-field', fieldKey);
  await settle();
  assert.equal(await page.locator('#search').evaluate((el) => el.tagName), 'SELECT');
  assert.deepEqual(await page.locator('#search option').evaluateAll((list) => list.map((o) => o.textContent.trim())), ['请选择', '线上', '线下', '展会']);
  await setSelect('#search', '线下');
  await settle();
  assert.deepEqual(await names(), [LUMEN]);
  await setSelect('#search', '展会');
  await settle();
  assert.equal(await rows().count(), 0);
  await page.locator('[data-action="clear-query"]').click();
  await settle();
  assert.equal(await rows().count(), 4, 'clearing the value shows the whole list again');
  assert.deepEqual(app.errors, []);
});

test('advanced filter: 是其中之一 on the field, and the filter can become a 客群', async () => {
  const { page } = app;
  await app.open('customers');
  await rows().first().waitFor();
  await page.locator('[data-action="filter"]').first().click();
  await page.locator('[data-filter-mode="advanced"]').click();
  assert.equal(await page.locator(`[data-advanced-prop="field"] option[value="${fieldKey}"]`).count(), 1);
  await setSelect('[data-advanced-prop="field"]', fieldKey);
  await settle();
  assert.deepEqual(await page.locator('[data-advanced-prop="op"] option').evaluateAll((list) => list.map((o) => o.textContent.trim())), ['是其中之一', '不是其中之一', '为空', '不为空']);
  await page.locator('[data-advanced-prop="value"]').fill('线上，展会');
  await page.locator('button[type="submit"][form="filter-form"]').click();
  await settle();
  assert.deepEqual(await names(), [MAPLE]);
  await resetFilters();
  // Empty means "no 合作渠道".
  await page.locator('[data-action="filter"]').first().click();
  await page.locator('[data-filter-mode="advanced"]').click();
  await setSelect('[data-advanced-prop="field"]', fieldKey);
  await settle();
  await setSelect('[data-advanced-prop="op"]', 'empty');
  await page.locator('button[type="submit"][form="filter-form"]').click();
  await settle();
  assert.ok(!(await names()).includes(MAPLE) && !(await names()).includes(LUMEN));
  assert.equal(await rows().count(), 2, 'the other two customers have no 合作渠道');
  await resetFilters();
  assert.deepEqual(app.errors, []);
});

test('客群 rule on the field: saves, counts, lists, and the field cannot be deleted while it is used', async () => {
  const { page } = app;
  await app.open('customers');
  await rows().first().waitFor();
  await page.locator('[data-action="new-segment"]').first().click();
  await page.locator('#segment-form').waitFor();
  await page.locator('#segment-form input[name="name"]').fill('线上渠道客户');
  await setSelect('#segment-form [data-rule-prop="field"]', fieldKey);
  await settle();
  assert.deepEqual(await page.locator('#segment-form [data-rule-prop="op"] option').evaluateAll((list) => list.map((o) => o.textContent.trim())), ['是其中之一', '不是其中之一', '为空', '不为空']);
  await page.locator('#segment-form [data-rule-prop="value"]').fill('线上');
  await page.locator('#match-preview', { hasText: '当前匹配 1 个客户' }).waitFor();
  if (shot('custom-fields-segment')) await page.screenshot(shot('custom-fields-segment'));
  await page.locator('button[form="segment-form"]').click();
  const group = page.locator('.group-row', { hasText: '线上渠道客户' });
  await group.waitFor();
  assert.match(await group.innerText(), /1\s*$/);
  await group.click();
  await page.locator('.list-heading', { hasText: '线上渠道客户' }).waitFor();
  assert.deepEqual(await names(), [MAPLE]);
  const segment = (await app.readData()).previewSegments.find((s) => s.name === '线上渠道客户');
  assert.deepEqual(segment.rules.map((r) => [r.field, r.op, r.value]), [[fieldKey, 'in', '线上']]);

  await openSettings();
  const id = fieldKey.slice(7);
  await page.locator(`[data-cf-action="delete"][data-id="${id}"]`).click();
  await page.locator(`[data-cf-action="delete"][data-id="${id}"]`).click();
  await settle();
  assert.match(await page.locator('.cs-page').innerText(), /客群「线上渠道客户」的条件用到了这个字段/);
  assert.equal((await fieldSettings()).customFields.some((f) => f.id === id), true, 'the field is still there');
  assert.deepEqual(app.errors, []);
});

test('export: the chosen list columns and 全部字段 both carry the field', async () => {
  const { page } = app;
  await app.open('customers');
  await rows().first().waitFor();
  const exportRows = async (columns) => {
    await page.locator('[data-export-kind="customer"]').click();
    await page.locator('.drawer.export-dialog').waitFor();
    await page.locator(`input[name="export-columns"][value="${columns}"]`).check();
    await settle();
    assert.match(await page.locator('.export-table thead').innerText(), /合作渠道/);
    const [file] = await Promise.all([page.waitForEvent('download'), page.locator('.drawer.export-dialog [data-export-do="download"]').click()]);
    const book = XLSX.read(fs.readFileSync(await file.path()), { type: 'buffer' });
    return XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1 });
  };
  for (const columns of ['list', 'all']) {
    const table = await exportRows(columns);
    const at = table[0].indexOf('合作渠道');
    assert.ok(at > 0, columns + ' has the column');
    const byName = Object.fromEntries(table.slice(1).map((row) => [row[0], row[at]]));
    assert.equal(byName[MAPLE], '线上');
    assert.equal(byName[LUMEN], '线下');
    assert.ok(byName[NORTH] === undefined || byName[NORTH] === '', 'blank for a customer without a value');
    await page.locator('#toast.show', { hasText: '已导出' }).waitFor();
    await settle(2300);
  }
  assert.deepEqual(app.errors, []);
});

test('a 业务 account with the field hidden gets no column, filter, 客群 rule field or export column', async () => {
  const { page } = app;
  const id = fieldKey.slice(7);
  const state = await (await app.api('/api/data')).json();
  const sales = R.settings(state.data).roles.find((role) => role.id === 'sales');
  state.data = R.updateRole(state.data, 'sales', { perms: { ...sales.perms, 'customer.export': true }, fields: { customer: { ['custom.' + id]: 'hidden' } } });
  const saved = await app.api('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, baseRevision: state.revision }) });
  assert.equal(saved.status, 200, await saved.text());
  await app.open('customers');
  await switchTo('Amy');
  await app.open('customers');
  await rows().first().waitFor();
  assert.ok((await app.readData()).previewTable.order.includes(fieldKey), 'the saved list setting still names the field');
  assert.ok(!(await headers()).includes('合作渠道'), 'no column');
  assert.equal(await page.locator(`#search-field option[value="${fieldKey}"]`).count(), 0, 'no quick filter');
  // Column chooser, advanced filter and 客群 editor do not offer it.
  await openColumns();
  assert.equal(await page.locator(`.columns-dialog [data-column-toggle="${fieldKey}"]`).count(), 0);
  assert.equal(await page.locator('.columns-dialog [data-column-toggle="email"]').count(), 1);
  await page.locator('.columns-dialog [data-action="close-modal"]').first().click();
  await page.locator('[data-action="filter"]').first().click();
  await page.locator('[data-filter-mode="advanced"]').click();
  assert.equal(await page.locator(`[data-advanced-prop="field"] option[value="${fieldKey}"]`).count(), 0);
  assert.equal(await page.locator('[data-advanced-prop="field"] option[value="country"]').count(), 1);
  await page.locator('[data-action="close-modal"]').first().click();
  await page.locator('[data-action="new-segment"]').first().click();
  await page.locator('#segment-form').waitFor();
  assert.equal(await page.locator(`#segment-form [data-rule-prop="field"] option[value="${fieldKey}"]`).count(), 0);
  await page.locator('[data-action="close-modal"]').first().click();
  // Export: neither the list setting nor 全部字段 has the column.
  await page.locator('[data-export-kind="customer"]').click();
  await page.locator('.drawer.export-dialog').waitFor();
  assert.doesNotMatch(await page.locator('.export-table thead').innerText(), /合作渠道/);
  await page.locator('input[name="export-columns"][value="all"]').check();
  await settle();
  assert.doesNotMatch(await page.locator('.export-table thead').innerText(), /合作渠道/);
  assert.match(await page.locator('.export-table thead').innerText(), /公司名称/);
  if (shot('custom-fields-hidden-export')) await page.screenshot(shot('custom-fields-hidden-export'));
  assert.deepEqual(app.errors, []);
});
