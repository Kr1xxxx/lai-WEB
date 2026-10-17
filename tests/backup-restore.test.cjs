'use strict';
// Restoring a backup (backend/storage.js restoreBackup / listBackups, server routes /api/backups and /api/restore).
// All data is synthetic; every store lives in a lai-test-* temp directory.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), net = require('node:net'), crypto = require('node:crypto'), { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { openStorage } = require('../backend/storage.js');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lai-test-restore-')), previous = process.env.LAI_DATA_DIR;
  process.env.LAI_DATA_DIR = path.join(dir, 'live');
  const seedFile = path.join(dir, 'no-seed.json');
  let store = openStorage({ seedFile });
  t.after(() => { repair(); try { store.close(); } catch (_) {} if (previous === undefined) delete process.env.LAI_DATA_DIR; else process.env.LAI_DATA_DIR = previous; fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, get store() { return store; }, restart() { store.close(); store = openStorage({ seedFile }); } };
}
const backupDir = s => path.join(s.directory, 'backups');
const sqliteFiles = s => fs.readdirSync(backupDir(s)).filter(f => f.endsWith('.sqlite')).sort();
const leftovers = s => fs.readdirSync(s.directory).filter(n => n.includes('.restore-'));
function saveCustomers(s, customers, orders) {
  const snap = s.readSnapshot();
  snap.data.customers = customers;
  if (orders) snap.data.orders = orders;
  s.save(snap, { baseRevision: snap.revision });
  return s.readSnapshot();
}
const strip = snap => { const { revision, exportedAt, ...rest } = snap; return { ...rest, data: { ...rest.data } }; };
const realRename = fs.renameSync, realOpen = fs.openSync, realFsync = fs.fsyncSync;
function repair() { fs.renameSync = realRename; fs.openSync = realOpen; fs.fsyncSync = realFsync; }
function rejects(fn, status, code) {
  let error;
  try { fn(); } catch (e) { error = e; }
  assert.ok(error, 'expected an error');
  assert.equal(error.status, status, error.message);
  if (code) assert.equal(error.code, code);
  assert.match(error.message, /[一-鿿]/, 'error messages are in Chinese');
  return error;
}

test('restore brings back the backup, keeps a before-restore backup of the changed data and raises the revision', t => {
  const h = fixture(t);
  const original = saveCustomers(h.store, { Alpha: { country: 'US', note: 'original' } }, [{ id: 'o1', num: 'L-1', client: 'Alpha', amount: 10 }]);
  const manual = h.store.backup(true, 'manual');
  assert.equal(manual.ok, true);
  const manualName = path.basename(manual.file);
  const changed = saveCustomers(h.store, { Alpha: { country: 'US', note: 'changed' }, Beta: { country: 'DE' } });
  const revisionBefore = changed.revision;

  const listed = h.store.listBackups();
  assert.deepEqual(listed.map(b => [b.name, b.kind, b.customers, b.orders, b.ok]), [[manualName, 'manual', 1, 1, true]]);
  assert.ok(listed[0].size > 0);
  assert.ok(!Number.isNaN(Date.parse(listed[0].time)));

  const result = h.store.restoreBackup(manualName);
  assert.equal(result.ok, true);
  assert.equal(result.restoredFrom, manualName);
  assert.match(result.beforeRestore, /^before-restore-\d{8}-\d{6}(?:-\d+)?\.sqlite$/);
  assert.ok(result.revision > revisionBefore, 'the revision goes up after a restore');

  const restored = h.store.readSnapshot();
  assert.equal(restored.revision, result.revision);
  assert.deepEqual(strip(restored), strip(original), 'the data equals the backup');

  // The before-restore backup holds the data from just before the restore.
  const db = new DatabaseSync(path.join(backupDir(h.store), result.beforeRestore), { readOnly: true });
  try {
    assert.deepEqual(db.prepare('SELECT name FROM customers ORDER BY name').all().map(r => r.name), ['Alpha', 'Beta']);
    assert.equal(JSON.parse(db.prepare("SELECT data_json FROM customers WHERE name = 'Alpha'").get().data_json).note, 'changed');
  } finally { db.close(); }
  const kinds = h.store.listBackups().map(b => b.kind);
  assert.deepEqual(kinds, ['before-restore', 'manual']);

  // A page still holding the old revision gets the normal conflict instead of overwriting the restored data.
  rejectsConflict(() => h.store.save({ ...changed, data: { ...changed.data, customers: { Gamma: {} } } }, { baseRevision: revisionBefore }));
  rejectsConflict(() => h.store.saveChanges({ customers: { set: { Gamma: {} } }, counts: {} }, { baseRevision: revisionBefore }));
  assert.deepEqual(Object.keys(h.store.readSnapshot().data.customers), ['Alpha']);

  // Saving on top of the restored revision works, and the restore survives a restart.
  const next = saveCustomers(h.store, { Alpha: { country: 'US', note: 'after restore' } });
  assert.equal(next.revision, result.revision + 1);
  h.restart();
  assert.equal(h.store.readSnapshot().data.customers.Alpha.note, 'after restore');
  assert.equal(h.store.health().ok, true);
  assert.deepEqual(leftovers(h.store), []);
  assert.equal(fs.existsSync(path.join(h.store.directory, 'lai-data.sqlite-wal')) && fs.statSync(path.join(h.store.directory, 'lai-data.sqlite-wal')).size > 0 ? 'wal' : 'clean', 'clean');

  // Restoring the before-restore backup brings the changed data back.
  const again = h.store.restoreBackup(result.beforeRestore);
  assert.ok(again.revision > next.revision);
  assert.deepEqual(Object.keys(h.store.readSnapshot().data.customers).sort(), ['Alpha', 'Beta']);
  assert.equal(h.store.readSnapshot().data.customers.Alpha.note, 'changed');
});
function rejectsConflict(fn) {
  let error;
  try { fn(); } catch (e) { error = e; }
  assert.equal(error?.status, 409);
}

