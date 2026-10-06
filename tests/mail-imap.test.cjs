const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const imap = require('../backend/mail-imap.js');
const fake = require('./fixtures/fake-mail-servers.cjs');

// 登录验证由开源库 imapflow 完成；这里测来财自己的部分：服务器地址、输入校验、连接参数和错误说明。
const account = { email: 'sales@example-trade.com', password: 'app-password-1', site: 'cn', accountType: 'auto' };

test('Zoho servers come from a fixed list chosen by site and account type', () => {
  const server = (email, site, accountType) => { const r = imap.resolveServer({ email, site, accountType }); return [r.host, r.port, r.accountType]; };
  assert.deepEqual(server('a@zoho.com.cn', 'cn', 'auto'), ['imap.zoho.com.cn', 993, 'personal']);
  assert.deepEqual(server('sales@example-trade.com', 'cn', 'auto'), ['imappro.zoho.com.cn', 993, 'organization']);
  assert.deepEqual(server('a@zoho.com.cn', 'cn', 'organization'), ['imappro.zoho.com.cn', 993, 'organization']);
  assert.deepEqual(server('sales@example-trade.com', 'cn', 'personal'), ['imap.zoho.com.cn', 993, 'personal']);
  assert.deepEqual(server('a@zoho.com', 'com', 'auto'), ['imap.zoho.com', 993, 'personal']);
  assert.deepEqual(server('sales@example-trade.com', 'com', 'auto'), ['imappro.zoho.com', 993, 'organization']);
  assert.deepEqual(server('a@zoho.com', 'cn', 'auto'), ['imappro.zoho.com.cn', 993, 'organization'], 'a .com address on the CN site is not a CN personal mailbox');
  assert.equal(imap.resolveServer({ email: 'a@zoho.com.cn' }).host, 'imap.zoho.com.cn', 'defaults to the CN site');
  for (const bad of [{ site: 'evil.example' }, { site: '__proto__' }, { accountType: 'custom' }, { site: 'constructor' }])
    assert.throws(() => imap.resolveServer({ email: 'a@zoho.com.cn', ...bad }), { code: 'invalid_input' });
  assert.deepEqual(Object.values(imap.SITES).flatMap(site => [site.personal, site.organization]).sort(), ['imap.zoho.com', 'imap.zoho.com.cn', 'imappro.zoho.com', 'imappro.zoho.com.cn']);
});

test('real connections are always TLS to the resolved host, with certificate checks left on and logging off', () => {
  const { server, options } = imap.clientOptions({ ...account, host: 'attacker.example', port: 1 });
  assert.deepEqual(server, { site: 'cn', accountType: 'organization', host: 'imappro.zoho.com.cn', port: 993 });
  assert.deepEqual({ host: options.host, port: options.port, secure: options.secure, servername: options.servername, logger: options.logger, tls: options.tls }, { host: 'imappro.zoho.com.cn', port: 993, secure: true, servername: 'imappro.zoho.com.cn', logger: false, tls: { minVersion: 'TLSv1.2' } });
  assert.deepEqual(options.auth, { user: 'sales@example-trade.com', pass: 'app-password-1' }); assert.equal(options.doSTARTTLS, undefined); assert.equal(options.proxy, undefined);
  const local = imap.clientOptions(account, { host: '127.0.0.1', port: 1143 }).options;
  assert.deepEqual([local.host, local.port, local.secure, local.doSTARTTLS], ['127.0.0.1', 1143, false, false], 'only the test endpoint is plaintext');
  const source = ['mail-imap.js', 'mail-client.js', 'mail-smtp.js', 'mail-service.js', 'mail-libs.js'].map(file => fs.readFileSync(require.resolve('../backend/' + file), 'utf8')).join('\n');
  assert.doesNotMatch(source, /rejectUnauthorized|checkServerIdentity|console\.|NODE_TLS_REJECT_UNAUTHORIZED/);
});

test('invalid input is refused before any connection is attempted', async () => {
  for (const input of [
    { email: 'a@zoho.com.cn', password: 'x\r\nA9 DELETE INBOX' }, { email: 'a@zoho.com.cn', password: 'x\ny' }, { email: 'a@zoho.com.cn', password: 'x\u0000' },
    { email: 'a@zoho.com.cn', password: '' }, { email: 'a@zoho.com.cn', password: 12345678 }, { email: 'a@zoho.com.cn', password: 'x'.repeat(257) },
    { email: 'a"@zoho.com.cn', password: 'ok' }, { email: 'a b@zoho.com.cn', password: 'ok' }, { email: 'a@zoho.com.cn\r\nA9 LOGOUT', password: 'ok' },
    { email: '', password: 'ok' }, { email: 'no-at-sign', password: 'ok' }, { email: '用户@zoho.com.cn', password: 'ok' }, { email: 'a@zoho.com.cn', password: 'ok', site: 'attacker.example' },
  ]) await assert.rejects(imap.verifyLogin(input, { endpoint: { host: '127.0.0.1', port: 1 } }), { code: 'invalid_input' }, JSON.stringify(input.email));
});

