const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../src/team-model.js');

// 合成数据，月份 2026-10。预期值全部手算。
const customer = (owner, source, createdAt, history = [], extra = {}) => ({owner, source, createdAt, history, ...extra});
const state = {
  customers: {
    'Alpha Co': customer('Amy', '展会', '2026-10-05T12:00:00.000Z', [
      {type: 'followup', time: '2026-10-02 09:00', text: '电话沟通报价'},
      {type: 'followup', time: '2026-10-20T10:00:00', text: '发样品'},
      {type: 'operation', time: '2026-10-03', text: '更新客户资料'},
      {type: 'followup', time: '2026-09-15', text: '九月跟进'}]),
    'Beta Ltd': customer('Amy', '展会', '2026-09-20', [{type: 'followup', time: '2026-10-10', text: 'x'.repeat(80)}]),
    'Gamma Inc': customer('Bob', '', '2026-10-01'),
    'Delta GmbH': customer('', '网站', '2026-10-12', [{type: 'followup', time: '2026-10-12', text: '公海客户跟进'}], {laiBucket: 'pool'}),
    'Trash Co': customer('Amy', '展会', '2026-10-08', [{type: 'followup', time: '2026-10-08', text: '不应计入'}], {laiBucket: 'trash'}),
    'Legacy': customer('Bob', '展会', undefined, [{time: '2026-10-07', text: '没有类型的旧记录'}])
  },
  orders: [
    {id: 'o1', num: 'A1', client: 'Alpha Co', owner: 'Amy', amount: 100, paidAmount: 40, currency: 'USD', stage: 'quote', orderMonth: '2026-10'},
    {id: 'o2', num: 'A2', client: 'Alpha Co', owner: 'Amy', amount: 200, paidAmount: 0, currency: 'USD', stage: 'done', orderMonth: '2026-10'},
    {id: 'o3', num: 'B1', client: 'Beta Ltd', owner: 'Bob', amount: 50, paidAmount: 0, currency: 'USD', stage: 'production', orderMonth: '2026-10'},
    {id: 'o4', num: 'G1', client: 'Gamma Inc', owner: '', amount: 70, paidAmount: 70, currency: 'EUR', stage: 'balance', orderMonth: '2026-10'},
    {id: 'o5', num: 'D1', client: 'Alpha Co', owner: 'Amy', amount: 999, paidAmount: 0, currency: 'USD', stage: 'quote', orderMonth: '2026-10', isDraft: true},
    {id: 'o6', num: 'A0', client: 'Alpha Co', owner: 'Amy', amount: 300, paidAmount: 0, currency: 'USD', stage: 'done', orderMonth: '2026-09'},
    {id: 'o7', num: 'B2', client: 'Beta Ltd', owner: ' Bob ', amount: 25, paidAmount: 0, currency: ' usd ', stage: 'quote', orderMonth: '2026-10'}
  ],
  laiTasks: [
    {id: 't1', title: '寄样', date: '2026-10-03', customer: 'Alpha Co', done: true},
    {id: 't2', title: '回访', date: '2026-10-04', customer: 'Alpha Co', done: false},
    {id: 't3', title: '报价', date: '2026-10-05', customer: 'Gamma Inc', done: true},
    {id: 't4', title: '整理资料', date: '2026-10-06', done: false},
    {id: 't5', title: '孤立任务', date: '2026-10-07', customer: 'Ghost', done: true},
    {id: 't6', title: '九月任务', date: '2026-09-30', customer: 'Alpha Co', done: true},
    {id: 't7', title: '坏日期', date: 'bad', customer: 'Alpha Co', done: true}
  ]
};
// 没有商机数据时，商机指标全部为 0，赢单率为空。
const NO_OPP = {oppNew: 0, oppWon: 0, oppLost: 0, oppAmounts: [], oppWinRate: null};
const snapshot = JSON.stringify(state);
const cells = (row, ids) => ids.map(id => row.cells[id].value);
const find = (report, owner) => report.rows.find(row => row.owner === owner);

