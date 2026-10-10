'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/product-model.js');
const UI = require('../src/product-ui.js');

const E = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ui = UI.create(E, M);

test('every tab renders, escapes names and has no placeholder buttons', () => {
  let s = M.addGroup({}, { name: '<b>组' });
  s = M.addSpec(s, '<i>色');
  s = M.addSpecValue(s, M.settings(s).specs[0].id, '黑');
  s = M.upsert(s, undefined, { name: '<script>x</script>', group: '<b>组' }, '2026-10-10T00:00:00Z');
  for (const [tab] of UI.TABS) {
    const html = ui.pageMarkup(s, { tab, search: '', group: '', editing: null, armed: '' });
    assert.ok(html.includes(`data-prod-panel="${tab}"`), tab);
    assert.ok(!html.includes('data-feature'), 'no placeholder buttons');
    assert.ok(!html.includes('<script>x') && !html.includes('<b>组') && !html.includes('<i>色'), `${tab}: names are escaped`);
  }
});

test('the form follows the field settings and offers groups and specs', () => {
  let s = M.addGroup({}, { name: '睫毛' });
  s = M.addSpec(s, '颜色');
  s = M.addSpecValue(s, M.settings(s).specs[0].id, '黑色');
  s = M.setField(s, 'model', { required: true });
  s = M.setField(s, 'remark', { visible: false });
  const html = ui.formMarkup(s, M.emptyValues(s), true);
  assert.ok(html.includes('name="model"') && html.includes('required'));
  assert.ok(!html.includes('name="remark"'));
  assert.ok(html.includes('<option value="睫毛">') && html.includes('name="spec:颜色"') && html.includes('黑色'));
});

test('the delete button asks twice and the empty list explains what to do', () => {
  let s = M.upsert({}, undefined, { name: 'A' }, '2026-10-10T00:00:00Z');
  const id = s.laiProducts[0].id;
  assert.ok(ui.pageMarkup(s, { tab: 'list', armed: id }).includes('确定删除'));
  assert.ok(!ui.pageMarkup(s, { tab: 'list', armed: '' }).includes('确定删除'));
  assert.ok(ui.pageMarkup({}, { tab: 'list' }).includes('还没有产品'));
});