test('bad names are rejected and nothing changes', t => {
  const h = fixture(t);
  saveCustomers(h.store, { Alpha: {} });
  const manual = h.store.backup(true, 'manual');
  const before = h.store.readSnapshot();
  for (const name of ['../x', '../backups/' + path.basename(manual.file), manual.file, '/etc/passwd', 'lai-data.sqlite', 'manual-2026.sqlite', 'foo.sqlite', 'manual-20260101-120000.sqlite/../../lai-data.sqlite', '', null, 42, { name: 'x' }, 'manual-20260101-120000.json'])
    rejects(() => h.store.restoreBackup(name), 400, 'invalid_backup_name');
  rejects(() => h.store.restoreBackup('manual-20200101-120000.sqlite'), 404, 'backup_not_found');
  assert.deepEqual(h.store.readSnapshot(), before);
  assert.deepEqual(sqliteFiles(h.store), [path.basename(manual.file)], 'no before-restore backup for a refused restore');
  assert.deepEqual(leftovers(h.store), []);
});

test('a corrupted or foreign backup is rejected and the live data stays as it was', t => {
  const h = fixture(t);
  const customers = {};
  for (let i = 0; i < 400; i++) customers['Customer ' + i] = { note: 'x'.repeat(200), index: i };
  saveCustomers(h.store, customers);
  const manual = h.store.backup(true, 'manual');
  saveCustomers(h.store, { Only: { note: 'live' } });
  const before = h.store.readSnapshot();

  const dir = backupDir(h.store);
  // Garbage bytes under a valid backup name.
  fs.writeFileSync(path.join(dir, 'manual-20250101-120000.sqlite'), crypto.randomBytes(8192));
  // A real backup with pages in the middle overwritten.
  const broken = fs.readFileSync(manual.file);
  broken.fill(0x5a, 4096 * 3, 4096 * 6);
  fs.writeFileSync(path.join(dir, 'manual-20250101-120001.sqlite'), broken);
  // A healthy SQLite file that is not a 来财 database.
  const foreign = new DatabaseSync(path.join(dir, 'manual-20250101-120002.sqlite'));
  foreign.exec('CREATE TABLE notes(x); INSERT INTO notes VALUES (1);'); foreign.close();
  // A 来财 database whose row content cannot be read back.
  const unreadable = path.join(dir, 'manual-20250101-120003.sqlite');
  fs.copyFileSync(manual.file, unreadable);
  const bad = new DatabaseSync(unreadable); bad.exec("UPDATE customers SET data_json = '{not json' WHERE name = 'Customer 1'"); bad.close();

  for (const name of ['manual-20250101-120000.sqlite', 'manual-20250101-120001.sqlite', 'manual-20250101-120002.sqlite', 'manual-20250101-120003.sqlite'])
    rejects(() => h.store.restoreBackup(name), 422, 'backup_unusable');
  assert.deepEqual(h.store.readSnapshot(), before);
  assert.equal(sqliteFiles(h.store).filter(n => n.startsWith('before-restore-')).length, 0);
  assert.deepEqual(leftovers(h.store), []);
  const listed = Object.fromEntries(h.store.listBackups().map(b => [b.name, b.ok]));
  assert.equal(listed['manual-20250101-120000.sqlite'], false, 'an unreadable file is listed but cannot be restored');
  assert.equal(listed[path.basename(manual.file)], true);
  // The store still saves normally.
  saveCustomers(h.store, { Only: { note: 'still saving' } });
});

test('symlinked and hard-linked backups are rejected', t => {
  const h = fixture(t);
  saveCustomers(h.store, { Alpha: {} });
  const manual = h.store.backup(true, 'manual');
  const outside = path.join(h.dir, 'outside.sqlite');
  fs.copyFileSync(manual.file, outside);
  fs.symlinkSync(outside, path.join(backupDir(h.store), 'manual-20250101-130000.sqlite'));
  fs.linkSync(outside, path.join(backupDir(h.store), 'manual-20250101-130001.sqlite'));
  const before = h.store.readSnapshot();
  rejects(() => h.store.restoreBackup('manual-20250101-130000.sqlite'), 400, 'backup_unsafe');
  rejects(() => h.store.restoreBackup('manual-20250101-130001.sqlite'), 400, 'backup_unsafe');
  assert.deepEqual(h.store.readSnapshot(), before);
  const listed = Object.fromEntries(h.store.listBackups().map(b => [b.name, b.ok]));
  assert.equal(listed['manual-20250101-130000.sqlite'], false);
  assert.equal(listed['manual-20250101-130001.sqlite'], false);
});

