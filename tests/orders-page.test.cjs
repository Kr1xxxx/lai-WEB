const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Page = require('../src/orders-page.js');

const E = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const stages = [{ id: 'quote', label: '报价' }, { id: 'deposit', label: '定金' }, { id: 'production', label: '生产中' }, { id: 'balance', label: '尾款' }, { id: 'shipment', label: '已发货' }, { id: 'done', label: '已完成' }];
const order = (extra) => ({ id: 'o1', num: 'L-1', client: 'Harbor <Co>', country: 'US', currency: 'USD', stage: 'production', amount: 1000, paidAmount: 300, createdAt: '2026-10-07', owner: 'Kris', ...extra });
const input = (extra) => ({ items: [order()], all: [order(), order({ id: 'o2', isDraft: true }), order({ id: 'o3', stage: 'done' })], total: 1, filters: { search: '', stage: '', currency: '', period: '' }, stages, currencies: ['USD'], page: 1, pages: 1, trash: [], ...extra });

test('inPeriod handles month, last month (across New Year), quarter, year and missing dates', () => {
  assert.equal(Page.inPeriod('2026-10-07', 'month', '2026-10-08'), true);
  assert.equal(Page.inPeriod('2026-09-30', 'month', '2026-10-08'), false);
  assert.equal(Page.inPeriod('2026-09-30', 'lastMonth', '2026-10-08'), true);
  assert.equal(Page.inPeriod('2025-12-31', 'lastMonth', '2026-01-05'), true);
  assert.equal(Page.inPeriod('2026-07-01', 'quarter', '2026-09-30'), true);
  assert.equal(Page.inPeriod('2026-06-30', 'quarter', '2026-09-30'), false);
  assert.equal(Page.inPeriod('2026-01-01', 'year', '2026-10-08'), true);
  assert.equal(Page.inPeriod('', 'year', '2026-10-08'), false);
  assert.equal(Page.inPeriod('', '', '2026-10-08'), true);
});

test('summary counts valid, draft and unfinished orders', () => {
  assert.deepEqual(Page.summary(input().all), { valid: 2, drafts: 1, open: 1 });
});

test('a row keeps the data hooks business-ui.js relies on, escapes values and computes the amount due', () => {
  const html = Page.markup(input(), E);
  assert.match(html, /data-biz-order="o1"/);
  assert.match(html, /data-biz-customer="Harbor &lt;Co&gt;"/);
  assert.match(html, /data-biz-action="archive-order" data-id="o1"/);
  assert.match(html, /700\.00 USD/);
  assert.doesNotMatch(html, /<Co>/);
  for (const id of ['biz-search', 'biz-stage', 'biz-currency', 'biz-period', 'biz-order-scroll']) assert.match(html, new RegExp(`id="${id}"`));
});

test('the stage bar fills as many segments as the stage index; shipped orders count as fully paid', () => {
  const html = Page.markup(input({ items: [order({ stage: 'shipment' })] }), E);
  assert.equal((html.match(/<i class="on">/g) || []).length, 5);
  assert.match(html, /0\.00 USD/);
});

test('selected filters, drafts, pager state and the empty list are rendered', () => {
  const html = Page.markup(input({ items: [], total: 0, filters: { search: 'x"y', stage: 'done', currency: 'USD', period: 'month' }, page: 1, pages: 3 }), E);
  assert.match(html, /value="x&quot;y"/);
  assert.match(html, /<option value="done" selected>/);
  assert.match(html, /<option value="month" selected>/);
  assert.match(html, /没有符合条件的订单/);
  assert.match(html, /aria-label="上一页" disabled/);
  assert.doesNotMatch(html, /aria-label="下一页" disabled/);
});

test('the recycle bin lists archived orders with a restore button, or says it is empty', () => {
  const full = Page.markup(input({ trash: [{ id: 't1', num: 'L-9', client: 'Old', amount: 5, currency: 'EUR', stage: 'quote', trashedAt: '2026-10-01T10:00' }] }), E);
  assert.match(full, /data-biz-action="restore-order" data-id="t1"/);
  assert.match(full, /归档时间 2026-10-01/);
  assert.match(Page.markup(input(), E), /回收站是空的/);
});

test('it is only used in the new skin and wired into the build and the order handlers', () => {
  const ui = read('src/business-ui.js');
  assert.match(ui, /glassSkin\(\) && root\.LaiOrdersPage/);
  assert.match(ui, /id === "biz-period"/);
  assert.match(ui, /period = "";/);
  assert.match(read('scripts/build.py'), /orders-page\.js/);
  assert.match(read('src/template.html'), /<!--ORDERS_PAGE-->/);
  const css = read('src/skin-glass.css');
  assert.match(css, /:has\(#biz-order-form\)/);
});

test('rowsMarkup and footMarkup are exactly the rows and the footer of the full page (the search swaps only these)', () => {
  for (const extra of [{}, { items: [], total: 0 }, { page: 2, pages: 3, total: 41 }, { can: (key) => key !== 'order.create', items: [] }]) {
    const view = input(extra);
    const html = Page.markup(view, E);
    const rows = Page.rowsMarkup(view, E), foot = Page.footMarkup(view);
    assert.ok(html.includes(`</span></div>${rows}</div></div>${foot}</section>`), 'rows sit right after the table head, the footer right after the table');
    assert.match(foot, new RegExp(`共 ${view.total} 笔订单`));
  }
  assert.match(Page.rowsMarkup(input({ items: [] }), E), /没有符合条件的订单/);
  assert.match(Page.footMarkup(input({ page: 1, pages: 2 })), /data-biz-action="prev" aria-label="上一页" disabled>/);
  assert.doesNotMatch(Page.footMarkup(input({ page: 1, pages: 2 })), /data-biz-action="next" aria-label="下一页" disabled>/);
});
