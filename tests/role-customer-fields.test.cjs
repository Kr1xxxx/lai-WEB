const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/role-model.js');
const M = require('../src/model.js');
const S = require('../src/segments.js');
const F = require('../src/customer-fields.js');
const Editor = require('../src/customer-editor-ui.js');
const Detail = require('../src/customer-detail-ui.js');
const List = require('../src/customer-list-ui.js');

const profile = () => ({
  client: 'Acme', country: '美国', source: '官网', owner: 'Amy', website: 'acme.example', note: '老客户', customerStars: '4',
  contact: 'Ann', email: 'ann@acme.example', emails: ['ann@acme.example', 'bob@acme.example'],
  phone: '111', phones: ['111', '222'], phoneCountryCode: '+1',
  additionalPhones: [{ id: 'p1', phoneCountryCode: '+44', phone: '333' }],
  contactNote: 'primary note', history: [],
  extraContacts: [{ id: 'x1', contact: 'Bob', email: 'bob@acme.example', phone: '222', alibabaId: 'bob-ali', contactNote: 'second note' }],
});
const base = () => ({ laiSettings: { defaultOwner: 'Kris' }, customers: { Acme: profile(), Beta: { client: 'Beta', country: '法国', source: '展会', owner: 'Kris', email: 'b@beta.example' } }, orders: [] });
// 业务 with the given field levels, current account switched to Amy (业务).
function asSales(fields, extra = {}) {
  let state = base();
  state = R.updateRole(state, 'sales', { fields: { customer: fields, pool: extra.pool || {} } });
  return R.switchTo(state, R.settings(state).members.find((m) => m.name === 'Amy').id);
}