test('attachments missing in the live folder are copied back; existing and extra files are left alone', t => {
  const h = fixture(t);
  const live = path.join(h.store.directory, 'attachments');
  fs.mkdirSync(path.join(live, 'orders'), { recursive: true });
  fs.writeFileSync(path.join(live, 'orders', 'a.pdf'), 'A original');
  fs.writeFileSync(path.join(live, 'orders', 'b.pdf'), 'B original');
  saveCustomers(h.store, { Alpha: {} }, [{ id: 'o1', num: 'L-1', client: 'Alpha', attachments: [{ fileUrl: '/attachments/orders/a.pdf' }, { fileUrl: '/attachments/orders/b.pdf' }] }]);
  const manual = h.store.backup(true, 'manual');
  assert.equal(manual.attachmentCount, 2);
  saveCustomers(h.store, { Alpha: {} }, []);
  fs.rmSync(path.join(live, 'orders', 'a.pdf'));
  fs.writeFileSync(path.join(live, 'orders', 'b.pdf'), 'B edited later');
  fs.writeFileSync(path.join(live, 'orders', 'c.pdf'), 'C only live');

  const result = h.store.restoreBackup(path.basename(manual.file));
  assert.equal(result.attachmentsRestored, 1);
  assert.equal(fs.readFileSync(path.join(live, 'orders', 'a.pdf'), 'utf8'), 'A original');
  assert.equal(fs.readFileSync(path.join(live, 'orders', 'b.pdf'), 'utf8'), 'B edited later', 'existing files are not overwritten');
  assert.equal(fs.readFileSync(path.join(live, 'orders', 'c.pdf'), 'utf8'), 'C only live', 'live files are never deleted');
  assert.equal(h.store.readSnapshot().data.orders[0].attachments.length, 2);
  assert.equal(fs.readdirSync(path.join(live, 'orders')).filter(n => n.includes('.restore-')).length, 0);
});

// Every file under a folder, as relative paths with their contents (links shown as links).
function tree(root) {
  const out = {};
  const walk = dir => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name), rel = path.relative(root, file);
      if (item.isSymbolicLink()) out[rel] = '-> ' + fs.readlinkSync(file);
      else if (item.isDirectory()) { out[rel + '/'] = 'dir'; walk(file); }
      else out[rel] = fs.readFileSync(file, 'utf8');
    }
  };
  walk(root);
  return out;
}

test('links inside a backup attachments folder are skipped and nothing is written outside attachments/', t => {
  const h = fixture(t);
  const live = path.join(h.store.directory, 'attachments');
  fs.mkdirSync(path.join(live, 'orders'), { recursive: true });
  fs.writeFileSync(path.join(live, 'orders', 'a.pdf'), 'A original');
  saveCustomers(h.store, { Alpha: {} }, [{ id: 'o1', num: 'L-1', client: 'Alpha', attachments: [{ fileUrl: '/attachments/orders/a.pdf' }] }]);
  const manual = h.store.backup(true, 'manual');
  saveCustomers(h.store, { Alpha: {} }, []);
  fs.rmSync(path.join(live, 'orders', 'a.pdf'));
  // Outside the data folder: a secret file and a folder; the backup's attachments folder links to both.
  const outside = path.join(h.dir, 'outside');
  fs.mkdirSync(path.join(outside, 'folder'), { recursive: true });
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
  fs.writeFileSync(path.join(outside, 'folder', 'inside.txt'), 'inside');
  const copied = manual.file + '.attachments';
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(copied, 'orders', 'linked.pdf'));
  fs.symlinkSync(path.join(outside, 'folder'), path.join(copied, 'linked-folder'));
  const outsideBefore = tree(outside);
  const dataBefore = Object.keys(tree(h.store.directory)).filter(rel => !rel.startsWith('attachments') && !rel.startsWith('backups') && !rel.startsWith('lai-data.sqlite'));

  const result = h.store.restoreBackup(path.basename(manual.file));
  assert.equal(result.attachmentsRestored, 1, 'only the real file is copied');
  assert.deepEqual(tree(live), { 'orders/': 'dir', 'orders/a.pdf': 'A original' }, 'links are neither followed nor copied');
  assert.deepEqual(tree(outside), outsideBefore, 'nothing outside the data folder changed');
  assert.deepEqual(Object.keys(tree(h.store.directory)).filter(rel => !rel.startsWith('attachments') && !rel.startsWith('backups') && !rel.startsWith('lai-data.sqlite')), dataBefore, 'no new files next to the database');
});

test('a live attachments subfolder that is a link stops the restore before anything is swapped (restore_attachments_failed)', t => {
  const h = fixture(t);
  const live = path.join(h.store.directory, 'attachments');
  fs.mkdirSync(path.join(live, 'orders'), { recursive: true });
  fs.writeFileSync(path.join(live, 'orders', 'a.pdf'), 'A original');
  saveCustomers(h.store, { Alpha: { note: 'backup' } }, [{ id: 'o1', num: 'L-1', client: 'Alpha', attachments: [{ fileUrl: '/attachments/orders/a.pdf' }] }]);
  const manual = h.store.backup(true, 'manual');
  saveCustomers(h.store, { Alpha: { note: 'live' } }, []);
  // attachments/orders is replaced by a link to a folder outside (made after start, so the start-up scan did not see it).
  const outside = path.join(h.dir, 'outside-orders');
  fs.mkdirSync(outside);
  fs.rmSync(path.join(live, 'orders'), { recursive: true });
  fs.symlinkSync(outside, path.join(live, 'orders'));
  const before = h.store.readSnapshot();
  const error = rejects(() => h.store.restoreBackup(path.basename(manual.file)), 500, 'restore_attachments_failed');
  assert.match(error.message, /没有改动/);
  assert.deepEqual(fs.readdirSync(outside), [], 'nothing was written through the link');
  assert.deepEqual(h.store.readSnapshot(), before);
  assert.equal(h.store.health().ok, true);
  assert.deepEqual(leftovers(h.store), []);
  saveCustomers(h.store, { Alpha: { note: 'still saving' } });
  assert.equal(h.store.readSnapshot().data.customers.Alpha.note, 'still saving');
});

