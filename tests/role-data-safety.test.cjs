'use strict';
// 字段权限 must never lose customer data: system operations (merge, settings renames, tag manager) do not go through the
// field guard, the guard keeps contact lists and contacts with locked values, and older role data keeps its custom roles.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../src/role-model.js');
const M = require('../src/model.js');
const F = require('../src/customer-fields.js');
const CT = require('../src/customer-tools.js');
const CS = require('../src/customer-settings-model.js');
const O = require('../src/opportunity-model.js');
const { appSource } = require('./helpers/source.cjs');

const NOW = '2026-10-01T00:00:00.000Z';
// Roles as stored by older versions: 业务 with field levels, Boss is admin, Amy is 业务 and the current account.
function withSales(state, fields, perms = {}) {
  return {
    ...state,
    laiSettings: {
      ...(state.laiSettings || {}),
      roles: {
        roles: [{ id: 'sales', name: '业务', scope: 'all', perms: { 'customer.view': true, 'customer.edit': true, 'customer.merge': true, ...perms }, fields: { customer: fields } }],
        members: [{ id: 'm1', name: 'Boss', roleId: 'admin' }, { id: 'm2', name: 'Amy', roleId: 'sales' }],
        current: 'm2',
      },
    },
  };
}

// ---------- 1. merge ----------
test('merging customers as a restricted account keeps every value of the merged customer', () => {
  const state = withSales({
    orders: [],
    customers: {
      Keep: { owner: 'Amy', country: 'US', email: 'k@x.com', emails: ['k@x.com'], phone: '111', phones: ['111'], contact: 'K', contacts: ['K'] },
      Dup: { owner: 'Amy', country: 'US', email: 'd@x.com', emails: ['d@x.com'], phone: '222', phones: ['222'], contact: 'D', contacts: ['D'], website: 'dup.com', note: 'important' },
    },
  }, { 'contact.phone': 'read', website: 'read', note: 'hidden' });
  assert.equal(R.isAdmin(state), false);
  const merged = CT.mergeCustomers(state, 'Keep', ['Dup'], NOW);
  const keep = merged.customers.Keep;
  assert.equal(merged.customers.Dup, undefined, 'the merged customer is removed');
  assert.equal(keep.website, 'dup.com');
  assert.match(keep.note, /important/);
  const moved = keep.extraContacts.find((c) => c.email === 'd@x.com');
  assert.ok(moved, 'the merged contact is kept');
  assert.equal(moved.phone, '222', 'the locked phone of the merged contact is kept');
  // This is why merge must not go through the field guard: the guard would treat the moved values as new input and drop them.
  const guarded = F.guardState(state, merged);
  assert.notEqual(guarded.customers.Keep.website, 'dup.com');
  // app.js: the merge saves with guard:false.
  const app = appSource();
  assert.match(app, /CT\.mergeCustomers\(state, primary[^\n]*\n[^\n]*\n\s*\{ guard: false \},/);
});

// ---------- 2. contact lists ----------
test('a locked email never rebuilds the email list on an unrelated save (no top-level email, longer list)', () => {
  const state = withSales({ customers: {} }, { 'contact.email': 'read', website: 'read' });
  const shapes = {
    A: { owner: 'Amy', emails: ['a@x.com', 'b@x.com'], extraContacts: [{ id: 'c1', email: 'b@x.com' }] },
    B: { owner: 'Amy', email: 'a', emails: ['a', 'b', 'c'], extraContacts: [{ id: 'c1', email: 'b' }] },
  };
  for (const before of Object.values(shapes)) {
    const after = { ...before, history: [{ text: 'x' }] };
    const out = F.guardProfile(state, before, after);
    assert.deepEqual(out.emails, before.emails);
    assert.deepEqual(out.extraContacts, before.extraContacts);
    assert.deepEqual(out.history, [{ text: 'x' }]);
  }
  // A follow-up on shape B through guardState keeps all three emails.
  const s = { ...state, customers: { B: shapes.B } };
  const next = M.addFollowup(s, 'B', '回访', '', undefined);
  assert.deepEqual(F.guardState(s, next).customers.B.emails, ['a', 'b', 'c']);
  // A user edit that tries to change the email list gets the old list back.
  const tampered = { ...shapes.B, emails: ['z'] };
  assert.deepEqual(F.guardProfile(state, shapes.B, tampered).emails, ['a', 'b', 'c']);
  // A new customer (import) cannot fill a locked list.
  assert.equal(Object.hasOwn(F.guardProfile(state, null, { owner: 'Amy', email: 'n@x.com', emails: ['n@x.com'] }), 'emails'), false);
});

// ---------- 3. settings renames, tag manager ----------
test('stage, group and tag renames change the customers; app.js saves them without the field guard', () => {
  let state = withSales({ customers: { Acme: { owner: 'Amy', customerStage: '新询盘', previewGroup: '', tags: ['vip'] } } }, { customerStage: 'read', previewGroup: 'read', tags: 'read' }, { 'settings.customer': true });
  const stages = CS.get(state).stages;
  state = { ...state, customers: { Acme: { ...state.customers.Acme, customerStage: stages[0] } } };
  const renamed = CS.renameStage(state, stages[0], '改名阶段', NOW);
  assert.equal(renamed.customers.Acme.customerStage, '改名阶段');
  assert.equal(F.guardState(state, renamed).customers.Acme.customerStage, stages[0], 'the guard would undo it');
  const tagged = CT.renameTag(state, 'vip', '重点', NOW).state;
  assert.deepEqual(tagged.customers.Acme.tags, ['重点']);
  const app = appSource();
  assert.match(app, /async function csSave[\s\S]{0,400}await persist\(makeNext\(\), null, \{ guard: false \}\);/);
  assert.match(app, /await persist\(fn\(\)\.state, null, \{ guard: false \}\)/, 'tag manager');
  assert.match(app, /persist\(CT\.markAutoRun\(result\.state\), null, \{ guard: false \}\)/, 'daily pool rules');
  assert.match(app, /async function persist\(next, importLog = null, \{ guard = true \} = \{\}\) \{\n[^\n]*\n\s*if \(guard\) next = C\.guardState\(state, next\);/, 'guarded by default');
  // User-typed paths stay guarded: the customer form, imports and paste batch-create (new customers too).
  assert.match(app, /C\.guardProfile\(state, before, next\.customers\[saved\]\)/);
  assert.match(app, /persist\(C\.guardState\(state, prepared\.state, \{ includeNew: true \}\)/);
  assert.match(app, /persist\(C\.guardState\(state, result\.state, \{ includeNew: true \}\)\)/);
  assert.equal((app.match(/guard: false/g) || []).length, 4, 'only merge, customer settings, tag manager and the daily pool run skip the guard');
});

// ---------- 4. custom role named like a new built-in ----------
test('a stored custom role named 部门管理员 is kept under a new name and its members keep it', () => {
  const v1 = { laiSettings: { roles: {
    roles: [
      { id: 'sales', name: '业务', scope: 'self', perms: { 'customer.view': true } },
      { id: 'r-dept', name: '部门管理员', scope: 'all', perms: { 'customer.view': true, 'customer.edit': true } },
      { id: 'r-dept2', name: '部门管理员（自建）', scope: 'self', perms: { 'customer.view': true } },
      { id: 'r-dup', name: '部门管理员', scope: 'self', perms: { 'customer.view': true } },
    ],
    members: [{ id: 'm1', name: 'Boss', roleId: 'admin' }, { id: 'm2', name: 'Lee', roleId: 'r-dept' }, { id: 'm3', name: 'Zoe', roleId: 'r-dup' }],
    current: 'm1',
  } } };
  const s = R.settings(v1);
  const names = s.roles.map((r) => r.name);
  assert.equal(new Set(names).size, names.length, 'names stay unique');
  assert.deepEqual(names, ['系统管理员', '业务', '部门管理员', '部门管理员（自建）2', '部门管理员（自建）', '部门管理员（自建）3']);
  assert.equal(s.roles.find((r) => r.id === 'r-dept').name, '部门管理员（自建）2', 'the stored 部门管理员（自建） keeps its own name');
  assert.equal(s.roles.find((r) => r.id === 'r-dept2').name, '部门管理员（自建）');
  assert.equal(s.roles.find((r) => r.id === 'r-dept').scope, 'all');
  assert.equal(s.members.find((m) => m.name === 'Lee').roleId, 'r-dept');
  assert.equal(s.members.find((m) => m.name === 'Zoe').roleId, 'r-dup');
  // A long name stays within the name limit.
  const long = { laiSettings: { roles: { roles: [{ id: 'r1', name: '一二三四五六七八九十一二三四五六七八九十' }, { id: 'r2', name: '一二三四五六七八九十一二三四五六七八九十' }], members: [{ id: 'm1', name: 'Boss', roleId: 'admin' }], current: 'm1' } } };
  const longNames = R.settings(long).roles.map((r) => r.name);
  assert.equal(longNames.length, 5);
  assert.ok(longNames.every((name) => [...name].length <= 20));
  assert.equal(longNames[4], '一二三四五六七八九十一二三四（自建）');
});

// ---------- 5. removing a contact with locked values ----------
test('the editor hides 移除 for a contact with locked values; the guard puts such a contact back', () => {
  const Editor = require('../src/customer-editor-ui.js');
  const base = {
    laiSettings: { defaultOwner: 'Boss' }, orders: [],
    customers: { Acme: { client: 'Acme', country: '美国', source: '官网', owner: 'Amy', contact: 'Ann', email: 'ann@x.com', emails: ['ann@x.com', 'bob@x.com', ''],
      extraContacts: [{ id: 'x1', contact: 'Bob', email: 'bob@x.com' }, { id: 'x2', contact: 'Cid' }] } },
  };
  const state = withSales(base, { 'contact.email': 'hidden' });
  const body = Editor.render({ ...state.customers.Acme, name: 'Acme' }, { state, escape: M.escapeHtml }).body;
  assert.equal((body.match(/aria-disabled="true" data-contact-locked title="这个联系人有你不能修改的资料，不能移除"/g) || []).length, 1, 'only Bob has a hidden email');
  assert.equal((body.match(/data-editor-action="remove-contact"/g) || []).length, 2, 'Cid (no locked value) and the new-contact template can still be removed');
  // The admin can remove every contact.
  const admin = R.switchTo(state, 'm1');
  assert.ok(!Editor.render({ ...admin.customers.Acme, name: 'Acme' }, { state: admin, escape: M.escapeHtml }).body.includes('data-contact-locked'));
  const before = state.customers.Acme;
  const after = { ...before, extraContacts: [] };
  const out = F.guardProfile(state, before, after);
  assert.deepEqual(out.extraContacts, [before.extraContacts[0]], 'Bob comes back, Cid is removed');
});

// ---------- 7, 8. opportunities ----------
function oppState(fields) {
  let state = { laiSettings: { defaultOwner: 'Amy' }, customers: { Alpha: { owner: 'Amy', contacts: ['Ann'] }, Beta: { owner: 'Amy', contacts: ['Ben'] } }, orders: [] };
  state = O.upsert(state, 'o1', { client: 'Alpha', contact: 'Ann', amount: '100', currency: 'USD', owner: 'Amy', endDate: '2026-11-05' }, { now: NOW, today: '2026-10-01' });
  return { ...state, laiSettings: { ...state.laiSettings, roles: { roles: [{ id: 'sales', name: '业务', scope: 'all', perms: { 'opp.view': true, 'opp.edit': true }, fields: { opp: fields } }], members: [{ id: 'm1', name: 'Boss', roleId: 'admin' }, { id: 'm2', name: 'Amy', roleId: 'sales' }], current: 'm2' } } };
}
test('changing the customer of an opportunity whose contact is locked clears the contact', () => {
  const state = oppState({ contact: 'read' });
  const locked = R.lockedFields(state, 'opp');
  const before = O.list(state)[0];
  const input = O.lockInput(locked, before, { client: 'Beta', amount: '100', currency: 'USD', owner: 'Amy', endDate: '2026-11-05' }, O.defaults(state, '2026-10-07'));
  const saved = O.list(O.upsert(state, 'o1', input, { now: NOW, today: '2026-10-07', mustExist: true, locked }))[0];
  assert.equal(saved.client, 'Beta');
  assert.equal(saved.contact, '', 'Ann belongs to Alpha');
  // Same customer: the locked contact stays.
  const same = O.lockInput(locked, before, { client: 'Alpha', contact: 'X', amount: '200', currency: 'USD', owner: 'Amy', endDate: '2026-11-05' }, O.defaults(state, '2026-10-07'));
  assert.equal(O.list(O.upsert(state, 'o1', same, { now: NOW, today: '2026-10-07', mustExist: true, locked }))[0].contact, 'Ann');
});
test('a locked end date that is empty on an old opportunity does not block saving; an unlocked one still does', () => {
  const legacy = oppState({ endDate: 'read' });
  legacy.laiOpportunities = legacy.laiOpportunities.map((item) => ({ ...item, endDate: '' }));
  const locked = R.lockedFields(legacy, 'opp');
  const before = O.list(legacy)[0];
  const input = O.lockInput(locked, before, { client: 'Alpha', contact: 'Ann', amount: '300', currency: 'USD', owner: 'Amy', endDate: '2030-01-01' }, O.defaults(legacy, '2026-10-07'));
  const saved = O.list(O.upsert(legacy, 'o1', input, { now: NOW, today: '2026-10-07', mustExist: true, locked }))[0];
  assert.equal(saved.amount, 300);
  assert.equal(saved.endDate, '');
  assert.throws(() => O.upsert(legacy, 'o1', { client: 'Alpha', contact: 'Ann', amount: '300', currency: 'USD', owner: 'Amy', endDate: '' }, { now: NOW, today: '2026-10-07', mustExist: true }), /结束日期/);
});

// ---------- 10. fieldLevel ----------
test('fieldLevel ignores inherited properties and unknown levels', () => {
  const state = withSales({ customers: {} }, { website: 'read' });
  assert.equal(R.fieldLevel(state, 'customer', 'constructor'), 'edit');
  assert.equal(R.fieldLevel(state, 'customer', 'toString'), 'edit');
  assert.equal(R.fieldLevel(state, 'customer', '__proto__'), 'edit');
  assert.equal(R.fieldLevel(state, 'customer', 'website'), 'read');
  assert.equal(R.fieldLevel(state, 'customer', 'note'), 'edit');
  assert.equal(R.fieldLevel(state, 'lead', 'constructor'), 'edit');
});
