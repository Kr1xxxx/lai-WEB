const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/role-model.js');
const M = require('../src/model.js');
const S = require('../src/segments.js');
const CS = require('../src/customer-settings-model.js');
const F = require('../src/customer-fields.js');

// 全局搜索也搜客户的自定义字段。
function build() {
  let state = {
    laiSettings: { defaultOwner: 'Kris' },
    customers: {
      Acme: { client: 'Acme', country: '美国', source: '官网', owner: 'Amy', history: [] },
      Beta: { client: 'Beta', country: '法国', source: '展会', owner: 'Amy', history: [] },
    },
    orders: [],
  };
  state = CS.addCustomField(state, { name: '工厂规模', type: 'text' });
  state = CS.addCustomField(state, { name: '认证', type: 'multi', options: ['ISO', 'CE'] });
  state = CS.addCustomField(state, { name: '签约日', type: 'date' });
  const id = Object.fromEntries(CS.customFieldSettings(state).customFields.map((f) => [f.name, f.id]));
  state = M.upsertCustomer(state, 'Acme', { name: 'Acme', custom: { [id['工厂规模']]: '两百人车间', [id['认证']]: ['ISO', 'CE'], [id['签约日']]: '2026-03-01' } });
  state = M.upsertCustomer(state, 'Beta', { name: 'Beta', custom: { [id['工厂规模']]: '三十人' } });
  return { state, id, col: (name) => 'custom:' + id[name] };
}
const run = (state, opts, hidden) => {
  const rows = S.enrich(M.buildCustomers(state), state);
  return F.globalCustomerSearch(rows, { state, hidden, ...opts }).map((row) => row.name);
};
const asSales = (state, fields) => {
  const withRole = R.updateRole(state, 'sales', { fields: { customer: fields, pool: {} } });
  return R.switchTo(withRole, R.settings(withRole).members.find((m) => m.name === 'Amy').id);
};

test('scope 全部 matches text and multi values; dates are skipped', () => {
  const { state } = build();
  assert.deepEqual(run(state, { query: '两百人' }), ['Acme']);
  assert.deepEqual(run(state, { query: 'iso' }), ['Acme']);
  assert.deepEqual(run(state, { query: '2026-03' }), [], 'date fields are not searched');
  assert.deepEqual(run(state, { query: '人' }).sort(), ['Acme', 'Beta']);
});

test('a field the role hides is not searched, in 全部 or on its own', () => {
  const { state, id, col } = build();
  const sales = asSales(state, { ['custom.' + id['工厂规模']]: 'hidden' });
  const hidden = F.gate(sales, 'customer').hiddenSearch();
  assert.ok(hidden.has(col('工厂规模')));
  assert.deepEqual(run(sales, { query: '两百人' }, hidden), []);
  assert.deepEqual(run(sales, { query: '两百人', field: col('工厂规模') }, hidden), []);
  assert.deepEqual(run(sales, { query: 'ISO' }, hidden), ['Acme'], 'a visible custom field still works');
  const admin = F.gate(state, 'customer').hiddenSearch();
  assert.deepEqual(run(state, { query: '两百人' }, admin), ['Acme']);
});

test('a deleted field is not searched', () => {
  const { state, id, col } = build();
  const gone = CS.deleteCustomField(state, id['工厂规模']);
  assert.ok(gone.customers.Acme.custom[id['工厂规模']], 'the value is still stored');
  assert.deepEqual(run(gone, { query: '两百人' }), []);
  assert.deepEqual(run(gone, { query: '两百人', field: col('工厂规模') }), []);
  assert.ok(!F.globalSearchFieldsFor(gone).some((f) => f.id === col('工厂规模')));
});

test('one custom field by its custom:<id> scope; menu lists fixed fields first, dates left out', () => {
  const { state, col } = build();
  assert.deepEqual(run(state, { query: '三十人', field: col('工厂规模') }), ['Beta']);
  assert.deepEqual(run(state, { query: '三十人', field: col('认证') }), []);
  assert.deepEqual(run(state, { query: 'CE', field: col('认证') }), ['Acme']);
  assert.deepEqual(run(state, { query: '2026', field: col('签约日') }), []);
  const list = F.globalSearchFieldsFor(state);
  assert.deepEqual(list.slice(0, F.globalSearchFields.length), [...F.globalSearchFields]);
  assert.deepEqual(list.slice(F.globalSearchFields.length).map((f) => [f.id, f.label]), [[col('工厂规模'), '工厂规模'], [col('认证'), '认证']]);
  assert.deepEqual(F.globalSearchFieldsFor({}), [...F.globalSearchFields]);
});
