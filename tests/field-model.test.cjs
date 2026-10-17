const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../src/field-model.js');

const empty = {laiSettings: {}, customers: {A: {custom: {k: 'x'}}}};
const mk = (state, entity, name, type = 'text', extra = {}) => F.addField(state, entity, {name, type, ...extra}, {id: name});

test('defaults, bad stored data, types', () => {
  assert.deepEqual(F.get({}, 'customer'), {customFields: [], required: {}});
  const bad = {laiSettings: {fieldSettings: {customer: {customFields: [null, {id: 'a', name: 'N', type: 'bogus'}, {id: 'b', name: ' 等级 ', type: 'select', options: ['A', 'a', '', 5]}, {id: 'b', name: 'dup', type: 'text'}], required: {x: true, y: 'yes'}}}}};
  assert.deepEqual(F.get(bad, 'customer'), {customFields: [{id: 'b', name: '等级', type: 'select', options: ['A'], required: false}], required: {x: true}});
  assert.deepEqual(F.get({}, 'order'), {customFields: [], required: {}}); // orders became a field entity with 订单字段
  assert.throws(() => F.get({}, 'product'), /无效/);
  assert.throws(() => F.addField({laiSettings: []}, 'customer', {name: 'x', type: 'text'}), /格式异常/);
  assert.throws(() => F.addField({laiSettings: {fieldSettings: {customer: []}}}, 'customer', {name: 'x', type: 'text'}), /格式异常/);
  assert.deepEqual(F.TYPES.map(t => t[1]), ['文本', '多行文本', '数字', '日期', '单选', '多选']);
  assert.equal(F.LIMIT, 30);
});

test('add, rename, move, delete with validation', () => {
  let s = mk(empty, 'customer', '等级', 'select', {options: 'A,B\nC'});
  s = mk(s, 'customer', '备注2', 'textarea');
  assert.deepEqual(F.get(s, 'customer').customFields[0].options, ['A', 'B', 'C']);
  assert.throws(() => F.addField(s, 'customer', {name: ' 等级 ', type: 'text'}), /同名/);
  const w = F.addField(s, 'customer', {name: 'ＡＢ', type: 'text'});
  assert.throws(() => F.addField(w, 'customer', {name: 'ab', type: 'text'}), /同名/);
  assert.throws(() => F.addField(s, 'customer', {name: '', type: 'text'}), /请填写/);
  assert.throws(() => F.addField(s, 'customer', {name: 'x'.repeat(31), type: 'text'}), /30/);
  assert.throws(() => F.addField(s, 'customer', {name: 'q', type: 'zzz'}), /类型/);
  assert.throws(() => F.addField(s, 'customer', {name: 'q', type: 'select', options: ''}), /至少/);
  assert.throws(() => F.addField(s, 'customer', {name: 'q', type: 'select', options: Array.from({length: 51}, (_, i) => 'o' + i)}), /50/);
  assert.throws(() => F.addField(s, 'customer', {name: 'q', type: 'multi', options: ['x'.repeat(41)]}), /40/);
  assert.throws(() => F.addField(s, 'customer', {name: '客户名称', type: 'text'}, {reserved: ['客户名称']}), /同名/);
  s = F.renameField(s, 'customer', '等级', '客户等级');
  assert.equal(F.get(s, 'customer').customFields[0].name, '客户等级');
  assert.equal(F.get(s, 'customer').customFields[0].type, 'select');
  assert.throws(() => F.renameField(s, 'customer', '等级', '备注2'), /同名/);
  assert.throws(() => F.renameField(s, 'customer', 'nope', 'z'), /不存在/);
  assert.throws(() => F.changeType(s, 'customer', '等级', 'text'), /不能修改/);
  assert.equal(F.changeType(s, 'customer', '等级', 'select'), s);
  s = F.moveField(s, 'customer', '备注2', -1);
  assert.deepEqual(F.get(s, 'customer').customFields.map(f => f.id), ['备注2', '等级']);
  assert.throws(() => F.moveField(s, 'customer', '备注2', -1), /第一个/);
  assert.throws(() => F.moveField(s, 'customer', '等级', 1), /最后/);
  assert.throws(() => F.deleteField(s, 'customer', 'nope'), /不存在/);
  assert.equal(F.get(F.deleteField(s, 'customer', '等级'), 'customer').customFields.length, 1);
});