test('roleFieldList: stored property names for company fields, contact. prefix for contact fields, required ones left out', () => {
  const rows = F.roleFieldList(base(), 'customer');
  const keys = rows.map((r) => r.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.deepEqual(F.roleFieldList(base(), 'pool'), rows, 'customers and pool customers share the list');
  assert.deepEqual(F.roleFieldList(base(), 'lead'), []);
  for (const key of ['website', 'tags', 'previewGroup', 'customerStage', 'customerStars', 'note', 'paymentMethod', 'contact.email', 'contact.phone', 'contact.alibabaId', 'contact.contactNote'])
    assert.ok(keys.includes(key), key);
  // Required to save, owner, automatic and time fields are never lockable.
  for (const key of ['name', 'client', 'country', 'source', 'owner', 'contact.contact', 'nextFollow', 'createdAt', 'updated', 'history'])
    assert.ok(!keys.includes(key), key);
  assert.ok(rows.every((r) => r.label && ['公司信息', '交易偏好', '联系人'].includes(r.group)));
  assert.ok(rows.filter((r) => r.group === '联系人').every((r) => r.key.startsWith('contact.')));
  // Every company key is something the save path really stores.
  const saved = new Set(['website', 'tags', 'previewGroup', 'customerStage', 'customerType', 'customerStars', 'customerCode', 'level', 'timezone', 'defaultPaymentPlan', 'customerAccountPeriod', 'productType', 'companyProducts', 'cardStock', 'customBox', 'shortName', 'landline', 'companyAddress', 'companyRemark', 'note', 'permanentNote', 'currency', 'paymentMethod', 'paymentEmail', 'repurchaseCycle']);
  assert.deepEqual(keys.filter((k) => !k.startsWith('contact.')).filter((k) => !saved.has(k)), []);
  // role-fields collects them for the role page.
  globalThis.LaiCustomerFields = F;
  try {
    const listed = require('../src/role-fields.js').list(base(), 'pool');
    assert.deepEqual(listed.map((r) => r.key), keys);
  } finally { delete globalThis.LaiCustomerFields; }
});

test('gate: admin sees and edits everything; the role levels apply per module', () => {
  const admin = F.gate(base(), 'customer');
  assert.equal(admin.plain, true);
  assert.equal(admin.editable('contact.email'), true);
  assert.equal(admin.columnVisible('email'), true);
  const state = asSales({ 'contact.email': 'hidden', website: 'read', tags: 'hidden' }, { pool: { note: 'hidden' } });
  const gate = F.gate(state, 'customer');
  assert.equal(gate.visible('contact.email'), false);
  assert.equal(gate.visible('website'), true);
  assert.equal(gate.editable('website'), false);
  assert.equal(gate.editable('note'), true);
  assert.equal(F.gate(state, { laiBucket: 'pool' }).visible('note'), false, 'a profile in the pool uses the 公海客户 levels');
  assert.equal(F.gate(state, profile()).visible('note'), true);
  // Columns follow the fields; activity columns need 跟进动态·查看.
  assert.equal(gate.columnVisible('email'), false);
  assert.equal(gate.columnVisible('tags'), false);
  assert.equal(gate.columnVisible('website'), true);
  assert.equal(gate.columnVisible('latestActivity'), true);
  const noActivity = R.updateRole(R.switchTo(state, R.settings(state).members[0].id), 'sales', { perms: { 'customer.view': true } });
  const sales = R.switchTo(noActivity, R.settings(noActivity).members.find((m) => m.name === 'Amy').id);
  assert.equal(F.gate(sales, 'customer').columnVisible('latestActivity'), false);
  assert.equal(F.gate(sales, 'customer').columnVisible('latestFollowup'), false);
  assert.ok(F.gate(state, 'customer').hiddenColumns().has('email'));
  assert.ok(F.gate(state, 'customer').hiddenFilters().has('tag'));
  assert.ok(F.gate(state, 'customer').hiddenSearch().has('email'));
});

test('a hidden email survives an edit that omits it, a read-only phone cannot change, contacts are matched by id', () => {
  const state = asSales({ 'contact.email': 'hidden', 'contact.phone': 'read', 'contact.contactNote': 'hidden', website: 'hidden', note: 'read' });
  const before = state.customers.Acme;
  // What the editor posts: no email (not drawn), no website, phone and note disabled but their old values read back from the DOM,
  // and a tampered phone to prove it cannot change.
  const data = {
    name: 'Acme', country: '美国', source: '官网', owner: 'Amy', contact: 'Ann Lee', phone: '999', phoneCountryCode: '+1',
    additionalPhones: [], additionalSocialAccounts: [],
    extraContacts: [{ id: 'x1', contact: 'Bobby', phone: '888', additionalPhones: [], additionalSocialAccounts: [] }],
  };
  let next = M.upsertCustomer(state, 'Acme', data);
  next = { ...next, customers: { ...next.customers, Acme: F.guardProfile(state, before, next.customers.Acme) } };
  const after = next.customers.Acme;
  assert.equal(after.contact, 'Ann Lee', 'unlocked fields still change');
  assert.equal(after.extraContacts[0].contact, 'Bobby');
  assert.equal(after.email, 'ann@acme.example');
  assert.equal(after.phone, '111');
  assert.deepEqual(after.additionalPhones, before.additionalPhones);
  assert.equal(after.contactNote, 'primary note');
  assert.equal(after.website, 'acme.example');
  assert.equal(after.note, '老客户');
  const second = after.extraContacts[0];
  assert.equal(second.email, 'bob@acme.example');
  assert.equal(second.phone, '222');
  assert.equal(second.contactNote, 'second note');
  assert.equal(second.alibabaId, 'bob-ali', 'fields that are not locked are untouched');
  assert.deepEqual(after.emails, ['ann@acme.example', 'bob@acme.example']);
  assert.deepEqual(after.phones, ['111', '222']);
  // The input state is not modified.
  assert.equal(state.customers.Acme.phone, '111');
});

// Changed on purpose (data safety): a contact that holds a value in a locked field cannot be removed by that account —
// removing it would delete the locked value. The editor hides 移除 for it and guardProfile puts it back.
test('removing a contact with locked values puts it back; a contact added during the edit gets no locked values', () => {
  const state = asSales({ 'contact.email': 'hidden' });
  const before = state.customers.Acme;
  const data = { name: 'Acme', country: '美国', source: '官网', owner: 'Amy', additionalPhones: [], additionalSocialAccounts: [],
    extraContacts: [{ id: 'new-1', contact: 'Cleo', email: 'cleo@acme.example', phone: '555', additionalPhones: [], additionalSocialAccounts: [] }] };
  const next = M.upsertCustomer(state, 'Acme', data);
  const guarded = F.guardProfile(state, before, next.customers.Acme);
  assert.equal(guarded.extraContacts.length, 2);
  assert.equal(guarded.extraContacts[0].id, 'new-1');
  assert.equal(guarded.extraContacts[0].email, undefined, 'a locked field cannot be filled on a new contact');
  assert.equal(guarded.extraContacts[0].phone, '555');
  assert.deepEqual(guarded.extraContacts[1], before.extraContacts[0], 'the removed contact comes back with its hidden email');
  assert.equal(guarded.email, 'ann@acme.example');
  assert.deepEqual(guarded.emails, ['ann@acme.example', 'bob@acme.example'], 'the locked email list stays as it was');
});

test('removing a contact without locked values removes it for real', () => {
  const state = asSales({ 'contact.birthday': 'hidden' });
  const before = state.customers.Acme;
  const data = { name: 'Acme', country: '美国', source: '官网', owner: 'Amy', additionalPhones: [], additionalSocialAccounts: [], extraContacts: [] };
  const next = M.upsertCustomer(state, 'Acme', data);
  const guarded = F.guardProfile(state, before, next.customers.Acme);
  assert.deepEqual(guarded.extraContacts, []);
  assert.equal(F.contactHasLocked(state, 'customer', before.extraContacts[0]), false);
  assert.equal(F.contactHasLocked(asSales({ 'contact.email': 'read' }), 'customer', before.extraContacts[0]), true);
  assert.equal(F.contactHasLocked(asSales({ 'contact.phone': 'hidden' }), 'customer', { additionalPhones: [{ phone: '1' }] }), true);
  assert.equal(F.contactHasLocked(asSales({ 'contact.phone': 'hidden' }), 'customer', { phone: ' ', additionalPhones: [] }), false);
});

test('legacy contacts without an id are matched the way the editor names them', () => {
  const state = asSales({ 'contact.phone': 'read' });
  const old = state.customers.Acme;
  old.extraContacts = [{ contact: 'Bob', phone: '222', email: 'bob@acme.example' }];
  const after = { ...old, extraContacts: [{ id: 'legacy-1', contact: 'Bob', phone: '777', email: 'bob@acme.example' }] };
  const guarded = F.guardProfile(state, old, after);
  assert.equal(guarded.extraContacts[0].phone, '222');
});

test('new customers get no locked values; admin is never touched', () => {
  const state = asSales({ 'contact.email': 'hidden', website: 'read' });
  const data = { name: 'Newco', country: '美国', source: '官网', owner: 'Amy', email: 'x@newco.example', website: 'newco.example', contact: 'Nia', additionalPhones: [], additionalSocialAccounts: [], extraContacts: [] };
  const created = M.upsertCustomer(state, '', data).customers.Newco;
  const guarded = F.guardProfile(state, null, created);
  assert.equal(guarded.email, undefined);
  assert.equal(guarded.website, undefined);
  assert.equal(guarded.contact, 'Nia');
  assert.equal(guarded.client, 'Newco');
  const admin = R.switchTo(state, R.settings(state).members.find((m) => m.roleId === 'admin').id);
  assert.equal(F.guardProfile(admin, null, created), created);
});

test('guardState reverts locked fields on changed customers (batch edit, tags) and leaves everything else alone', () => {
  const state = asSales({ customerStars: 'read', tags: 'hidden' });
  const edited = M.batchEditCustomerField(state, ['Acme'], 'customerStars', '1');
  const tagged = M.batchUpdateCustomerTags(edited, ['Acme'], '重点', 'add');
  const guarded = F.guardState(state, tagged);
  assert.equal(guarded.customers.Acme.customerStars, '4');
  assert.equal(guarded.customers.Acme.tags, undefined);
  assert.equal(guarded.customers.Beta, tagged.customers.Beta, 'unchanged customers keep their identity');
  assert.ok(guarded.customers.Acme.history.length > state.customers.Acme.history.length, 'the rest of the change (history) is kept');
  assert.equal(F.guardState(state, state), state);
  // New customers are only handled when asked to (imports).
  const added = { ...state, customers: { ...state.customers, Gamma: { client: 'Gamma', customerStars: '5', tags: ['x'], owner: 'Amy' } } };
  assert.equal(F.guardState(state, added).customers.Gamma.customerStars, '5');
  const strict = F.guardState(state, added, { includeNew: true }).customers.Gamma;
  assert.equal(strict.customerStars, undefined);
  assert.equal(strict.tags, undefined);
  assert.equal(strict.owner, 'Amy');
  // Admin sees no change.
  const admin = R.switchTo(state, R.settings(state).members.find((m) => m.roleId === 'admin').id);
  assert.equal(F.guardState(admin, tagged), tagged);
});

test('global search, quick filters and sorting never use fields the role cannot see', () => {
  const state = asSales({ 'contact.email': 'hidden', tags: 'hidden' });
  const rows = M.buildCustomers(state);
  const gate = F.gate(state, 'customer');
  assert.equal(F.globalCustomerSearch(rows, { field: 'email', query: 'ann@acme', hidden: gate.hiddenSearch() }).length, 0);
  assert.equal(F.globalCustomerSearch(rows, { field: 'all', query: 'ann@acme', hidden: gate.hiddenSearch() }).length, 0, '全部 skips hidden fields');
  assert.equal(F.globalCustomerSearch(rows, { field: 'all', query: 'ann@acme' }).length, 1, 'the same search finds it without the restriction');
  assert.equal(F.globalCustomerSearch(rows, { field: 'nameOrShort', query: 'acme', hidden: gate.hiddenSearch() }).length, 1);
  const filters = { group: 'all', field: 'email', query: 'ann@acme', email: 'ann', tag: 'x', customerGroup: '', stage: '', sortField: 'tags', sortDirection: 'asc', owner: 'Amy' };
  const clean = F.sanitizeFilters(state, filters);
  assert.equal(clean.query, '');
  assert.equal(clean.email, '');
  assert.equal(clean.tag, '');
  assert.equal(clean.sortField, '');
  assert.equal(clean.group, 'all', 'the segment filter is not a field');
  assert.equal(clean.owner, 'Amy');
  assert.equal(F.sanitizeFilters(base(), filters), filters, 'admin keeps the very same filters');
  const listHtml = List.render({ rows, p: { total: 1, page: 1, pageCount: 1, items: [] }, filters: { group: 'all', field: 'name', query: '' }, selected: new Set(), pageSize: 20, segments: [], groupTab: 'groups', expanded: new Set(), team: 'team', icon: () => '', escape: M.escapeHtml, tableMarkup: () => '', hiddenFilterFields: gate.hiddenFilters() });
  assert.doesNotMatch(listHtml, /<option value="email"/);
  assert.doesNotMatch(listHtml, /<option value="tag"/);
  assert.match(listHtml, /<option value="name"/);
});

test('editor: hidden fields are not drawn, read-only ones are disabled and marked', () => {
  const state = asSales({ website: 'hidden', note: 'read', customerStars: 'read', 'contact.email': 'hidden', 'contact.phone': 'read', currency: 'hidden' });
  const c = M.buildCustomers(state).find((row) => row.name === 'Acme');
  const html = Editor.render(c, { state, escape: M.escapeHtml }).body;
  assert.doesNotMatch(html, /name="website"/);
  assert.doesNotMatch(html, /name="email"/);
  assert.doesNotMatch(html, /name="emailExtra"/);
  assert.doesNotMatch(html, /name="currency"/);
  assert.match(html, /<textarea disabled id="ce-note" name="note"/);
  assert.match(html, /<input disabled id="ce-phone-0" name="phone"/);
  assert.match(html, /<input disabled id="ce-phoneExtra-1" name="phoneExtra"/);
  assert.match(html, /<input disabled type="hidden" name="customerStars"/);
  assert.ok((html.match(/data-role-readonly/g) || []).length >= 4);
  // Unlocked fields stay editable; the admin sees the plain form.
  assert.match(html, /<input id="ce-contact-0" name="contact"/);
  assert.match(html, /name="paymentMethod"/);
  const plain = Editor.render(c, { state: base(), escape: M.escapeHtml }).body;
  assert.match(plain, /name="website"/);
  assert.match(plain, /name="email"/);
  assert.doesNotMatch(plain, /data-role-readonly/);
  assert.doesNotMatch(plain, / disabled/);
});

test('detail: hidden fields, contact fields and summary fields are not shown; the activity timeline needs 跟进动态·查看', () => {
  const state = asSales({ website: 'hidden', customerStars: 'hidden', 'contact.email': 'hidden', 'contact.phone': 'hidden', 'contact.contactNote': 'hidden', note: 'hidden', tags: 'hidden', timezone: 'hidden', customerCode: 'hidden' });
  state.customers.Acme.note = '秘密备注';
  state.customers.Acme.tags = ['VIP'];
  state.customers.Acme.timezone = 'UTC+8';
  state.customers.Acme.customerCode = 'C-0001';
  state.customers.Acme.history = [{ type: 'followup', time: '2026-09-23T11:22:33', text: '聊过价格' }];
  const c = M.buildCustomers(state).find((row) => row.name === 'Acme');
  const html = Detail.render(c, { state, tab: 'info', escape: M.escapeHtml });
  for (const secret of ['acme.example', 'ann@acme.example', 'bob@acme.example', '秘密备注', 'VIP', 'UTC+8', 'C-0001', 'primary note', 'second note'])
    assert.ok(!html.includes(secret), secret);
  for (const label of ['公司网址', '客户星级', '邮箱', '联系电话', '联系人备注', '客户标签', '时区', '客户编号'])
    assert.ok(!html.includes(`<dt>${label}</dt>`) && !html.includes(`<dt>${label}:</dt>`), label);
  assert.ok(!html.includes('data-action="customer-tags"'));
  assert.ok(html.includes('bob-ali'), 'Alibaba ID is not locked');
  // The contact search text does not carry hidden values.
  assert.ok(!/data-contact-search="[^"]*(ann@acme|111)/.test(html));
  // Admin sees all of it.
  const full = Detail.render(M.buildCustomers(base()).find((row) => row.name === 'Acme'), { state: base(), tab: 'info', escape: M.escapeHtml });
  assert.ok(full.includes('ann@acme.example') && full.includes('acme.example'));
  // Read-only tags: shown without the add button.
  const readOnly = asSales({ tags: 'read' });
  readOnly.customers.Acme.tags = ['VIP'];
  const roHtml = Detail.render(M.buildCustomers(readOnly).find((row) => row.name === 'Acme'), { state: readOnly, tab: 'info', escape: M.escapeHtml });
  assert.ok(roHtml.includes('VIP'));
  assert.ok(!roHtml.includes('data-action="customer-tags"'));
  // Activity.
  const withActivity = Detail.render(c, { state, tab: 'activity', escape: M.escapeHtml });
  assert.ok(withActivity.includes('聊过价格'));
  const noView = R.updateRole(R.switchTo(state, R.settings(state).members.find((m) => m.roleId === 'admin').id), 'sales', { perms: { 'customer.view': true, 'customer.edit': true } });
  const blocked = R.switchTo(noView, R.settings(noView).members.find((m) => m.name === 'Amy').id);
  const denied = Detail.render(c, { state: blocked, tab: 'activity', escape: M.escapeHtml });
  assert.ok(!denied.includes('聊过价格'));
  assert.ok(denied.includes('你的角色没有“跟进动态·查看”权限'));
  assert.ok(denied.includes('id="followup-form"'), 'writing a follow-up is still governed by the edit permission');
  assert.ok(!denied.includes('lcd-journey'));
});

