'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/product-model.js');
const UI = require('../src/product-ui.js');

const E = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ui = UI.create(E, P);
const T1 = '2026-10-10T00:00:00.000Z';
const T2 = '2026-10-11T00:00:00.000Z';
const T3 = '2026-10-12T00:00:00.000Z';

const make = (s, name, extra = {}) => P.upsert(s, undefined, { name, ...extra }, T1);
const rec = (values, line) => ({ line, values });
const keys = (state) => (state.laiProducts || []).map((p) => p.name).sort();

// ---------- 同步 ----------
test('sync by code: new rows are created, known codes are updated, only given columns change', () => {
  let s = make({}, '旧名字', { code: 'A-1', fob: '1.5', remark: '保留我' });
  const rows = [
    rec({ name: '新名字', code: 'a-1', fob: '2' }, 2),
    rec({ name: '胶水', code: 'G-9', model: 'M1' }, 3),
    rec({ name: '无编号品' }, 4),
  ];
  const plan = P.planSync(s, rows, { mode: 'code' });
  assert.deepEqual(plan.counts, { total: 3, new: 2, update: 1, skip: 0 });
  const { state, task } = P.syncProducts(s, rows, { mode: 'code', fileName: 'a.csv', at: T2 });
  assert.deepEqual(keys(state), ['新名字', '无编号品', '胶水']);
  const a1 = state.laiProducts.find((p) => p.code === 'A-1');
  assert.deepEqual([a1.name, a1.fob, a1.remark, a1.updatedAt], ['新名字', '2', '保留我', T2], 'untouched columns stay');
  assert.deepEqual([task.name, task.status, task.total, task.created, task.updated, task.skipped, task.source], ['a.csv', '已完成', 3, 2, 1, 0, '表格文件']);
  assert.equal(task.createdIds.length, 2);
  assert.deepEqual(Object.keys(task.before), [a1.id], 'only updated products are snapshotted');
  assert.equal(task.before[a1.id].name, '旧名字');
  assert.equal(state.laiProductSyncTasks[0].id, task.id);
});

test('sync: empty cells never clear an existing value, unchanged rows are skipped, a code twice in one file is skipped', () => {
  const s = make({}, '甲', { code: 'A-1', model: 'M1' });
  const plan = P.planSync(s, [rec({ name: '甲', code: 'A-1', model: '' }, 2), rec({ name: '乙', code: 'A-1', model: 'M2' }, 3)], { mode: 'code' });
  assert.deepEqual(plan.rows.map((r) => r.status), ['skip', 'update']);
  assert.equal(plan.rows[0].reason, '内容没变');
  const twice = P.planSync(s, [rec({ name: '乙', code: 'A-1' }, 2), rec({ name: '丙', code: 'a-1' }, 3), rec({ name: '丁', code: 'N-1' }, 4), rec({ name: '戊', code: 'n-1' }, 5)], { mode: 'code' });
  assert.deepEqual(twice.rows.map((r) => r.status), ['update', 'skip', 'new', 'skip']);
  assert.match(twice.rows[1].reason, /和第 2 行重复/);
  assert.deepEqual(twice.rows[0].changes, ['name'], 'the code itself is not rewritten');
});

test('sync mode 全部新建: known codes are not overwritten, they are skipped', () => {
  const s = make({}, '甲', { code: 'A-1' });
  const rows = [rec({ name: '丙', code: 'A-1' }, 2), rec({ name: '丁', code: 'D-1' }, 3), rec({ name: '戊' }, 4)];
  const plan = P.planSync(s, rows, { mode: 'new' });
  assert.deepEqual(plan.rows.map((r) => r.status), ['skip', 'new', 'new']);
  assert.match(plan.rows[0].reason, /编号已经有了/);
  const { state } = P.syncProducts(s, rows, { mode: 'new', at: T2 });
  assert.equal(state.laiProducts.length, 3);
  assert.equal(state.laiProducts.filter((p) => p.name === '甲').length, 1);
});