test('a backups folder that is a link is refused', t => {
  const h = fixture(t);
  saveCustomers(h.store, { Alpha: { note: 'backup' } });
  const manual = h.store.backup(true, 'manual');
  saveCustomers(h.store, { Alpha: { note: 'live' } });
  const dir = backupDir(h.store), elsewhere = path.join(h.dir, 'elsewhere-backups');
  fs.renameSync(dir, elsewhere);
  fs.symlinkSync(elsewhere, dir);
  t.after(() => { try { fs.unlinkSync(dir); fs.renameSync(elsewhere, dir); } catch (_) {} });
  const before = h.store.readSnapshot();
  rejects(() => h.store.restoreBackup(path.basename(manual.file)), 400, 'backup_unsafe');
  assert.deepEqual(h.store.readSnapshot(), before);
  assert.deepEqual(fs.readdirSync(elsewhere).filter(n => n.startsWith('before-restore-')), []);
  assert.deepEqual(h.store.listBackups().map(b => b.ok), [false], 'listed, but not offered for restore');
});

test('pruning never removes before-restore backups or the backup being restored', t => {
  const h = fixture(t);
  saveCustomers(h.store, { Old: { note: 'old' } });
  const seed = h.store.backup(true, 'manual');
  const dir = backupDir(h.store);
  // An old before-restore backup (two years ago) and many newer automatic backups.
  fs.copyFileSync(seed.file, path.join(dir, 'before-restore-20240101-120000.sqlite'));
  for (let i = 0; i < 30; i++) assert.equal(h.store.backup(true).ok, true);
  assert.ok(fs.existsSync(path.join(dir, 'before-restore-20240101-120000.sqlite')));
  // An old automatic backup outside every retention window: the next backup would prune it,
  // but restoring it must not remove it while it is being restored.
  fs.copyFileSync(seed.file, path.join(dir, 'lai-data-20240101-120000.sqlite'));
  saveCustomers(h.store, { New: {} });
  const result = h.store.restoreBackup('lai-data-20240101-120000.sqlite');
  assert.deepEqual(Object.keys(h.store.readSnapshot().data.customers), ['Old']);
  assert.ok(fs.existsSync(path.join(dir, 'lai-data-20240101-120000.sqlite')), 'the before-restore backup did not prune the backup being restored');
  assert.ok(fs.existsSync(path.join(dir, result.beforeRestore)));
  for (let i = 0; i < 30; i++) assert.equal(h.store.backup(true).ok, true);
  assert.ok(fs.existsSync(path.join(dir, result.beforeRestore)), 'the newest before-restore backup survives pruning');
  assert.ok(fs.existsSync(path.join(dir, 'before-restore-20240101-120000.sqlite')), 'old before-restore backups are kept like manual ones');
  assert.ok(!fs.existsSync(path.join(dir, 'lai-data-20240101-120000.sqlite')), 'old automatic backups are still pruned later');
});

test('a failure before the swap leaves the live database untouched and usable', t => {
  const h = fixture(t);
  saveCustomers(h.store, { Alpha: { note: 'backup' } });
  const manual = h.store.backup(true, 'manual');
  saveCustomers(h.store, { Alpha: { note: 'live' } });
  const before = h.store.readSnapshot();
  const dbFile = path.join(h.store.directory, 'lai-data.sqlite');
  // The rename onto the live database fails (e.g. disk trouble).
  fs.renameSync = (from, to) => { if (String(to) === dbFile) throw Object.assign(new Error('EIO: synthetic'), { code: 'EIO' }); return realRename(from, to); };
  const error = rejects(() => h.store.restoreBackup(path.basename(manual.file)), 500, 'restore_failed');
  assert.match(error.message, /没有改动/);
  repair();
  assert.deepEqual(h.store.readSnapshot(), before);
  assert.deepEqual(leftovers(h.store), []);
  saveCustomers(h.store, { Alpha: { note: 'saved after failure' } });
  h.restart();
  assert.equal(h.store.readSnapshot().data.customers.Alpha.note, 'saved after failure');

  // The before-restore backup fails: nothing is restored.
  const backups = backupDir(h.store) + path.sep;
  fs.renameSync = (from, to) => { if (String(to).startsWith(backups) && String(to).endsWith('.sqlite')) throw Object.assign(new Error('ENOSPC: synthetic'), { code: 'ENOSPC' }); return realRename(from, to); };
  const now = h.store.readSnapshot();
  rejects(() => h.store.restoreBackup(path.basename(manual.file)), 503, 'backup_before_restore_failed');
  repair();
  assert.deepEqual(h.store.readSnapshot(), now);
  assert.deepEqual(leftovers(h.store), []);
});

