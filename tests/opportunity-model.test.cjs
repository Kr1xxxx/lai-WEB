// 固定时区：夹具里的时间按台北时间的日期来写；跨时区的行为在文件末尾单独验证。
process.env.TZ = 'Asia/Taipei';
const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../src/opportunity-model.js');

const NOW = '2026-10-06T04:00:00.000Z', TODAY = '2026-10-06';
const base = {
  laiSettings: {defaultOwner: 'Amy', defaultCurrency: 'usd'},
  customers: {
    'Alpha Co': {owner: 'Amy', contacts: ['Ann', 'Bo'], extraContacts: [{id: 'x', contact: 'Cy'}, {id: 'y', contact: 'Ann'}]},
    'Beta Ltd': {owner: 'Bob'},
    'Old Style': {owner: 'Bob', contact: 'Dee'},
    'Gone Inc': {owner: 'Amy', laiBucket: 'trash'},
    'Pool Co': {laiBucket: 'pool'}
  },
  orders: [{id: 'o1', num: 'N1', client: 'Order Only', owner: 'Zed', amount: 5, currency: 'USD', stage: 'quote', orderMonth: '2026-10'}]
};
const input = extra => ({client: 'Alpha Co', contact: 'Ann', amount: '331.74', currency: 'USD', endDate: '2026-11-05', owner: 'Amy', stage: 'open', ...extra});
const add = (state, id, extra, now = NOW) => O.upsert(state, id, input(extra), {now, today: now.slice(0, 10)});
const get = (state, id) => O.list(state).find(item => item.id === id);

test('defaults for a new opportunity follow the reference form', () => {
  assert.deepEqual(O.defaults(base, TODAY), {nameMode: 'auto', name: '', client: '', contact: '', amount: '', endDate: '2026-11-05', flow: 'default', exchangeRate: 100, currency: 'USD',
    stage: 'open', note: '', owner: 'Amy', collaborators: [], tags: [], products: [], lostReason: '', lostNote: '', sources: [], type: '', leadId: '', custom: {}});
  assert.equal(O.addDays('2026-12-15', 30), '2027-01-14');
  assert.equal(O.addDays('2028-02-01', 30), '2028-03-02');
  assert.deepEqual(O.STAGES.map(s => [s.label, s.kind]), [['未成单', 'open'], ['付款未到账', 'open'], ['待付尾款', 'won'], ['已完成', 'won'], ['输单', 'lost']]);
});

test('creating: automatic name, stored fields, input untouched', () => {
  const s1 = add(base, 'a');
  const a = get(s1, 'a');
  assert.equal(a.name, '26100601-Amy', 'date (yymmdd) + two-digit sequence + owner');
  assert.deepEqual([a.client, a.contact, a.amount, a.currency, a.exchangeRate, a.endDate, a.stage, a.owner, a.archived, a.createdAt, a.flow, a.nameMode],
    ['Alpha Co', 'Ann', 331.74, 'USD', 100, '2026-11-05', 'open', 'Amy', false, NOW, 'default', 'auto']);
  assert.deepEqual(a.stageHistory, [{stage: 'open', label: '未成单', at: NOW}]);
  assert.equal(a.closedAt, undefined);
  assert.equal(base.laiOpportunities, undefined);
  const s2 = add(s1, 'b', {owner: 'bob '});
  assert.equal(get(s2, 'b').name, '26100602-bob');
  assert.deepEqual(O.list(s2).map(i => i.id), ['b', 'a'], 'newest first in storage');
  const s3 = add(s2, 'c', {nameMode: 'custom', name: ' 大单 '});
  assert.equal(get(s3, 'c').name, '大单');
  assert.equal(get(add(s3, 'd'), 'd').name, '26100603-Amy', 'custom names do not use up a sequence number');
  const nextDay = add(s3, 'e', {}, '2026-10-07T04:00:00.000Z');
  assert.equal(get(nextDay, 'e').name, '26100701-Amy', 'sequence restarts each day');
});

test('editing keeps the automatic name, creation time and unknown fields', () => {
  let s = add(base, 'a');
  s = {...s, laiOpportunities: [{...s.laiOpportunities[0], legacy: {keep: true}}, 'junk', null]};
  const later = '2026-10-09T01:00:00.000Z';
  const edited = O.upsert(s, 'a', {amount: '500', note: ' 加急 ', owner: 'Bob'}, {now: later, today: '2026-10-09'});
  const a = get(edited, 'a');
  assert.deepEqual([a.name, a.amount, a.note, a.owner, a.createdAt, a.updatedAt, a.client, a.contact], ['26100601-Amy', 500, '加急', 'Bob', NOW, later, 'Alpha Co', 'Ann']);
  assert.deepEqual(a.legacy, {keep: true});
  assert.deepEqual(edited.laiOpportunities.slice(1), ['junk', null], 'unreadable entries are left in place');
  assert.equal(get(s, 'a').amount, 331.74);
});

test('validation: every required field and each relationship rule', () => {
  const bad = (extra, pattern, state = base) => assert.throws(() => add(state, 'x', extra), pattern, JSON.stringify(extra));
  bad({owner: ' '}, /负责人/); bad({owner: '未分配'}, /负责人/);
  bad({client: ''}, /选择客户/); bad({client: 'Nobody'}, /客户不存在/); bad({client: 'Gone Inc', contact: ''}, /客户不存在或已在回收站/);
  bad({contact: ''}, /关联联系人/); bad({contact: 'Dee'}, /不属于所选客户/);
  for (const amount of ['', 'abc', '-1', '1,000', '0x10', '1e3', null]) bad({amount}, /销售金额/);
  bad({currency: 'US'}, /三位币种/);
  bad({currency: 'EUR', exchangeRate: '0'}, /汇率/); bad({currency: 'EUR', exchangeRate: 'x'}, /汇率/);
  for (const endDate of ['', '2026-02-30', '2026/11/05', '2026-13-01']) bad({endDate}, /结束日期/);
  bad({stage: 'nope'}, /销售阶段/); bad({stage: 'lost'}, /输单原因/); bad({stage: 'lost', lostReason: '随便'}, /输单原因/);
  bad({nameMode: 'custom', name: '  '}, /商机名称/);
  bad({products: '螺丝, x'}, /数量/);
  assert.throws(() => O.upsert(base, ' ', input()), /找不到这条商机/);
  assert.throws(() => O.upsert({...base, laiOpportunities: {a: 1}}, 'x', input()), /格式异常/);
  // 允许的情况
  assert.equal(get(add(base, 'x', {amount: '0'}), 'x').amount, 0);
  assert.equal(get(add(base, 'x', {client: 'Beta Ltd', contact: ''}), 'x').contact, '', 'a customer without contacts does not block saving');
  assert.equal(get(add(base, 'x', {client: 'Old Style', contact: 'Dee'}), 'x').contact, 'Dee');
  assert.equal(get(add(base, 'x', {client: 'Order Only', contact: ''}), 'x').client, 'Order Only', 'a customer known only from orders can be chosen');
  assert.equal(get(add(base, 'x', {client: 'Pool Co', contact: ''}), 'x').client, 'Pool Co');
  const eur = get(add(base, 'x', {currency: 'eur', exchangeRate: '108.5'}), 'x');
  assert.deepEqual([eur.currency, eur.exchangeRate], ['EUR', 108.5]);
  assert.equal(get(add(base, 'x', {currency: 'USD', exchangeRate: '55'}), 'x').exchangeRate, 100, 'USD is always 100');
});

test('contacts, customers and owners offered by the form', () => {
  assert.deepEqual(O.contactsOf(base, 'Alpha Co'), ['Ann', 'Bo', 'Cy']);
  assert.deepEqual(O.contactsOf(base, 'Old Style'), ['Dee']);
  assert.deepEqual([O.contactsOf(base, 'Beta Ltd'), O.contactsOf(base, 'Nobody'), O.contactsOf(base, '__proto__')], [[], [], []]);
  assert.deepEqual(O.customerNames(base), ['Alpha Co', 'Beta Ltd', 'Old Style', 'Order Only', 'Pool Co']);
  assert.deepEqual(O.ownerNames(add(base, 'a', {owner: 'Cara'})), ['Amy', 'Bob', 'Cara', 'Zed']);
});

test('an edit may keep a customer that has since been trashed or a contact that was removed', () => {
  let s = add(base, 'a');
  s = {...s, customers: {...s.customers, 'Alpha Co': {owner: 'Amy', contacts: ['Bo'], laiBucket: 'trash'}}};
  assert.equal(get(O.upsert(s, 'a', {amount: '9'}, {now: NOW, today: TODAY}), 'a').amount, 9);
  assert.throws(() => O.upsert(s, 'a', {contact: 'Zed'}, {now: NOW, today: TODAY}), /不属于所选客户/);
});

