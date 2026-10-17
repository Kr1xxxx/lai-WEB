const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const T = require('../src/team-model.js');
const U = require('../src/team-ui.js');
const RM = require('../src/rail-menu.js');
const {escapeHtml} = require('../src/model.js');
const { appSource } = require('./helpers/source.cjs');

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
  assert.match(orders, /<td><span class="k-badge k-badge--neutral">EUR<\/span><\/td>/);
  assert.match(orders, /<th class="k-num">订单金额<\/th>/, 'number columns are right-aligned kit columns');
  assert.match(orders, /<table class="k-table team-table">/);
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
  const html = page('followups');
  assert.match(html, /<button type="button" class="team-number" data-team-detail="tile:records"[^>]*>1<\/button>/);
  const empty = ui.markup(T.report('followups', {}, '2026-10'));
  assert.doesNotMatch(empty, /data-team-detail/);
  assert.match(empty, /本月暂无数据/);
  assert.match(empty, /<strong>0<\/strong>/);
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

test('the three team report routes render their page and a clicked number opens its records', () => {
  const c = controller();
  for (const [route, title] of [['team-assets', '客户资产'], ['team-followups', '跟进情况'], ['team-orders', '订单业绩']]) {
    c.ui.navigate(route);
    const html = c.mounted.at(-1);
    assert.match(html, new RegExp(`<h1 class="k-pageheader-title">${title}</h1>`), route);
    assert.match(html, /^<div class="team-page"><div class="k-pageheader">/, route);
    assert.match(html, /id="biz-month"/, route);
    assert.match(html, /class="team-tiles"/, route);
  }
  c.ui.navigate('team-followups');
  c.click({teamDetail: 'tile:records'});
  assert.equal(c.dialogs.length, 1);
  const [title, body, footer, type] = c.dialogs[0];
  assert.equal(title, '跟进记录数'); assert.equal(type, 'team-detail');
  assert.match(body, /alert\(1\)/); assert.doesNotMatch(body, /<script>/); assert.match(footer, /data-action="close-modal"/);
  c.click({teamDetail: 'r:99:total'});
  c.click({teamDetail: 'bogus'});
  assert.equal(c.dialogs.length, 1, 'unknown keys open nothing');
});

test('the other pages still work when the team modules are not loaded', () => {
  const c = controller(false);
  c.ui.navigate('analysis');
  assert.match(c.mounted.at(-1), /经营统计/);
});

// ---- rail highlight for business pages ----
test('the rail highlights the menu that owns the current page', () => {
  const app = appSource();
  const body = app.slice(app.indexOf('  function railActive('), app.indexOf('  function appNav()'));
  const active = (route, favoritesMode = false) => {
    const sandbox = {RM, activeRoute: route, favoritesMode};
    vm.createContext(sandbox); vm.runInContext(body, sandbox);
    const labels = ['常用', '工作台', '邮件', '沟通', '客户', '商机', '交易', '团队数据', '设置', '企业管理'];
    const routeOf = {客户: 'customers', 工作台: 'dashboard', 交易: 'order-list', 团队数据: 'analysis', 设置: 'settings'};
    return labels.filter(label => vm.runInContext(`railActive(${JSON.stringify(label)}, ${JSON.stringify(routeOf[label] || null)})`, sandbox));
  };
  assert.deepEqual(active('customers'), ['客户']);
  assert.deepEqual(active('customers', true), ['常用']);
  assert.deepEqual(active('order-trash'), ['交易']);
  assert.deepEqual(active('order-list'), ['交易']);
  for (const route of ['analysis', 'team-goals', 'team-targets', 'team-wall', 'team-assets', 'team-followups', 'team-orders']) assert.deepEqual(active(route), ['团队数据'], route);
  assert.deepEqual(active('dashboard'), ['工作台']);
  assert.deepEqual(active('settings'), ['设置']);
  assert.deepEqual(active('settings-hub'), ['设置']);
});

test('the team modules are loaded between the business model and the business UI', () => {
  const template = fs.readFileSync(path.join(__dirname, '../src/template.html'), 'utf8');
  const build = fs.readFileSync(path.join(__dirname, '../scripts/build.py'), 'utf8');
  const at = marker => template.indexOf(`<!--${marker}-->`);
  assert.ok(at('LAI_BUSINESS_MODEL') < at('TEAM_MODEL') && at('TEAM_MODEL') < at('TEAM_UI') && at('TEAM_UI') < at('LAI_BUSINESS_UI'));
  assert.match(build, /'<!--TEAM_MODEL-->','team-model\.js','script'/);
  assert.match(build, /'<!--TEAM_UI-->','team-ui\.js','script'/);
  const app = appSource();
  for (const route of ['team-assets', 'team-followups', 'team-orders']) assert.ok(app.includes(`"${route}"`), route);
  assert.ok(!app.includes('"team-tasks"'), '任务完成 went with 协同 (D-031)');
});

// ---------------- 目标完成情况 / 团队墙 ----------------
const member = (owner, v) => ({owner, label: owner || '未分配', added: 0, orders: 0, amounts: [], amount: 0, newDeal: 0, repeat: 0, records: 0, customers: 0, ...v});
const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
const overview = {
  month: '2026-10', primaryCurrency: 'USD',
  rules: {amount: '金额规则', newDeal: '新客户规则', repeat: '复购规则', added: '新建客户规则', orders: '订单数规则', records: '跟进规则', customers: '涉及客户规则'},
  members: [
    member('Amy', {newDeal: 2, repeat: 2, added: 1, orders: 2, amounts: [{currency: 'EUR', total: 5}, {currency: 'USD', total: 300}], amount: 300, records: 3, customers: 2}),
    member('Bob', {added: 4, orders: 2, amounts: [{currency: 'USD', total: 75}], amount: 75}),
    member('Cy <i>', {added: 4, records: 9, customers: 4}),
    member('', {added: 7, orders: 1, amounts: [{currency: 'EUR', total: 70}], records: 1, customers: 1})
  ],
  total: {added: 16, orders: 5, amounts: [{currency: 'EUR', total: 75}, {currency: 'USD', total: 375}], newDeal: 6, repeat: 2, records: 13, customers: 7},
  trend: {months, series: [
    {id: 'amount:EUR', label: '成交订单金额（EUR）', format: 'money', currency: 'EUR', values: [0, 0, 0, 0, 0, 75]},
    {id: 'amount:USD', label: '成交订单金额（USD）', format: 'money', currency: 'USD', values: [0, 0, 0, 0, 300, 375]},
    {id: 'repeat', label: '复购客户数', format: 'count', values: [0, 0, 0, 0, 0, 2]},
    {id: 'newDeal', label: '成交新客户数', format: 'count', values: [0, 0, 0, 0, 0, 6]},
    {id: 'added', label: '新建客户数', format: 'count', values: [0, 0, 0, 0, 1, 16]},
    {id: 'orders', label: '新建销售订单数', format: 'count', values: [0, 0, 0, 0, 1, 5]},
    {id: 'records', label: '跟进记录数', format: 'count', values: [0, 0, 0, 0, 1, 13]}]}
};
const bodyRows = html => [...html.match(/<tbody>([\s\S]*?)<\/tbody>/)[1].matchAll(/<tr><td><span class="team-rank[^"]*" aria-label="[^"]*">([^<]+)<\/span><\/td><td>([^<]*)<\/td>/g)].map(m => [m[2], m[1]]);

