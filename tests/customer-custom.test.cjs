const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/role-model.js');
const M = require('../src/model.js');
const FM = require('../src/field-model.js');
const CS = require('../src/customer-settings-model.js');
const CT = require('../src/customer-tools.js');
const F = require('../src/customer-fields.js');
const Editor = require('../src/customer-editor-ui.js');
const Detail = require('../src/customer-detail-ui.js');
const UI = require('../src/customer-settings-ui.js');

// 客户自定义字段（CF-1）：设置在 laiSettings.fieldSettings.customer，值在 customers[name].custom。
const base = () => ({
  laiSettings: { defaultOwner: 'Kris' },
  customers: {
    Acme: { client: 'Acme', country: '美国', source: '官网', owner: 'Amy', email: 'ann@acme.example', history: [] },
    Beta: { client: 'Beta', country: '法国', source: '展会', owner: 'Amy', email: '', history: [] },
  },
  orders: [],
});
function withFields(state = base()) {
  state = CS.addCustomField(state, { name: '工厂规模', type: 'text' });
  state = CS.addCustomField(state, { name: '年采购额', type: 'number' });
  state = CS.addCustomField(state, { name: '认证', type: 'multi', options: 'ISO, CE, FDA' });
  state = CS.addCustomField(state, { name: '渠道', type: 'select', options: ['线上', '线下'] });
  return state;
}
const ids = (state) => Object.fromEntries(CS.customFieldSettings(state).customFields.map((f) => [f.name, f.id]));
function asSales(state, fields) {
  state = R.updateRole(state, 'sales', { fields: { customer: fields, pool: {} } });
  return R.switchTo(state, R.settings(state).members.find((m) => m.name === 'Amy').id);
}

test('upsertCustomer stores custom values cleaned by type and keeps them on later edits', () => {
  let state = withFields();
  const id = ids(state);
  state = M.upsertCustomer(state, 'Acme', { name: 'Acme', custom: { [id['工厂规模']]: ' 200 人 ', [id['年采购额']]: '+12000', [id['认证']]: ['iso', 'CE'], [id['渠道']]: '线上', ghost: 'x' } });
  assert.deepEqual(state.customers.Acme.custom, { [id['工厂规模']]: '200 人', [id['年采购额']]: 12000, [id['认证']]: ['ISO', 'CE'], [id['渠道']]: '线上' });
  // Fields not sent stay; an empty value removes only that field; unknown ids are ignored.
  state = M.upsertCustomer(state, 'Acme', { name: 'Acme', custom: { [id['工厂规模']]: '' } });
  assert.deepEqual(state.customers.Acme.custom, { [id['年采购额']]: 12000, [id['认证']]: ['ISO', 'CE'], [id['渠道']]: '线上' });
  state = M.upsertCustomer(state, 'Acme', { name: 'Acme', website: 'acme.example' });
  assert.equal(state.customers.Acme.custom[id['年采购额']], 12000, 'a save without custom keeps the values');
  assert.throws(() => M.upsertCustomer(state, 'Acme', { name: 'Acme', custom: { [id['年采购额']]: '1,000' } }), /年采购额/);
  assert.throws(() => M.upsertCustomer(state, 'Acme', { name: 'Acme', custom: { [id['渠道']]: '电话' } }), /不在选项里/);
  assert.throws(() => M.upsertCustomer(state, 'Acme', { name: 'Acme', custom: 'x' }), /格式无效/);
  // A deleted field's value stays in the record; a deleted option's stored value is still accepted unchanged.
  state = CS.removeFieldOption(state, id['渠道'], '线上');
  state = M.upsertCustomer(state, 'Acme', { name: 'Acme', custom: { [id['渠道']]: '线上' } });
  assert.equal(state.customers.Acme.custom[id['渠道']], '线上');
  state = CS.deleteCustomField(state, id['年采购额']);
  state = M.upsertCustomer(state, 'Acme', { name: 'Acme', custom: { [id['年采购额']]: '5' } });
  assert.equal(state.customers.Acme.custom[id['年采购额']], 12000, 'a deleted field is not written but its value is kept');
});

