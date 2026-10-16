const test = require('node:test');
const assert = require('node:assert/strict');
const RT = require('../src/rate-model.js');
const M = require('../src/model.js');
const S = require('../src/segments.js');
const B = require('../src/business-model.js');

// 汇率设置（R1）：laiSettings.rates.list，每 100 外币折合多少美元；美元固定 100；只能手动填。
const withRates = (state, list) => ({ ...state, laiSettings: { ...(state.laiSettings || {}), rates: { list } } });
const byName = (state) => new Map(M.buildCustomers(state).map((row) => [row.name, row]));

const base = () => ({
  customers: { Euro: {}, Mixed: {}, Plain: {}, Manual: { level: 'B级翡翠客户' } },
  orders: [
    { id: 'e1', client: 'Euro', amount: 1000, paidAmount: 200, currency: 'EUR', stage: 'quote', createdAt: '2026-01-02' },
    { id: 'm1', client: 'Mixed', amount: 500, paidAmount: 500, currency: 'USD', stage: 'deposit', createdAt: '2026-01-03' },
    { id: 'm2', client: 'Mixed', amount: 200, currency: 'GBP', stage: 'done', createdAt: '2026-01-04', shippedAt: '2026-01-05' },
    { id: 'p1', client: 'Plain', amount: 0.1, currency: 'USD', stage: 'quote', createdAt: '2026-01-01' },
    { id: 'p2', client: 'Plain', amount: 0.2, currency: 'USD', stage: 'quote', createdAt: '2026-01-02' },
    { id: 'x1', client: 'Manual', amount: 50, currency: 'EUR', stage: 'quote', createdAt: '2026-01-02' },
  ],
});

test('an empty rate table gives exactly the customer rows of today (no conversion anywhere)', () => {
  const today = base();
  const empty = withRates(base(), []);
  const junk = withRates(base(), [{ code: 'eur?', usd100: 110 }, { code: 'GBP', usd100: 0 }, { code: 'USD', usd100: 7 }, null, 'x']);
  const strip = (rows) => rows.map(({ orders, ...row }) => row);
  const want = strip(M.buildCustomers(today));
  // The laiSettings key itself is copied onto nothing in a row, so the rows must be identical.
  assert.deepEqual(strip(M.buildCustomers(empty)), want);
  assert.deepEqual(strip(M.buildCustomers(junk)), want);
  const rows = byName(empty);
  assert.equal(rows.get('Euro').total, null);
  assert.equal(rows.get('Euro').missingRates, 1);
  assert.equal(rows.get('Euro').displayLevel, '');
  assert.equal(rows.get('Plain').total, 0.1 + 0.2, 'USD-only sums are not rounded, exactly as before');
  const seg = new Map(S.enrich(M.buildCustomers(empty), empty).map((row) => [row.name, row]));
  assert.equal(seg.get('Mixed').firstOrderTotal, null);
});

test('EUR orders convert with the table rate, paid amounts too, and USD stays as it was', () => {
  const state = withRates(base(), [{ code: 'EUR', usd100: 110, updatedAt: '2026-10-01' }]);
  const rows = byName(state);
  assert.equal(rows.get('Euro').total, 1100);
  assert.equal(rows.get('Euro').paid, 220);
  assert.equal(rows.get('Euro').due, 880);
  assert.equal(rows.get('Euro').missingRates, 0);
  assert.equal(rows.get('Mixed').total, null, 'GBP still has no rate');
  assert.equal(rows.get('Mixed').missingRates, 1);
  assert.equal(rows.get('Manual').displayLevel, 'B级翡翠客户', 'a manual level is kept');
  const both = byName(withRates(base(), [{ code: 'EUR', usd100: 110 }, { code: 'gbp', usd100: 127.5 }]));
  assert.equal(both.get('Mixed').total, 755);
  assert.equal(both.get('Mixed').paid, 755, 'a done order counts as paid in full');
  const seg = new Map(S.enrich(M.buildCustomers(withRates(base(), [{ code: 'GBP', usd100: 127.5 }])), withRates(base(), [{ code: 'GBP', usd100: 127.5 }])).map((row) => [row.name, row]));
  assert.equal(seg.get('Mixed').firstOrderTotal, 255, 'the first settled GBP order follows the rate');
});