test('ranking: highest first, equal values share a rank, 未分配 last and never ranked', () => {
  assert.deepEqual(ui.ranked(overview, 'added').map(r => [r.member.label, r.rank]), [['Bob', 1], ['Cy <i>', 1], ['Amy', 3], ['未分配', null]]);
  assert.deepEqual(ui.ranked(overview, 'amount').map(r => [r.member.label, r.rank]), [['Amy', 1], ['Bob', 2], ['Cy <i>', null], ['未分配', null]], 'a member with nothing to show gets no rank');
});

test('目标完成情况: tabs, overview cells with rule and unset target, member board', () => {
  const html = ui.goalsMarkup(overview, {});
  assert.match(html, /<div class="k-tabs team-tabs" role="tablist"><button type="button" class="k-tab" role="tab" data-team-tab="result" aria-selected="true">结果目标/);
  assert.match(html, /data-team-tab="process" aria-selected="false">过程目标/);
  assert.match(html, /data-team-tab="opportunity" aria-selected="false">商机目标/);
  assert.match(html, /<h3 class="team-block-title">结果概览<\/h3>/);
  assert.deepEqual([...html.matchAll(/data-team-rule="(\w+)"/g)].map(m => m[1]), ['amount', 'repeat', 'newDeal', 'added', 'orders']);
  assert.equal((html.match(/未设定目标值/g) || []).length, 5);
  assert.deepEqual([...html.matchAll(/data-team-target="(\w+)">([^<]+)</g)].map(m => [m[1], m[2].trim()]).slice(0, 5), [['amount', '设置目标值 »'], ['repeat', '设置目标值 »'], ['newDeal', '设置目标值 »'], ['added', '设置目标值 »'], ['orders', '设置目标值 »']]);
  assert.match(html, /class="team-goal team-goal-new" data-team-target="new"/);
  assert.doesNotMatch(html, /已达标/);
  assert.match(html, /<strong>75\.00 EUR<br>375\.00 USD<\/strong>/, 'currencies listed separately, never added together');
  assert.match(html, /<strong>16<\/strong>/); assert.match(html, /<strong>5<\/strong>/);
  assert.match(html, /<th colspan="3">成交订单金额<\/th><th colspan="3">复购客户数<\/th><th colspan="3">成交新客户数<\/th><th colspan="3">新建客户数<\/th><th colspan="3">新建销售订单数<\/th>/);
  assert.match(html, /<th class="k-num" aria-sort="descending"><button type="button" class="team-sort" data-team-sort="amount"/);
  assert.deepEqual(bodyRows(html), [['Amy', '1'], ['Bob', '2'], ['Cy &lt;i&gt;', '—'], ['未分配', '—']]);
  assert.match(html, /<td class="k-num">5\.00 EUR<br>300\.00 USD<\/td><td class="k-num team-unset">—<\/td><td class="k-num team-unset">--%<\/td>/);
  assert.doesNotMatch(html, /Cy <i>/);
  assert.match(html, /class="k-tab is-active" data-team-mode="rank" aria-pressed="true"/);
  assert.match(html, /class="k-tab" data-team-mode="trend" aria-pressed="false"/);
  assert.match(html, /<span class="team-rank k-badge k-badge--warning" aria-label="第 1 名">1<\/span>/, 'first place is the warning badge, the rest are neutral');
  assert.match(html, /<span class="team-rank k-badge k-badge--neutral" aria-label="第 2 名">2<\/span>/);
});

