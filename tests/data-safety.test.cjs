'use strict';
// Data safety (advisor review round 2, items A1–A3): a delta save can never drop a whole block of data or blank a
// customer (A1); a database written by a newer 来财 is not opened or changed (A2); shrinking any top-level list by
// more than 5 items makes a before-delete backup first (A3). All data is synthetic; every store lives in a lai-test-*
// temp directory.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { openStorage } = require('../backend/storage.js');
const M = require('../src/model.js');
const clone = value => JSON.parse(JSON.stringify(value));

function fixture(t, { prepare } = {}) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lai-test-data-safety-')), previous = process.env.LAI_DATA_DIR;
  const dataDir = path.join(dir, 'data');
  fs.mkdirSync(dataDir);
  if (prepare) prepare(path.join(dataDir, 'lai-data.sqlite'));
  process.env.LAI_DATA_DIR = dataDir;
  const seedFile = path.join(dir, 'no-seed.json');
  let store = openStorage({ seedFile });
  t.after(() => { repair(); try { store.close(); } catch (_) {} if (previous === undefined) delete process.env.LAI_DATA_DIR; else process.env.LAI_DATA_DIR = previous; fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, dataDir, get store() { return store; }, reopen() { try { store.close(); } catch (_) {} store = openStorage({ seedFile }); } };
}
const backupDir = s => path.join(s.directory, 'backups');
const beforeDelete = s => fs.readdirSync(backupDir(s)).filter(n => n.startsWith('before-delete-') && n.endsWith('.sqlite'));
// Simulated full disk for backups only: moving a finished backup into place fails. repair() puts fs back.
const realRename = fs.renameSync;
function breakBackups(s) { const dir = backupDir(s) + path.sep; fs.renameSync = (from, to) => { if (String(to).startsWith(dir) && String(to).endsWith('.sqlite')) throw Object.assign(new Error('ENOSPC: synthetic disk full'), { code: 'ENOSPC' }); return realRename(from, to); }; }
function repair() { fs.renameSync = realRename; }
// Everything in the database the page can see, plus the metadata table.
function dump(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const out = {};
    for (const table of ['metadata', 'customers', 'orders', 'app_state', 'tracking_lookups']) out[table] = db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all();
    return out;
  } finally { db.close(); }
}
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const incomplete = field => error => error.status === 400 && error.code === 'incomplete_save' && error.field === field && /保存的内容不完整，原数据没有改动/.test(error.message);

function seed(store) {
  const snap = store.readSnapshot();
  for (let i = 0; i < 3; i++) snap.data.customers['C' + i] = { client: 'C' + i, country: 'US', note: 'n' + i };
  snap.data.orders = [{ id: 'o1', num: 'N1', client: 'C0', amount: 10 }];
  snap.data.laiOpportunities = Array.from({ length: 8 }, (_, i) => ({ id: 'p' + i, name: 'Deal ' + i, client: 'C0', amount: i }));
  snap.data.laiTargets = Array.from({ length: 7 }, (_, i) => ({ metric: 'orders', period: '2026-0' + (i + 1), value: i }));
  snap.data.trackingLookups = Array.from({ length: 8 }, (_, i) => ({ id: 'l' + i, trackingNumber: 'T' + i }));
  snap.data.laiSettings = { theme: 'tech', companyName: 'Synthetic' };
  store.save(snap, { baseRevision: snap.revision });
  return store.readSnapshot();
}
const counts = data => ({ orders: data.orders.length, trashOrders: data.trashOrders.length, deletedOrders: data.deletedOrders.length, customers: Object.keys(data.customers).length, trackingLookups: data.trackingLookups.length });

// ---- A1: a delta save never drops a block or blanks a customer ----

test('A1: a delta that removes a settings key is refused before anything is written, like the full save', t => {
  const h = fixture(t);
  const before = seed(h.store);
  const file = path.join(h.dataDir, 'lai-data.sqlite');
  const rows = dump(file);
  const changes = { customers: { set: { C0: { ...before.data.customers.C0, note: 'edited' } }, remove: [] }, appState: {}, removeAppState: ['laiOpportunities'], counts: counts(before.data) };
  assert.throws(() => h.store.saveChanges(changes, { baseRevision: before.revision }), incomplete('laiOpportunities'));
  const after = h.store.readSnapshot();
  assert.equal(after.revision, before.revision, 'the revision did not move');
  assert.deepEqual(after, before, 'nothing in the snapshot changed, not even the customer edit sent along');
  assert.deepEqual(dump(file), rows, 'every row and every metadata value is as it was');
  assert.deepEqual(beforeDelete(h.store), [], 'no before-delete backup was made for a refused save');
});