test('sync skip reasons: missing name, bad number, too long; good rows still go through', () => {
  const rows = [rec({ code: 'X' }, 2), rec({ name: 'B', fob: '-3' }, 3), rec({ name: 'C', fob: '1,200.5' }, 4), rec({ name: 'D', link: 'x'.repeat(501) }, 5), rec({ name: 'E' }, 6)];
  const plan = P.planSync({}, rows, {});
  assert.deepEqual(plan.rows.map((r) => r.status), ['skip', 'skip', 'new', 'skip', 'new']);
  assert.equal(plan.rows[0].reason, '缺产品名称');
  assert.match(plan.rows[1].reason, /离岸价的数字格式不对/);
  assert.equal(plan.rows[2].values.fob, '1200.5');
  assert.match(plan.rows[3].reason, /产品链接太长/);
  const { state, task } = P.syncProducts({}, rows, { at: T2 });
  assert.equal(state.laiProducts.length, 2);
  assert.deepEqual([task.created, task.skipped, task.total], [2, 3, 5]);
});

test('sync: a group that is not in the list is left empty with a warning, a known one is used', () => {
  let s = P.addGroup({}, { name: '睫毛' });
  s = P.addGroup(s, { name: '单根', parentId: P.settings(s).groups[0].id });
  const rows = [rec({ name: 'A', group: '睫毛/单根' }, 2), rec({ name: 'B', group: '假睫毛' }, 3)];
  const plan = P.planSync(s, rows, {});
  assert.equal(plan.rows[0].values.group, '睫毛 / 单根');
  assert.equal(plan.rows[1].status, 'new');
  assert.deepEqual(plan.rows[1].warnings, ['分组“假睫毛”不在名单里，已留空']);
  const { state } = P.syncProducts(s, rows, { at: T2 });
  assert.equal(state.laiProducts.find((p) => p.name === 'B').group, '');
  assert.equal(P.settings(state).groups.length, 1, 'no group is created');
  // updating: the old group stays
  let t = make(s, 'C', { code: 'C1', group: '睫毛' });
  const upd = P.planSync(t, [rec({ name: 'C2', code: 'C1', group: '不存在' }, 2)], {});
  assert.equal(upd.rows[0].status, 'update');
  assert.match(upd.rows[0].warnings[0], /没有改分组/);
});

test('sync: hidden fields are ignored and required fields must be filled', () => {
  let s = P.setField({}, 'remark', { visible: false });
  s = P.setField(s, 'model', { required: true });
  const table = P.readTable(s, ['产品名称', '产品型号', '产品备注', '没用的列', 'name'], [['A', 'M1', '藏', 'x', 'dup'], ['B', '', '', '', '']]);
  assert.deepEqual(table.columns, ['name', 'model']);
  assert.deepEqual(table.hidden, ['产品备注']);
  assert.deepEqual(table.ignored, ['没用的列', 'name'], 'a second column for the same field is ignored');
  const plan = P.planSync(s, table.records, {});
  assert.deepEqual(plan.rows.map((r) => r.status), ['new', 'skip']);
  assert.equal(plan.rows[1].reason, '缺少“产品型号”');
  const { state } = P.syncProducts(s, table.records, { at: T2 });
  assert.equal(state.laiProducts[0].remark, '');
  // hidden values given directly are dropped too
  assert.equal(P.planSync(s, [rec({ name: 'Z', model: 'M', remark: 'x' }, 2)], {}).rows[0].values.remark, undefined);
});

test('readTable: headers match by label, label without unit, or key; template headers are the visible labels', () => {
  const s = P.setField({}, 'fob', { visible: false });
  const headers = P.templateHeaders(s);
  assert.ok(headers.includes('产品名称') && headers.includes('产品尺寸(长*宽*高cm)') && !headers.includes('离岸价'));
  const table = P.readTable({}, ['产品尺寸', 'CODE', ' 产品名称 '], [['1*2*3', 'c1', 'N']]);
  assert.deepEqual(table.records[0].values, { size: '1*2*3', code: 'c1', name: 'N' });
  assert.throws(() => P.readTable({}, ['乱七八糟'], [['x']]), /认得的产品字段/);
  assert.throws(() => P.readTable({}, ['产品名称'], [['', ]]), /没有产品数据/);
});