test('目标完成情况: column toggles, sorting, process tab and trend view', () => {
  let html = ui.goalsMarkup(overview, {showTarget: false, showRate: false});
  assert.match(html, /<th colspan="1">成交订单金额<\/th>/);
  assert.doesNotMatch(html, /<th class="k-num">目标值<\/th>|<th class="k-num">完成率<\/th>|--%/);
  assert.match(ui.goalsMarkup(overview, {}), /<th class="k-num">目标值<\/th><th class="k-num">完成率<\/th>/, 'the column headers the toggles remove');
  assert.match(html, /data-team-toggle="target" aria-pressed="false"/);
  html = ui.goalsMarkup(overview, {sort: {id: 'added', dir: 'asc'}});
  assert.deepEqual(bodyRows(html), [['Amy', '3'], ['Cy &lt;i&gt;', '1'], ['Bob', '1'], ['未分配', '—']], 'ascending keeps true ranks and 未分配 last');
  assert.match(html, /<th class="k-num" aria-sort="ascending"><button type="button" class="team-sort" data-team-sort="added"/);
  html = ui.goalsMarkup(overview, {sort: {id: 'records', dir: 'desc'}});
  assert.deepEqual(bodyRows(html)[0], ['Amy', '1'], 'a column from the other tab falls back to this tab\'s first column');
  html = ui.goalsMarkup(overview, {tab: 'process'});
  assert.match(html, /<h3 class="team-block-title">过程概览<\/h3>/);
  assert.deepEqual([...html.matchAll(/data-team-rule="(\w+)"/g)].map(m => m[1]), ['records', 'customers']);
  assert.doesNotMatch(html, /任务/);
  assert.deepEqual(bodyRows(html), [['Cy &lt;i&gt;', '1'], ['Amy', '2'], ['Bob', '—'], ['未分配', '—']]);
  html = ui.goalsMarkup(overview, {mode: 'trend'});
  assert.doesNotMatch(html, /team-board/);
  assert.deepEqual([...html.matchAll(/<h4 class="team-trend-title">([^<]+)<\/h4>/g)].map(m => m[1]), ['成交订单金额（EUR）', '成交订单金额（USD）', '复购客户数', '成交新客户数', '新建客户数', '新建销售订单数']);
  assert.match(html, /<i style="width:80%"><\/i><\/div><b>300\.00 USD<\/b>/);
  assert.deepEqual([...ui.goalsMarkup(overview, {mode: 'trend', tab: 'process'}).matchAll(/<h4 class="team-trend-title">([^<]+)<\/h4>/g)].map(m => m[1]), ['跟进记录数']);
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
  assert.match(html, /<h3 class="k-card-title">成交订单金额<\/h3>[\s\S]*?<strong>75\.00 EUR<br>375\.00 USD<\/strong>[\s\S]*?<b>—<\/b>[\s\S]*?<b>--%<\/b>/);
  const list = title => [...html.split(`<h3 class="k-card-title">${title}</h3>`)[1].split('</ol>')[0].matchAll(/aria-label="第 (\d+) 名">\d+<\/span><span class="team-rank-name">([^<]+)<\/span><span class="team-rank-value">([^<]+)<\/span><span class="team-bar" aria-hidden="true"><i style="width:(\d+)%">/g)].map(m => [m[1], m[2], m[3], m[4]]);
  assert.deepEqual(list('成交订单金额排行榜'), [['1', 'Amy', '300.00 USD', '100'], ['2', 'Bob', '75.00 USD', '25']], 'members at zero are left off the list');
  assert.match(html, /按 USD 排名；其他币种见「订单业绩」。/);
  assert.deepEqual(list('新建客户数排行榜'), [['1', 'Bob', '4', '100'], ['1', 'Cy &lt;i&gt;', '4', '100'], ['3', 'Amy', '1', '25']]);
  assert.deepEqual(list('跟进记录数排行榜').map(r => r[1]), ['Cy &lt;i&gt;', 'Amy']);
  assert.match(html, /<h3 class="k-card-title">新建客户数<\/h3><span class="k-card-desc">我的企业<\/span><strong>16<\/strong>/);
  assert.match(html, /<h3 class="k-card-title">新建销售订单数<\/h3><span class="k-card-desc">我的企业<\/span><strong>5<\/strong>/);
  assert.doesNotMatch(html, /任务完成/, '任务完成率 went with 协同 (D-031)');
  assert.match(html, /<h3 class="k-card-title">复购客户数<\/h3>[\s\S]*?<h3 class="k-card-title">涉及客户数<\/h3><span class="k-card-desc">我的企业<\/span><strong>7<\/strong>/);
  assert.match(html, /<h3 class="k-card-title">员工PK榜<\/h3><span class="team-first">第一名：Bob<\/span>/);
  assert.deepEqual(bodyRows(html), [['Bob', '1'], ['Cy &lt;i&gt;', '1'], ['Amy', '3'], ['未分配', '—']]);
  const sorted = ui.wallMarkup(overview, {wallSort: {id: 'records', dir: 'desc'}}, '2026-10-06');
  assert.match(sorted, /第一名：Cy &lt;i&gt;/);
  assert.match(sorted, /<th class="k-num" aria-sort="descending"><button type="button" class="team-sort" data-team-wall-sort="records"/);
  assert.doesNotMatch(html + sorted, /Cy <i>/);
});

test('团队墙 with no data shows zeros and dashes, never invented figures', () => {
  const html = ui.wallMarkup(T.overview({}, '2026-10'), {}, '2026-10-06');
  assert.doesNotMatch(html, /aria-label="第 \d+ 名"/, 'nobody is ranked when there is nothing to rank'); assert.match(html, /第一名：—/); assert.ok((html.match(/本月暂无数据/g) || []).length >= 4);
  assert.match(html, /<h3 class="k-card-title">赢单商机数<\/h3><span class="k-card-desc">我的企业<\/span><strong>0<\/strong><span class="team-cap">本月还没有赢单或输单的商机<\/span>/);
  assert.match(html, /<li class="k-empty">本月暂无数据<\/li>/, 'an empty ranking list is the kit empty state');
  assert.match(html, /<h3 class="k-card-title">涉及客户数<\/h3><span class="k-card-desc">我的企业<\/span><strong>0<\/strong>/);
  assert.doesNotMatch(html, /排名；其他币种/);
});

test('controller: the two pages render, view actions re-render, rules open, and actions are ignored elsewhere', () => {
  const c = controller();
  const toasts = [];
  c.ui.navigate('team-goals');
  assert.match(c.mounted.at(-1), /<h1 class="k-pageheader-title">目标完成情况<\/h1>/);
  assert.match(c.mounted.at(-1), /<button type="button" class="k-btn" data-lai-route="team-targets">目标设置</);
  assert.match(c.mounted.at(-1), /<input type="month" id="biz-month" class="k-input team-month"/);
  let count = c.mounted.length;
  c.click({teamTab: 'process'});
  assert.equal(c.mounted.length, count + 1); assert.match(c.mounted.at(-1), /<h3 class="team-block-title">过程概览<\/h3>/);
  c.click({teamSort: 'customers'});
  assert.match(c.mounted.at(-1), /<th class="k-num" aria-sort="descending"><button type="button" class="team-sort" data-team-sort="customers"/);
  c.click({teamSort: 'customers'});
  assert.match(c.mounted.at(-1), /<th class="k-num" aria-sort="ascending"><button type="button" class="team-sort" data-team-sort="customers"/);
  assert.match(c.mounted.at(-1), /<th class="k-num">完成率<\/th>/);
  c.click({teamToggle: 'rate'});
  assert.doesNotMatch(c.mounted.at(-1), /<th class="k-num">完成率<\/th>/);
  c.click({teamMode: 'trend'});
  assert.doesNotMatch(c.mounted.at(-1), /team-board/);
  c.click({teamSort: 'not-a-column'});
  c.click({teamRule: 'records'});
  assert.equal(c.dialogs.at(-1)[0], '跟进记录数 · 统计规则'); assert.equal(c.dialogs.at(-1)[3], 'team-rule');
  assert.ok(c.dialogs.at(-1)[1].includes(escapeHtml(T.overview(state, '2026-10').rules.records)));
  c.click({teamRule: '__proto__'});
  assert.equal(c.dialogs.length, 1);
  c.ui.navigate('team-wall');
  assert.match(c.mounted.at(-1), /<h1 class="k-pageheader-title">团队墙<\/h1>/); assert.match(c.mounted.at(-1), /class="team-wall"/);
  assert.match(c.mounted.at(-1), /<button type="button" class="k-btn" data-team-refresh="1">刷新<\/button>/);
  c.click({teamWallSort: 'orders'});
  assert.match(c.mounted.at(-1), /data-team-wall-sort="orders"[^>]*>新建订单数<span aria-hidden="true"> ▼/);
  c.ui.navigate('analysis');
  count = c.mounted.length;
  c.click({teamTab: 'process'}); c.click({teamRefresh: '1'});
  assert.equal(c.mounted.length, count, 'team view actions do nothing on other pages');
});

