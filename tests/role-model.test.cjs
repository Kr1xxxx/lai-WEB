const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/role-model.js');

const base = () => ({ laiSettings: { defaultOwner: 'Kris' }, customers: { a: { owner: 'Kris' }, b: { owner: 'Amy' } }, orders: [] });

test('defaults: admin + 业务 roles, members from owners, admin first', () => {
  const s = R.settings(base());
  assert.deepEqual(s.roles.map(r => r.name), ['系统管理员', '业务', '部门管理员']);
  assert.deepEqual(s.members.map(m => [m.name, m.roleId]), [['Kris', 'admin'], ['Amy', 'sales']]);
  assert.equal(R.meName(base()), 'Kris');
  assert.equal(R.isAdmin(base()), true);
});

test('a 测试业务 account is added when nobody is 业务', () => {
  const state = { laiSettings: { defaultOwner: 'Kris' } };
  const s = R.settings(state);
  assert.deepEqual(s.members.map(m => [m.name, m.roleId]), [['Kris', 'admin'], ['测试业务', 'sales']]);
});

test('admin can do everything, 业务 follows its defaults and scope', () => {
  let state = base();
  for (const key of R.KEYS) assert.equal(R.can(state, key), true);
  const sales = R.settings(state).members.find(m => m.roleId === 'sales');
  state = R.switchTo(state, sales.id);
  assert.equal(state.laiSettings.defaultOwner, 'Kris', 'switching account leaves the typed 默认跟进人 alone');
  assert.equal(R.defaultOwner(state), 'Amy', '本人 account owns its new records');
  assert.equal(R.can(state, 'customer.view'), true);
  assert.equal(R.can(state, 'customer.import'), false);
  assert.equal(R.can(state, 'settings.roles'), false);
  assert.equal(R.scopeOf(state), 'self');
  assert.equal(R.canSee(state, 'amy'), true);
  assert.equal(R.canSee(state, 'Kris'), false);
  assert.equal(R.canSee(state, ''), false);
  assert.equal(R.canOpen(state, 'route', 'roles'), false);
  assert.equal(R.canOpen(state, 'route', 'opportunities'), true);
  assert.equal(R.canOpen(state, 'route', 'dashboard'), true);
  assert.equal(R.canOpen(state, 'mail', 'inbox'), true);
  assert.throws(() => R.addRole(state, { name: 'x' }), /角色权限和成员管理/);
  assert.match(R.denied('customer.import'), /客户·导入客户/);
});

test('系统管理员 cannot be edited or deleted; builtin 业务 cannot be deleted', () => {
  const state = base();
  assert.throws(() => R.updateRole(state, 'admin', { name: 'x' }), /不可编辑/);
  assert.throws(() => R.deleteRole(state, 'sales'), /内置/);
});

test('add, edit, delete a role; names unique; perms cleaned', () => {
  let state = R.addRole(base(), { name: '经理' });
  const role = R.settings(state).roles.find(r => r.name === '经理');
  assert.deepEqual(Object.keys(role.perms).sort(), [...R.SALES_DEFAULT].sort());
  assert.throws(() => R.addRole(state, { name: ' 经理 ' }), /同名/);
  state = R.updateRole(state, role.id, { scope: 'all', perms: { 'customer.view': true, bogus: true, 'lead.view': 'yes' } });
  const edited = R.settings(state).roles.find(r => r.id === role.id);
  assert.equal(edited.scope, 'all');
  assert.deepEqual(edited.perms, { 'customer.view': true });
  assert.throws(() => R.updateRole(state, role.id, { scope: 'team' }), /可见范围/);
  state = R.deleteRole(state, role.id);
  assert.equal(R.settings(state).roles.length, 3);
});

test('role in use cannot be deleted', () => {
  let state = R.addRole(base(), { name: '经理' });
  const role = R.settings(state).roles.find(r => r.name === '经理');
  const amy = R.settings(state).members.find(m => m.name === 'Amy');
  state = R.setMemberRole(state, amy.id, role.id);
  assert.throws(() => R.deleteRole(state, role.id), /1 位成员/);
});

