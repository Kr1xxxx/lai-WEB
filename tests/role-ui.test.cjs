const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/role-model.js');
const RU = require('../src/role-ui.js');

const E = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ui = RU.create(E, R);
const base = () => ({ laiSettings: { defaultOwner: 'Kris' }, customers: { a: { owner: 'Kris' }, b: { owner: 'Amy' } }, orders: [] });
const rowOf = (html, id) => html.match(new RegExp(`<tr data-role-row="${id}">.*?</tr>`))[0];

test('roles list: columns, admin row has only 查看, 业务 row has 编辑 and 成员 but no 删除', () => {
  const html = ui.rolesMarkup(base());
  for (const heading of ['角色名称', '可见范围', '成员数', '操作']) assert.ok(html.includes(`>${heading}<`) || html.includes(`${heading}</th>`), heading);
  const admin = rowOf(html, 'admin');
  assert.ok(admin.includes('系统管理员') && admin.includes('全公司'));
  assert.ok(admin.includes('title="不可编辑，仅查看"'));
  assert.equal((admin.match(/data-role-action="/g) || []).length, 1);
  assert.ok(admin.includes('>查看<'));
  const sales = rowOf(html, 'sales');
  assert.ok(sales.includes('>编辑<') && sales.includes('>成员<'));
  assert.ok(!sales.includes('删除'), 'builtin role cannot be deleted');
  assert.ok(sales.includes('本人'));
});

test('roles list: member counts and a delete button for custom roles (two-click)', () => {
  const state = R.addRole(base(), { name: '经理' });
  const id = R.settings(state).roles.find((r) => r.name === '经理').id;
  let html = ui.rolesMarkup(state);
  assert.ok(rowOf(html, id).includes('>删除<'));
  assert.match(rowOf(html, id), /<td class="num">0<\/td>/);
  assert.match(rowOf(html, 'admin'), /<td class="num">1<\/td>/);
  html = ui.rolesMarkup(state, { armed: id });
  assert.ok(rowOf(html, id).includes('确定删除'));
});

test('edit view: one block per group, checkboxes follow the role perms', () => {
  const state = base();
  const html = ui.editMarkup(state, 'sales');
  assert.equal((html.match(/data-role-group/g) || []).length, R.GROUPS.length);
  assert.equal((html.match(/data-role-all/g) || []).length, R.GROUPS.length);
  const sales = R.settings(state).roles.find((r) => r.id === 'sales');
  const boxes = html.match(/<input type="checkbox" name="perm"[^>]*>/g);
  assert.equal(boxes.length, R.KEYS.length);
  for (const box of boxes) {
    const key = box.match(/value="([^"]+)"/)[1];
    assert.equal(/ checked/.test(box), sales.perms[key] === true, key);
    assert.ok(!/ disabled/.test(box));
  }
  assert.ok(html.includes('type="submit"') && html.includes('取消'));
  assert.ok(html.includes('role="alert"'));
  assert.ok(html.includes('本人＝只看自己负责的客户、线索、商机和订单'));
  assert.match(html, /<option value="self" selected>本人<\/option>/);
});

test('a group shows 全选 checked only when every item is on', () => {
  const html = ui.editMarkup(base(), 'sales');
  const group = (name) => html.match(new RegExp(`<fieldset class="role-group"[^>]*><legend><span class="role-group-name">${name}</span>.*?</legend>`))[0];
  assert.ok(!/data-role-all[^>]* checked/.test(group('线索')), '线索 has 删除 off');
  assert.ok(/data-role-all[^>]* checked/.test(group('邮件')), '邮件 is all on');
});

test('admin edit view is read-only: everything checked and disabled, no 保存', () => {
  const html = ui.editMarkup(base(), 'admin');
  assert.ok(html.includes('系统管理员不可编辑，仅查看'));
  assert.ok(!html.includes('>保存<'));
  assert.ok(!html.includes('type="submit"'));
  const inputs = html.match(/<(input|select)\b[^>]*>/g);
  assert.ok(inputs.length > R.KEYS.length);
  for (const input of inputs) assert.ok(/ disabled/.test(input), input);
  for (const box of html.match(/<input type="checkbox"[^>]*>/g)) assert.ok(/ checked/.test(box), box);
});

test('edit view for an unknown role says so', () => {
  assert.ok(ui.editMarkup(base(), 'nope').includes('没有找到这个角色'));
});

test('add role dialog: 复制权限自 defaults to 业务 and never offers 系统管理员', () => {
  const state = R.addRole(base(), { name: '经理' });
  const html = ui.addRoleMarkup(state);
  assert.ok(html.includes('角色名称') && html.includes('复制权限自'));
  assert.match(html, /<option value="sales" selected>业务<\/option>/);
  assert.ok(!html.includes('系统管理员'));
  assert.ok(html.includes('经理'));
});

test('members list: select of roles, current tag, switch/rename/delete actions', () => {
  const state = base();
  const s = R.settings(state);
  const html = ui.membersMarkup(state);
  assert.ok(html.includes('来财还没有登录，这里的成员是本机测试账号，用来预览不同角色看到什么，不是安全措施。'));
  const current = html.match(new RegExp(`<tr data-member-row="${s.current}">.*?</tr>`))[0];
  assert.ok(current.includes('当前使用'));
  assert.ok(!current.includes('切换到此账号') && !current.includes('删除'), 'cannot switch to or delete the current account');
  assert.ok(current.includes('改名'));
  const other = s.members.find((m) => m.id !== s.current);
  const row = html.match(new RegExp(`<tr data-member-row="${other.id}">.*?</tr>`))[0];
  assert.ok(row.includes('切换到此账号') && row.includes('>删除<') && row.includes('改名'));
  assert.ok(!row.includes('当前使用'));
  assert.match(row, /<option value="sales" selected>业务<\/option>/);
  assert.match(row, /<option value="admin">系统管理员<\/option>/);
  assert.ok(ui.membersMarkup(state, { armed: other.id }).includes('确定删除'));
});

test('members list can be filtered by role', () => {
  const html = ui.membersMarkup(base(), { filter: 'sales' });
  assert.ok(html.includes('只看角色：<b>业务</b>') && html.includes('查看全部成员'));
  assert.ok(html.includes('Amy') && !html.includes('<b>Kris</b>'));
  const state = R.addRole(base(), { name: '经理' });
  const empty = ui.membersMarkup(state, { filter: R.settings(state).roles.at(-1).id });
  assert.ok(empty.includes('这个角色还没有成员'));
});

test('member dialogs', () => {
  const add = ui.addMemberMarkup(base());
  assert.ok(add.includes('名字') && add.includes('角色'));
  assert.match(add, /<option value="sales" selected>业务<\/option>/);
  const rename = ui.renameMarkup({ id: 'm1', name: 'Amy' });
  assert.ok(rename.includes('value="Amy"') && rename.includes('data-id="m1"'));
});

test('no permission: the notice replaces the page content', () => {
  const html = ui.deniedMarkup();
  assert.ok(html.includes(E(R.denied('settings.roles'))));
  assert.ok(html.includes('你的角色没有“设置管理·角色权限和成员管理”权限，请找系统管理员开通'));
});

test('user text is escaped', () => {
  const evil = '<img src=x onerror=1';
  let state = R.addRole(base(), { name: evil });
  state = R.addMember(state, { name: '<b>x</b>' });
  const roleId = R.settings(state).roles.at(-1).id;
  for (const html of [ui.rolesMarkup(state), ui.membersMarkup(state), ui.addRoleMarkup(state), ui.addMemberMarkup(state), ui.editMarkup(state, roleId), ui.renameMarkup({ id: '"><i>', name: '<b>x</b>' })]) {
    assert.ok(!html.includes('<img src=x'), 'role name escaped');
    assert.ok(!html.includes('<b>x</b>'), 'member name escaped');
    assert.ok(!html.includes('"><i>'), 'id escaped');
  }
});