test('lists: collaborators, tags and products are cleaned', () => {
  const a = get(add(base, 'a', {collaborators: 'Bob， bob、Cara;amy', tags: ' VIP ,大客户,VIP', products: '假睫毛 A, 10, 2.5\n胶水\n\n工具，3'}), 'a');
  assert.deepEqual(a.collaborators, ['Bob', 'Cara'], 'duplicates and the owner are dropped');
  assert.deepEqual(a.tags, ['VIP', '大客户']);
  assert.deepEqual(a.products, [{name: '假睫毛 A', quantity: 10, unitPrice: 2.5}, {name: '胶水', quantity: 1, unitPrice: 0}, {name: '工具', quantity: 3, unitPrice: 0}]);
  assert.equal(O.productsText(a.products), '假睫毛 A, 10, 2.5\n胶水, 1, 0\n工具, 3, 0');
  assert.deepEqual(O.parseProducts(O.productsText(a.products)), a.products, 'the text shown in the form reads back to the same products');
});

test('stage moves: history, close time, lost reason, and coming back', () => {
  let s = add(base, 'a');
  const t1 = '2026-10-10T02:00:00.000Z', t2 = '2026-10-12T02:00:00.000Z', t3 = '2026-10-15T02:00:00.000Z', t4 = '2026-10-20T02:00:00.000Z';
  s = O.moveStage(s, 'a', 'unpaid', {now: t1});
  assert.deepEqual([get(s, 'a').stage, get(s, 'a').closedAt], ['unpaid', undefined]);
  s = O.moveStage(s, 'a', 'balance', {now: t2});
  assert.equal(get(s, 'a').closedAt, t2, 'entering a won stage records the close time');
  s = O.moveStage(s, 'a', 'done', {now: t3});
  assert.equal(get(s, 'a').closedAt, t2, 'moving between won stages keeps the first close time');
  assert.deepEqual(get(s, 'a').stageHistory.map(h => h.stage), ['open', 'unpaid', 'balance', 'done']);
  assert.throws(() => O.moveStage(s, 'a', 'lost', {now: t4}), /输单原因/);
  const lost = O.moveStage(s, 'a', 'lost', {now: t4, lostReason: '价格原因', lostNote: ' 太贵 '});
  assert.deepEqual([get(lost, 'a').stage, get(lost, 'a').lostReason, get(lost, 'a').lostNote, get(lost, 'a').closedAt], ['lost', '价格原因', '太贵', t4]);
  const reopened = O.moveStage(lost, 'a', 'open', {now: t4});
  assert.deepEqual([get(reopened, 'a').lostReason, get(reopened, 'a').closedAt], [undefined, undefined]);
  const same = O.moveStage(s, 'a', 'done', {now: t4});
  assert.equal(get(same, 'a').stageHistory.length, 4, 'moving to the current stage adds no history');
  assert.throws(() => O.moveStage(s, 'a', 'nope'), /销售阶段/);
  assert.throws(() => O.moveStage(s, 'zz', 'done'), /不存在/);
});

test('archive, delete and order link', () => {
  let s = add(add(base, 'a'), 'b');
  s = O.setArchived(s, 'a', true, {now: NOW});
  assert.equal(get(s, 'a').archived, true);
  assert.equal(get(O.setArchived(s, 'a', false, {now: NOW}), 'a').archived, false);
  assert.equal(get(O.linkOrder(s, 'b', ' ord-1 '), 'b').orderId, 'ord-1');
  assert.deepEqual(O.list(O.remove(s, 'a')).map(i => i.id), ['b']);
  for (const fn of [() => O.remove(s, 'zz'), () => O.setArchived(s, 'zz', true), () => O.linkOrder(s, 'zz', 'x')]) assert.throws(fn, /不存在/);
  assert.deepEqual(O.orderDraft({...get(s, 'b'), products: [{name: 'A'}, {name: 'B'}]}, TODAY),
    {client: 'Alpha Co', amount: 331.74, currency: 'USD', owner: 'Amy', stage: 'quote', paidAmount: 0, createdAt: TODAY, orderMonth: '2026-10', note: '由商机「26100602-Amy」生成', productType: 'A、B', items: []});
  assert.deepEqual(O.orderDraft({...get(s, 'b'), products: [{name: 'A', quantity: 10, unitPrice: 2.5}, {name: 'B'}]}, TODAY).items,
    [{productId: '', code: '', name: 'A', model: '', unit: '', qty: 10, price: 2.5}, {productId: '', code: '', name: 'B', model: '', unit: '', qty: 1, price: 0}]);
});

// ---------- 看板与分析：手算 ----------
function sample() {
  let s = base;
  const rows = [
    ['p1', {amount: '331.74', owner: 'Naomi', endDate: '2026-04-02'}, '2026-04-01T03:00:00.000Z', 'open'],
    ['p2', {amount: '925.48', owner: 'naomi', endDate: '2026-12-15'}, '2025-12-15T03:00:00.000Z', 'open'],
    ['p3', {amount: '100', owner: 'Fiona', endDate: '2026-09-30'}, '2026-09-01T03:00:00.000Z', 'done'],
    ['p4', {amount: '200', owner: 'Fiona', endDate: '2026-09-30'}, '2026-09-02T03:00:00.000Z', 'balance'],
    ['p5', {amount: '50', owner: 'Elsa', endDate: '2026-09-30'}, '2026-09-03T03:00:00.000Z', 'lost'],
    ['p6', {amount: '70', owner: 'Elsa', endDate: '2026-10-30', currency: 'EUR', exchangeRate: '108'}, '2026-10-01T03:00:00.000Z', 'open'],
    ['p7', {amount: '40', owner: 'Fiona', endDate: '2026-10-30', tags: 'VIP'}, '2026-10-02T03:00:00.000Z', 'unpaid'],
    ['p8', {amount: '999', owner: 'Fiona', endDate: '2026-10-30'}, '2026-10-03T03:00:00.000Z', 'open']
  ];
  for (const [id, extra, at, stage] of rows) {
    s = add(s, id, extra, at);
    if (stage !== 'open') s = O.moveStage(s, id, stage, {now: at.replace('T03', 'T05'), lostReason: '价格原因'});
  }
  s = O.moveStage(s, 'p3', 'done', {now: '2026-09-11T05:00:00.000Z'});
  return O.setArchived(s, 'p8', true, {now: NOW});
}

test('board: stage counts and amounts, totals, one currency at a time, archived hidden', () => {
  const b = O.board(sample(), {}, TODAY);
  assert.deepEqual([b.currency, b.currencies, b.count, b.otherCurrencyCount], ['USD', ['USD', 'EUR'], 6, 1]);
  assert.deepEqual(b.columns.map(c => [c.label, c.count, Math.round(c.amount * 100) / 100]), [['未成单', 2, 1257.22], ['付款未到账', 1, 40], ['待付尾款', 1, 200], ['已完成', 1, 100], ['输单', 1, 50]]);
  assert.deepEqual(Object.fromEntries(Object.entries(b.totals).map(([k, v]) => [k, Math.round(v * 100) / 100])), {open: 1297.22, won: 300, lost: 50, total: 1597.22}, 'total = in progress + won; lost is not part of it');
  assert.deepEqual(b.columns[0].cards.map(c => [c.id, c.overdue]), [['p1', true], ['p2', false]], 'newest first by default; p1 is past its end date');
  assert.equal(b.columns[4].cards[0].overdue, false, 'closed opportunities are never overdue');
  const eur = O.board(sample(), {currency: 'eur'}, TODAY);
  assert.deepEqual([eur.currency, eur.count, eur.totals.total, eur.otherCurrencyCount], ['EUR', 1, 70, 6]);
  assert.equal(O.board(sample(), {currency: 'JPY'}, TODAY).currency, 'USD', 'an unknown currency falls back to the most used one');
});

