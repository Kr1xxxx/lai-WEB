'use strict';
// Backup queue, retention and failure handling (backend/storage.js). Ported and adapted from the unmerged
// 1.4.127 branch (backup-business-queue, mail-backup-queue). All data is synthetic; every store lives in a
// lai-test-* temp directory.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto'), { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const modulePath = path.join(__dirname, '../backend/storage.js');
const { openStorage } = require(modulePath);
const HOUR = 3600000, DAY = 24 * HOUR;

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lai-test-backup-queue-')), previous = process.env.LAI_DATA_DIR;
  process.env.LAI_DATA_DIR = path.join(dir, 'live');
  const seedFile = path.join(dir, 'no-seed.json');
  let store = openStorage({ seedFile });
  t.after(() => { repair(); try { store.close(); } catch (_) {} t.mock.timers.reset(); if (previous === undefined) delete process.env.LAI_DATA_DIR; else process.env.LAI_DATA_DIR = previous; fs.rmSync(dir, { recursive: true, force: true }); });
  return { dir, seedFile, get store() { return store; }, restart() { store.close(); store = openStorage({ seedFile }); }, openAfterCrash() { store = openStorage({ seedFile }); } };
}
const backupDir = s => path.join(s.directory, 'backups');
const files = s => fs.readdirSync(backupDir(s)).filter(f => f.endsWith('.sqlite')).sort();
const latest = s => JSON.parse(fs.readFileSync(path.join(s.directory, 'backup-meta.json'), 'utf8')).lastBackupFile;
function row(file, table) { const db = new DatabaseSync(file, { readOnly: true }); try { const r = db.prepare(`SELECT data_json FROM ${table}`).get(); return r ? JSON.parse(r.data_json) : null; } finally { db.close(); } }
function business(s, label) { const snap = s.readSnapshot(); snap.data.customers.Synthetic = { note: label, unknown: { retain: [null, 1] } }; s.save(snap, { baseRevision: snap.revision }); return s.readSnapshot(); }
// Simulated full disk: moving a finished backup into place fails (fs is shared with backend/storage.js).
// repair() puts the real function back.
const realRename = fs.renameSync, realRm = fs.rmSync;
function failRename(match) { fs.renameSync = (from, to) => { if (match(String(from), String(to))) throw Object.assign(new Error('ENOSPC: synthetic disk full'), { code: 'ENOSPC' }); return realRename(from, to); }; }
function breakBackups(s) { const dir = backupDir(s) + path.sep; failRename((from, to) => to.startsWith(dir) && to.endsWith('.sqlite')); }
function repair() { fs.renameSync = realRename; fs.rmSync = realRm; }

test('business changes coalesce and the quiet tail enters a backup at the original hourly deadline', t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const h = fixture(t);
  assert.equal(h.store.backup(true).ok, true);
  const deadline = Date.now() + HOUR;
  for (let i = 0; i < 50; i++) business(h.store, 'Synthetic ' + i);
  assert.equal(files(h.store).length, 1);
  assert.equal(h.store.backupStatus().pending, true);
  assert.equal(h.store.backupStatus().nextAttemptAt, deadline);
  assert.equal(h.store.backup(false).skipped, true);
  assert.equal(h.store.backupStatus().nextAttemptAt, deadline, 'later saves never push the deadline back');
  t.mock.timers.tick(HOUR - 1); assert.equal(files(h.store).length, 1);
  t.mock.timers.tick(1); assert.equal(files(h.store).length, 2);
  assert.equal(row(latest(h.store), 'customers').note, 'Synthetic 49');
  assert.equal(h.store.backupStatus().pending, false);
});

test('save-changes is queued for backup just like a full save', t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const h = fixture(t);
  assert.equal(h.store.backup(true).ok, true);
  const snap = h.store.readSnapshot();
  h.store.saveChanges({ customers: { set: { Delta: { note: 'delta save' } }, remove: [] }, counts: { orders: 0, trashOrders: 0, deletedOrders: 0, customers: 1, trackingLookups: 0 } }, { baseRevision: snap.revision });
  assert.equal(h.store.backupStatus().pending, true);
  t.mock.timers.tick(HOUR);
  assert.equal(row(latest(h.store), 'customers').note, 'delta save');
  assert.equal(h.store.backupStatus().pending, false);
});

