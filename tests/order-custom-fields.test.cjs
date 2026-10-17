'use strict';
// 订单的自定义字段: settings (add / rename / move / delete / options / required), the order form, detail, save + required rules,
// export columns, the settings page section and the page assembly.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const FM = require('../src/field-model.js');
const OF = require('../src/order-fields-model.js');
const UI = require('../src/order-fields-ui.js');
const B = require('../src/business-model.js');
const EM = require('../src/export-model.js');
const EU = require('../src/export-ui.js');
const { escapeHtml } = require('../src/model.js');

const base = () => ({ laiSettings: {}, customers: {}, orders: [], trashOrders: [] });
const idOf = (state, name) => OF.customFields(state).find(field => field.name === name).id;
const order = (state, id) => state.orders.find(item => item.id === id);
const baseInput = (n, extra = {}) => ({ num: 'T-00' + n, client: 'Northwind', amount: 100, createdAt: '2026-10-01', ...extra });
const save = (state, id, input = {}) => B.upsertOrder(state, id, { ...baseInput(id), ...input });
function withFields() {
  let state = base();
  state = OF.addCustomField(state, { name: '合同号', type: 'text' });
  state = OF.addCustomField(state, { name: '采购量', type: 'number' });
  state = OF.addCustomField(state, { name: '交货日', type: 'date' });
  state = OF.addCustomField(state, { name: '付款方式', type: 'select', options: 'TT，信用证' });
  state = OF.addCustomField(state, { name: '包装', type: 'multi', options: '纸箱、托盘、木箱' });
  state = OF.addCustomField(state, { name: '特殊要求', type: 'textarea' });
  return state;
}

test('order is a field entity: the settings live under fieldSettings.order and do not touch customers', () => {
  assert.ok(FM.ENTITIES.includes('order'));
  const state = OF.addCustomField(base(), { name: '合同号', type: 'text' });
  assert.deepEqual(Object.keys(state.laiSettings.fieldSettings), ['order']);
  assert.equal(state.laiSettings.fieldSettings.order.customFields.length, 1);
  assert.deepEqual(FM.get(state, 'customer').customFields, []);
});

test('settings: every type is added, names are checked, 订单自带的名字不能用', () => {
  const state = withFields();
  assert.deepEqual(OF.customFields(state).map(f => [f.name, f.type, f.required]), [['合同号', 'text', false], ['采购量', 'number', false], ['交货日', 'date', false], ['付款方式', 'select', false], ['包装', 'multi', false], ['特殊要求', 'textarea', false]]);
  assert.deepEqual(OF.customFields(state)[3].options, ['TT', '信用证']);
  assert.throws(() => OF.addCustomField(state, { name: '  ', type: 'text' }), /请填写字段名称/);
  assert.throws(() => OF.addCustomField(state, { name: '合同号', type: 'text' }), /同名/);
  assert.throws(() => OF.addCustomField(state, { name: ' 合同号 ', type: 'number' }), /同名/);
  for (const reserved of ['订单编号', '订单金额', '币种', '物流单号', '承运商', '下一步', '订单备注', '产品', '已收款']) assert.throws(() => OF.addCustomField(state, { name: reserved, type: 'text' }), /同名/, reserved);
  assert.throws(() => OF.addCustomField(state, { name: '新的', type: 'select', options: '' }), /至少填写一个选项/);
  assert.throws(() => OF.addCustomField(state, { name: '新的', type: 'bogus' }), /选择字段类型/);
});

