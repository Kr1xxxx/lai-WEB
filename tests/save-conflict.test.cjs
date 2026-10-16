'use strict';
// A save that meets a version conflict (src/model.js rebaseChanges): the page re-applies its own change onto the
// newest data when nothing it touched changed elsewhere, otherwise it names what changed. All data is synthetic.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/model.js');
const clone = value => JSON.parse(JSON.stringify(value));

function base() {
  return {
    customers: { Acme: { client: 'Acme', note: 'a' }, Bolt: { client: 'Bolt', note: 'b' }, Core: { client: 'Core' } },
    orders: [{ id: 'o1', num: 'N1', client: 'Acme', amount: 1 }, { id: 'o2', num: 'N2', client: 'Bolt', amount: 2 }],
    trashOrders: [], deletedOrders: [], trackingLookups: [],
    laiSettings: { theme: 'pink' }, laiTasks: [{ id: 't1' }],
  };
}
// What the page saved last, what it wants to save now, and what the server has after another window saved.
function scenario(mine, theirs) {
  const saved = base(), next = clone(saved), fresh = clone(saved);
  mine(next); theirs(fresh);
  const diff = M.diffState(M.snapshotState(saved), next);
  return { saved, next, fresh, diff, result: M.rebaseChanges(M.snapshotState(saved), diff.changes, fresh) };
}

test('changes to different customers are combined: mine onto the newest data', () => {
  const { result, fresh } = scenario(d => { d.customers.Acme.note = 'mine'; }, d => { d.customers.Bolt.note = 'theirs'; d.laiTasks.push({ id: 't2' }); });
  assert.equal(result.ok, true);
  assert.equal(result.data.customers.Acme.note, 'mine');
  assert.equal(result.data.customers.Bolt.note, 'theirs', 'the other window\'s edit is kept');
  assert.deepEqual(result.data.laiTasks, fresh.laiTasks);
  // Saving the result against the fresh data changes only my customer.
  const again = M.diffState(M.snapshotState(fresh), result.data);
  assert.deepEqual(Object.keys(again.changes.customers.set), ['Acme']);
  assert.deepEqual(again.changes.appState, {});
});

test('new, removed and reordered orders are re-applied when the other side did not touch orders', () => {
  const { result } = scenario(d => { d.orders.unshift({ id: 'o3', num: 'N3', client: 'Core' }); d.trashOrders.push(d.orders.pop()); delete d.customers.Core; },
    d => { d.customers.Bolt.note = 'theirs'; d.laiSettings.theme = 'orange'; });
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.orders.map(o => o.id), ['o3', 'o1']);
  assert.deepEqual(result.data.trashOrders.map(o => o.id), ['o2']);
  assert.equal(result.data.customers.Core, undefined);
  assert.equal(result.data.laiSettings.theme, 'orange');
});

test('an order edited on both sides is a conflict; content edits elsewhere keep their place', () => {
  const both = scenario(d => { d.orders[0].amount = 10; }, d => { d.orders[0].amount = 20; });
  assert.deepEqual(both.result, { ok: false, conflicts: [{ kind: 'order', id: 'o1', num: 'N1' }] });
  const other = scenario(d => { d.orders[0].amount = 10; }, d => { d.orders[1].amount = 30; });
  assert.equal(other.result.ok, true);
  assert.deepEqual(other.result.data.orders.map(o => [o.id, o.amount]), [['o1', 10], ['o2', 30]]);
});

test('the same customer changed elsewhere, or removed elsewhere, is named', () => {
  assert.deepEqual(scenario(d => { d.customers.Acme.note = 'mine'; }, d => { d.customers.Acme.note = 'theirs'; }).result, { ok: false, conflicts: [{ kind: 'customer', name: 'Acme' }] });
  assert.deepEqual(scenario(d => { d.customers.Acme.note = 'mine'; }, d => { delete d.customers.Acme; }).result.conflicts, [{ kind: 'customer', name: 'Acme' }]);
  assert.deepEqual(scenario(d => { d.customers.New = { client: 'New' }; }, d => { d.customers.New = { client: 'New', other: 1 }; }).result.conflicts, [{ kind: 'customer', name: 'New' }]);
});

test('order lists changed on both sides, the same setting, and tracking lookups are conflicts', () => {
  assert.deepEqual(scenario(d => { d.orders.push({ id: 'a', num: 'A' }); }, d => { d.orders.push({ id: 'b', num: 'B' }); }).result.conflicts.map(c => c.kind), ['orderList']);
  assert.deepEqual(scenario(d => { d.laiSettings.theme = 'orange'; }, d => { d.laiSettings.theme = 'xiaoman'; }).result.conflicts, [{ kind: 'setting', key: 'laiSettings' }]);
  assert.deepEqual(scenario(d => { d.trackingLookups.push({ id: 'l1' }); }, d => { d.trackingLookups.push({ id: 'l2' }); }).result.conflicts, [{ kind: 'lookups' }]);
  const removed = scenario(d => { delete d.laiTasks; }, d => { d.customers.Bolt.note = 'x'; });
  assert.equal(removed.result.ok, true); assert.equal(Object.hasOwn(removed.result.data, 'laiTasks'), false);
});