test('board: filters and sorting', () => {
  const s = sample(), ids = filters => O.board(s, filters, TODAY).cards.map(c => c.id);
  assert.deepEqual(ids({archived: 'archived'}), ['p8']);
  assert.deepEqual(ids({archived: 'all'}).length, 7);
  assert.deepEqual(ids({owner: 'NAOMI'}), ['p1', 'p2'], 'owner filter ignores case');
  assert.deepEqual(ids({search: 'vip'}), ['p7']);
  assert.deepEqual(ids({search: '2609'}), ['p5', 'p4', 'p3'], 'search matches the name');
  assert.deepEqual(ids({from: '2026-09-02', to: '2026-10-02'}), ['p7', 'p5', 'p4']);
  assert.deepEqual(ids({dateField: 'endDate', from: '2026-10-01'}), ['p7', 'p2']);
  assert.deepEqual(ids({from: 'bad', to: '2026-13-01'}).length, 6, 'invalid dates are ignored, not treated as a filter');
  assert.deepEqual(ids({sort: 'amount-desc'}), ['p2', 'p1', 'p4', 'p3', 'p5', 'p7']);
  assert.deepEqual(ids({sort: 'endDate-asc'}).slice(0, 4), ['p1', 'p3', 'p4', 'p5'], 'equal dates fall back to the name');
  assert.deepEqual(ids({sort: 'createdAt-asc'})[0], 'p2');
  assert.equal(O.board(s, {sort: 'nope'}, TODAY).filters.sort, 'createdAt-desc');
});

test('analysis: stage split, win rate, lost reasons, owners, average days to win', () => {
  const a = O.analysis(sample(), {}, TODAY);
  assert.deepEqual([a.currency, a.otherCurrencyCount], ['USD', 1]);
  assert.deepEqual({...a.summary, openAmount: Math.round(a.summary.openAmount * 100) / 100}, {created: 7, open: 4, won: 2, lost: 1, openAmount: 2296.22, wonAmount: 300, lostAmount: 50, winRate: 66, averageDays: 0});
  assert.deepEqual(a.stages.map(s => [s.label, s.count, s.percent]), [['未成单', 3, 43], ['付款未到账', 1, 14], ['待付尾款', 1, 14], ['已完成', 1, 14], ['输单', 1, 14]]);
  assert.deepEqual(a.lostReasons, [{reason: '价格原因', count: 1, amount: 50}]);
  assert.deepEqual(a.owners.map(o => [o.owner, o.created, o.won, o.lost, o.open, o.wonAmount, o.winRate]), [['Fiona', 4, 2, 0, 2, 300, 100], ['Naomi', 2, 0, 0, 2, 0, null], ['Elsa', 1, 0, 1, 0, 0, 0]]);
  const sept = O.analysis(sample(), {months: ['2026-09']}, TODAY);
  assert.deepEqual([sept.summary.created, sept.summary.won, sept.summary.lost, sept.summary.winRate], [3, 2, 1, 66]);
  const none = O.analysis({}, {}, TODAY);
  assert.deepEqual([none.summary.created, none.summary.winRate, none.summary.averageDays, none.owners, none.lostReasons, none.currency], [0, null, null, [], [], 'USD']);
});

test('average days to win counts whole local days from creation to the first win', () => {
  let s = add(base, 'a', {}, '2026-10-01T03:00:00.000Z');
  s = O.moveStage(s, 'a', 'balance', {now: '2026-10-11T03:00:00.000Z'});
  s = add(s, 'b', {}, '2026-10-01T03:00:00.000Z');
  s = O.moveStage(s, 'b', 'done', {now: '2026-10-06T03:00:00.000Z'});
  assert.equal(O.analysis(s, {}, TODAY).summary.averageDays, 7.5);
});

test('malformed stored data never throws when reading', () => {
  for (const laiOpportunities of [null, 'x', 5, [null, 'x', {}, {id: 5}, {id: 'ok'}]]) {
    const state = {...base, laiOpportunities};
    assert.doesNotThrow(() => { O.board(state, {}, TODAY); O.analysis(state, {}, TODAY); O.ownerNames(state); });
  }
  const odd = O.board({laiOpportunities: [{id: 'ok', amount: 'abc', currency: 'zz', stage: 'weird', endDate: 5}]}, {}, TODAY);
  assert.deepEqual([odd.count, odd.currency, odd.columns[0].count, odd.totals.total], [1, 'USD', 1, 0], 'unknown stage shows in the first column; bad amount counts as 0');
});

// ---------------- 独立评审后补充 ----------------
test('review: automatic numbers ignore custom look-alikes and the item being renamed', () => {
  let s = add(base, 'c1', {nameMode: 'custom', name: '2610061234567-PO'});
  s = add(s, 'c2', {nameMode: 'custom', name: '26100699999999999999999999-PO'});
  s = add(s, 'a1');
  assert.equal(get(s, 'a1').name, '26100601-Amy');
  s = O.upsert(s, 'a1', {nameMode: 'custom', name: '26100601-Amy'}, {now: NOW, today: TODAY});
  s = O.upsert(s, 'a1', {nameMode: 'auto'}, {now: NOW, today: TODAY});
  assert.equal(get(s, 'a1').name, '26100601-Amy', 'switching back to automatic does not count its own old name');
  for (let i = 2; i <= 101; i++) s = add(s, 'n' + i);
  assert.equal(get(s, 'n100').name, '261006100-Amy'); assert.equal(get(s, 'n101').name, '261006101-Amy');
  assert.equal(get(add(base, 'x', {owner: 'A-(b)*'}), 'x').name, '26100601-A-(b)*');
});

test('review: amounts that overflow are rejected; products with extra columns are rejected, unchanged products are kept as stored', () => {
  assert.throws(() => add(base, 'x', {amount: '9'.repeat(400)}), /数值过大/);
  assert.throws(() => add(base, 'x', {amount: '10000000000000000'}), /数值过大/);
  assert.throws(() => add(base, 'x', {products: 'A, 1, 1,000'}), /多于三项/);
  let s = add(base, 'a');
  s = {...s, laiOpportunities: [{...s.laiOpportunities[0], products: [{name: 'A,B', quantity: 2, unitPrice: 3, sku: 'S1'}]}]};
  const text = O.productsText(get(s, 'a').products);
  const kept = O.upsert(s, 'a', {amount: '9', products: text}, {now: NOW, today: TODAY});
  assert.deepEqual(get(kept, 'a').products, [{name: 'A,B', quantity: 2, unitPrice: 3, sku: 'S1'}], 'untouched product text keeps the stored rows, unknown fields included');
  assert.deepEqual(O.productsText([null, 'x', {name: ' A '}]), 'A, 1, 0');
});

test('review: legacy data — an unknown stage or reason does not block other edits or get silently changed', () => {
  let s = add(base, 'a');
  s = {...s, laiOpportunities: [{...s.laiOpportunities[0], stage: 'legacy', closedAt: 'x'}]};
  const edited = O.upsert(s, 'a', {amount: '9', stage: 'legacy'}, {now: NOW, today: TODAY});
  assert.deepEqual([get(edited, 'a').amount, get(edited, 'a').stage, get(edited, 'a').closedAt], [9, 'legacy', 'x']);
  assert.throws(() => O.upsert(s, 'a', {stage: 'nope'}, {now: NOW, today: TODAY}), /销售阶段/);
  let lost = O.moveStage(add(base, 'b'), 'b', 'lost', {now: NOW, lostReason: '价格原因'});
  lost = {...lost, laiOpportunities: [{...lost.laiOpportunities[0], lostReason: '老原因'}]};
  const kept = O.upsert(lost, 'b', {amount: '7', stage: 'lost', lostReason: '老原因', lostNote: '补充'}, {now: NOW, today: TODAY});
  assert.deepEqual([get(kept, 'b').amount, get(kept, 'b').lostReason, get(kept, 'b').lostNote], [7, '老原因', '补充']);
  assert.throws(() => O.upsert(lost, 'b', {stage: 'lost', lostReason: '乱填'}, {now: NOW, today: TODAY}), /输单原因/);
});

test('review: edits must still exist; duplicate ids change only the first entry', () => {
  assert.throws(() => O.upsert(base, 'ghost', input(), {now: NOW, today: TODAY, mustExist: true}), /商机不存在/);
  let s = add(base, 'a');
  s = {...s, laiOpportunities: [s.laiOpportunities[0], {...s.laiOpportunities[0], amount: 777}]};
  const edited = O.upsert(s, 'a', {amount: '10'}, {now: NOW, today: TODAY});
  assert.deepEqual(edited.laiOpportunities.map(i => i.amount), [10, 777]);
  assert.deepEqual(O.moveStage(s, 'a', 'unpaid', {now: NOW}).laiOpportunities.map(i => i.stage), ['unpaid', 'open']);
});