test('settings: rename, move, required, options (add / move / remove), delete', () => {
  let state = withFields();
  const id = idOf(state, '合同号');
  state = OF.renameCustomField(state, id, '合同编号');
  assert.equal(OF.customFields(state)[0].name, '合同编号');
  assert.throws(() => OF.renameCustomField(state, id, '订单号'), /同名/);
  assert.throws(() => OF.renameCustomField(state, id, '采购量'), /同名/);
  state = OF.moveCustomField(state, id, 1);
  assert.deepEqual(OF.customFields(state).slice(0, 2).map(f => f.name), ['采购量', '合同编号']);
  assert.throws(() => OF.moveCustomField(state, idOf(state, '采购量'), -1), /第一个/);
  state = OF.setCustomRequired(state, id, true);
  assert.equal(OF.customFields(state).find(f => f.id === id).required, true);
  state = OF.setCustomRequired(state, id, false);
  assert.equal(OF.customFields(state).find(f => f.id === id).required, false);
  const pay = idOf(state, '付款方式');
  state = OF.addFieldOption(state, pay, '预付');
  assert.throws(() => OF.addFieldOption(state, pay, ' tt '), /已经有这个选项/);
  assert.throws(() => OF.addFieldOption(state, id, 'x'), /没有选项/);
  state = OF.moveFieldOption(state, pay, '预付', -1);
  assert.deepEqual(OF.customFields(state).find(f => f.id === pay).options, ['TT', '预付', '信用证']);
  state = OF.removeFieldOption(state, pay, 'TT');
  assert.deepEqual(OF.customFields(state).find(f => f.id === pay).options, ['预付', '信用证']);
  state = OF.removeFieldOption(state, pay, '预付');
  assert.throws(() => OF.removeFieldOption(state, pay, '信用证'), /至少要留一个选项/);
  state = OF.deleteCustomField(state, id);
  assert.equal(OF.customFields(state).some(f => f.id === id), false);
  assert.throws(() => OF.deleteCustomField(state, id), /不存在/);
  assert.throws(() => FM.changeType(state, 'order', pay, 'text'), /不能修改/);
});

test('the settings rows count the orders (also the 回收站 ones) that filled a field', () => {
  let state = withFields();
  const contract = idOf(state, '合同号'), qty = idOf(state, '采购量');
  state = save(state, 'a', { custom: { [contract]: 'HT-1' } });
  state = save(state, 'b', { custom: { [contract]: 'HT-2', [qty]: '5' } });
  state = save(state, 'c', {});
  state = B.archiveOrder(state, 'b');
  const rows = OF.customRows(state);
  assert.equal(rows.find(r => r.id === contract).usage, 2);
  assert.equal(rows.find(r => r.id === qty).usage, 1);
  assert.equal(rows.find(r => r.id === contract).typeLabel, '文本');
});

test('saving: values are cleaned by type and stored in order.custom', () => {
  let state = withFields();
  const [contract, qty, due, pay, pack, note] = ['合同号', '采购量', '交货日', '付款方式', '包装', '特殊要求'].map(n => idOf(state, n));
  state = save(state, 'a', { custom: { [contract]: '  HT-9 ', [qty]: '1200.5', [due]: '2026-12-01', [pay]: ' tt ', [pack]: ['纸箱', '托盘', '纸箱'], [note]: '' } });
  assert.deepEqual(order(state, 'a').custom, { [contract]: 'HT-9', [qty]: 1200.5, [due]: '2026-12-01', [pay]: 'TT', [pack]: ['纸箱', '托盘'] });
  assert.throws(() => save(state, 'b', { custom: { [qty]: '12,00' } }), /请填写数字/);
  assert.throws(() => save(state, 'b', { custom: { [due]: '2026-02-30' } }), /有效的日期/);
  assert.throws(() => save(state, 'b', { custom: { [pay]: '现金' } }), /不在选项里/);
  assert.throws(() => save(state, 'b', { custom: { [pack]: ['纸箱', '塑料袋'] } }), /不在选项里/);
  assert.throws(() => save(state, 'b', { custom: { [contract]: 'x'.repeat(201) } }), /不能超过/);
  assert.equal(state.orders.length, 1, 'nothing was saved by the failed calls');
  // Clearing every value of an order that had values keeps an empty object; a plain new order has no custom at all.
  state = save(state, 'a', { custom: { [contract]: '', [qty]: '', [due]: '', [pay]: '', [pack]: [] } });
  assert.deepEqual(order(state, 'a').custom, {});
  state = save(state, 'plain', {});
  assert.equal('custom' in order(state, 'plain'), false);
});