test('limit 30', () => {
  let s = empty;
  for (let i = 0; i < 30; i++) s = mk(s, 'order', 'f' + i);
  assert.throws(() => mk(s, 'order', 'extra'), /最多添加 30/);
  assert.equal(F.get(mk(s, 'customer', 'f0'), 'customer').customFields.length, 1);
});

test('entities are separate', () => {
  let s = mk(empty, 'customer', '等级', 'select', {options: ['A']});
  s = mk(s, 'order', '等级', 'text');
  s = F.setSystemRequired(s, 'order', 'country', true);
  assert.equal(F.get(s, 'customer').customFields[0].type, 'select');
  assert.equal(F.get(s, 'order').customFields[0].type, 'text');
  assert.deepEqual(F.get(s, 'customer').required, {});
  assert.deepEqual(F.get(s, 'order').required, {country: true});
  s = F.deleteField(s, 'order', '等级');
  assert.equal(F.get(s, 'customer').customFields.length, 1);
});

test('lead fields are gone (D-030) but stored lead field settings are kept on every write', () => {
  assert.throws(() => F.get({}, 'lead'), /无效/);
  const lead = {customFields: [{id: 'l1', name: '意向', type: 'text'}], required: {country: true}};
  let s = {laiSettings: {fieldSettings: {lead}}};
  s = mk(s, 'customer', '等级', 'text');
  s = mk(s, 'order', '批次', 'text');
  s = F.deleteField(s, 'order', '批次');
  assert.deepEqual(s.laiSettings.fieldSettings.lead, lead);
});

test('setOptions: add, reorder, delete', () => {
  let s = mk(empty, 'customer', 't', 'multi', {options: ['A', 'B', 'C']});
  s = F.setOptions(s, 'customer', 't', ['C', 'A', 'D']);
  assert.deepEqual(F.get(s, 'customer').customFields[0].options, ['C', 'A', 'D']);
  assert.throws(() => F.setOptions(s, 'customer', 't', []), /至少/);
  s = mk(s, 'customer', 'txt');
  assert.throws(() => F.setOptions(s, 'customer', 'txt', ['a']), /没有选项/);
});

test('required flags and system required lock', () => {
  let s = mk(empty, 'customer', 'k', 'text');
  s = F.setRequired(s, 'customer', 'k', true);
  assert.equal(F.get(s, 'customer').customFields[0].required, true);
  s = F.setSystemRequired(s, 'customer', 'phone', true, {lockedBy: []});
  assert.deepEqual(F.get(s, 'customer').required, {phone: true});
  assert.throws(() => F.setSystemRequired(s, 'customer', 'email', true, {lockedBy: ['销售', '助理']}), /角色「销售」把这个字段设为只读或隐藏，不能同时必填/);
  assert.deepEqual(F.get(s, 'customer').required, {phone: true});
  s = F.setSystemRequired(s, 'customer', 'phone', false, {lockedBy: ['销售']});
  assert.deepEqual(F.get(s, 'customer').required, {});
  assert.equal(F.get(s, 'customer').customFields[0].required, true);
});

test('delete keeps stored values on records', () => {
  const s = mk(empty, 'customer', 'k', 'text');
  const before = JSON.stringify(s.customers);
  const d = F.deleteField(s, 'customer', 'k');
  assert.equal(JSON.stringify(d.customers), before);
  assert.equal(F.usage(d.customers, 'k'), 1);
  assert.equal(F.get(d, 'customer').customFields.length, 0);
});

test('unknown stored entries are preserved on save', () => {
  const s0 = {laiSettings: {fieldSettings: {customer: {customFields: [{id: 'a', name: 'A', type: 'text', extra: 1}, {weird: true}]}}}};
  const raw = mk(s0, 'customer', 'B').laiSettings.fieldSettings.customer.customFields;
  assert.equal(raw[0].extra, 1);
  assert.deepEqual(raw[raw.length - 1], {weird: true});
});