test('team picker: departments (with their members) and members, limited to what the account can see; a department filters by owner incl. sub-departments', () => {
  let state = base();

  state = R.addMember(state, { name: 'Bob', roleId: 'sales' });
  state = R.addMember(state, { name: 'Cat', roleId: 'sales' });
  state = R.addDepartment(state, { name: '销售部' });
  const sales = R.deptTree(state).find((d) => d.name === '销售部');
  state = R.addDepartment(state, { name: '一组', parentId: sales.id });
  state = R.addDepartment(state, { name: '二组' });
  const dept = (name) => R.deptTree(state).find((d) => d.name === name).id;
  const id = (name) => R.settings(state).members.find((m) => m.name === name).id;
  state = R.setMemberDept(state, id('Amy'), dept('销售部'));
  state = R.setMemberDept(state, id('Bob'), dept('一组'));
  state = R.setMemberDept(state, id('Cat'), dept('二组'));
  const rows = [{ name: 'a', owner: 'Amy' }, { name: 'b', owner: 'Bob' }, { name: 'c', owner: 'Cat' }, { name: 'd', owner: 'Kris' }, { name: 'e', owner: 'Zed' }];
  const options = F.ownerFilterOptions(state, rows);
  assert.deepEqual(options.map((o) => [o.kind, o.label, o.level]), [
    ['dept', '销售部', 0], ['member', 'Amy', 1], ['dept', '一组', 1], ['member', 'Bob', 2], ['dept', '二组', 0], ['member', 'Cat', 1],
    ['member', 'Kris', 0], ['member', 'Zed', 0]]);
  assert.equal(options[0].value, 'dept:' + dept('销售部'));
  const match = F.ownerDeptMatcher(state, options[0].value);
  assert.deepEqual(rows.filter((row) => match(row.owner)).map((row) => row.name), ['a', 'b'], 'sub-departments count');
  assert.equal(F.ownerDeptMatcher(state, 'Amy'), null);
  assert.equal(F.ownerDeptMatcher(state, ''), null);
  // 本部门 account: Amy's department and below, nothing else.
  state = R.updateRole(state, 'sales', { scope: 'dept' });
  state = R.switchTo(state, id('Amy'));
  const visible = F.ownerFilterOptions(state, rows.filter((row) => R.canSee(state, row.owner)));
  assert.deepEqual(visible.map((o) => o.label), ['销售部', 'Amy', '一组', 'Bob']);
  assert.deepEqual(rows.filter((row) => R.canSee(state, row.owner)).map((row) => row.name), ['a', 'b']);
});