test('required is checked only by the editor path, not by upsertCustomer, batch create or merge', () => {
  let state = withFields();
  const id = ids(state);
  state = CS.setCustomRequired(state, id['工厂规模'], true);
  state = CS.setSystemRequired(state, 'email', true);
  // The model saves without the required values: only the editor form checks them.
  const saved = M.upsertCustomer(state, '', { name: 'Gamma', country: '德国', source: '官网' });
  assert.ok(saved.customers.Gamma);
  const batch = CT.batchCreate(state, 'Delta\nEpsilon', { country: '德国', source: '官网' });
  assert.ok(batch.state.customers.Delta && batch.state.customers.Epsilon, 'batch create is not blocked by required fields');
  assert.deepEqual(CS.missingRequired(state, { values: {}, systemValues: {} }), ['工厂规模', '联系人邮箱']);
  assert.throws(() => CS.assertRequired(state, { values: {}, systemValues: { email: '' } }), /请填写工厂规模、联系人邮箱/);
  assert.doesNotThrow(() => CS.assertRequired(state, { values: { [id['工厂规模']]: '大' }, systemValues: { email: 'a@b.c' } }));
  // Multi values count when at least one option is picked.
  state = CS.setCustomRequired(state, id['认证'], true);
  assert.deepEqual(CS.missingRequired(state, { values: { [id['工厂规模']]: '大', [id['认证']]: [] }, systemValues: { email: 'a@b.c' } }), ['认证']);
});

test('touched: an old empty field blocks only when touched; a cleared field always blocks', () => {
  let state = withFields();
  const id = ids(state);
  state = CS.setCustomRequired(state, id['工厂规模'], true);
  state = CS.setSystemRequired(state, 'website', true);
  const previous = { [id['工厂规模']]: '' }, previousSystem = { website: '' };
  // Editing an old record that never had these values: not blocked while untouched.
  assert.deepEqual(CS.missingRequired(state, { values: {}, systemValues: { website: '' }, previous, previousSystem, touched: new Set() }), []);
  // Touched and still empty: blocked.
  assert.deepEqual(CS.missingRequired(state, { values: {}, systemValues: { website: '' }, previous, previousSystem, touched: new Set(['website', id['工厂规模']]) }), ['工厂规模', '公司网址']);
  // It had a value and now is empty: blocked even without the touched mark.
  assert.deepEqual(CS.missingRequired(state, { values: { [id['工厂规模']]: '' }, systemValues: { website: '' }, previous: { [id['工厂规模']]: '大' }, previousSystem: { website: 'a.example' }, touched: [] }), ['工厂规模', '公司网址']);
});

test('required skips fields the account cannot edit (read-only or hidden)', () => {
  let state = withFields();
  const id = ids(state);
  state = CS.setCustomRequired(state, id['工厂规模'], true);
  state = CS.setSystemRequired(state, 'phone', true);
  const sales = asSales(state, { ['custom.' + id['工厂规模']]: 'read', 'contact.phone': 'hidden' });
  const gate = F.gate(sales, 'customer');
  assert.deepEqual(CS.missingRequired(sales, { values: {}, systemValues: {}, gate }), []);
  assert.deepEqual(CS.missingRequired(state, { values: {}, systemValues: {}, gate: F.gate(state, 'customer') }), ['工厂规模', '联系电话']);
});