test('A1: a customer set to null, a string or a list is refused; the customer is not blanked', t => {
  const h = fixture(t);
  const before = seed(h.store);
  const file = path.join(h.dataDir, 'lai-data.sqlite');
  const rows = dump(file);
  for (const bad of [null, 'text', ['C1'], 42]) {
    const changes = { customers: { set: { C1: bad, C2: { ...before.data.customers.C2, note: 'also sent' } }, remove: [] }, appState: {}, removeAppState: [], counts: counts(before.data) };
    assert.throws(() => h.store.saveChanges(changes, { baseRevision: before.revision }), incomplete('customers.C1'), String(bad));
    assert.deepEqual(h.store.readSnapshot(), before);
    assert.deepEqual(dump(file), rows);
  }
  assert.deepEqual(h.store.readSnapshot().data.customers.C1, { client: 'C1', country: 'US', note: 'n1' });
  // Other malformed shapes are refused the same way.
  assert.throws(() => h.store.saveChanges({ customers: { set: 'C1' }, counts: counts(before.data) }, { baseRevision: before.revision }), incomplete('customers'));
  assert.throws(() => h.store.saveChanges({ appState: [], counts: counts(before.data) }, { baseRevision: before.revision }), incomplete('appState'));
  assert.deepEqual(dump(file), rows);
});

test('A1: a settings block sent as undefined or with another type (list → object, object → null) is refused; a real change passes', t => {
  const h = fixture(t);
  const before = seed(h.store);
  const base = { customers: { set: {}, remove: [] }, removeAppState: [], counts: counts(before.data) };
  assert.throws(() => h.store.saveChanges({ ...base, appState: { laiOpportunities: undefined } }, { baseRevision: before.revision }), incomplete('laiOpportunities'));
  assert.throws(() => h.store.saveChanges({ ...base, appState: { laiOpportunities: { a: 1 } } }, { baseRevision: before.revision }), incomplete('laiOpportunities'));
  assert.throws(() => h.store.saveChanges({ ...base, appState: { laiSettings: null } }, { baseRevision: before.revision }), incomplete('laiSettings'));
  assert.throws(() => h.store.saveChanges({ ...base, appState: { laiSettings: [] } }, { baseRevision: before.revision }), incomplete('laiSettings'));
  assert.deepEqual(h.store.readSnapshot(), before);
  // An empty list, a changed object and a brand-new key are real changes.
  h.store.saveChanges({ ...base, appState: { laiTargets: [], laiSettings: { theme: 'pink' }, brandNew: { x: 1 } } }, { baseRevision: before.revision });
  const after = h.store.readSnapshot();
  assert.deepEqual(after.data.laiTargets, []);
  assert.deepEqual(after.data.laiSettings, { theme: 'pink' });
  assert.deepEqual(after.data.brandNew, { x: 1 });
  assert.equal(after.data.laiOpportunities.length, 8, 'untouched blocks stay');
});

test('A1: the refusal comes before the before-delete backup, even when the same request also removes many customers', t => {
  const h = fixture(t);
  let snap = h.store.readSnapshot();
  for (let i = 0; i < 8; i++) snap.data.customers['C' + i] = { client: 'C' + i };
  snap.data.laiTasks = [{ id: 't1' }];
  h.store.save(snap, { baseRevision: snap.revision });
  snap = h.store.readSnapshot();
  const changes = { customers: { set: {}, remove: ['C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6'] }, appState: {}, removeAppState: ['laiTasks'], counts: { ...counts(snap.data), customers: 1 } };
  assert.throws(() => h.store.saveChanges(changes, { baseRevision: snap.revision }), incomplete('laiTasks'));
  assert.deepEqual(beforeDelete(h.store), [], 'no backup was made for a save that was going to be refused');
  assert.deepEqual(h.store.readSnapshot(), snap);
});