test('month helpers use local calendar months and ignore malformed dates', () => {
  assert.equal(T.monthOf('2026-10-31'), '2026-10');
  assert.equal(T.monthOf('2026-10-02 09:00'), '2026-10');
  assert.equal(T.monthOf('2026-13-01'), '');
  for (const bad of ['', 'bad', '2026-10', '2026', null, undefined, '2026-02-30x']) assert.equal(T.monthOf(bad), '', String(bad));
  assert.deepEqual(T.monthsEnding('2026-10'), ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  assert.deepEqual(T.monthsEnding('2026-02'), ['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02']);
  assert.throws(() => T.report('assets', state, '2026-1'), /有效月份/);
  assert.throws(() => T.report('nope', state, '2026-10'), /不支持/);
  assert.deepEqual([...T.kinds], ['assets', 'followups', 'tasks', 'orders']);
});

test('客户资产: in-list customers, new customers, owner rows, source split, trend', () => {
  const r = T.report('assets', state, '2026-10');
  assert.deepEqual(r.rows.map(row => [row.label, ...cells(row, ['customers', 'added'])]), [['Amy', 2, 1], ['Bob', 2, 1], ['未分配', 0, 1]]);
  assert.deepEqual([r.total.customers.value, r.total.added.value], [4, 3], 'pool and trash customers are not in the list; trash is not "new"');
  assert.deepEqual(r.tiles.map(t => [t.label, t.value]), [['在库客户', 4], ['本月新增', 3]]);
  assert.deepEqual(find(r, 'Amy').cells.customers.items.map(i => i.title).sort(), ['Alpha Co', 'Beta Ltd']);
  assert.deepEqual(r.total.added.items.map(i => i.title).sort(), ['Alpha Co', 'Delta GmbH', 'Gamma Inc']);
  assert.deepEqual(r.extra[0].rows.map(s => [s.label, s.count, s.percent]), [['展会', 3, 75], ['未填写', 1, 25]]);
  assert.deepEqual(r.extra[0].rows[1].items.map(i => i.title), ['Gamma Inc']);
  assert.deepEqual(r.notes, ['有 1 位客户没有创建时间，未计入任何月份的新增。']);
  assert.deepEqual(r.trend.months.map(m => m.values.added), [0, 0, 0, 0, 1, 3]);
});

test('跟进情况: only followup-type records, by month, current owner, trash excluded, owners with none still listed', () => {
  const r = T.report('followups', state, '2026-10');
  assert.deepEqual(r.rows.map(row => [row.label, ...cells(row, ['records', 'customers'])]), [['Amy', 3, 2], ['Bob', 0, 0], ['未分配', 1, 1]]);
  assert.deepEqual([r.total.records.value, r.total.customers.value], [4, 3]);
  assert.deepEqual(r.total.customers.items.map(i => i.title).sort(), ['Alpha Co', 'Beta Ltd', 'Delta GmbH']);
  const long = find(r, 'Amy').cells.records.items.find(i => i.title === 'Beta Ltd');
  assert.equal(long.text, 'x'.repeat(60) + '…');
  assert.equal(long.meta, '2026-10-10');
  assert.deepEqual(r.trend.months.map(m => m.values.records), [0, 0, 0, 0, 1, 4]);
  const sept = T.report('followups', state, '2026-09');
  assert.deepEqual(sept.rows.map(row => [row.label, ...cells(row, ['records', 'customers'])]), [['Amy', 1, 1], ['Bob', 0, 0]]);
});

test('任务完成: counts, completion rate, unassigned fallback, bad dates ignored', () => {
  const r = T.report('tasks', state, '2026-10');
  assert.deepEqual(r.rows.map(row => [row.label, ...cells(row, ['total', 'done', 'rate'])]), [['Amy', 2, 1, 50], ['Bob', 1, 1, 100], ['未分配', 2, 1, 50]]);
  assert.deepEqual(cells({cells: r.total}, ['total', 'done', 'rate']), [5, 3, 60]);
  assert.deepEqual(r.tiles.map(t => [t.label, t.value, t.format]), [['任务数', 5, 'count'], ['已完成', 3, 'count'], ['完成率', 60, 'percent']]);
  assert.deepEqual(find(r, '').cells.total.items.map(i => i.title).sort(), ['孤立任务', '整理资料']);
  assert.equal(find(r, 'Amy').cells.rate.items.length, 2, 'rate cell lists the tasks it is computed from');
  assert.deepEqual(r.trend.months.map(m => [m.values.total, m.values.done]), [[0, 0], [0, 0], [0, 0], [0, 0], [1, 1], [5, 3]]);
  const empty = T.report('tasks', state, '2026-03');
  assert.equal(empty.total.rate.value, null, 'no tasks -> no rate, not 0%');
  assert.equal(find(empty, 'Amy').cells.rate.value, null);
});

test('订单业绩: same figures as 经营统计, by owner and currency, drafts excluded, no conversion', () => {
  const r = T.report('orders', state, '2026-10');
  assert.deepEqual(r.rows.map(row => [row.label, row.currency, ...cells(row, ['count', 'total', 'paid', 'due'])]),
    [['未分配', 'EUR', 1, 70, 70, 0], ['Amy', 'USD', 2, 300, 240, 60], ['Bob', 'USD', 2, 75, 0, 75]]);
  assert.deepEqual(r.totals.map(t => [t.currency, ...cells({cells: t.cells}, ['count', 'total', 'paid', 'due'])]),
    [['EUR', 1, 70, 70, 0], ['USD', 4, 375, 240, 135]]);
  assert.deepEqual(r.tiles.map(t => [t.label, t.value]), [['订单数', 5], ['订单金额（EUR）', 70], ['订单金额（USD）', 375]]);
  assert.deepEqual(find(r, 'Amy').cells.total.items.map(i => i.title).sort(), ['A1', 'A2']);
  assert.ok(!JSON.stringify(r).includes('D1'), 'draft order never appears');
  assert.deepEqual(r.trend.series.map(s => s.id), ['count', 'amount:EUR', 'amount:USD']);
  assert.deepEqual(r.trend.months.map(m => [m.month, m.values.count, m.values['amount:EUR'], m.values['amount:USD']]).slice(-2), [['2026-09', 1, 0, 300], ['2026-10', 5, 70, 375]]);
  const BM = require('../src/business-model.js');
  const byCurrency = list => Object.fromEntries(list.map(c => [c.currency, c.total]));
  assert.deepEqual(byCurrency(r.totals.map(t => ({currency: t.currency, total: t.cells.total.value}))), byCurrency(BM.monthlyAnalysis(state.orders, '2026-10').metrics.byCurrency));
});

test('empty and malformed data never throw and never invent numbers', () => {
  for (const kind of T.kinds) {
    for (const bad of [{}, {customers: null, orders: null, laiTasks: null}, {customers: {A: {history: 'oops', owner: 5}}, orders: [{}], laiTasks: [null]}]) {
      const r = T.report(kind, bad, '2026-10');
      assert.equal(r.kind, kind);
      assert.ok(Array.isArray(r.rows) && Array.isArray(r.tiles));
    }
  }
  const none = T.report('orders', {}, '2026-10');
  assert.deepEqual([none.rows, none.totals, none.tiles.map(t => t.value)], [[], [], [0]]);
});

test('building a report never changes the saved data', () => {
  for (const kind of T.kinds) T.report(kind, state, '2026-10');
  assert.equal(JSON.stringify(state), snapshot);
});

test('member overview merges the four reports per 跟进人 without changing any figure', () => {
  const o = T.overview(state, '2026-10');
  assert.deepEqual(o.members.map(m => [m.label, m.added, m.orders, m.amounts.map(a => `${a.currency}:${a.total}`).join(','), m.amount, m.records, m.customers, m.tasksTotal, m.tasksDone, m.taskRate]), [
    ['Amy', 1, 2, 'USD:300', 300, 3, 2, 2, 1, 50],
    ['Bob', 1, 2, 'USD:75', 75, 0, 0, 1, 1, 100],
    ['未分配', 1, 1, 'EUR:70', 0, 1, 1, 2, 1, 50]
  ]);
  assert.equal(o.primaryCurrency, 'USD', 'ranking currency is the one with the largest amount this month');
  assert.deepEqual(o.total, {added: 3, orders: 5, amounts: [{currency: 'EUR', total: 70}, {currency: 'USD', total: 375}], newDeal: 2, repeat: 1, records: 4, customers: 3, tasksTotal: 5, tasksDone: 3, taskRate: 60, ...NO_OPP});
  assert.deepEqual(o.trend.months, ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  const series = Object.fromEntries(o.trend.series.map(s => [s.id, s.values]));
  assert.deepEqual(Object.keys(series), ['amount:EUR', 'amount:USD', 'repeat', 'newDeal', 'added', 'orders', 'records', 'tasksDone', 'oppWon', 'oppNew']);
  assert.deepEqual(series['amount:USD'], [0, 0, 0, 0, 300, 375]);
  assert.deepEqual(series['amount:EUR'], [0, 0, 0, 0, 0, 70]);
  assert.deepEqual([series.added, series.orders, series.records, series.tasksDone], [[0, 0, 0, 0, 1, 3], [0, 0, 0, 0, 1, 5], [0, 0, 0, 0, 1, 4], [0, 0, 0, 0, 1, 3]]);
  for (const id of ['amount', 'added', 'orders', 'records', 'customers', 'tasksDone']) assert.ok(o.rules[id].length > 8, id);
});

test('overview totals always equal the individual report pages', () => {
  const o = T.overview(state, '2026-10');
  assert.equal(o.total.added, T.report('assets', state, '2026-10').total.added.value);
  assert.equal(o.total.records, T.report('followups', state, '2026-10').total.records.value);
  assert.equal(o.total.tasksDone, T.report('tasks', state, '2026-10').total.done.value);
  assert.deepEqual(o.total.amounts.map(a => a.total), T.report('orders', state, '2026-10').totals.map(t => t.cells.total.value));
  assert.equal(o.members.reduce((sum, m) => sum + m.orders, 0), o.total.orders);
  assert.equal(o.members.reduce((sum, m) => sum + m.added, 0), o.total.added);
});

test('overview with no data or equal currencies stays well defined', () => {
  const empty = T.overview({}, '2026-10');
  assert.deepEqual([empty.members, empty.primaryCurrency, empty.total.amounts, empty.total.taskRate], [[], '', [], null]);
  assert.throws(() => T.overview(state, 'x'), /有效月份/);
  const tie = T.overview({orders: [
    {id: '1', num: 'a', client: 'A', owner: 'Z', amount: 10, currency: 'USD', stage: 'quote', orderMonth: '2026-10'},
    {id: '2', num: 'b', client: 'A', owner: 'Z', amount: 10, currency: 'EUR', stage: 'quote', orderMonth: '2026-10'}]}, '2026-10');
  assert.equal(tie.primaryCurrency, 'EUR', 'equal amounts fall back to currency code order');
  assert.deepEqual(tie.members[0].amounts, [{currency: 'EUR', total: 10}, {currency: 'USD', total: 10}]);
  assert.equal(JSON.stringify(state), snapshot);
});

// ---------------- 季度周期 ----------------
test('quarters are calendar quarters and labels read naturally', () => {
  assert.deepEqual(T.periodMonths('2026-Q4'), ['2026-10', '2026-11', '2026-12']);
  assert.deepEqual(T.periodMonths('2026-Q1'), ['2026-01', '2026-02', '2026-03']);
  assert.deepEqual(T.periodMonths('2026-10'), ['2026-10']);
  assert.deepEqual(['2026-01', '2026-03', '2026-04', '2026-09', '2026-10', '2026-12'].map(T.quarterOf), ['2026-Q1', '2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4', '2026-Q4']);
  assert.deepEqual([T.periodLabel('2026-10'), T.periodLabel('2026-Q4')], ['2026 年 10 月', '2026 年第 4 季度']);
  for (const bad of ['2026-Q5', '2026-Q0', '2026-q4', 'Q4', '', null]) { assert.equal(T.validPeriod(bad), false, String(bad)); assert.throws(() => T.periodMonths(bad), /有效月份/); }
});

test('a quarter adds up its three months, but counts each followed customer once', () => {
  const later = structuredClone(state);
  later.orders.push({id: 'o8', num: 'N1', client: 'Beta Ltd', owner: 'Bob', amount: 10, paidAmount: 0, currency: 'USD', stage: 'quote', orderMonth: '2026-11'});
  later.customers['Beta Ltd'].history.push({type: 'followup', time: '2026-11-05', text: '十一月跟进'});
  later.laiTasks.push({id: 't8', title: '十二月任务', date: '2026-12-01', customer: 'Gamma Inc', done: true});
  const q4 = T.overview(later, '2026-Q4');
  assert.deepEqual([q4.period, q4.periodType, q4.periodLabel, q4.month, q4.months], ['2026-Q4', 'quarter', '2026 年第 4 季度', '2026-12', ['2026-10', '2026-11', '2026-12']]);
  assert.deepEqual(q4.total, {added: 3, orders: 6, amounts: [{currency: 'EUR', total: 70}, {currency: 'USD', total: 385}], newDeal: 2, repeat: 1, records: 5, customers: 3, tasksTotal: 6, tasksDone: 4, taskRate: 67, ...NO_OPP});
  assert.deepEqual(q4.members.find(m => m.owner === 'Amy').customers, 2, 'Beta followed in Oct and Nov is still one customer');
  const q3 = T.overview(later, '2026-Q3');
  assert.deepEqual(q3.total, {added: 1, orders: 1, amounts: [{currency: 'USD', total: 300}], newDeal: 1, repeat: 0, records: 1, customers: 1, tasksTotal: 1, tasksDone: 1, taskRate: 100, ...NO_OPP});
  assert.deepEqual(q4.trend.months.at(-1), '2026-12');
  const month = T.overview(later, '2026-10');
  assert.deepEqual([month.periodType, month.month, month.total.orders], ['month', '2026-10', 5], 'month view is unchanged by later months');
});

// ---------------- 目标 ----------------
test('targets: saved per period, object and metric; completion = actual / target', () => {
  let s = T.setTarget(state, {metric: 'amount', period: '2026-10', scope: 'company', currency: 'usd', value: '500'});
  s = T.setTarget(s, {metric: 'amount', period: '2026-10', scope: 'company', currency: 'EUR', value: 35});
  s = T.setTarget(s, {metric: 'added', period: '2026-10', scope: 'member', owner: ' Amy ', value: 2});
  s = T.setTarget(s, {metric: 'records', period: '2026-10', scope: 'member', owner: 'Zed', value: 4});
  s = T.setTarget(s, {metric: 'orders', period: '2026-Q4', scope: 'company', value: 3});
  assert.equal(state.laiTargets, undefined, 'input state untouched');
  const o = T.overview(s, '2026-10');
  const brief = list => list.map(g => [g.currency, g.value, g.actual, g.rate]);
  assert.deepEqual(brief(o.goals.amount), [['EUR', 35, 70, 200], ['USD', 500, 375, 75]]);
  assert.equal(o.goals.orders, undefined, 'a quarter target does not show in the month view');
  assert.deepEqual(brief(o.members.find(m => m.owner === 'Amy').goals.added), [['', 2, 1, 50]]);
  const zed = o.members.find(m => m.owner === 'Zed');
  assert.deepEqual([zed.added, zed.records, brief(zed.goals.records)], [0, 0, [['', 4, 0, 0]]], 'a member with a target but no activity is still listed');
  assert.deepEqual(o.members.map(m => m.label), ['Amy', 'Bob', 'Zed', '未分配']);
  assert.deepEqual(o.members.find(m => m.owner === 'Bob').goals, {});
  assert.deepEqual(brief(T.overview(s, '2026-Q4').goals.orders), [['', 3, 5, 166]]);
  assert.deepEqual(T.overview(s, '2026-Q4').goals.amount, undefined);
});

test('targets: same key replaces, others stay; removal; unreadable entries are kept untouched', () => {
  const junk = [{junk: 1}, 'x', null, {metric: 'amount', period: '2026-10', owner: null, currency: 'USD', value: -5}];
  let s = T.setTarget({laiTargets: junk, other: 1}, {metric: 'amount', period: '2026-10', scope: 'company', currency: 'USD', value: 500});
  s = T.setTarget(s, {metric: 'amount', period: '2026-10', scope: 'company', currency: 'USD', value: 750});
  s = T.setTarget(s, {metric: 'amount', period: '2026-10', scope: 'member', owner: 'Amy', currency: 'USD', value: 100});
  assert.equal(s.other, 1);
  assert.deepEqual(s.laiTargets.slice(0, 4), junk);
  assert.deepEqual(T.listTargets(s).map(t => [t.owner, t.value]), [[null, 750], ['Amy', 100]]);
  assert.equal(s.laiTargets.length, junk.length + 2, 'replacing a target does not leave the old one behind');
  const key = T.listTargets(s)[0].key;
  const removed = T.removeTarget(s, key);
  assert.deepEqual(T.listTargets(removed).map(t => t.owner), ['Amy']);
  assert.deepEqual(removed.laiTargets.slice(0, 4), junk);
  assert.throws(() => T.removeTarget(removed, key), /不存在/);
  assert.throws(() => T.removeTarget({}, 'x'), /不存在/);
  assert.deepEqual(T.listTargets({}), []); assert.deepEqual(T.listTargets({laiTargets: 'oops'}), []);
});

test('targets: invalid input is rejected with a clear message', () => {
  const ok = {metric: 'added', period: '2026-10', scope: 'company', value: 3};
  const bad = (change, pattern) => assert.throws(() => T.setTarget({}, {...ok, ...change}), pattern, JSON.stringify(change));
  bad({metric: 'customers'}, /可设置目标的指标/); bad({metric: '__proto__'}, /可设置目标的指标/);
  bad({period: '2026-13'}, /目标周期/); bad({period: '2026-Q5'}, /目标周期/);
  bad({scope: 'team'}, /目标对象/); bad({scope: 'member', owner: '  '}, /选择成员/);
  for (const value of ['', ' ', 0, -1, 'abc', null, undefined, true, Infinity, NaN, '0x10', '1e3', '1,000', '１２', [5], {}, '-0', '5.']) bad({value}, /大于 0/);
  bad({metric: 'amount', currency: 'USD', value: '0.001'}, /不能小于 0\.01/);
  bad({scope: 'company', owner: 'Amy'}, /把「对象」改为成员/);
  bad({value: 2.5}, /整数/);
  bad({metric: 'amount', currency: 'US'}, /三位币种/); bad({metric: 'amount'}, /三位币种/);
  assert.equal(T.setTarget({}, {...ok, metric: 'amount', currency: 'usd', value: '1200.50'}).laiTargets[0].value, 1200.5);
  assert.equal(T.setTarget({}, ok).laiTargets[0].owner, null);
});

// ---------------- 独立评审后补充 ----------------
test('completion never rounds up: 199 of 200 is 99% and not reached; exactly on target is reached', () => {
  const order = amount => ({orders: [{id: '1', num: 'a', client: 'A', owner: 'Z', amount, currency: 'USD', stage: 'quote', orderMonth: '2026-10'}]});
  const goal = (amount, target) => T.overview(T.setTarget(order(amount), {metric: 'amount', period: '2026-10', scope: 'company', currency: 'USD', value: target}), '2026-10').goals.amount[0];
  assert.deepEqual([goal(199, 200).rate, goal(199, 200).reached], [99, false]);
  assert.deepEqual([goal(199.99, 200).rate, goal(199.99, 200).reached], [99, false]);
  assert.deepEqual([goal(200, 200).rate, goal(200, 200).reached], [100, true]);
  assert.deepEqual([goal(301, 200).rate, goal(301, 200).reached], [150, true]);
  assert.deepEqual([goal(0, 200).rate, goal(0, 200).reached], [0, false]);
  const floats = {orders: [0.1, 0.2].map((amount, i) => ({id: String(i), num: 'n' + i, client: 'A', owner: 'Z', amount, currency: 'USD', stage: 'quote', orderMonth: '2026-10'}))};
  const sum = T.overview(T.setTarget(floats, {metric: 'amount', period: '2026-10', scope: 'company', currency: 'USD', value: 0.3}), '2026-10').goals.amount[0];
  assert.deepEqual([sum.rate, sum.reached], [100, true], '0.1 + 0.2 against 0.3 counts as reached despite floating point');
});

test('a timestamp just after local midnight on the 1st counts in the new month and shows the local date', () => {
  const saved = process.env.TZ;
  try {
    process.env.TZ = 'Asia/Taipei';
    const instant = '2026-03-31T23:00:00.000Z'; // 2026-04-01 07:00 in Taipei
    assert.equal(T.monthOf(instant), '2026-04');
    const data = {customers: {A: {owner: 'Z', createdAt: instant, history: [{type: 'followup', time: instant, text: 'x'}]}}};
    const april = T.report('assets', data, '2026-04');
    assert.equal(april.total.added.value, 1);
    assert.equal(april.total.added.items[0].meta, '创建于 2026-04-01', 'the detail date matches the month it was counted in');
    assert.equal(T.report('followups', data, '2026-04').total.records.items[0].meta, '2026-04-01');
    assert.equal(T.report('assets', data, '2026-03').total.added.value, 0);
    process.env.TZ = 'America/Los_Angeles';
    assert.equal(T.monthOf('2026-04-01T02:00:00.000Z'), '2026-03', 'and the other way round west of UTC');
    assert.equal(T.monthOf('2026-04-01'), '2026-04', 'date-only values are never shifted');
  } finally { if (saved === undefined) delete process.env.TZ; else process.env.TZ = saved; }
});

test('overwriting a target keeps unknown fields on that entry; a non-list is never overwritten', () => {
  const start = {laiTargets: [{metric: 'added', period: '2026-10', owner: null, currency: '', value: 3, note: 'keep me', id: 'x1'}]};
  const next = T.setTarget(start, {metric: 'added', period: '2026-10', scope: 'company', value: 9});
  assert.deepEqual(next.laiTargets, [{metric: 'added', period: '2026-10', owner: null, currency: '', value: 9, note: 'keep me', id: 'x1'}]);
  assert.equal(start.laiTargets[0].value, 3);
  for (const odd of [{legacy: 1}, 'text', 5]) {
    assert.throws(() => T.setTarget({laiTargets: odd}, {metric: 'added', period: '2026-10', scope: 'company', value: 9}), /格式异常/);
    assert.throws(() => T.removeTarget({laiTargets: odd}, 'k'), /格式异常/);
  }
  assert.equal(T.setTarget({laiTargets: null}, {metric: 'added', period: '2026-10', scope: 'company', value: 9}).laiTargets.length, 1);
});

test('rule text names the period being viewed, and repeated views reuse the computed result', () => {
  assert.match(T.overview(state, '2026-10').rules.added, /本月创建/);
  assert.match(T.overview(state, '2026-Q4').rules.added, /本季度创建/);
  assert.doesNotMatch(T.overview(state, '2026-Q4').rules.amount, /本月/);
  assert.equal(T.overview(state, '2026-10'), T.overview(state, '2026-10'), 'same data and period: no recomputation');
  const changed = {...state, orders: [...state.orders, {id: 'o9', num: 'Z9', client: 'Beta Ltd', owner: 'Bob', amount: 1, currency: 'USD', stage: 'quote', orderMonth: '2026-10'}]};
  assert.equal(T.overview(changed, '2026-10').total.orders, 6, 'new data is never served from the old result');
  assert.equal(T.overview(state, '2026-10').total.orders, 5);
});

// ---------------- 跟进人名称不区分大小写（用户确认） ----------------
test('owner names that differ only by case are one member, shown in the most common spelling', () => {
  const data = {
    customers: {
      A: {owner: 'Amy', createdAt: '2026-10-01', history: [{type: 'followup', time: '2026-10-02', text: 'x'}]},
      B: {owner: 'amy', createdAt: '2026-10-02', history: [{type: 'followup', time: '2026-10-03', text: 'y'}]},
      C: {owner: 'Amy', createdAt: '2026-10-03'},
      D: {owner: ' BOB ', createdAt: '2026-10-04'},
      E: {owner: 'Amy Lin', createdAt: '2026-10-05'}
    },
    orders: [
      {id: '1', num: 'n1', client: 'A', owner: 'AMY', amount: 100, currency: 'USD', stage: 'quote', orderMonth: '2026-10'},
      {id: '2', num: 'n2', client: 'B', owner: 'amy', amount: 50, currency: 'USD', stage: 'quote', orderMonth: '2026-10'},
      {id: '3', num: 'n3', client: 'D', owner: 'bob', amount: 7, currency: 'USD', stage: 'quote', orderMonth: '2026-10'}
    ],
    laiTasks: [{id: 't', title: 'x', date: '2026-10-05', customer: 'B', done: true}]
  };
  const snapshotBefore = JSON.stringify(data);
  const o = T.overview(data, '2026-10');
  assert.deepEqual(o.members.map(m => [m.label, m.added, m.orders, m.amount, m.records, m.tasksDone]), [['Amy', 3, 2, 150, 2, 1], ['Amy Lin', 1, 0, 0, 0, 0], ['BOB', 1, 1, 7, 0, 0]],
    'Amy/amy/AMY merge (Amy is the most common); BOB vs bob is a tie and takes the earlier character order; a different name stays separate');
  assert.deepEqual(T.report('orders', data, '2026-10').rows.map(r => [r.label, r.cells.count.value]), [['Amy', 2], ['BOB', 1]]);
  assert.deepEqual(T.report('assets', data, '2026-10').rows.map(r => [r.label, r.cells.customers.value]), [['Amy', 3], ['Amy Lin', 1], ['BOB', 1]]);
  assert.equal(JSON.stringify(data), snapshotBefore, 'saved names are not rewritten');
});

test('targets follow the same rule: one target per member regardless of case', () => {
  const data = {customers: {A: {owner: 'Amy', createdAt: '2026-10-01'}, B: {owner: 'Amy', createdAt: '2026-10-02'}}};
  let s = T.setTarget(data, {metric: 'added', period: '2026-10', scope: 'member', owner: 'AMY', value: 4});
  assert.deepEqual(T.overview(s, '2026-10').members.map(m => [m.label, m.goals.added?.map(g => [g.value, g.actual, g.rate])]), [['Amy', [[4, 2, 50]]]], 'a target typed as AMY lands on Amy, not on a second empty row');
  s = T.setTarget(s, {metric: 'added', period: '2026-10', scope: 'member', owner: 'amy', value: 2});
  assert.equal(T.listTargets(s).length, 1, 'the second spelling replaces the first target');
  assert.deepEqual(T.overview(s, '2026-10').members[0].goals.added.map(g => [g.value, g.reached]), [[2, true]]);
  const solo = T.setTarget({}, {metric: 'added', period: '2026-10', scope: 'member', owner: 'zed', value: 1});
  assert.deepEqual(T.overview(solo, '2026-10').members.map(m => m.label), ['zed'], 'a member known only from a target keeps the spelling typed');
});

// ---------------- 成交新客户数 / 复购客户数 ----------------
test('every customer who ordered in the period is either a new deal or a repeat, never both', () => {
  const o = T.overview(state, '2026-10');
  // Alpha 首单在 9 月 → 10 月算复购；Beta、Gamma 首单在 10 月 → 成交新客户；草稿订单不算
  assert.deepEqual(o.members.map(m => [m.label, m.newDeal, m.repeat]), [['Amy', 1, 1], ['Bob', 1, 0], ['未分配', 0, 0]]);
  assert.deepEqual([o.total.newDeal, o.total.repeat], [2, 1]);
  const series = Object.fromEntries(o.trend.series.map(s => [s.id, s.values]));
  assert.deepEqual([series.newDeal, series.repeat], [[0, 0, 0, 0, 1, 2], [0, 0, 0, 0, 0, 1]]);
  assert.deepEqual([T.overview(state, '2026-09').total.newDeal, T.overview(state, '2026-09').total.repeat], [1, 0]);
  assert.match(o.rules.newDeal, /第一笔有效订单/); assert.match(o.rules.repeat, /之前已经有过有效订单/);
});

test('new deal vs repeat: edge cases', () => {
  const order = (id, client, month, extra = {}) => ({id, num: id, client, owner: 'Z', amount: 10, currency: 'USD', stage: 'quote', orderMonth: month, ...extra});
  const data = {
    customers: {Trash: {owner: 'Z', laiBucket: 'trash'}, Pool: {owner: '', laiBucket: 'pool'}},
    orders: [
      order('1', 'Twice', '2026-10'), order('2', 'Twice', '2026-10'),            // 同月两单、以前没下过 → 新客户
      order('3', 'Old', '2026-01'), order('4', 'Old', '2026-10'),                // 以前下过 → 复购
      order('5', 'ZeroFirst', '2026-01', {amount: 0}), order('6', 'ZeroFirst', '2026-10'), // 金额 0 的不算有效订单 → 新客户
      order('7', 'DraftFirst', '2026-01', {isDraft: true}), order('8', 'DraftFirst', '2026-10'), // 草稿不算 → 新客户
      order('9', 'Trash', '2026-10'),                                           // 回收站客户不计入
      order('10', 'Pool', '2026-01'), order('11', 'Pool', '2026-10'),            // 公海客户照常计入
      order('12', 'Later', '2026-11'), order('13', 'BadMonth', 'oops')
    ]
  };
  const oct = T.overview(data, '2026-10').total;
  assert.deepEqual([oct.newDeal, oct.repeat], [3, 2]);
  const q4 = T.overview(data, '2026-Q4').total;
  assert.deepEqual([q4.newDeal, q4.repeat], [4, 2], 'in a quarter a customer new in October stays new even if they order again later in the quarter');
  const nov = T.overview(data, '2026-11').total;
  assert.deepEqual([nov.newDeal, nov.repeat], [1, 0]);
  const withTarget = T.setTarget(T.setTarget(data, {metric: 'newDeal', period: '2026-10', scope: 'company', value: 3}), {metric: 'repeat', period: '2026-10', scope: 'company', value: 4});
  const goals = T.overview(withTarget, '2026-10').goals;
  assert.deepEqual([[goals.newDeal[0].rate, goals.newDeal[0].reached], [goals.repeat[0].rate, goals.repeat[0].reached]], [[100, true], [50, false]]);
});

test('names that differ by width, spacing or case are one member; a literal 未分配 is the unassigned row', () => {
  const data = {customers: {
    A: {owner: 'Amy Lin', createdAt: '2026-10-01'}, B: {owner: 'amy  lin', createdAt: '2026-10-02'}, C: {owner: 'Ａｍｙ　Ｌｉｎ', createdAt: '2026-10-03'},
    D: {owner: '未分配', createdAt: '2026-10-04'}, E: {owner: '', createdAt: '2026-10-05'}, F: {owner: ' 未分配 ', createdAt: '2026-10-06'}}};
  assert.deepEqual(T.overview(data, '2026-10').members.map(m => [m.label, m.owner, m.added]), [['Amy Lin', 'Amy Lin', 3], ['未分配', '', 3]]);
  assert.throws(() => T.setTarget(data, {metric: 'added', period: '2026-10', scope: 'member', owner: '未分配', value: 1}), /选择成员/);
  const s = T.setTarget(data, {metric: 'added', period: '2026-10', scope: 'member', owner: 'ＡＭＹ  LIN', value: 6});
  assert.deepEqual(T.overview(s, '2026-10').members[0].goals.added.map(g => [g.value, g.rate]), [[6, 50]]);
});


// ---------------- 商机指标 ----------------
// 手算：2026-10 新建 a b c d f 共 5 个（e 是 9 月建的）；10 月赢单 a(100 USD) c(50 EUR) e(30 USD)；10 月输单 d；
// b 还在进行中；f 是 9 月就赢单的（closedAt 在 9 月），只算 10 月新建，不算 10 月赢单。
const opp = (id, owner, stage, amount, currency, createdAt, closedAt, extra = {}) => ({id, name: id, client: 'Alpha Co', owner, stage, amount, currency, createdAt, ...(closedAt ? {closedAt} : {}), ...extra});
const oppState = {...state, laiOpportunities: [
  opp('a', 'Amy', 'done', 100, 'USD', '2026-10-02T03:00:00.000Z', '2026-10-05T03:00:00.000Z'),
  opp('b', 'amy', 'open', 999, 'USD', '2026-10-03T03:00:00.000Z'),
  opp('c', 'Bob', 'balance', 50, 'EUR', '2026-10-04T03:00:00.000Z', '2026-10-06T03:00:00.000Z', {archived: true}),
  opp('d', 'Bob', 'lost', 70, 'USD', '2026-10-04T03:00:00.000Z', '2026-10-07T03:00:00.000Z'),
  opp('e', 'Zoe', 'done', 30, 'USD', '2026-09-20T03:00:00.000Z', '2026-10-01T03:00:00.000Z'),
  opp('f', '', 'done', 500, 'USD', '2026-10-01T03:00:00.000Z', '2026-09-30T03:00:00.000Z'),
  null, {name: 'no id'}
]};

test('opportunity figures: created, won and lost by month, per owner, currencies kept apart', () => {
  const before = JSON.stringify(oppState);
  const o = T.overview(oppState, '2026-10');
  assert.deepEqual(o.members.map(m => [m.label, m.oppNew, m.oppWon, m.oppLost, m.oppAmounts.map(a => `${a.currency}:${a.total}`).join(','), m.oppWonAmount, m.oppWinRate]), [
    ['Amy', 2, 1, 0, 'USD:100', 100, 100],
    ['Bob', 2, 1, 1, 'EUR:50', 0, 50],
    ['Zoe', 0, 1, 0, 'USD:30', 30, 100],
    ['未分配', 1, 0, 0, '', 0, null]
  ], 'amy and Amy are one person; an owner known only from opportunities still gets a row');
  assert.deepEqual([o.total.oppNew, o.total.oppWon, o.total.oppLost, o.total.oppAmounts, o.total.oppWinRate], [5, 3, 1, [{currency: 'EUR', total: 50}, {currency: 'USD', total: 130}], 75]);
  assert.equal(o.oppCurrency, 'USD', 'ranking uses the currency with the largest won amount');
  const series = Object.fromEntries(o.trend.series.map(s => [s.id, s.values]));
  assert.deepEqual(series['oppWonAmount:USD'], [0, 0, 0, 0, 500, 130]);
  assert.deepEqual(series['oppWonAmount:EUR'], [0, 0, 0, 0, 0, 50]);
  assert.deepEqual(series.oppWon, [0, 0, 0, 0, 1, 3]); assert.deepEqual(series.oppNew, [0, 0, 0, 0, 1, 5]);
  for (const id of ['oppNew', 'oppWon', 'oppWonAmount']) assert.ok(o.rules[id].includes('本月'), id);
  const q = T.overview(oppState, '2026-Q4');
  assert.deepEqual([q.total.oppNew, q.total.oppWon, q.total.oppLost], [5, 3, 1]);
  assert.match(q.rules.oppWon, /本季度/);
  assert.deepEqual([T.overview(oppState, '2026-09').total.oppNew, T.overview(oppState, '2026-09').total.oppWon, T.overview(oppState, '2026-09').total.oppAmounts], [1, 1, [{currency: 'USD', total: 500}]]);
  assert.equal(JSON.stringify(oppState), before, 'reading the figures changes nothing');
});

test('opportunity targets: counts are whole numbers, won amount is set per currency', () => {
  let s = T.setTarget(oppState, {metric: 'oppWonAmount', period: '2026-10', scope: 'company', currency: 'usd', value: '260'});
  s = T.setTarget(s, {metric: 'oppWonAmount', period: '2026-10', scope: 'company', currency: 'EUR', value: 50});
  s = T.setTarget(s, {metric: 'oppWon', period: '2026-10', scope: 'member', owner: 'AMY', value: 2});
  s = T.setTarget(s, {metric: 'oppNew', period: '2026-10', scope: 'company', value: 5});
  const o = T.overview(s, '2026-10');
  assert.deepEqual(o.goals.oppWonAmount.map(g => [g.currency, g.value, g.actual, g.rate, g.reached]), [['EUR', 50, 50, 100, true], ['USD', 260, 130, 50, false]]);
  assert.deepEqual(o.goals.oppNew.map(g => [g.value, g.actual, g.rate, g.reached]), [[5, 5, 100, true]]);
  assert.deepEqual(o.members.find(m => m.owner === 'Amy').goals.oppWon.map(g => [g.value, g.actual, g.rate, g.reached]), [[2, 1, 50, false]]);
  assert.throws(() => T.setTarget(oppState, {metric: 'oppWonAmount', period: '2026-10', scope: 'company', value: 10}), /三位币种代码/);
  assert.throws(() => T.setTarget(oppState, {metric: 'oppWon', period: '2026-10', scope: 'company', value: 1.5}), /整数/);
  assert.deepEqual(T.targetMetrics.slice(-3), ['oppWonAmount', 'oppWon', 'oppNew']);
});
