// "只传改动" (backend applyChanges + model diffState): applying only the changes must leave the database exactly
// as a full save of the same new state would. All data is synthetic.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openStorage } = require('../backend/storage.js');
const M = require('../src/model.js');

function openTemp() {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lai-test-changes-'));
  process.env.LAI_DATA_DIR = path.join(dir, 'data');
  const store = openStorage({ seedFile: path.join(dir, 'missing-seed.json') });
  return { store, dir };
}
const clone = (value) => JSON.parse(JSON.stringify(value));
function baseData() {
  const data = { orders: [], trashOrders: [], deletedOrders: [], customers: {}, trackingLookups: [], laiSettings: { companyName: 'Synthetic' }, previewSegments: [] };
  for (let i = 0; i < 12; i++) {
    data.customers[`C${i}`] = { client: `C${i}`, country: 'US', history: [{ type: 'followup', time: '2026-09-01T10:00:00', text: `n${i}` }] };
    data.orders.push({ id: `o${i}`, num: `N${i}`, client: `C${i % 5}`, amount: 10 + i, stage: 'quote', attachments: i === 3 ? [{ fileUrl: '/attachments/x/a.txt', name: 'a' }] : [], logs: [{ time: '2026-09-01', text: 'created' }] });
  }
  data.trashOrders.push({ id: 't1', num: 'T1', client: 'C1', amount: 1 });
  return data;
}
function saveBoth(full, delta, before, after) {
  const fullSnapshot = full.readSnapshot();
  full.save({ app: 'laicai-lai', version: 'test', data: clone(after) }, { baseRevision: fullSnapshot.revision });
  const diff = M.diffState(M.snapshotState(before), after);
  const deltaSnapshot = delta.readSnapshot();
  delta.saveChanges(diff.changes, { baseRevision: deltaSnapshot.revision });
  return diff;
}

test('delta saves give the same stored data as full saves, over many kinds of edits', () => {
  const a = openTemp(), b = openTemp();
  try {
    const initial = baseData();
    for (const s of [a.store, b.store]) { const snap = s.readSnapshot(); s.save({ app: 'laicai-lai', version: 'test', data: clone(initial) }, { baseRevision: snap.revision }); }
    let current = clone(b.store.readSnapshot().data);
    const edits = [
      (d) => { d.customers.C3.note = 'edited'; },
      (d) => { d.customers.NewCo = { client: 'NewCo', history: [] }; },
      (d) => { delete d.customers.C4; },
      (d) => { d.orders[2].amount = 999; d.orders[2].stage = 'done'; },
      (d) => { d.orders.push({ id: 'n1', num: 'NEW', client: 'C0', amount: 5, logs: [{ time: '2026-10-01', text: 'x' }] }); },
      (d) => { d.orders.splice(1, 1); },
      (d) => { d.orders.reverse(); },
      (d) => { d.trashOrders.push(d.orders.shift()); },
      (d) => { d.orders.push(d.trashOrders.shift()); },
      (d) => { d.orders[0].attachments = [{ fileUrl: '/attachments/y/b.txt', name: 'b' }]; d.orders[0].logs = []; },
      (d) => { d.laiSettings.companyName = 'Changed'; d.newSettingsKey = { a: 1 }; },
      (d) => { delete d.newSettingsKey; },
      (d) => { d.trackingLookups.push({ id: 'l1', trackingNumber: 'T', carrier: 'DHL' }); },
      (d) => { d.customers.C1.history.unshift({ type: 'followup', time: '2026-10-02T09:00:00', text: 'again' }); d.orders.splice(3, 0, { id: 'mid', num: 'MID', client: 'C1' }); },
    ];
    for (const edit of edits) {
      const next = clone(current);
      edit(next);
      saveBoth(a.store, b.store, current, next);
      assert.deepEqual(clone(b.store.readSnapshot().data), clone(a.store.readSnapshot().data), edit.toString());
      current = next;
    }
  } finally {
    a.store.close?.(); b.store.close?.();
    fs.rmSync(a.dir, { recursive: true, force: true }); fs.rmSync(b.dir, { recursive: true, force: true });
  }
});

test('an unchanged state produces no changes, and one edited customer produces exactly one', () => {
  const data = baseData();
  const saved = M.snapshotState(data);
  assert.equal(M.diffState(saved, clone(data)).empty, true);
  const next = clone(data);
  next.customers.C2.note = 'x';
  const { changes } = M.diffState(saved, next);
  assert.deepEqual(Object.keys(changes.customers.set), ['C2']);
  assert.deepEqual(changes.orders, { set: {}, remove: [], sequence: {} });
  assert.deepEqual(changes.appState, {});
});

test('a stale revision is refused and nothing is written', () => {
  const t = openTemp();
  try {
    const snap = t.store.readSnapshot();
    t.store.save({ app: 'laicai-lai', version: 'test', data: clone(baseData()) }, { baseRevision: snap.revision });
    const data = t.store.readSnapshot().data;
    const next = clone(data); next.customers.C0.note = 'late';
    const diff = M.diffState(M.snapshotState(data), next);
    assert.throws(() => t.store.saveChanges(diff.changes, { baseRevision: snap.revision }), (error) => error.status === 409);
    assert.equal(t.store.readSnapshot().data.customers.C0.note, undefined);
  } finally { fs.rmSync(t.dir, { recursive: true, force: true }); }
});

test('changes whose counts do not match are rolled back completely', () => {
  const t = openTemp();
  try {
    const snap = t.store.readSnapshot();
    t.store.save({ app: 'laicai-lai', version: 'test', data: clone(baseData()) }, { baseRevision: snap.revision });
    const before = t.store.readSnapshot();
    const next = clone(before.data); next.customers.Extra = { client: 'Extra' }; next.customers.C0.note = 'half';
    const { changes } = M.diffState(M.snapshotState(before.data), next);
    changes.counts.customers += 5;
    assert.throws(() => t.store.saveChanges(changes, { baseRevision: before.revision }), (error) => error.status === 422);
    const after = t.store.readSnapshot();
    assert.equal(after.revision, before.revision);
    assert.equal(after.data.customers.Extra, undefined);
    assert.equal(after.data.customers.C0.note, undefined);
  } finally { fs.rmSync(t.dir, { recursive: true, force: true }); }
});
