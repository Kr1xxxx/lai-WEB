const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const D = require('../src/doc-template-model.js');
const R = require('../src/role-model.js');

const opp = { name: '春季询盘', amount: 999, products: [{ name: 'Cloud Lash', quantity: 20, unitPrice: 2.5 }] };
const roleState = (current) => ({
  customers: { A: { client: 'A' } },
  laiSettings: {
    roles: {
      roles: [{ id: 'sales', name: '业务', scope: 'self', perms: { 'customer.view': true }, v: 2, fields: { opp: { products: 'hidden', note: 'hidden', endDate: 'hidden' } } }],
      departments: [],
      members: [{ id: 'a', name: 'Kris', roleId: 'admin' }, { id: 'b', name: 'Amy', roleId: 'sales' }],
      current,
    },
  },
});

test('linesFromOpportunity: hideProducts uses the single opportunity line instead of the product rows', () => {
  assert.equal(D.linesFromOpportunity({}, opp)[0].name, 'Cloud Lash');
  assert.deepEqual(D.linesFromOpportunity({}, opp, { hideProducts: true }), [{ code: '', name: '春季询盘', model: '', unit: '', qty: 1, price: 999 }]);
  assert.deepEqual(D.linesFromOpportunity({}, opp, { hideProducts: false }), D.linesFromOpportunity({}, opp));
});

test('role fields: opportunity products hidden for a role, never for the admin', () => {
  assert.equal(R.fieldVisible(roleState('b'), 'opp', 'products'), false);
  assert.equal(R.fieldVisible(roleState('b'), 'opp', 'endDate'), false);
  assert.equal(R.fieldVisible(roleState('b'), 'opp', 'contact'), true);
  assert.equal(R.fieldVisible(roleState('a'), 'opp', 'products'), true);
});

test('business-ui passes hideProducts to the opportunity document lines', () => {
  const biz = fs.readFileSync(path.join(__dirname, '../src/business-ui.js'), 'utf8');
  assert.match(biz, /linesFromOpportunity\(state\(\), detail, \{ hideProducts: oppHidden\(\)\.includes\("products"\) \}\)/);
});

test('customer detail render: hidden opportunity fields are not rendered', () => {
  global.LaiRoleModel = R;
  try {
    const UI = require('../src/customer-detail-ui.js');
    const c = { name: 'A', owner: 'Amy', activeOpportunityCount: 1, activeOpportunityIndex: 0, activeOpportunities: [{ id: 'o', name: 'N', amount: 5, currency: 'USD', endDate: '2026-11-05', note: 'secret' }] };
    const render = (state) => UI.render(c, { state, escape: (v) => String(v), money: String, date: String, icon: () => '', tab: 'info' });
    const hidden = render(roleState('b'));
    assert.ok(hidden.includes('销售金额') && !hidden.includes('结束日期') && !hidden.includes('secret'));
    const admin = render(roleState('a'));
    assert.ok(admin.includes('结束日期') && admin.includes('secret'));
  } finally { delete global.LaiRoleModel; }
});
