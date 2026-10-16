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
  assert.equal(state.laiSettings.defaultOwner, 'Amy');
  assert.equal(R.can(state, 'customer.view'), true);
  assert.equal(R.can(state, 'customer.import'), false);
  assert.equal(R.can(state, 'settings.roles'), false);
  assert.equal(R.scopeOf(state), 'self');
  assert.equal(R.canSee(state, 'amy'), true);
  assert.equal(R.canSee(state, 'Kris'), false);
  assert.equal(R.canSee(state, ''), false);
  assert.equal(R.canOpen(state, 'route', 'roles'), false);
  assert.equal(R.canOpen(state, 'route', 'leads'), true);
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

test('role and member changes keep the default owner; only switching (or renaming yourself) changes it', () => {
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
  const perms = R.settings(old).roles.find(r => r.id === 'sales').perms;
  for (const key of ['activity.view', 'team.goalEdit', 'lead.purge', 'product.codeEdit', 'team.export']) assert.equal(perms[key], true, key);
  assert.equal(perms['product.codeNew'], undefined);
  const saved = R.updateRole({ ...old, laiSettings: { ...old.laiSettings, defaultOwner: 'K' } }, 'sales', { perms: { 'lead.view': true } });
  assert.equal(saved.laiSettings.roles.roles.find(r => r.id === 'sales').v, 2);
  assert.deepEqual(R.settings(saved).roles.find(r => r.id === 'sales').perms, { 'lead.view': true }, 'v2 roles are not upgraded again');
});