test('members: add, rename, change role, remove; keep one admin; current cannot be removed', () => {
  let state = R.addMember(base(), { name: 'Bob' });
  const s = R.settings(state);
  const bob = s.members.find(m => m.name === 'Bob');
  assert.equal(bob.roleId, 'sales');
  assert.throws(() => R.addMember(state, { name: 'bob' }), /同名/);
  state = R.renameMember(state, bob.id, 'Bobby');
  const kris = R.settings(state).members.find(m => m.name === 'Kris');
  assert.throws(() => R.setMemberRole(state, kris.id, 'sales'), /至少要留一位系统管理员/);
  assert.throws(() => R.removeMember(state, kris.id), /正在使用/);
  state = R.removeMember(state, bob.id);
  assert.equal(R.settings(state).members.some(m => m.name === 'Bobby'), false);
});

test('a role cannot remove its own 角色权限 permission', () => {
  let state = R.addRole(base(), { name: '经理' });
  const role = R.settings(state).roles.find(r => r.name === '经理');
  state = R.updateRole(state, role.id, { perms: { 'settings.roles': true } });
  const amy = R.settings(state).members.find(m => m.name === 'Amy');
  state = R.setMemberRole(state, amy.id, role.id);
  state = R.switchTo(state, amy.id);
  assert.equal(R.can(state, 'settings.roles'), true);
  assert.throws(() => R.updateRole(state, role.id, { perms: {} }), /不能去掉自己/);
});

test('stored settings survive a round trip and junk is dropped', () => {
  let state = R.addRole(base(), { name: '经理' });
  const raw = JSON.parse(JSON.stringify(state.laiSettings.roles));
  raw.roles.push({ id: 'x', name: '' }, null);
  raw.members.push({ name: 'kris' }, { name: 'Zed', roleId: 'missing' });
  raw.current = 'nope';
  const s = R.settings({ laiSettings: { roles: raw } });
  assert.deepEqual(s.roles.map(r => r.name), ['系统管理员', '业务', '部门管理员', '经理']);
  assert.deepEqual(s.members.map(m => m.name), ['Kris', 'Amy', 'Zed']);
  assert.equal(s.members.find(m => m.name === 'Zed').roleId, 'sales');
  assert.equal(s.current, s.members[0].id);
  assert.equal(raw.roles.some(r => r && r.id === 'admin'), false);
});

test('every page perm is a real permission key', () => {
  for (const table of Object.values(R.PAGE_PERMS)) {
    for (const key of typeof table === 'string' ? [table] : Object.values(table)) assert.ok(R.KEYS.includes(key), key);
  }
});

test('role and member changes keep the default owner; renaming yourself only follows when it was your own old name', () => {
  let state = { laiSettings: { defaultOwner: 'Kris Wang' }, customers: { a: { owner: 'Amy' } } };
  state = R.addRole(state, { name: '经理' });
  state = R.addMember(state, { name: 'Bob' });
  assert.equal(state.laiSettings.defaultOwner, 'Kris Wang');
  const me = R.currentMember(state);
  state = R.renameMember(state, me.id, 'Kris');
  assert.equal(state.laiSettings.defaultOwner, 'Kris');
});

test('without a default owner the admin is 管理员, not a sales owner; a stored numeric current still matches', () => {
  const s = R.settings({ customers: { a: { owner: 'Amy' }, b: { owner: 'Bob' } } });
  assert.deepEqual(s.members.map(m => [m.name, m.roleId]), [['管理员', 'admin'], ['Amy', 'sales'], ['Bob', 'sales']]);
  const t = R.settings({ laiSettings: { roles: { members: [{ id: '1', name: 'A', roleId: 'admin' }, { id: '5', name: 'B' }], current: 5 } } });
  assert.equal(t.current, '5');
});