test('the automatic level uses the converted total and crosses a threshold when the rate changes', () => {
  const state = { customers: { Big: {} }, orders: [{ id: 'b', client: 'Big', amount: 48000, currency: 'EUR', stage: 'quote', createdAt: '2026-01-01' }] };
  assert.equal(byName(state).get('Big').displayLevel, '', 'no rate: level unknown as today');
  assert.equal(byName(withRates(state, [{ code: 'EUR', usd100: 100 }])).get('Big').displayLevel, 'F级青铜客户');
  assert.equal(byName(withRates(state, [{ code: 'EUR', usd100: 110 }])).get('Big').displayLevel, 'B级翡翠客户', '48,000 EUR × 1.1 = 52,800 USD');
  assert.equal(byName(withRates(state, [{ code: 'EUR', usd100: 110 }])).get('Big').total, 52800);
});

test('orders snapshot usdRate when new or when the currency changes; later rate edits do not touch them', () => {
  let state = withRates({ customers: {}, orders: [], laiSettings: {} }, [{ code: 'EUR', usd100: 110 }, { code: 'GBP', usd100: 127 }]);
  state = B.upsertOrder(state, 'o1', { num: 'N1', client: 'Acme', amount: 1000, currency: 'eur' });
  assert.equal(state.orders[0].usdRate, 110);
  state = B.upsertOrder(state, 'o2', { num: 'N2', client: 'Acme', amount: 50, currency: 'USD' });
  assert.equal(Object.hasOwn(state.orders.find((o) => o.id === 'o2'), 'usdRate'), false, 'USD needs no snapshot');
  state = RT.setRate(state, 'EUR', '90');
  state = B.upsertOrder(state, 'o1', { amount: 2000 });
  assert.equal(state.orders.find((o) => o.id === 'o1').usdRate, 110, 'same currency: the snapshot stays');
  assert.equal(byName(state).get('Acme').total, 2200 + 50, 'the snapshot wins over the new table rate');
  state = B.upsertOrder(state, 'o1', { currency: 'GBP' });
  assert.equal(state.orders.find((o) => o.id === 'o1').usdRate, 127);
  state = B.upsertOrder(state, 'o1', { currency: 'JPY' });
  assert.equal(Object.hasOwn(state.orders.find((o) => o.id === 'o1'), 'usdRate'), false, 'no JPY rate: the old GBP snapshot is dropped');
  assert.equal(byName(state).get('Acme').total, null);
});

test('a legacy order without a snapshot uses the current table rate; an empty table never snapshots', () => {
  const legacy = { customers: { Old: {} }, orders: [{ id: 'l', num: 'L1', client: 'Old', amount: 100, currency: 'EUR', stage: 'quote', createdAt: '2026-01-01' }] };
  assert.equal(byName(withRates(legacy, [{ code: 'EUR', usd100: 105 }])).get('Old').total, 105);
  assert.equal(byName(withRates(legacy, [{ code: 'EUR', usd100: 120 }])).get('Old').total, 120);
  const saved = B.upsertOrder(withRates(legacy, [{ code: 'EUR', usd100: 120 }]), 'l', { amount: 200 });
  assert.equal(Object.hasOwn(saved.orders[0], 'usdRate'), false, 'editing a legacy order without changing currency keeps it legacy');
  const fresh = B.upsertOrder({ customers: {}, orders: [] }, 'n', { num: 'N', client: 'C', amount: 5, currency: 'EUR' });
  assert.equal(Object.hasOwn(fresh.orders[0], 'usdRate'), false);
});