test('if the swapped-in database cannot be opened, the data from before the restore is put back', t => {
  const h = fixture(t);
  saveCustomers(h.store, { Alpha: { note: 'backup' } });
  const manual = h.store.backup(true, 'manual');
  const live = saveCustomers(h.store, { Alpha: { note: 'live' }, Beta: {} });
  const dbFile = path.join(h.store.directory, 'lai-data.sqlite');
  let first = true;
  // The first file renamed onto the live database turns out unreadable (simulated disk damage after the checks).
  fs.renameSync = (from, to) => {
    if (String(to) === dbFile && first) { first = false; fs.writeFileSync(from, crypto.randomBytes(4096)); }
    return realRename(from, to);
  };
  const error = rejects(() => h.store.restoreBackup(path.basename(manual.file)), 500, 'restore_failed');
  assert.match(error.message, /换回/);
  const beforeRestore = sqliteFiles(h.store).find(n => n.startsWith('before-restore-'));
  assert.ok(beforeRestore && error.message.includes(beforeRestore), 'the message names the before-restore backup');
  repair();
  const after = h.store.readSnapshot();
  assert.deepEqual(strip(after), strip(live));
  assert.ok(after.revision > live.revision, 'an old page still cannot overwrite');
  assert.equal(h.store.health().ok, true);
  saveCustomers(h.store, { Alpha: { note: 'saved after rollback' } });
  h.restart();
  assert.equal(h.store.readSnapshot().data.customers.Alpha.note, 'saved after rollback');
});

test('if the database was swapped and cannot be put back, the message says so and names the before-restore backup', t => {
  for (const variant of ['rollback file unusable', 'rollback cannot be opened either']) {
    const h = fixture(t);
    saveCustomers(h.store, { Alpha: { note: 'backup' } });
    const manual = h.store.backup(true, 'manual');
    saveCustomers(h.store, { Alpha: { note: 'live' }, Beta: {} });
    const dbFile = path.join(h.store.directory, 'lai-data.sqlite');
    let swaps = 0;
    fs.renameSync = (from, to) => {
      if (String(to) === dbFile) {
        swaps += 1;
        // The swapped-in file turns out unreadable (simulated disk damage after the checks) ...
        if (swaps === 1 || variant === 'rollback cannot be opened either') fs.writeFileSync(from, crypto.randomBytes(4096));
        // ... and the before-restore backup is damaged too, so preparing the rollback fails.
        if (swaps === 1 && variant === 'rollback file unusable')
          for (const name of sqliteFiles(h.store).filter(n => n.startsWith('before-restore-'))) fs.writeFileSync(path.join(backupDir(h.store), name), crypto.randomBytes(4096));
      }
      return realRename(from, to);
    };
    const error = rejects(() => h.store.restoreBackup(path.basename(manual.file)), 500, 'restore_incomplete');
    repair();
    const beforeRestore = sqliteFiles(h.store).find(n => n.startsWith('before-restore-'));
    assert.ok(beforeRestore && error.message.includes(beforeRestore), `${variant}: the message names the before-restore backup`);
    assert.doesNotMatch(error.message, /没有改动|已换回/, `${variant}: no false comfort`);
    assert.match(error.message, /没有完成/);
    assert.equal(swaps, variant === 'rollback file unusable' ? 1 : 2);
    assert.equal(h.store.health().ok, false, `${variant}: the store reports that it cannot open the data`);
    assert.deepEqual(leftovers(h.store), []);
  }
});

test('the before-restore backup and the backups folder are synced to disk before the database is swapped', t => {
  const h = fixture(t);
  saveCustomers(h.store, { Alpha: {} });
  const manual = h.store.backup(true, 'manual');
  saveCustomers(h.store, { Alpha: {}, Beta: {} });
  const dbFile = path.join(h.store.directory, 'lai-data.sqlite'), dir = backupDir(h.store);
  const events = [], open = new Map();
  fs.openSync = (file, ...rest) => { const fd = realOpen(file, ...rest); open.set(fd, String(file)); return fd; };
  fs.fsyncSync = fd => { events.push('fsync ' + (open.get(fd) || '?')); return realFsync(fd); };
  fs.renameSync = (from, to) => { events.push('rename ' + String(to)); return realRename(from, to); };
  const result = h.store.restoreBackup(path.basename(manual.file));
  repair();
  const swap = events.indexOf('rename ' + dbFile);
  assert.ok(swap > 0);
  const beforeSwap = events.slice(0, swap);
  const backupIn = beforeSwap.indexOf('rename ' + path.join(dir, result.beforeRestore));
  assert.ok(backupIn >= 0, 'the before-restore backup is renamed into backups/ before the swap');
  assert.ok(beforeSwap.indexOf('fsync ' + path.join(dir, result.beforeRestore), backupIn) > backupIn, 'the backup file is synced');
  assert.ok(beforeSwap.indexOf('fsync ' + dir, backupIn) > backupIn, 'the backups folder is synced after the rename');
});