// ---------------- 目标值与季度 ----------------
const withGoals = {...overview, targetMetrics: ['amount', 'repeat', 'newDeal', 'added', 'orders', 'records'], periodType: 'month', months: ['2026-10'],
  goals: {amount: [{key: 'k1', currency: 'EUR', value: 50, actual: 75, rate: 150, reached: true}, {key: 'k2', currency: 'USD', value: 500, actual: 375, rate: 75, reached: false}], added: [{key: 'k3', currency: '', value: 16, actual: 16, rate: 100, reached: true}]},
  members: overview.members.map(m => m.owner === 'Amy' ? {...m, goals: {amount: [{key: 'k4', currency: 'USD', value: 200, actual: 300, rate: 150, reached: true}]}} : {...m, goals: {}})};

test('目标完成情况 shows saved targets, completion, progress and the reached mark', () => {
  const html = ui.goalsMarkup(withGoals, {});
  assert.match(html, /目标 50\.00 EUR，完成率 150%<br>目标 500\.00 USD，完成率 75%/);
  assert.match(html, /data-team-target="amount">修改目标值 »/);
  assert.match(html, /<i style="width:75%"><\/i>/, 'the bar follows the currency that is furthest behind');
  assert.match(html, /新建客户数 <em class="k-badge k-badge--success team-reached">已达标<\/em>/);
  assert.doesNotMatch(html, /成交订单金额 <em class="k-badge k-badge--success team-reached">/, 'not reached until every currency target is met');
  assert.match(html, /目标 16，完成率 100%/); assert.match(html, /<i style="width:100%"><\/i>/);
  assert.match(html, /<td class="k-num">5\.00 EUR<br>300\.00 USD<\/td><td class="k-num">200\.00 USD<\/td><td class="k-num team-reached">150%<\/td>/);
  assert.match(html, /<td class="k-num">75\.00 USD<\/td><td class="k-num team-unset">—<\/td><td class="k-num team-unset">--%<\/td>/, 'members without a target stay empty');
  const process = ui.goalsMarkup(withGoals, {tab: 'process'});
  assert.match(process, /该指标暂不支持设置目标/, '涉及客户数 cannot be added up across months, so it has no target');
  assert.equal((process.match(/data-team-target="records"/g) || []).length, 1);
});

test('团队墙 amount card shows the company target; quarter view counts down to the quarter end', () => {
  const html = ui.wallMarkup(withGoals, {}, '2026-10-06');
  assert.match(html, /<b>50\.00 EUR<br>500\.00 USD<\/b><span class="team-cap">目标值<\/span>/);
  assert.match(html, /<b>150%<br>75%<\/b><span class="team-cap">完成率<\/span>/);
  assert.match(html, /<div class="team-segbar" aria-hidden="true"><i style="width:75%">/);
  assert.deepEqual(ui.countdown(['2026-10', '2026-11', '2026-12'], '2026-10-06'), {left: 86, days: 92, remaining: 86 / 92, label: '离本季度结束还剩', date: '10-06 周二'});
  assert.equal(ui.countdown(['2026-10', '2026-11', '2026-12'], '2026-12-31').left, 0);
  assert.equal(ui.countdown(['2026-07', '2026-08', '2026-09'], '2026-10-06').label, '本季度已结束');
  assert.equal(ui.countdown(['2027-01', '2027-02', '2027-03'], '2026-10-06').label, '本季度尚未开始');
  const quarter = ui.wallMarkup({...withGoals, periodType: 'quarter', months: ['2026-10', '2026-11', '2026-12'], members: []}, {}, '2026-10-06');
  assert.match(quarter, /<strong>86<small>天<\/small><\/strong><span>离本季度结束还剩<\/span>/);
  assert.match(quarter, /本季度暂无数据/);
});