test('rates are validated: 3 letters, USD fixed, > 0, at most 6 decimals', () => {
  const state = { laiSettings: { defaultOwner: 'Kris' } };
  const next = RT.setRate(state, 'eur', '108.123456', { now: '2026-10-16', adding: true });
  assert.deepEqual(next.laiSettings.rates.list, [{ code: 'EUR', usd100: 108.123456, updatedAt: '2026-10-16' }]);
  assert.equal(next.laiSettings.defaultOwner, 'Kris');
  assert.throws(() => RT.setRate(next, 'EUR', '1', { adding: true }), /已经设置过/);
  assert.throws(() => RT.setRate(state, 'EU', '1'), /3 个英文字母/);
  assert.throws(() => RT.setRate(state, 'E1R', '1'), /3 个英文字母/);
  assert.throws(() => RT.setRate(state, 'usd', '1'), /美元固定/);
  for (const bad of ['', '0', '-1', 'abc', '1.1234567', '0.0000000']) assert.throws(() => RT.parseRate(bad), /汇率/, bad);
  assert.equal(RT.parseRate(' 1,234.5 '), 1234.5);
  const edited = RT.setRate(next, 'EUR', '110', { now: '2026-10-17' });
  assert.deepEqual(edited.laiSettings.rates.list, [{ code: 'EUR', usd100: 110, updatedAt: '2026-10-17' }]);
  assert.equal(RT.rateFor(edited, 'usd'), 100);
  assert.equal(RT.rateFor(edited, 'eur'), 110);
  assert.equal(RT.rateFor(edited, 'GBP'), null);
  assert.deepEqual(RT.list(edited).map((r) => r.code), ['USD', 'EUR']);
});

test('the CNY column is derived from the CNY row, and is blank without it', () => {
  const state = withRates({}, [{ code: 'EUR', usd100: 108 }, { code: 'CNY', usd100: 14 }]);
  assert.equal(RT.cny100(state, 'CNY'), 100);
  assert.equal(RT.cny100(state, 'USD'), 714.2857);
  assert.equal(RT.cny100(state, 'EUR'), 771.4286);
  assert.equal(RT.cny100(withRates({}, [{ code: 'EUR', usd100: 108 }]), 'EUR'), null);
});

test('a rate cannot be deleted while orders, opportunities or customer defaults use the code', () => {
  const state = withRates({
    customers: { A: { currency: 'GBP' } },
    orders: [{ id: '1', client: 'A', currency: 'EUR', amount: 1 }],
    trashOrders: [{ id: '2', client: 'A', currency: 'JPY', amount: 1 }],
    laiOpportunities: [{ id: 'o', currency: 'AUD' }],
  }, [{ code: 'EUR', usd100: 110 }, { code: 'GBP', usd100: 127 }, { code: 'JPY', usd100: 0.7 }, { code: 'AUD', usd100: 66 }, { code: 'CAD', usd100: 73 }]);
  assert.throws(() => RT.removeRate(state, 'EUR'), /1 笔订单在用 EUR/);
  assert.throws(() => RT.removeRate(state, 'GBP'), /客户的默认币种/);
  assert.throws(() => RT.removeRate(state, 'JPY'), /订单/, 'archived orders count');
  assert.throws(() => RT.removeRate(state, 'AUD'), /商机/);
  assert.throws(() => RT.removeRate(state, 'USD'), /美元/);
  assert.throws(() => RT.removeRate(state, 'CHF'), /没有设置/);
  const next = RT.removeRate(state, 'cad');
  assert.deepEqual(next.laiSettings.rates.list.map((r) => r.code), ['EUR', 'GBP', 'JPY', 'AUD']);
  assert.deepEqual(RT.missing({ ...next, laiSettings: { ...next.laiSettings, rates: { list: [] }, defaultCurrency: 'CHF' } }), ['AUD', 'CHF', 'EUR', 'GBP', 'JPY']);
});

test('an opportunity rate of exactly 100 on a foreign currency means no rate', () => {
  assert.equal(RT.opportunityRate({ currency: 'EUR', exchangeRate: 100 }), null);
  assert.equal(RT.opportunityRate({ currency: 'EUR', exchangeRate: 108 }), 108);
  assert.equal(RT.opportunityRate({ currency: 'USD', exchangeRate: 7 }), 100);
  assert.equal(RT.opportunityRate({ currency: 'EUR' }), null);
});

test('stored() hands out copies, so callers cannot change the cached table', () => {
  const state = withRates({}, [{ code: 'EUR', usd100: 110 }]);
  RT.stored(state)[0].usd100 = 1;
  RT.list(state).push({ code: 'XXX' });
  assert.equal(RT.rateFor(state, 'EUR'), 110);
  assert.equal(RT.list(state).length, 2);
});
