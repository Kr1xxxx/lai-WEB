'use strict';
// 线索的自定义字段: settings (add / rename / move / delete / options / required), the lead form, detail, save + required rules,
// export columns, lead → customer conversion and field permissions.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const FM = require('../src/field-model.js');
const S = require('../src/lead-settings-model.js');
const L = require('../src/lead-model.js');
const LU = require('../src/lead-ui.js');
const R = require('../src/role-model.js');
const EM = require('../src/export-model.js');
const EU = require('../src/export-ui.js');
const { escapeHtml } = require('../src/model.js');

const NOW = '2026-10-01T00:00:00.000Z';
const base = () => ({ laiSettings: {}, customers: {}, orders: [] });
const idOf = (state, name) => S.customFields(state).find(field => field.name === name).id;
const lead = (state, id) => L.list(state).find(item => item.id === id);
const save = (state, id, input = {}, mustExist = false) => L.upsert(state, id, { name: 'Lead ' + id, ...input }, { now: NOW, mustExist });
const roleState = (state, fields, current = 'm-amy') => ({
  ...state,
  laiSettings: { ...(state.laiSettings || {}), roles: {
    roles: [{ id: 'sales', name: '业务', scope: 'self', perms: { 'lead.view': true, 'lead.edit': true, 'lead.create': true }, fields }],
    members: [{ id: 'm-kris', name: 'Kris', roleId: 'admin' }, { id: 'm-amy', name: 'Amy', roleId: 'sales' }], current,
  } },
});
function withFields() {
  let state = base();
  state = S.addCustomField(state, { name: '采购量', type: 'number' });
  state = S.addCustomField(state, { name: '交期', type: 'date' });
  state = S.addCustomField(state, { name: '客户类型', type: 'select', options: '贸易商，零售商' });
  state = S.addCustomField(state, { name: '关注品类', type: 'multi', options: '睫毛、假发' });
  state = S.addCustomField(state, { name: '备注说明', type: 'textarea' });
  state = S.addCustomField(state, { name: '展会名', type: 'text' });
  return state;
}

test('settings: add every type, names are checked, 线索自带的名字不能用, fields are stored under fieldSettings.lead', () => {
  const state = withFields();
  assert.deepEqual(S.customFields(state).map(f => [f.name, f.type]), [['采购量', 'number'], ['交期', 'date'], ['客户类型', 'select'], ['关注品类', 'multi'], ['备注说明', 'textarea'], ['展会名', 'text']]);
  assert.deepEqual(S.customFields(state).find(f => f.name === '关注品类').options, ['睫毛', '假发']);
  assert.equal(FM.get(state, 'lead').customFields.length, 6);
  assert.equal(FM.get(state, 'customer').customFields.length, 0, 'customer settings are separate');
  assert.throws(() => S.addCustomField(state, { name: '  采购量 ', type: 'text' }), /同名/);
  assert.throws(() => S.addCustomField(state, { name: '邮箱', type: 'text' }), /同名/);
  assert.throws(() => S.addCustomField(state, { name: '线索名称', type: 'text' }), /同名/);
  assert.throws(() => S.addCustomField(state, { name: '   ', type: 'text' }), /请填写字段名称/);
  assert.throws(() => S.addCustomField(state, { name: '新字段', type: 'select' }), /至少填写一个选项/);
  assert.throws(() => S.addCustomField(state, { name: '新字段', type: 'nope' }), /请选择字段类型/);
  // The lead settings (reasons / field rules) are untouched.
  assert.deepEqual(S.reasonsOf(state), S.DEFAULT_REASONS);
  assert.equal(S.get(state).fields.email.show, true);
});

