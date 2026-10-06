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

// ---------------- 目标完成情况 / 团队墙 ----------------
const member = (owner, v) => ({owner, label: owner || '未分配', added: 0, orders: 0, amounts: [], amount: 0, records: 0, customers: 0, tasksTotal: 0, tasksDone: 0, taskRate: null, ...v});
const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
const overview = {
  month: '2026-10', primaryCurrency: 'USD',
  rules: {amount: '金额规则', added: '新建客户规则', orders: '订单数规则', records: '跟进规则', customers: '涉及客户规则', tasksDone: '任务规则'},
  members: [
    member('Amy', {added: 1, orders: 2, amounts: [{currency: 'EUR', total: 5}, {currency: 'USD', total: 300}], amount: 300, records: 3, customers: 2, tasksTotal: 2, tasksDone: 1, taskRate: 50}),
    member('Bob', {added: 4, orders: 2, amounts: [{currency: 'USD', total: 75}], amount: 75, tasksTotal: 1, tasksDone: 1, taskRate: 100}),
    member('Cy <i>', {added: 4, records: 9, customers: 4}),
    member('', {added: 7, orders: 1, amounts: [{currency: 'EUR', total: 70}], records: 1, customers: 1})
  ],
  total: {added: 16, orders: 5, amounts: [{currency: 'EUR', total: 75}, {currency: 'USD', total: 375}], records: 13, customers: 7, tasksTotal: 4, tasksDone: 2, taskRate: 50},
  trend: {months, series: [
    {id: 'amount:EUR', label: '成交订单金额（EUR）', format: 'money', currency: 'EUR', values: [0, 0, 0, 0, 0, 75]},
    {id: 'amount:USD', label: '成交订单金额（USD）', format: 'money', currency: 'USD', values: [0, 0, 0, 0, 300, 375]},
    {id: 'added', label: '新建客户数', format: 'count', values: [0, 0, 0, 0, 1, 16]},
    {id: 'orders', label: '新建销售订单数', format: 'count', values: [0, 0, 0, 0, 1, 5]},
    {id: 'records', label: '跟进记录数', format: 'count', values: [0, 0, 0, 0, 1, 13]},
    {id: 'tasksDone', label: '任务完成数', format: 'count', values: [0, 0, 0, 0, 1, 2]}]}
};
const bodyRows = html => [...html.match(/<tbody>([\s\S]*?)<\/tbody>/)[1].matchAll(/<tr><td><span class="team-rank[^"]*" aria-label="[^"]*">([^<]+)<\/span><\/td><td>([^<]*)<\/td>/g)].map(m => [m[2], m[1]]);

test('ranking: highest first, ties by name, 未分配 last and never ranked', () => {
  assert.deepEqual(ui.ranked(overview, 'added').map(r => [r.member.label, r.rank]), [['Bob', 1], ['Cy <i>', 2], ['Amy', 3], ['未分配', null]]);
  assert.deepEqual(ui.ranked(overview, 'amount').map(r => [r.member.label, r.rank]), [['Amy', 1], ['Bob', 2], ['Cy <i>', 3], ['未分配', null]]);
});

test('目标完成情况: tabs, overview cells with rule and unset target, member board', () => {
  const html = ui.goalsMarkup(overview, {});
  assert.match(html, /data-team-tab="result" aria-selected="true">结果目标/);
  assert.match(html, /data-team-tab="process" aria-selected="false">过程目标/);
  assert.match(html, /<h3>结果概览<\/h3>/);
  assert.deepEqual([...html.matchAll(/data-team-rule="(\w+)"/g)].map(m => m[1]), ['amount', 'added', 'orders']);
  assert.equal((html.match(/未设定目标值/g) || []).length, 3);
  assert.equal((html.match(/data-feature="设置目标值"/g) || []).length, 3, 'setting a target stays a reserved entry');
  assert.match(html, /data-feature="新建目标"/);
  assert.match(html, /<strong>75\.00 EUR<br>375\.00 USD<\/strong>/, 'currencies listed separately, never added together');
  assert.match(html, /<strong>16<\/strong>/); assert.match(html, /<strong>5<\/strong>/);
  assert.match(html, /<th colspan="3">成交订单金额<\/th><th colspan="3">新建客户数<\/th><th colspan="3">新建销售订单数<\/th>/);
  assert.match(html, /<th aria-sort="descending"><button type="button" class="team-sort" data-team-sort="amount"/);
  assert.deepEqual(bodyRows(html), [['Amy', '1'], ['Bob', '2'], ['Cy &lt;i&gt;', '3'], ['未分配', '—']]);
  assert.match(html, /<td>5\.00 EUR<br>300\.00 USD<\/td><td class="muted">—<\/td><td class="muted">--%<\/td>/);
  assert.doesNotMatch(html, /Cy <i>/);
  assert.match(html, /data-team-mode="rank" aria-pressed="true"/);
});