test('sync limits: 2000 rows at most, nothing to sync is an error, the product cap is respected', () => {
  const many = Array.from({ length: 2001 }, (_, i) => rec({ name: `P${i}` }, i + 2));
  assert.throws(() => P.planSync({}, many, {}), /最多导入 2000 行/);
  assert.throws(() => P.readTable({}, ['产品名称'], many.map((r) => [r.values.name])), /最多导入 2000 行/);
  assert.equal(P.planSync({}, many.slice(0, 2000), {}).counts.new, 2000);
  assert.throws(() => P.syncProducts({}, [rec({ code: 'x' }, 2)], {}), /没有能导入的产品/);
  const full = { laiProducts: Array.from({ length: P.LIMITS.products }, (_, i) => ({ id: `x${i}`, name: `n${i}`, code: `c${i}` })) };
  const plan = P.planSync(full, [rec({ name: 'new' }, 2), rec({ name: 'n1x', code: 'c1' }, 3)], {});
  assert.deepEqual(plan.rows.map((r) => r.status), ['skip', 'update']);
});

test('sync tasks: newest first, kept to the last 50; broken saved data is never overwritten', () => {
  let s = {};
  for (let i = 0; i < 52; i++) s = P.syncProducts(s, [rec({ name: `P${i}` }, 2)], { fileName: `f${i}`, at: new Date(Date.UTC(2026, 9, 1, 0, 0, i)).toISOString() }).state;
  assert.equal(s.laiProductSyncTasks.length, 50);
  assert.equal(s.laiProductSyncTasks[0].name, 'f51');
  assert.throws(() => P.syncProducts({ laiProductSyncTasks: { oops: 1 } }, [rec({ name: 'A' }, 2)], {}), /格式异常/);
  assert.throws(() => P.syncProducts({ laiProducts: 'x' }, [rec({ name: 'A' }, 2)], {}), /格式异常/);
});

test('undo: created removed, updated restored, newest task only, second undo refused', () => {
  const base = make({}, '旧名字', { code: 'A-1', fob: '1' });
  const one = P.syncProducts(base, [rec({ name: '新名字', code: 'A-1', fob: '9' }, 2), rec({ name: '胶水', code: 'G-1' }, 3)], { fileName: 'one', at: T2 });
  const two = P.syncProducts(one.state, [rec({ name: '又一个', code: 'N-1' }, 2)], { fileName: 'two', at: T3 });
  assert.throws(() => P.undoSync(two.state, one.task.id, T3), /只能撤销最近一次/);
  assert.equal(P.undoableTask(two.state).id, two.task.id);
  const back2 = P.undoSync(two.state, two.task.id, T3);
  assert.deepEqual(back2.result, { removed: 1, restored: 0, kept: 0 });
  assert.deepEqual(keys(back2.state), ['新名字', '胶水']);
  const back1 = P.undoSync(back2.state, one.task.id, T3);
  assert.deepEqual(back1.result, { removed: 1, restored: 1, kept: 0 });
  assert.deepEqual(back1.state.laiProducts, base.laiProducts, 'back to the exact product before');
  const log = back1.state.laiProductSyncTasks;
  assert.deepEqual(log.map((t) => t.status), ['已撤销', '已撤销']);
  assert.deepEqual([log[0].createdIds, log[0].before], [[], {}], 'snapshots are dropped after an undo');
  assert.equal(P.undoableTask(back1.state), null);
  assert.throws(() => P.undoSync(back1.state, one.task.id, T3), /撤销过了/);
  assert.throws(() => P.undoSync(back1.state, 'nope', T3), /没有找到/);
});

test('undo keeps products that were changed after the sync and says how many', () => {
  const base = make({}, '旧名字', { code: 'A-1' });
  const done = P.syncProducts(base, [rec({ name: '新名字', code: 'A-1' }, 2), rec({ name: '胶水', code: 'G-1' }, 3), rec({ name: '剪刀', code: 'S-1' }, 4)], { at: T2 });
  let s = done.state;
  const glue = s.laiProducts.find((p) => p.code === 'G-1');
  const a1 = s.laiProducts.find((p) => p.code === 'A-1');
  s = P.upsert(s, glue.id, { name: '胶水改过', code: 'G-1' }, T3);
  s = P.upsert(s, a1.id, { name: '又改了', code: 'A-1' }, T3);
  s = P.remove(s, s.laiProducts.find((p) => p.code === 'S-1').id);
  const back = P.undoSync(s, done.task.id, T3);
  assert.deepEqual(back.result, { removed: 0, restored: 0, kept: 2 });
  assert.deepEqual(keys(back.state), ['又改了', '胶水改过']);
  assert.equal(back.task.status, '已撤销');
});

