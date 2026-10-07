'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../src/business-model.js');
const O = require('../src/opportunity-model.js');

function fixture() {
  return O.upsert({ customers: { Synthetic: {} }, orders: [], trashOrders: [] }, 'opp', {
    client: 'Synthetic', owner: 'Amy', amount: '100', currency: 'USD', stage: 'done', endDate: '2026-10-31',
  }, { now: '2026-10-01T12:00:00Z', today: '2026-10-01' });
}
function generate(state, id) {
  const opportunity = O.list(state).find(item => item.id === 'opp');
  return O.linkOrder(B.upsertOrder(state, id, {
    ...O.orderDraft(opportunity, '2026-10-01'), num: id,
  }), 'opp', id);
}

test('archive, regenerate, restore rejects a second active order without changing either record', () => {
  let state = generate(fixture(), 'OLD');
  state = B.archiveOrder(state, 'OLD', '2026-10-02');
  state = generate(state, 'NEW');
  const before = structuredClone(state);
  assert.throws(() => B.restoreOrder(state, 'OLD'), /商机.*NEW.*恢复/);
  assert.deepEqual(state, before);
  assert.deepEqual(state.orders.map(order => order.id), ['NEW']);
  assert.deepEqual(state.trashOrders.map(order => order.id), ['OLD']);
  assert.equal(B.monthlyAnalysis(state.orders, '2026-10').metrics.byCurrency[0].total, 100);
});

test('archiving the replacement permits restoring the original and repairs the active opportunity link', () => {
  let state = generate(fixture(), 'OLD');
  state.orders[0].custom = { keep: true };
  state = B.archiveOrder(state, 'OLD', '2026-10-02');
  state = generate(state, 'NEW');
  state = B.archiveOrder(state, 'NEW', '2026-10-03');
  const before = structuredClone(state);
  const restored = B.restoreOrder(state, 'OLD');
  assert.deepEqual(restored.orders.map(order => order.id), ['OLD']);
  assert.deepEqual(restored.orders[0].custom, { keep: true });
  assert.equal(O.cardOf(restored, 'opp').orderId, 'OLD');
  assert.equal(restored.orders[0].trashedAt, undefined);
  assert.deepEqual(state, before);
  assert.throws(() => B.restoreOrder(restored, 'NEW'), /商机.*OLD.*恢复/);
});

test('regeneration preserves the known source of a legacy archived order before overwriting its pointer', () => {
  let state = generate(fixture(), 'OLD');
  state = B.archiveOrder(state, 'OLD', '2026-10-02');
  delete state.trashOrders[0].sourceOpportunityId;
  state.laiOpportunities.push(null, { future: true });
  const before = structuredClone(state);
  const next = generate(state, 'NEW');
  assert.equal(next.trashOrders[0].sourceOpportunityId, 'opp');
  assert.deepEqual(next.laiOpportunities.slice(1), [null, { future: true }]);
  assert.deepEqual(state, before);
  assert.throws(() => B.restoreOrder(next, 'OLD'), /商机/);
});

test('retained order source still blocks duplicate restoration after its opportunity was removed', () => {
  let state = generate(fixture(), 'OLD');
  state = B.archiveOrder(state, 'OLD', '2026-10-02');
  state = generate(state, 'NEW');
  state = O.remove(state, 'opp');
  assert.throws(() => B.restoreOrder(state, 'OLD'), /商机/);
});

test('stale generation cannot overwrite a live opportunity order link', () => {
  const state = generate(fixture(), 'OLD');
  const before = structuredClone(state);
  assert.throws(() => generate(state, 'NEW'), /商机.*订单/);
  assert.deepEqual(state, before);
});

test('unrelated orders for the same customer do not prevent an ordinary restore', () => {
  let state = generate(fixture(), 'OLD');
  state = B.archiveOrder(state, 'OLD', '2026-10-02');
  state = B.upsertOrder(state, 'INDEPENDENT', { num: 'INDEPENDENT', client: 'Synthetic', amount: 20 });
  const restored = B.restoreOrder(state, 'OLD');
  assert.deepEqual(restored.orders.map(order => order.id), ['OLD', 'INDEPENDENT']);
  assert.equal(O.cardOf(restored, 'opp').orderId, 'OLD');
});

test('an ordinary archived order tolerates unrelated unknown opportunity entries', () => {
  const state = { orders: [], trashOrders: [{ id: 'plain', num: 'PLAIN', amount: 10 }], laiOpportunities: [null, { future: true }] };
  const restored = B.restoreOrder(state, 'plain');
  assert.equal(restored.orders[0].id, 'plain');
  assert.deepEqual(restored.laiOpportunities, [null, { future: true }]);
});

test('restoring an order preserves unrecognized duplicate opportunity records', () => {
  let state = generate(fixture(), 'OLD');
  state = B.archiveOrder(state, 'OLD', '2026-10-02');
  const duplicate = { id: 'opp', orderId: 'unrecognized', future: { keep: true } };
  state.laiOpportunities.push(duplicate);
  const restored = B.restoreOrder(state, 'OLD');
  assert.equal(restored.laiOpportunities[0].orderId, 'OLD');
  assert.deepEqual(restored.laiOpportunities[1], duplicate);
});

test('linking an archived order cannot overwrite its other opportunity source', () => {
  let state = generate(fixture(), 'OLD');
  state = B.archiveOrder(state, 'OLD', '2026-10-02');
  state = O.upsert(state, 'other', { client: 'Synthetic', owner: 'Amy', amount: '10', endDate: '2026-10-31' }, { today: '2026-10-01' });
  const before = structuredClone(state);
  // Remove the current pointer: source information on the archived order is enough.
  delete state.laiOpportunities.find(item => item.id === 'opp').orderId;
  assert.throws(() => O.linkOrder(state, 'other', 'OLD'), /其他商机/);
  assert.equal(state.trashOrders[0].sourceOpportunityId, before.trashOrders[0].sourceOpportunityId);
});