test('close does not back up; the unbacked save is queued again on the next start', t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const h = fixture(t);
  h.store.backup(true);
  const deadline = Date.now() + HOUR;
  const saved = business(h.store, 'Close tail');
  h.restart();
  assert.equal(files(h.store).length, 1, 'closing makes no backup (the Mac shell may kill a slow one)');
  assert.equal(h.store.backupStatus().pending, true);
  assert.equal(h.store.backupStatus().nextAttemptAt, deadline);
  assert.deepEqual(h.store.readSnapshot(), saved);
  t.mock.timers.tick(HOUR);
  assert.equal(files(h.store).length, 2);
  assert.equal(row(latest(h.store), 'customers').note, 'Close tail');
  assert.equal(h.store.backupStatus().pending, false);
});

test('leftovers of a backup that was cut off are removed at start and before the next backup', t => {
  const h = fixture(t);
  business(h.store, 'Partial');
  const leftovers = () => fs.readdirSync(backupDir(h.store)).filter(n => n.includes('.partial'));
  const plant = stamp => { fs.writeFileSync(path.join(backupDir(h.store), `lai-data-${stamp}.sqlite.partial`), 'half'); fs.mkdirSync(path.join(backupDir(h.store), `lai-data-${stamp}.sqlite.partial.attachments/orders`), { recursive: true }); };
  plant('20261001-101010');
  h.store.close();
  h.openAfterCrash();
  assert.deepEqual(leftovers(), [], 'removed at start');
  plant('20261002-101010');
  assert.equal(h.store.backup(true).ok, true);
  assert.deepEqual(leftovers(), [], 'removed before the next backup');
  assert.equal(files(h.store).length, 1);
});

test('a failed backup is retried a minute later and never touches the saved data', t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const h = fixture(t);
  business(h.store, 'Committed');
  breakBackups(h.store);
  t.mock.timers.tick(2000);
  const failed = h.store.backupStatus();
  assert.equal(failed.ok, false); assert.equal(failed.pending, true); assert.equal(failed.nextAttemptAt, Date.now() + 60000);
  assert.match(failed.message, /ENOSPC/);
  const committed = h.store.readSnapshot();
  assert.equal(committed.data.customers.Synthetic.note, 'Committed');
  assert.equal(files(h.store).length, 0, 'no half-made backup is left behind');
  repair();
  t.mock.timers.tick(60000);
  assert.equal(files(h.store).length, 1);
  assert.deepEqual([h.store.backupStatus().ok, h.store.backupStatus().pending, h.store.backupStatus().message], [true, false, '']);
  assert.deepEqual(h.store.readSnapshot(), committed);
});

test('a failure is remembered across a restart until a backup succeeds', t => {
  const h = fixture(t);
  business(h.store, 'Before failure');
  breakBackups(h.store);
  assert.equal(h.store.backup(true).ok, false);
  h.restart();
  assert.equal(h.store.backupStatus().ok, false);
  repair();
  const succeeded = h.store.backup(true);
  assert.equal(succeeded.ok, true); assert.ok(succeeded.lastSuccessfulAt > 0);
  assert.equal(h.store.backupStatus().message, '');
});

