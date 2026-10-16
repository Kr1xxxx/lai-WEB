'use strict';
// 角色：产品字段权限、产品编号权限、产品布局权限，以及团队数据里“编辑目标值”“导出成员排行”两项权限。
// 产品模块读全局的 LaiRoleModel（页面里就是这样），测试里也放一个。
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/role-model.js');
globalThis.LaiRoleModel = R;
const P = require('../src/product-model.js');
const ProductUI = require('../src/product-ui.js');
const TeamUI = require('../src/team-ui.js');
const TM = require('../src/team-model.js');
const { escapeHtml: E } = require('../src/model.js');

const NOW = '2026-10-01T00:00:00.000Z';
const salesPerms = (extra = {}) => ({ ...R.settings({}).roles.find((r) => r.id === 'sales').perms, 'product.create': true, 'product.edit': true, 'product.sync': true, ...extra });

// 管理员看到的初始数据：一个产品、一个分组、一种规格、一个自建布局。
function seed() {
  let s = { laiSettings: { defaultOwner: 'Kris' } };
  s = P.addGroup(s, { name: '睫毛' });
  s = P.addSpec(s, '颜色');
  s = P.addSpecValue(s, P.settings(s).specs[0].id, '黑色');
  s = P.addSpecValue(s, P.settings(s).specs[0].id, '棕色');
  s = P.upsert(s, 'p1', { name: '云朵睫毛', nameCn: '云朵', code: 'C-1', model: 'M-1', group: '睫毛', fob: '2.5', unit: '对', remark: '内部备注', specs: [{ type: '颜色', value: '黑色' }] }, NOW);
  return s;
}
const asSales = (state, { fields, layouts, perms } = {}) => {
  const id = R.settings(state).members.find((m) => m.roleId === 'sales').id;
  const set = R.updateRole(state, 'sales', { perms: perms || salesPerms(), fields, layouts });
  return R.switchTo(set, id);
};
const product = (s, id = 'p1') => s.laiProducts.find((p) => p.id === id);

test('roleFieldList: stored keys, no name / code / required, specs only when spec types exist', () => {
  const s = seed();
  const list = P.roleFieldList(s);
  const keys = list.map((r) => r.key);
  assert.ok(!keys.includes('name') && !keys.includes('code'));
  for (const key of ['nameCn', 'model', 'group', 'unit', 'remark', 'link', 'description', 'fob', 'size', 'volume', 'netWeight', 'packSize', 'boxQty', 'boxMethod', 'specs']) assert.ok(keys.includes(key), key);
  assert.ok(list.every((r) => r.label && r.group));
  assert.equal(list.find((r) => r.key === 'fob').group, '价格信息');
  // 必填的和隐藏的字段不出现
  const next = P.setField(P.setField(s, 'model', { required: true }), 'remark', { visible: false });
  assert.ok(!P.roleFieldList(next).some((r) => ['model', 'remark'].includes(r.key)));
  assert.ok(!P.roleFieldList({}).some((r) => r.key === 'specs'));
  assert.deepEqual(P.roleFieldList({}).filter((r) => r.key === 'code' || r.key === 'name'), []);
});

test('saving as 业务: read-only and hidden fields keep their value, the rest can change', () => {
  const sales = asSales(seed(), { fields: { product: { model: 'read', remark: 'hidden', fob: 'read', specs: 'read' } }, perms: salesPerms({ 'product.codeEdit': true }) });
  const edited = P.upsert(sales, 'p1', { name: '云朵睫毛2', nameCn: '新中文名', code: 'C-9', model: 'HACK', remark: '', fob: '99', unit: '盒', group: '睫毛', specs: [{ type: '颜色', value: '棕色' }] }, '2026-10-02T00:00:00.000Z');
  const p = product(edited);
  assert.equal(p.model, 'M-1');
  assert.equal(p.remark, '内部备注', '隐藏的字段不会因为表单里没有而被清空');
  assert.equal(p.fob, '2.5');
  assert.deepEqual(p.specs, [{ type: '颜色', value: '黑色' }]);
  assert.equal(p.nameCn, '新中文名');
  assert.equal(p.unit, '盒');
  assert.equal(p.name, '云朵睫毛2');
  assert.equal(p.code, 'C-9', '有“编辑产品编号（编辑产品）”可以改编号');
  // 表单里完全没传（被禁用的输入不在 FormData 里）也一样
  const partial = P.upsert(sales, 'p1', { name: '云朵睫毛', unit: '对' }, NOW);
  assert.equal(product(partial).model, 'M-1');
  assert.equal(product(partial).remark, '内部备注');
});