test('columns: the customer table never gets a column the role may not see', () => {
  const state = asSales({ 'contact.email': 'hidden', 'contact.phone': 'hidden', previewGroup: 'hidden' });
  const hidden = F.gate(state, 'customer').hiddenColumns();
  for (const id of ['email', 'phone', 'group']) assert.ok(hidden.has(id), id);
  for (const id of ['name', 'contact', 'country', 'owner', 'source', 'tags']) assert.ok(!hidden.has(id), id);
  // The segment rule editor offers the same ids.
  assert.ok(S.catalog.some((f) => f.id === 'email'));
});

test('a customer in the pool is guarded by the 公海客户 levels, not the 客户 ones', () => {
  const state = asSales({ website: 'hidden' }, { pool: { note: 'read', 'contact.email': 'hidden' } });
  const pooled = { ...state.customers.Acme, laiBucket: 'pool' };
  const edited = { ...pooled, website: 'changed.example', note: 'changed', email: 'changed@acme.example', contact: 'Ann Lee' };
  const guarded = F.guardProfile(state, pooled, edited);
  assert.equal(guarded.website, 'changed.example', 'website is only locked for 客户, not for 公海客户');
  assert.equal(guarded.note, '老客户');
  assert.equal(guarded.email, 'ann@acme.example');
  assert.equal(guarded.contact, 'Ann Lee');
  const plain = { ...state.customers.Acme, website: 'changed.example', note: 'changed', email: 'changed@acme.example' };
  const kept = F.guardProfile(state, state.customers.Acme, plain);
  assert.equal(kept.website, 'acme.example');
  assert.equal(kept.note, 'changed', 'note is only locked for 公海客户');
  assert.equal(kept.email, 'changed@acme.example');
});

test('the duplicate page leaves out matches on hidden fields', () => {
  const gate = F.gate(asSales({ 'contact.email': 'hidden', customerCode: 'hidden' }), 'customer');
  assert.equal(gate.visible(F.dupTypeRoleKeys['邮箱']), false);
  assert.equal(gate.visible(F.dupTypeRoleKeys['电话']), true);
  assert.equal(gate.visible(F.dupTypeRoleKeys['客户编号']), false);
});