test('pending work survives an abrupt exit and keeps its original deadline', t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const h = fixture(t);
  h.store.backup(true);
  const deadline = Date.now() + HOUR;
  h.store.close();
  const child = spawnSync(process.execPath, ['-e', `const {openStorage}=require(${JSON.stringify(modulePath)});const s=openStorage({seedFile:${JSON.stringify(h.seedFile)}});const x=s.readSnapshot();x.data.customers.Synthetic={note:'Crash tail'};s.save(x,{baseRevision:x.revision});s.writeMailTemplate({id:'late',updatedAt:'2026-10-07',subject:'Quiet last mutation'});process.exit(0);`], { env: { ...process.env, LAI_DATA_DIR: path.join(h.dir, 'live') }, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  h.openAfterCrash();
  assert.equal(h.store.backupStatus().pending, true);
  assert.equal(h.store.backupStatus().nextAttemptAt, deadline);
  t.mock.timers.tick(HOUR);
  assert.equal(row(latest(h.store), 'customers').note, 'Crash tail');
  assert.equal(row(latest(h.store), 'mail_templates').subject, 'Quiet last mutation');
  assert.equal(h.store.backupStatus().pending, false);
});

test('a rolled-back save leaves no pending backup and no partial edits', t => {
  const h = fixture(t);
  const good = business(h.store, 'Before');
  h.store.backup(true);
  const db = new DatabaseSync(path.join(h.store.directory, 'lai-data.sqlite'));
  db.exec("CREATE TRIGGER reject_business BEFORE UPDATE ON customers BEGIN SELECT RAISE(ABORT,'Synthetic write failure'); END");
  const changed = structuredClone(good); changed.data.customers.Synthetic.note = 'After';
  assert.throws(() => h.store.save(changed, { baseRevision: good.revision }), /Synthetic write failure/);
  db.exec('DROP TRIGGER reject_business'); db.close();
  assert.deepEqual(h.store.readSnapshot(), good);
  assert.equal(h.store.backupStatus().pending, false);
  assert.throws(() => h.store.save(good, { baseRevision: good.revision - 1 }), e => e.status === 409);
  assert.equal(h.store.backupStatus().pending, false);
});

test('business and mail changes share one deadline and one backup covers both', t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const h = fixture(t);
  h.store.backup(true);
  business(h.store, 'Combined');
  h.store.writeMailDraft({ id: 'draft', updatedAt: '2026-10-07', subject: 'Combined' }, [{ filename: 'synthetic.txt', contentBase64: Buffer.from('Mail bytes').toString('base64') }]);
  const deadline = h.store.backupStatus().nextAttemptAt;
  for (let i = 0; i < 30; i++) h.store.writeMailBulk({ id: 'bulk', createdAt: '2026-10-07', status: 'done', subject: 'Last ' + i, items: [{ status: 'sent' }] });
  assert.equal(files(h.store).length, 1);
  assert.equal(h.store.backupStatus().nextAttemptAt, deadline);
  t.mock.timers.tick(HOUR);
  assert.equal(files(h.store).length, 2);
  assert.equal(row(latest(h.store), 'customers').note, 'Combined');
  assert.equal(row(latest(h.store), 'mail_bulk').subject, 'Last 29');
  assert.equal(Buffer.from(row(latest(h.store), 'mail_draft_files')[0].contentBase64, 'base64').toString(), 'Mail bytes');
});

test('older databases without the backup marker get one queued backup, with no change to business data', t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const h = fixture(t);
  const good = business(h.store, 'Older data');
  h.store.backup(true);
  const metaFile = path.join(h.store.directory, 'backup-meta.json'), meta = JSON.parse(fs.readFileSync(metaFile));
  delete meta.lastBusinessRevision; fs.writeFileSync(metaFile, JSON.stringify(meta));
  const db = new DatabaseSync(path.join(h.store.directory, 'lai-data.sqlite'));
  db.exec("DELETE FROM metadata WHERE key = 'business_backup_revision'"); db.close();
  h.restart();
  assert.deepEqual(h.store.readSnapshot(), good);
  assert.equal(h.store.backupStatus().pending, true);
  t.mock.timers.tick(HOUR);
  assert.equal(h.store.backupStatus().pending, false);
  assert.equal(row(latest(h.store), 'customers').note, 'Older data');
});

test('a timer that cannot be set never turns a committed save into a save error', t => {
  const h = fixture(t);
  h.store.backup(true);
  const original = setTimeout;
  try { global.setTimeout = () => { throw new Error('Synthetic timer unavailable'); }; assert.doesNotThrow(() => business(h.store, 'Saved despite timer failure')); }
  finally { global.setTimeout = original; }
  assert.equal(h.store.readSnapshot().data.customers.Synthetic.note, 'Saved despite timer failure');
  assert.equal(h.store.backupStatus().pending, true); assert.equal(h.store.backupStatus().ok, false);
  assert.equal(h.store.backup(true).ok, true); assert.equal(h.store.backupStatus().pending, false);
});

