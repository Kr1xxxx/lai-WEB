'use strict';
// 字段权限 for 线索 and 商机: the field lists, the markup that hides / disables fields, and the save-time locking.
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/lead-model.js');
const LU = require('../src/lead-ui.js');
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
      roles: { roles: [{ id: 'sales', name: '业务', scope: 'self', perms: { 'lead.view': true, 'lead.edit': true, 'opp.view': true, 'opp.edit': true, 'opp.create': true, 'lead.create': true }, fields }], members: [{ id: 'm-kris', name: 'Kris', roleId: 'admin' }, { id: 'm-amy', name: 'Amy', roleId: 'sales' }], current },
    },
  };
}
const levelOf = (state, module) => key => R.fieldLevel(state, module, key);

// ---------- field lists ----------
test('LaiLeadModel.roleFieldList lists the optional lead fields by their stored names', () => {
  const rows = L.roleFieldList({});
  assert.deepEqual(rows.map(row => row.key), ['contact', 'email', 'phone', 'country', 'website', 'source', 'product', 'note']);
  assert.ok(rows.every(row => row.label && row.group));
  for (const banned of ['name', 'owner', 'status', 'createdAt', 'updatedAt', 'nextFollow']) assert.ok(!rows.some(row => row.key === banned), banned);
});

test('LaiOpportunityModel.roleFieldList lists optional fields plus custom.<id>; required and automatic ones are left out', () => {
  let state = O.addCustomField({}, { name: '客户等级', type: 'text' }, { id: 'c1' });
  state = O.addCustomField(state, { name: '采购量', type: 'number', required: true }, { id: 'c2' });
  const rows = O.roleFieldList(state);
  assert.deepEqual(rows.map(row => row.key), ['contact', 'collaborators', 'endDate', 'exchangeRate', 'type', 'leadId', 'sources', 'tags', 'note', 'products', 'custom.c1', 'custom.c2']);
  assert.deepEqual(rows.filter(row => row.key.startsWith('custom.')).map(row => [row.label, row.group]), [['客户等级', '自定义字段'], ['采购量', '自定义字段']]);
  for (const banned of ['client', 'name', 'amount', 'currency', 'stage', 'flow', 'owner', 'number', 'lostReason']) assert.ok(!rows.some(row => row.key === banned), banned);
  assert.ok(!O.roleFieldList({}).some(row => row.key.startsWith('custom.')));
});

// ---------- leads ----------
test('a hidden or read-only lead field survives an edit, and cannot be set when creating', () => {
  let state = L.upsert({ laiSettings: {}, customers: {}, orders: [] }, 'l1', { name: 'Acme', contact: 'Ann', email: 'ann@acme.example', note: 'secret note', owner: 'Amy' }, { now: NOW });
  state = withRole(state, { lead: { email: 'hidden', note: 'read' } });
  const before = L.list(state)[0];
  // The form has no email input and a disabled note, so only the other fields arrive; someone also tries to push a note.
  const input = R.keepLocked(state, 'lead', before, { name: 'Acme Ltd', contact: 'Ann B', note: 'hacked', owner: 'Amy' });
  const saved = L.upsert(state, 'l1', input, { now: NOW, mustExist: true });
  const lead = L.list(saved)[0];
  assert.equal(lead.name, 'Acme Ltd');
  assert.equal(lead.contact, 'Ann B');
  assert.equal(lead.email, 'ann@acme.example');
  assert.equal(lead.note, 'secret note');
  // Creating: locked fields are dropped, the rest is saved.
  const created = R.keepLocked(state, 'lead', null, { name: 'New', email: 'x@y.example', note: 'n', contact: 'C' });
  const made = L.list(L.upsert(state, 'l2', created, { now: NOW })).find(item => item.id === 'l2');
  assert.equal(made.email, '');
  assert.equal(made.note, '');
  assert.equal(made.contact, 'C');
  // Admin is never locked.
  const admin = withRole(state, { lead: { email: 'hidden' } }, 'm-kris');
  assert.deepEqual(R.lockedFields(admin, 'lead'), []);
});

