const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/role-model.js');

const base = () => ({ laiSettings: { defaultOwner: 'Kris' }, customers: { a: { owner: 'Kris' }, b: { owner: 'Amy' } }, orders: [] });

test('defaults: admin + 业务 roles, members from owners, admin first', () => {
  const s = R.settings(base());
  assert.deepEqual(s.roles.map(r => r.name), ['系统管理员', '业务']);
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
  assert.throws(() => R.updateRole(state, role.id, { scope: 'dept' }), /可见范围/);
  state = R.deleteRole(state, role.id);
  assert.equal(R.settings(state).roles.length, 2);
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
  assert.deepEqual(s.roles.map(r => r.name), ['系统管理员', '业务', '经理']);
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
