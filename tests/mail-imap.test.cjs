const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const imap = require('../backend/mail-imap.js');

// 本机假 IMAP 服务：按脚本应答并记录客户端发来的每一行。不连接任何真实邮箱。
async function fakeServer(script) {
  const received = [];
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    socket.setEncoding('utf8');
    let buffer = '';
    const reply = (text) => { if (text !== undefined && text !== null) socket.write(text); };
    reply(script.greeting === undefined ? '* OK fake IMAP ready\r\n' : script.greeting);
    if (script.closeAfterGreeting) return socket.end();
    socket.on('data', (chunk) => {
      buffer += chunk;
      let index;
      while ((index = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        received.push(line);
        reply(script.onLine(line, received));
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  return {
    received,
    connect: () => net.connect(port, '127.0.0.1'),
    close: () => new Promise(resolve => { for (const s of sockets) s.destroy(); server.close(resolve); }),
  };
}
const accept = line => /^A1 LOGIN/.test(line) ? 'A1 OK LOGIN completed\r\n' : /^A2 LOGOUT/.test(line) ? '* BYE\r\nA2 OK\r\n' : null;
const until = async (check) => { for (let i = 0; i < 200 && !check(); i++) await new Promise(r => setTimeout(r, 5)); };

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
  const hosts = Object.values(imap.SITES).flatMap(site => [site.personal, site.organization]);
  assert.deepEqual(hosts.sort(), ['imap.zoho.com', 'imap.zoho.com.cn', 'imappro.zoho.com', 'imappro.zoho.com.cn']);
});

test('a successful login sends only LOGIN and LOGOUT', async () => {
  const fake = await fakeServer({ onLine: accept });
  try {
    const result = await imap.verifyLogin({ email: ' Sales@Example-Trade.com ', password: 'abcd efgh1234', site: 'cn' }, { connect: fake.connect });
    assert.deepEqual(result, { site: 'cn', accountType: 'organization', host: 'imappro.zoho.com.cn', port: 993 });
    await until(() => fake.received.length >= 2);
    assert.deepEqual(fake.received, ['A1 LOGIN "sales@example-trade.com" "abcd efgh1234"', 'A2 LOGOUT']);
  } finally { await fake.close(); }
});

test('quotes and backslashes in the password are escaped, not interpreted', async () => {
  const fake = await fakeServer({ onLine: accept });
  try {
    await imap.verifyLogin({ email: 'a@zoho.com.cn', password: 'p"a\\ss" A9 LOGOUT' }, { connect: fake.connect });
    assert.equal(fake.received[0], 'A1 LOGIN "a@zoho.com.cn" "p\\"a\\\\ss\\" A9 LOGOUT"');
  } finally { await fake.close(); }
});

test('a non-ASCII password is sent as a literal after the server continues', async () => {
  const fake = await fakeServer({ onLine: (line, all) => /^A1 LOGIN .* \{\d+\}$/.test(line) ? '+ go ahead\r\n' : all.length === 2 ? 'A1 OK\r\n' : accept(line) });
  try {
    await imap.verifyLogin({ email: 'a@zoho.com.cn', password: '密码abc' }, { connect: fake.connect });
    assert.equal(fake.received[0], `A1 LOGIN "a@zoho.com.cn" {${Buffer.byteLength('密码abc')}}`);
    assert.equal(fake.received[1], '密码abc');
  } finally { await fake.close(); }
});

test('input that could inject IMAP commands is refused before connecting', async () => {
  let connects = 0;
  const connect = () => { connects++; throw new Error('must not connect'); };
  for (const input of [
    { email: 'a@zoho.com.cn', password: 'x\r\nA9 DELETE INBOX' }, { email: 'a@zoho.com.cn', password: 'x\ny' }, { email: 'a@zoho.com.cn', password: 'x\u0000' },
    { email: 'a@zoho.com.cn', password: '' }, { email: 'a@zoho.com.cn', password: 12345678 }, { email: 'a@zoho.com.cn', password: 'x'.repeat(257) },
    { email: 'a"@zoho.com.cn', password: 'ok' }, { email: 'a b@zoho.com.cn', password: 'ok' }, { email: 'a@zoho.com.cn\r\nA9 LOGOUT', password: 'ok' },
    { email: '', password: 'ok' }, { email: 'no-at-sign', password: 'ok' }, { email: '用户@zoho.com.cn', password: 'ok' },
    { email: 'a@zoho.com.cn', password: 'ok', site: 'attacker.example' },
  ]) assert.throws(() => imap.verifyLogin(input, { connect }), { code: 'invalid_input' }, JSON.stringify(input.email));
  assert.equal(connects, 0);
});

test('a rejected login reports the cause without echoing the password', async () => {
  const fake = await fakeServer({ onLine: line => /^A1 LOGIN/.test(line) ? 'A1 NO [AUTHENTICATIONFAILED] Invalid credentials\x07\x1b[31m\r\n' : null });
  try {
    await assert.rejects(imap.verifyLogin({ email: 'a@zoho.com.cn', password: 'Secret-Pass-9981' }, { connect: fake.connect }), (error) => {
      assert.equal(error.code, 'auth_failed');
      assert.match(error.message, /应用专用密码/); assert.match(error.message, /IMAP/); assert.match(error.message, /Invalid credentials/);
      assert.doesNotMatch(error.message, /Secret-Pass-9981/); assert.doesNotMatch(error.message, /[\x00-\x1f]/);
      return true;
    });
  } finally { await fake.close(); }
});

test('server refusals, wrong services, silence and dropped connections each fail clearly', async () => {
  const cases = [
    [{ greeting: '* BYE too many connections\r\n', onLine: () => null }, 'protocol', /too many connections/],
    [{ greeting: 'HTTP/1.1 400 Bad Request\r\n', onLine: () => null }, 'protocol', /不是 IMAP/],
    [{ greeting: '', closeAfterGreeting: true, onLine: () => null }, 'network', /断开/],
    [{ onLine: line => /^A1 LOGIN/.test(line) ? '* BYE autologout\r\n' : null }, 'protocol', /autologout/],
    [{ greeting: '* OK ' + 'x'.repeat(70000), onLine: () => null }, 'protocol', /异常/],
  ];
  for (const [script, code, pattern] of cases) {
    const fake = await fakeServer(script);
    try { await assert.rejects(imap.verifyLogin({ email: 'a@zoho.com.cn', password: 'ok-password' }, { connect: fake.connect }), error => error.code === code && pattern.test(error.message), code + ' ' + pattern); }
    finally { await fake.close(); }
  }
  const silent = await fakeServer({ greeting: '', onLine: () => null });
  try { await assert.rejects(imap.verifyLogin({ email: 'a@zoho.com.cn', password: 'ok-password' }, { connect: silent.connect, timeoutMs: 60 }), { code: 'timeout' }); }
  finally { await silent.close(); }
  const stalled = await fakeServer({ onLine: () => null });
  try {
    await assert.rejects(imap.verifyLogin({ email: 'a@zoho.com.cn', password: 'ok-password' }, { connect: stalled.connect, timeoutMs: 60 }), { code: 'timeout' });
    assert.equal(stalled.received.length, 1, 'only the login was sent');
  } finally { await stalled.close(); }
});

test('connection errors are translated and never retried on another host', async () => {
  const failing = (code) => () => { const { EventEmitter } = require('node:events'); const s = new EventEmitter(); s.write = () => {}; s.destroy = () => {}; setImmediate(() => s.emit('error', Object.assign(new Error('x'), { code }))); return s; };
  let attempts = 0;
  for (const [code, expected, pattern] of [['ENOTFOUND', 'network', /找不到邮箱服务器 imap\.zoho\.com\.cn.*站点/], ['ECONNREFUSED', 'network', /无法连接/], ['ETIMEDOUT', 'timeout', /超时/], ['CERT_HAS_EXPIRED', 'tls', /证书/], ['DEPTH_ZERO_SELF_SIGNED_CERT', 'tls', /证书/], ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls', /证书/]]) {
    const connect = failing(code);
    await assert.rejects(imap.verifyLogin({ email: 'a@zoho.com.cn', password: 'ok-password' }, { connect: (...args) => { attempts++; return connect(...args); } }), error => error.code === expected && pattern.test(error.message), code);
  }
  assert.equal(attempts, 6);
});

test('the real connection is TLS to the resolved host with certificate checks left on', () => {
  const source = require('node:fs').readFileSync(require.resolve('../backend/mail-imap.js'), 'utf8');
  assert.match(source, /tls\.connect\(\{ host: server\.host, port: server\.port, servername: server\.host, minVersion: 'TLSv1\.2' \}\)/);
  assert.doesNotMatch(source, /rejectUnauthorized|checkServerIdentity|console\.|STARTTLS/);
  assert.doesNotMatch(source, /SELECT|FETCH|APPEND|STORE|EXPUNGE|smtp/i);
});