test('lead search and the source filter ignore a hidden field', () => {
  let state = L.upsert({ customers: {}, orders: [] }, 'l1', { name: 'Acme', email: 'ann@acme.example', source: '展会', owner: 'Amy' }, { now: NOW });
  state = L.upsert(state, 'l2', { name: 'Beta', source: '官网询盘', owner: 'Amy' }, { now: NOW });
  assert.equal(L.page(state, { search: 'ann@acme' }, TODAY).rows.length, 1);
  assert.equal(L.page(state, { search: 'ann@acme' }, TODAY, ['email']).rows.length, 0);
  assert.equal(L.page(state, { source: '展会' }, TODAY).rows.length, 1);
  const hidden = L.page(state, { source: '展会' }, TODAY, ['source']);
  assert.equal(hidden.rows.length, 2);
  assert.deepEqual(hidden.sources, []);
});

test('lead markup: hidden fields are gone from the list, detail and form; read-only ones are disabled', () => {
  const state = L.upsert({ customers: {}, orders: [] }, 'l1', { name: 'Acme', contact: 'Ann', email: 'ann@acme.example', phone: '123456', country: 'US', source: '展会', product: 'lashes', website: 'acme.example', note: 'private memo', owner: 'Amy' }, { now: NOW });
  const roleState = withRole(state, { lead: { email: 'hidden', phone: 'hidden', source: 'hidden', note: 'hidden', product: 'hidden', country: 'read', website: 'read' } });
  const ui = LU.create(escapeHtml, L, () => true, levelOf(roleState, 'lead'));
  const hidden = ['email', 'phone', 'source', 'note', 'product'];
  const page = L.page(state, {}, TODAY, hidden);
  const list = ui.pageMarkup(page, {}, TODAY);
  assert.ok(!list.includes('ann@acme.example') && !list.includes('lashes') && !list.includes('展会') && !list.includes('lead-source'), list);
  assert.ok(!list.includes('<th>来源</th>'));
  assert.ok(list.includes('<th>国家地区</th>') && list.includes('<th>联系人</th>') && list.includes('Ann'));
  assert.match(list, /placeholder="搜索名称、联系人"/);
  const detail = ui.detailMarkup(L.detail(state, 'l1', TODAY), TODAY);
  assert.ok(!detail.includes('ann@acme.example') && !detail.includes('private memo') && !detail.includes('lashes') && !detail.includes('展会'), detail);
  assert.ok(detail.includes('acme.example') && detail.includes('US'));
  const form = ui.formMarkup(L.list(state)[0], { sources: [], owners: [] });
  for (const name of ['email', 'phone', 'source', 'note', 'product']) assert.ok(!form.includes(`name="${name}"`), name);
  assert.match(form, /name="country"[^>]*disabled/);
  assert.match(form, /name="website"[^>]*disabled/);
  assert.match(form, /name="contact"(?![^>]*disabled)/);
  const trash = ui.trashMarkup(L.trash(L.setTrashed(state, 'l1', true), TODAY), '', TODAY);
  assert.ok(!trash.includes('ann@acme.example') && !trash.includes('<th>来源</th>'));
});

test('彻底删除 in the lead trash needs lead.purge', () => {
  const state = L.setTrashed(L.upsert({ customers: {}, orders: [] }, 'l1', { name: 'Acme', owner: 'Amy' }, { now: NOW }), 'l1', true);
  const rows = L.trash(state, TODAY);
  const make = keys => LU.create(escapeHtml, L, key => keys.includes(key)).trashMarkup(rows, '', TODAY);
  assert.ok(make(['lead.edit', 'lead.delete']).includes('data-lead-action="restore"'));
  assert.ok(!make(['lead.edit', 'lead.delete']).includes('data-lead-action="delete"'), 'lead.delete alone does not purge');
  assert.ok(make(['lead.edit', 'lead.purge']).includes('data-lead-action="delete"'));
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
