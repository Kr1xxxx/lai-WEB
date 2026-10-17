'use strict';
// 导出窗口: markup, scope choice -> rows, field gate, permission hiding of the header buttons, web-trial footer and copy.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const U = require('../src/export-ui.js');
const E = require('../src/export-model.js');
const CustomerList = require('../src/customer-list-ui.js');
const OrdersPage = require('../src/orders-page.js');

const customers = n => Array.from({ length: n }, (_, i) => ({ name: `Co ${i + 1}`, country: '法国', owner: '小王', email: `c${i + 1}@x.test`, contact: `P${i + 1}` }));
const ctxFor = (extra = {}) => {
  const all = customers(8);
  const toasts = [];
  return {
    state: {}, can: () => true, toast: text => toasts.push(text), dialog() {}, closeDialog() {}, toasts, trial: false,
    scopes: { filtered: all.slice(0, 5), selected: all.slice(5, 7), all },
    columns: ['name', 'email', 'country'],
    ...extra,
  };
};

test('scope choices: selected only for customers and only when something is selected', () => {
  const ctx = ctxFor();
  assert.deepEqual(U.scopeChoices('customer', ctx).map(s => [s.id, s.count]), [['filtered', 5], ['selected', 2], ['all', 8]]);
  assert.deepEqual(U.scopeChoices('customer', ctxFor({ scopes: { filtered: [], selected: [], all: [] } })).map(s => s.id), ['filtered', 'all']);
  assert.deepEqual(U.scopeChoices('order', ctx).map(s => s.id), ['filtered', 'all'], 'orders have no selection');
  assert.deepEqual(U.scopeChoices('lead', ctx).map(s => s.id), ['filtered', 'all']);
});

test('dialog markup: scopes with counts, columns for customers only, format, hint, preview', () => {
  const ctx = ctxFor();
  const view = U.viewFor('customer', ctx, { scope: 'filtered' });
  const html = U.bodyMarkup('customer', view);
  for (const text of ['范围', '当前筛选结果（5 条）', '已选的（2 条）', '全部我能看到的（8 条）', '列', '按列表字段设置', '全部字段', '格式', 'Excel（.xlsx）', 'CSV', '表里有客户联系方式，请妥善保管。', '预览']) assert.ok(html.includes(text), text);
  assert.match(html, /name="export-scope" value="filtered" checked/);
  assert.equal((html.match(/<tbody>[\s\S]*<\/tbody>/)[0].match(/<tr>/g) || []).length, 5, 'preview shows the first 5 rows');
  const orders = U.bodyMarkup('order', U.viewFor('order', ctxFor({ scopes: { filtered: [], all: [] } }), {}));
  assert.ok(!orders.includes('按列表字段设置'), 'no column choice for orders');
  assert.ok(orders.includes('产品明细只在 Excel 里有'));
  assert.ok(orders.includes('没有可导出的内容'));
  assert.equal(U.KINDS.customer.title, '导出客户');
  assert.deepEqual(['customer', 'order', 'opp', 'lead'].map(k => U.KINDS[k].title), ['导出客户', '导出订单', '导出商机', '导出线索']);
});

test('the default choice with a selection is 已选的; the footer has 导出 and is disabled with nothing to export', () => {
  const view = U.viewFor('customer', ctxFor(), { scope: 'selected' });
  assert.equal(view.scope, 'selected');
  assert.equal(view.count, 2);
  assert.match(U.footerMarkup('customer', view), /data-export-do="download"[^>]*>导出</);
  const empty = U.viewFor('lead', ctxFor({ scopes: { filtered: [], all: [] } }), {});
  assert.match(U.footerMarkup('lead', empty), /data-export-do="download" disabled/);
});

test('scope choice decides the rows: filtered, selected and all', () => {
  const ctx = ctxFor();
  assert.deepEqual(U.build('customer', ctx, { scope: 'filtered' }).sheets[0].data.map(r => r[0]), ['Co 1', 'Co 2', 'Co 3', 'Co 4', 'Co 5']);
  assert.deepEqual(U.build('customer', ctx, { scope: 'selected' }).sheets[0].data.map(r => r[0]), ['Co 6', 'Co 7']);
  const all = U.build('customer', ctx, { scope: 'all' });
  assert.equal(all.count, 8);
  assert.equal(all.sheets[0].data.length, 8);
});