// ---------- 布局 ----------
test('layouts: the default layout is built in, cannot be changed or deleted; copies are editable', () => {
  const l = P.layoutList({});
  assert.deepEqual(l.map((x) => x.name), ['默认布局']);
  assert.deepEqual(l[0].sections.map((x) => x.name), [...P.SECTIONS]);
  assert.deepEqual(P.settings({}).layoutUse, { form: 'default', detail: 'default' });
  assert.throws(() => P.deleteLayout({}, 'default'), /默认布局不能删除/);
  assert.throws(() => P.renameLayout({}, 'default', 'x'), /默认布局不能改名/);
  assert.throws(() => P.moveSection({}, 'default', 1, -1), /默认布局不能改/);
  assert.throws(() => P.addLayout({}, { name: '默认布局' }), /已有同名布局/);
  let s = P.addLayout({}, { name: '我的布局', id: 'L1' });
  assert.deepEqual(P.layoutById(s, 'L1').sections, P.layoutById(s, 'default').sections.map((x) => ({ name: x.name, fields: x.fields })));
  assert.equal(P.suggestLayoutName(s, '我的布局'), '我的布局 副本');
  assert.throws(() => P.addLayout(s, { name: ' 我的布局 ' }), /已有同名布局/);
  assert.throws(() => P.addLayout(s, { name: '' }), /请填写布局名称/);
  s = P.renameLayout(s, 'L1', '新名字');
  assert.equal(P.layoutById(s, 'L1').name, '新名字');
  s = P.deleteLayout(s, 'L1');
  assert.equal(P.layoutList(s).length, 1);
});

test('layouts: at most 20 of your own', () => {
  let s = {};
  for (let i = 0; i < 20; i++) s = P.addLayout(s, { name: `布局${i}` });
  assert.throws(() => P.addLayout(s, { name: '多一个' }), /最多 20 个/);
});

test('layouts: a layout in use cannot be deleted; assigning needs the layout to exist', () => {
  let s = P.addLayout({}, { name: 'A', id: 'A' });
  s = P.setLayoutUse(s, 'detail', 'A');
  assert.throws(() => P.deleteLayout(s, 'A'), /产品详情，先把用到它的地方换成别的布局/);
  assert.throws(() => P.setLayoutUse(s, 'detail', 'nope'), /没有找到这个布局/);
  assert.throws(() => P.setLayoutUse(s, 'elsewhere', 'A'), /没有这个位置/);
  s = P.setLayoutUse(s, 'detail', 'default');
  assert.equal(P.deleteLayout(s, 'A').laiSettings.productSettings.layouts.length, 0);
});

test('layout editing: reorder sections, rename a section, move a field up/down and to another section', () => {
  let s = P.addLayout({}, { name: 'A', id: 'A' });
  s = P.moveSection(s, 'A', 1, -1);
  assert.deepEqual(P.layoutById(s, 'A').sections.map((x) => x.name).slice(0, 2), ['价格信息', '基本信息']);
  assert.deepEqual(P.layoutById(P.moveSection(s, 'A', 0, -1), 'A').sections.map((x) => x.name), P.layoutById(s, 'A').sections.map((x) => x.name));
  s = P.renameSection(s, 'A', 0, '报价');
  assert.equal(P.layoutById(s, 'A').sections[0].name, '报价');
  assert.throws(() => P.renameSection(s, 'A', 0, '基本信息'), /同名信息区/);
  assert.throws(() => P.renameSection(s, 'A', 0, ' '), /请填写信息区名称/);
  s = P.moveLayoutField(s, 'A', 'name', 1);
  assert.deepEqual(P.layoutById(s, 'A').sections[1].fields.slice(0, 3), ['code', 'nameCn', 'name']);
  s = P.moveLayoutField(s, 'A', 'name', -1);
  assert.deepEqual(P.layoutById(s, 'A').sections[1].fields.slice(0, 3), ['code', 'name', 'nameCn']);
  s = P.moveFieldToSection(s, 'A', 'fob', 1);
  assert.equal(P.layoutById(s, 'A').sections[0].fields.length, 0);
  assert.equal(P.layoutById(s, 'A').sections[1].fields.at(-1), 'fob');
  assert.throws(() => P.moveFieldToSection(s, 'A', 'fob', 9), /没有找到这个信息区/);
  assert.deepEqual(P.layoutById(s, 'default').sections[1].fields, ['fob'], 'the default is untouched');
});