test('review: search uses the same name matching as the owner filter; currency ties prefer the default currency', () => {
  const s = add(add(base, 'a', {owner: 'Amy Lee'}), 'b', {currency: 'EUR', exchangeRate: '108', owner: 'Bob'});
  assert.deepEqual(O.board(s, {search: 'ＡＭＹ  lee', archived: 'all', currency: 'USD'}, TODAY).cards.map(c => c.id), ['a']);
  assert.equal(O.board(s, {}, TODAY).currency, 'USD', 'one USD and one EUR: the default currency wins the tie');
  assert.equal(O.board({...s, laiSettings: {defaultCurrency: 'eur'}}, {}, TODAY).currency, 'EUR');
  assert.equal(O.defaults({laiSettings: {defaultCurrency: 'usdollar'}, orderSettings: {defaultOwner: 'Zed'}}, TODAY).currency, 'USD');
  assert.equal(O.defaults({orderSettings: {defaultOwner: 'Zed', defaultCurrency: 'gbp'}}, TODAY).owner, 'Zed');
  assert.equal(O.defaults({orderSettings: {defaultCurrency: 'gbp'}}, TODAY).currency, 'GBP');
});

test('review: a linked order that is no longer among the orders counts as not linked; cardOf ignores board filters', () => {
  let s = O.moveStage(add(base, 'a'), 'a', 'done', {now: NOW});
  s = O.linkOrder(s, 'a', 'o1');
  assert.equal(O.cardOf(s, 'a', TODAY).orderId, 'o1');
  assert.equal(O.cardOf({...s, orders: []}, 'a', TODAY).orderId, '');
  assert.equal(O.cardOf(s, 'nope', TODAY), null);
  const odd = {laiOpportunities: [{id: 'odd', amount: 5}, {id: 'e', amount: 1, currency: 'EUR'}, {id: 'f', amount: 1, currency: 'EUR'}]};
  assert.equal(O.cardOf(odd, 'odd', TODAY).currency, 'USD');
});

test('review: day boundaries follow the local timezone for naming, range filters and month buckets', () => {
  const saved = process.env.TZ;
  try {
    const late = '2026-10-06T23:30:00.000Z'; // 台北 10-07 07:30；洛杉矶 10-06 16:30
    process.env.TZ = 'Asia/Taipei';
    let s = O.upsert(base, 'a', input(), {now: late});
    assert.equal(get(s, 'a').name, '26100701-Amy');
    assert.deepEqual(O.board(s, {from: '2026-10-07', to: '2026-10-07'}, '2026-10-07').cards.map(c => c.id), ['a'], 'range ends are inclusive');
    assert.deepEqual(O.board(s, {to: '2026-10-06'}, '2026-10-07').cards, []);
    process.env.TZ = 'America/Los_Angeles';
    s = O.upsert(base, 'a', input(), {now: late});
    assert.equal(get(s, 'a').name, '26100601-Amy');
    assert.equal(O.analysis(s, {months: ['2026-10']}, '2026-10-06').summary.created, 1);
    const monthEnd = O.upsert(base, 'b', input(), {now: '2026-11-01T02:00:00.000Z'}); // 洛杉矶仍是 10-31
    assert.equal(O.analysis(monthEnd, {months: ['2026-10']}, '2026-10-31').summary.created, 1);
    assert.equal(O.analysis(monthEnd, {months: ['2026-11']}, '2026-10-31').summary.created, 0);
  } finally { process.env.TZ = saved; }
});

// ---------------- 客户详情页用的客户商机情况 ----------------
test('customer stats: active list, won count and USD amount, win rate, cycle', () => {
  let s = add(base, 'a1', {amount: '100'}, '2026-10-01T04:00:00.000Z');
  s = add(s, 'a2', {amount: '50', note: '第二个'}, '2026-10-03T04:00:00.000Z');
  s = O.moveStage(add(s, 'w1', {amount: '200'}, '2026-09-01T04:00:00.000Z'), 'w1', 'done', {now: '2026-09-11T04:00:00.000Z'});
  s = O.moveStage(add(s, 'w2', {amount: '400'}, '2026-09-01T04:00:00.000Z'), 'w2', 'balance', {now: '2026-09-05T04:00:00.000Z'});
  s = O.moveStage(add(s, 'w3', {amount: '70', currency: 'EUR', exchangeRate: '108'}, '2026-09-01T04:00:00.000Z'), 'w3', 'done', {now: '2026-09-02T04:00:00.000Z'});
  s = O.moveStage(add(s, 'l1', {amount: '9'}, '2026-09-01T04:00:00.000Z'), 'l1', 'lost', {now: '2026-09-02T04:00:00.000Z', lostReason: '价格原因'});
  s = O.setArchived(add(s, 'arch', {amount: '1'}, '2026-10-04T04:00:00.000Z'), 'arch', true, {now: NOW});
  s = add(s, 'other', {client: 'Beta Ltd', contact: '', amount: '999'}, '2026-10-05T04:00:00.000Z');
  const stats = O.customerStats(s, 'Alpha Co', TODAY);
  assert.deepEqual(stats.activeOpportunities.map(c => [c.id, c.amount, c.note]), [['a2', 50, '第二个'], ['a1', 100, '']], 'newest first; archived and other customers are left out');
  // The detail page's 商机 table lists every opportunity of the customer (won, lost and archived too), newest first.
  assert.equal(stats.opportunities.length, 7);
  assert.deepEqual(stats.opportunities.map(c => c.id).sort(), ['a1', 'a2', 'arch', 'l1', 'w1', 'w2', 'w3']);
  assert.ok(stats.opportunities.every(c => c.stageLabel && c.name && c.currency && 'endDate' in c && 'owner' in c));
  assert.deepEqual({...stats, activeOpportunities: null, opportunities: null}, {opportunityAllCount: 7, activeOpportunityCount: 2, opportunityCount: 3, opportunityTotal: 600, opportunityAverage: 300,
    opportunityWinRate: 75, opportunityCycle: 5, activeOpportunities: null, opportunities: null}, 'USD figures ignore the EUR win; win rate 3 of 4; cycle (10 + 4 + 1) / 3');
  assert.deepEqual(O.customerStats(s, 'Nobody', TODAY).opportunities, []);
  assert.deepEqual({...O.customerStats(s, 'Nobody', TODAY), activeOpportunities: null, opportunities: null}, {opportunityAllCount: 0, activeOpportunityCount: 0, opportunityCount: 0, opportunityTotal: null, opportunityAverage: null,
    opportunityWinRate: null, opportunityCycle: null, activeOpportunities: null, opportunities: null});
});


// ---------------- 销售流程与阶段 ----------------
const flowLabels = (state, id = 'default') => O.flowOf(state, id).stages.map(stage => `${stage.label}:${stage.kind}`);