test('a last backup time in the future (clock moved back) counts as a backup being due', t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const h = fixture(t);
  h.store.backup(true);
  const metaFile = path.join(h.store.directory, 'backup-meta.json'), meta = JSON.parse(fs.readFileSync(metaFile));
  meta.lastBackupAt = Date.now() + 3 * DAY; fs.writeFileSync(metaFile, JSON.stringify(meta));
  business(h.store, 'After clock change');
  assert.equal(h.store.backupStatus().nextAttemptAt, Date.now() + 2000, 'not postponed to three days from now');
  t.mock.timers.tick(2000);
  assert.equal(h.store.backupStatus().pending, false);
  assert.equal(row(latest(h.store), 'customers').note, 'After clock change');
  const again = JSON.parse(fs.readFileSync(metaFile)); again.lastBackupAt = Date.now() + DAY; fs.writeFileSync(metaFile, JSON.stringify(again));
  assert.notEqual(h.store.backup(false).skipped, true, 'a plain backup request is not skipped either');
});

test('retention keeps 24 hourly, one per day for 14 days, one per week for 8 weeks; manual backups stay', t => {
  const start = new Date(2026, 9, 16, 12, 0, 0).getTime();
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: start });
  const h = fixture(t);
  const pad = n => String(n).padStart(2, '0');
  const stamp = ms => { const d = new Date(ms); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`; };
  // Synthetic older backups: one every hour for 100 days (placeholders; pruning only looks at names).
  const made = [];
  for (let i = 1; i <= 100 * 24; i++) { const name = `lai-data-${stamp(start - i * HOUR)}.sqlite`; fs.writeFileSync(path.join(backupDir(h.store), name), ''); made.push({ name, time: start - i * HOUR }); }
  fs.mkdirSync(path.join(backupDir(h.store), made.at(-1).name + '.attachments'));
  const manual = `manual-${stamp(start - 300 * DAY)}.sqlite`;
  fs.writeFileSync(path.join(backupDir(h.store), manual), '');
  fs.writeFileSync(path.join(backupDir(h.store), 'lai-data-legacy.json'), '{}');
  const result = h.store.backup(true);
  assert.equal(result.ok, true);
  const kept = new Set(fs.readdirSync(backupDir(h.store)));
  assert.ok(kept.has(path.basename(result.file)), 'the new backup is kept');
  assert.ok(kept.has(manual), 'manual backups are never rotated');
  assert.ok(kept.has('lai-data-legacy.json'), 'old json backups are left alone');
  assert.equal(kept.has(made.at(-1).name + '.attachments'), false, 'attachment copies go with their backup');
  for (const { name } of made.slice(0, 23)) assert.ok(kept.has(name), 'the newest hourly backups stay: ' + name);
  const keptOld = made.filter(m => kept.has(m.name));
  const days = new Set(keptOld.filter(m => start - m.time < 14 * DAY).map(m => m.name.slice(9, 17)));
  assert.ok(days.size >= 14, 'one backup for each of the last 14 days');
  assert.ok(keptOld.every(m => start - m.time < 56 * DAY), 'nothing older than 8 weeks except manual ones');
  assert.ok(keptOld.some(m => start - m.time > 40 * DAY), 'weekly backups reach back several weeks');
  assert.ok(keptOld.length <= 24 + 14 + 9, 'at most hourly + daily + weekly, got ' + keptOld.length);
  // Manual backups have their own name, report as latest, and are never skipped.
  const manualNow = h.store.backup(true, 'manual');
  assert.match(path.basename(manualNow.file), /^manual-\d{8}-\d{6}\.sqlite$/);
  assert.equal(h.store.health().backups.latest, path.basename(manualNow.file));
});

test('same-second backups never prune the backup just made, even after the clock moved back', t => {
  const now = Date.now();
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now });
  const h = fixture(t);
  for (let i = 0; i < 30; i++) { h.store.writeMailTemplate({ id: 'clock', updatedAt: '2026-10-07', subject: 'Earlier ' + i }); assert.equal(h.store.backup(true).ok, true); }
  const subjects = files(h.store).map(f => row(path.join(backupDir(h.store), f), 'mail_templates').subject).sort((x, y) => Number(x.split(' ')[1]) - Number(y.split(' ')[1]));
  assert.deepEqual(subjects, Array.from({ length: 24 }, (_, i) => 'Earlier ' + (i + 6)), 'the 24 newest stay, in creation order even within one second');
  t.mock.timers.setTime(now - 10 * DAY);
  h.store.writeMailTemplate({ id: 'clock', updatedAt: '2026-10-07', subject: 'Newest after clock correction' });
  const result = h.store.backup(true);
  assert.equal(result.ok, true); assert.ok(fs.existsSync(result.file));
  assert.equal(row(result.file, 'mail_templates').subject, 'Newest after clock correction');
  assert.equal(path.basename(result.file), h.store.health().backups.latest);
});

test('removing more than 5 customers or orders makes a backup first; if that fails nothing is removed', t => {
  const h = fixture(t);
  let snap = h.store.readSnapshot();
  for (let i = 0; i < 8; i++) { snap.data.customers['C' + i] = { client: 'C' + i }; snap.data.orders.push({ id: 'o' + i, num: 'N' + i, client: 'C' + i }); }
  h.store.save(snap, { baseRevision: snap.revision });
  h.store.backup(true);
  const before = () => fs.readdirSync(backupDir(h.store)).filter(n => n.startsWith('before-delete-') && n.endsWith('.sqlite'));
  // Five at once: no extra backup.
  snap = h.store.readSnapshot();
  for (let i = 0; i < 5; i++) delete snap.data.customers['C' + i];
  snap.data.orders = snap.data.orders.slice(5);
  h.store.save(snap, { baseRevision: snap.revision });
  assert.equal(before().length, 0);
  // Put them back, then remove six customers in one full save.
  snap = h.store.readSnapshot();
  for (let i = 0; i < 8; i++) snap.data.customers['C' + i] = { client: 'C' + i };
  h.store.save(snap, { baseRevision: snap.revision });
  snap = h.store.readSnapshot();
  for (let i = 0; i < 6; i++) delete snap.data.customers['C' + i];
  h.store.save(snap, { baseRevision: snap.revision });
  assert.equal(before().length, 1);
  const copy = path.join(backupDir(h.store), before()[0]);
  const db = new DatabaseSync(copy, { readOnly: true });
  try { assert.equal(Number(db.prepare('SELECT COUNT(*) AS c FROM customers').get().c), 8, 'the backup holds the customers before the delete'); } finally { db.close(); }
  // Six orders through save-changes, with backups broken: refused, nothing changes.
  snap = h.store.readSnapshot();
  for (let i = 0; i < 6; i++) snap.data.orders.push({ id: 'p' + i, num: 'P' + i, client: 'C7' });
  h.store.save(snap, { baseRevision: snap.revision });
  breakBackups(h.store);
  const full = h.store.readSnapshot();
  const changes = { orders: { set: {}, remove: ['p0', 'p1', 'p2', 'p3', 'p4', 'p5'], sequence: { orders: full.data.orders.filter(o => !o.id.startsWith('p')).map(o => o.id) } }, counts: { orders: full.data.orders.length - 6, trashOrders: 0, deletedOrders: 0, customers: 2, trackingLookups: 0 } };
  assert.throws(() => h.store.saveChanges(changes, { baseRevision: full.revision }), e => e.status === 503 && /删除前的备份没有成功/.test(e.message));
  assert.deepEqual(h.store.readSnapshot(), full);
  repair();
  h.store.saveChanges(changes, { baseRevision: full.revision });
  assert.equal(before().length, 2);
  assert.equal(h.store.readSnapshot().data.orders.some(o => o.id.startsWith('p')), false);
});

test('backups copy only local /attachments/ files and skip missing ones in every folder', t => {
  const h = fixture(t);
  const att = path.join(h.store.directory, 'attachments');
  fs.mkdirSync(path.join(att, 'orders'), { recursive: true });
  fs.writeFileSync(path.join(att, 'orders/present.txt'), 'present');
  fs.mkdirSync(path.join(att, 'folder-not-file'), { recursive: true });
  const snap = h.store.readSnapshot();
  snap.data.orders = [{ id: 'o', num: 'O', client: 'Acme', attachments: [
    { fileUrl: '/attachments/orders/present.txt' }, { fileUrl: '/attachments/orders/missing.txt' }, { link: '/attachments/opportunities/x/gone.pdf' },
    { fileUrl: '/attachments/folder-not-file' }, { link: 'https://example.invalid/attachments/orders/present.txt' }, { fileUrl: '//example.invalid/attachments/orders/present.txt' }] }];
  snap.data.customers = { Acme: { files: [{ fileUrl: '/attachments/customers/missing.png' }] } };
  h.store.save(snap, { baseRevision: snap.revision });
  const result = h.store.backup(true);
  assert.equal(result.ok, true);
  assert.equal(result.attachmentCount, 1);
  assert.equal(result.missingAttachments, 4, 'three missing files and one folder are skipped and counted; external links are not local files');
  assert.equal(fs.readFileSync(path.join(result.attachmentsDir, 'orders/present.txt'), 'utf8'), 'present');
  assert.equal(h.store.backupStatus().missingAttachments, 4);
});

test('a full save that drops or mistypes a key the server has is refused and changes nothing', t => {
  const h = fixture(t);
  let s = h.store.readSnapshot();
  s.data.customers = { Acme: { country: 'US' } }; s.data.laiTasks = [{ id: 't', name: 'Task' }]; s.data.laiSettings = { theme: 'pink' };
  h.store.save(s, { baseRevision: s.revision });
  s = h.store.readSnapshot();
  for (const data of [{ orders: s.data.orders }, { ...s.data, customers: [] }, { ...s.data, customers: undefined }, { ...s.data, trashOrders: {} }, { ...s.data, trackingLookups: {} }, { ...s.data, laiTasks: undefined }, { ...s.data, laiTasks: null }, { ...s.data, laiSettings: [] }, { ...s.data, customers: { Acme: 'text' } }]) {
    assert.throws(() => h.store.save({ data }, { baseRevision: s.revision }), e => e.status === 400 && e.code === 'incomplete_save' && /原数据没有改动/.test(e.message));
    assert.deepEqual(h.store.readSnapshot(), s);
  }
  assert.throws(() => h.store.save({ data: { customers: {} } }, { baseRevision: s.revision }), e => e.status === 400);
  const valid = structuredClone(s); valid.data.laiTasks = [];
  h.store.save(valid, { baseRevision: s.revision });
  assert.equal(h.store.readSnapshot().data.laiTasks.length, 0, 'an empty list is a real change and is accepted');
  // A key that was null before may become a list.
  let n = h.store.readSnapshot(); n.data.laiTargets = null; h.store.save(n, { baseRevision: n.revision });
  n = h.store.readSnapshot(); n.data.laiTargets = [{ id: 'g' }]; h.store.save(n, { baseRevision: n.revision });
  assert.deepEqual(h.store.readSnapshot().data.laiTargets, [{ id: 'g' }]);
});

test('health is cheap: no full data read, integrity is checked once at startup', t => {
  const h = fixture(t);
  business(h.store, 'Health');
  const db = new DatabaseSync(path.join(h.store.directory, 'lai-data.sqlite'));
  db.prepare("UPDATE customers SET data_json = 'not json' WHERE name = 'Synthetic'").run(); db.close();
  assert.throws(() => h.store.readSnapshot(), 'a full read would fail on the broken row');
  const health = h.store.health();
  assert.equal(health.ok, true); assert.equal(health.integrity.message, 'ok');
  assert.deepEqual(health.counts, { orders: 0, trashOrders: 0, deletedOrders: 0, customers: 1, trackingLookups: 0 });
  assert.equal(typeof health.backup.pending, 'boolean');
});

test('drafts and their files are written in one transaction', t => {
  const h = fixture(t);
  h.store.backup(true);
  const db = new DatabaseSync(path.join(h.store.directory, 'lai-data.sqlite'));
  db.exec("CREATE TRIGGER reject_files BEFORE INSERT ON mail_draft_files BEGIN SELECT RAISE(ABORT,'Synthetic draft failure'); END");
  try {
    assert.throws(() => h.store.writeMailDraft({ id: 'bad', updatedAt: '2026-10-07', subject: 'Must roll back' }, [{ filename: 'bad.txt', contentBase64: 'QQ==' }]), /Synthetic draft failure/);
    assert.equal(h.store.listMailDrafts().length, 0);
    assert.equal(h.store.backupStatus().pending, false, 'a rolled-back mail write leaves nothing to back up');
  } finally { db.close(); }
});

test('all mail tables enter the queued backup, and a restored copy reopens with them', t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const h = fixture(t);
  fs.mkdirSync(path.join(h.store.directory, 'attachments/mail'), { recursive: true });
  fs.writeFileSync(path.join(h.store.directory, 'attachments/mail/linked.txt'), 'Synthetic linked attachment');
  h.store.writeMailAccount({ email: 'synthetic@example.invalid', password: crypto.randomBytes(24).toString('hex'), site: 'cn' });
  h.store.writeMailDraft({ id: 'draft', updatedAt: '2026-10-07', subject: 'Latest' }, [{ filename: 'local.txt', contentType: 'text/plain', contentBase64: Buffer.from('Latest').toString('base64') }]);
  h.store.writeMailTemplate({ id: 'template', updatedAt: '2026-10-07', subject: 'Latest', attachments: [{ link: '/attachments/mail/linked.txt' }] });
  h.store.writeMailBulk({ id: 'batch', createdAt: '2026-10-07', status: 'done', items: [{ status: 'sent' }], subject: 'Latest' });
  t.mock.timers.tick(2000);
  assert.equal(h.store.backupStatus().pending, false);
  const restored = path.join(h.dir, 'restored');
  fs.mkdirSync(restored);
  fs.copyFileSync(latest(h.store), path.join(restored, 'lai-data.sqlite'));
  fs.cpSync(latest(h.store) + '.attachments', path.join(restored, 'attachments'), { recursive: true });
  process.env.LAI_DATA_DIR = restored;
  const reopened = openStorage({ seedFile: h.seedFile });
  try {
    assert.equal(reopened.readMailAccount().email, 'synthetic@example.invalid');
    assert.equal(reopened.listMailDrafts()[0].subject, 'Latest');
    assert.equal(Buffer.from(reopened.readMailDraftFiles('draft')[0].contentBase64, 'base64').toString(), 'Latest');
    assert.equal(reopened.listMailTemplates()[0].subject, 'Latest');
    assert.equal(reopened.readMailBulk('batch').items[0].status, 'sent');
    assert.equal(fs.readFileSync(path.join(reopened.directory, 'attachments/mail/linked.txt'), 'utf8'), 'Synthetic linked attachment');
  } finally { reopened.close(); process.env.LAI_DATA_DIR = path.join(h.dir, 'live'); }
});

test('the deep folder check runs at startup only and skips backups/', t => {
  const h = fixture(t);
  const outside = path.join(h.dir, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'source'), 'x');
  // Inside backups/: ignored, also at startup.
  fs.linkSync(path.join(outside, 'source'), path.join(backupDir(h.store), 'hardlinked'));
  h.restart();
  // Elsewhere: refused at the next startup with a Chinese message, but a running store keeps saving.
  fs.symlinkSync(outside, path.join(h.store.directory, 'attachments', 'linked'));
  business(h.store, 'Still saves');
  h.store.close();
  let reopened;
  try { reopened = openStorage({ seedFile: h.seedFile }); assert.fail('startup should refuse'); }
  catch (error) { assert.match(error.message, /符号链接/); }
  finally { reopened?.close(); }
  fs.unlinkSync(path.join(h.store.directory, 'attachments', 'linked'));
  h.openAfterCrash();
  assert.equal(h.store.readSnapshot().data.customers.Synthetic.note, 'Still saves');
});

test('before-delete backups are not counted as hourly ones and stay at least 30 days', t => {
  const start = new Date(2026, 9, 16, 12, 0, 0).getTime();
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: start });
  const h = fixture(t);
  const pad = n => String(n).padStart(2, '0');
  const stamp = ms => { const d = new Date(ms); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`; };
  const put = name => { fs.writeFileSync(path.join(backupDir(h.store), name), ''); return name; };
  // 40 recent hourly backups and before-delete backups of several ages.
  for (let i = 1; i <= 40; i++) put(`lai-data-${stamp(start - i * HOUR)}.sqlite`);
  const recent = [1, 2, 3].map(i => put(`before-delete-${stamp(start - i * 30 * 60000)}.sqlite`));
  const day20 = put(`before-delete-${stamp(start - 20 * DAY)}.sqlite`), day29 = put(`before-delete-${stamp(start - 29 * DAY - HOUR)}.sqlite`);
  const day31 = put(`before-delete-${stamp(start - 31 * DAY)}.sqlite`), day90 = put(`before-delete-${stamp(start - 90 * DAY)}.sqlite`);
  fs.mkdirSync(path.join(backupDir(h.store), day90 + '.attachments'));
  assert.equal(h.store.backup(true).ok, true);
  const kept = new Set(fs.readdirSync(backupDir(h.store)));
  for (const name of [...recent, day20, day29]) assert.ok(kept.has(name), 'kept: ' + name);
  for (const name of [day31, day90, day90 + '.attachments']) assert.equal(kept.has(name), false, 'removed after 30 days: ' + name);
  const hourly = [...kept].filter(n => /^lai-data-.*\.sqlite$/.test(n));
  assert.ok(hourly.length >= 24, 'before-delete backups do not take the places of hourly ones');
  for (let i = 1; i <= 23; i++) assert.ok(kept.has(`lai-data-${stamp(start - i * HOUR)}.sqlite`));
});

