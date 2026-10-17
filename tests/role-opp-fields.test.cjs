'use strict';
// 字段权限 for 商机: the field list, the markup that hides / disables fields, and the save-time locking.
// (The 线索 half went with the leads module, D-030.)
const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../src/opportunity-model.js');
const OU = require('../src/opportunity-ui.js');
const R = require('../src/role-model.js');
const { escapeHtml } = require('../src/model.js');

const NOW = '2026-10-01T00:00:00.000Z';
const TODAY = '2026-10-07';

// Roles are saved in laiSettings.roles; "业务" (sales) gets the given field levels. Kris is admin, Amy is 业务.
function withRole(state, fields, current = 'm-amy') {
  return {
    ...state,
    laiSettings: {
      ...(state.laiSettings || {}),
      defaultOwner: 'Amy',
      roles: { roles: [{ id: 'sales', name: '业务', scope: 'self', perms: { 'opp.view': true, 'opp.edit': true, 'opp.create': true }, fields }], members: [{ id: 'm-kris', name: 'Kris', roleId: 'admin' }, { id: 'm-amy', name: 'Amy', roleId: 'sales' }], current },
    },
  };
}
const levelOf = (state, module) => key => R.fieldLevel(state, module, key);

// ---------- field lists ----------
test('LaiOpportunityModel.roleFieldList lists optional fields plus custom.<id>; required and automatic ones are left out', () => {
  let state = O.addCustomField({}, { name: '客户等级', type: 'text' }, { id: 'c1' });
  state = O.addCustomField(state, { name: '采购量', type: 'number', required: true }, { id: 'c2' });
  const rows = O.roleFieldList(state);
  assert.deepEqual(rows.map(row => row.key), ['contact', 'collaborators', 'endDate', 'exchangeRate', 'type', 'sources', 'tags', 'note', 'products', 'custom.c1', 'custom.c2']);
  assert.deepEqual(rows.filter(row => row.key.startsWith('custom.')).map(row => [row.label, row.group]), [['客户等级', '自定义字段'], ['采购量', '自定义字段']]);
  for (const banned of ['client', 'name', 'amount', 'currency', 'stage', 'flow', 'owner', 'number', 'lostReason', 'leadId']) assert.ok(!rows.some(row => row.key === banned), banned);
  assert.ok(!O.roleFieldList({}).some(row => row.key.startsWith('custom.')));
});

// ---------- opportunities ----------
function oppState() {
  let state = { laiSettings: { defaultOwner: 'Amy' }, customers: { Alpha: { owner: 'Amy', contacts: ['Ann'] } }, orders: [] };
  state = O.addCustomField(state, { name: '客户等级', type: 'text' }, { id: 'c1' });
  state = O.addCustomField(state, { name: '备注2', type: 'text', required: true }, { id: 'c2' });
  return O.upsert(state, 'o1', { client: 'Alpha', contact: 'Ann', amount: '100', currency: 'USD', owner: 'Amy', endDate: '2026-11-05', note: 'old note', tags: ['vip'], products: 'Lash A, 2, 5', custom: { c1: 'gold', c2: 'must' } }, { now: NOW, today: '2026-10-01' });
}

test('a read-only opportunity custom field and other locked fields cannot change on save; the rest does', () => {
  const state = withRole(oppState(), { opp: { 'custom.c1': 'read', note: 'hidden', endDate: 'read', products: 'hidden', 'custom.c2': 'hidden' } });
  const locked = R.lockedFields(state, 'opp');
  assert.deepEqual([...locked].sort(), ['custom.c1', 'custom.c2', 'endDate', 'note', 'products']);
  const before = O.list(state)[0];
  // What the form sends: new name pieces, a changed amount, and attempts to change the locked ones.
  const input = O.lockInput(locked, before, { client: 'Alpha', contact: 'Ann', amount: '250', currency: 'USD', owner: 'Amy', endDate: '2030-01-01', note: 'hacked', products: 'X, 1, 1', tags: 'vip,new', custom: { c1: 'platinum', c2: 'nope' } }, O.defaults(state, '2026-10-07'));
  const saved = O.list(O.upsert(state, 'o1', input, { now: NOW, today: '2026-10-07', mustExist: true, locked }))[0];
  assert.equal(saved.amount, 250);
  assert.deepEqual(saved.tags, ['vip', 'new']);
  assert.equal(saved.endDate, '2026-11-05');
  assert.equal(saved.note, 'old note');
  assert.deepEqual(saved.products, before.products);
  assert.deepEqual(saved.custom, { c1: 'gold', c2: 'must' });
  // Admin is never locked.
  assert.deepEqual(R.lockedFields(withRole(oppState(), { opp: { note: 'hidden' } }, 'm-kris'), 'opp'), []);
});

