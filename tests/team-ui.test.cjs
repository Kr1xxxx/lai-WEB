const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const T = require('../src/team-model.js');
const U = require('../src/team-ui.js');
const RM = require('../src/rail-menu.js');
const {escapeHtml} = require('../src/model.js');

const ui = U.create(escapeHtml);
const state = {
  customers: {
    'Alpha <b>Co</b>': {owner: 'Amy & Co', source: '展会', createdAt: '2026-10-05', history: [{type: 'followup', time: '2026-10-02', text: '<script>alert(1)</script>'}]},
    'Beta': {owner: 'Bob', source: '', createdAt: '2026-10-06'}
  },
  orders: [
    {id: 'o1', num: 'A1', client: 'Alpha <b>Co</b>', owner: 'Amy & Co', amount: 100, paidAmount: 40, currency: 'USD', stage: 'quote', orderMonth: '2026-10'},
    {id: 'o2', num: 'G1', client: 'Beta', owner: '', amount: 70, paidAmount: 70, currency: 'EUR', stage: 'balance', orderMonth: '2026-10'}
  ],
  laiTasks: [{id: 't1', title: '寄样', date: '2026-10-03', customer: 'Beta', done: true}]
};
const page = kind => ui.markup(T.report(kind, state, '2026-10'));

test('every report page shows tiles, the by-owner table with a total, the scope note and a six-month trend', () => {
  for (const kind of T.kinds) {
    const html = page(kind), report = T.report(kind, state, '2026-10');
    assert.match(html, /class="team-tiles"/, kind);
    assert.match(html, /<th>跟进人<\/th>/, kind);
    assert.ok(html.includes(escapeHtml(report.scope)), `${kind}: scope note`);
    assert.match(html, /class="team-total"/, kind);
    assert.equal((html.match(/<div><span>20\d\d-\d\d<\/span>/g) || []).length, 6 * report.trend.series.length, `${kind}: six months per series`);
  }
  const orders = page('orders');
  assert.match(orders, /<th>币种<\/th>/);
  assert.match(orders, /<span class="currency-badge">EUR<\/span>/);
  assert.match(orders, /100\.00 USD/); assert.match(orders, /70\.00 EUR/);
  assert.equal((orders.match(/class="team-total"/g) || []).length, 2, 'one total row per currency, never mixed');
  assert.match(page('assets'), /<th>客户来源<\/th>/);
});

test('names and notes from the data are escaped, never injected as markup', () => {
  const html = page('assets') + page('followups') + ui.detailMarkup(T.report('followups', state, '2026-10').total.records.items);
  assert.doesNotMatch(html, /<b>Co<\/b>|<script>alert/);
  assert.match(html, /Alpha &lt;b&gt;Co&lt;\/b&gt;/);
  assert.match(html, /Amy &amp; Co/);
});

test('numbers with records become buttons; zero stays plain text', () => {
  const html = page('tasks');
  assert.match(html, /<button type="button" class="team-number" data-team-detail="tile:total"[^>]*>1<\/button>/);
  const empty = ui.markup(T.report('tasks', {}, '2026-10'));
  assert.doesNotMatch(empty, /data-team-detail/);
  assert.match(empty, /本月暂无数据/);
  assert.match(empty, /<strong>0<\/strong>/);
  assert.match(empty, /<strong>—<\/strong>/, 'completion rate with no tasks shows a dash, not 0%');
});

test('detail keys resolve to the records behind a number and reject anything else', () => {
  const assets = T.report('assets', state, '2026-10');
  assert.deepEqual(ui.itemsFor(assets, 'tile:added').items.map(i => i.title).sort(), ['Alpha <b>Co</b>', 'Beta']);
  assert.equal(ui.itemsFor(assets, 'r:0:customers').label, `${assets.rows[0].label} · 在库客户`);
  assert.equal(ui.itemsFor(assets, 't:customers').items.length, 2);
  assert.equal(ui.itemsFor(assets, 'x:sources:0').items.length, 1);
  const orders = T.report('orders', state, '2026-10');
  assert.deepEqual(ui.itemsFor(orders, 'ot:1:total').items.map(i => i.title), ['A1']);
  assert.equal(ui.itemsFor(orders, 'ot:1:total').label, '合计 USD · 订单金额');
  for (const bad of ['', 'bogus', 'r:99:customers', 'r:0:__proto__', 'r:0:constructor', 't:nope', 'ot:9:total', 'x:none:0', 'x:sources:99', 'tile:nope', '__proto__'])
    assert.equal(ui.itemsFor(assets, bad), null, bad);
});

test('the detail list caps very long lists, says so, and links to the customer', () => {
  const items = Array.from({length: 250}, (_, i) => ({kind: 'task', title: `任务${i}`, meta: '2026-10-01 · 未完成', customer: 'Beta'}));
  const html = ui.detailMarkup(items);
  assert.equal((html.match(/<li>/g) || []).length, U.DETAIL_LIMIT);
  assert.match(html, /共 250 条，仅显示前 200 条/);
  assert.match(html, /data-biz-customer="Beta"/);
  assert.match(ui.detailMarkup([]), /没有记录/);
  assert.match(ui.detailMarkup([{kind: 'customer', title: 'A', customer: 'A'}]), />查看客户<\/button>/);
});