test('departments: tree, 本部门 sees own department and the ones below, not siblings', () => {
  let state = { laiSettings: { defaultOwner: 'Kris' }, customers: { a: { owner: 'Amy' }, b: { owner: 'Bob' }, c: { owner: 'Cat' }, d: { owner: 'Dan' } } };
  state = R.addDepartment(state, { name: '销售部' });
  const sales = R.deptTree(state)[0];
  state = R.addDepartment(state, { name: '一组', parentId: sales.id });
  state = R.addDepartment(state, { name: '二组' });
  assert.throws(() => R.addDepartment(state, { name: '一组', parentId: sales.id }), /同名/);
  const tree = R.deptTree(state);
  assert.deepEqual(tree.map(d => [d.name, d.level]), [['销售部', 0], ['一组', 1], ['二组', 0]]);
  const id = (name) => R.settings(state).members.find(m => m.name === name).id;
  const dept = (name) => tree.find(d => d.name === name).id;
  state = R.setMemberDept(state, id('Amy'), dept('销售部'));
  state = R.setMemberDept(state, id('Bob'), dept('一组'));
  state = R.setMemberDept(state, id('Cat'), dept('二组'));
  state = R.setMemberRole(state, id('Amy'), R.DEPT_ADMIN);
  assert.throws(() => R.deleteDepartment(state, dept('销售部')), /下级部门/);
  assert.throws(() => R.deleteDepartment(state, dept('二组')), /1 位成员/);
  state = R.switchTo(state, id('Amy'));
  assert.equal(R.scopeOf(state), 'dept');
  assert.equal(R.canSee(state, 'amy'), true);
  assert.equal(R.canSee(state, 'Bob'), true, 'sub-department');
  assert.equal(R.canSee(state, 'Cat'), false, 'sibling department');
  assert.equal(R.canSee(state, 'Dan'), false, 'no department');
  assert.equal(R.canSee(state, ''), false);
  const stored = state.laiSettings.roles;
  assert.equal(stored.members.find(m => m.name === 'Bob').deptId, dept('一组'));
});

test('stored departments: broken parents and cycles fall back to the top', () => {
  const s = R.settings({ laiSettings: { roles: { departments: [{ id: 'a', name: 'A', parentId: 'b' }, { id: 'b', name: 'B', parentId: 'a' }, { id: 'c', name: 'C', parentId: 'zzz' }, { id: 'c', name: 'dup' }, { name: 'noid' }], members: [{ id: '1', name: 'K', roleId: 'admin', deptId: 'nope' }] } } });
  assert.deepEqual(s.departments.map(d => d.id), ['a', 'b', 'c']);
  assert.ok(s.departments.some(d => d.parentId === ''), 'cycle broken');
  assert.equal(s.departments.find(d => d.id === 'c').parentId, '');
  assert.equal(s.members[0].deptId, '');
});

test('field permissions: levels, admin always edits, keepLocked restores old values', () => {
  let state = { laiSettings: { defaultOwner: 'Kris' }, customers: { a: { owner: 'Amy' } } };
  state = R.updateRole(state, 'sales', { fields: { customer: { email: 'hidden', phone: 'read', name: 'edit', x: 'bogus' }, nope: { a: 'read' } } });
  const role = R.settings(state).roles.find(r => r.id === 'sales');
  assert.deepEqual(role.fields, { customer: { email: 'hidden', phone: 'read' } });
  assert.equal(R.fieldLevel(state, 'customer', 'email'), 'edit', 'admin');
  state = R.switchTo(state, R.settings(state).members.find(m => m.name === 'Amy').id);
  assert.equal(R.fieldLevel(state, 'customer', 'email'), 'hidden');
  assert.equal(R.fieldVisible(state, 'customer', 'phone'), true);
  assert.equal(R.fieldEditable(state, 'customer', 'phone'), false);
  assert.equal(R.fieldEditable(state, 'customer', 'name'), true);
  assert.deepEqual(R.lockedFields(state, 'customer').sort(), ['email', 'phone']);
  const before = { name: 'A', email: 'a@x.com' };
  const after = { name: 'B', phone: '123' };
  assert.deepEqual(R.keepLocked(state, 'customer', before, after), { name: 'B', email: 'a@x.com' });
  assert.deepEqual(R.keepLocked(state, 'customer', null, { name: 'N', email: 'typed' }), { name: 'N' });
  assert.deepEqual(R.keepLocked(state, 'lead', before, after), after, 'no locks for leads');
});