test('a row whose stored JSON cannot be read is skipped and counted; backups and big deletes still work', t => {
  const h = fixture(t);
  let snap = h.store.readSnapshot();
  for (let i = 0; i < 8; i++) snap.data.customers['C' + i] = { client: 'C' + i };
  h.store.save(snap, { baseRevision: snap.revision });
  const db = new DatabaseSync(path.join(h.store.directory, 'lai-data.sqlite'));
  db.prepare("INSERT INTO mail_templates(id, updated_at, data_json) VALUES('broken', '2026-10-07', 'not json')").run();
  db.prepare("INSERT INTO app_state(key, data_json) VALUES('brokenKey', 'not json either')").run();
  db.close();
  const result = h.store.backup(true);
  assert.equal(result.ok, true); assert.equal(result.invalidRows, 2);
  assert.equal(h.store.backupStatus().invalidRows, 2);
  const copy = new DatabaseSync(result.file, { readOnly: true });
  try { assert.equal(copy.prepare("SELECT data_json FROM mail_templates WHERE id = 'broken'").get().data_json, 'not json', 'the row itself is still in the backup'); } finally { copy.close(); }
  const cleanDb = new DatabaseSync(path.join(h.store.directory, 'lai-data.sqlite'));
  cleanDb.prepare("DELETE FROM app_state WHERE key = 'brokenKey'").run(); cleanDb.close();
  snap = h.store.readSnapshot();
  for (let i = 0; i < 6; i++) delete snap.data.customers['C' + i];
  h.store.save(snap, { baseRevision: snap.revision });
  assert.equal(Object.keys(h.store.readSnapshot().data.customers).length, 2);
});