test('目标完成情况: column toggles, sorting, process tab and trend view', () => {
  let html = ui.goalsMarkup(overview, {showTarget: false, showRate: false});
  assert.match(html, /<th colspan="1">成交订单金额<\/th>/);
  assert.doesNotMatch(html, /<th>目标值<\/th>|<th>完成率<\/th>|--%/);
  assert.match(html, /data-team-toggle="target" aria-pressed="false"/);
  html = ui.goalsMarkup(overview, {sort: {id: 'added', dir: 'asc'}});
  assert.deepEqual(bodyRows(html), [['Amy', '3'], ['Cy &lt;i&gt;', '2'], ['Bob', '1'], ['未分配', '—']], 'ascending keeps true ranks and 未分配 last');
  assert.match(html, /<th aria-sort="ascending"><button type="button" class="team-sort" data-team-sort="added"/);
  html = ui.goalsMarkup(overview, {sort: {id: 'records', dir: 'desc'}});
  assert.deepEqual(bodyRows(html)[0], ['Amy', '1'], 'a column from the other tab falls back to this tab\'s first column');
  html = ui.goalsMarkup(overview, {tab: 'process'});
  assert.match(html, /<h3>过程概览<\/h3>/);
  assert.deepEqual([...html.matchAll(/data-team-rule="(\w+)"/g)].map(m => m[1]), ['records', 'customers', 'tasksDone']);
  assert.match(html, /共 4 个任务，完成率 50%/);
  assert.deepEqual(bodyRows(html), [['Cy &lt;i&gt;', '1'], ['Amy', '2'], ['Bob', '3'], ['未分配', '—']]);
  html = ui.goalsMarkup(overview, {mode: 'trend'});
  assert.doesNotMatch(html, /team-board/);
  assert.deepEqual([...html.matchAll(/<h4 class="team-trend-title">([^<]+)<\/h4>/g)].map(m => m[1]), ['成交订单金额（EUR）', '成交订单金额（USD）', '新建客户数', '新建销售订单数']);
  assert.match(html, /<i style="width:80%"><\/i><\/div><b>300\.00 USD<\/b>/);
  assert.deepEqual([...ui.goalsMarkup(overview, {mode: 'trend', tab: 'process'}).matchAll(/<h4 class="team-trend-title">([^<]+)<\/h4>/g)].map(m => m[1]), ['跟进记录数', '任务完成数']);
  assert.match(ui.goalsMarkup({...overview, members: []}, {}), /本月暂无数据/);
});

test('countdown: days left this month, finished and future months, leap year', () => {
  assert.deepEqual(ui.countdown('2026-10', '2026-10-06'), {left: 25, days: 31, remaining: 25 / 31, label: '离本月结束还剩', date: '10-06 周二'});
  assert.equal(ui.countdown('2026-10', '2026-10-31').left, 0);
  assert.deepEqual([ui.countdown('2026-09', '2026-10-06').left, ui.countdown('2026-09', '2026-10-06').label, ui.countdown('2026-09', '2026-10-06').remaining], [0, '本月已结束', 0]);
  assert.deepEqual([ui.countdown('2026-11', '2026-10-06').left, ui.countdown('2026-11', '2026-10-06').label], [30, '本月尚未开始']);
  assert.equal(ui.countdown('2028-02', '2028-02-01').left, 28);
  assert.equal(ui.countdown('2027-01', '2026-12-31').label, '本月尚未开始');
});

