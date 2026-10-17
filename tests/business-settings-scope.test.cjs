const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../src/doc-template-model.js');

const read = (name) => fs.readFileSync(path.join(__dirname, '..', 'src', name), 'utf8');

test('document scope: owner comes from the source order or opportunity, then the customer; listDocuments honours laiVisibleDocIds', () => {
  const doc = (id, source, client) => ({ id, type: 'quote', number: id, client, currency: 'USD', total: 1, date: '2026-01-01', source, status: '有效' });
  const state = {
    orders: [{ id: 'o1', owner: 'Amy' }, { id: 'o2', owner: 'Ben' }],
    trashOrders: [{ id: 'o3', owner: 'Amy' }],
    laiOpportunities: [{ id: 'p1', owner: 'Ben' }, { id: 'p2', owner: 'Amy' }],
    customers: { Gone: { owner: 'Amy' }, Other: { owner: 'Ben' } },
    laiDocuments: [
      doc('d1', { kind: 'order', id: 'o1' }, 'X'),
      doc('d2', { kind: 'order', id: 'o2' }, 'X'),
      doc('d3', { kind: 'opportunity', id: 'p1' }, 'X'),
      doc('d4', { kind: 'opportunity', id: 'p2' }, 'X'),
      doc('d5', { kind: 'order', id: 'o3' }, 'X'),
      doc('d6', { kind: 'order', id: 'deleted' }, 'Gone'),
      doc('d7', { kind: 'order', id: 'deleted' }, 'Other'),
      doc('d8', { kind: '', id: '' }, 'Nobody'),
    ],
  };
  assert.equal(M.ownerOfDocument(state, state.laiDocuments[0]), 'Amy');
  assert.equal(M.ownerOfDocument(state, state.laiDocuments[5]), 'Amy', 'falls back to the customer owner');
  assert.equal(M.ownerOfDocument(state, state.laiDocuments[7]), '');
  const sees = (owner) => owner.toLowerCase() === 'amy';
  const ids = M.visibleDocumentIds(state, sees);
  assert.deepEqual([...ids].sort(), ['d1', 'd4', 'd5', 'd6']);
  assert.equal(M.listDocuments(state, {}).length, 8, 'without a scope list everything is listed');
  assert.deepEqual(M.listDocuments({ ...state, laiVisibleDocIds: ids }, {}).map((d) => d.id).sort(), ['d1', 'd4', 'd5', 'd6']);
  assert.deepEqual(M.listDocuments({ ...state, laiVisibleDocIds: ids }, { query: 'd4' }).map((d) => d.id), ['d4']);
});

test('settings page source: wider currency list, owner hint, short local-data note, no leftover copy', () => {
  const src = read('business-ui.js');
  for (const code of ['USD', 'EUR', 'GBP', 'CNY', 'CAD', 'AUD', 'JPY', 'HKD', 'SGD', 'RUB', 'AED', 'INR', 'BRL', 'MXN']) assert.ok(src.includes(`"${code}"`), code);
  assert.match(src, /\[\.\.\.new Set\(\[current, \.\.\.CURRENCIES\]/);
  assert.ok(src.includes('新建客户、线索、商机、订单时默认填这个人。只能看本人或本部门客户的账号，会默认填自己。'));
  assert.ok(!src.includes('切换账号后会跟着变成当前账号'), 'switching accounts no longer rewrites the default owner');
  assert.ok(src.includes('客户、订单、日程都保存在来财里，可以随时备份。'));
  assert.ok(!src.includes('存在这台电脑上') && !src.includes('打开数据目录') && !src.includes('open-folder'), 'no Mac-only wording or data-folder button');
  assert.ok(!src.includes('统一客户与经营界面') && !src.includes('来财数据库'));
});

test('business forms read names from the scoped state and refuse customers outside the scope', () => {
  const src = read('business-ui.js');
  assert.match(src, /customers: OM\(\)\.customerNames\(pickState\(\)\)/);
  assert.match(src, /setup: OM\(\)\.formSetup\(pickState\(\)\)/);
  assert.match(src, /customers: LD\(\)\.customerNames\(pickState\(\)\)/);
  assert.ok(!/OM\(\)\.formSetup\(state\(\)\)/.test(src));
  assert.equal((src.match(/throw new Error\(HIDDEN_CUSTOMER\)/g) || []).length, 3, 'order, opportunity and lead convert');
  assert.ok(src.includes('这个客户不在你的范围内'));
  assert.ok(src.includes('can("product.view") ? PM().list(state())'));
});

test('compose shows a hint that the sender name is remembered', () => {
  assert.ok(read('mail-ui.js').includes('发信后会记住这个名字'));
});