test('product layouts per role are stored on the role', () => {
  let state = R.updateRole({ laiSettings: { defaultOwner: 'Kris' } }, 'sales', { layouts: { product: { form: 'L1', detail: '' } } });
  assert.deepEqual(R.settings(state).roles.find(r => r.id === 'sales').layouts, { product: { form: 'L1', detail: '' } });
  assert.deepEqual(R.productLayoutOf(state), { form: '', detail: '' }, 'admin uses the default');
  state = R.switchTo(state, R.settings(state).members.find(m => m.roleId === 'sales').id);
  assert.deepEqual(R.productLayoutOf(state), { form: 'L1', detail: '' });
});

test('roles saved before the permission split keep what they could do', () => {
  const old = { laiSettings: { roles: { roles: [{ id: 'sales', name: '业务', scope: 'self', perms: { 'team.targets': true, 'lead.delete': true, 'product.edit': true, 'team.view': true } }], members: [{ id: '1', name: 'K', roleId: 'admin' }] } } };
  // lead.* went with 线索 (D-030): an old 'lead.delete' is simply not a permission any more.
  const perms = R.settings(old).roles.find(r => r.id === 'sales').perms;
  for (const key of ['activity.view', 'team.goalEdit', 'product.codeEdit', 'team.export']) assert.equal(perms[key], true, key);
  assert.equal(perms['lead.delete'], undefined);
  assert.equal(perms['lead.purge'], undefined);
  assert.equal(perms['product.codeNew'], undefined);
  const saved = R.updateRole({ ...old, laiSettings: { ...old.laiSettings, defaultOwner: 'K' } }, 'sales', { perms: { 'opp.view': true } });
  assert.equal(saved.laiSettings.roles.roles.find(r => r.id === 'sales').v, 2);
  assert.deepEqual(R.settings(saved).roles.find(r => r.id === 'sales').perms, { 'opp.view': true }, 'v2 roles are not upgraded again');
});

test('renaming a member renames their records everywhere (case-insensitive), in one state', () => {
  const state0 = {
    laiSettings: { defaultOwner: 'Kris' }, orderSettings: { defaultOwner: 'amy' },
    customers: { a: { owner: 'Kris' }, b: { owner: 'AMY' }, c: { owner: 'Amy', laiBucket: 'trash' } },
    laiLeads: [{ id: 'l1', owner: 'amy' }, { id: 'l2', owner: 'Kris' }],
    orders: [{ id: 'o1', owner: 'Amy' }, { id: 'o2', owner: 'Kris' }], trashOrders: [{ id: 'o3', owner: 'Amy' }],
    laiOpportunities: [{ id: 'p1', owner: 'Kris', collaborators: ['amy', 'Bob'] }, { id: 'p2', owner: 'Amy', collaborators: [] }],
    laiTasks: [{ id: 't1', title: 'x', customer: 'a' }],
    laiTargets: [{ metric: 'orders', owner: 'Amy', value: 5 }, { metric: 'orders', owner: null, value: 9 }],
  };
  const amy = R.settings(state0).members.find(m => m.name.toLowerCase() === 'amy');
  const next = R.renameMember(state0, amy.id, 'Amelia');
  assert.ok(R.settings(next).members.some(m => m.name === 'Amelia') && !R.settings(next).members.some(m => m.name.toLowerCase() === 'amy'));
  assert.deepEqual(Object.values(next.customers).map(c => c.owner), ['Kris', 'Amelia', 'Amelia']);
  assert.deepEqual(next.laiLeads.map(l => l.owner), ['Amelia', 'Kris']);
  assert.deepEqual([...next.orders, ...next.trashOrders].map(o => o.owner), ['Amelia', 'Kris', 'Amelia']);
  assert.deepEqual(next.laiOpportunities.map(o => [o.owner, o.collaborators]), [['Kris', ['Amelia', 'Bob']], ['Amelia', []]]);
  assert.deepEqual(next.laiTargets.map(t => t.owner), ['Amelia', null]);
  assert.equal(next.orderSettings.defaultOwner, 'Amelia');
  assert.equal(next.laiSettings.defaultOwner, 'Kris', 'someone else is the default owner');
  assert.equal(state0.customers.b.owner, 'AMY', 'the input state is untouched');
  assert.equal(next.laiTasks, state0.laiTasks, 'untouched lists keep their identity');
});

