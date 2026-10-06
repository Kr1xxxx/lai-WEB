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
  for (const file of ['server.js', 'storage.js', 'storage-path.js', 'auth.js', 'errors.js', 'mail-account.js', 'mail-imap.js']) fs.copyFileSync(path.join(__dirname, '../backend', file), path.join(resources, file));
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
