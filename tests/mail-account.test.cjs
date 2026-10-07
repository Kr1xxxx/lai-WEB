const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createMailAccounts } = require('../backend/mail-account.js');
const imap = require('../backend/mail-imap.js');

// 真实的本机存储（临时隔离目录）+ 可控的登录验证替身。不连接任何真实邮箱。
function harness() {
  const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lai-test-mail-'));
  const previous = process.env.LAI_DATA_DIR;
  process.env.LAI_DATA_DIR = path.join(directory, 'data');
  delete require.cache[require.resolve('../backend/storage.js')];
  const { openStorage } = require('../backend/storage.js');
  const open = () => openStorage({ seedFile: path.join(directory, 'missing-seed.json') });
  let store = open();
  const calls = []; let outcome = null, clock = 0, gate = null;
  const verify = async (input) => {
    calls.push({ ...input });
    if (gate) await gate;
    if (outcome) throw Object.assign(new Error(outcome.message), { code: outcome.code });
    return imap.resolveServer(input);
  };
  const make = () => createMailAccounts({ store, verify, now: () => `2026-10-06T10:00:0${clock++}.000Z` });
  let accounts = make();
  return {
    directory, calls, get accounts() { return accounts; }, get store() { return store; },
    fail(code, message = 'refused') { outcome = { code, message }; }, pass() { outcome = null; },
    hold() { let release; gate = new Promise(resolve => { release = resolve; }); return () => { gate = null; release(); }; },
    reopen() { store.close(); store = open(); accounts = make(); },
    dispose() { try { store.close(); } catch (_) {} if (previous === undefined) delete process.env.LAI_DATA_DIR; else process.env.LAI_DATA_DIR = previous; fs.rmSync(directory, { recursive: true, force: true }); },
  };
}
const SECRET = 'Zx9-app-password-7731';
const rejected = (promise, status, code) => assert.rejects(promise, error => error.status === status && error.code === code, `${status} ${code}`);

test('binding verifies first, stores the account, and never returns the password', async () => {
  const h = harness();
  try {
    assert.deepEqual(h.accounts.status(), { ok: true, available: true, account: null });
    const bound = await h.accounts.bind({ email: ' Sales@Example-Trade.com ', password: SECRET });
    assert.deepEqual(bound.account, { identity: imap.accountIdentity(h.store.readMailAccount()), provider: 'zoho', email: 'sales@example-trade.com', site: 'cn', accountType: 'organization', host: 'imappro.zoho.com.cn', port: 993, boundAt: '2026-10-06T10:00:00.000Z', verifiedAt: '2026-10-06T10:00:00.000Z', autoCheck: true });
    assert.deepEqual(h.calls, [{ email: 'sales@example-trade.com', password: SECRET, site: 'cn', accountType: 'organization' }]);
    assert.deepEqual(h.accounts.status().account, bound.account);
    assert.doesNotMatch(JSON.stringify([bound, h.accounts.status()]), new RegExp(SECRET));
    assert.equal(h.store.readMailAccount().password, SECRET, 'the local database keeps the credential, as chosen');
    assert.doesNotMatch(JSON.stringify(h.store.readSnapshot()), /example-trade|app-password/, 'business snapshot (/api/data) carries no mail account');
    h.reopen();
    assert.equal(h.accounts.status().account.email, 'sales@example-trade.com', 'binding survives a restart');
  } finally { h.dispose(); }
});

test('nothing is stored when verification fails, and an existing binding is kept', async () => {
  const h = harness();
  try {
    h.fail('auth_failed', '登录被邮箱服务器拒绝');
    await rejected(h.accounts.bind({ email: 'a@zoho.com.cn', password: SECRET }), 422, 'auth_failed');
    assert.equal(h.store.readMailAccount(), null);
    for (const [code, status] of [['network', 502], ['tls', 502], ['protocol', 502], ['timeout', 504]]) { h.fail(code); await rejected(h.accounts.bind({ email: 'a@zoho.com.cn', password: SECRET }), status, code); }
    assert.equal(h.store.readMailAccount(), null);
    h.pass(); await h.accounts.bind({ email: 'first@zoho.com.cn', password: SECRET });
    h.fail('auth_failed'); await rejected(h.accounts.bind({ email: 'second@zoho.com.cn', password: 'other-password' }), 422, 'auth_failed');
    assert.equal(h.store.readMailAccount().email, 'first@zoho.com.cn');
    assert.equal(h.store.readMailAccount().password, SECRET);
  } finally { h.dispose(); }
});

test('invalid input is refused without contacting the mail server', async () => {
  const h = harness();
  try {
    for (const input of [undefined, null, 'text', [], {}, { email: 'a@zoho.com.cn' }, { password: SECRET }, { email: 'bad', password: SECRET }, { email: 'a@zoho.com.cn', password: 'a\r\nb' }, { email: 'a@zoho.com.cn', password: SECRET, site: 'elsewhere' }, { email: 'a@zoho.com.cn', password: SECRET, accountType: 'x' }, { email: 'a@zoho.com.cn', password: SECRET, host: 'attacker.example', site: 'evil' }])
      await rejected(h.accounts.bind(input), 400, 'invalid_input');
    assert.equal(h.calls.length, 0);
    await h.accounts.bind({ email: 'a@zoho.com.cn', password: SECRET, host: 'attacker.example', port: 1 });
    assert.equal(h.store.readMailAccount().host, 'imap.zoho.com.cn', 'a host supplied by the page is ignored');
    assert.equal(h.store.readMailAccount().port, 993);
  } finally { h.dispose(); }
});