test('a tiny stored number (shown as 1e-7) does not block the next save or a stage change', () => {
  let state = withFields();
  const qty = idOf(state, '采购量');
  state = save(state, 'a', { custom: { [qty]: '0.0000001' } });
  assert.equal(order(state, 'a').custom[qty], 1e-7);
  // The form shows the stored value as text; a stage change re-sends the stored custom object.
  state = save(state, 'a', { custom: { [qty]: String(order(state, 'a').custom[qty]) } });
  state = B.upsertOrder(state, 'a', { ...order(state, 'a'), stage: 'shipment' });
  assert.equal(order(state, 'a').custom[qty], 1e-7);
  // Typed scientific notation is still refused on a field that did not hold it.
  assert.throws(() => save(state, 'b', { custom: { [qty]: '1e-7' } }), /请填写数字/);
});

test('required: a new order needs it, an old order with the field still empty and untouched saves, clearing a filled one is refused', () => {
  let state = withFields();
  state = save(state, 'old', {});
  const contract = idOf(state, '合同号'), qty = idOf(state, '采购量'), pack = idOf(state, '包装');
  state = OF.setCustomRequired(OF.setCustomRequired(OF.setCustomRequired(state, contract, true), qty, true), pack, true);
  // New order: all three are needed.
  assert.throws(() => save(state, 'new', {}), /请填写合同号、采购量、包装/);
  assert.throws(() => save(state, 'new', { custom: { [contract]: 'HT', [qty]: '', [pack]: [] } }), /请填写采购量、包装/);
  const ok = save(state, 'new', { custom: { [contract]: 'HT', [qty]: '3', [pack]: ['纸箱'] } });
  assert.equal(order(ok, 'new').custom[qty], 3);
  // Old order: editing something else (with or without the empty custom values in the form) is fine.
  const renamed = save(state, 'old', { note: '改了备注', custom: { [contract]: '', [qty]: '', [pack]: [] } });
  assert.equal(order(renamed, 'old').note, '改了备注');
  assert.equal(order(save(state, 'old', { note: '再改' }), 'old').note, '再改', 'a call without custom (stage change and so on)');
  // Touching one of them to something valid is fine; the others stay untouched and empty.
  const touched = save(state, 'old', { custom: { [contract]: 'HT-2', [qty]: '', [pack]: [] } });
  assert.equal(order(touched, 'old').custom[contract], 'HT-2');
  // Clearing a filled required field is refused.
  assert.throws(() => save(ok, 'new', { custom: { [contract]: '', [qty]: '3', [pack]: ['纸箱'] } }), /请填写合同号/);
  assert.throws(() => save(ok, 'new', { custom: { [pack]: [] } }), /请填写包装/);
});

test('values the form did not send, and values of deleted fields, stay in the data', () => {
  let state = withFields();
  const contract = idOf(state, '合同号'), qty = idOf(state, '采购量');
  state = save(state, 'a', { custom: { [contract]: 'HT-1', [qty]: '7' } });
  // Only one field is sent: the other keeps its value.
  state = save(state, 'a', { custom: { [contract]: 'HT-2' } });
  assert.deepEqual(order(state, 'a').custom, { [contract]: 'HT-2', [qty]: 7 });
  // A call without custom (stage, payment, draft...) does not clear anything.
  state = save(state, 'a', { stage: 'deposit' });
  assert.deepEqual(order(state, 'a').custom, { [contract]: 'HT-2', [qty]: 7 });
  // Delete a field: the value stays, is not shown, and later saves do not drop it.
  state = OF.deleteCustomField(state, qty);
  assert.equal(order(state, 'a').custom[qty], 7);
  assert.deepEqual(OF.customView(state, order(state, 'a')).map(e => e.name), ['合同号']);
  state = save(state, 'a', { custom: { [contract]: 'HT-3', [qty]: '999' } });
  assert.equal(order(state, 'a').custom[qty], 7, 'a value of a deleted field is not rewritten by the form');
  assert.equal(order(state, 'a').custom[contract], 'HT-3');
});

