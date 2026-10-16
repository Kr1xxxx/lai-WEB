// A full timestamp is shown (and compared) as the local calendar day, not the UTC day; plain YYYY-MM-DD stays as it is.
// The zone is fixed before anything uses Date: 2026-10-15 20:00 UTC is already the 16th in Shanghai.
process.env.TZ = 'Asia/Shanghai';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const B = require('../src/business-model.js');
const Modules = require('../src/modules.js');
const OrdersPage = require('../src/orders-page.js');
const ProductUI = require('../src/product-ui.js');
const ProductModel = require('../src/product-model.js');
const { escapeHtml: E } = require('../src/model.js');

const STAMP = '2026-10-15T20:00:00.000Z';

test('the zone really is Shanghai (otherwise the other tests prove nothing)', () => {
  assert.equal(new Date(STAMP).getDate(), 16);
});

test('orders page: the creation day and the period filter use the local day', () => {
  const stages = B.stages;
  const order = { id: 'o1', num: 'L-1', client: 'A', amount: 10, currency: 'USD', stage: 'quote', createdAt: STAMP };
  const html = OrdersPage.markup({ items: [order], all: [order], total: 1, filters: { search: '', stage: '', currency: '', period: '' }, stages, currencies: ['USD'], page: 1, pages: 1, trash: [] }, E);
  assert.match(html, /<span>10-16<\/span>/);
  assert.doesNotMatch(html, /<span>10-15<\/span>/);
  // Born on the 16th local time, so it is "this month" for any day in October and not "last month" in November.
  assert.equal(OrdersPage.inPeriod(STAMP, 'month', '2026-10-16'), true);
  assert.equal(OrdersPage.inPeriod('2026-09-30T20:00:00.000Z', 'month', '2026-10-16'), true, 'the 1st of October local time');
  assert.equal(OrdersPage.inPeriod('2026-10-15', 'month', '2026-10-16'), true, 'plain dates unchanged');
});

test('product detail shows the local day of 更新于', () => {
  const ui = ProductUI.create(E, ProductModel);
  assert.match(ui.detailMarkup({}, { id: 'p', name: 'X', updatedAt: STAMP }), /更新于 2026-10-16/);
  assert.match(ui.detailMarkup({}, { id: 'p', name: 'X', updatedAt: '2026-10-15' }), /更新于 2026-10-15/);
});

test('the order recycle bin shows the local day of the archive time', () => {
  const listeners = [];
  const document = { addEventListener: (kind, fn) => listeners.push([kind, fn]), getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
  class FormData { [Symbol.iterator]() { return [][Symbol.iterator](); } }
  const window = { LaiBusinessModel: B, LaiModules: Modules, LaiOrdersPage: OrdersPage };
  const context = { window, document, FormData, crypto: webcrypto };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/business-ui.js'), 'utf8'), context);
  let html = '';
  let state = { orders: [], customers: {}, trashOrders: [{ id: 't1', num: 'L-9', client: 'Gone', amount: 5, currency: 'USD', stage: 'quote', trashedAt: STAMP }, { id: 't2', num: 'L-8', client: 'Plain', amount: 5, currency: 'USD', stage: 'quote', trashedAt: '2026-10-15' }] };
  const ui = window.LaiBusinessUI.create({ getState: () => state, escape: E, mount(next) { html = next; }, dialog() {}, closeDialog() {}, async save() {}, toast() {}, navigate() {}, openCustomer() {}, refreshCustomer() {} });
  ui.navigate('order-trash');
  assert.match(html, /<td>2026-10-16<\/td>/);
  assert.match(html, /<td>2026-10-15<\/td>/);
  assert.equal([...html.matchAll(/<td>2026-10-15<\/td>/g)].length, 1, 'only the plain date shows the 15th');
});