// A second process (another 来财 started on the same data folder) that saves on request.
function otherProcess(t, dataDir) {
  const code = `const { openStorage } = require(process.argv[1]);
    const s = openStorage({ seedFile: '/nonexistent-seed.json' });
    process.on('message', m => {
      if (m === 'close') { s.close(); process.send({ closed: true }); return; }
      try {
        const snap = s.readSnapshot();
        if (m !== 'read') { snap.data.customers[m] = { note: 'from the other process' }; s.save(snap, { baseRevision: snap.revision }); }
        process.send({ ok: true, customers: Object.keys(s.readSnapshot().data.customers).sort() });
      } catch (e) { process.send({ ok: false, status: e.status, message: e.message }); }
    });
    process.send('ready');`;
  const child = spawn(process.execPath, ['-e', code, path.join(__dirname, '../backend/storage.js')], { env: { ...process.env, LAI_DATA_DIR: dataDir }, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const ready = new Promise(resolve => child.once('message', resolve));
  const ask = message => new Promise(resolve => { child.once('message', resolve); child.send(message); });
  const stop = async () => { await ask('close'); child.kill(); await new Promise(r => child.exitCode !== null ? r() : child.once('exit', r)); };
  return { ready, ask, stop };
}

test('another process with the same data open blocks the restore; nothing changes until it is closed', async t => {
  const h = fixture(t);
  saveCustomers(h.store, { Base: {} });
  const manual = h.store.backup(true, 'manual');
  saveCustomers(h.store, { Base: {}, AfterBackup: {} });
  const backupsBefore = sqliteFiles(h.store);
  const other = otherProcess(t, h.store.directory);
  await other.ready;
  assert.deepEqual((await other.ask('FromOther1')).customers, ['AfterBackup', 'Base', 'FromOther1']);

  const before = h.store.readSnapshot();
  const error = rejects(() => h.store.restoreBackup(path.basename(manual.file)), 409, 'data_in_use');
  assert.match(error.message, /另一个来财/);
  assert.deepEqual(h.store.readSnapshot(), before, 'this process still has the same data');
  assert.deepEqual(sqliteFiles(h.store), backupsBefore, 'a refused restore makes no before-restore backup');
  assert.deepEqual(leftovers(h.store), []);
  // Both processes keep working on the one shared database.
  assert.deepEqual((await other.ask('FromOther2')).customers, ['AfterBackup', 'Base', 'FromOther1', 'FromOther2']);
  assert.deepEqual(Object.keys(h.store.readSnapshot().data.customers).sort(), ['AfterBackup', 'Base', 'FromOther1', 'FromOther2']);
  saveCustomers(h.store, { ...h.store.readSnapshot().data.customers, FromThis: {} });
  assert.deepEqual((await other.ask('read')).customers, ['AfterBackup', 'Base', 'FromOther1', 'FromOther2', 'FromThis']);

  // Once the other process is closed, the restore works.
  await other.stop();
  const result = h.store.restoreBackup(path.basename(manual.file));
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(h.store.readSnapshot().data.customers), ['Base']);
});

test('the check is repeated right before the swap; a refused restore copies no attachments back', t => {
  const h = fixture(t);
  const live = path.join(h.store.directory, 'attachments');
  fs.mkdirSync(path.join(live, 'orders'), { recursive: true });
  fs.writeFileSync(path.join(live, 'orders', 'a.pdf'), 'A original');
  saveCustomers(h.store, { Alpha: {} }, [{ id: 'o1', num: 'L-1', client: 'Alpha', attachments: [{ fileUrl: '/attachments/orders/a.pdf' }] }]);
  const manual = h.store.backup(true, 'manual');
  saveCustomers(h.store, { Alpha: {}, Beta: {} }, []);
  fs.rmSync(path.join(live, 'orders', 'a.pdf'));
  const before = h.store.readSnapshot();
  const dbFile = path.join(h.store.directory, 'lai-data.sqlite');
  const backups = backupDir(h.store) + path.sep;
  // Another connection opens the data after the first check (while the before-restore backup is being made).
  let extra = null;
  fs.renameSync = (from, to) => {
    const result = realRename(from, to);
    if (!extra && String(to).startsWith(backups) && String(to).endsWith('.sqlite')) {
      extra = new DatabaseSync(dbFile);
      extra.prepare('SELECT COUNT(*) AS count FROM customers').get();
    }
    return result;
  };
  t.after(() => { try { extra?.close(); } catch (_) {} });
  rejects(() => h.store.restoreBackup(path.basename(manual.file)), 409, 'data_in_use');
  repair();
  assert.ok(extra, 'the second connection was opened during the restore');
  assert.deepEqual(h.store.readSnapshot(), before);
  assert.equal(fs.existsSync(path.join(live, 'orders', 'a.pdf')), false, 'a refused restore copies no attachments back');
  assert.deepEqual(leftovers(h.store), []);
  assert.deepEqual(extra.prepare('SELECT name FROM customers ORDER BY name').all().map(r => r.name), ['Alpha', 'Beta']);
  saveCustomers(h.store, { Alpha: {}, Beta: {}, Gamma: {} });
  assert.deepEqual(extra.prepare('SELECT name FROM customers ORDER BY name').all().map(r => r.name), ['Alpha', 'Beta', 'Gamma'], 'both connections still share one database');
  extra.close(); extra = null;
  const result = h.store.restoreBackup(path.basename(manual.file));
  assert.equal(result.attachmentsRestored, 1);
  assert.equal(fs.readFileSync(path.join(live, 'orders', 'a.pdf'), 'utf8'), 'A original');
  assert.deepEqual(Object.keys(h.store.readSnapshot().data.customers), ['Alpha']);
});

test('leftover temp files from an interrupted restore are removed at start', t => {
  const h = fixture(t);
  saveCustomers(h.store, { Alpha: {} });
  fs.writeFileSync(path.join(h.store.directory, '.lai-data.sqlite.restore-123-abcdef.tmp'), 'partial');
  fs.writeFileSync(path.join(h.store.directory, '.lai-data.sqlite.restore-123-abcdef.tmp-journal'), 'partial');
  // Files that only look similar, and other files in the data folder, are left alone.
  const unrelated = ['lai-data.sqlite.restore-1-abc.tmp', '.lai-data.sqlite.restore-1-abc.tmp.bak', '.lai-data.sqlite.restore-notes.txt', '.lai-data.sqlite.restore-1 abc.tmp', 'notes.txt', '.lai-data.sqlite.backup'];
  for (const name of unrelated) fs.writeFileSync(path.join(h.store.directory, name), 'keep ' + name);
  fs.writeFileSync(path.join(backupDir(h.store), '.lai-data.sqlite.restore-9-abcdef.tmp'), 'in backups/, not ours to clean');
  const listing = () => fs.readdirSync(h.store.directory).filter(n => !n.startsWith('lai-data.sqlite') || unrelated.includes(n)).sort();
  h.restart();
  assert.deepEqual(leftovers(h.store).sort(), unrelated.filter(n => n.includes('.restore-')).sort(), 'only the restore temp files were removed');
  for (const name of unrelated) assert.equal(fs.readFileSync(path.join(h.store.directory, name), 'utf8'), 'keep ' + name);
  assert.ok(fs.existsSync(path.join(backupDir(h.store), '.lai-data.sqlite.restore-9-abcdef.tmp')));
  assert.deepEqual(Object.keys(h.store.readSnapshot().data.customers), ['Alpha']);
  // A restore cleans the same way.
  const manual = h.store.backup(true, 'manual');
  const before = listing();
  fs.writeFileSync(path.join(h.store.directory, '.lai-data.sqlite.restore-77-ffff.tmp'), 'partial');
  h.store.restoreBackup(path.basename(manual.file));
  assert.deepEqual(listing(), before);
});

async function startServer(t) {
  const temporary = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lai-test-http-restore-'));
  const resources = path.join(temporary, 'resources'); fs.mkdirSync(resources);
  for (const file of ['server.js', 'storage.js', 'storage-path.js', 'auth.js', 'errors.js', 'mail-account.js', 'mail-imap.js', 'mail-client.js', 'mail-smtp.js', 'mail-mime.js', 'mail-service.js', 'mail-libs.js', 'opportunity-files.js'])
    fs.copyFileSync(path.join(__dirname, '../backend', file), path.join(resources, file));
  fs.writeFileSync(path.join(resources, 'trade-order-system.html'), '<!doctype html><title>Lai HTTP fixture</title>');
  const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const token = crypto.randomBytes(32).toString('hex'), dataDir = path.join(temporary, 'data');
  const child = spawn(process.execPath, [path.join(resources, 'server.js')], { env: { ...process.env, LAI_DATA_DIR: dataDir, LAI_APP_PORT: String(port), LAI_API_TOKEN: token, LAI_APP_NO_OPEN: '1' }, stdio: ['ignore', 'ignore', 'ignore'] });
  t.after(async () => { child.kill('SIGTERM'); await new Promise(r => child.once('exit', r)); fs.rmSync(temporary, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${port}`;
  const request = (route, options = {}) => fetch(base + route, { ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers } });
  const post = (route, body) => request(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let ready = false;
  for (let i = 0; i < 500; i++) { try { if ((await fetch(base + '/api/health')).ok) { ready = true; break; } } catch {} await new Promise(r => setTimeout(r, 20)); }
  assert.equal(ready, true);
  return { base, request, post, dataDir };
}

test('HTTP: /api/backups and /api/restore need the session, refuse bad input and make old pages conflict', async t => {
  const { base, request, post, dataDir } = await startServer(t);
  assert.equal((await fetch(base + '/api/backups')).status, 401);
  assert.equal((await fetch(base + '/api/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"x"}' })).status, 401);
  assert.equal((await request('/api/restore')).status, 404, 'restore is POST only');
  assert.deepEqual(await (await request('/api/backups')).json(), { ok: true, backups: [] });

  const first = await (await request('/api/data')).json();
  first.data.customers.Synthetic = { note: 'backed up' };
  assert.equal((await post('/api/save', { state: first, baseRevision: first.revision })).status, 200);
  const manual = await (await post('/api/manual-backup', {})).json();
  assert.equal(manual.ok, true);
  const second = await (await request('/api/data')).json();
  second.data.customers.Later = { note: 'after backup' };
  assert.equal((await post('/api/save', { state: second, baseRevision: second.revision })).status, 200);
  const stale = await (await request('/api/data')).json();

  const listed = await (await request('/api/backups')).json();
  assert.equal(listed.backups.length, 1);
  assert.equal(listed.backups[0].kind, 'manual');
  assert.equal(listed.backups[0].customers, 1);

  assert.equal((await request('/api/restore', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
  const bad = await post('/api/restore', { name: '../lai-data.sqlite' });
  assert.equal(bad.status, 400);
  const badBody = await bad.json();
  assert.equal(badBody.ok, false); assert.equal(badBody.code, 'invalid_backup_name'); assert.match(badBody.message, /备份/);

  const restored = await post('/api/restore', { name: listed.backups[0].name });
  assert.equal(restored.status, 200);
  const result = await restored.json();
  assert.equal(result.ok, true); assert.equal(result.restoredFrom, listed.backups[0].name);
  assert.ok(result.revision > stale.revision);
  assert.ok(fs.existsSync(path.join(dataDir, 'backups', result.beforeRestore)));

  const now = await (await request('/api/data')).json();
  assert.deepEqual(Object.keys(now.data.customers), ['Synthetic']);
  assert.equal(now.revision, result.revision);
  // The page that still holds the pre-restore revision gets 409 on both save routes.
  stale.data.customers.Overwrite = {};
  const conflict = await post('/api/save', { state: stale, baseRevision: stale.revision });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).currentRevision, result.revision);
  assert.equal((await post('/api/save-changes', { changes: { customers: { set: { Overwrite: {} } }, counts: {} }, baseRevision: stale.revision })).status, 409);
  assert.deepEqual(Object.keys((await (await request('/api/data')).json()).data.customers), ['Synthetic']);
  const kinds = (await (await request('/api/backups')).json()).backups.map(b => b.kind);
  assert.deepEqual(kinds, ['before-restore', 'manual']);
});

test('HTTP: a restore is refused while a bulk mail is still sending, and works once it has stopped', async t => {
  const fake = require('./fixtures/fake-mail-servers.cjs'), sample = require('./fixtures/mail-sample.cjs');
  const me = { name: '', address: 'sales@example-trade.com' };
  const imap = await fake.startImap({ mailboxes: sample.mailboxes(me) }), smtp = await fake.startSmtp({ user: me.address });
  const temporary = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lai-test-http-restore-bulk-'));
  const resources = path.join(temporary, 'resources'); fs.mkdirSync(resources);
  for (const file of fs.readdirSync(path.join(__dirname, '../backend'))) fs.copyFileSync(path.join(__dirname, '../backend', file), path.join(resources, file));
  fs.writeFileSync(path.join(resources, 'trade-order-system.html'), '<!doctype html><title>fixture</title>');
  fs.mkdirSync(path.join(resources, 'vendor'));
  for (const [from, name] of [['mail-libs/mail-libs.cjs', 'mail-libs.cjs'], ['squire/squire-raw.js', 'squire-raw.js'], ['dompurify/purify.min.js', 'purify.min.js']]) fs.copyFileSync(path.join(__dirname, '../vendor', from), path.join(resources, 'vendor', name));
  const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const token = crypto.randomBytes(32).toString('hex'), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(resources, 'server.js')], { env: { ...process.env, LAI_DATA_DIR: path.join(temporary, 'data'), LAI_APP_PORT: String(port), LAI_API_TOKEN: token, LAI_APP_NO_OPEN: '1', LAI_MAIL_TEST_ENDPOINTS: `${imap.port},${smtp.port}` }, stdio: ['ignore', 'ignore', 'ignore'] });
  t.after(async () => { if (child.exitCode === null) await new Promise(r => { child.once('exit', r); child.kill('SIGTERM'); }); await imap.close(); await smtp.close(); fs.rmSync(temporary, { recursive: true, force: true }); });
  const request = async (route, options = {}) => { const response = await fetch(base + route, { ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers } }); return { status: response.status, body: await response.json() }; };
  const post = (route, body) => request(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  for (let i = 0; i < 500; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 20)); }

  const first = (await request('/api/data')).body;
  first.data.customers.Synthetic = { note: 'backed up' };
  assert.equal((await post('/api/save', { state: first, baseRevision: first.revision })).status, 200);
  assert.equal((await post('/api/manual-backup', {})).body.ok, true);
  const name = (await request('/api/backups')).body.backups[0].name;
  assert.equal((await post('/api/mail-account/bind', { email: me.address, password: 'app-password-1' })).status, 200);
  const later = (await request('/api/data')).body;
  later.data.customers.Later = {};
  assert.equal((await post('/api/save', { state: later, baseRevision: later.revision })).status, 200);

  // Three recipients with the server's normal pause between them: the batch is still sending for a few seconds.
  const bulk = await post('/api/mail/bulk/start', { subject: 'Hi', text: 'Hello', recipients: ['a', 'b', 'c'].map(x => ({ address: `${x}@nordic-lamps.example`, name: x })) });
  assert.equal(bulk.status, 200);
  const refused = await post('/api/restore', { name });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, 'bulk_sending');
  assert.match(refused.body.message, /群发/);
  assert.deepEqual(Object.keys((await request('/api/data')).body.data.customers).sort(), ['Later', 'Synthetic'], 'nothing was restored');
  assert.deepEqual((await request('/api/backups')).body.backups.map(b => b.kind), ['manual'], 'no before-restore backup was made');

  assert.equal((await post('/api/mail/bulk/cancel', { id: bulk.body.batch.id })).status, 200);
  let state; for (let i = 0; i < 400; i++) { state = (await request('/api/mail/bulk/batch?id=' + bulk.body.batch.id)).body.batch; if (state.status !== 'sending') break; await new Promise(r => setTimeout(r, 25)); }
  assert.equal(state.status, 'cancelled');
  const restored = await post('/api/restore', { name });
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  assert.deepEqual(Object.keys((await request('/api/data')).body.data.customers), ['Synthetic']);
});