test('admin is not limited by a role', () => {
  const s = R.updateRole(seed(), 'sales', { fields: { product: { model: 'read' } } });
  const edited = P.upsert(s, 'p1', { name: '云朵睫毛', model: 'NEW', code: 'C-2' }, NOW);
  assert.equal(product(edited).model, 'NEW');
  assert.equal(product(edited).code, 'C-2');
  assert.equal(P.lockedKeys(s, true).size, 0);
});

test('产品编号: 新建要 codeNew，编辑要 codeEdit', () => {
  const none = asSales(seed(), { perms: salesPerms() });
  assert.ok(P.lockedKeys(none, true).has('code') && P.lockedKeys(none, false).has('code'));
  const created = P.upsert(none, 'p2', { name: '新品', code: 'N-1' }, NOW);
  assert.equal(product(created, 'p2').code, '', '没有权限就留空');
  const kept = P.upsert(none, 'p1', { name: '云朵睫毛', code: 'X-1' }, NOW);
  assert.equal(product(kept).code, 'C-1');
  const onlyNew = asSales(seed(), { perms: salesPerms({ 'product.codeNew': true }) });
  assert.equal(product(P.upsert(onlyNew, 'p2', { name: '新品', code: 'N-1' }, NOW), 'p2').code, 'N-1');
  assert.equal(product(P.upsert(onlyNew, 'p1', { name: '云朵睫毛', code: 'X-1' }, NOW)).code, 'C-1');
  const onlyEdit = asSales(seed(), { perms: salesPerms({ 'product.codeEdit': true }) });
  assert.equal(product(P.upsert(onlyEdit, 'p2', { name: '新品', code: 'N-1' }, NOW), 'p2').code, '');
  assert.equal(product(P.upsert(onlyEdit, 'p1', { name: '云朵睫毛', code: 'X-1' }, NOW)).code, 'X-1');
  // 编号配成必填时，没有权限的人也能保存（编号留空），不被挡住
  const required = asSales(P.setField(seed(), 'code', { required: true }), { perms: salesPerms() });
  assert.equal(product(P.upsert(required, 'p2', { name: '新品' }, NOW), 'p2').code, '');
});

test('a locked field that became required does not block saving an existing product', () => {
  let s = seed();
  s = P.upsert(s, 'p3', { name: '没单位', code: 'C-3' }, NOW);
  const sales = asSales(P.setField(s, 'unit', { required: true }), { fields: { product: { unit: 'read' } } });
  const saved = P.upsert(sales, 'p3', { name: '没单位 改', code: 'C-3' }, NOW);
  assert.equal(product(saved, 'p3').name, '没单位 改');
  assert.equal(product(saved, 'p3').unit, '');
});

test('list search and the order-line copy do not reveal hidden fields', () => {
  const sales = asSales(seed(), { fields: { product: { remark: 'hidden', model: 'hidden', fob: 'hidden' } } });
  assert.equal(P.list(sales, { search: '内部备注' }).length, 0);
  assert.equal(P.list(sales, { search: 'M-1' }).length, 0);
  assert.equal(P.list(sales, { search: '云朵' }).length, 1);
  const copy = P.forRole(sales, P.find(sales, 'p1'));
  assert.equal(copy.model, '');
  assert.equal(copy.remark, '');
  assert.equal(copy.fob, '');
  assert.equal(copy.name, '云朵睫毛');
  assert.equal(P.find(sales, 'p1').model, 'M-1', '数据本身不动');
  assert.equal(P.forRole(seed(), P.find(seed(), 'p1')).model, 'M-1');
});