test('lockedBy: a field a role sets 只读 or 隐藏 cannot be made required; unsetting is always allowed', () => {
  let state = withFields();
  const id = ids(state);
  state = CS.setSystemRequired(state, 'customerStage', true);
  state = R.updateRole(state, 'sales', { fields: { customer: { customerStage: 'read', ['custom.' + id['渠道']]: 'hidden' }, pool: { website: 'hidden' } } });
  assert.throws(() => CS.setSystemRequired(state, 'website', true), /角色「业务」把这个字段设为只读或隐藏，不能同时必填/);
  assert.throws(() => CS.setCustomRequired(state, id['渠道'], true), /角色「业务」/);
  assert.doesNotThrow(() => CS.setSystemRequired(state, 'email', true));
  const off = CS.setSystemRequired(state, 'customerStage', false);
  assert.equal(CS.customFieldSettings(off).required.customerStage, undefined);
  assert.throws(() => CS.setSystemRequired(state, 'note', true), /不能设为必填/);
  const rows = CS.fieldRows(state);
  assert.equal(rows.system.find((r) => r.id === 'website').locked[0].role, '业务');
  assert.equal(rows.custom.find((r) => r.id === id['渠道']).locked[0].level, 'hidden');
});

test('custom fields: rename, move, options, limits and reserved names', () => {
  let state = withFields();
  const id = ids(state);
  assert.throws(() => CS.addCustomField(state, { name: '客户阶段', type: 'text' }), /同名/);
  assert.throws(() => CS.renameCustomField(state, id['渠道'], '认证'), /同名/);
  state = CS.renameCustomField(state, id['渠道'], '销售渠道');
  state = CS.moveCustomField(state, id['销售渠道'] || id['渠道'], -1);
  assert.deepEqual(CS.customFieldSettings(state).customFields.map((f) => f.name), ['工厂规模', '年采购额', '销售渠道', '认证']);
  state = CS.addFieldOption(state, id['渠道'], '展会');
  assert.throws(() => CS.addFieldOption(state, id['渠道'], '展会'), /已经有/);
  state = CS.moveFieldOption(state, id['渠道'], '展会', -1);
  assert.deepEqual(CS.customFieldSettings(state).customFields.find((f) => f.id === id['渠道']).options, ['线上', '展会', '线下']);
  assert.throws(() => CS.addFieldOption(state, id['工厂规模'], 'x'), /没有选项/);
  for (let i = CS.customFieldSettings(state).customFields.length; i < FM.LIMIT; i++) state = CS.addCustomField(state, { name: `字段${i}`, type: 'text' });
  assert.throws(() => CS.addCustomField(state, { name: '多一个', type: 'text' }), /最多/);
});

test('merge: the kept customer wins, its empty custom values are filled from the merged ones', () => {
  let state = withFields();
  const id = ids(state);
  state = M.upsertCustomer(state, 'Acme', { name: 'Acme', custom: { [id['工厂规模']]: '大' } });
  state = M.upsertCustomer(state, 'Beta', { name: 'Beta', custom: { [id['工厂规模']]: '小', [id['认证']]: ['CE'] } });
  state.customers.Beta.custom.old = '已删字段的值';
  const merged = CT.mergeCustomers(state, 'Acme', ['Beta']);
  assert.deepEqual(merged.customers.Acme.custom, { [id['工厂规模']]: '大', [id['认证']]: ['CE'], old: '已删字段的值' });
});

test('role field list has custom.<id> keys; guardProfile keeps locked custom values', () => {
  let state = withFields();
  const id = ids(state);
  const keys = F.roleFieldList(state, 'customer').filter((r) => r.group === '自定义字段');
  assert.deepEqual(keys.map((r) => r.key), Object.values(id).map((v) => 'custom.' + v));
  assert.deepEqual(keys.map((r) => r.label), ['工厂规模', '年采购额', '认证', '渠道']);
  state = M.upsertCustomer(state, 'Acme', { name: 'Acme', custom: { [id['工厂规模']]: '大', [id['渠道']]: '线上' } });
  const sales = asSales(state, { ['custom.' + id['工厂规模']]: 'read', ['custom.' + id['渠道']]: 'hidden' });
  const before = sales.customers.Acme;
  const after = M.upsertCustomer(sales, 'Acme', { name: 'Acme', custom: { [id['工厂规模']]: '小', [id['渠道']]: '', [id['年采购额']]: '9' } }).customers.Acme;
  const guarded = F.guardProfile(sales, before, after);
  assert.deepEqual(guarded.custom, { [id['工厂规模']]: '大', [id['渠道']]: '线上', [id['年采购额']]: 9 });
  // New customers cannot fill locked custom fields.
  const created = M.upsertCustomer(sales, '', { name: 'New', country: '德国', source: '官网', custom: { [id['工厂规模']]: '中' } }).customers.New;
  assert.deepEqual(F.guardProfile(sales, null, created).custom, {});
});

