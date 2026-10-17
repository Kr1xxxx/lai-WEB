'use strict';
// 线索设置: 无效原因 (add / rename / move / delete), 线索字段 (show / required) and how the lead model and form use them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../src/lead-settings-model.js');
const L = require('../src/lead-model.js');
const LU = require('../src/lead-ui.js');
const R = require('../src/role-model.js');
const { escapeHtml } = require('../src/model.js');

const NOW = '2026-10-01T00:00:00.000Z';
const base = () => ({ laiSettings: {}, customers: {}, orders: [] });
const withLead = (state, id, input = {}) => L.upsert(state, id, { name: 'Lead ' + id, ...input }, { now: NOW });
const roleState = (state, fields, current = 'm-amy') => ({
  ...state,
  laiSettings: { ...(state.laiSettings || {}), roles: {
    roles: [{ id: 'sales', name: '业务', scope: 'self', perms: { 'lead.view': true, 'lead.edit': true, 'lead.create': true }, fields }],
    members: [{ id: 'm-kris', name: 'Kris', roleId: 'admin' }, { id: 'm-amy', name: 'Amy', roleId: 'sales' }], current,
  } },
});

test('no stored setting gives the six default reasons and every field shown, none required; INVALID_REASONS stays exported', () => {
  const got = S.get(base());
  assert.deepEqual(got.reasons, ['无法联系', '没有需求', '预算不符', '重复线索', '同行或广告', '其他']);
  assert.deepEqual(L.INVALID_REASONS, got.reasons);
  assert.deepEqual(L.reasons(base()), got.reasons);
  assert.ok(Object.values(got.fields).every(f => f.show && !f.required));
  assert.deepEqual(Object.keys(got.fields), ['contact', 'email', 'phone', 'country', 'source', 'website', 'product', 'note', 'nextFollow']);
  assert.deepEqual(S.get({ laiSettings: { leadSettings: 'broken' } }).reasons, got.reasons, 'unreadable settings fall back to the defaults');
});

test('reasons: add, duplicates, empty and too long are refused; the list keeps its order', () => {
  let state = S.addReason(base(), '  价格太高 ');
  assert.deepEqual(S.reasonsOf(state).slice(-1), ['价格太高']);
  assert.equal(S.reasonsOf(state).length, 7);
  assert.throws(() => S.addReason(state, '价格太高'), /已有同名/);
  assert.throws(() => S.addReason(state, '其他'), /已有同名/);
  assert.throws(() => S.addReason(state, '   '), /请填写/);
  assert.throws(() => S.addReason(state, 'x'.repeat(41)), /最多 40/);
  assert.equal(state.laiSettings.leadSettings.reasons.length, 7);
  let big = base();
  for (let i = 0; i < 24; i++) big = S.addReason(big, 'r' + i);
  assert.throws(() => S.addReason(big, 'one more'), /最多 30/);
});

test('reasons: move up and down; the ends do nothing', () => {
  let state = S.moveReason(base(), '没有需求', -1);
  assert.deepEqual(S.reasonsOf(state).slice(0, 2), ['没有需求', '无法联系']);
  state = S.moveReason(state, '没有需求', 1);
  assert.deepEqual(S.reasonsOf(state).slice(0, 2), ['无法联系', '没有需求']);
  const same = base();
  assert.equal(S.moveReason(same, '无法联系', -1), same);
  assert.throws(() => S.moveReason(base(), '不存在', 1), /没有找到/);
});

test('reasons: renaming updates the invalid leads that used it', () => {
  let state = withLead(base(), 'a');
  state = withLead(state, 'b');
  state = withLead(state, 'c');
  state = L.markInvalid(state, 'a', { reason: '没有需求' }, { now: NOW });
  state = L.markInvalid(state, 'b', { reason: '没有需求' }, { now: NOW });
  state = L.setTrashed(state, 'b', true, { now: NOW });
  state = L.markInvalid(state, 'c', { reason: '其他' }, { now: NOW });
  const next = S.renameReason(state, '没有需求', '暂时不需要');
  assert.ok(S.reasonsOf(next).includes('暂时不需要') && !S.reasonsOf(next).includes('没有需求'));
  assert.deepEqual(next.laiLeads.map(item => item.invalidReason), ['暂时不需要', '暂时不需要', '其他'].reverse(), 'newest lead first: c, b, a');
  assert.equal(S.reasonUse(next, '暂时不需要'), 2, 'the trashed lead counts too');
  assert.throws(() => S.renameReason(next, '暂时不需要', '其他'), /已有同名/);
  assert.equal(S.renameReason(next, '其他', '其他'), next);
  assert.throws(() => S.renameReason(next, '其他', ' '), /请填写/);
});