test('flows: the built-in flow is used until something is saved; unreadable entries are skipped but kept', () => {
  assert.deepEqual(O.flowsOf({}).map(f => [f.id, f.label, f.stages.map(s => s.id)]), [['default', '默认销售流程', ['open', 'unpaid', 'balance', 'done', 'lost']]]);
  assert.deepEqual(O.flowsOf(base), O.flowsOf({}));
  const junk = [null, 'x', {id: ''}, {id: 'nolost', stages: [{id: 'a', label: 'A', kind: 'open'}, {id: 'b', label: 'B', kind: 'won'}]},
    {id: 'twolost', stages: [{id: 'a', label: 'A', kind: 'open'}, {id: 'b', label: 'B', kind: 'won'}, {id: 'lost', label: 'L', kind: 'lost'}, {id: 'l2', label: 'L2', kind: 'lost'}]},
    {id: 'ok', label: ' 外贸 ', extra: 1, stages: [{id: 'lost', label: '丢单', kind: 'lost'}, {id: 'w', label: '成交', kind: 'won', color: 'red'}, {id: 'o', label: '询盘', kind: 'open'}, {id: 'o', label: '重复', kind: 'open'}, {id: 'bad', label: '', kind: 'open'}, {id: 'k', label: 'K', kind: 'weird'}]},
    {id: 'ok', label: '重复的流程', stages: []}];
  const s = {...base, laiOpportunityFlows: junk};
  assert.deepEqual(O.flowsOf(s).map(f => [f.id, f.label, f.stages.map(st => `${st.id}:${st.label}`)]), [['default', '默认销售流程', ['open:未成单', 'unpaid:付款未到账', 'balance:待付尾款', 'done:已完成', 'lost:输单']],
    ['twolost', '未命名流程', ['a:A', 'b:B', 'lost:L']], ['ok', '外贸', ['o:询盘', 'w:成交', 'lost:丢单']]], 'a second lost stage (id other than lost) is ignored; stages are shown open → won → lost');
  const renamed = O.renameFlowStage(s, 'ok', 'w', '已成交');
  assert.equal(renamed.laiOpportunityFlows.length, junk.length, 'nothing is dropped when saving');
  assert.deepEqual(renamed.laiOpportunityFlows.slice(0, 5), junk.slice(0, 5));
  assert.deepEqual(renamed.laiOpportunityFlows[5], {id: 'ok', label: '外贸', extra: 1, stages: [{id: 'o', label: '询盘', kind: 'open'}, {id: 'w', label: '已成交', kind: 'won', color: 'red'}, {id: 'lost', label: '丢单', kind: 'lost'},
    {id: 'o', label: '重复', kind: 'open'}, {id: 'bad', label: '', kind: 'open'}, {id: 'k', label: 'K', kind: 'weird'}]}, 'unknown fields survive, and the stage entries that could not be read are kept after the readable ones');
  // 同一个阶段 ID 出现两次：只用第一条，改别的东西时两条各自的内容都不变（不会把第二条的字段抄到第一条上）
  const twice = {laiOpportunityFlows: [{id: 'default', label: 'D', stages: [{id: 'open', label: 'A', kind: 'open', color: 'red'}, {id: 'open', label: 'dup', kind: 'open', color: 'blue'}, 'junk', {id: 'done', label: 'W', kind: 'won'}, {id: 'lost', label: 'L', kind: 'lost'}, {id: 'future', label: 'X', kind: 'paused', extra: 1}]}]};
  const kept = O.renameFlow(twice, 'default', 'D2').laiOpportunityFlows[0];
  assert.deepEqual(kept.stages, [{id: 'open', label: 'A', kind: 'open', color: 'red'}, {id: 'done', label: 'W', kind: 'won'}, {id: 'lost', label: 'L', kind: 'lost'}, {id: 'open', label: 'dup', kind: 'open', color: 'blue'}, 'junk', {id: 'future', label: 'X', kind: 'paused', extra: 1}]);
  assert.deepEqual(O.flowOf({laiOpportunityFlows: [kept]}, 'default').stages.map(st => st.label), ['A', 'W', 'L'], 'reading it again gives the same flow');
  assert.deepEqual(O.removeFlowStage(O.addFlowStage({laiOpportunityFlows: [kept]}, 'default', {label: 'B', kind: 'open'}, {id: 'b'}), 'default', 'b').laiOpportunityFlows[0].stages, kept.stages, 'adding then removing a stage leaves every saved entry as it was');
  assert.deepEqual(Object.keys(O.flowsOf(s)[1]), ['id', 'label', 'stages'], 'the bookkeeping used for saving does not show up on the flow');
  assert.throws(() => O.addFlow({laiOpportunityFlows: {}}, {label: 'x'}), /销售流程格式异常/);
  assert.equal(O.flowOf(s, 'missing').id, 'default'); assert.equal(O.flowOf(s, undefined).id, 'default');
});

test('flows: create, rename and delete, with the rules that protect existing opportunities', () => {
  const before = JSON.stringify(base);
  let s = O.addFlow(base, {label: ' 样品单 '}, {id: 'fs'});
  assert.deepEqual(s.laiOpportunityFlows.map(f => [f.id, f.label]), [['fs', '样品单']], 'the default flow is not written until it is edited');
  assert.deepEqual(flowLabels(s, 'fs'), flowLabels(base), 'a new flow starts as a copy of the default stages');
  assert.throws(() => O.addFlow(s, {label: '样品单'}), /同名/); assert.throws(() => O.addFlow(s, {label: '默认销售流程'}), /同名/);
  assert.throws(() => O.addFlow(s, {label: ''}), /请填写销售流程名称/); assert.throws(() => O.addFlow(s, {label: 'x'.repeat(21)}), /不能超过 20 个字/);
  assert.throws(() => O.addFlow(s, {label: '另一个'}, {id: 'fs'}), /这个销售流程已经存在/);
  assert.match(O.addFlow(s, {label: '自动编号'}).laiOpportunityFlows[1].id, /^f[a-z0-9]+$/);
  s = O.renameFlow(s, 'fs', '样品流程');
  assert.equal(O.flowOf(s, 'fs').label, '样品流程');
  assert.throws(() => O.renameFlow(s, 'fs', '默认销售流程'), /同名/); assert.throws(() => O.renameFlow(s, 'nope', 'x'), /销售流程不存在/);
  s = O.renameFlow(s, 'default', '大货流程');
  assert.deepEqual(s.laiOpportunityFlows.map(f => f.id), ['default', 'fs'], 'editing the default flow saves it, in first place');
  assert.throws(() => O.removeFlow(s, 'default'), /默认销售流程不能删除/);
  const used = add(s, 'x1', {flow: 'fs'});
  assert.throws(() => O.removeFlow(used, 'fs'), /「样品流程」里还有 1 个商机/);
  assert.deepEqual(O.removeFlow(s, 'fs').laiOpportunityFlows.map(f => f.id), ['default']);
  let many = base;
  for (let i = 0; i < 9; i++) many = O.addFlow(many, {label: '流程' + i});
  assert.throws(() => O.addFlow(many, {label: '第十一个'}), /最多保留 10 个销售流程/);
  assert.equal(JSON.stringify(base), before);
});

test('stages: add, rename, reorder within a kind, and the limits', () => {
  let s = O.addFlowStage(base, 'default', {label: '已报价', kind: 'open'}, {id: 'quoted'});
  assert.deepEqual(flowLabels(s), ['未成单:open', '付款未到账:open', '已报价:open', '待付尾款:won', '已完成:won', '输单:lost'], 'a new stage goes to the end of its kind');
  s = O.addFlowStage(s, 'default', {label: '已发货', kind: 'won'}, {id: 'shipped'});
  assert.deepEqual(flowLabels(s).slice(3), ['待付尾款:won', '已完成:won', '已发货:won', '输单:lost']);
  assert.throws(() => O.addFlowStage(s, 'default', {label: '又一个输单', kind: 'lost'}), /固定只有一个输单阶段/);
  assert.throws(() => O.addFlowStage(s, 'default', {label: ' 已报价 ', kind: 'won'}), /同名的阶段/);
  assert.throws(() => O.addFlowStage(s, 'default', {label: 'x', kind: 'open'}, {id: 'lost'}), /这个阶段已经存在/);
  assert.throws(() => O.addFlowStage(s, 'nope', {label: 'x', kind: 'open'}), /销售流程不存在/);
  s = O.moveFlowStage(s, 'default', 'quoted', -1);
  assert.deepEqual(flowLabels(s).slice(0, 3), ['未成单:open', '已报价:open', '付款未到账:open']);
  s = O.moveFlowStage(s, 'default', 'quoted', 1);
  assert.throws(() => O.moveFlowStage(s, 'default', 'quoted', 1), /最后一个阶段/, 'cannot cross into the won stages');
  assert.throws(() => O.moveFlowStage(s, 'default', 'open', -1), /第一个阶段/);
  assert.throws(() => O.moveFlowStage(s, 'default', 'lost', -1), /第一个阶段/);
  s = O.renameFlowStage(s, 'default', 'lost', '丢单');
  assert.equal(flowLabels(s).at(-1), '丢单:lost');
  assert.throws(() => O.renameFlowStage(s, 'default', 'open', '丢单'), /同名的阶段/); assert.throws(() => O.renameFlowStage(s, 'default', 'gone', 'x'), /阶段不存在/);
  let full = base;
  for (let i = 0; i < 7; i++) full = O.addFlowStage(full, 'default', {label: '阶段' + i, kind: 'open'});
  assert.throws(() => O.addFlowStage(full, 'default', {label: '第十三个', kind: 'open'}), /最多 12 个阶段/);
});