test('settings: rename, move, required, options, delete; type cannot change', () => {
  let state = withFields();
  const id = idOf(state, '采购量');
  state = S.renameCustomField(state, id, '年采购量');
  assert.equal(S.customFields(state)[0].name, '年采购量');
  assert.throws(() => S.renameCustomField(state, id, '交期'), /同名/);
  assert.throws(() => FM.changeType(state, 'lead', id, 'text'), /不能修改/);
  state = S.moveCustomField(state, id, 1);
  assert.deepEqual(S.customFields(state).slice(0, 2).map(f => f.name), ['交期', '年采购量']);
  assert.throws(() => S.moveCustomField(state, idOf(state, '交期'), -1), /第一个/);
  state = S.setCustomRequired(state, id, true);
  assert.equal(S.customFields(state).find(f => f.id === id).required, true);
  const typeId = idOf(state, '客户类型');
  state = S.addFieldOption(state, typeId, '品牌商');
  assert.deepEqual(S.customFields(state).find(f => f.id === typeId).options, ['贸易商', '零售商', '品牌商']);
  assert.throws(() => S.addFieldOption(state, typeId, ' 贸易商 '), /已经有这个选项/);
  state = S.moveFieldOption(state, typeId, '品牌商', -1);
  assert.deepEqual(S.customFields(state).find(f => f.id === typeId).options, ['贸易商', '品牌商', '零售商']);
  state = S.removeFieldOption(state, typeId, '品牌商');
  assert.deepEqual(S.customFields(state).find(f => f.id === typeId).options, ['贸易商', '零售商']);
  assert.throws(() => S.addFieldOption(state, id, 'x'), /没有选项/);
  state = S.deleteCustomField(state, id);
  assert.ok(!S.customFields(state).some(f => f.id === id));
  assert.throws(() => S.deleteCustomField(state, id), /不存在/);
});

test('settings: a field a role locks cannot be required; the rows count the leads that filled it', () => {
  let state = withFields();
  const id = idOf(state, '展会名');
  state = roleState(state, { lead: { ['custom.' + id]: 'read' } });
  assert.throws(() => S.setCustomRequired(state, id, true), /角色「业务」把这个字段设为只读，不能同时必填/);
  assert.equal(S.setCustomRequired(state, id, false) !== null, true, 'turning required off is always allowed');
  state = save(state, 'a', { custom: { [id]: '广交会' } });
  state = save(state, 'b', { custom: {} });
  const row = S.customRows(state).find(item => item.id === id);
  assert.equal(row.usage, 1);
  assert.equal(row.typeLabel, '文本');
  assert.equal(row.locked[0].level, 'read');
});

test('save: values are cleaned by type and stored in lead.custom; empty clears; bad values are refused', () => {
  const state0 = withFields();
  const f = name => idOf(state0, name);
  const input = { custom: { [f('采购量')]: ' 1200.5 ', [f('交期')]: '2026-11-30', [f('客户类型')]: '贸易商', [f('关注品类')]: ['睫毛', '假发'], [f('备注说明')]: '  要打样 ', [f('展会名')]: '' } };
  let state = save(state0, 'a', input);
  assert.deepEqual(lead(state, 'a').custom, { [f('采购量')]: 1200.5, [f('交期')]: '2026-11-30', [f('客户类型')]: '贸易商', [f('关注品类')]: ['睫毛', '假发'], [f('备注说明')]: '要打样' });
  // Clear one value and keep the rest.
  state = save(state, 'a', { custom: { [f('采购量')]: '', [f('关注品类')]: [] } }, true);
  assert.deepEqual(Object.keys(lead(state, 'a').custom).sort(), [f('交期'), f('客户类型'), f('备注说明')].sort());
  assert.throws(() => save(state, 'a', { custom: { [f('采购量')]: '1,200' } }, true), /请填写数字/);
  assert.throws(() => save(state, 'a', { custom: { [f('交期')]: '2026-02-30' } }, true), /有效的日期/);
  assert.throws(() => save(state, 'a', { custom: { [f('客户类型')]: '别的' } }, true), /不在选项里/);
  assert.throws(() => save(state, 'a', { custom: { [f('关注品类')]: ['没有的'] } }, true), /不在选项里/);
  // No custom key at all (older callers, locked fields): the stored values stay.
  state = save(state, 'a', { note: '只改备注' }, true);
  assert.equal(lead(state, 'a').custom[f('客户类型')], '贸易商');
  // A lead without any custom value has no custom key.
  assert.equal('custom' in lead(save(state0, 'z', {}), 'z'), false);
});