test('A1 (page side): a state that lacks a saved key keeps it on the server, and the next save from the same page does not shrink it', t => {
  const h = fixture(t);
  const saved = seed(h.store);
  // What persist() does: complete the new data from the last saved state, diff against the last snapshot, send, adopt.
  let state = clone(saved.data), snapshot = M.snapshotState(state), revision = saved.revision;
  const persist = next => {
    const data = M.completeState(state, next);
    const diff = M.diffState(snapshot, data);
    if (!diff.empty) ({ revision } = h.store.saveChanges(diff.changes, { baseRevision: revision }));
    state = data; snapshot = diff.snapshot;
    return diff;
  };
  // 1. A page bug drops laiOpportunities (and sends another key as undefined) while editing a customer.
  const broken = clone(state); delete broken.laiOpportunities; broken.laiTargets = undefined; broken.customers.C0.note = 'edited';
  const first = persist(broken);
  assert.deepEqual(first.changes.removeAppState, []);
  assert.deepEqual(Object.keys(first.changes.appState), [], 'the missing keys are not sent at all');
  assert.equal(h.store.readSnapshot().data.laiOpportunities.length, 8, 'the server keeps all 8 opportunities');
  assert.equal(h.store.readSnapshot().data.laiTargets.length, 7);
  assert.equal(h.store.readSnapshot().data.customers.C0.note, 'edited', 'the real edit went through');
  assert.equal(state.laiOpportunities.length, 8, 'the page state got the block back');
  // 2. The page then "recreates" the list from a default and adds one item, as code like `state.x || []` + push does.
  const second = persist({ ...state, laiOpportunities: [...(state.laiOpportunities || []), { id: 'p-new', name: 'New' }] });
  assert.equal(second.changes.appState.laiOpportunities.length, 9);
  assert.equal(h.store.readSnapshot().data.laiOpportunities.length, 9, 'nine, not one');
  assert.deepEqual(clone(h.store.readSnapshot().data), clone(state), 'page state and server agree');
  // Without the completion step the second save would have shrunk the list to one item: that is what completeState prevents.
  const naive = { ...clone(state) }; delete naive.laiOpportunities;
  assert.equal([...(naive.laiOpportunities || []), { id: 'x' }].length, 1);
  assert.equal(M.completeState(state, naive).laiOpportunities.length, 9);
  assert.equal(M.completeState(state, state), state, 'nothing missing: the same object comes back');
});

test('A1 (page side): persist() completes the data before diffing, and the diff is fed by that completed object', () => {
  const app = require('./helpers/source.cjs').appSource();
  const start = app.indexOf('async function persist(');
  const body = app.slice(start, app.indexOf('async function', start + 10) > 0 ? app.indexOf('try {\n      return await pending;', start) : app.length);
  assert.ok(body.includes('data = M.completeState(state, data);'), 'persist() completes the data from the last saved state');
  assert.ok(body.indexOf('data = M.completeState(state, data);') < body.indexOf('M.diffState(savedSnapshot, data)'), 'before the diff');
  assert.ok(body.includes('return { diff, data, ...sent };') && body.includes('state = data;'), 'the completed object becomes the page state');
});

// ---- A2: a database written by a newer 来财 is not opened ----