test('removing a stage: empty ones go at once, used ones need a destination, and dates follow the kind', () => {
  let s = add(add(add(base, 'a1'), 'a2', {client: 'Beta Ltd', contact: ''}), 'a3');
  s = O.moveStage(s, 'a3', 'balance', {now: '2026-10-07T04:00:00.000Z'});
  s = {...s, laiOpportunities: [...s.laiOpportunities, {id: 'legacy', name: 'L', client: 'Alpha Co', owner: 'Amy', stage: 'unknown-stage', amount: 1, currency: 'USD', createdAt: NOW}]};
  assert.throws(() => O.removeFlowStage(s, 'default', 'lost'), /输单阶段不能删除/);
  assert.throws(() => O.removeFlowStage(s, 'default', 'open'), /「未成单」里还有 3 个商机，请先选择/, 'two real ones plus one whose stage is unknown and so shows in the first column');
  assert.throws(() => O.removeFlowStage(s, 'default', 'open', {moveTo: 'lost'}), /请先选择/, 'cannot dump into lost: a reason is needed for each');
  assert.throws(() => O.removeFlowStage(s, 'default', 'open', {moveTo: 'open'}), /请先选择/);
  const empty = O.removeFlowStage(s, 'default', 'unpaid');
  assert.deepEqual(O.flowOf(empty, 'default').stages.map(st => st.id), ['open', 'balance', 'done', 'lost']);
  assert.deepEqual(empty.laiOpportunities, s.laiOpportunities, 'no opportunity is touched when the stage was empty');
  assert.throws(() => O.removeFlowStage(empty, 'default', 'open'), /至少保留一个进行中阶段/);
  const moved = O.removeFlowStage(s, 'default', 'open', {moveTo: 'done', now: '2026-10-08T04:00:00.000Z'});
  assert.deepEqual(['a1', 'a2', 'legacy', 'a3'].map(id => { const item = get(moved, id); return [item.stage, item.closedAt, item.stageHistory?.at(-1)?.stage]; }),
    [['done', '2026-10-08T04:00:00.000Z', 'done'], ['done', '2026-10-08T04:00:00.000Z', 'done'], ['done', '2026-10-08T04:00:00.000Z', 'done'], ['balance', '2026-10-07T04:00:00.000Z', 'balance']]);
  const wonToWon = O.removeFlowStage(s, 'default', 'balance', {moveTo: 'done', now: '2026-10-09T04:00:00.000Z'});
  assert.equal(get(wonToWon, 'a3').closedAt, '2026-10-07T04:00:00.000Z', 'still won: the original win date stays');
  const wonToOpen = O.removeFlowStage(s, 'default', 'balance', {moveTo: 'open', now: '2026-10-09T04:00:00.000Z'});
  assert.deepEqual([get(wonToOpen, 'a3').stage, Object.hasOwn(get(wonToOpen, 'a3'), 'closedAt')], ['open', false]);
  assert.deepEqual(O.flowSummary(s)[0].stages.map(st => [st.id, st.count]), [['open', 3], ['unpaid', 0], ['balance', 1], ['done', 0], ['lost', 0]]);
});

test('opportunities follow their flow: stage must belong to it, columns and figures use its kinds', () => {
  let s = O.addFlow(base, {label: '样品单'}, {id: 'fs'});
  s = O.addFlowStage(s, 'fs', {label: '寄样中', kind: 'open'}, {id: 'sending'});
  s = O.addFlowStage(s, 'fs', {label: '已确认', kind: 'won'}, {id: 'confirmed'});
  for (const id of ['open', 'unpaid', 'balance', 'done']) s = O.removeFlowStage(s, 'fs', id);
  assert.deepEqual(flowLabels(s, 'fs'), ['寄样中:open', '已确认:won', '输单:lost']);
  s = add(s, 'd1');
  assert.throws(() => add(s, 'n1', {flow: 'fs', stage: 'open'}), /所选销售流程里没有这个阶段|请选择有效的销售阶段/);
  s = add(s, 'n1', {flow: 'fs', stage: 'sending', amount: '10'});
  assert.equal(get(add(s, 'n2', {flow: 'fs', stage: ''}), 'n2').stage, 'sending', 'no stage given: the first stage of that flow');
  assert.equal(get(add(s, 'n3', {flow: 'nope'}), 'n3').flow, 'default', 'an unknown flow falls back to the default one');
  assert.throws(() => O.moveStage(s, 'n1', 'done'), /请选择有效的销售阶段/, 'done belongs to the other flow');
  s = O.moveStage(s, 'n1', 'confirmed', {now: '2026-10-07T04:00:00.000Z'});
  assert.equal(get(s, 'n1').closedAt, '2026-10-07T04:00:00.000Z', 'a custom won stage records the win date');
  assert.deepEqual([O.cardOf(s, 'n1', TODAY).kind, O.cardOf(s, 'n1', TODAY).stageLabel, O.cardOf(s, 'n1', TODAY).flow, O.cardOf(s, 'n1', TODAY).stages.map(st => st.id)], ['won', '已确认', 'fs', ['sending', 'confirmed', 'lost']]);
  // 换流程：阶段必须一起换
  assert.throws(() => O.upsert(s, 'd1', {flow: 'fs'}, {now: NOW, today: TODAY}), /所选销售流程里没有这个阶段/);
  const switched = O.upsert(s, 'd1', {flow: 'fs', stage: 'confirmed'}, {now: '2026-10-08T04:00:00.000Z', today: TODAY});
  assert.deepEqual([get(switched, 'd1').flow, get(switched, 'd1').stage, get(switched, 'd1').closedAt], ['fs', 'confirmed', '2026-10-08T04:00:00.000Z']);
  const main = O.board(s, {}, TODAY), other = O.board(s, {flow: 'fs'}, TODAY);
  assert.deepEqual([main.flow, main.count, main.columns.map(c => c.id), main.flows], ['default', 1, ['open', 'unpaid', 'balance', 'done', 'lost'], [{id: 'default', label: '默认销售流程', count: 1}, {id: 'fs', label: '样品单', count: 1}]]);
  assert.deepEqual([other.flow, other.count, other.columns.map(c => [c.id, c.kind, c.count]), other.totals], ['fs', 1, [['sending', 'open', 0], ['confirmed', 'won', 1], ['lost', 'lost', 0]], {open: 0, won: 10, lost: 0, total: 10}]);
  assert.equal(O.board(s, {flow: 'gone'}, TODAY).flow, 'default');
  const report = O.analysis(s, {flow: 'fs'}, TODAY);
  assert.deepEqual([report.flow, report.summary.created, report.summary.won, report.summary.wonAmount, report.stages.map(st => [st.id, st.count])], ['fs', 1, 1, 10, [['sending', 0], ['confirmed', 1], ['lost', 0]]]);
  assert.deepEqual([O.customerStats(s, 'Alpha Co', TODAY).opportunityCount, O.customerStats(s, 'Alpha Co', TODAY).activeOpportunityCount], [1, 1], 'won in the custom flow counts as won for the customer');
  const T = require('../src/team-model.js');
  const team = T.overview(s, '2026-10').total;
  assert.deepEqual([team.oppNew, team.oppWon, team.oppAmounts], [2, 1, [{currency: 'USD', total: 10}]], 'team figures read the kind from the opportunity\'s own flow');
  assert.equal(O.defaults(O.removeFlowStage(base, 'default', 'open'), TODAY).stage, 'unpaid', 'a new opportunity starts in the first stage that still exists');
});


test('review fixes: an unreadable flow link is kept on edit; labels are counted in characters; invisible names are refused', () => {
  const s = {...base, laiOpportunities: [{id: 'o', flow: 'gone', stage: 'open', owner: 'Amy', client: 'Alpha Co', contact: 'Ann', amount: 1, currency: 'USD', endDate: '2026-11-05', name: 'n', nameMode: 'custom'}]};
  assert.equal(get(O.upsert(s, 'o', {note: 'x'}, {now: NOW, today: TODAY}), 'o').flow, 'gone', 'editing something else does not rewrite the link');
  assert.equal(get(O.upsert(s, 'o', {note: 'x', flow: 'default'}, {now: NOW, today: TODAY}), 'o').flow, 'gone', 'the form submits the flow it was shown in (default); that is not a change of flow');
  assert.equal(get(O.moveStage(s, 'o', 'unpaid', {now: NOW}), 'o').flow, 'gone');
  const withFlow = O.addFlow(s, {label: '样品单'}, {id: 'fs'});
  assert.equal(get(O.upsert(withFlow, 'o', {flow: 'fs', stage: 'open'}, {now: NOW, today: TODAY}), 'o').flow, 'fs', 'choosing a real flow does change it');
  assert.equal(get(O.upsert(withFlow, 'o', {flow: 'nope'}, {now: NOW, today: TODAY}), 'o').flow, 'gone', 'another unknown flow is not a real choice either');
  assert.equal(O.flowOf(O.addFlow(base, {label: '👍🏽'.repeat(6)}, {id: 'e'}), 'e').label, '👍🏽'.repeat(6), 'six emoji are six characters, not twenty-four');
  assert.throws(() => O.addFlow(base, {label: '字'.repeat(21)}), /不能超过 20 个字/);
  assert.throws(() => O.addFlow(base, {label: '​‍﻿'}), /请填写销售流程名称/);
  assert.equal(O.flowOf(O.addFlow(base, {label: '样​品'}, {id: 'z'}), 'z').label, '样品');
  // 看板：其他流程里符合筛选的数量
  let two = add(add(O.addFlow(base, {label: '样品单'}, {id: 'fs'}), 'm1'), 'm2', {flow: 'fs'});
  two = add(two, 'm3', {flow: 'fs', client: 'Beta Ltd', contact: ''});
  assert.deepEqual([O.board(two, {}, TODAY).otherFlowCount, O.board(two, {flow: 'fs'}, TODAY).otherFlowCount, O.board(two, {search: 'Beta'}, TODAY).otherFlowCount, O.board(two, {search: 'Beta'}, TODAY).count], [2, 1, 1, 0]);
});

