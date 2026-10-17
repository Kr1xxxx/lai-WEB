const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/role-model.js');
const RU = require('../src/role-ui.js');

const E = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ui = RU.create(E, R);
const base = () => ({ laiSettings: { defaultOwner: 'Kris' }, customers: { a: { owner: 'Kris' }, b: { owner: 'Amy' } }, orders: [] });
const rowOf = (html, id) => html.match(new RegExp(`<tr data-role-row="${id}">.*?</tr>`))[0];

const actionsOf = (row) => row.match(/<td class="role-actions">(.*?)<\/td>/)[1];

test('roles list: columns, admin actions are only 查看, 业务 has 编辑 but no 删除', () => {
  const html = ui.rolesMarkup(base());
  assert.deepEqual([...html.match(/<thead>.*?<\/thead>/)[0].matchAll(/<th>(.*?)<\/th>/g)].map((m) => m[1]), ['角色', '可见范围', '成员', '操作']);
  const admin = rowOf(html, 'admin');
  assert.ok(admin.includes('系统管理员') && admin.includes('全公司'));
  assert.ok(admin.includes('title="不可编辑，仅查看"'));
  assert.equal((actionsOf(admin).match(/data-role-action="/g) || []).length, 1);
  assert.ok(actionsOf(admin).includes('>查看<'));
  const sales = rowOf(html, 'sales');
  assert.ok(actionsOf(sales).includes('>编辑<') && !actionsOf(sales).includes('成员'));
  assert.ok(!sales.includes('删除'), 'builtin role cannot be deleted');
  assert.ok(sales.includes('本人'));
});

test('roles list: 部门管理员 is a built-in row with 编辑 and 编辑成员 but no 删除', () => {
  const html = ui.rolesMarkup(base());
  const row = rowOf(html, 'deptAdmin');
  assert.ok(row.includes('部门管理员') && row.includes('本部门') && row.includes('内置'));
  assert.ok(actionsOf(row).includes('>编辑<') && !row.includes('删除'));
  assert.ok(row.includes('>编辑成员<') && row.includes('暂无成员'));
});

test('roles list: up to 4 initial avatars, 共计N位 beyond that, 暂无成员 when empty', () => {
  let state = base();
  state = R.addRole(state, { name: '经理' });
  const manager = R.settings(state).roles.find((r) => r.name === '经理').id;
  assert.ok(rowOf(ui.rolesMarkup(state), manager).includes('暂无成员'));
  assert.ok(!rowOf(ui.rolesMarkup(state), manager).includes('共计'));
  for (const name of ['Ann', 'Bob', '陈一', '李二']) state = R.addMember(state, { name, roleId: manager });
  let cell = rowOf(ui.rolesMarkup(state), manager);
  assert.equal((cell.match(/class="role-avatar"/g) || []).length, 4);
  assert.ok(!cell.includes('共计') && !cell.includes('暂无成员'));
  assert.ok(cell.includes('>A</span>') && cell.includes('>陈</span>'), 'first character of the name');
  state = R.addMember(state, { name: 'Zed', roleId: manager });
  cell = rowOf(ui.rolesMarkup(state), manager);
  assert.equal((cell.match(/class="role-avatar"/g) || []).length, 4, 'never more than 4 faces');
  assert.ok(cell.includes('共计5位'));
  assert.ok(cell.includes(`data-role-action="members" data-id="${manager}">编辑成员<`));
});

test('roles list: member counts and a delete button for custom roles (two-click)', () => {
  const state = R.addRole(base(), { name: '经理' });
  const id = R.settings(state).roles.find((r) => r.name === '经理').id;
  let html = ui.rolesMarkup(state);
  assert.ok(rowOf(html, id).includes('>删除<'));
  assert.ok(rowOf(html, id).includes('暂无成员'));
  assert.equal((rowOf(html, 'admin').match(/class="role-avatar"/g) || []).length, 1);
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
  assert.ok(html.includes('本人＝只看自己负责的客户、商机和订单'));
  assert.match(html, /<option value="self" selected>本人<\/option>/);
});

test('a group shows 全选 checked only when every item is on', () => {
  const html = ui.editMarkup(base(), 'sales');
  const group = (name) => html.match(new RegExp(`<fieldset class="role-group k-card"[^>]*><legend><span class="role-group-name">${name}</span>.*?</legend>`))[0];
  assert.ok(!/data-role-all[^>]* checked/.test(group('商机')), '商机 has 删除 off');
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
  assert.ok(rename.includes('会把这个人负责的客户、订单、商机一起改名'), 'renaming warns about the records that follow');
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

// ---------- 可见范围、字段权限、布局权限 ----------
const FIELD_LIST = {
  opp: [{ key: 'phone', label: '电话' }, { key: 'email', label: '邮箱', group: '联系方式' }, { key: 'wechat', label: '微信', group: '联系方式' }],
  customer: [], pool: [], product: [{ key: 'cost', label: '成本价' }],
};
const deps = { fields: { list: (state, module) => FIELD_LIST[module] || [] }, layouts: () => [{ id: 'default', name: '默认布局' }, { id: 'l1', name: '外贸布局' }] };
const ui2 = RU.create(E, R, deps);

test('edit view: scope has 本人 / 本部门 / 全公司, with a hint for the selected one', () => {
  const html = ui.editMarkup(base(), 'sales');
  const options = [...html.match(/<select name="scope"[^>]*>(.*?)<\/select>/)[1].matchAll(/<option value="(\w+)"[^>]*>(.*?)<\/option>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(options, [['self', '本人'], ['dept', '本部门'], ['all', '全公司']]);
  assert.ok(html.includes('id="role-scope-hint">本人＝只看自己负责的客户、商机和订单。'));
  assert.ok(ui.editMarkup(base(), 'deptAdmin').includes('本部门＝看自己和本部门（含下级部门）成员负责的'));
  assert.ok(ui.editMarkup(base(), 'admin').includes('全公司＝都能看'));
  assert.equal(ui.scopeHint('dept'), '本部门＝看自己和本部门（含下级部门）成员负责的客户、商机和订单。');
});

test('edit view: 设置字段权限 sits next to 商机 客户 公海客户 产品, 设置布局权限 only next to 产品', () => {
  const html = ui2.editMarkup(base(), 'sales');
  const group = (name) => html.match(new RegExp(`<fieldset class="role-group k-card"[^>]*><legend><span class="role-group-name">${name}</span>.*?</legend>`))[0];
  assert.ok(!html.includes('role-group-name">线索<') && !html.includes('data-module="lead"'), '线索 is gone (D-030)');
  for (const [name, module] of [['商机', 'opp'], ['客户', 'customer'], ['公海客户', 'pool'], ['产品', 'product']]) {
    assert.ok(group(name).includes(`data-role-action="fields" data-module="${module}">设置字段权限<`), name);
  }
  for (const name of ['订单', '邮件', '商机', '跟进动态']) assert.ok(!group(name).includes('设置布局权限'), name);
  assert.ok(group('产品').includes('data-role-action="layouts">设置布局权限<'));
  assert.ok(!group('订单').includes('设置字段权限') && !group('跟进动态').includes('设置字段权限'));
  assert.ok(html.includes('跟进动态') && html.includes('编辑目标值') && html.includes('导出成员排行'));
});

test('edit view: the count shows how many listed fields the draft restricts', () => {
  const none = ui2.editMarkup(base(), 'sales');
  assert.match(none, /data-role-limit="opp" hidden><\/span>/);
  const html = ui2.editMarkup(base(), 'sales', { fields: { opp: { phone: 'read', email: 'hidden', gone: 'read' }, product: { cost: 'hidden' } } });
  assert.match(html, /data-role-limit="opp">已限制 2 个<\/span>/, 'a field that is no longer listed is not counted');
  assert.match(html, /data-role-limit="product">已限制 1 个<\/span>/);
  assert.match(html, /data-role-limit="customer" hidden>/);
  assert.match(html, /data-role-layout-tag hidden>/);
  assert.match(ui2.editMarkup(base(), 'sales', { layouts: { product: { form: 'l1', detail: '' } } }), /data-role-layout-tag>已指定布局</);
  assert.equal(ui2.limitCount(base(), 'opp', { opp: { phone: 'read' } }), 1);
});

test('edit view of 系统管理员 still has the links (they open read-only) and every input stays disabled', () => {
  const html = ui2.editMarkup(base(), 'admin');
  assert.equal((html.match(/data-role-action="fields"/g) || []).length, 4, '商机 客户 公海客户 产品');
  assert.ok(html.includes('设置布局权限'));
  for (const input of html.match(/<(input|select)\b[^>]*>/g)) assert.ok(/ disabled/.test(input), input);
});

test('field dialog: a row per field with 可编辑 / 只读 / 隐藏, grouped, with the saved level checked', () => {
  const html = ui2.fieldsMarkup(base(), 'opp', { phone: 'read', email: 'hidden' });
  const rows = html.match(/<div class="role-field-row"[^>]*>.*?<\/span><\/div>/g);
  assert.equal(rows.length, 3);
  const level = (key) => rows.find((r) => r.includes(`data-field-key="${key}"`)).match(/value="(\w+)" checked/)[1];
  assert.equal(level('phone'), 'read');
  assert.equal(level('email'), 'hidden');
  assert.equal(level('wechat'), 'edit');
  for (const row of rows) assert.deepEqual([...row.matchAll(/<span>(可编辑|只读|隐藏)<\/span>/g)].map((m) => m[1]), ['可编辑', '只读', '隐藏']);
  assert.equal((html.match(/class="role-field-group"/g) || []).length, 1, 'one heading for the 联系方式 group');
  assert.ok(html.indexOf('联系方式') > html.indexOf('电话') && html.indexOf('联系方式') < html.indexOf('邮箱'));
  assert.ok(html.includes('data-level="edit">全部可编辑<') && html.includes('data-level="read">全部只读<'));
  assert.ok(html.includes('data-role-form="fields"') && html.includes('data-module="opp"'));
});

test('field dialog: empty module says so, read-only view disables everything and shows 可编辑', () => {
  const empty = ui2.fieldsMarkup(base(), 'customer', {});
  assert.ok(empty.includes('这个模块还没有可以单独设置的字段'));
  assert.ok(!empty.includes('type="radio"') && !empty.includes('全部只读'));
  assert.ok(ui.fieldsMarkup(base(), 'opp', {}).includes('这个模块还没有可以单独设置的字段'), 'no deps at all');
  const ro = ui2.fieldsMarkup(base(), 'opp', { phone: 'hidden' }, { readOnly: true });
  const radios = ro.match(/<input type="radio"[^>]*>/g);
  assert.equal(radios.length, 9);
  for (const radio of radios) assert.ok(/ disabled/.test(radio));
  assert.equal(ro.match(/value="edit" checked/g).length, 3, 'always shown as 可编辑');
  assert.ok(!ro.includes('全部只读'));
});

test('layout dialog: 跟随默认分配 plus every product layout, saved choice selected', () => {
  const html = ui2.layoutMarkup(base(), { form: 'l1', detail: '' });
  assert.ok(html.includes('新建/编辑产品用的布局') && html.includes('产品详情用的布局'));
  const selects = html.match(/<select name="(form|detail)".*?<\/select>/g);
  assert.equal(selects.length, 2);
  for (const select of selects) {
    assert.deepEqual([...select.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]), ['', 'default', 'l1']);
    assert.ok(select.includes('>跟随默认分配<') && select.includes('>外贸布局<'));
  }
  assert.match(selects[0], /<option value="l1" selected>/);
  assert.match(selects[1], /<option value="" selected>跟随默认分配/);
  const ro = ui2.layoutMarkup(base(), { form: 'l1' }, { readOnly: true });
  assert.equal((ro.match(/<select[^>]* disabled>/g) || []).length, 2);
  assert.ok(!ro.includes('selected>外贸布局'));
});

// ---------- 部门 ----------
function withDepts() {
  let state = R.addMember(R.addMember(base(), { name: 'Mia' }), { name: 'Joe' });
  state = R.addDepartment(state, { name: '销售部' });
  const sales = R.deptTree(state)[0].id;
  state = R.addDepartment(state, { name: '一组', parentId: sales });
  const team = R.deptTree(state)[1].id;
  const memberId = (name) => R.settings(state).members.find((m) => m.name === name).id;
  state = R.setMemberDept(state, memberId('Mia'), team);
  state = R.setMemberDept(state, memberId('Joe'), sales);
  return { state, sales, team, memberId };
}

test('members page: tree with 我的企业, indented departments, counts and 未分配', () => {
  const { state, sales, team } = withDepts();
  const html = ui.membersMarkup(state);
  const nodes = [...html.matchAll(/<button type="button" class="role-dept-node[^"]*" data-role-action="dept-pick" data-id="([^"]*)"[^>]*style="--lv:(\d)"[^>]*><span class="role-dept-name">(.*?)<\/span><span class="role-dept-count">(\d+)<\/span>/g)].map((m) => [m[1], Number(m[2]), m[3], Number(m[4])]);
  const total = R.settings(state).members.length;
  assert.deepEqual(nodes, [['', 0, '我的企业', total], [sales, 1, '销售部', 2], [team, 2, '一组', 1], ['__none', 1, '未分配', total - 2]]);
  assert.ok(html.includes('data-role-action="dept-add">新建部门<'));
  assert.ok(html.includes('class="role-dept-node is-selected" data-role-action="dept-pick" data-id=""'), 'root selected by default');
});

test('members page: clicking a node filters the table (a department includes its sub-departments)', () => {
  const { state, sales, team } = withDepts();
  const names = (view) => [...ui.membersMarkup(state, view).matchAll(/<tr data-member-row="[^"]*"><td><b>(.*?)<\/b>/g)].map((m) => m[1]);
  assert.deepEqual(names({ dept: team }), ['Mia']);
  assert.deepEqual(names({ dept: sales }).sort(), ['Joe', 'Mia']);
  assert.ok(!names({ dept: '__none' }).includes('Mia') && names({ dept: '__none' }).includes('Kris'));
  assert.equal(names({}).length, R.settings(state).members.length);
  assert.ok(ui.membersMarkup(state, { dept: team }).includes('class="role-dept-node is-selected" data-role-action="dept-pick" data-id="' + team));
  assert.equal(names({ dept: 'gone' }).length, R.settings(state).members.length, 'a deleted department falls back to 我的企业');
  const roleToo = ui.membersMarkup(state, { dept: sales, filter: 'sales' });
  assert.ok(roleToo.includes('只看角色') && roleToo.includes('Mia'));
  const empty = R.addDepartment(base(), { name: '空部门' });
  assert.ok(ui.membersMarkup(empty, { dept: R.deptTree(empty)[0].id }).includes('这个部门还没有成员'));
});

test('members page: department toolbar (改名/删除) only for a real department; table has a 部门 select per member', () => {
  const { state, sales, memberId } = withDepts();
  assert.ok(!ui.membersMarkup(state).includes('role-dept-bar'));
  assert.ok(!ui.membersMarkup(state, { dept: '__none' }).includes('role-dept-bar'));
  const bar = ui.membersMarkup(state, { dept: sales }).match(/<div class="role-dept-bar">.*?<\/div>/)[0];
  assert.ok(bar.includes('<b>销售部</b>') && bar.includes('data-role-action="dept-rename"') && bar.includes('>删除<'));
  assert.ok(ui.membersMarkup(state, { dept: sales, armedDept: sales }).includes('确定删除'));
  assert.ok(ui.membersMarkup(state).includes('<th>部门</th>'));
  const row = ui.membersMarkup(state).match(new RegExp(`<tr data-member-row="${memberId('Mia')}">.*?</tr>`))[0];
  const select = row.match(/<select data-role-member-dept[^>]*>.*?<\/select>/)[0];
  assert.ok(select.includes('aria-label="Mia的部门"'));
  assert.ok(select.includes('<option value="">未分配</option>'));
  assert.ok(select.includes(`<option value="${sales}">销售部</option>`));
  assert.match(select, /<option value="[^"]+" selected>　一组<\/option>/, 'sub-department is indented and Mia selected');
});

test('department dialogs: 新建部门 with 上级部门 (default 我的企业), add member with 部门', () => {
  const { state, sales } = withDepts();
  const add = ui.deptAddMarkup(state, sales);
  assert.ok(add.includes('部门名称') && add.includes('上级部门') && add.includes('data-role-form="dept-add"'));
  assert.ok(add.includes('<option value="">我的企业</option>'));
  assert.ok(add.includes(`<option value="${sales}" selected>销售部</option>`));
  assert.ok(ui.deptAddMarkup(state).includes('<option value="" selected>我的企业</option>'));
  const rename = ui.deptRenameMarkup({ id: 'd1', name: '销售部' });
  assert.ok(rename.includes('value="销售部"') && rename.includes('data-id="d1"'));
  const member = ui.addMemberMarkup(state, { deptId: sales });
  assert.ok(member.includes('name="deptId"') && member.includes(`<option value="${sales}" selected>销售部</option>`));
  assert.ok(ui.addMemberMarkup(state).includes('<option value="" selected>未分配</option>'));
  assert.ok(ui.addMemberMarkup(state, { deptId: 'gone' }).includes('<option value="" selected>未分配</option>'));
});

test('department and field names are escaped', () => {
  let state = R.addDepartment(base(), { name: '<i>x</i>' });
  for (const html of [ui.membersMarkup(state), ui.addMemberMarkup(state), ui.deptAddMarkup(state), ui.membersMarkup(state, { dept: R.deptTree(state)[0].id })]) assert.ok(!html.includes('<i>x</i>'));
  state = R.updateRole(state, 'sales', { fields: { opp: { '"><b>': 'read' } } });
  const field = RU.create(E, R, { fields: { list: () => [{ key: '"><b>', label: '<u>名</u>' }] } });
  const html = field.fieldsMarkup(state, 'opp', {});
  assert.ok(!html.includes('<u>名</u>') && !html.includes('"><b>'));
});