test('layout editing: hide and show a field; 产品名称 cannot be hidden', () => {
  let s = P.addLayout({}, { name: 'A', id: 'A' });
  assert.throws(() => P.hideLayoutField(s, 'A', 'name'), /产品名称”一定显示/);
  s = P.hideLayoutField(s, 'A', 'remark');
  assert.ok(!P.layoutById(s, 'A').sections.some((x) => x.fields.includes('remark')));
  s = P.showLayoutField(s, 'A', 'remark', 2);
  assert.equal(P.layoutById(s, 'A').sections[2].fields.at(-1), 'remark');
  s = P.showLayoutField(s, 'A', 'remark', 0);
  assert.equal(P.layoutById(s, 'A').sections[0].fields.includes('remark'), false, 'not shown twice');
});

test('layouts: a required field cannot be hidden in the layout used by the form (editing and assigning)', () => {
  let s = P.setField({}, 'model', { required: true });
  s = P.addLayout(s, { name: 'A', id: 'A' });
  s = P.hideLayoutField(s, 'A', 'model'); // not used by the form yet: allowed
  assert.throws(() => P.setLayoutUse(s, 'form', 'A'), /“产品型号”是必填字段，新建\/编辑用的布局里不能隐藏/);
  s = P.setLayoutUse(s, 'detail', 'A'); // the detail page may hide it
  s = P.showLayoutField(s, 'A', 'model', 0);
  s = P.setLayoutUse(s, 'form', 'A');
  assert.throws(() => P.hideLayoutField(s, 'A', 'model'), /是必填字段，新建\/编辑用的布局里不能隐藏/);
  // optional fields may be hidden even for the form
  assert.ok(P.hideLayoutField(s, 'A', 'remark'));
});

test('making a field required is refused while the form layout hides it', () => {
  let s = P.addLayout({}, { name: 'A', id: 'A' });
  s = P.hideLayoutField(s, 'A', 'model');
  s = P.setLayoutUse(s, 'form', 'A');
  assert.throws(() => P.setField(s, 'model', { required: true }), /被新建\/编辑用的布局隐藏了/);
  assert.ok(P.setField(s, 'remark', { required: true }));
});

test('formSections/detailSections follow the assigned layout, skip globally hidden fields and empty sections', () => {
  let s = P.addLayout({}, { name: 'A', id: 'A' });
  s = P.moveSection(s, 'A', 1, -1); // 价格信息 first
  s = P.moveFieldToSection(s, 'A', 'size', 0);
  s = P.hideLayoutField(s, 'A', 'link');
  s = P.setField(s, 'unit', { visible: false });
  s = P.setLayoutUse(s, 'form', 'A');
  const form = P.formSections(s);
  assert.deepEqual(form[0].fields.map((f) => f[0]).slice(0, 2), ['fob', 'size']);
  assert.equal(form[0].name, '价格信息');
  const formKeys = form.flatMap((x) => x.fields.map((f) => f[0]));
  assert.ok(!formKeys.includes('link') && !formKeys.includes('unit'));
  // detail still uses the default layout
  const detail = P.detailSections(s);
  assert.deepEqual(detail.map((x) => x.name), [...P.SECTIONS]);
  assert.ok(detail[0].fields.map((f) => f[0]).includes('link'));
  assert.ok(!detail[0].fields.map((f) => f[0]).includes('unit'));
  // hiding every field of a section removes the section
  let t = P.setField({}, 'fob', { visible: false });
  assert.ok(!P.formSections(t).some((x) => x.name === '价格信息'));
});