test('reasons: deleting a reason that leads use is blocked with the count; unused ones can go; one must stay', () => {
  let state = withLead(base(), 'a');
  state = withLead(state, 'b');
  state = L.markInvalid(state, 'a', { reason: '预算不符' }, { now: NOW });
  state = L.markInvalid(state, 'b', { reason: '预算不符' }, { now: NOW });
  assert.throws(() => S.removeReason(state, '预算不符'), /还有 2 条线索用了这个原因，先改掉它们/);
  const after = S.removeReason(state, '重复线索');
  assert.ok(!S.reasonsOf(after).includes('重复线索'));
  assert.equal(after.laiLeads, state.laiLeads, 'leads are untouched');
  // Reopen both leads: the reason is no longer in use and can be deleted.
  state = L.reopen(L.reopen(state, 'a', { now: NOW }), 'b', { now: NOW });
  assert.equal(S.reasonUse(state, '预算不符'), 0);
  assert.ok(!S.reasonsOf(S.removeReason(state, '预算不符')).includes('预算不符'));
  let one = base();
  for (const name of S.DEFAULT_REASONS.slice(1)) one = S.removeReason(one, name);
  assert.deepEqual(S.reasonsOf(one), ['无法联系']);
  assert.throws(() => S.removeReason(one, '无法联系'), /至少要留一个/);
});

test('the configured reasons feed the 标记无效 dialog; leads keep an older reason text', () => {
  let state = S.addReason(base(), '价格太高');
  state = withLead(state, 'a');
  const row = L.detail(state, 'a', '2026-10-02');
  assert.deepEqual(row.reasons, S.reasonsOf(state));
  const ui = LU.create(escapeHtml, L);
  const html = ui.invalidMarkup(row);
  assert.ok(html.includes('<option value="价格太高">'));
  assert.ok(S.reasonsOf(state).every(reason => html.includes(`<option value="${reason}">`)));
  state = L.markInvalid(state, 'a', { reason: '价格太高' }, { now: NOW });
  assert.equal(L.detail(state, 'a').invalidReason, '价格太高');
});

test('fields: hiding a field clears its required flag; requiring a hidden field shows it again', () => {
  let state = S.setField(base(), 'email', { required: true });
  assert.deepEqual(S.get(state).fields.email, { show: true, required: true });
  state = S.setField(state, 'email', { show: false });
  assert.deepEqual(S.get(state).fields.email, { show: false, required: false });
  assert.deepEqual(S.hiddenFields(state), ['email']);
  assert.deepEqual(S.requiredFields(state), []);
  state = S.setField(state, 'email', { required: true });
  assert.deepEqual(S.get(state).fields.email, { show: true, required: true });
  assert.throws(() => S.setField(base(), 'name', { show: false }), /不能在这里设置/);
  assert.throws(() => S.setField(base(), 'owner', { required: true }), /不能在这里设置/);
  assert.deepEqual(state.laiSettings.leadSettings.fields, { email: { show: true, required: true } }, 'only the changed fields are stored');
});

test('fields: a field some role sets to read-only or hidden cannot be required', () => {
  const state = roleState(base(), { lead: { phone: 'read', note: 'hidden' } });
  assert.deepEqual(S.lockedBy(state, 'phone'), [{ role: '业务', level: 'read' }]);
  assert.throws(() => S.setField(state, 'phone', { required: true }), /角色「业务」把这个字段设为只读，不能同时必填/);
  assert.throws(() => S.setField(state, 'note', { required: true }), /角色「业务」把这个字段设为隐藏，不能同时必填/);
  assert.ok(S.setField(state, 'email', { required: true }), 'other fields are fine');
  assert.ok(S.setField(state, 'phone', { show: false }), 'hiding is still allowed');
  assert.ok(S.fieldRows(state).find(row => row.id === 'phone').locked.length);
});

