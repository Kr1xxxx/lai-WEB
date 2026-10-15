'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/lead-model.js');
const CSM = require('../src/customer-settings-model.js');

const NOW = '2026-10-07T03:00:00.000Z', TODAY = '2026-10-07';
const add = (state, id, fields) => L.upsert(state, id, { name: 'Lead ' + id, ...fields }, { now: NOW });
const get = (state, id) => L.list(state).find(item => item.id === id);
const withModes = (state, modes) => ({ ...state, laiSettings: { ...state.laiSettings, customerSettings: { leadDedupe: modes } } });
const ALL = mode => ({ name: mode, website: mode, email: mode, phone: mode });
const dedupeBase = modes => withModes({
  customers: {
    'Acme Trading': { client: 'Acme Trading', website: 'https://www.Acme.com/about/', email: 'Buy@Acme.example', phone: '+1 (555) 010-2030', extraContacts: [{ email: 'boss@acme.example', phone: '86-755-8888 0000' }] },
    'Old Co': { client: 'Old Co', laiBucket: 'trash', email: 'old@old.example', website: 'old.example' },
    'Pool Co': { client: 'Pool Co', laiBucket: 'pool', email: 'pool@pool.example' }
  },
  orders: []
}, modes);

test('lead dedupe defaults: all four fields are 判重且不允许保存, and settings round-trip', () => {
  assert.deepEqual(CSM.get({}).leadDedupe, ALL('block'));
  assert.deepEqual(CSM.get({ laiSettings: { customerSettings: { leadDedupe: { email: 'bogus', phone: 'off' } } } }).leadDedupe, { name: 'block', website: 'block', email: 'block', phone: 'off' });
  const saved = CSM.setLeadDedupe({}, { name: 'allow', website: 'off', email: 'block', phone: 'allow' });
  assert.deepEqual(CSM.get(saved).leadDedupe, { name: 'allow', website: 'off', email: 'block', phone: 'allow' });
  assert.deepEqual(CSM.get(saved).dedupe, CSM.get({}).dedupe, 'customer dedupe untouched');
  assert.throws(() => CSM.setLeadDedupe({}, { name: 'allow' }), /请选择/);
});

test('conflict matching: website host, email address (case), phone digits, name; trash ignored, pool counted', () => {
  const state = dedupeBase(ALL('block'));
  const hit = lead => L.customerConflicts(state, lead).map(c => c.field + ':' + c.customer);
  assert.deepEqual(hit({ website: 'HTTP://acme.com' }), ['website:Acme Trading']);
  assert.deepEqual(hit({ website: 'www.acme.com/products?x=1' }), ['website:Acme Trading']);
  assert.deepEqual(hit({ website: 'shop.acme.com' }), [], 'a sub-domain is another host');
  assert.deepEqual(hit({ email: 'BUY@acme.example' }), ['email:Acme Trading']);
  assert.deepEqual(hit({ email: 'boss@ACME.example' }), ['email:Acme Trading'], 'other contacts count');
  assert.deepEqual(hit({ email: 'someone@acme.example' }), [], 'same domain is not a match');
  assert.deepEqual(hit({ phone: '15550102030' }), ['phone:Acme Trading']);
  assert.deepEqual(hit({ phone: '+86 755 8888-0000' }), ['phone:Acme Trading']);
  assert.deepEqual(hit({ phone: '12345' }), [], 'fewer than 6 digits is ignored');
  assert.deepEqual(hit({ name: ' acme  TRADING ' }), ['name:Acme Trading']);
  assert.deepEqual(hit({ name: 'Old Co', email: 'old@old.example', website: 'old.example' }), [], 'trashed customers are ignored');
  assert.deepEqual(hit({ email: 'pool@pool.example' }), ['email:Pool Co'], 'public-pool customers count');
  assert.deepEqual(L.customerConflicts(withModes(state, { ...ALL('block'), email: 'off' }), { email: 'buy@acme.example' }), []);
  assert.equal(L.websiteHost(' HTTPS://WWW.Example.com./a/b '), 'example.com');
});

test('block mode stops create and edit; the message names the customer and field', () => {
  const state = dedupeBase({ ...ALL('off'), email: 'block', phone: 'block' });
  assert.throws(() => add(state, 'a', { email: 'buy@acme.example' }), /^Error: 和已有客户「Acme Trading」的邮箱相同，不能保存。可以直接给这个客户写跟进。$/);
  assert.throws(() => add(state, 'a', { email: 'buy@acme.example', phone: '15550102030' }), /的邮箱、联系电话相同，不能保存/);
  const ok = add(state, 'a', { email: 'fresh@x.example', website: 'acme.com', name: 'Acme Trading' });
  assert.equal(get(ok, 'a').website, 'acme.com', 'fields set to 不判重 never block');
  assert.throws(() => L.upsert(ok, 'a', { email: 'buy@acme.example' }, { mustExist: true }), /邮箱相同/);
});

test('edit only re-checks changed fields; allow mode does not throw and is reported by saveWarnings', () => {
  let state = add(dedupeBase(ALL('allow')), 'a', { email: 'buy@acme.example', name: 'Acme Trading' });
  assert.equal(get(state, 'a').email, 'buy@acme.example', 'allow mode saves');
  state = withModes(state, ALL('block'));
  const edited = L.upsert(state, 'a', { note: 'only a note' }, { mustExist: true });
  assert.equal(get(edited, 'a').note, 'only a note', 'old duplicates do not block unrelated edits');
  assert.throws(() => L.upsert(state, 'a', { phone: '15550102030' }, { mustExist: true }), /联系电话相同/);
  assert.doesNotThrow(() => L.upsert(state, 'a', { email: 'BUY@acme.example' }, { mustExist: true }), 'same value in other case is not a change');
  const allow = withModes(state, ALL('allow'));
  const warn = L.saveWarnings(allow, 'new1', { name: 'X', email: 'buy@acme.example', phone: '15550102030' });
  assert.deepEqual(warn.conflicts.map(c => c.field), ['email', 'phone']);
  assert.equal(warn.message, '和已有客户「Acme Trading」的邮箱、联系电话相同，确定还要保存吗？');
  assert.equal(L.saveWarnings(allow, 'a', { note: 'x' }, { mustExist: true }).message, '', 'unchanged fields are not warned about on edit');
  assert.equal(L.saveWarnings(state, 'new1', { name: 'X', email: 'buy@acme.example' }).message, '', 'block mode is not a warning');
});

test('the duplicate hint respects the setting: fields set to 不判重 are not hinted', () => {
  const both = add(dedupeBase(ALL('allow')), 'h', { name: 'acme trading', email: 'BUY@acme.example' });
  const dupOf = state => L.detail(state, 'h', TODAY).duplicate.customer;
  assert.equal(dupOf(both), 'Acme Trading');
  assert.equal(dupOf(withModes(both, { ...ALL('allow'), name: 'off' })), 'Acme Trading', 'email still hints');
  assert.equal(dupOf(withModes(both, { ...ALL('allow'), name: 'off', email: 'off' })), '');
});