test('sync: existing products keep locked fields, new products cannot set them', () => {
  const sales = asSales(seed(), { fields: { product: { model: 'read', remark: 'hidden', unit: 'read' } }, perms: salesPerms() });
  const rows = [
    { line: 2, values: { name: '云朵睫毛', code: 'C-1', model: 'HACK', remark: 'HACK', fob: '3', unit: '盒' } },
    { line: 3, values: { name: '新品', code: 'N-1', model: 'M-N', remark: 'R', fob: '4', unit: '个' } },
  ];
  const plan = P.planSync(sales, rows);
  assert.deepEqual(plan.rows.map((r) => r.status), ['update', 'new']);
  assert.deepEqual(plan.rows[0].changes, ['fob']);
  assert.match(plan.rows[0].warnings.join(''), /产品型号/);
  assert.equal(plan.rows[1].code, '', '没有 codeNew，新建的产品不能带编号');
  const { state } = P.syncProducts(sales, rows, { at: '2026-10-03T00:00:00.000Z' });
  const old = product(state);
  assert.deepEqual([old.model, old.remark, old.unit, old.fob, old.code], ['M-1', '内部备注', '对', '3', 'C-1']);
  const fresh = state.laiProducts.find((p) => p.name === '新品');
  assert.deepEqual([fresh.model, fresh.remark, fresh.unit, fresh.fob, fresh.code], ['', '', '', '4', '']);
  // 有 codeNew 的账号新建时编号照填
  const withCode = asSales(seed(), { perms: salesPerms({ 'product.codeNew': true }) });
  assert.equal(P.syncProducts(withCode, [rows[1]], { at: NOW }).state.laiProducts.find((p) => p.name === '新品').code, 'N-1');
  // 管理员不受影响
  const adminState = P.syncProducts(R.updateRole(seed(), 'sales', { fields: { product: { model: 'read' } } }), rows, { at: NOW }).state;
  assert.equal(product(adminState).model, 'HACK');
});

test('sync template and table: hidden / read-only columns are left out', () => {
  const sales = asSales(seed(), { fields: { product: { model: 'read', remark: 'hidden' } } });
  const headers = P.templateHeaders(sales);
  assert.ok(headers.includes('产品编号') && headers.includes('产品名称') && headers.includes('离岸价'));
  assert.ok(!headers.includes('产品型号') && !headers.includes('产品备注'));
  assert.ok(P.templateHeaders(seed()).includes('产品型号'));
  const table = P.readTable(sales, ['产品名称', '产品备注', '离岸价'], [['A', 'x', '1']]);
  assert.deepEqual(table.columns, ['name', 'fob']);
  assert.deepEqual(table.ignored, ['产品备注']);
});

// ---------- 布局 ----------
function withLayouts() {
  let s = seed();
  s = P.addLayout(s, { name: '业务表单', id: 'lf' });
  s = P.hideLayoutField(s, 'lf', 'remark');
  s = P.hideLayoutField(s, 'lf', 'link');
  s = P.addLayout(s, { name: '业务详情', id: 'ld' });
  s = P.hideLayoutField(s, 'ld', 'fob');
  return s;
}
const fieldKeys = (sections) => sections.flatMap((sec) => sec.fields.map((f) => f[0]));

test('layouts: the role layout is used for the form and the detail, falling back to the default assignment', () => {
  const base = withLayouts();
  const admin = base;
  assert.ok(fieldKeys(P.formSections(admin)).includes('remark'));
  const sales = asSales(base, { layouts: { product: { form: 'lf', detail: 'ld' } } });
  assert.ok(!fieldKeys(P.formSections(sales)).includes('remark'), '角色的新建/编辑布局');
  assert.ok(fieldKeys(P.formSections(sales)).includes('fob'));
  assert.ok(!fieldKeys(P.detailSections(sales)).includes('fob'), '角色的详情布局');
  assert.ok(fieldKeys(P.detailSections(sales)).includes('remark'));
  assert.equal(P.layoutForPlace(sales, 'form').id, 'lf');
  // 管理员不跟着角色走
  const adminSwitched = R.switchTo(sales, R.settings(sales).members.find((m) => m.roleId === 'admin').id);
  assert.ok(fieldKeys(P.formSections(adminSwitched)).includes('remark'));
  // 角色只选了详情：新建/编辑跟默认分配
  const detailOnly = asSales(base, { layouts: { product: { form: '', detail: 'ld' } } });
  assert.ok(fieldKeys(P.formSections(detailOnly)).includes('remark'));
  // 默认分配改成别的布局，没选布局的角色跟着变
  const assigned = asSales(P.setLayoutUse(base, 'form', 'lf'), {});
  assert.ok(!fieldKeys(P.formSections(assigned)).includes('remark'));
  // 角色记着的布局不存在了：回到默认分配
  const missing = asSales(base, { layouts: { product: { form: 'gone', detail: 'gone' } } });
  assert.deepEqual(fieldKeys(P.formSections(missing)), fieldKeys(P.formSections(base)));
  assert.deepEqual(fieldKeys(P.detailSections(missing)), fieldKeys(P.detailSections(base)));
});