test('upsert enforces shown + required fields for accounts that can edit them; hidden fields keep their values', () => {
  let state = S.setField(S.setField(base(), 'email', { required: true }), 'nextFollow', { required: true });
  assert.throws(() => withLead(state, 'a', {}), /请填写邮箱/);
  assert.throws(() => withLead(state, 'a', { email: 'a@b.example' }), /请填写下次跟进/);
  state = withLead(state, 'a', { email: 'a@b.example', nextFollow: '2026-10-09' });
  assert.equal(L.list(state)[0].email, 'a@b.example');
  // Editing without clearing the field passes; clearing it is refused.
  assert.ok(L.upsert(state, 'a', { note: 'x' }, { now: NOW, mustExist: true }));
  assert.throws(() => L.upsert(state, 'a', { email: '' }, { now: NOW, mustExist: true }), /请填写邮箱/);
  // A hidden field is not required, and its stored value survives an edit that leaves it out.
  let hidden = withLead(base(), 'h', { phone: '123456' });
  hidden = S.setField(hidden, 'phone', { show: false });
  hidden = L.upsert(hidden, 'h', { name: 'Renamed' }, { now: NOW, mustExist: true });
  assert.equal(L.list(hidden)[0].phone, '123456');
  // convert keeps its own rules: nothing from the settings is demanded there.
  let conv = S.setField(withLead(base(), 'c'), 'email', { required: true });
  conv = L.convert(conv, 'c', { mode: 'new', name: 'Lead c', country: '德国', source: '展会' }, { now: NOW });
  assert.equal(L.list(conv)[0].status, 'converted');
});

test('upsert skips required fields the current account cannot edit', () => {
  let state = S.setField(base(), 'phone', { required: true });
  state = roleState(state, { lead: { phone: 'read' } }, 'm-amy');
  assert.equal(R.fieldLevel(state, 'lead', 'phone'), 'read');
  assert.ok(withLead(state, 'a', {}), 'a 只读 account is not blocked by a required field it cannot fill');
  const admin = roleState(S.setField(base(), 'phone', { required: true }), {}, 'm-kris');
  assert.throws(() => withLead(admin, 'a', {}), /请填写电话/);
  const other = roleState(S.setField(base(), 'phone', { required: true }), { lead: { email: 'read' } }, 'm-amy');
  assert.throws(() => withLead(other, 'a', {}), /请填写电话/, 'an account that can edit the field is held to it');
});

test('the lead form hides hidden fields and marks required ones; context lists keep their content', () => {
  let state = S.setField(S.setField(S.setField(base(), 'website', { show: false }), 'nextFollow', { show: false }), 'email', { required: true });
  state = S.setField(state, 'country', { required: true });
  const ui = LU.create(escapeHtml, L);
  const context = { owners: L.ownerNames(state), sources: L.sourceNames(state), rules: L.fieldRules(state) };
  assert.ok(Array.isArray(context.sources) && context.sources.includes('展会'));
  assert.deepEqual(Object.keys(context.sources), context.sources.map((_, i) => String(i)), 'no hidden properties on the list');
  assert.equal(Object.getOwnPropertyNames(context.sources).includes('rules'), false);
  const html = ui.formMarkup({ name: '' }, context);
  assert.doesNotMatch(html, /name="website"|name="nextFollow"/);
  assert.match(html, /name="email"[^>]*required/);
  assert.match(html, /name="country"[^>]*required/);
  assert.doesNotMatch(html, /转为客户时必填/, 'the hint goes when the field is required');
  assert.match(html, /name="phone"/);
  assert.doesNotMatch(html, /name="phone"[^>]*required/);
  // Without settings the form is exactly as before.
  const plain = ui.formMarkup({ name: '' }, { owners: [], sources: [] });
  assert.match(plain, /name="website"/);
  assert.match(plain, /name="nextFollow"/);
});