test('required: new leads must fill it; an old empty lead that is not touched still saves; touching and clearing does not', () => {
  let state = withFields();
  const must = idOf(state, '展会名'), qty = idOf(state, '采购量');
  // The lead exists before the field becomes required.
  state = save(state, 'old', {});
  state = S.setCustomRequired(state, must, true);
  state = S.setCustomRequired(state, qty, true);
  assert.throws(() => save(state, 'new', {}), /请填写采购量、展会名/);
  assert.throws(() => save(state, 'new', { custom: { [qty]: '5' } }), /请填写展会名/);
  assert.ok(lead(save(state, 'new', { custom: { [qty]: '5', [must]: '展会' } }), 'new'));
  // Old lead: the form sends the empty values back; they are not "touched".
  const kept = save(state, 'old', { note: 'x', custom: { [must]: '', [qty]: '' } }, true);
  assert.equal(lead(kept, 'old').note, 'x');
  // Once a value is there, clearing it is refused.
  const filled = save(state, 'old', { custom: { [must]: '展会', [qty]: '3' } }, true);
  assert.throws(() => save(filled, 'old', { custom: { [must]: '' } }, true), /请填写展会名/);
  assert.ok(save(filled, 'old', { custom: { [must]: '另一个展会' } }, true));
  // A required field the account cannot edit is not checked.
  const locked = roleState(state, { lead: { ['custom.' + must]: 'hidden', ['custom.' + qty]: 'read' } });
  assert.ok(lead(save(locked, 'viewer', { custom: {} }), 'viewer'), 'hidden / read-only required fields are skipped');
});

test('a deleted field keeps its stored values but they are no longer shown, exported or saved over', () => {
  let state = withFields();
  const id = idOf(state, '展会名');
  state = save(state, 'a', { custom: { [id]: '广交会' } });
  state = S.deleteCustomField(state, id);
  assert.equal(lead(state, 'a').custom[id], '广交会', 'the value stays in the data');
  assert.deepEqual(L.detail(state, 'a', '2026-10-02').customView.map(e => e.id).includes(id), false);
  assert.ok(!EM.leadRows([lead(state, 'a')], state).header.includes('展会名'));
  // Saving the lead again does not drop the old value.
  state = save(state, 'a', { note: 'n', custom: {} }, true);
  assert.equal(lead(state, 'a').custom[id], '广交会');
});

test('form: one control per type in settings order, required star only when the account can edit, old leads get no required attribute', () => {
  const fresh = withFields();
  const state = S.setCustomRequired(fresh, idOf(fresh, '展会名'), true);
  const defs = S.customFields(state), must = defs.find(d => d.name === '展会名').id;
  const ui = LU.create(escapeHtml, L);
  const html = ui.formMarkup({ name: '' }, { owners: [], sources: [], customFields: defs });
  assert.match(html, /自定义字段/);
  assert.deepEqual([...html.matchAll(/data-custom-type="(\w+)"/g)].map(m => m[1]), ['number', 'date', 'select', 'multi', 'textarea', 'text']);
  assert.match(html, /<input id="lead-custom-[^"]+" name="custom\.[^"]+" type="text" inputmode="decimal"/);
  assert.match(html, /type="date"/);
  assert.match(html, /<option value="贸易商">贸易商<\/option>/);
  assert.match(html, /type="checkbox" name="custom\.[^"]+" value="睫毛"/);
  assert.match(html, /<textarea id="lead-custom-[^"]+" name="custom\./);
  assert.match(html, new RegExp(`name="custom\\.${must}"[^>]*required`), 'new lead: native required');
  assert.match(html, /展会名<i class="opp-req"/);
  // Saved values come back into the controls.
  const values = { id: 'x', name: 'A', custom: { [defs[0].id]: 12, [defs[2].id]: '零售商', [defs[3].id]: ['假发'], [must]: '展会 <b>' } };
  const edit = ui.formMarkup(values, { customFields: defs });
  assert.match(edit, /value="12"/);
  assert.match(edit, /<option value="零售商" selected>/);
  assert.match(edit, /value="假发" checked/);
  assert.match(edit, /value="展会 &lt;b&gt;"/);
  assert.doesNotMatch(edit, new RegExp(`name="custom\\.${must}"[^>]*required`), 'editing an old lead: the field can stay empty');
  // Values that are no longer options still show so they are not lost on save.
  const old = ui.formMarkup({ id: 'x', name: 'A', custom: { [defs[2].id]: '已删选项' } }, { customFields: defs });
  assert.match(old, /<option value="已删选项" selected>/);
  // No fields: no section.
  assert.doesNotMatch(ui.formMarkup({ name: '' }, { customFields: [] }), /自定义字段/);
});