test('login verification succeeds with the right password and only logs in and out', async () => {
  const server = await fake.startImap({});
  try {
    assert.deepEqual(await imap.verifyLogin({ ...account, email: ' Sales@Example-Trade.com ' }, { endpoint: server.endpoint }), { site: 'cn', accountType: 'organization', host: 'imappro.zoho.com.cn', port: 993 });
    for (let i = 0; i < 200 && !server.state.commands.includes('LOGOUT'); i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.deepEqual(server.state.commands.filter(command => !/^(CAPABILITY|NOOP|LIST "" ""$)/.test(command)), ['LOGIN sales@example-trade.com ***', 'LOGOUT']);
    assert.ok(server.state.commands.every(command => !/^(SELECT|EXAMINE|UID|STATUS|LSUB)/.test(command)), 'no mailbox is opened and nothing is read');
    await imap.verifyLogin({ ...account, password: 'p"a\\ss w0rd' }, { endpoint: (await (async () => { server.state.password = 'p"a\\ss w0rd'; return server; })()).endpoint });
    server.state.password = '密码abc'; await imap.verifyLogin({ ...account, password: '密码abc' }, { endpoint: server.endpoint });
  } finally { await server.close(); }
});

test('a rejected login, an unreachable server and a non-mail server each explain themselves without the password', async () => {
  const server = await fake.startImap({});
  try {
    await assert.rejects(imap.verifyLogin({ ...account, password: 'Secret-Pass-9981' }, { endpoint: server.endpoint }), (error) => {
      assert.equal(error.code, 'auth_failed'); assert.match(error.message, /应用专用密码/); assert.match(error.message, /IMAP/); assert.match(error.message, /Invalid credentials/);
      assert.doesNotMatch(error.message, /Secret-Pass-9981/); assert.doesNotMatch(error.message, /[\u0000-\u001f]/);
      return true;
    });
    server.state.greeting = '* BYE too many connections\r\n';
    await assert.rejects(imap.verifyLogin(account, { endpoint: server.endpoint }), error => ['network', 'protocol', 'imap_no'].includes(error.code) && !/app-password-1/.test(error.message));
  } finally { await server.close(); }
  await assert.rejects(imap.verifyLogin(account, { endpoint: { host: '127.0.0.1', port: 1 } }), error => error.code === 'network' && /无法连接邮箱服务器 imappro\.zoho\.com\.cn/.test(error.message));
  const web = net.createServer(socket => { socket.on('error', () => {}); socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); });
  await new Promise(resolve => web.listen(0, '127.0.0.1', resolve));
  try { await assert.rejects(imap.verifyLogin(account, { endpoint: { host: '127.0.0.1', port: web.address().port } }), error => ['network', 'protocol', 'timeout'].includes(error.code)); }
  finally { await new Promise(resolve => web.close(resolve)); }
});

test('library errors are translated into plain explanations', () => {
  const t = (error) => { const out = imap.translate(error, 'imap.zoho.com.cn'); return [out.code, out.message]; };
  assert.deepEqual(t({ code: 'ENOTFOUND' })[0], 'network'); assert.match(t({ code: 'ENOTFOUND' })[1], /找不到邮箱服务器 imap\.zoho\.com\.cn.*站点/);
  for (const code of ['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'ERR_TLS_CERT_ALTNAME_INVALID', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE']) { assert.equal(t({ code })[0], 'tls', code); assert.match(t({ code })[1], /证书/); }
  assert.equal(t({ code: 'ETIMEDOUT' })[0], 'timeout'); assert.equal(t({ code: 'ECONNREFUSED' })[0], 'network');
  assert.deepEqual(t({ authenticationFailed: true, responseText: 'Invalid\u0007 credentials' })[0], 'auth_failed'); assert.doesNotMatch(t({ authenticationFailed: true, responseText: 'Invalid\u0007 credentials' })[1], /\u0007/);
  assert.deepEqual(t({ responseStatus: 'NO', responseText: 'try later' }), ['imap_no', '邮箱服务器拒绝了这个请求：try later']);
  const passthrough = Object.assign(new Error('gone'), { status: 404, code: 'not_found' }); assert.equal(imap.translate(passthrough, 'h'), passthrough);
  const already = imap.mailError('auth_failed', 'x'); assert.equal(imap.translate(already, 'h'), already);
  assert.equal(t(new Error('weird'))[0], 'network');
});