test('cleanValue', () => {
  const num = {name: '数', type: 'number', options: []}, date = {name: '日', type: 'date', options: []};
  assert.equal(F.cleanValue(num, ' 12.5 '), 12.5);
  assert.equal(F.cleanValue(num, '-3'), -3);
  assert.equal(F.cleanValue(num, ''), undefined);
  assert.throws(() => F.cleanValue(num, '1,000'), /数字/);
  // A stored tiny number shows as "1e-7"; saving it again must not be refused.
  assert.equal(F.cleanValue(num, 1e-7, 1e-7), 1e-7);
  assert.equal(F.cleanValue(num, '1e-7', 1e-7), 1e-7);
  assert.equal(F.cleanValue(num, F.cleanValue(num, '0.0000001')), 1e-7);
  assert.throws(() => F.cleanValue(num, '1e-7'), /数字/);
  assert.throws(() => F.cleanValue(num, 1e16), /数字/);
  assert.equal(F.cleanValue(date, '2026-02-28'), '2026-02-28');
  assert.throws(() => F.cleanValue(date, '2026-02-30'), /有效的日期/);
  assert.throws(() => F.cleanValue(date, '10/01/2026'), /有效的日期/);
  const sel = {name: '等', type: 'select', options: ['A', 'B']};
  assert.equal(F.cleanValue(sel, ' a '), 'A');
  assert.throws(() => F.cleanValue(sel, 'Z'), /不在选项里/);
  assert.equal(F.cleanValue(sel, 'Z', 'Z'), 'Z');
  const multi = {name: '多', type: 'multi', options: ['A', 'B']};
  assert.deepEqual(F.cleanValue(multi, ['a', 'B', 'b']), ['A', 'B']);
  assert.equal(F.cleanValue(multi, []), undefined);
  assert.throws(() => F.cleanValue(multi, ['Q']), /不在选项里/);
  assert.deepEqual(F.cleanValue(multi, ['A', 'Q'], ['Q']), ['A', 'Q']);
  assert.throws(() => F.cleanValue({name: 't', type: 'text', options: []}, 'x'.repeat(201)), /200/);
  assert.throws(() => F.cleanValue({name: 't', type: 'textarea', options: []}, 'x'.repeat(2001)), /2000/);
  assert.equal(F.cleanValue({name: 't', type: 'text', options: []}, '  hi '), 'hi');
});

test('missingRequired: editable, touched, previous empty', () => {
  let s = mk(empty, 'customer', 'k', 'text', {required: true});
  s = mk(s, 'customer', 'm', 'multi', {options: ['A'], required: true});
  s = F.setSystemRequired(s, 'customer', 'phone', true);
  const st = F.get(s, 'customer'), systemLabels = {phone: '电话'};
  assert.deepEqual(F.missingRequired(st, {}, {systemLabels}), ['k', 'm', '电话']);
  assert.deepEqual(F.missingRequired(st, {k: 'x', m: ['A']}, {systemValues: {phone: '1'}, systemLabels}), []);
  assert.equal(F.missingRequired(st, {k: ' ', m: []}, {systemLabels}).length, 3);
  assert.deepEqual(F.missingRequired(st, {}, {editable: id => id === 'k', systemLabels}), ['k']);
  assert.deepEqual(F.missingRequired(st, {}, {previous: {}, previousSystem: {}, touched: new Set(), systemLabels}), []);
  assert.deepEqual(F.missingRequired(st, {}, {previous: {}, previousSystem: {}, touched: ['k', 'phone'], systemLabels}), ['k', '电话']);
  assert.deepEqual(F.missingRequired(st, {}, {previous: {k: 'old'}, previousSystem: {phone: '1'}, touched: new Set(), systemLabels}), ['k', '电话']);
});

test('formatValue', () => {
  assert.equal(F.formatValue({type: 'multi'}, ['A', 'B']), 'A、B');
  assert.equal(F.formatValue({type: 'number'}, 12.5), '12.5');
  assert.equal(F.formatValue({type: 'number'}, 0), '0');
  assert.equal(F.formatValue({type: 'text'}, undefined), '');
  assert.equal(F.formatValue({type: 'multi'}, []), '');
});
