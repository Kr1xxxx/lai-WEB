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
    stage: 'open', note: '', owner: 'Amy', collaborators: [], tags: [], products: [], lostReason: '', lostNote: ''});
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
  assert.deepEqual(a.stageHistory, [{stage: 'open', at: NOW}]);
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
  assert.throws(() => O.upsert(base, ' ', input()), /ID 无效/);
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
    {client: 'Alpha Co', amount: 331.74, currency: 'USD', owner: 'Amy', stage: 'quote', paidAmount: 0, createdAt: TODAY, orderMonth: '2026-10', note: '由商机「26100602-Amy」生成', productType: 'A、B'});
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