test('a read-only account does not get a required mark on a field it cannot fill', () => {
  const state = roleState(S.setField(base(), 'phone', { required: true }), { lead: { phone: 'read' } });
  const ui = LU.create(escapeHtml, L, () => true, key => R.fieldLevel(state, 'lead', key));
  const html = ui.formMarkup({ name: '' }, { owners: L.ownerNames(state), sources: L.sourceNames(state), rules: L.fieldRules(state) });
  assert.match(html, /name="phone"[^>]*disabled/);
  assert.doesNotMatch(html, /name="phone"[^>]*required/);
});

test('the page: registered under lead-settings, three sections, links to 客户设置, refuses without permission', async () => {
  const code = fs.readFileSync(path.join(__dirname, '../src/lead-settings-ui.js'), 'utf8');
  const window = { LaiLeadSettings: S };
  new Function('window', code)(window);
  const page = window.LaiExtraPages['lead-settings'];
  assert.equal(page.title, '线索设置');
  const saved = [];
  const ctx = (state, can = () => true) => ({ escape: escapeHtml, state: () => state, can, need: can, save: async next => { saved.push(next); }, toast() {}, refresh() {} });
  const html = page.render(ctx(base()));
  for (const text of ['无效原因', '线索字段', '来源请到', '判重请到', 'data-lai-screen="customer-settings"', 'data-ls-field="email"', 'id="ls-reason-add"']) assert.ok(html.includes(text), text);
  assert.ok(!html.includes('data-ls-field="name"'), '线索名称 is fixed');
  assert.equal(page.render(ctx(base(), () => false)), '');
  // Deleting needs a second click.
  const button = { dataset: { lsAction: 'remove', name: '其他' } };
  const event = { target: { closest: () => button } };
  assert.equal(page.click(ctx(base()), event), true);
  assert.equal(saved.length, 0);
  assert.equal(page.click(ctx(base()), event), true);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(saved.length, 1);
  assert.ok(!S.reasonsOf(saved[0]).includes('其他'));
});

test('the new files are wired into the page build', () => {
  const build = fs.readFileSync(path.join(__dirname, '../scripts/build.py'), 'utf8');
  const template = fs.readFileSync(path.join(__dirname, '../src/template.html'), 'utf8');
  for (const [marker, file] of [['LEAD_SETTINGS_MODEL', 'lead-settings-model.js'], ['LEAD_SETTINGS_UI', 'lead-settings-ui.js'], ['LEAD_SETTINGS_STYLE', 'lead-settings.css']]) {
    assert.ok(build.includes(`('<!--${marker}-->','${file}'`), marker);
    assert.ok(template.includes(`<!--${marker}-->`), marker);
  }
  assert.ok(template.indexOf('<!--LEAD_SETTINGS_MODEL-->') < template.indexOf('<!--LEAD_MODEL-->'), 'the settings model loads before the lead model');
});

test('upsert: a required field already empty on an old lead and not touched in this save does not block (like customers)', () => {
  // The lead is created while 邮箱 is optional, then 邮箱 becomes required.
  let state = withLead(base(), 'old', { phone: '123456' });
  state = S.setField(state, 'email', { required: true });
  // Editing something else (the form sends the empty email back too) passes.
  assert.ok(L.upsert(state, 'old', { note: 'new note' }, { now: NOW, mustExist: true }));
  assert.ok(L.upsert(state, 'old', { note: 'new note', email: '' }, { now: NOW, mustExist: true }), 'an unchanged empty value is not "touched"');
  // Filling it works; clearing a filled one is refused; a new lead is always checked.
  const filled = L.upsert(state, 'old', { email: 'x@y.example' }, { now: NOW, mustExist: true });
  assert.throws(() => L.upsert(filled, 'old', { email: '' }, { now: NOW, mustExist: true }), /请填写邮箱/);
  assert.throws(() => withLead(state, 'fresh', {}), /请填写邮箱/);
  // A different required field that is empty and changed from filled still blocks.
  const phoneRequired = S.setField(withLead(base(), 'p', { phone: '123456' }), 'phone', { required: true });
  assert.throws(() => L.upsert(phoneRequired, 'p', { phone: '' }, { now: NOW, mustExist: true }), /请填写电话/);
});