test('form and detail respect field permissions (custom.<id>)', () => {
  const state = withFields();
  const defs = S.customFields(state), [qty, date] = defs;
  const gate = key => ({ ['custom.' + qty.id]: 'hidden', ['custom.' + date.id]: 'read' })[key] || 'edit';
  const ui = LU.create(escapeHtml, L, () => true, gate);
  const html = ui.formMarkup({ name: 'A' }, { customFields: defs });
  assert.doesNotMatch(html, new RegExp(`custom\\.${qty.id}`), 'hidden field is not drawn');
  assert.match(html, new RegExp(`name="custom\\.${date.id}"[^>]*disabled`), 'read-only field is drawn but disabled');
  const saved = save(state, 'a', { custom: { [qty.id]: '9', [date.id]: '2026-11-01' } });
  const row = L.detail(saved, 'a', '2026-10-02');
  const detail = ui.detailMarkup(row, '2026-10-02');
  assert.doesNotMatch(detail, /采购量/);
  assert.match(detail, /交期/);
});

test('detail: shows only fields that have a value or are required, formatted; multi joins with 、', () => {
  let state = withFields();
  const f = name => idOf(state, name);
  state = save(state, 'a', { custom: { [f('采购量')]: '1200', [f('关注品类')]: ['睫毛', '假发'], [f('交期')]: '2026-11-30' } });
  state = S.setCustomRequired(state, f('展会名'), true);
  const row = L.detail(state, 'a', '2026-10-02');
  assert.deepEqual(row.customView.map(e => [e.name, e.text]), [['采购量', '1200'], ['交期', '2026-11-30'], ['关注品类', '睫毛、假发'], ['展会名', '']]);
  const html = LU.create(escapeHtml, L).detailMarkup(row, '2026-10-02');
  assert.match(html, /<dt>采购量<\/dt><dd>1200<\/dd>/);
  assert.match(html, /<dt>关注品类<\/dt><dd>睫毛、假发<\/dd>/);
  assert.match(html, /<dt>展会名<\/dt><dd><span class="lead-muted">—<\/span><\/dd>/, 'required but empty shows a dash');
  assert.doesNotMatch(html, /客户类型|备注说明/, 'optional empty fields are left out');
  // No custom fields at all: no block.
  const plain = save(base(), 'p', {});
  assert.doesNotMatch(LU.create(escapeHtml, L).detailMarkup(L.detail(plain, 'p', '2026-10-02'), '2026-10-02'), /data-lead-custom-infos/);
});