test('renameOwnerEverywhere: no-ops, and the current account renaming carries the default owner', () => {
  const state0 = { laiSettings: { defaultOwner: 'Kris' }, customers: { a: { owner: 'Kris' } }, orders: [] };
  assert.equal(R.renameOwnerEverywhere(state0, 'Nobody', 'X'), state0);
  assert.equal(R.renameOwnerEverywhere(state0, 'Kris', 'Kris'), state0);
  assert.equal(R.renameOwnerEverywhere(state0, '', 'X'), state0);
  const kris = R.settings(state0).members.find(m => m.name === 'Kris');
  const next = R.renameMember(state0, kris.id, 'Chris');
  assert.equal(next.laiSettings.defaultOwner, 'Chris');
  assert.equal(next.customers.a.owner, 'Chris');
  // case-only rename
  const cased = R.renameMember(state0, kris.id, 'KRIS');
  assert.equal(cased.customers.a.owner, 'KRIS');
});

test('a saved 业务 role gets permissions added after it was saved (by its known list), but never re-enables ones it knew', () => {
  const stored = known => ({ laiSettings: { defaultOwner: 'Kris', roles: { roles: [{ id: 'sales', name: '业务', scope: 'self', v: 2, known, perms: { 'opp.view': true } }, { id: 'rx', name: '自建', scope: 'self', v: 2, known, perms: { 'opp.view': true } }], members: [{ id: 'm1', name: 'Kris', roleId: 'admin' }, { id: 'm2', name: 'Amy', roleId: 'sales' }], current: 'm1' } } });
  const all = R.KEYS.filter(key => key !== 'mail.send' && key !== 'doc.create');
  // The role was saved when mail.send and doc.create did not exist yet: both are granted (both are in the default 业务 list).
  let s = R.settings(stored(all));
  const sales = s.roles.find(r => r.id === 'sales');
  assert.equal(sales.perms['mail.send'], true);
  assert.equal(sales.perms['doc.create'], true);
  assert.equal(sales.perms['opp.view'], true);
  assert.equal(sales.perms['opp.edit'], undefined, 'known and left off: stays off');
  // A key outside the default 业务 list is never granted; a custom role never gets defaults.
  assert.equal(sales.perms['opp.delete'], undefined);
  assert.equal(s.roles.find(r => r.id === 'rx').perms['mail.send'], undefined);
  // Everything known at save time: nothing is added.
  s = R.settings(stored([...R.KEYS]));
  assert.equal(s.roles.find(r => r.id === 'sales').perms['mail.send'], undefined);
  // An old save without a known list is read against the key list of the time it was written (nothing new yet).
  s = R.settings(stored(undefined));
  assert.equal(s.roles.find(r => r.id === 'sales').perms['mail.send'], undefined);
  // Saving writes the known list, so a later new key is granted from then on.
  const saved = R.addMember(stored([...R.KEYS]), { name: 'Bob' });
  assert.deepEqual(saved.laiSettings.roles.roles.find(r => r.id === 'sales').known, [...R.KEYS]);
});