test('saved layouts are cleaned when read: bad keys, duplicates, missing 产品名称, unknown assignment', () => {
  const state = { laiSettings: { productSettings: {
    layouts: [
      { id: 'a', name: 'X', sections: [{ name: 'S1', fields: ['code', 'bogus', 'code'] }, { name: 'S1', fields: ['fob'] }, { name: 'S2', fields: ['fob'] }] },
      { id: 'b', name: 'x', sections: [{ name: 'S', fields: [] }] },
      { id: 'c', name: '空', sections: [] },
    ],
    layoutUse: { form: 'a', detail: 'gone' },
  } } };
  const s = P.settings(state);
  assert.equal(s.layouts.length, 1);
  assert.deepEqual(s.layouts[0].sections, [{ name: 'S1', fields: ['name', 'code'] }, { name: 'S2', fields: ['fob'] }]);
  assert.deepEqual(s.layoutUse, { form: 'a', detail: 'default' });
});

test('layout settings survive other settings changes', () => {
  let s = P.addLayout({}, { name: 'A', id: 'A' });
  s = P.setLayoutUse(s, 'detail', 'A');
  s = P.addGroup(s, { name: '组' });
  s = P.setField(s, 'remark', { visible: false });
  assert.equal(P.settings(s).layouts.length, 1);
  assert.equal(P.settings(s).layoutUse.detail, 'A');
});

// ---------- 页面文字 ----------
test('tabs: 产品列表 | 产品分组 | 导入产品 | 产品字段 | 规格管理 | 布局, all render without placeholders', () => {
  assert.deepEqual(UI.TABS.map((t) => t[1]), ['产品列表', '产品分组', '导入产品', '产品字段', '规格管理', '布局']);
  let s = make({}, '<b>x</b>', { code: 'A' });
  s = P.syncProducts(s, [rec({ name: '<i>y</i>', code: 'B' }, 2)], { fileName: '<f>.csv', at: T2 }).state;
  s = P.addLayout(s, { name: '<u>布局</u>', id: 'L' });
  for (const [tab] of UI.TABS) {
    const html = ui.pageMarkup(s, { tab, search: '', group: '', editing: null, armed: '', layoutEdit: 'L' });
    assert.ok(html.includes(`data-prod-panel="${tab}"`), tab);
    assert.ok(!html.includes('data-feature') && !html.includes('功能入口已保留'));
    assert.ok(!html.includes('<f>') && !html.includes('<u>布局') && !html.includes('<i>y') && !html.includes('<b>x'), `${tab}: escaped`);
  }
});

test('sync tab: empty hint, task table, undo only on the newest task and it asks twice', () => {
  assert.ok(ui.pageMarkup({}, { tab: 'sync' }).includes('还没有导入过'));
  assert.ok(ui.pageMarkup({}, { tab: 'sync' }).includes('data-prod-action="sync-open"'));
  let s = P.syncProducts({}, [rec({ name: 'A' }, 2)], { fileName: 'one.csv', at: T2 }).state;
  s = P.syncProducts(s, [rec({ name: 'B' }, 2)], { fileName: 'two.csv', at: T3 }).state;
  const html = ui.pageMarkup(s, { tab: 'sync', armed: '' });
  for (const head of ['任务名称', '导入时间', '状态', '产品数', '新建数', '更新数', '跳过数', '来源', '操作']) assert.ok(html.includes(`<th>${head}</th>`), head);
  assert.equal((html.match(/data-prod-action="sync-undo"/g) || []).length, 1, 'only the newest');
  const id = s.laiProductSyncTasks[0].id;
  assert.ok(html.includes(`data-id="${id}"`));
  assert.ok(ui.pageMarkup(s, { tab: 'sync', armed: `undo:${id}` }).includes('确定撤销'));
  const undone = P.undoSync(s, id, T3).state;
  const after = ui.pageMarkup(undone, { tab: 'sync', armed: '' });
  assert.ok(after.includes('已撤销') && after.includes('删除新建 1 个'));
  assert.equal((after.match(/data-prod-action="sync-undo"/g) || []).length, 1, 'now the earlier one can be undone');
});