// ---------------- 附件 ----------------
const FILE = extra => ({name: '报价单.pdf', size: 1024, type: 'application/pdf', fileUrl: '/attachments/opportunities/m1/ab12cd34ef-q.pdf', ...extra});

test('attachments: add, rename, remove keep unknown fields and only touch this opportunity', () => {
  let state = {...add(add(base, 'm1'), 'm2'), keepMe: {a: 1}};
  state.laiOpportunities = state.laiOpportunities.map(item => item.id === 'm1' ? {...item, futureField: {x: 1}, attachments: [{id: 'old', name: '旧', fileUrl: '/attachments/opportunities/m1/x.txt', size: 5, label: '保留'}, 'junk', {id: '', fileUrl: ''}]} : item);
  const before2 = JSON.stringify(get(state, 'm2'));
  state = O.addAttachments(state, 'm1', [FILE({id: 'a1'}), FILE({id: 'a2', name: ' 图 1.PNG ', size: 5, type: 'image/png', fileUrl: '/attachments/opportunities/m1/ab12cd34ee-x.png'})], {now: '2026-10-07T01:00:00.000Z'});
  const item = get(state, 'm1');
  assert.equal(item.attachments.length, 5);                       // 读不懂的条目原样保留
  assert.deepEqual(item.attachments[4], {id: 'a2', name: '图 1.PNG', size: 5, type: 'image/png', fileUrl: '/attachments/opportunities/m1/ab12cd34ee-x.png', uploadedAt: '2026-10-07T01:00:00.000Z'});
  assert.equal(item.attachments[0].label, '保留');
  assert.equal(item.futureField.x, 1);
  assert.equal(item.updatedAt, '2026-10-07T01:00:00.000Z');
  assert.equal(JSON.stringify(get(state, 'm2')), before2);
  assert.deepEqual(state.keepMe, {a: 1});
  assert.deepEqual(O.attachmentsOf(item).map(entry => entry.id), ['old', 'a1', 'a2']);

  const renamed = O.renameAttachment(state, 'm1', 'a1', '  合同 v2.pdf ', {now: '2026-10-07T02:00:00.000Z'});
  assert.equal(O.attachmentsOf(get(renamed, 'm1')).find(entry => entry.id === 'a1').name, '合同 v2.pdf');
  assert.equal(O.attachmentsOf(get(renamed, 'm1')).find(entry => entry.id === 'a1').fileUrl, FILE().fileUrl);
  assert.equal(O.attachmentsOf(get(renamed, 'm1')).find(entry => entry.id === 'old').label, '保留');
  assert.throws(() => O.renameAttachment(state, 'm1', 'a1', '   '), /文件名不能为空/);
  assert.throws(() => O.renameAttachment(state, 'm1', 'a1', 'x.exe'), /可执行/);
  assert.throws(() => O.renameAttachment(state, 'm1', 'zzz', 'x.pdf'), /附件不存在/);

  const removed = O.removeAttachment(renamed, 'm1', 'a1');
  assert.deepEqual(O.attachmentsOf(get(removed, 'm1')).map(entry => entry.id), ['old', 'a2']);
  assert.equal(get(removed, 'm1').attachments.length, 4);
  assert.throws(() => O.removeAttachment(removed, 'm1', 'a1'), /附件不存在/);
  assert.throws(() => O.addAttachments(state, 'nope', [FILE()]), /商机不存在/);
});

test('attachments: limits, blocked types, bad locations and duplicate ids are refused', () => {
  const state = add(base, 'm1');
  const bad = (file, pattern) => assert.throws(() => O.addAttachments(state, 'm1', [file]), pattern);
  bad(FILE({name: '安装.exe'}), /可执行或安装类文件/);
  bad(FILE({name: 'a.pdf.SH'}), /可执行或安装类文件/);
  bad(FILE({name: 'tool.app'}), /可执行或安装类文件/);
  bad(FILE({name: ''}), /文件名不能为空/);
  bad(FILE({size: 0}), /空文件/);
  bad(FILE({size: 20 * 1024 * 1024 + 1}), /超过 20 MB/);
  bad(FILE({size: -1}), /大小无效/);
  bad(FILE({size: 1.5}), /大小无效/);
  bad(FILE({size: 'x'}), /大小无效/);
  bad(FILE({fileUrl: '/attachments/orders/x.pdf'}), /存放位置无效/);
  bad(FILE({fileUrl: '/attachments/opportunities/../orders/x.pdf'}), /存放位置无效/);
  bad(FILE({fileUrl: ''}), /存放位置无效/);
  assert.doesNotThrow(() => O.addAttachments(state, 'm1', [FILE({size: 20 * 1024 * 1024})]));
  assert.throws(() => O.addAttachments(state, 'm1', []), /没有要添加的文件/);
  assert.throws(() => O.addAttachments(state, 'm1', [FILE({id: 'd'}), FILE({id: 'd'})]), /编号重复/);
  const one = O.addAttachments(state, 'm1', [FILE({id: 'd'})]);
  assert.throws(() => O.addAttachments(one, 'm1', [FILE({id: 'd'})]), /编号重复/);
  // 最多 30 个
  const thirty = O.addAttachments(state, 'm1', Array.from({length: 30}, (_, index) => FILE({id: 'n' + index})));
  assert.equal(O.attachmentsOf(get(thirty, 'm1')).length, 30);
  assert.throws(() => O.addAttachments(thirty, 'm1', [FILE({id: 'extra'})]), /最多 30 个附件，现在已有 30 个/);
  assert.throws(() => O.addAttachments(one, 'm1', Array.from({length: 30}, (_, index) => FILE({id: 'z' + index}))), /最多 30 个附件，现在已有 1 个/);
  assert.equal(O.removeAttachment(thirty, 'm1', 'n0') && O.attachmentsOf(get(O.addAttachments(O.removeAttachment(thirty, 'm1', 'n0'), 'm1', [FILE({id: 'again'})]), 'm1')).length, 30);
  // 检查函数本身
  assert.equal(O.checkFile({name: '  a/b.png ', size: 3}), 'a_b.png');
  assert.equal(O.attachmentName('x'.repeat(200) + '.pdf').length, 120);
  assert.ok(O.attachmentName('x'.repeat(200) + '.pdf').endsWith('.pdf'));
  assert.equal(O.previewKind('A.JPG'), 'image');
  assert.equal(O.previewKind('a.svg'), '');
  assert.equal(O.previewKind('a.pdf'), '');
});

test('attachments: cards count them, details list them, filesOf returns the stored files, removing an opportunity leaves no stray state', () => {
  let state = add(add(base, 'm1'), 'm2');
  assert.equal(O.board(state, {}, TODAY).cards.find(card => card.id === 'm1').attachmentCount, 0);
  state = O.addAttachments(state, 'm1', [FILE({id: 'a1'}), FILE({id: 'a2', fileUrl: '/attachments/opportunities/m1/ee-b.pdf'})]);
  state.laiOpportunities = state.laiOpportunities.map(item => item.id === 'm1' ? {...item, attachments: [...item.attachments, 'junk']} : item);
  assert.equal(O.board(state, {}, TODAY).cards.find(card => card.id === 'm1').attachmentCount, 2);
  assert.equal(O.cardOf(state, 'm1', TODAY).attachmentCount, 2);
  assert.deepEqual(O.filesOf(state, 'm1'), [FILE().fileUrl, '/attachments/opportunities/m1/ee-b.pdf']);
  assert.deepEqual(O.filesOf(state, 'm2'), []);
  assert.deepEqual(O.filesOf(state, 'nope'), []);
  const detail = O.detailOf(state, 'm1', TODAY);
  assert.equal(detail.attachments.length, 2);
  assert.equal(detail.flowLabel, '默认销售流程');
  assert.equal(detail.history[0].label, '未成单');
  assert.equal(O.detailOf(state, 'nope', TODAY), null);
  // 归档不动附件；删除商机后文件地址已被调用方取走
  assert.equal(O.attachmentsOf(get(O.setArchived(state, 'm1', true), 'm1')).length, 2);
  assert.equal(get(O.remove(state, 'm1'), 'm1'), undefined);
});