test('archive and restore keep the custom values', () => {
  let state = withFields();
  const contract = idOf(state, '合同号');
  state = save(state, 'a', { custom: { [contract]: 'HT-1' } });
  state = B.restoreOrder(B.archiveOrder(state, 'a'), 'a');
  assert.equal(order(state, 'a').custom[contract], 'HT-1');
});

test('detail view: only the filled fields and the required ones, formatted', () => {
  let state = withFields();
  const [contract, qty, pay, pack] = ['合同号', '采购量', '付款方式', '包装'].map(n => idOf(state, n));
  state = OF.setCustomRequired(state, pay, true);
  state = save(state, 'a', { custom: { [contract]: 'HT-1', [qty]: '1200', [pack]: ['纸箱', '托盘'], [pay]: 'TT' } });
  assert.deepEqual(OF.customView(state, order(state, 'a')).map(e => [e.name, e.text]), [['合同号', 'HT-1'], ['采购量', '1200'], ['付款方式', 'TT'], ['包装', '纸箱、托盘']]);
  state = save(state, 'b', { custom: { [pay]: 'TT' } });
  assert.deepEqual(OF.customView(state, order(state, 'b')).map(e => [e.name, e.text]), [['付款方式', 'TT']]);
  const bare = { ...order(state, 'b'), custom: undefined };
  assert.deepEqual(OF.customView(state, bare).map(e => [e.name, e.text, e.required]), [['付款方式', '', true]], 'a required field without a value is still listed');
  const html = UI.detailMarkup(escapeHtml, OF.customView(state, bare));
  assert.ok(html.includes('data-order-custom-infos') && html.includes('付款方式') && html.includes('—'));
  assert.equal(UI.detailMarkup(escapeHtml, []), '');
  const note = idOf(state, '特殊要求');
  state = save(state, 'c', { custom: { [pay]: 'TT', [note]: '第一行\n第二行' } });
  const wide = UI.detailMarkup(escapeHtml, OF.customView(state, order(state, 'c')));
  assert.match(wide, /<div class="field-info order-custom-wide"><dt>特殊要求<\/dt><dd>第一行\n第二行<\/dd>/, 'a 多行文本 value takes the whole line and keeps its line breaks');
  assert.match(wide, /<div class="field-info"><dt>付款方式<\/dt>/);
});