function newerDatabase(file, schemaVersion = '2') {
  const db = new DatabaseSync(file);
  try {
    db.exec(`
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE orders (
        id TEXT PRIMARY KEY, bucket TEXT NOT NULL CHECK(bucket IN ('orders','trashOrders','deletedOrders')), position INTEGER NOT NULL,
        num TEXT NOT NULL DEFAULT '', client TEXT NOT NULL DEFAULT '', country TEXT NOT NULL DEFAULT '', order_month TEXT NOT NULL DEFAULT '',
        stage TEXT NOT NULL DEFAULT '', amount REAL NOT NULL DEFAULT 0, paid_amount REAL NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'USD',
        tracking_number TEXT NOT NULL DEFAULT '', carrier TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '', data_json TEXT NOT NULL
      );
      CREATE TABLE customers (name TEXT PRIMARY KEY, country TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', contact TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '', data_json TEXT NOT NULL);
      CREATE TABLE app_state (key TEXT PRIMARY KEY, data_json TEXT NOT NULL);
      CREATE TABLE tracking_lookups (id TEXT PRIMARY KEY, position INTEGER NOT NULL, tracking_number TEXT NOT NULL DEFAULT '', carrier TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '', data_json TEXT NOT NULL);
      CREATE TABLE future_table (id TEXT PRIMARY KEY, data_json TEXT NOT NULL);
    `);
    const meta = db.prepare('INSERT INTO metadata(key, value) VALUES(?, ?)');
    meta.run('initialized', '1'); meta.run('revision', '12'); meta.run('database_id', 'future-id');
    if (schemaVersion !== null) meta.run('schema_version', schemaVersion);
    db.prepare('INSERT INTO customers(name, data_json) VALUES(?, ?)').run('Future Co', JSON.stringify({ client: 'Future Co', futureField: { nested: true } }));
    db.prepare('INSERT INTO orders(id, bucket, position, num, client, data_json) VALUES(?, ?, ?, ?, ?, ?)').run('f1', 'orders', 0, 'F1', 'Future Co', JSON.stringify({ id: 'f1', num: 'F1' }));
    db.prepare('INSERT INTO app_state(key, data_json) VALUES(?, ?)').run('laiOpportunities', JSON.stringify([{ id: 'p1' }]));
    db.prepare('INSERT INTO future_table(id, data_json) VALUES(?, ?)').run('x', '{}');
  } finally { db.close(); }
}
const schemaTooNew = error => error.status === 503 && error.code === 'schema_too_new' && /更新版本的来财/.test(error.message);

test('A2: a database with schema_version 2 is not opened; open + save attempts change not one byte', t => {
  const h = fixture(t, { prepare: newerDatabase });
  const file = path.join(h.dataDir, 'lai-data.sqlite');
  const bytes = hash(file), rows = dump(file);
  const health = h.store.health();
  assert.equal(health.ok, false);
  assert.equal(health.storageMode, 'error');
  assert.equal(health.storageErrorCode, 'schema_too_new');
  assert.equal(health.storageError, '这份数据是更新版本的来财写的，这个版本打不开，数据没有改动。请换用新版本的来财打开。');
  assert.equal(health.integrity.message, health.storageError);
  assert.throws(() => h.store.readSnapshot(), schemaTooNew);
  assert.throws(() => h.store.save({ data: { orders: [], customers: {} } }, { baseRevision: 12 }), schemaTooNew);
  assert.throws(() => h.store.saveChanges({ customers: { set: { X: {} } }, counts: {} }, { baseRevision: 12 }), schemaTooNew);
  assert.throws(() => h.store.readMailAccount(), schemaTooNew);
  assert.throws(() => h.store.writeMailTemplate({ id: 't', updatedAt: 'now' }), schemaTooNew);
  assert.throws(() => h.store.readImportLog('00000000-0000-0000-0000-000000000000'), schemaTooNew);
  assert.equal(h.store.backup(true).ok, false);
  assert.throws(() => h.store.restoreBackup('manual-20260101-000000.sqlite'), schemaTooNew);
  h.reopen();
  assert.equal(h.store.health().storageErrorCode, 'schema_too_new');
  assert.equal(hash(file), bytes, 'the database file is byte-for-byte as it was');
  assert.deepEqual(dump(file), rows);
  assert.deepEqual(fs.readdirSync(h.dataDir).filter(n => n.startsWith('lai-data.sqlite')), ['lai-data.sqlite'], 'no .failed-* rename, no -wal/-shm left behind');
  assert.equal(fs.existsSync(path.join(h.dataDir, 'sqlite-storage.json')), false, 'the storage marker is not written');
  assert.equal(fs.existsSync(path.join(h.dataDir, 'backup-meta.json')), false);
});

test('A2: a schema_version that is not a positive integer is refused the same way; missing schema_version (an old database) opens as version 1', t => {
  const odd = fixture(t, { prepare: file => newerDatabase(file, 'next') });
  assert.equal(odd.store.health().storageErrorCode, 'schema_too_new');
  const zero = fixture(t, { prepare: file => newerDatabase(file, '0') });
  assert.equal(zero.store.health().storageErrorCode, 'schema_too_new');
  const old = fixture(t, { prepare: file => newerDatabase(file, null) });
  assert.equal(old.store.health().ok, true);
  const snap = old.store.readSnapshot();
  assert.equal(snap.revision, 12);
  assert.deepEqual(snap.data.customers['Future Co'], { client: 'Future Co', futureField: { nested: true } });
  snap.data.customers['Future Co'].note = 'saved by version 1';
  old.store.save(snap, { baseRevision: snap.revision });
  const db = new DatabaseSync(path.join(old.dataDir, 'lai-data.sqlite'), { readOnly: true });
  try {
    assert.equal(db.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get().value, '1', 'the first save of an old database records version 1');
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM future_table').get().c, 1, 'unknown tables are left alone');
  } finally { db.close(); }
});