test('沟通 and export/settings keys: groups, defaults, page routes', () => {
  const group = R.GROUPS.find(([name]) => name === '沟通');
  assert.deepEqual(group[1].map(([key, label]) => [key, label]), [['chat.view', '查看聊天记录'], ['chat.send', '打开 WhatsApp 聊天和记聊天'], ['chat.import', '导入和撤销聊天记录'], ['chat.template', '管理聊天模板']]);
  for (const key of ['customer.export', 'opp.export', 'order.export', 'settings.rate', 'settings.switch', 'chat.view', 'chat.send', 'chat.import', 'chat.template']) assert.ok(R.KEYS.includes(key), key);
  assert.ok(!R.KEYS.includes('settings.task'), '任务设置 is gone (D-031)');
  assert.ok(!R.KEYS.some(key => key.startsWith('lead.') || key === 'settings.lead'), '线索 permissions are gone (D-030)');
  assert.ok(!R.GROUPS.some(([name]) => name === '线索'));
  // 业务 defaults: the three chat keys yes, template and every export / new settings key no (admin only).
  for (const key of ['chat.view', 'chat.send', 'chat.import']) assert.ok(R.SALES_DEFAULT.includes(key), key);
  for (const key of ['chat.template', 'customer.export', 'opp.export', 'order.export', 'settings.rate', 'settings.switch']) {
    assert.ok(!R.SALES_DEFAULT.includes(key), key);
    assert.ok(!R.DEPT_ADMIN_DEFAULT.includes(key), key);
  }
  const sales = R.settings(base()).roles.find(r => r.id === 'sales');
  assert.equal(sales.perms['chat.view'], true);
  assert.equal(sales.perms['chat.template'], undefined);
  // Admin can do everything; a 业务 account cannot open the admin-only pages but can open chats.
  const asSales = R.switchTo(base(), R.settings(base()).members.find(m => m.name === 'Amy').id);
  assert.equal(R.can(base(), 'settings.switch'), true);
  assert.equal(R.canOpen(asSales, 'route', 'chats'), true);
  for (const route of ['chat-templates', 'rates', 'feature-switch']) assert.equal(R.canOpen(asSales, 'route', route), false, route);
  assert.equal(R.canOpen(base(), 'route', 'feature-switch'), true);
  assert.deepEqual(['chats', 'chat-templates', 'rates', 'feature-switch'].map(route => R.pagePerm('route', route)), ['chat.view', 'chat.template', 'settings.rate', 'settings.switch']);
  for (const route of ['leads', 'lead-trash', 'lead-settings', 'task-settings', 'team-tasks', 'calendar']) assert.equal(R.pagePerm('route', route), null, route);
});

test('a role saved before the chat keys existed gets the 业务 chat defaults but no template or export rights', () => {
  const fresh = new Set(['chat.view', 'chat.send', 'chat.import', 'chat.template', 'customer.export', 'opp.export', 'order.export', 'settings.rate', 'settings.switch']);
  const oldKeys = R.KEYS.filter(key => !fresh.has(key));
  const stored = { laiSettings: { defaultOwner: 'Kris', roles: { roles: [{ id: 'sales', name: '业务', scope: 'self', v: 2, known: oldKeys, perms: { 'opp.view': true } }, { id: 'deptAdmin', name: '部门管理员', scope: 'dept', v: 2, known: oldKeys, perms: { 'opp.view': true } }], members: [{ id: 'm1', name: 'Kris', roleId: 'admin' }, { id: 'm2', name: 'Amy', roleId: 'sales' }], current: 'm1' } } };
  const s = R.settings(stored);
  for (const id of ['sales', 'deptAdmin']) {
    const role = s.roles.find(r => r.id === id);
    for (const key of ['chat.view', 'chat.send', 'chat.import']) assert.equal(role.perms[key], true, id + ' ' + key);
    for (const key of ['chat.template', 'customer.export', 'order.export', 'settings.switch']) assert.equal(role.perms[key], undefined, id + ' ' + key);
  }
  const amy = R.switchTo(stored, 'm2');
  assert.equal(R.can(amy, 'chat.view'), true);
  assert.equal(R.can(amy, 'chat.template'), false);
  // A role that knew the keys and turned them off stays off.
  const off = { laiSettings: { roles: { roles: [{ id: 'sales', name: '业务', scope: 'self', v: 2, known: [...R.KEYS], perms: { 'opp.view': true } }], members: [{ id: 'm1', name: 'Kris', roleId: 'admin' }, { id: 'm2', name: 'Amy', roleId: 'sales' }], current: 'm2' } } };
  assert.equal(R.can(off, 'chat.view'), false);
});

