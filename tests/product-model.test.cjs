'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/product-model.js');

const base = () => ({ customers: {}, orders: [] });
const make = (s, name, extra = {}) => P.upsert(s, undefined, { name, ...extra }, '2026-10-10T00:00:00.000Z');

test('defaults: all fields visible, only 产品名称 required, no groups or specs', () => {
  const s = P.settings(base());
  assert.deepEqual(s.groups, []);
  assert.deepEqual(s.specs, []);
  assert.equal(P.FIELDS.every(([key]) => s.fields[key].visible), true);
  assert.deepEqual(P.FIELDS.filter(([key]) => s.fields[key].required).map(([key]) => key), ['name']);
});

test('field settings: 产品名称 is fixed; hiding a field also clears required; required fields are enforced', () => {
  const s = base();
  assert.throws(() => P.setField(s, 'name', { required: false }), /不能改/);
  assert.throws(() => P.setField(s, 'nope', {}), /没有这个字段/);
  let t = P.setField(s, 'model', { required: true });
  assert.throws(() => make(t, '睫毛 A'), /请填写产品型号/);
  assert.equal(make(t, '睫毛 A', { model: 'M1' }).laiProducts[0].model, 'M1');
  t = P.setField(t, 'model', { visible: false });
  assert.equal(P.settings(t).fields.model.required, false);
  assert.equal(make(t, '睫毛 B', { model: 'ignored' }).laiProducts[0].model, '', 'hidden fields are not saved');
});

test('numbers and lengths are checked; codes are unique; names are required', () => {
  let s = make(base(), 'A', { code: 'X-1', fob: '1.25' });
  assert.throws(() => make(s, 'B', { fob: '-3' }), /离岸价要填数字/);
  assert.throws(() => make(s, 'B', { code: 'x-1' }), /产品编号已经有了/);
  assert.throws(() => make(s, '  '), /请填写产品名称/);
  assert.throws(() => make(s, 'B', { link: 'x'.repeat(501) }), /最长/);
});

test('groups: two levels, rename follows products, delete refused while in use, move', () => {
  let s = P.addGroup(base(), { name: '睫毛' });
  const top = P.settings(s).groups[0];
  s = P.addGroup(s, { name: '单根', parentId: top.id });
  assert.throws(() => P.addGroup(s, { name: '睫毛' }), /同名/);
  assert.throws(() => P.addGroup(s, { name: 'a/b' }), /“\/”/);
  assert.deepEqual(P.groupChoices(s), ['睫毛', '睫毛 / 单根']);
  assert.throws(() => make(s, 'A', { group: '不存在' }), /不在分组名单里/);
  s = make(s, 'A', { group: '睫毛 / 单根' });
  const child = P.settings(s).groups[0].children[0];
  assert.throws(() => P.deleteGroup(s, child.id), /1 个产品/);
  s = P.renameGroup(s, top.id, '假睫毛');
  assert.equal(s.laiProducts[0].group, '假睫毛 / 单根');
  s = P.addGroup(s, { name: '工具' });
  s = P.moveGroup(s, P.settings(s).groups[1].id, -1);
  assert.deepEqual(P.settings(s).groups.map((g) => g.name), ['工具', '假睫毛']);
  s = P.remove(s, s.laiProducts[0].id);
  assert.doesNotThrow(() => P.deleteGroup(s, P.settings(s).groups[1].children[0].id));
});

test('specs: types and values; products can only use known ones; renames follow; delete guarded', () => {
  let s = P.addSpec(base(), '颜色');
  const spec = P.settings(s).specs[0];
  s = P.addSpecValue(s, spec.id, '黑');
  assert.throws(() => P.addSpecValue(s, spec.id, '黑'), /已经有了/);
  assert.throws(() => make(s, 'A', { specs: [{ type: '颜色', value: '红' }] }), /没有规格值/);
  assert.throws(() => make(s, 'A', { specs: [{ type: '尺码', value: 'M' }] }), /不在规格管理里/);
  assert.throws(() => make(s, 'A', { specs: [{ type: '颜色', value: '' }] }), /同时选好/);
  s = make(s, 'A', { specs: [{ type: '颜色', value: '黑' }, { type: '颜色', value: '黑' }] });
  assert.equal(s.laiProducts[0].specs.length, 1);
  assert.throws(() => P.removeSpecValue(s, spec.id, '黑'), /1 个产品/);
  assert.throws(() => P.deleteSpec(s, spec.id), /1 个产品/);
  s = P.renameSpec(s, spec.id, '色号');
  assert.deepEqual(s.laiProducts[0].specs, [{ type: '色号', value: '黑' }]);
});

test('list: search over name, code, model; group filter includes children; edits keep untouched data', () => {
  let s = P.addGroup(base(), { name: '睫毛' });
  s = P.addGroup(s, { name: '单根', parentId: P.settings(s).groups[0].id });
  s = make(s, '云朵睫毛', { code: 'C1', group: '睫毛 / 单根' });
  s = make(s, '胶水', { model: 'G-9' });
  assert.deepEqual(P.list(s, { search: 'g-9' }).map((p) => p.name), ['胶水']);
  assert.deepEqual(P.list(s, { group: '睫毛' }).map((p) => p.name), ['云朵睫毛']);
  const id = P.list(s, { search: '胶水' })[0].id;
  const edited = P.upsert(s, id, { name: '胶水 2' }, '2026-10-11T00:00:00.000Z');
  assert.equal(P.find(edited, id).model, '', 'a field left out is cleared only if visible: here it was posted empty');
  assert.equal(P.find(edited, id).createdAt, '2026-10-10T00:00:00.000Z');
});

test('a broken saved list is never overwritten', () => {
  const broken = { laiProducts: { oops: true } };
  assert.throws(() => make(broken, 'A'), /格式异常/);
  assert.throws(() => P.remove(broken, 'x'), /格式异常/);
});