test('columns: 按列表字段设置 follows the list order, 全部字段 uses the whole catalogue; the gate removes hidden ones', () => {
  const ctx = ctxFor();
  assert.deepEqual(U.build('customer', ctx, { scope: 'all', columns: 'list' }).sheets[0].header, ['公司名称', '邮箱', '国家地区', '其他联系人']);
  const wide = U.build('customer', ctx, { scope: 'all', columns: 'all' }).sheets[0].header;
  assert.ok(wide.length > 10 && wide.includes('邮箱') && wide.includes('跟进人'));
  const gated = ctxFor({ gate: { columnVisible: id => id !== 'email' } });
  const header = U.build('customer', gated, { scope: 'all', columns: 'all' }).sheets[0].header;
  assert.ok(!header.includes('邮箱'));
  assert.ok(!JSON.stringify(U.build('customer', gated, { scope: 'all', columns: 'all' }).sheets[0].data).includes('x.test'), 'no email value leaks');
  assert.ok(!U.bodyMarkup('customer', U.viewFor('customer', gated, { scope: 'all', columns: 'all' })).includes('x.test'), 'nor in the preview');
});

test('orders add the 产品明细 sheet in Excel, but not for CSV; opportunities and leads use the field gate', () => {
  const orders = [{ num: 'SO1', client: 'Acme', items: [{ code: 'P1', name: 'Pump', qty: 2, price: 5 }], amount: 10 }];
  const ctx = ctxFor({ scopes: { filtered: orders, all: orders } });
  assert.deepEqual(U.build('order', ctx, { format: 'xlsx' }).sheets.map(s => s.name), ['订单', '产品明细']);
  assert.deepEqual(U.build('order', ctx, { format: 'csv' }).sheets.map(s => s.name), ['订单']);
  const leads = [{ id: 'l1', name: 'L', email: 'a@x.test', phone: '123' }];
  const lctx = ctxFor({ scopes: { filtered: leads, all: leads }, gate: { columnVisible: id => id !== 'phone' } });
  const sheet = U.build('lead', lctx, {}).sheets[0];
  assert.ok(sheet.header.includes('邮箱') && !sheet.header.includes('电话'));
});

test('over the row limit shows the model message and blocks export', () => {
  const big = Array.from({ length: E.MAX_ROWS + 1 }, () => ({ name: 'x' }));
  const ctx = ctxFor({ scopes: { filtered: big, all: big } });
  const view = U.viewFor('customer', ctx, { scope: 'all' });
  assert.equal(view.error, '一次最多导出 20,000 行，请先筛选');
  assert.match(U.footerMarkup('customer', view), /data-export-do="download" disabled/);
  assert.throws(() => U.build('customer', ctx, { scope: 'all' }), /20,000/);
});

test('file name: 来财-客户-YYYYMMDD.xlsx and friends', () => {
  const day = new Date(2026, 9, 7);
  assert.equal(U.fileName('customer', 'xlsx', day), '来财-客户-20261007.xlsx');
  assert.equal(U.fileName('order', 'csv', day), '来财-订单-20261007.csv');
  assert.equal(U.fileName('opp', 'xlsx', day), '来财-商机-20261007.xlsx');
  assert.equal(U.fileName('lead', 'xlsx', day), '来财-线索-20261007.xlsx');
});

test('web trial footer: the note and 复制表格, no download button and no format choice', () => {
  const view = U.viewFor('customer', ctxFor({ trial: true }), {});
  const footer = U.footerMarkup('customer', view);
  assert.ok(footer.includes('网页试用版不能下载文件。'));
  assert.ok(footer.includes('复制表格'));
  assert.ok(!footer.includes('data-export-do="download"'));
  assert.ok(!U.bodyMarkup('customer', view).includes('export-format'));
  const normal = U.footerMarkup('customer', U.viewFor('customer', ctxFor(), {}));
  assert.ok(!normal.includes('网页试用版不能下载文件。') && !normal.includes('复制表格'));
});

// ---- open(): a tiny fake page ----
function fakePage() {
  const handlers = {};
  const nodes = {};
  const node = (name, extra = {}) => (nodes[name] ??= { hidden: false, value: '', textContent: '', innerHTML: '', disabled: false, classList: { add() {} }, focus() {}, select() { this.selected = true; }, querySelector: sel => nodes[sel] ??= node(sel), ...extra });
  const panel = {
    classList: { added: [], add(name) { this.added.push(name); } },
    addEventListener(kind, callback) { handlers[kind] = callback; },
    querySelector: selector => node(selector),
    querySelectorAll: () => [],
  };
  return { panel, handlers, nodes, node };
}
function withPage(run) {
  const page = fakePage();
  const previous = { document: globalThis.document, navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator') };
  globalThis.document = { querySelector: () => page.panel };
  return Promise.resolve(run(page)).finally(() => {
    globalThis.document = previous.document;
    if (previous.navigator) Object.defineProperty(globalThis, 'navigator', previous.navigator); else delete globalThis.navigator;
  });
}
const clickOn = (page, action) => page.handlers.click({ target: { closest: () => ({ dataset: { exportDo: action }, disabled: false }) } });

test('open() without the permission says so and opens nothing', () => withPage(() => {
  let opened = 0;
  const ctx = ctxFor({ can: () => false, dialog() { opened++; }, denied: key => `没有${key}` });
  assert.equal(U.open('customer', ctx), false);
  assert.equal(opened, 0);
  assert.deepEqual(ctx.toasts, ['没有customer.export']);
  assert.equal(U.open('nonsense', ctx), false);
}));

test('open() in the web trial: 复制表格 puts tab-separated text on the clipboard and says how many', () => withPage(async page => {
  const copied = [];
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async text => { copied.push(text); } } } });
  let dialog;
  const ctx = ctxFor({ trial: true, dialog: (title, body, footer, type) => { dialog = { title, body, footer, type }; } });
  assert.equal(U.open('customer', ctx), true);
  assert.equal(dialog.title, '导出客户');
  assert.equal(dialog.type, 'export');
  assert.ok(dialog.footer.includes('网页试用版不能下载文件。'));
  assert.deepEqual(page.panel.classList.added, ['export-dialog']);
  clickOn(page, 'copy');
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(copied.length, 1);
  const lines = copied[0].split('\n');
  assert.equal(lines[0], ['公司名称', '邮箱', '国家地区', '其他联系人'].join('\t'));
  assert.equal(lines.length, 3, 'header plus the 2 selected customers (the default when something is selected)');
  assert.ok(ctx.toasts.at(-1).includes('2 位客户'));
}));

