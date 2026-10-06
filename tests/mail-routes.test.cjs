const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

// 启动真实的本机服务（临时隔离目录），只验证不需要外部网络的部分；真实登录验证见 mail-imap / mail-account 测试。
test('mail account routes require the session, validate input before any network use, and never return the password', async () => {
  const temporary = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lai-test-mailhttp-'));
  const resources = path.join(temporary, 'resources'); fs.mkdirSync(resources);
  for (const file of ['server.js', 'storage.js', 'storage-path.js', 'auth.js', 'errors.js', 'mail-account.js', 'mail-imap.js', 'mail-client.js', 'mail-smtp.js', 'mail-mime.js', 'mail-service.js']) fs.copyFileSync(path.join(__dirname, '../backend', file), path.join(resources, file));
  fs.writeFileSync(path.join(resources, 'trade-order-system.html'), '<!doctype html><title>fixture</title>');
  const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const token = crypto.randomBytes(32).toString('hex'), base = `http://127.0.0.1:${port}`, data = path.join(temporary, 'data');
  const start = () => spawn(process.execPath, [path.join(resources, 'server.js')], { env: { ...process.env, LAI_DATA_DIR: data, LAI_APP_PORT: String(port), LAI_API_TOKEN: token, LAI_APP_NO_OPEN: '1' }, stdio: ['ignore', 'ignore', 'pipe'] });
  const stop = child => child.exitCode !== null ? null : new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); });
  const ready = async () => { for (let i = 0; i < 200; i++) { try { if ((await fetch(base + '/api/health')).ok) return; } catch {} await new Promise(r => setTimeout(r, 20)); } throw new Error('server did not start'); };
  const request = (route, options = {}) => fetch(base + route, { ...options, headers: { 'x-trade-token': token, ...options.headers } });
  const post = (route, body) => request(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let child = start();
  try {
    await ready();
    for (const [route, method] of [['/api/mail-account', 'GET'], ['/api/mail-account/bind', 'POST'], ['/api/mail-account/verify', 'POST'], ['/api/mail-account/unbind', 'POST']]) {
      assert.equal((await fetch(base + route, { method })).status, 401, route);
      assert.equal((await request(route, { method, headers: { Origin: 'https://untrusted.example' } })).status, 403, route);
    }
    assert.equal((await request('/api/mail-account', { method: 'POST' })).status, 404);
    assert.equal((await request('/api/mail-account/bind')).status, 404);
    assert.equal((await request('/api/mail-account/password')).status, 404);
    assert.deepEqual(await (await request('/api/mail-account')).json(), { ok: true, available: true, account: null });
    assert.equal((await request('/api/mail-account/bind', { method: 'POST', body: '{}' })).status, 415);
    assert.equal((await request('/api/mail-account/bind', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
    for (const body of [{}, { email: 'not-an-email', password: 'x' }, { email: 'a@zoho.com.cn', password: '' }, { email: 'a@zoho.com.cn', password: 'a\r\nb' }, { email: 'a@zoho.com.cn', password: 'x', site: 'attacker.example' }]) {
      const response = await post('/api/mail-account/bind', body); const answer = await response.json();
      assert.equal(response.status, 400, JSON.stringify(body)); assert.equal(answer.code, 'invalid_input'); assert.equal(answer.ok, false); assert.ok(answer.message);
    }
    const missing = await post('/api/mail-account/verify', {});
    assert.equal(missing.status, 404); assert.equal((await missing.json()).code, 'not_bound');
    assert.deepEqual(await (await post('/api/mail-account/unbind', {})).json(), { ok: true, available: true, account: null });

    // 直接在隔离库里放一条绑定记录，确认接口只返回公开字段、业务快照不含它、解绑后被删除。
    await stop(child);
    const seed = new DatabaseSync(path.join(data, 'lai-data.sqlite'));
    seed.prepare('INSERT INTO mail_account(id, data_json) VALUES(1, ?)').run(JSON.stringify({ provider: 'zoho', email: 'sales@example-trade.com', password: 'Zx9-seeded-secret', site: 'cn', accountType: 'organization', host: 'imappro.zoho.com.cn', port: 993, boundAt: '2026-10-06T10:00:00.000Z', verifiedAt: '2026-10-06T10:00:00.000Z' }));
    seed.close();
    child = start(); await ready();
    const status = await (await request('/api/mail-account')).text();
    assert.deepEqual(JSON.parse(status).account, { provider: 'zoho', email: 'sales@example-trade.com', site: 'cn', accountType: 'organization', host: 'imappro.zoho.com.cn', port: 993, boundAt: '2026-10-06T10:00:00.000Z', verifiedAt: '2026-10-06T10:00:00.000Z' });
    for (const route of ['/api/mail-account', '/api/data', '/api/health']) assert.doesNotMatch(await (await request(route)).text(), /Zx9-seeded-secret|"password"/, route);
    assert.doesNotMatch(await (await request('/api/data')).text(), /example-trade/);
    assert.deepEqual(await (await post('/api/mail-account/unbind', {})).json(), { ok: true, available: true, account: null });
    assert.equal((await (await request('/api/mail-account')).json()).account, null);
  } finally { await stop(child); fs.rmSync(temporary, { recursive: true, force: true }); }
});

test('the whole mail flow works over the local HTTP routes against fake mail servers', async () => {
  const fake = require('./fixtures/fake-mail-servers.cjs'), sample = require('./fixtures/mail-sample.cjs');
  const me = { name: '', address: 'sales@example-trade.com' };
  const imap = await fake.startImap({ mailboxes: sample.mailboxes(me) }), smtp = await fake.startSmtp({ user: me.address });
  const temporary = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lai-test-mailflow-'));
  const resources = path.join(temporary, 'resources'); fs.mkdirSync(resources);
  for (const file of fs.readdirSync(path.join(__dirname, '../backend'))) fs.copyFileSync(path.join(__dirname, '../backend', file), path.join(resources, file));
  fs.writeFileSync(path.join(resources, 'trade-order-system.html'), '<!doctype html><title>fixture</title>');
  const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const token = crypto.randomBytes(32).toString('hex'), base = `http://127.0.0.1:${port}`, data = path.join(temporary, 'data');
  const child = spawn(process.execPath, [path.join(resources, 'server.js')], { env: { ...process.env, LAI_DATA_DIR: data, LAI_APP_PORT: String(port), LAI_API_TOKEN: token, LAI_APP_NO_OPEN: '1', LAI_MAIL_TEST_ENDPOINTS: `${imap.port},${smtp.port}` }, stdio: ['ignore', 'ignore', 'pipe'] });
  const seen = [];
  const request = async (route, options = {}) => { const response = await fetch(base + route, { ...options, headers: { 'x-trade-token': token, ...options.headers } }); const text = await response.text(); seen.push(text); return { status: response.status, body: JSON.parse(text) }; };
  const post = (route, body) => request(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    for (let i = 0; i < 200; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 20)); }
    for (const route of ['/api/mail/messages?folder=inbox', '/api/mail/message?box=inbox&uid=1', '/api/mail/drafts', '/api/mail/correspondence?addresses=a@b.co']) assert.equal((await fetch(base + route)).status, 401, route);
    for (const route of ['/api/mail/send', '/api/mail/flags', '/api/mail/trash', '/api/mail/attachment/save', '/api/mail/drafts/save', '/api/mail/drafts/delete']) {
      assert.equal((await fetch(base + route, { method: 'POST' })).status, 401, route);
      assert.equal((await fetch(base + route, { method: 'POST', headers: { 'x-trade-token': token, Origin: 'https://untrusted.example', 'Content-Type': 'application/json' }, body: '{}' })).status, 403, route);
      assert.equal((await fetch(base + route, { method: 'POST', headers: { 'x-trade-token': token }, body: '{}' })).status, 415, route);
      assert.equal((await fetch(base + route, { headers: { 'x-trade-token': token } })).status, 404, route + ' has no GET form');
    }
    assert.deepEqual([(await request('/api/mail/messages?folder=inbox')).status, (await request('/api/mail/messages?folder=inbox')).body.code], [409, 'not_bound']);
    const wrong = await post('/api/mail-account/bind', { email: me.address, password: 'wrong-password' });
    assert.equal(wrong.status, 422); assert.equal(wrong.body.code, 'auth_failed'); assert.equal((await request('/api/mail-account')).body.account, null);
    const bound = await post('/api/mail-account/bind', { email: me.address, password: 'app-password-1' });
    assert.equal(bound.status, 200); assert.equal(bound.body.account.host, 'imappro.zoho.com.cn');
    const inbox = await request('/api/mail/messages?folder=inbox&query=' + encodeURIComponent('样品'));
    assert.deepEqual(inbox.body.items.map(i => [i.uid, i.subject]), [[4, '样品寄送确认 — 10月批次']]); assert.deepEqual(inbox.body.counts, { unread: 3, pending: 1 });
    const message = await request('/api/mail/message?box=inbox&uid=4');
    assert.equal(message.body.message.from.name, '李伟'); assert.equal(message.body.message.attachments.length, 2);
    assert.equal((await post('/api/mail/flags', { box: 'inbox', uid: 4, pending: true })).status, 200); assert.ok(imap.state.message('INBOX', 4).flags.has('\\Flagged'));
    const saved = await post('/api/mail/attachment/save', { box: 'inbox', uid: 4, index: 0 });
    assert.equal(saved.body.file, path.join(data, 'downloads', '装箱单 2026-10.pdf'), 'test runs save inside the isolated data folder, never the real Downloads'); assert.ok(fs.existsSync(saved.body.file));
    const draft = await post('/api/mail/drafts/save', { to: 'anna@nordic-lamps.example', subject: 'PI' });
    assert.equal((await request('/api/mail/drafts')).body.items.length, 1);
    const sent = await post('/api/mail/send', { to: 'anna@nordic-lamps.example', subject: 'PI-1001', text: 'attached', draftId: draft.body.draft.id, fromName: 'Kris', forwardOf: { box: 'inbox', uid: 4 } });
    assert.equal(sent.status, 200); assert.deepEqual(sent.body.recipients, ['anna@nordic-lamps.example']); assert.equal(smtp.state.sent.length, 1); assert.equal(smtp.state.sent[0].parsed.attachments.length, 2);
    assert.equal((await request('/api/mail/drafts')).body.items.length, 0); assert.equal((await request('/api/mail-account')).body.account.senderName, 'Kris');
    assert.equal((await post('/api/mail/send', { to: '', subject: 'x', text: 'y' })).status, 400); assert.equal(smtp.state.sent.length, 1);
    assert.deepEqual((await request('/api/mail/correspondence?addresses=anna@nordic-lamps.example')).body.items.map(i => i.box), ['inbox', 'sent']);
    assert.equal((await post('/api/mail-account/settings', { senderName: 'Kris', signature: 'Kris\nLai' })).body.account.signature, 'Kris\nLai');
    assert.equal((await post('/api/mail/bulk/start', { subject: 's', text: 't', recipients: [] })).status, 400);
    const bulk = await post('/api/mail/bulk/start', { subject: 'Hi {{公司}}', text: 'Dear {{姓名}}', recipients: [{ address: 'anna@nordic-lamps.example', name: 'Anna', customer: 'Nordic Lamps AB' }] });
    assert.equal(bulk.status, 200); assert.equal(bulk.body.batch.total, 1);
    let batchState; for (let i = 0; i < 200; i++) { batchState = (await request('/api/mail/bulk/batch?id=' + bulk.body.batch.id)).body.batch; if (batchState.status !== 'sending') break; await new Promise(r => setTimeout(r, 25)); }
    assert.deepEqual([batchState.status, batchState.sent], ['done', 1]); assert.equal(smtp.state.sent.at(-1).parsed.subject, 'Hi Nordic Lamps AB'); assert.equal(smtp.state.sent.at(-1).parsed.text, 'Dear Anna');
    assert.equal((await request('/api/mail/bulk')).body.items.length, 1); assert.equal((await post('/api/mail/bulk/cancel', { id: bulk.body.batch.id })).status, 200);
    assert.equal((await post('/api/mail/trash', { box: 'inbox', uid: 5 })).status, 200); assert.equal(imap.state.boxes.get('Trash').messages.length, 1);
    assert.equal((await request('/api/mail/message?box=inbox&uid=5')).status, 404);
    assert.equal((await post('/api/mail-account/unbind', {})).status, 200); assert.equal((await request('/api/mail/messages?folder=inbox')).status, 409);
    for (const text of seen) assert.doesNotMatch(text, /app-password-1|wrong-password|"password"/);
    assert.doesNotMatch(await (await fetch(base + '/api/data', { headers: { 'x-trade-token': token } })).text(), /app-password-1|nordic-lamps|PI-1001/, 'mail never enters the business snapshot');
  } finally { if (child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); }); await imap.close(); await smtp.close(); fs.rmSync(temporary, { recursive: true, force: true }); }
});

test('the test-only mail endpoint override cannot apply to the real data folder', () => {
  const server = fs.readFileSync(path.join(__dirname, '../backend/server.js'), 'utf8');
  assert.match(server, /const mailTest = process\.env\.LAI_DATA_DIR && \/\^\\d\{1,5\},\\d\{1,5\}\$\/\.test\(process\.env\.LAI_MAIL_TEST_ENDPOINTS \|\| ''\)/);
  assert.match(server, /net\.connect\(mailTest\[0\], '127\.0\.0\.1'\)/); assert.match(server, /net\.connect\(mailTest\[1\], '127\.0\.0\.1'\)/);
  assert.match(fs.readFileSync(path.join(__dirname, '../backend/storage-path.js'), 'utf8'), /Lai override is restricted to canonical test directories/);
  assert.match(server, /downloadsDir: process\.env\.LAI_DATA_DIR \? path\.join\(store\.directory, 'downloads'\) : path\.join\(os\.homedir\(\), 'Downloads'\)/);
});