test('A2: ordinary saves keep schema_version at 1 and never rewrite it', t => {
  const h = fixture(t);
  const file = path.join(h.dataDir, 'lai-data.sqlite');
  const version = () => { const db = new DatabaseSync(file, { readOnly: true }); try { return db.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get()?.value; } finally { db.close(); } };
  assert.equal(version(), '1');
  seed(h.store);
  const snap = h.store.readSnapshot(); snap.data.customers.More = { client: 'More' };
  h.store.save(snap, { baseRevision: snap.revision });
  const again = h.store.readSnapshot();
  h.store.saveChanges({ customers: { set: { More: { client: 'More', note: 'delta' } }, remove: [] }, counts: counts(again.data) }, { baseRevision: again.revision });
  assert.equal(version(), '1');
  const source = fs.readFileSync(path.join(__dirname, '../backend/storage.js'), 'utf8');
  assert.match(source, /if \(!metadataValue\('schema_version', ''\)\) setMetadata\('schema_version', String\(SCHEMA_VERSION\)\)/, 'schema_version is written only when absent');
  assert.doesNotMatch(source, /setMetadata\('schema_version', '1'\)/);
});

// ---- A3: shrinking any top-level list by more than 5 items makes a before-delete backup ----

test('A3: removing 6 opportunities through save-changes makes a before-delete backup; removing 5 does not', t => {
  const h = fixture(t);
  let snap = seed(h.store);
  const delta = (data, key, keep) => ({ customers: { set: {}, remove: [] }, appState: { [key]: data[key].slice(0, keep) }, removeAppState: [], counts: counts(data) });
  // Five of eight: no extra backup.
  h.store.saveChanges(delta(snap.data, 'laiOpportunities', 3), { baseRevision: snap.revision });
  assert.deepEqual(beforeDelete(h.store), []);
  // Put them back, then drop six: one before-delete backup holding the eight.
  snap = h.store.readSnapshot(); snap.data.laiOpportunities = Array.from({ length: 8 }, (_, i) => ({ id: 'p' + i, name: 'Deal ' + i }));
  h.store.save(snap, { baseRevision: snap.revision });
  snap = h.store.readSnapshot();
  h.store.saveChanges(delta(snap.data, 'laiOpportunities', 2), { baseRevision: snap.revision });
  assert.equal(beforeDelete(h.store).length, 1);
  const db = new DatabaseSync(path.join(backupDir(h.store), beforeDelete(h.store)[0]), { readOnly: true });
  try { assert.equal(JSON.parse(db.prepare("SELECT data_json FROM app_state WHERE key = 'laiOpportunities'").get().data_json).length, 8, 'the backup holds the list before the delete'); } finally { db.close(); }
  assert.equal(h.store.readSnapshot().data.laiOpportunities.length, 2);
  // Items without ids count by length: 7 targets → 1 is a loss of 6.
  snap = h.store.readSnapshot();
  h.store.saveChanges(delta(snap.data, 'laiTargets', 1), { baseRevision: snap.revision });
  assert.equal(beforeDelete(h.store).length, 2);
  // Tracking lookups too: 8 → 2.
  snap = h.store.readSnapshot();
  h.store.saveChanges({ customers: { set: {}, remove: [] }, trackingLookups: snap.data.trackingLookups.slice(0, 2), counts: { ...counts(snap.data), trackingLookups: 2 } }, { baseRevision: snap.revision });
  assert.equal(beforeDelete(h.store).length, 3);
  // Replacing items with new ids is a loss too (the old ones are gone), but editing them in place is not.
  snap = h.store.readSnapshot(); snap.data.laiOpportunities = Array.from({ length: 8 }, (_, i) => ({ id: 'q' + i })); h.store.save(snap, { baseRevision: snap.revision });
  snap = h.store.readSnapshot();
  h.store.saveChanges({ customers: { set: {}, remove: [] }, appState: { laiOpportunities: snap.data.laiOpportunities.map(item => ({ ...item, touched: true })) }, counts: counts(snap.data) }, { baseRevision: snap.revision });
  assert.equal(beforeDelete(h.store).length, 3, 'editing eight items in place is not a delete');
  snap = h.store.readSnapshot();
  h.store.saveChanges({ customers: { set: {}, remove: [] }, appState: { laiOpportunities: snap.data.laiOpportunities.map((_, i) => ({ id: 'r' + i })) }, counts: counts(snap.data) }, { baseRevision: snap.revision });
  assert.equal(beforeDelete(h.store).length, 4, 'eight items replaced by eight others: the old eight are gone');
});