test('export: custom fields are columns after the built-in ones; number / date / multi; formula guard; deleted and hidden columns are gone', () => {
  let state = withFields();
  const [contract, qty, due, pack] = ['合同号', '采购量', '交货日', '包装'].map(n => idOf(state, n));
  state = save(state, 'a', { custom: { [contract]: '=SUM(A1)', [qty]: '1200', [due]: '2026-12-01', [pack]: ['纸箱', '托盘'] } });
  state = save(state, 'b', {});
  const sheet = EM.orderRows(state.orders, { state });
  assert.deepEqual(sheet.header.slice(-6), ['合同号', '采购量', '交货日', '付款方式', '包装', '特殊要求']);
  const row = sheet.data[state.orders.findIndex(o => o.id === 'a')];
  assert.deepEqual(row.slice(-6), ['=SUM(A1)', 1200, '2026-12-01', '', '纸箱、托盘', '']);
  assert.equal(typeof row.at(-5), 'number');
  assert.match(EM.toCSV(sheet, { bom: false }), /'=SUM\(A1\)/, 'a formula-looking text gets the apostrophe');
  assert.deepEqual(sheet.data[state.orders.findIndex(o => o.id === 'b')].slice(-6), ['', '', '', '', '', '']);
  // Without state only the built-in columns.
  assert.equal(EM.orderRows(state.orders).header.includes('合同号'), false);
  // A hidden column (gate) is removed; the id is custom:<fieldId>.
  const gated = EM.orderRows(state.orders, { state, gate: { columnVisible: id => id !== 'custom:' + qty } });
  assert.equal(gated.header.includes('采购量'), false);
  assert.equal(gated.header.includes('合同号'), true);
  // A deleted field is not exported though the value is still in the data.
  const after = OF.deleteCustomField(state, qty);
  assert.equal(order(after, 'a').custom[qty], 1200);
  assert.equal(EM.orderRows(after.orders, { state: after }).header.includes('采购量'), false);
});

test('the export window passes the state so the sheet has the custom columns', () => {
  let state = withFields();
  const contract = idOf(state, '合同号');
  state = save(state, 'a', { custom: { [contract]: 'HT-1' } });
  const sheets = EU.sheetsFor('order', state.orders, { state, gate: undefined }, { format: 'xlsx' });
  assert.equal(sheets[0].header.includes('合同号'), true);
  assert.equal(sheets[0].data[0].at(-6), 'HT-1');
  assert.equal(sheets.length, 2, 'the product sheet is still there');
});

test('the settings section: add form, rows, option forms, usage, only for who may change settings', () => {
  const state = withFields();
  const ctx = (can = () => true) => ({ escape: escapeHtml, state: () => state, can, need: () => true, save: async () => {}, toast() {}, refresh() {} });
  const html = UI.settingsMarkup(ctx());
  assert.ok(html.includes('data-of-section="custom"') && html.includes('data-of-cf-form="add"'));
  assert.match(html, /订单字段（6\/30）/);
  assert.equal([...html.matchAll(/data-of-cf-rename=/g)].length, 6);
  assert.match(html, /<option value="multi">多选<\/option>/);
  assert.equal([...html.matchAll(/data-of-cf-form="option"/g)].length, 2, 'select and multi fields get an option form');
  assert.match(html, /文本 · 还没有订单填/);
  assert.match(html, /data-of-cf-rename="[^"]+" value="合同号"[^>]*style="--of-name:3"/, 'the name box is as wide as the name');
  assert.equal(UI.settingsMarkup(ctx(key => key !== 'settings.general')), '', 'no permission, no section');
  assert.match(UI.settingsMarkup({ ...ctx(), state: () => base() }), /还没有订单字段/);
});

test('the settings section: add / two-step delete / rename / required through the handlers', async () => {
  let state = withFields();
  const saved = [];
  const ctx = () => ({ escape: escapeHtml, state: () => state, can: () => true, need: () => true, save: async next => { saved.push(next); state = next; }, toast() {}, refresh() {} });
  const wait = () => new Promise(resolve => setTimeout(resolve, 5));
  const fd = new Map([['name', '客户PO'], ['type', 'text'], ['options', '']]);
  global.FormData = class { get(key) { return fd.get(key) ?? null; } has(key) { return key === 'required'; } };
  try {
    let prevented = false;
    assert.equal(UI.submit(ctx(), { target: { dataset: { ofCfForm: 'add' } }, preventDefault() { prevented = true; } }), true);
    assert.equal(prevented, true);
    await wait();
  } finally { delete global.FormData; }
  assert.equal(OF.customFields(state).at(-1).name, '客户PO');
  assert.equal(OF.customFields(state).at(-1).required, true);
  assert.equal(UI.submit(ctx(), { target: { dataset: {} }, preventDefault() {} }), false, 'other forms are left alone');
  // Delete needs a second click.
  const id = OF.customFields(state)[0].id, count = OF.customFields(state).length;
  const click = { target: { closest: selector => selector === '[data-of-cf]' ? { dataset: { ofCf: 'delete', id }, disabled: false } : null } };
  assert.equal(UI.click(ctx(), click), true);
  assert.equal(OF.customFields(state).length, count);
  assert.match(UI.settingsMarkup(ctx()), /再点一次确认删除/);
  assert.equal(UI.click(ctx(), click), true);
  await wait();
  assert.equal(OF.customFields(state).length, count - 1);
  assert.doesNotMatch(UI.settingsMarkup(ctx()), /再点一次确认删除/);
  assert.equal(UI.click(ctx(), { target: { closest: () => null } }), false, 'a click elsewhere is not handled');
  // Rename and required through change; an unchanged name does nothing.
  const other = OF.customFields(state)[0];
  assert.equal(UI.change(ctx(), { target: { dataset: { ofCfRename: other.id }, value: '新名称', defaultValue: other.name } }), true);
  await wait();
  assert.equal(OF.customFields(state)[0].name, '新名称');
  const saves = saved.length;
  UI.change(ctx(), { target: { dataset: { ofCfRename: other.id }, value: '新名称', defaultValue: '新名称' } });
  assert.equal(saved.length, saves);
  assert.equal(UI.change(ctx(), { target: { dataset: { ofCfRequired: other.id }, checked: true } }), true);
  await wait();
  assert.equal(OF.customFields(state)[0].required, true);
  // A failing change is shown, not saved.
  UI.change(ctx(), { target: { dataset: { ofCfRename: other.id }, value: '订单金额', defaultValue: '新名称' } });
  await wait();
  assert.match(UI.settingsMarkup(ctx()), /id="of-error"[^>]*>[^<]*同名/);
  assert.doesNotMatch(UI.settingsMarkup(ctx()), /id="of-error"[^>]*>[^<]*同名/, 'the message is shown once');
});

test('the order form: an input per type, the star, browser-required only on new orders, current values and kept old options', () => {
  let state = withFields();
  const [contract, qty, due, pay, pack, note] = ['合同号', '采购量', '交货日', '付款方式', '包装', '特殊要求'].map(n => idOf(state, n));
  state = OF.setCustomRequired(state, contract, true);
  state = OF.setCustomRequired(state, pack, true);
  const defs = OF.customFields(state);
  const values = { [contract]: 'HT-"1"', [qty]: 12, [due]: '2026-12-01', [pay]: '现金', [pack]: ['纸箱', '旧包装'] };
  const html = UI.formMarkup(escapeHtml, { defs, values, isNew: true });
  assert.equal([...html.matchAll(/data-order-custom="/g)].length, 6);
  assert.match(html, new RegExp(`name="custom\\.${contract}" type="text" value="HT-&quot;1&quot;"[^>]* required`));
  assert.match(html, new RegExp(`name="custom\\.${qty}" type="text" inputmode="decimal" value="12"`));
  assert.match(html, new RegExp(`name="custom\\.${due}" type="date" value="2026-12-01"`));
  assert.match(html, new RegExp(`<select id="order-custom-${pay}"[^>]*>.*<option value="现金" selected>`), 'a stored value that is no longer an option is kept');
  assert.match(html, new RegExp(`<textarea id="order-custom-${note}"`));
  assert.equal([...html.matchAll(new RegExp(`name="custom\\.${pack}" value=`, 'g'))].length, 4, 'three options plus the old stored one');
  assert.match(html, new RegExp(`name="custom\\.${pack}" value="旧包装" checked`));
  assert.doesNotMatch(html, new RegExp(`name="custom\\.${pack}"[^>]* required`), 'checkbox groups never carry the browser rule');
  assert.equal([...html.matchAll(/class="required"/g)].length, 2, 'a star on the two required fields');
  assert.doesNotMatch(UI.formMarkup(escapeHtml, { defs, values, isNew: false }), / required>/, 'editing an old order has no browser rule');
  assert.equal(UI.formMarkup(escapeHtml, { defs: [], values: {}, isNew: true }), '');
});

test('collect: takes only the fields that are in the form; a multi group gives its list', () => {
  const state = withFields();
  const defs = OF.customFields(state);
  const [contract, pack, note] = ['合同号', '包装', '特殊要求'].map(n => idOf(state, n));
  const entries = [['custom.' + contract, ' HT '], ['custom.' + pack, '纸箱'], ['custom.' + pack, '托盘']];
  global.FormData = class { get(key) { return entries.find(e => e[0] === key)?.[1] ?? null; } getAll(key) { return entries.filter(e => e[0] === key).map(e => e[1]); } };
  try {
    const present = new Set([contract, pack, note]);
    const form = { querySelector: selector => present.has(/data-order-custom="([^"]+)"/.exec(selector)[1]) ? {} : null };
    assert.deepEqual(UI.collect(form, defs), { [contract]: ' HT ', [pack]: ['纸箱', '托盘'], [note]: '' });
    assert.deepEqual(UI.collect(form, defs, id => id !== contract), { [pack]: ['纸箱', '托盘'], [note]: '' }, 'a field the account cannot change is left out');
  } finally { delete global.FormData; }
});

test('the page is assembled with the new files, and business-ui wires the form, the submit and the settings page', () => {
  const root = path.join(__dirname, '..');
  const template = fs.readFileSync(path.join(root, 'src/template.html'), 'utf8');
  const build = fs.readFileSync(path.join(root, 'scripts/build.py'), 'utf8');
  for (const [marker, file] of [['ORDER_FIELDS_MODEL', 'order-fields-model.js'], ['ORDER_FIELDS_UI', 'order-fields-ui.js']]) {
    assert.ok(template.includes(`<!--${marker}-->`), marker + ' in the template');
    assert.ok(build.includes(`('<!--${marker}-->','${file}','script')`), marker + ' in build.py');
  }
  assert.ok(template.indexOf('<!--ORDER_FIELDS_MODEL-->') < template.indexOf('<!--LAI_BUSINESS_MODEL-->'));
  const ui = fs.readFileSync(path.join(root, 'src/business-ui.js'), 'utf8');
  assert.match(ui, /orderCustomMarkup\(o, locked, !old\)/);
  assert.match(ui, /LaiOrderFieldsUI\.collect\(form, root\.LaiOrderFields\.customFields\(state\(\)\)/);
  assert.match(ui, /\$\{orderFieldsSection\(\)\}`\s*\+ card\("theme-section", "界面配色"/);
  for (const hook of ['click', 'change', 'submit']) assert.ok(ui.includes(`settingsExtra()?.${hook}(extraCtx(), e)`), hook);
});

test('the settings section saves one change after the other: a rename then a quick move both land, in order', async () => {
  let state = withFields();
  const saves = [];
  let busy = false;
  // Like the app's persist(): a second save while one is still running is refused.
  const save = async next => {
    if (busy) throw new Error('上一项修改正在保存，请稍候');
    busy = true;
    await new Promise(resolve => setTimeout(resolve, 15));
    state = next; busy = false; saves.push(OF.customFields(next).map(f => f.name).join(','));
  };
  const ctx = () => ({ escape: escapeHtml, state: () => state, can: () => true, need: () => true, save, toast() {}, refresh() {} });
  const [first, second] = OF.customFields(state);
  UI.change(ctx(), { target: { dataset: { ofCfRename: second.id }, value: '采购数量', defaultValue: second.name } });
  UI.click(ctx(), { target: { closest: selector => selector === '[data-of-cf]' ? { dataset: { ofCf: 'up', id: second.id }, disabled: false } : null } });
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.deepEqual(OF.customFields(state).slice(0, 2).map(f => f.name), ['采购数量', first.name], 'renamed, then moved up');
  assert.equal(saves.length, 2);
  assert.doesNotMatch(UI.settingsMarkup(ctx()), /正在保存/, 'no clash message');
});