test('target form offers the metrics, both periods, company or member, and escapes names', () => {
  const html = ui.targetFormMarkup(withGoals, {metric: 'orders', period: '2026-Q4', periods: [{key: '2026-10', label: '2026 年 10 月'}, {key: '2026-Q4', label: '2026 年第 4 季度'}]});
  assert.match(html, /<form class="k-dialog-body team-target-form" id="biz-target-form" novalidate data-form-check>/);
  assert.doesNotMatch(html, /biz-target-error/, 'the error slot is in the drawer footer next to 保存目标 (see the controller test)');
  assert.match(html, /<input name="value" [^>]*class="k-input" required>/);
  assert.deepEqual([...html.split('name="metric"')[1].split('</select>')[0].matchAll(/value="(\w+)"( selected)?/g)].map(m => [m[1], Boolean(m[2])]), [['amount', false], ['repeat', false], ['newDeal', false], ['added', false], ['orders', true], ['records', false]]);
  assert.match(html, /<option value="2026-10">2026 年 10 月<\/option><option value="2026-Q4" selected>2026 年第 4 季度<\/option>/);
  assert.match(html, /<option value="company" selected>企业整体<\/option><option value="member">成员（跟进人）<\/option>/);
  assert.deepEqual([...html.split('name="owner"')[1].split('</select>')[0].matchAll(/<option value="([^"]*)"/g)].map(m => m[1]), ['', 'Amy', 'Bob', 'Cy &lt;i&gt;'], '未分配 cannot be given a target');
  assert.match(html, /name="currency" value="USD"/); assert.match(html, /name="value"[^>]*required/);
  assert.match(ui.targetFormMarkup(withGoals, {metric: '__proto__', periods: []}), /<option value="amount" selected>/);
});

test('目标管理 lists every saved target with a delete action, or explains how to add one', () => {
  const targets = T.listTargets(T.setTarget(T.setTarget({}, {metric: 'amount', period: '2026-Q4', scope: 'company', currency: 'USD', value: 5000}), {metric: 'added', period: '2026-10', scope: 'member', owner: 'A <b>', value: 3}));
  const html = ui.targetsMarkup(targets, T.periodLabel);
  assert.match(html, /共 2 个/);
  assert.match(html, /<td>2026 年第 4 季度<\/td><td>企业整体<\/td><td>成交订单金额<\/td><td class="k-num">5,000\.00 USD<\/td>/);
  assert.match(html, /<td>2026 年 10 月<\/td><td>A &lt;b&gt;<\/td><td>新建客户数<\/td><td class="k-num">3<\/td>/);
  assert.match(html, /<table class="k-table team-table team-targets">/);
  assert.match(html, /class="k-btn k-btn--sm k-btn--ghost" data-team-target-remove="/);
  assert.equal((html.match(/data-team-target-remove="/g) || []).length, 2);
  assert.doesNotMatch(html, /A <b>/);
  assert.match(ui.targetsMarkup([], T.periodLabel), /<div class="k-empty"><p class="k-empty-title">还没有设置任何目标<\/p>/);
});

// 带保存能力的控制器：保存后状态更新，页面随之变化。
function savingController(initial, failWith = null) {
  let current = initial;
  const mounted = [], dialogs = [], listeners = {}, toasts = [], closed = [];
  const B = require('../src/business-model.js');
  const errors = {};
  const sandbox = {FormData: function (form) { return Object.entries(form.values)[Symbol.iterator](); }, document: {
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); }, getElementById: id => id ? (errors[id] ||= {textContent: '', classList: {add() {}}}) : null,
    querySelectorAll: () => [], querySelector: () => null}};
  sandbox.window = {LaiBusinessModel: B, LaiTeamModel: T, LaiTeamUI: U};
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  const ui = sandbox.window.LaiBusinessUI.create({getState: () => current, escape: escapeHtml, mount: html => mounted.push(html),
    save: async next => { if (failWith) throw new Error(failWith); current = next; return true; }, openCustomer() {}, refreshCustomer() {}, navigate() {},
    toast: text => toasts.push(text), dialog: (...args) => dialogs.push(args), closeDialog: () => closed.push(1)});
  return {ui, mounted, dialogs, toasts, closed, errors, state: () => current,
    click: dataset => Promise.all(listeners.click.map(fn => fn({target: {closest: () => ({dataset, disabled: false})}}))),
    submit: (id, values) => Promise.all(listeners.submit.map(fn => fn({target: {id, values, elements: {}}, preventDefault() {}})))};
}

test('controller: period switch, opening the form, saving a target and deleting it', async () => {
  const c = savingController(state);
  c.ui.navigate('team-goals');
  assert.match(c.mounted.at(-1), /data-team-period="month" aria-pressed="true"/);
  await c.click({teamPeriod: 'quarter'});
  assert.match(c.mounted.at(-1), /data-team-period="quarter" aria-pressed="true"/);
  assert.match(c.mounted.at(-1), /年第 \d 季度 · 按跟进人名称汇总/);
  await c.click({teamPeriod: 'month'});
  await c.click({teamTarget: 'added'});
  const [title, body, footer, type] = c.dialogs.at(-1);
  assert.deepEqual([title, type], ['设置目标', 'team-target']);
  assert.match(body, /<option value="added" selected>/); assert.match(footer, /type="submit" form="biz-target-form"/);
  assert.match(footer, /^<div class="error form-foot-error k-error" id="biz-target-error" role="alert" data-form-error><\/div><button type="button" class="k-btn" data-action="close-modal">取消<\/button><button class="k-btn k-btn--primary" type="submit"/, 'the error sits in the footer next to the buttons');
  const month = body.match(/name="period"><option value="(\d{4}-\d{2})" selected/)[1];
  await c.submit('biz-target-form', {metric: 'added', period: month, scope: 'company', owner: '', currency: 'USD', value: '4'});
  assert.deepEqual(T.listTargets(c.state()).map(t => [t.metric, t.period, t.owner, t.value]), [['added', month, null, 4]]);
  assert.equal(c.closed.length, 1); assert.deepEqual(c.toasts, ['已保存到来财']);
  assert.match(c.mounted.at(-1), /目标 4，完成率 \d+%/, 'the page re-renders with the new target');
  await c.submit('biz-target-form', {metric: 'added', period: month, scope: 'member', owner: '', value: '4'});
  assert.equal(c.errors['biz-target-error'].textContent, '请选择成员', 'validation errors appear in the form and nothing is saved');
  assert.equal(T.listTargets(c.state()).length, 1); assert.equal(c.closed.length, 1);
  c.ui.navigate('team-targets');
  assert.match(c.mounted.at(-1), /<h1 class="k-pageheader-title">目标管理<\/h1>/); assert.match(c.mounted.at(-1), /共 1 个/);
  assert.match(c.mounted.at(-1), /<button type="button" class="k-btn k-btn--primary" data-team-target="new">新建目标<\/button>/);
  const key = T.listTargets(c.state())[0].key;
  await c.click({teamTargetRemove: key});
  assert.equal(T.listTargets(c.state()).length, 1, 'the first click only asks for confirmation');
  assert.match(c.mounted.at(-1), /class="k-btn k-btn--sm k-btn--danger team-danger" data-team-target-remove="/);
  assert.match(c.mounted.at(-1), />再点一次确认删除<\/button><button type="button" class="k-btn k-btn--ghost k-btn--sm" data-team-target-cancel="1">取消</);
  await c.click({teamTargetCancel: '1'});
  assert.doesNotMatch(c.mounted.at(-1), /再点一次确认删除/); assert.equal(T.listTargets(c.state()).length, 1);
  await c.click({teamTargetRemove: key});
  c.ui.navigate('team-goals'); c.ui.navigate('team-targets');
  assert.doesNotMatch(c.mounted.at(-1), /再点一次确认删除/, 'leaving the page cancels a pending delete');
  await c.click({teamTargetRemove: key}); await c.click({teamTargetRemove: key});
  assert.equal(T.listTargets(c.state()).length, 0); assert.match(c.mounted.at(-1), /还没有设置任何目标/);
  await c.click({teamTargetRemove: 'missing'}); await c.click({teamTargetRemove: 'missing'});
  assert.equal(c.toasts.at(-1), '目标不存在或已删除');
});

test('controller: a failed save keeps the form open, shows the reason and saves nothing', async () => {
  const c = savingController(state, '数据已发生变化，请重新打开来财后再编辑。');
  c.ui.navigate('team-goals');
  await c.submit('biz-target-form', {metric: 'added', period: '2026-10', scope: 'company', value: '4'});
  assert.equal(c.errors['biz-target-error'].textContent, '数据已发生变化，请重新打开来财后再编辑。');
  assert.equal(c.closed.length, 0); assert.equal(c.state(), state);
  c.ui.navigate('analysis');
  await c.click({teamTarget: 'added'}); await c.click({teamTargetRemove: 'x'});
  assert.equal(c.dialogs.length, 0, 'target actions do nothing outside the team pages');
});

// ---------------- 独立评审后补充 ----------------
test('a hostile currency or name can never break out of an attribute on any team page', () => {
  const evil = '"><img src=x onerror=alert(1)>';
  const hostile = {customers: {[evil]: {owner: evil, source: evil, createdAt: '2026-10-05', history: [{type: 'followup', time: '2026-10-02', text: evil}]}},
    orders: [{id: evil, num: evil, client: evil, owner: evil, amount: 5, currency: evil, stage: 'quote', orderMonth: '2026-10'}],
    laiTasks: [{id: 't', title: evil, date: '2026-10-03', customer: evil, done: true}]};
  let html = '';
  for (const kind of T.kinds) { const r = T.report(kind, hostile, '2026-10'); html += ui.markup(r) + ui.detailMarkup(r.tiles[0].items); }
  const o = T.overview(hostile, '2026-10');
  html += ui.goalsMarkup(o, {}) + ui.goalsMarkup(o, {tab: 'process', mode: 'trend'}) + ui.wallMarkup(o, {}, '2026-10-06') + ui.targetFormMarkup(o, {periods: [{key: evil, label: evil}], value: evil, currency: evil});
  assert.doesNotMatch(html, /<img/i, 'no injected element');
  assert.doesNotMatch(html, /="[^"]*"><IMG/i);
  assert.match(html, /data-team-detail="tile:amount:&quot;&gt;&lt;IMG/, 'the currency in the detail key is escaped');
});

test('the 修改 form is prefilled and the delete button changes only for the armed row', () => {
  const html = ui.targetFormMarkup(withGoals, {metric: 'amount', value: 500, currency: 'EUR', periods: []});
  assert.match(html, /name="currency" value="EUR"/); assert.match(html, /name="value" value="500"/);
  assert.match(ui.targetFormMarkup(withGoals, {metric: 'added', periods: []}), /name="value" value=""/);
  const targets = T.listTargets(T.setTarget(T.setTarget({}, {metric: 'added', period: '2026-10', scope: 'company', value: 3}), {metric: 'orders', period: '2026-10', scope: 'company', value: 4}));
  const armed = ui.targetsMarkup(targets, T.periodLabel, targets[1].key);
  assert.equal((armed.match(/再点一次确认删除<\/button>/g) || []).length, 1);
  assert.equal((armed.match(/>删除<\/button>/g) || []).length, 1);
  assert.equal((ui.targetsMarkup(targets, T.periodLabel).match(/>删除<\/button>/g) || []).length, 2);
});

test('controller: the form always reflects current data, a wrong month is refused, details only open on team pages', async () => {
  const c = savingController(state);
  c.ui.navigate('team-goals');
  const before = c.dialogs.length;
  // 数据在看过页面之后发生变化：新增一位跟进人
  c.ui.navigate('team-targets');
  assert.match(c.mounted.at(-1), /id="biz-month"/, 'the period for a new target can be chosen on this page');
  // 停留在目标管理页时数据变了（这一页不会重新计算汇总）：新增一位跟进人
  await c.submit('biz-target-form', {metric: 'records', period: '2026-10', scope: 'member', owner: 'Newbie', value: '2'});
  await c.click({teamTarget: 'new'});
  assert.match(c.dialogs.at(-1)[1], /<option value="Newbie">Newbie<\/option>/, 'member list is recomputed, not taken from the earlier page view');
  assert.ok(c.dialogs.length > before);
  await c.submit('biz-target-form', {metric: 'added', period: '2026-10', scope: 'company', owner: 'Amy', value: '9'});
  assert.match(c.errors['biz-target-error'].textContent, /把「对象」改为成员/, 'picking a member without switching 对象 never overwrites the company target');
  assert.deepEqual(T.listTargets(c.state()).map(t => t.owner), ['Newbie']);
  c.ui.navigate('analysis');
  const dialogs = c.dialogs.length;
  await c.click({teamDetail: 'tile:total'});
  assert.equal(c.dialogs.length, dialogs, 'a stale detail key does nothing on a non-team page');
});

test('controller: an impossible month typed into the picker is rejected and the page keeps working', async () => {
  const mounted = [], listeners = {};
  const sandbox = {document: {addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); }, getElementById: () => null, querySelector: () => null}};
  sandbox.window = {LaiBusinessModel: require('../src/business-model.js'), LaiTeamModel: T, LaiTeamUI: U};
  vm.createContext(sandbox); vm.runInContext(source, sandbox);
  const page = sandbox.window.LaiBusinessUI.create({getState: () => state, escape: escapeHtml, mount: html => mounted.push(html), save: async () => true, openCustomer() {}, refreshCustomer() {}, navigate() {}, toast() {}, dialog() {}, closeDialog() {}});
  page.navigate('team-goals');
  const input = {id: 'biz-month', value: '2025-13', dataset: {}, closest: () => null};
  assert.doesNotThrow(() => listeners.change.forEach(fn => fn({target: input})));
  assert.notEqual(input.value, '2025-13', 'the field snaps back to the last valid month');
  assert.doesNotThrow(() => page.navigate('team-wall'));
  const good = {id: 'biz-month', value: '2025-12', dataset: {}, closest: () => null};
  listeners.change.forEach(fn => fn({target: good}));
  assert.match(mounted.at(-1), /2025 年 12 月/);
});

// ---------------- 导出与去掉空入口 ----------------
test('the board export matches what is on screen: tab, order, per-currency amounts, targets and totals', () => {
  const rows = ui.boardRows(withGoals, {});
  assert.deepEqual(rows[0].slice(0, 5), ['排名', '成员', '成交订单金额 完成值', '成交订单金额 目标值', '成交订单金额 完成率']);
  assert.equal(rows[0].length, 2 + 5 * 3);
  assert.deepEqual(rows[1].slice(0, 5), [1, 'Amy', '5.00 EUR / 300.00 USD', '200.00 USD', '150%']);
  assert.deepEqual(rows[2].slice(0, 5), [2, 'Bob', '75.00 USD', '', '']);
  assert.deepEqual(rows[3].slice(0, 2), ['', 'Cy <i>'], 'export is plain text, not HTML-escaped; no amount, no rank');
  assert.deepEqual(rows[4].slice(0, 3), ['', '未分配', '70.00 EUR']);
  assert.deepEqual(rows.at(-1).slice(0, 5), ['', '合计', '75.00 EUR / 375.00 USD', '50.00 EUR / 500.00 USD', '150% / 75%']);
  const added = rows[0].indexOf('新建客户数 完成值');
  assert.deepEqual(rows.at(-1).slice(added, added + 3), [16, 16, '100%'], 'counts stay numbers so Excel can sum them');
  const process = ui.boardRows(withGoals, {tab: 'process', sort: {id: 'records', dir: 'asc'}});
  assert.deepEqual(process[0].slice(2, 3), ['跟进记录数 完成值']);
  assert.deepEqual(process.slice(1, -1).map(r => r[1]), ['Bob', 'Amy', 'Cy <i>', '未分配']);
});

test('no button on the team pages only shows a reserved-entry notice; export writes a workbook', async () => {
  const c = savingController(state);
  for (const route of ['team-goals', 'team-wall', 'team-targets', 'team-assets', 'team-followups', 'team-orders']) {
    c.ui.navigate(route);
    assert.doesNotMatch(c.mounted.at(-1), /data-feature=/, route);
  }
  c.ui.navigate('team-goals');
  await c.click({teamExport: 'board'});
  assert.equal(c.toasts.at(-1), 'Excel 组件未加载，请重新打开来财', 'without the spreadsheet component it says so instead of failing silently');
});

test('the exported workbook can be read back with the same cells', () => {
  const XLSX = require('../vendor/sheetjs-0.20.3/xlsx.full.min.js');
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(ui.boardRows(withGoals, {})), '结果目标');
  const bytes = XLSX.write(book, {type: 'array', bookType: 'xlsx'});
  const back = XLSX.utils.sheet_to_json(XLSX.read(bytes, {type: 'array'}).Sheets['结果目标'], {header: 1, defval: ''});
  assert.deepEqual(back, ui.boardRows(withGoals, {}));
});


// ---------------- 商机目标页签与团队墙上的商机卡片 ----------------
const oppOverview = {
  ...overview, oppCurrency: 'USD',
  rules: {...overview.rules, oppWonAmount: '赢单金额规则', oppWon: '赢单规则', oppNew: '新建商机规则'},
  members: [
    member('Amy', {oppNew: 2, oppWon: 1, oppLost: 0, oppAmounts: [{currency: 'USD', total: 100}], oppWonAmount: 100, goals: {oppWon: [{key: 'k1', currency: '', value: 2, actual: 1, rate: 50, reached: false}]}}),
    member('Bob', {oppNew: 2, oppWon: 1, oppLost: 1, oppAmounts: [{currency: 'EUR', total: 50}], oppWonAmount: 0}),
    member('Cy <i>', {oppNew: 0, oppWon: 0, oppLost: 0, oppAmounts: [], oppWonAmount: 0}),
    member('', {oppNew: 1, oppWon: 0, oppLost: 0, oppAmounts: [], oppWonAmount: 0})
  ],
  total: {...overview.total, oppNew: 5, oppWon: 2, oppLost: 1, oppAmounts: [{currency: 'EUR', total: 50}, {currency: 'USD', total: 100}], oppWinRate: 67},
  goals: {oppWonAmount: [{key: 'k2', currency: 'USD', value: 200, actual: 100, rate: 50, reached: false}]},
  trend: {months, series: [...overview.trend.series,
    {id: 'oppWonAmount:USD', label: '赢单金额（USD）', format: 'money', currency: 'USD', values: [0, 0, 0, 0, 50, 100]},
    {id: 'oppWon', label: '赢单商机数', format: 'count', values: [0, 0, 0, 0, 1, 2]},
    {id: 'oppNew', label: '新建商机数', format: 'count', values: [0, 0, 0, 0, 1, 5]}]}
};

test('商机目标 tab: three opportunity figures with targets, win rate, ranking and trend', () => {
  const html = ui.goalsMarkup(oppOverview, {tab: 'opportunity'});
  assert.match(html, /data-team-tab="opportunity" aria-selected="true">商机目标/); assert.match(html, /<h3 class="team-block-title">商机概览<\/h3>/);
  assert.deepEqual([...html.matchAll(/data-team-rule="(\w+)"/g)].map(m => m[1]), ['oppWonAmount', 'oppWon', 'oppNew']);
  assert.match(html, /<strong>50\.00 EUR<br>100\.00 USD<\/strong>/, 'won amount per currency, never added together');
  assert.match(html, /目标 200\.00 USD，完成率 50%/); assert.match(html, /data-team-target="oppWonAmount">修改目标值/);
  assert.match(html, /<strong>2<\/strong><span class="team-goal-note">赢单率 67%（赢单 2 ／ 输单 1）<\/span>/);
  assert.match(html, /<th colspan="3">赢单金额<\/th><th colspan="3">赢单商机数<\/th><th colspan="3">新建商机数<\/th>/);
  assert.deepEqual(bodyRows(html), [['Amy', '1'], ['Bob', '—'], ['Cy &lt;i&gt;', '—'], ['未分配', '—']], 'ranked by won amount in USD; Bob won only in EUR');
  assert.match(html, /<td class="k-num">1<\/td><td class="k-num">2<\/td><td class="k-num">50%<\/td>/, 'Amy: 1 won against a target of 2');
  assert.deepEqual(bodyRows(ui.goalsMarkup(oppOverview, {tab: 'opportunity', sort: {id: 'oppNew', dir: 'desc'}})), [['Amy', '1'], ['Bob', '1'], ['Cy &lt;i&gt;', '—'], ['未分配', '—']]);
  assert.deepEqual([...ui.goalsMarkup(oppOverview, {tab: 'opportunity', mode: 'trend'}).matchAll(/<h4 class="team-trend-title">([^<]+)<\/h4>/g)].map(m => m[1]), ['赢单金额（USD）', '赢单商机数', '新建商机数']);
  assert.match(ui.goalsMarkup({...oppOverview, total: {...oppOverview.total, oppWinRate: null}}, {tab: 'opportunity'}), /本月还没有赢单或输单的商机/);
  assert.match(ui.goalsMarkup(oppOverview, {tab: 'nonsense'}), /<h3 class="team-block-title">结果概览<\/h3>/, 'an unknown tab falls back to the first one');
  assert.doesNotMatch(html, /Cy <i>/);
});

test('团队墙 shows the opportunity cards; export and target list handle the won amount as money', () => {
  const html = ui.wallMarkup(oppOverview, {}, '2026-10-06');
  const list = html.split('<h3 class="k-card-title">赢单金额排行榜</h3>')[1].split('</ol>')[0];
  assert.deepEqual([...list.matchAll(/class="team-rank-name">([^<]+)<\/span><span class="team-rank-value">([^<]+)</g)].map(m => [m[1], m[2]]), [['Amy', '100.00 USD']]);
  assert.match(html, /按 USD 排名；其他币种见「商机分析」。/);
  assert.match(ui.wallMarkup({...oppOverview, oppCurrency: 'EUR'}, {}, '2026-10-06').split('<h3 class="k-card-title">赢单金额排行榜</h3>')[1].split('</ol>')[0], /<span class="team-rank-value">100\.00 EUR<\/span>/, 'the won-amount list uses its own ranking currency, not the order one');
  assert.match(html, /<h3 class="k-card-title">新建商机数<\/h3><span class="k-card-desc">我的企业<\/span><strong>5<\/strong>/);
  assert.match(html, /<h3 class="k-card-title">赢单商机数<\/h3><span class="k-card-desc">我的企业<\/span><strong>2<\/strong><span class="team-cap">赢单率 67%（赢单 2 ／ 输单 1）<\/span>/);
  assert.match(html, /data-team-wall-sort="oppWonAmount"[^>]*>赢单金额（USD）/);
  assert.match(ui.wallMarkup(oppOverview, {wallSort: {id: 'oppWon', dir: 'desc'}}, '2026-10-06'), /第一名：Amy/);
  const rows = ui.boardRows(oppOverview, {tab: 'opportunity'});
  assert.deepEqual(rows[0], ['排名', '成员', '赢单金额 完成值', '赢单金额 目标值', '赢单金额 完成率', '赢单商机数 完成值', '赢单商机数 目标值', '赢单商机数 完成率', '新建商机数 完成值', '新建商机数 目标值', '新建商机数 完成率']);
  assert.deepEqual(rows[1], [1, 'Amy', '100.00 USD', '', '', 1, 2, '50%', 2, '', '']);
  assert.deepEqual(rows[2].slice(0, 3), ['', 'Bob', '50.00 EUR']);
  assert.deepEqual(rows.at(-1).slice(0, 5), ['', '合计', '50.00 EUR / 100.00 USD', '200.00 USD', '50%']);
  const listed = ui.targetsMarkup([{key: 'k', metric: 'oppWonAmount', period: '2026-10', owner: null, currency: 'USD', value: 200}, {key: 'j', metric: 'oppNew', period: '2026-10', owner: 'Amy', currency: '', value: 5}], p => p);
  assert.match(listed, /<td>赢单金额<\/td><td class="k-num">200\.00 USD<\/td>/); assert.match(listed, /<td>新建商机数<\/td><td class="k-num">5<\/td>/);
  assert.match(ui.targetFormMarkup({...oppOverview, targetMetrics: T.targetMetrics}, {metric: 'oppWon', periods: []}), /<option value="oppWon" selected>赢单商机数<\/option>/);
});

test('target form: currency only for money figures, member only once 对象 is 成员', () => {
  const o = {...oppOverview, targetMetrics: T.targetMetrics};
  const count = ui.targetFormMarkup(o, {metric: 'added', periods: []});
  assert.match(count, /<label class="field" hidden>币种<input name="currency"[^>]* disabled>/);
  assert.match(count, /<label class="field" hidden>成员<select name="owner" disabled>/);
  for (const metric of ['amount', 'oppWonAmount']) {
    const money = ui.targetFormMarkup(o, {metric, periods: [], currency: 'EUR'});
    assert.match(money, /<label class="field">币种<input name="currency" value="EUR"/, metric);
    assert.doesNotMatch(money, /name="currency"[^>]* disabled/, metric);
  }
  assert.deepEqual(['amount', 'oppWonAmount', 'oppWon', 'added'].map(ui.isMoney), [true, true, false, false]);
});

test('scopeNote: shown on every page type, replaces 我的企业 and hides the company goal edit and 未分配 footnote', () => {
  const scoped = T.scopeState(state, owner => String(owner || '').trim().toLowerCase() === 'bob');
  const note = '只显示你自己的数据';
  const html = ui.markup({...T.report('orders', scoped, '2026-10'), scopeNote: note});
  assert.ok(html.includes(note));
  const overview = {...T.overview(scoped, '2026-10'), scopeNote: note};
  const goals = ui.goalsMarkup(overview, {}), wall = ui.wallMarkup(overview, {}, '2026-10-16');
  for (const page of [goals, wall]) { assert.ok(page.includes(note)); assert.ok(!page.includes('我的企业')); assert.ok(!page.includes('「未分配」不参与排名')); }
  assert.ok(wall.includes('我的数据'));
  assert.ok(!goals.includes('data-team-target='));
  assert.ok(ui.goalsMarkup(T.overview(state, '2026-10'), {}).includes('data-team-target="new"'));
});
