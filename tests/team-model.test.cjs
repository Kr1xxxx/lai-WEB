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
  assert.deepEqual(o.total, {added: 3, orders: 5, amounts: [{currency: 'EUR', total: 70}, {currency: 'USD', total: 375}], records: 4, customers: 3, tasksTotal: 5, tasksDone: 3, taskRate: 60});
  assert.deepEqual(o.trend.months, ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  const series = Object.fromEntries(o.trend.series.map(s => [s.id, s.values]));
  assert.deepEqual(Object.keys(series), ['amount:EUR', 'amount:USD', 'added', 'orders', 'records', 'tasksDone']);
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
  assert.deepEqual(q4.total, {added: 3, orders: 6, amounts: [{currency: 'EUR', total: 70}, {currency: 'USD', total: 385}], records: 5, customers: 3, tasksTotal: 6, tasksDone: 4, taskRate: 67});
  assert.deepEqual(q4.members.find(m => m.owner === 'Amy').customers, 2, 'Beta followed in Oct and Nov is still one customer');
  const q3 = T.overview(later, '2026-Q3');
  assert.deepEqual(q3.total, {added: 1, orders: 1, amounts: [{currency: 'USD', total: 300}], records: 1, customers: 1, tasksTotal: 1, tasksDone: 1, taskRate: 100});
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
  assert.deepEqual(brief(T.overview(s, '2026-Q4').goals.orders), [['', 3, 5, 167]]);
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
  for (const value of ['', ' ', 0, -1, 'abc', null, undefined, true, Infinity, NaN]) bad({value}, /大于 0/);
  bad({value: 2.5}, /整数/);
  bad({metric: 'amount', currency: 'US'}, /三位币种/); bad({metric: 'amount'}, /三位币种/);
  assert.equal(T.setTarget({}, {...ok, metric: 'amount', currency: 'usd', value: '1200.50'}).laiTargets[0].value, 1200.5);
  assert.equal(T.setTarget({}, ok).laiTargets[0].owner, null);
});