const typed = (state, name) => ({ ...state, laiSettings: { ...state.laiSettings, defaultOwner: name } });

test('默认跟进人: switching accounts never rewrites the typed value; 本人 and 本部门 accounts default to themselves, company-wide accounts to the typed value', () => {
  // The account list is made from 默认跟进人 the first time; after that the user types another one.
  let state = typed({ laiSettings: { defaultOwner: 'Kris' }, customers: { a: { owner: 'Amy' } }, orders: [] }, 'Kris');
  const admin = R.currentMember(state);
  const sales = R.settings(state).members.find(m => m.roleId === 'sales');
  assert.equal(R.defaultOwner(state), 'Kris');
  state = R.switchTo(state, admin.id); // stores the account list
  state = typed(state, '王小明');
  assert.equal(R.defaultOwner(state), '王小明');
  const asSales = scope => R.switchTo(R.updateRole(state, 'sales', { scope }), sales.id);
  for (const scope of ['self', 'dept']) {
    const switched = asSales(scope);
    assert.equal(switched.laiSettings.defaultOwner, '王小明', 'switching account leaves the typed value alone');
    assert.equal(R.scopeOf(switched), scope);
    assert.equal(R.defaultOwner(switched), sales.name, `${scope}: the account owns its new records`);
  }
  const wide = asSales('all');
  assert.equal(wide.laiSettings.defaultOwner, '王小明');
  assert.equal(R.defaultOwner(wide), '王小明', 'a company-wide account uses the typed value');
  const back = R.switchTo(asSales('self'), admin.id);
  assert.equal(back.laiSettings.defaultOwner, '王小明');
  assert.equal(R.defaultOwner(back), '王小明');
  // fallbacks: the old order settings, then empty
  assert.equal(R.defaultOwner({ orderSettings: { defaultOwner: ' Old ' } }), 'Old');
  assert.equal(R.defaultOwner({}), '');
  assert.equal(R.defaultOwner(null), '');
});

test('默认跟进人: renaming the current account leaves a value that is someone else, and follows when it was the old name', () => {
  // switchTo stores the account list, so the account keeps its name when the typed value changes later.
  const first = { laiSettings: { defaultOwner: 'Kris' }, customers: {}, orders: [] };
  const state0 = R.switchTo(first, R.currentMember(first).id);
  const me = R.currentMember(state0);
  assert.equal(me.name, 'Kris');
  assert.equal(R.renameMember(typed(state0, '王小明'), me.id, 'Boss').laiSettings.defaultOwner, '王小明');
  assert.equal(R.renameMember(state0, me.id, 'Chris').laiSettings.defaultOwner, 'Chris');
});

test('默认跟进人: new opportunities use the account itself when it only sees its own or its department', () => {
  const O = require('../src/opportunity-model.js');
  let state = { laiSettings: { defaultOwner: 'Kris' }, customers: {}, orders: [] };
  const sales = R.settings(state).members.find(m => m.roleId === 'sales');
  state = typed(R.switchTo(state, R.currentMember(state).id), '王小明');
  assert.equal(O.defaults(state, '2026-10-17').owner, '王小明');
  const asSales = scope => R.switchTo(R.updateRole(state, 'sales', { scope }), sales.id);
  for (const scope of ['self', 'dept']) {
    assert.equal(O.defaults(asSales(scope), '2026-10-17').owner, sales.name, scope);
  }
  assert.equal(O.defaults(asSales('all'), '2026-10-17').owner, '王小明');
});