test('editor draws the custom section with required stars; hidden fields are left out, read-only ones disabled', () => {
  let state = withFields();
  const id = ids(state);
  state = CS.setCustomRequired(state, id['工厂规模'], true);
  state = CS.setSystemRequired(state, 'website', true);
  state = M.upsertCustomer(state, 'Acme', { name: 'Acme', custom: { [id['认证']]: ['CE'], [id['渠道']]: '线下' } });
  const html = Editor.render({ ...state.customers.Acme, name: 'Acme' }, { state }).body;
  assert.match(html, /<h3>自定义字段<\/h3>/);
  assert.match(html, new RegExp(`data-custom-id="${id['工厂规模']}"[^>]*><label[^>]*><span class="ce-required"`));
  assert.match(html, /<label for="ce-website"><span class="ce-required"/);
  assert.match(html, new RegExp(`name="custom.${id['认证']}" value="CE" checked`));
  assert.match(html, /<option value="线下" selected>/);
  const sales = asSales(state, { ['custom.' + id['渠道']]: 'hidden', ['custom.' + id['认证']]: 'read', website: 'read' });
  const limited = Editor.render({ ...sales.customers.Acme, name: 'Acme' }, { state: sales }).body;
  assert.ok(!limited.includes(`data-custom-id="${id['渠道']}"`), 'hidden custom field not drawn');
  assert.match(limited, new RegExp(`data-role-readonly[^>]*data-custom-id="${id['认证']}"`));
  assert.doesNotMatch(limited, /<label for="ce-website"><span class="ce-required"/, 'no star on a read-only field');
});

test('detail shows custom values in order and hides fields the role cannot see', () => {
  let state = withFields();
  const id = ids(state);
  state = M.upsertCustomer(state, 'Acme', { name: 'Acme', custom: { [id['工厂规模']]: '大', [id['认证']]: ['ISO', 'CE'] } });
  const row = M.buildCustomers(state).find((c) => c.name === 'Acme');
  const html = Detail.render(row, { state, tab: 'info' });
  assert.match(html, /自定义字段/);
  assert.match(html, /<dt>工厂规模<\/dt><dd>大<\/dd>/);
  assert.match(html, /<dt>认证<\/dt><dd>ISO、CE<\/dd>/);
  const sales = asSales(state, { ['custom.' + id['工厂规模']]: 'hidden' });
  const limited = Detail.render(M.buildCustomers(sales).find((c) => c.name === 'Acme'), { state: sales, tab: 'info' });
  assert.doesNotMatch(limited, /工厂规模/);
  assert.match(limited, /<dt>认证<\/dt>/);
});

test('settings tab 字段设置 draws the system switches and custom fields', () => {
  let state = withFields();
  state = R.updateRole(state, 'sales', { fields: { customer: { timezone: 'read' }, pool: {} } });
  const E = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const html = UI.markup(state, { tab: 'fields' }, E, []);
  for (const f of CS.SYSTEM_REQUIRED) assert.ok(html.includes(`data-cf-sys="${f.id}"`), f.id);
  assert.match(html, /data-cf-sys="timezone" disabled/);
  assert.match(html, /角色「业务」把这个字段设为只读，不能必填/);
  assert.match(html, /自定义字段（4\/30）/);
  assert.match(html, /data-cf-form="option"/);
  assert.match(html, /data-cf-form="add"/);
  assert.ok(UI.fieldsController && typeof UI.fieldsController.click === 'function');
});