test('A3: with backups broken, the shrinking delta is refused with the 503 message and nothing changes; a stale revision skips the backup rule (409)', t => {
  const h = fixture(t);
  const snap = seed(h.store);
  const file = path.join(h.dataDir, 'lai-data.sqlite');
  const rows = dump(file);
  const changes = { customers: { set: {}, remove: [] }, appState: { laiOpportunities: snap.data.laiOpportunities.slice(0, 1) }, removeAppState: [], counts: counts(snap.data) };
  breakBackups(h.store);
  assert.throws(() => h.store.saveChanges(changes, { baseRevision: snap.revision }), e => e.status === 503 && e.code === 'backup_before_delete_failed' && /删除前的备份没有成功，这次改动没有保存/.test(e.message));
  assert.deepEqual(h.store.readSnapshot(), snap);
  assert.deepEqual(dump(file), rows);
  assert.throws(() => h.store.saveChanges(changes, { baseRevision: snap.revision - 1 }), e => e.status === 409);
  assert.deepEqual(beforeDelete(h.store), []);
  repair();
  h.store.saveChanges(changes, { baseRevision: snap.revision });
  assert.equal(beforeDelete(h.store).length, 1);
  assert.equal(h.store.readSnapshot().data.laiOpportunities.length, 1);
});

test('A3: the same rule for full saves: 6 opportunities gone → backup first; broken backups → refused, unchanged', t => {
  const h = fixture(t);
  let snap = seed(h.store);
  snap.data.laiOpportunities = snap.data.laiOpportunities.slice(0, 3);
  h.store.save(snap, { baseRevision: snap.revision });
  assert.deepEqual(beforeDelete(h.store), [], 'five removed: no backup');
  snap = h.store.readSnapshot(); snap.data.laiOpportunities = Array.from({ length: 8 }, (_, i) => ({ id: 'p' + i })); h.store.save(snap, { baseRevision: snap.revision });
  snap = h.store.readSnapshot();
  const file = path.join(h.dataDir, 'lai-data.sqlite');
  const rows = dump(file);
  const shrunk = clone(snap); shrunk.data.laiOpportunities = shrunk.data.laiOpportunities.slice(0, 2);
  breakBackups(h.store);
  assert.throws(() => h.store.save(shrunk, { baseRevision: snap.revision }), e => e.status === 503 && e.code === 'backup_before_delete_failed');
  assert.deepEqual(h.store.readSnapshot(), snap);
  assert.deepEqual(dump(file), rows);
  repair();
  h.store.save(shrunk, { baseRevision: snap.revision });
  assert.equal(beforeDelete(h.store).length, 1);
  assert.equal(h.store.readSnapshot().data.laiOpportunities.length, 2);
  // Tracking lookups through the full save as well.
  snap = h.store.readSnapshot(); snap.data.trackingLookups = snap.data.trackingLookups.slice(0, 1);
  h.store.save(snap, { baseRevision: snap.revision });
  assert.equal(beforeDelete(h.store).length, 2);
  // An incomplete full save is refused before any backup is made.
  snap = h.store.readSnapshot();
  const dropped = clone(snap); delete dropped.data.laiOpportunities; dropped.data.laiTargets = [];
  assert.throws(() => h.store.save(dropped, { baseRevision: snap.revision }), incomplete('laiOpportunities'));
  assert.equal(beforeDelete(h.store).length, 2);
  assert.deepEqual(h.store.readSnapshot(), snap);
});