test('sync dialog: preview counts, skip reasons, ignored columns; confirm is off until something can be synced', () => {
  const s = make({}, '甲', { code: 'A-1' });
  const table = P.readTable(s, ['产品名称', '产品编号', '备注列'], [['甲2', 'A-1', ''], ['乙', 'B-1', ''], ['丙', 'C-1', ''], ['', '', 'x']]);
  const draft = { fileName: 't.csv', mode: 'code', records: table.records, ignored: table.ignored, hidden: [], error: '' };
  draft.plan = P.planSync(s, draft.records, { mode: 'code' });
  const html = ui.syncMarkup(s, draft);
  assert.ok(html.includes('新建 2') && html.includes('更新 1') && html.includes('跳过 0'));
  assert.ok(html.includes('备注列') && html.includes('type="file"') && html.includes('下载模板'));
  assert.ok(html.includes('按产品编号匹配：有就更新，没有就新建') && html.includes('全部新建'));
  assert.ok(ui.syncFooter(draft).includes('确认导入（新建 2、更新 1）'));
  assert.ok(!ui.syncFooter({ plan: null }).includes('确认导入（') && ui.syncFooter({ plan: null }).includes('disabled'));
  const bad = { fileName: '', mode: 'code', records: null, plan: null, ignored: [], hidden: [], error: '文件不能超过 5 MB' };
  assert.ok(ui.syncMarkup(s, bad).includes('文件不能超过 5 MB'));
});

test('layouts tab: assignment selects, default is view-only, a custom layout shows move/hide controls', () => {
  let s = P.addLayout({}, { name: '我的', id: 'L' });
  const base = { tab: 'layouts', search: '', group: '', editing: null, armed: '' };
  const list = ui.pageMarkup(s, { ...base, layoutEdit: '' });
  assert.ok(list.includes('data-prod-sel="use" data-place="form"') && list.includes('data-prod-sel="use" data-place="detail"'));
  assert.ok(list.includes('新建/编辑产品') && list.includes('产品详情'));
  assert.ok(list.includes('复制为新布局'));
  assert.ok(!list.includes('data-prod-lay="delete" data-layout="default"'));
  const viewDefault = ui.pageMarkup(s, { ...base, layoutEdit: 'default' });
  assert.ok(viewDefault.includes('默认布局不能改') && !viewDefault.includes('data-prod-lay="field-hide"'));
  const edit = ui.pageMarkup(s, { ...base, layoutEdit: 'L' });
  assert.ok(edit.includes('data-prod-lay="section-move"') && edit.includes('data-prod-lay="field-move"') && edit.includes('data-prod-sel="move"'));
  assert.ok(edit.includes('data-prod-lay="field-hide" data-layout="L" data-key="code"'));
  assert.ok(!edit.includes('data-key="name">隐藏'), '产品名称 has no hide button');
  s = P.hideLayoutField(s, 'L', 'remark');
  assert.ok(ui.pageMarkup(s, { ...base, layoutEdit: 'L' }).includes('data-prod-sel="show"'));
  const renaming = ui.pageMarkup(s, { ...base, layoutEdit: 'L', editing: { kind: 'section', key: 'L:0' } });
  assert.ok(renaming.includes('data-prod-form="section-rename"'));
});

test('the product form follows the form layout; the detail follows the detail layout and skips empty fields', () => {
  let s = make({}, '睫毛', { code: 'C1', fob: '3.5', remark: '备注内容' });
  s = P.addLayout(s, { name: '价格在前', id: 'L' });
  s = P.moveSection(s, 'L', 1, -1);
  s = P.setLayoutUse(s, 'form', 'L');
  s = P.setLayoutUse(s, 'detail', 'L');
  const p = s.laiProducts[0];
  const form = ui.formMarkup(s, p, false);
  assert.ok(form.indexOf('name="fob"') < form.indexOf('name="code"'), 'price section first');
  const detail = ui.detailMarkup(s, p);
  assert.ok(detail.indexOf('离岸价') < detail.indexOf('产品编号'));
  assert.ok(detail.includes('3.5') && detail.includes('备注内容'));
  assert.ok(!detail.includes('产品型号'), 'empty fields are skipped');
  assert.ok(!detail.includes('尺寸信息'), 'sections with nothing to show are skipped');
  const noName = ui.detailMarkup(s, { id: 'x', name: '', specs: [] });
  assert.ok(noName.includes('产品名称'), '产品名称 always shows');
  const withSpecs = P.addSpec(s, '颜色');
  const sp = P.addSpecValue(withSpecs, P.settings(withSpecs).specs[0].id, '黑');
  assert.ok(ui.detailMarkup(sp, { ...p, specs: [{ type: '颜色', value: '黑' }] }).includes('颜色'));
  assert.ok(ui.detailMarkup(s, { ...p, name: '<b>' }).includes('&lt;b&gt;'));
});