test('a locked required field never blocks saving, and a new record gets default values for locked fields', () => {
  let state = O.addCustomField({ laiSettings: { defaultOwner: 'Amy' }, customers: { Alpha: { owner: 'Amy' } }, orders: [] }, { name: '必填项', type: 'text', required: true }, { id: 'r1' });
  state = O.setField(state, 'note', { required: true });
  const locked = ['note', 'custom.r1', 'endDate'];
  const input = O.lockInput(locked, null, { client: 'Alpha', amount: '5', currency: 'USD', owner: 'Amy', endDate: '2001-01-01', note: 'n', custom: { r1: 'x' } }, O.defaults(state, '2026-10-07'));
  assert.equal(input.endDate, '2026-11-06');
  assert.equal(input.note, '');
  assert.ok(!('r1' in input.custom));
  const made = O.list(O.upsert(state, 'new1', input, { now: NOW, today: '2026-10-07', locked }))[0];
  assert.equal(made.endDate, '2026-11-06');
  assert.equal(made.note, '');
  // Without the locked option the required note would block.
  assert.throws(() => O.upsert(state, 'new2', input, { now: NOW, today: '2026-10-07' }), /请填写/);
  // lockInput with nothing locked returns the input untouched.
  const same = { a: 1 };
  assert.equal(O.lockInput([], null, same), same);
});

test('opportunity board: a hidden 联系人/标签/结束日期 is not searchable, sortable or filterable', () => {
  const state = oppState();
  assert.equal(O.board(state, { search: 'Ann' }, TODAY).count, 1);
  assert.equal(O.board(state, { search: 'Ann', hidden: ['contact'] }, TODAY).count, 0);
  assert.equal(O.board(state, { search: 'vip' }, TODAY).count, 1);
  assert.equal(O.board(state, { search: 'vip', hidden: ['tags'] }, TODAY).count, 0);
  const board = O.board(state, { sort: 'endDate-asc', dateField: 'endDate', from: '2026-11-01', hidden: ['endDate'] }, TODAY);
  assert.equal(board.filters.sort, 'createdAt-desc');
  assert.equal(board.filters.dateField, 'createdAt');
  assert.equal(O.board(state, { sort: 'endDate-asc', dateField: 'endDate' }, TODAY).filters.sort, 'endDate-asc');
});

test('opportunity markup: hidden fields are gone from card, list, detail, form and analysis; read-only ones are disabled', () => {
  const state = oppState();
  const roleState = withRole(state, { opp: { endDate: 'hidden', note: 'hidden', tags: 'hidden', products: 'hidden', sources: 'hidden', 'custom.c1': 'hidden', contact: 'read', 'custom.c2': 'read' } });
  const ui = OU.create(escapeHtml, O, () => true, levelOf(roleState, 'opp'));
  const hidden = R.lockedFields(roleState, 'opp').filter(key => R.fieldLevel(roleState, 'opp', key) === 'hidden');
  const board = O.board(state, { hidden }, TODAY);
  const card = ui.cardMarkup(board.cards[0], TODAY);
  assert.ok(!card.includes('opp-due'), card);
  const html = ui.boardMarkup(board, { mode: 'board' }, { today: TODAY });
  assert.ok(!html.includes('endDate-asc') && !html.includes('value="endDate"'));
  assert.match(html, /placeholder="搜索名称、客户、联系人"/);
  const list = ui.boardMarkup(board, { mode: 'list' }, { today: TODAY });
  assert.ok(!list.includes('<th>结束日期</th>') && !list.includes('2026-11-05'));
  const detail = ui.detailMarkup(O.detailOf(state, 'o1', TODAY), { today: TODAY });
  assert.ok(!detail.includes('old note') && !detail.includes('Lash A') && !detail.includes('gold') && !detail.includes('2026-11-05'), detail);
  assert.ok(detail.includes('Ann') && detail.includes('must'));
  const form = ui.formMarkup(O.list(state)[0], { setup: O.formSetup(state), contacts: ['Ann'], customers: ['Alpha'], owners: ['Amy'], stages: O.STAGES, flows: [] });
  for (const name of ['endDate', 'note', 'tags', 'products', 'custom:c1']) assert.ok(!form.includes(`name="${name}"`), name);
  assert.match(form, /<select class="k-select-trigger" name="contact"[^>]*disabled/);
  assert.match(form, /name="custom:c2"[^>]*disabled/);
  assert.match(form, /name="amount"(?![^>]*disabled)/);
  const report = O.analysis(state, {}, TODAY);
  assert.ok(OU.create(escapeHtml, O).analysisMarkup(report, {}).includes('商机来源'));
  assert.ok(!OU.create(escapeHtml, O, () => true, key => key === 'sources' ? 'hidden' : 'edit').analysisMarkup(report, {}).includes('商机来源'));
});

test('read-only multi-select fields disable the whole group', () => {
  const state = O.addCustomField(oppState(), { name: '偏好', type: 'multi', options: 'A\nB' }, { id: 'm1' });
  const ui = OU.create(escapeHtml, O, () => true, key => (key === 'custom.m1' ? 'read' : 'edit'));
  const form = ui.formMarkup(O.list(state)[0], { setup: O.formSetup(state), stages: O.STAGES, flows: [] });
  assert.match(form, /<fieldset[^>]*data-multi="custom:m1" disabled/);
});