test('layouts: role-hidden fields are removed from the form and the detail, also with a role layout', () => {
  const sales = asSales(withLayouts(), { fields: { product: { model: 'hidden', unit: 'read' } }, layouts: { product: { form: 'lf', detail: 'ld' } } });
  assert.ok(!fieldKeys(P.formSections(sales)).includes('model'));
  assert.ok(fieldKeys(P.formSections(sales)).includes('unit'), '只读的字段还在表单里');
  assert.ok(!fieldKeys(P.detailSections(sales)).includes('model'));
});

test('deleteLayout is refused while a role uses it; the 布局 tab lists the roles', () => {
  const sales = asSales(withLayouts(), { layouts: { product: { form: 'lf', detail: 'ld' } } });
  assert.throws(() => P.deleteLayout(sales, 'lf'), /角色“业务”正在用这个布局/);
  assert.throws(() => P.deleteLayout(sales, 'ld'), /角色“业务”正在用这个布局/);
  assert.deepEqual(P.rolesUsing(sales, 'lf'), [{ roleId: 'sales', roleName: '业务', places: ['新建/编辑产品'] }]);
  const html = ProductUI.create(E, P).pageMarkup(sales, { tab: 'layouts', editing: null, armed: '', layoutEdit: '' });
  assert.match(html, /data-prod-layout-roles="lf">角色：业务（新建\/编辑产品）/);
  assert.match(html, /data-prod-layout-roles="ld">角色：业务（产品详情）/);
  // 角色换了别的布局就能删
  const freed = R.updateRole(R.switchTo(sales, R.settings(sales).members.find((m) => m.roleId === 'admin').id), 'sales', { layouts: {} });
  assert.equal(P.settings(P.deleteLayout(freed, 'lf')).layouts.some((l) => l.id === 'lf'), false);
  // 默认分配也在用时先说默认分配
  assert.throws(() => P.deleteLayout(P.setLayoutUse(sales, 'form', 'lf'), 'lf'), /正在用于新建\/编辑产品/);
});

test('the required-fields check also covers a layout that a role uses for the form', () => {
  // 业务用 lf 做新建/编辑；lf 里隐藏了 link（可选）。先让 link 必填会被挡住，因为 lf 把它藏了。
  const sales = asSales(withLayouts(), { layouts: { product: { form: 'lf', detail: '' } } });
  const admin = R.switchTo(sales, R.settings(sales).members.find((m) => m.roleId === 'admin').id);
  assert.throws(() => P.setField(admin, 'link', { required: true }), /被新建\/编辑用的布局隐藏了/);
  // 不是被角色用在新建/编辑上的布局，不拦
  assert.doesNotThrow(() => P.setField(admin, 'fob', { required: true }));
  // 必填字段已经设好：给角色选一个藏起它的新建/编辑布局会被 checkRoleLayout 拦下
  const required = P.setField(withLayouts(), 'remark', { required: true });
  assert.throws(() => P.checkRoleLayout(required, 'form', 'lf'), /“产品备注”是必填字段/);
  assert.doesNotThrow(() => P.checkRoleLayout(required, 'detail', 'lf'));
  assert.doesNotThrow(() => P.checkRoleLayout(required, 'form', ''));
  assert.throws(() => P.checkRoleLayout(required, 'form', 'nope'), /没有找到这个布局/);
  // 改布局时：角色在用它做新建/编辑，不能把必填字段藏起来
  const reqOk = P.setField(P.addLayout(seed(), { name: '表单', id: 'lx' }), 'remark', { required: true });
  const used = R.updateRole(reqOk, 'sales', { layouts: { product: { form: 'lx', detail: '' } } });
  assert.throws(() => P.hideLayoutField(used, 'lx', 'remark'), /是必填字段/);
});