test('cleaning old backups or writing the backup record can fail without failing a finished backup', t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.now() });
  const h = fixture(t);
  const pad = n => String(n).padStart(2, '0');
  const stamp = ms => { const d = new Date(ms); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`; };
  for (let i = 1; i <= 120; i++) fs.writeFileSync(path.join(backupDir(h.store), `lai-data-${stamp(Date.now() - i * DAY)}.sqlite`), '');
  const warn = console.warn; console.warn = () => {};
  const dir = backupDir(h.store) + path.sep;
  fs.rmSync = (target, options) => { if (String(target).startsWith(dir) && !String(target).includes('.partial')) throw Object.assign(new Error('EACCES: synthetic'), { code: 'EACCES' }); return realRm(target, options); };
  let result;
  try { result = h.store.backup(true); } finally { console.warn = warn; fs.rmSync = realRm; }
  assert.equal(result.ok, true); assert.ok(fs.existsSync(result.file));
  assert.equal(h.store.backupStatus().ok, true, 'a failed clean-up is not a failed backup');
  // The record cannot be written: the copy stays, the backup counts as done, and the record is written later.
  business(h.store, 'Record later');
  const metaFile = path.join(h.store.directory, 'backup-meta.json');
  failRename((from, to) => to === metaFile);
  const second = h.store.backup(true);
  assert.equal(second.ok, true); assert.equal(second.metaSaved, false); assert.ok(fs.existsSync(second.file));
  assert.equal(h.store.backupStatus().ok, true); assert.equal(h.store.backupStatus().pending, false, 'the new backup covers the save');
  assert.notEqual(JSON.parse(fs.readFileSync(metaFile, 'utf8')).lastBackupFile, second.file, 'the file on disk is still the old record');
  t.mock.timers.tick(HOUR * 2);
  assert.equal(files(h.store).filter(n => n === path.basename(second.file)).length, 1);
  repair();
  h.store.backupStatus();
  assert.equal(JSON.parse(fs.readFileSync(metaFile, 'utf8')).lastBackupFile, second.file, 'the record is written on the next read');
});