test('open() in the web trial: when the clipboard is refused the text is shown selected, with the Ctrl+C hint', () => withPage(async page => {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: () => Promise.reject(new Error('no')) } } });
  let dialog;
  U.open('customer', ctxFor({ trial: true, dialog: (title, body, footer) => { dialog = { body, footer }; } }));
  assert.ok(dialog.body.includes('请按 Ctrl+C（苹果电脑按 Cmd+C）复制'));
  clickOn(page, 'copy');
  await new Promise(resolve => setTimeout(resolve, 5));
  const box = page.nodes['.export-copybox'], area = box.querySelector('textarea');
  assert.equal(box.hidden, false);
  assert.ok(area.value.startsWith('公司名称\t邮箱'));
  assert.equal(area.selected, true);
}));

test('open(): a row-limit error shows in the dialog and nothing is exported', () => withPage(page => {
  const big = Array.from({ length: E.MAX_ROWS + 1 }, () => ({ name: 'x' }));
  const ctx = ctxFor({ scopes: { filtered: big, all: big }, trial: true, dialog() {} });
  U.open('customer', ctx);
  clickOn(page, 'copy');
  assert.equal(page.nodes['#export-error'].textContent, '一次最多导出 20,000 行，请先筛选');
  assert.equal(ctx.toasts.length, 0);
}));

test('header buttons exist only with the matching permission', () => {
  const p = { items: [], total: 0, page: 1, pageCount: 1 };
  const render = (can, exportEnabled) => CustomerList.render({ rows: [], p, filters: { group: 'all', field: 'name', query: '', owner: '' }, selected: new Set(), pageSize: 20, segments: [], groupTab: "groups", expanded: new Set(), team: 'team', icon: () => '', escape: s => String(s), tableMarkup: () => "", can, exportEnabled });
  assert.match(render(() => true, true), /data-export-kind="customer">导出</);
  assert.doesNotMatch(render(key => key !== 'customer.export', true), /data-export-kind/);
  assert.doesNotMatch(render(() => true, false), /data-export-kind/, 'not before the export window is loaded');
  const orderPage = can => OrdersPage.markup({ items: [], all: [], total: 0, filters: {}, stages: [], currencies: [], page: 1, pages: 1, trash: [], can, exportable: true });
  assert.match(orderPage(() => true), /data-export-kind="order">导出</);
  assert.doesNotMatch(orderPage(key => key !== 'order.export'), /data-export-kind/);
});

test('the new files are wired into the page build, the model loads first, and the click is dispatched', () => {
  const build = fs.readFileSync(path.join(__dirname, '../scripts/build.py'), 'utf8');
  const template = fs.readFileSync(path.join(__dirname, '../src/template.html'), 'utf8');
  for (const [marker, file] of [['EXPORT_UI', 'export-ui.js'], ['EXPORT_STYLE', 'export.css']]) {
    assert.ok(build.includes(`('<!--${marker}-->','${file}'`), marker);
    assert.ok(template.includes(`<!--${marker}-->`), marker);
  }
  assert.ok(template.indexOf('<!--EXPORT_MODEL-->') < template.indexOf('<!--EXPORT_UI-->'));
  const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  const business = fs.readFileSync(path.join(__dirname, '../src/business-ui.js'), 'utf8');
  assert.match(app, /d\.exportKind === "customer"/);
  assert.match(business, /exportKind !== "customer"/);
  for (const kind of ['opp', 'lead']) assert.ok(business.includes(`exportButton("${kind}")`), kind);
  // 全部订单页（orders-page.js）自己画导出按钮，所有配色都用它（D-029）。
  assert.match(fs.readFileSync(path.join(__dirname, '../src/orders-page.js'), 'utf8'), /data-export-kind="order"/);
});
