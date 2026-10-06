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