test('export: custom fields are columns after the built-in ones; numbers are numbers; the gate hides them', () => {
  let state = withFields();
  const f = name => idOf(state, name);
  state = save(state, 'a', { custom: { [f('采购量')]: '1200', [f('关注品类')]: ['睫毛', '假发'], [f('交期')]: '2026-11-30', [f('展会名')]: '=SUM(A1)' } });
  const sheet = EM.leadRows(L.list(state), state);
  assert.deepEqual(sheet.header.slice(-6), ['采购量', '交期', '客户类型', '关注品类', '备注说明', '展会名']);
  const row = sheet.data[0].slice(-6);
  assert.deepEqual(row, [1200, '2026-11-30', '', '睫毛、假发', '', '=SUM(A1)']);
  assert.equal(EM.toTSV(sheet).includes("'=SUM(A1)"), true, 'the formula guard still applies');
  const gated = EM.leadRows(L.list(state), state, { gate: { columnVisible: id => id !== 'custom:' + f('采购量') } });
  assert.ok(!gated.header.includes('采购量') && gated.header.includes('交期'));
  // Without state there are only the built-in columns.
  assert.ok(!EM.leadRows(L.list(state), {}).header.includes('采购量'));
  // The export window builds the same table.
  const built = EU.build('lead', { state, can: () => true, scopes: { filtered: L.list(state), all: L.list(state) }, trial: true }, {});
  assert.ok(built.sheets[0].header.includes('关注品类'));
});

test('convert: values go to the customer field with the same name and type; others are skipped', () => {
  let state = withFields();
  const f = name => idOf(state, name);
  // Customer side: 采购量 (number, same), 交期 as text (type differs), 客户类型 select without the lead's value, 关注品类 multi with the options,
  // 展会名 text with different case, 备注说明 missing.
  state = FM.addField(state, 'customer', { name: '采购量', type: 'number' });
  state = FM.addField(state, 'customer', { name: '交期', type: 'text' });
  state = FM.addField(state, 'customer', { name: '客户类型', type: 'select', options: ['品牌商'] });
  state = FM.addField(state, 'customer', { name: '关注品类', type: 'multi', options: ['睫毛', '假发', '工具'] });
  state = FM.addField(state, 'customer', { name: ' 展会名 ', type: 'text' });
  state = save(state, 'a', { country: 'US', source: '展会', custom: { [f('采购量')]: '1200', [f('交期')]: '2026-11-30', [f('客户类型')]: '贸易商', [f('关注品类')]: ['睫毛', '假发'], [f('备注说明')]: '要打样', [f('展会名')]: '广交会' } });
  const cid = name => FM.get(state, 'customer').customFields.find(field => field.name === name).id;
  const next = L.convert(state, 'a', { mode: 'new', name: 'Nova Beauty', country: 'US', source: '展会' }, { now: NOW });
  const custom = next.customers['Nova Beauty'].custom;
  assert.deepEqual(custom, { [cid('采购量')]: 1200, [cid('关注品类')]: ['睫毛', '假发'], [cid('展会名')]: '广交会' });
  assert.equal(lead(next, 'a').status, 'converted');
  assert.equal(lead(next, 'a').custom[f('客户类型')], '贸易商', 'the lead keeps its own values');
});

test('convert: linking to an existing customer does not change it; no matching field gives no custom key', () => {
  let state = withFields();
  state = FM.addField(state, 'customer', { name: '采购量', type: 'number' });
  state = { ...state, customers: { Acme: { client: 'Acme', history: [] } } };
  state = save(state, 'a', { country: 'US', source: '展会', custom: { [idOf(state, '采购量')]: '5' } });
  const linked = L.convert(state, 'a', { mode: 'existing', existing: 'Acme' }, { now: NOW });
  assert.equal(linked.customers.Acme.custom, undefined);
  // No customer field with that name: nothing to copy, no empty custom object.
  const fresh = withFields();
  const plain = save(fresh, 'b', { country: 'US', source: '展会', custom: { [idOf(fresh, '展会名')]: 'x' } });
  const made = L.convert(plain, 'b', { mode: 'new', name: 'Plain Co', country: 'US', source: '展会' }, { now: NOW });
  assert.equal('custom' in made.customers['Plain Co'], false);
});