test('re-verifying uses the stored credential and keeps the binding when it fails', async () => {
  const h = harness();
  try {
    await rejected(h.accounts.reverify(), 404, 'not_bound');
    await h.accounts.bind({ email: 'a@zoho.com', password: SECRET, site: 'com' });
    const again = await h.accounts.reverify();
    assert.deepEqual(h.calls.at(-1), { email: 'a@zoho.com', password: SECRET, site: 'com', accountType: 'personal' });
    assert.equal(again.account.boundAt, '2026-10-06T10:00:00.000Z'); assert.equal(again.account.verifiedAt, '2026-10-06T10:00:01.000Z');
    assert.doesNotMatch(JSON.stringify(again), new RegExp(SECRET));
    h.fail('auth_failed'); await rejected(h.accounts.reverify(), 422, 'auth_failed');
    const kept = h.store.readMailAccount();
    assert.equal(kept.email, 'a@zoho.com'); assert.equal(kept.password, SECRET); assert.equal(kept.verifiedAt, '2026-10-06T10:00:01.000Z');
  } finally { h.dispose(); }
});

test('unbinding removes the stored credential from the database', async () => {
  const h = harness();
  try {
    assert.deepEqual(h.accounts.unbind(), { ok: true, available: true, account: null });
    await h.accounts.bind({ email: 'a@zoho.com.cn', password: SECRET });
    assert.deepEqual(h.accounts.unbind(), { ok: true, available: true, account: null });
    assert.equal(h.store.readMailAccount(), null);
    h.store.close();
    const raw = new DatabaseSync(path.join(h.directory, 'data', 'lai-data.sqlite'), { readOnly: true });
    try { assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM mail_account').get().n, 0); } finally { raw.close(); }
  } finally { h.dispose(); }
});

test('only one verification runs at a time', async () => {
  const h = harness();
  try {
    const release = h.hold();
    const first = h.accounts.bind({ email: 'a@zoho.com.cn', password: SECRET });
    await rejected(h.accounts.bind({ email: 'b@zoho.com.cn', password: SECRET }), 409, 'busy');
    await rejected(h.accounts.reverify(), 409, 'busy');
    assert.throws(() => h.accounts.unbind(), error => error.status === 409 && error.code === 'busy');
    release(); await first;
    assert.equal(h.calls.length, 1);
    assert.equal(h.store.readMailAccount().email, 'a@zoho.com.cn');
    await h.accounts.reverify();
  } finally { h.dispose(); }
});

test('saving business data and backups leave the binding in place', async () => {
  const h = harness();
  try {
    await h.accounts.bind({ email: 'a@zoho.com.cn', password: SECRET });
    const snapshot = h.store.readSnapshot();
    snapshot.data.customers = { 'Synthetic Co': { country: 'US' } };
    h.store.save(snapshot, { baseRevision: snapshot.revision });
    assert.equal(h.store.readMailAccount().email, 'a@zoho.com.cn');
    const backup = h.store.backup(true);
    assert.equal(backup.ok, true);
    const copy = new DatabaseSync(backup.file, { readOnly: true });
    try { assert.match(copy.prepare('SELECT data_json FROM mail_account WHERE id = 1').get().data_json, new RegExp(SECRET), 'documented: backups include the credential'); } finally { copy.close(); }
    assert.equal(fs.statSync(path.join(h.directory, 'data', 'lai-data.sqlite')).mode & 0o077, 0, 'database file is private to the user');
    assert.equal(fs.statSync(backup.file).mode & 0o077, 0, 'backup file is private to the user');
  } finally { h.dispose(); }
});

test('unexpected errors are not disguised as verification results', async () => {
  const h = harness();
  try {
    h.fail(undefined, 'boom');
    await assert.rejects(h.accounts.bind({ email: 'a@zoho.com.cn', password: SECRET }), error => error.status === undefined && error.message === 'boom');
    h.pass(); await h.accounts.bind({ email: 'a@zoho.com.cn', password: SECRET });
  } finally { h.dispose(); }
});

test('sender name and signature can be changed without re-verifying and never expose the password', async () => {
  const h = harness();
  try {
    assert.throws(() => h.accounts.settings({ senderName: 'x' }), error => error.status === 404 && error.code === 'not_bound');
    await h.accounts.bind({ email: 'a@zoho.com.cn', password: SECRET });
    const saved = h.accounts.settings({ senderName: ' Kris\r\nBcc: x ', signature: ' Kris\r\nLai Trading\u0000 \n', password: 'ignored', host: 'evil.example' });
    assert.equal(saved.account.senderName, 'Kris Bcc: x'); assert.equal(saved.account.signature, 'Kris\nLai Trading'); assert.equal(saved.account.host, 'imap.zoho.com.cn');
    assert.doesNotMatch(JSON.stringify(saved), new RegExp(SECRET)); assert.equal(h.store.readMailAccount().password, SECRET); assert.equal(h.calls.length, 1, 'no extra login');
    assert.equal(h.accounts.settings({ signature: 'x'.repeat(5000) }).account.signature.length, 2000); assert.equal(h.accounts.settings({}).account.senderName, 'Kris Bcc: x', 'omitted fields are kept');
    assert.equal(h.accounts.settings({ senderName: '', signature: '' }).account.signature, undefined);
    h.reopen(); assert.equal(h.accounts.status().account.email, 'a@zoho.com.cn');
  } finally { h.dispose(); }
});