// ---------- 页面标记 ----------
test('product UI: hidden columns, read-only inputs, hidden specs, detail layout', () => {
  const sales = asSales(seed(), { fields: { product: { model: 'hidden', fob: 'hidden', unit: 'read', remark: 'read', nameCn: 'hidden', specs: 'hidden' } }, perms: salesPerms({ 'product.codeEdit': true }) });
  const can = (key) => R.can(sales, key);
  const ui = ProductUI.create(E, P, can);
  const list = ui.pageMarkup(sales, { tab: 'list', search: '', group: '' });
  assert.doesNotMatch(list, /产品型号|离岸价/);
  assert.doesNotMatch(list, />云朵</, '中文名称是隐藏字段');
  assert.match(list, /产品编号/);
  assert.match(list, /placeholder="搜索名称、编号、备注"/, '备注只是只读，还能搜');
  const noRemark = asSales(seed(), { fields: { product: { model: 'hidden', remark: 'hidden' } } });
  assert.match(ui.pageMarkup(noRemark, { tab: 'list', search: '', group: '' }), /placeholder="搜索名称、编号"/);
  const form = ui.formMarkup(sales, P.find(sales, 'p1'), false);
  assert.doesNotMatch(form, /name="model"|name="fob"|name="nameCn"|name="spec:/);
  assert.match(form, /name="unit"[^>]*disabled/);
  assert.match(form, /<textarea name="remark"[^>]*disabled/);
  assert.doesNotMatch(form, /name="code"[^>]*disabled/, '有 codeEdit，编辑时编号能改');
  assert.match(form, /name="name"/);
  // 新建：没有 codeNew，编号只读
  assert.match(ui.formMarkup(sales, P.emptyValues(sales), true), /name="code"[^>]*disabled/);
  const detail = ui.detailMarkup(sales, P.find(sales, 'p1'));
  assert.doesNotMatch(detail, /M-1|2\.5|黑色|云朵<\/dd>/);
  assert.match(detail, /C-1/);
  assert.match(detail, /对/);
  // 管理员：什么都在
  const adminUi = ProductUI.create(E, P, () => true);
  const adminForm = adminUi.formMarkup(seed(), P.find(seed(), 'p1'), false);
  assert.doesNotMatch(adminForm, /disabled/);
  assert.match(adminUi.pageMarkup(seed(), { tab: 'list', search: '', group: '' }), /产品型号.*离岸价/s);
});

// ---------- 团队数据 ----------
test('team data: 设置目标值 / 新建目标 need 编辑目标值; 导出 needs 导出成员排行; 目标管理 keeps 目标管理', () => {
  const overview = TM.overview({}, '2026-10');
  const ui = (granted) => TeamUI.create(E, (key) => granted.includes(key));
  const goalsOnly = ui(['team.goalEdit']).goalsMarkup(overview, {});
  assert.match(goalsOnly, /data-team-target="amount">设置目标值/);
  assert.match(goalsOnly, /data-team-target="new"/);
  assert.doesNotMatch(goalsOnly, /data-team-export/);
  const targetsOnly = ui(['team.targets', 'team.export']).goalsMarkup(overview, {});
  assert.doesNotMatch(targetsOnly, /data-team-target=/, '只有目标管理时，目标完成情况里不能设置目标值');
  assert.match(targetsOnly, /data-team-export="board"/);
  // 目标管理页：删除按钮仍然看“目标管理”
  const target = { key: 'k', period: '2026-10', owner: null, metric: 'amount', value: 5, currency: 'USD' };
  assert.match(ui(['team.targets']).targetsMarkup([target], TM.periodLabel, ''), /data-team-target-remove/);
  assert.doesNotMatch(ui(['team.goalEdit']).targetsMarkup([target], TM.periodLabel, ''), /data-team-target-remove/);
});

test('role upgrade keeps old roles working with the new keys', () => {
  const old = { laiSettings: { roles: { roles: [{ id: 'sales', name: '业务', scope: 'self', perms: { 'team.targets': true, 'team.view': true, 'product.create': true, 'product.edit': true } }], members: [{ id: 'm1', name: 'A', roleId: 'admin' }, { id: 'm2', name: 'B', roleId: 'sales' }], current: 'm2' } } };
  const lock = P.lockedKeys(old, true);
  assert.equal(lock.has('code'), false, '以前能编辑产品就能改编号');
  assert.equal(P.lockedKeys(old, false).has('code'), false);
});