test('field permissions: the role list offers custom.<id> for leads with the field name', () => {
  const state = withFields();
  const list = L.roleFieldList(state);
  const id = idOf(state, '展会名');
  assert.deepEqual(list.find(item => item.key === 'custom.' + id), { key: 'custom.' + id, label: '展会名', group: '自定义字段' });
  assert.equal(list.filter(item => item.key.startsWith('custom.')).length, 6);
  assert.equal(L.roleFieldList().length, 8, 'without state only the built-in fields');
  const RF = require('../src/role-fields.js');
  global.LaiLeadModel = L;
  try { assert.ok(RF.list(state, 'lead').some(item => item.key === 'custom.' + id)); } finally { delete global.LaiLeadModel; }
  const locked = roleState(state, { lead: { ['custom.' + id]: 'hidden' } });
  assert.equal(R.fieldLevel(locked, 'lead', 'custom.' + id), 'hidden');
});

test('the settings page: section with add form, rows, two-step delete, option forms', async () => {
  const code = fs.readFileSync(path.join(__dirname, '../src/lead-settings-ui.js'), 'utf8');
  const window = { LaiLeadSettings: S, LaiFieldModel: FM };
  new Function('window', code)(window);
  const page = window.LaiExtraPages['lead-settings'];
  let state = withFields();
  const saved = [];
  const ctx = () => ({ escape: escapeHtml, state: () => state, can: () => true, need: () => true, save: async next => { saved.push(next); state = next; }, toast() {}, refresh() {} });
  const html = page.render(ctx());
  assert.ok(html.includes('data-ls-section="custom"') && html.includes('data-ls-cf-form="add"'));
  assert.equal([...html.matchAll(/data-ls-cf-rename=/g)].length, 6);
  assert.match(html, /<option value="multi">多选<\/option>/);
  assert.match(html, /data-ls-cf-form="option"/, 'select / multi fields get an option form');
  assert.match(html, /文本 · 还没有线索填/);
  // Add through the form.
  const form = { dataset: { lsCfForm: 'add' }, target: null };
  const fd = new Map([['name', '来源渠道'], ['type', 'text'], ['options', '']]);
  global.FormData = class { constructor() {} get(key) { return fd.get(key) ?? null; } has(key) { return key === 'required'; } };
  try {
    assert.equal(page.submit(ctx(), { target: form, preventDefault() {} }), true);
  } finally { delete global.FormData; }
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(S.customFields(state).at(-1).name, '来源渠道');
  assert.equal(S.customFields(state).at(-1).required, true);
  // Delete needs a second click.
  const id = S.customFields(state)[0].id, before = S.customFields(state).length;
  const event = { target: { closest: selector => selector === '[data-ls-cf]' ? { dataset: { lsCf: 'delete', id }, disabled: false } : null } };
  assert.equal(page.click(ctx(), event), true);
  assert.equal(S.customFields(state).length, before);
  assert.equal(page.click(ctx(), event), true);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(S.customFields(state).length, before - 1);
  // Rename through change; an unchanged name does nothing.
  const other = S.customFields(state)[0];
  const input = { dataset: { lsCfRename: other.id }, value: '新名称', defaultValue: other.name };
  assert.equal(page.change(ctx(), { target: input }), true);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(S.customFields(state)[0].name, '新名称');
  const count = saved.length;
  page.change(ctx(), { target: { dataset: { lsCfRename: other.id }, value: '新名称', defaultValue: '新名称' } });
  assert.equal(saved.length, count);
});

test('lead.custom is kept by the other lead actions (follow-up, invalid, trash)', () => {
  let state = withFields();
  const id = idOf(state, '展会名');
  state = save(state, 'a', { custom: { [id]: '广交会' } });
  state = L.addFollowup(state, 'a', { text: '联系了' }, { now: NOW });
  state = L.setTrashed(state, 'a', true, { now: NOW });
  state = L.setTrashed(state, 'a', false, { now: NOW });
  assert.equal(lead(state, 'a').custom[id], '广交会');
});