test('detail: stage history, lost reason, products and notes come from the stored opportunity', () => {
  let state = add(base, 'm1', {note: '重点客户', products: 'Lash A, 10, 2.5', tags: 'VIP', collaborators: 'Bob'}, '2026-10-01T02:00:00.000Z');
  state = O.moveStage(state, 'm1', 'balance', {now: '2026-10-02T02:00:00.000Z'});
  state = O.moveStage(state, 'm1', 'lost', {lostReason: '价格原因', lostNote: '太贵', now: '2026-10-03T02:00:00.000Z'});
  const detail = O.detailOf(state, 'm1', TODAY);
  assert.deepEqual(detail.history.map(entry => [entry.label, entry.kind, entry.at]), [['未成单', 'open', '2026-10-01T02:00:00.000Z'], ['待付尾款', 'won', '2026-10-02T02:00:00.000Z'], ['输单', 'lost', '2026-10-03T02:00:00.000Z']]);
  assert.equal(detail.lostReason, '价格原因'); assert.equal(detail.lostNote, '太贵');
  assert.equal(detail.note, '重点客户'); assert.deepEqual(detail.collaborators, ['Bob']); assert.deepEqual(detail.products.map(row => row.name), ['Lash A']);
  assert.equal(detail.closedAt, '2026-10-03T02:00:00.000Z');
});

// ---------------- 手动排序 ----------------
test('manual sort: unranked first (newest first), ranked by sortRank; reorder moves one card without touching others', () => {
  let state = base;
  ['m1', 'm2', 'm3', 'm4'].forEach((id, index) => { state = add(state, id, {}, `2026-10-0${index + 1}T02:00:00.000Z`); });
  const ids = (s, stage = 'open', sort = 'manual', extra = {}) => O.board(s, {sort, ...extra}, TODAY).columns.find(column => column.id === stage).cards.map(card => card.id);
  assert.deepEqual(ids(state), ['m4', 'm3', 'm2', 'm1']);                 // 没排过：新的在前
  const stamp = '2026-10-07T00:00:00.000Z';
  const second = O.reorder(state, 'm1', {before: 'm4', now: stamp});      // m1 放到 m4 前面
  assert.deepEqual(ids(second), ['m1', 'm4', 'm3', 'm2']);
  assert.equal(get(second, 'm1').updatedAt, get(state, 'm1').updatedAt);  // 只调顺序，不改更新时间
  assert.deepEqual(['m1', 'm4', 'm3', 'm2'].map(id => get(second, id).sortRank), [1, 2, 3, 4]);
  const third = O.reorder(second, 'm1', {before: ''});                    // 放到最后
  assert.deepEqual(ids(third), ['m4', 'm3', 'm2', 'm1']);
  const same = O.reorder(third, 'm2', {before: 'm1'});                    // 已经在那里：什么都不变
  assert.deepEqual(ids(same), ['m4', 'm3', 'm2', 'm1']);
  assert.equal(JSON.stringify(O.reorder(same, 'm2', {before: 'm1'})), JSON.stringify(same));
  // 其他排序不受影响
  assert.deepEqual(ids(second, 'open', 'createdAt-desc'), ['m4', 'm3', 'm2', 'm1']);
  assert.deepEqual(ids(second, 'open', 'bogus'), ['m4', 'm3', 'm2', 'm1']);
  assert.equal(O.board(second, {sort: 'manual'}, TODAY).filters.sort, 'manual');
  assert.ok(O.SORTS.some(([id]) => id === 'manual'));
  // 看不见的卡片（被筛掉）保持相对位置
  const searched = O.reorder(second, 'm2', {before: 'm4', now: stamp});
  assert.deepEqual(ids(searched), ['m1', 'm2', 'm4', 'm3']);
  // 找不到 before：放到最后
  assert.deepEqual(ids(O.reorder(second, 'm1', {before: 'ghost'})), ['m4', 'm3', 'm2', 'm1']);
});

test('manual sort: dropping into another column changes stage (with history) and takes the place; lost needs a reason', () => {
  let state = base;
  ['m1', 'm2', 'm3'].forEach((id, index) => { state = add(state, id, {stage: index < 2 ? 'open' : 'unpaid'}, `2026-10-0${index + 1}T02:00:00.000Z`); });
  state = O.reorder(state, 'm1', {before: 'm2'});
  const moved = O.reorder(state, 'm2', {stage: 'unpaid', before: 'm3', now: '2026-10-07T00:00:00.000Z'});
  assert.equal(get(moved, 'm2').stage, 'unpaid');
  assert.deepEqual(get(moved, 'm2').stageHistory.map(entry => entry.stage), ['open', 'unpaid']);
  assert.equal(get(moved, 'm2').updatedAt, '2026-10-07T00:00:00.000Z');
  const col = (s, stage) => O.board(s, {sort: 'manual'}, TODAY).columns.find(column => column.id === stage).cards.map(card => card.id);
  assert.deepEqual(col(moved, 'unpaid'), ['m2', 'm3']);
  assert.deepEqual(col(moved, 'open'), ['m1']);
  assert.throws(() => O.reorder(state, 'm1', {stage: 'lost', before: ''}), /请选择输单原因/);
  const lost = O.reorder(state, 'm1', {stage: 'lost', lostReason: '价格原因'});
  assert.equal(get(lost, 'm1').stage, 'lost'); assert.ok(get(lost, 'm1').closedAt);
  assert.throws(() => O.reorder(state, 'm1', {stage: 'nope'}), /没有这个阶段/);
  assert.throws(() => O.reorder(state, 'zzz', {stage: 'open'}), /商机不存在/);
  // 换阶段后旧的排序号不带过去
  assert.equal(O.moveStage(state, 'm1', 'unpaid').laiOpportunities.find(item => item.id === 'm1').sortRank, undefined);
  // 另一个销售流程里的同名阶段互不影响
  let two = O.addFlow(base, {label: '样品单'}, {id: 'fs'});
  two = add(add(two, 'a', {}, '2026-10-01T02:00:00.000Z'), 'b', {flow: 'fs'}, '2026-10-02T02:00:00.000Z');
  const ranked = O.reorder(two, 'a', {before: ''});
  assert.equal(get(ranked, 'b').sortRank, undefined);
});

test('review fixes: ".." inside a file name is fine, real traversal is not; rename keeps the extension; removing a stage clears manual ranks', () => {
  const state = add(base, 'm1');
  const ok = name => O.addAttachments(state, 'm1', [FILE({fileUrl: '/attachments/opportunities/m1/ab12cd34ef-' + encodeURIComponent(name), name})]);
  assert.doesNotThrow(() => ok('a..b.pdf')); assert.doesNotThrow(() => ok('报告..pdf'));
  for (const url of ['/attachments/opportunities/../x/y.pdf', '/attachments/opportunities/m1/..', '/attachments/opportunities/m1/%2e%2e', '/attachments/opportunities/m1/', '/attachments/opportunities/m1', '/attachments/opportunities/m1/a/b.pdf', '/attachments/opportunities/m1/a%2Fb.pdf', '/attachments/opportunities/m1/a%00.pdf', '/attachments/opportunities/%zz/a.pdf', '/attachments/opportunities/m1/a.pdf?x=1'])
    assert.throws(() => O.addAttachments(state, 'm1', [FILE({fileUrl: url})]), /存放位置无效/, url);
  const withFile = O.addAttachments(state, 'm1', [FILE({id: 'a1'})]);
  assert.throws(() => O.renameAttachment(withFile, 'm1', 'a1', '合同.png'), /不能修改文件的扩展名/);
  assert.throws(() => O.renameAttachment(withFile, 'm1', 'a1', '合同'), /不能修改文件的扩展名/);
  assert.equal(O.attachmentsOf(get(O.renameAttachment(withFile, 'm1', 'a1', '合同.PDF'), 'm1'))[0].name, '合同.PDF');
  let two = add(add(base, 'a', {}, '2026-10-01T02:00:00.000Z'), 'b', {stage: 'unpaid'}, '2026-10-02T02:00:00.000Z');
  two = O.reorder(O.reorder(two, 'a', {before: ''}), 'b', {before: ''});
  assert.equal(get(two, 'a').sortRank, 1);
  const removed = O.removeFlowStage(two, 'default', 'open', {moveTo: 'unpaid'});
  assert.equal(get(removed, 'a').stage, 'unpaid'); assert.equal(Object.hasOwn(get(removed, 'a'), 'sortRank'), false);
  assert.equal(O.reorder(two, 'a', {before: 'a'}), two, 'dropping a card before itself changes nothing');
});