// ---- the shipped controller: route -> page, click on a number -> dialog ----
const source = fs.readFileSync(path.join(__dirname, '../src/business-ui.js'), 'utf8');
function controller(withTeam = true) {
  const mounted = [], dialogs = [], listeners = {};
  const B = require('../src/business-model.js');
  const sandbox = {window: null, document: {addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); }, getElementById: () => null}};
  sandbox.window = {LaiBusinessModel: B, ...(withTeam ? {LaiTeamModel: T, LaiTeamUI: U} : {})};
  vm.createContext(sandbox);
  vm.runInContext(source.replace(/\}\)\(window\);\s*$/, '})(window);'), sandbox);
  const ui = sandbox.window.LaiBusinessUI.create({
    getState: () => state, escape: escapeHtml, mount: html => mounted.push(html), save: async () => true, openCustomer() {},
    refreshCustomer() {}, navigate() {}, toast() {}, dialog: (...args) => dialogs.push(args), closeDialog() {}
  });
  const click = dataset => listeners.click.forEach(fn => fn({target: {closest: () => ({dataset, disabled: false})}}));
  return {ui, mounted, dialogs, click};
}

test('the four team routes render their page and a clicked number opens its records', () => {
  const c = controller();
  for (const [route, title] of [['team-assets', '客户资产'], ['team-followups', '跟进情况'], ['team-tasks', '任务完成'], ['team-orders', '订单业绩']]) {
    c.ui.navigate(route);
    const html = c.mounted.at(-1);
    assert.match(html, new RegExp(`<h1>${title}</h1>`), route);
    assert.match(html, /id="biz-month"/, route);
    assert.match(html, /class="team-tiles"/, route);
  }
  c.ui.navigate('team-tasks');
  c.click({teamDetail: 'tile:total'});
  assert.equal(c.dialogs.length, 1);
  const [title, body, footer, type] = c.dialogs[0];
  assert.equal(title, '任务数'); assert.equal(type, 'team-detail');
  assert.match(body, /寄样/); assert.match(footer, /data-action="close-modal"/);
  c.click({teamDetail: 'r:99:total'});
  c.click({teamDetail: 'bogus'});
  assert.equal(c.dialogs.length, 1, 'unknown keys open nothing');
});

test('opening a team page without the team modules loaded does not break the other pages', () => {
  const c = controller(false);
  c.ui.navigate('analysis');
  assert.match(c.mounted.at(-1), /经营统计/);
});

// ---- rail highlight for business pages ----
test('the rail highlights the menu that owns the current page', () => {
  const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  const body = app.slice(app.indexOf('  function railActive('), app.indexOf('  function appNav()'));
  const active = (route, favoritesMode = false) => {
    const sandbox = {RM, activeRoute: route, favoritesMode};
    vm.createContext(sandbox); vm.runInContext(body, sandbox);
    const labels = ['常用', '工作台', '邮件', '沟通', '线索', '客户', '商机', '交易', '团队数据', '协同', '企业管理'];
    const routeOf = {客户: 'customers', 工作台: 'dashboard', 交易: 'order-list', 团队数据: 'analysis', 协同: 'calendar', 企业管理: 'settings'};
    return labels.filter(label => vm.runInContext(`railActive(${JSON.stringify(label)}, ${JSON.stringify(routeOf[label] || null)})`, sandbox));
  };
  assert.deepEqual(active('customers'), ['客户']);
  assert.deepEqual(active('customers', true), ['常用']);
  assert.deepEqual(active('order-trash'), ['交易']);
  assert.deepEqual(active('order-list'), ['交易']);
  for (const route of ['analysis', 'team-assets', 'team-followups', 'team-tasks', 'team-orders']) assert.deepEqual(active(route), ['团队数据'], route);
  assert.deepEqual(active('dashboard'), ['工作台']);
  assert.deepEqual(active('calendar'), ['协同']);
  assert.deepEqual(active('settings'), ['企业管理']);
});

test('the team modules are loaded between the business model and the business UI', () => {
  const template = fs.readFileSync(path.join(__dirname, '../src/template.html'), 'utf8');
  const build = fs.readFileSync(path.join(__dirname, '../scripts/build.py'), 'utf8');
  const at = marker => template.indexOf(`<!--${marker}-->`);
  assert.ok(at('LAI_BUSINESS_MODEL') < at('TEAM_MODEL') && at('TEAM_MODEL') < at('TEAM_UI') && at('TEAM_UI') < at('LAI_BUSINESS_UI'));
  assert.match(build, /'<!--TEAM_MODEL-->','team-model\.js','script'/);
  assert.match(build, /'<!--TEAM_UI-->','team-ui\.js','script'/);
  const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  for (const route of ['team-assets', 'team-followups', 'team-tasks', 'team-orders']) assert.ok(app.includes(`"${route}"`), route);
});