test('团队墙: countdown ring, amount card, ranking lists, number cards and PK table', () => {
  const html = ui.wallMarkup(overview, {}, '2026-10-06');
  assert.match(html, /<strong>25<small>天<\/small><\/strong><span>离本月结束还剩<\/span>/);
  assert.match(html, /10-06 周二/);
  const ring = 2 * Math.PI * 54;
  assert.ok(html.includes(`stroke-dasharray="${(ring * 25 / 31).toFixed(1)} ${ring.toFixed(1)}"`));
  assert.match(html, /<h3>成交订单金额<\/h3>[\s\S]*?<strong>75\.00 EUR<br>375\.00 USD<\/strong>[\s\S]*?<b>—<\/b>[\s\S]*?<b>--%<\/b>/);
  const list = title => [...html.split(`<h3>${title}</h3>`)[1].split('</ol>')[0].matchAll(/aria-label="第 (\d+) 名">\d+<\/span><span class="team-rank-name">([^<]+)<\/span><span class="team-rank-value">([^<]+)<\/span><span class="team-bar" aria-hidden="true"><i style="width:(\d+)%">/g)].map(m => [m[1], m[2], m[3], m[4]]);
  assert.deepEqual(list('成交订单金额排行榜'), [['1', 'Amy', '300.00 USD', '100'], ['2', 'Bob', '75.00 USD', '25'], ['3', 'Cy &lt;i&gt;', '0.00 USD', '0']]);
  assert.match(html, /按 USD 排名；其他币种见「订单业绩」。/);
  assert.deepEqual(list('新建客户数排行榜'), [['1', 'Bob', '4', '100'], ['2', 'Cy &lt;i&gt;', '4', '100'], ['3', 'Amy', '1', '25']]);
  assert.deepEqual(list('跟进记录数排行榜').map(r => r[1]), ['Cy &lt;i&gt;', 'Amy', 'Bob']);
  assert.match(html, /<h3>新建客户数<\/h3><span class="muted tiny">我的企业<\/span><strong>16<\/strong>/);
  assert.match(html, /<h3>新建销售订单数<\/h3><span class="muted tiny">我的企业<\/span><strong>5<\/strong>/);
  assert.match(html, /<h3>任务完成率<\/h3>[\s\S]*?<strong>50%<\/strong><span class="muted tiny">已完成 2 ／ 共 4 个任务<\/span><div class="team-progress" aria-hidden="true"><i style="width:50%">/);
  assert.match(html, /<h3>员工PK榜<\/h3><span class="team-first">第一名：Bob<\/span>/);
  assert.deepEqual(bodyRows(html), [['Bob', '1'], ['Cy &lt;i&gt;', '2'], ['Amy', '3'], ['未分配', '—']]);
  const sorted = ui.wallMarkup(overview, {wallSort: {id: 'records', dir: 'desc'}}, '2026-10-06');
  assert.match(sorted, /第一名：Cy &lt;i&gt;/);
  assert.match(sorted, /<th aria-sort="descending"><button type="button" class="team-sort" data-team-wall-sort="records"/);
  assert.doesNotMatch(html + sorted, /Cy <i>/);
});

test('团队墙 with no data shows zeros and dashes, never invented figures', () => {
  const html = ui.wallMarkup(T.overview({}, '2026-10'), {}, '2026-10-06');
  assert.match(html, /暂无成员数据/); assert.match(html, /第一名：—/); assert.match(html, /本月暂无数据/);
  assert.match(html, /<h3>任务完成率<\/h3>[\s\S]*?<strong>—<\/strong>/);
  assert.doesNotMatch(html, /排名；其他币种/);
});

test('controller: the two pages render, view actions re-render, rules open, and actions are ignored elsewhere', () => {
  const c = controller();
  const toasts = [];
  c.ui.navigate('team-goals');
  assert.match(c.mounted.at(-1), /<h1>目标完成情况<\/h1>/);
  assert.match(c.mounted.at(-1), /data-feature="AI团队分析"/); assert.match(c.mounted.at(-1), /data-feature="目标设置"/);
  let count = c.mounted.length;
  c.click({teamTab: 'process'});
  assert.equal(c.mounted.length, count + 1); assert.match(c.mounted.at(-1), /<h3>过程概览<\/h3>/);
  c.click({teamSort: 'customers'});
  assert.match(c.mounted.at(-1), /<th aria-sort="descending"><button type="button" class="team-sort" data-team-sort="customers"/);
  c.click({teamSort: 'customers'});
  assert.match(c.mounted.at(-1), /<th aria-sort="ascending"><button type="button" class="team-sort" data-team-sort="customers"/);
  c.click({teamToggle: 'rate'});
  assert.doesNotMatch(c.mounted.at(-1), /<th>完成率<\/th>/);
  c.click({teamMode: 'trend'});
  assert.doesNotMatch(c.mounted.at(-1), /team-board/);
  c.click({teamSort: 'not-a-column'});
  c.click({teamRule: 'records'});
  assert.equal(c.dialogs.at(-1)[0], '跟进记录数 · 统计规则'); assert.equal(c.dialogs.at(-1)[3], 'team-rule');
  assert.ok(c.dialogs.at(-1)[1].includes(escapeHtml(T.overview(state, '2026-10').rules.records)));
  c.click({teamRule: '__proto__'});
  assert.equal(c.dialogs.length, 1);
  c.ui.navigate('team-wall');
  assert.match(c.mounted.at(-1), /<h1>团队墙<\/h1>/); assert.match(c.mounted.at(-1), /class="team-wall"/);
  c.click({teamWallSort: 'orders'});
  assert.match(c.mounted.at(-1), /data-team-wall-sort="orders"[^>]*>新建订单数<span aria-hidden="true"> ▼/);
  c.ui.navigate('analysis');
  count = c.mounted.length;
  c.click({teamTab: 'process'}); c.click({teamRefresh: '1'});
  assert.equal(c.mounted.length, count, 'team view actions do nothing on other pages');
});
