const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { openStorage } = require('./storage.js');
const { createAuth } = require('./auth.js');
const { httpError } = require('./errors.js');
const { createMailAccounts } = require('./mail-account.js');
const { createMailService } = require('./mail-service.js');
const mailImap = require('./mail-imap.js');
const { createOpportunityFiles, MAX_BYTES: MAX_OPPORTUNITY_FILE } = require('./opportunity-files.js');
const os = require('node:os');

const port = Number(process.env.LAI_APP_PORT || (49152 + crypto.randomInt(16383)));
const apiToken = String(process.env.LAI_API_TOKEN || crypto.randomBytes(32).toString('base64url'));
const instanceNonce = String(process.env.LAI_INSTANCE_NONCE || crypto.randomBytes(24).toString('base64url'));
const htmlFile = path.join(__dirname, 'trade-order-system.html');
const store = openStorage({ seedFile: path.join(__dirname, 'trade-order-data.json') });
const auth = createAuth({ port, token: apiToken });
// 仅供隔离测试：数据目录被改到测试目录时（storage-path.js 只允许系统临时目录下的 lai-test-*），
// 可以把邮件连接指到本机回环地址上的假服务器。正式数据目录下这个变量不起作用。
const mailTest = process.env.LAI_DATA_DIR && /^\d{1,5},\d{1,5}$/.test(process.env.LAI_MAIL_TEST_ENDPOINTS || '') ? process.env.LAI_MAIL_TEST_ENDPOINTS.split(',').map(Number) : null;
const mailEndpoints = mailTest ? { imap: { host: '127.0.0.1', port: mailTest[0] }, smtp: { host: '127.0.0.1', port: mailTest[1] } } : {};
const mailAccounts = createMailAccounts({ store, verify: input => mailImap.verifyLogin(input, mailEndpoints.imap ? { endpoint: mailEndpoints.imap } : {}) });
const downloadsDir = process.env.LAI_DATA_DIR ? path.join(store.directory, 'downloads') : path.join(os.homedir(), 'Downloads');
const opportunityFiles = createOpportunityFiles({
  attachmentsDir: path.join(store.directory, 'attachments'), downloadsDir,
  reveal: file => { if (process.env.LAI_APP_NO_OPEN !== '1') spawn('/usr/bin/open', ['-R', file], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref(); }
});
const mailService = createMailService({
  store, endpoints: mailEndpoints,
  // 登录邮箱后连接保留 3 分钟，期间的操作不用重新登录。
  keepAliveMs: 3 * 60 * 1000,
  downloadsDir: process.env.LAI_DATA_DIR ? path.join(store.directory, 'downloads') : path.join(os.homedir(), 'Downloads'),
  reveal: file => { if (process.env.LAI_APP_NO_OPEN !== '1') spawn('/usr/bin/open', ['-R', file], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref(); }
});
const mailRoutes = {
  'GET /api/mail/messages': query => mailService.list({ folder: query.get('folder'), page: query.get('page'), query: query.get('query') }),
  'GET /api/mail/correspondence': query => mailService.correspondence({ addresses: query.get('addresses') }),
  'GET /api/mail/message': query => mailService.read({ box: query.get('box'), uid: query.get('uid') }),
  'GET /api/mail/status': () => mailService.status(),
  'GET /api/mail/drafts': () => mailService.drafts(),
  'GET /api/mail/draft': query => mailService.getDraft({ id: query.get('id') }),
  'GET /api/mail/templates': () => mailService.templates(),
  'POST /api/mail/templates/save': (_, body) => mailService.saveTemplate(body),
  'POST /api/mail/templates/delete': (_, body) => mailService.deleteTemplate(body),
  'POST /api/mail/flags': (_, body) => mailService.flags(body),
  'POST /api/mail/trash': (_, body) => mailService.trash(body),
  'POST /api/mail/attachment/save': (_, body) => mailService.saveAttachment(body),
  'POST /api/mail/send': (_, body) => mailService.send(body),
  'POST /api/mail/drafts/save': (_, body) => mailService.saveDraft(body),
  'POST /api/mail/drafts/delete': (_, body) => mailService.deleteDraft(body),
  'GET /api/mail/bulk': () => mailService.bulkList(),
  'GET /api/mail/bulk/batch': query => mailService.bulkGet({ id: query.get('id') }),
  'POST /api/mail/bulk/start': (_, body) => mailService.bulkStart(body),
  'POST /api/mail/bulk/cancel': (_, body) => mailService.bulkCancel(body),
  'POST /api/mail-account/settings': (_, body) => mailAccounts.settings(body),
};
const allowedRoutes = new Set(['GET /', 'GET /trade-order-system.html', 'GET /vendor/xlsx.full.min.js', 'GET /vendor/purify.min.js', 'GET /vendor/squire-raw.js', 'GET /api/health', 'GET /api/data', 'GET /api/backup-status', 'GET /api/import-log', 'POST /api/save', 'POST /api/save-changes', 'POST /api/manual-backup', 'GET /api/backups', 'POST /api/restore', 'GET /api/opportunity-file', 'POST /api/opportunity-file/upload', 'POST /api/opportunity-file/save', 'POST /api/opportunity-file/delete', 'GET /api/mail-account', 'POST /api/mail-account/bind', 'POST /api/mail-account/verify', 'POST /api/mail-account/unbind', ...Object.keys(mailRoutes)]);

// 群发是否正在进行：mailService.bulkIdle() 在没有群发时返回已完成的 Promise，有群发时返回还没完成的那个。
async function bulkSending() {
  const idle = Symbol('idle');
  return (await Promise.race([mailService.bulkIdle().then(() => idle), Promise.resolve().then(() => null)])) !== idle;
}

function securityHeaders(type = '') {
  return {
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    ...(type ? { 'Content-Type': type } : {})
  };
}

function send(res, status, body, type = 'application/json; charset=utf-8', headers = {}) {
  res.writeHead(status, { ...securityHeaders(type), ...headers });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let bytes = 0, rejected = false;
    const chunks = [];
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 64 * 1024 * 1024) {
        if (!rejected) reject(httpError(413, 'request body too large'));
        rejected = true; chunks.length = 0; return;
      }
      if (!rejected) chunks.push(chunk);
    });
    req.on('end', () => {
      if (rejected) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (_) { reject(httpError(400, 'invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

// 商机附件：整个请求体就是文件内容（不转成 JSON/base64，20 MB 的文件也不会占两倍以上内存）。
function readRawBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) { req.resume(); return reject(httpError(413, '文件超过 20 MB，请压缩后再传', { code: 'too_large' })); }
    let bytes = 0, rejected = false;
    const chunks = [];
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > limit) { if (!rejected) reject(httpError(413, '文件超过 20 MB，请压缩后再传', { code: 'too_large' })); rejected = true; chunks.length = 0; return; }
      if (!rejected) chunks.push(chunk);
    });
    req.on('end', () => { if (!rejected) resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    auth.validateHost(req);
    auth.validateOrigin(req);
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (!allowedRoutes.has(`${req.method} ${url.pathname}`)) throw httpError(404, 'not found');
    const isDocument = req.method === 'GET' && ['/', '/trade-order-system.html'].includes(url.pathname);
    if (isDocument && url.searchParams.has('token')) {
      if (!auth.matches(url.searchParams.get('token'))) throw httpError(401, 'invalid API session token');
      const redirect = new URL('/trade-order-system.html', `http://127.0.0.1:${port}`);
      for (const [key, value] of url.searchParams) if (key !== 'token') redirect.searchParams.append(key, value);
      return send(res, 303, '', 'text/plain; charset=utf-8', { Location: redirect.pathname + redirect.search + '#customers', 'Set-Cookie': auth.cookie() });
    }
    if (req.method === 'GET' && url.pathname === '/api/health') {
      const details = store.health();
      const health = auth.authorized(req) ? { ...details, instanceNonce } : {
        ok: details.ok, instanceNonce, storageMode: details.storageMode, storageRevision: details.storageRevision,
        integrity: { ok: details.ok, message: details.ok ? 'ok' : 'storage unavailable' }
      };
      return send(res, details.ok ? 200 : 500, JSON.stringify(health));
    }
    if (!auth.authorized(req)) throw httpError(401, 'API session token required');
    if (isDocument) return send(res, 200, fs.readFileSync(htmlFile), 'text/html; charset=utf-8');
    if (url.pathname === '/vendor/purify.min.js' || url.pathname === '/vendor/squire-raw.js') return send(res, 200, fs.readFileSync(path.join(__dirname, 'vendor', path.basename(url.pathname))), 'text/javascript; charset=utf-8');
    if (url.pathname === '/vendor/xlsx.full.min.js') return send(res, 200, fs.readFileSync(path.join(__dirname, 'vendor/xlsx.full.min.js')), 'text/javascript; charset=utf-8');
    if (url.pathname === '/api/data') return send(res, 200, JSON.stringify(store.readSnapshot()));
    if (url.pathname === '/api/import-log') return send(res, 200, JSON.stringify({ok:true,issues:store.readImportLog(url.searchParams.get('id'))}));
    if (url.pathname === '/api/save') {
      if (String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') throw httpError(415, 'Content-Type must be application/json');
      const request = await readJsonBody(req);
      const payload = request?.state && typeof request.state === 'object' ? request.state : request;
      const result = store.save(payload, { baseRevision: request?.baseRevision ?? payload?.baseRevision, importLog:request?.importLog });
      // 备份不在这里马上做：存储层的备份队列会在一小时内补上（见 storage.js 的 queueBackup）。
      return send(res, 200, JSON.stringify({ ok: true, storageMode: 'sqlite', ...result, backup: store.backupStatus() }));
    }
    if (url.pathname === '/api/mail-account') return send(res, 200, JSON.stringify(mailAccounts.status()));
    if (url.pathname === '/api/mail-account/bind') {
      if (String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') throw httpError(415, 'Content-Type must be application/json');
      const bound = await mailAccounts.bind(await readJsonBody(req));
      mailService.forget();
      return send(res, 200, JSON.stringify(bound));
    }
    if (url.pathname === '/api/mail-account/verify') return send(res, 200, JSON.stringify(await mailAccounts.reverify()));
    if (url.pathname === '/api/mail-account/unbind') { const result = mailAccounts.unbind(); mailService.forget(); return send(res, 200, JSON.stringify(result)); }
    if (url.pathname === '/api/opportunity-file' && req.method === 'GET') {
      const file = opportunityFiles.read(url.searchParams.get('url'));
      return send(res, 200, file.body, file.type, file.headers);
    }
    if (url.pathname === '/api/opportunity-file/upload') {
      if (String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/octet-stream') throw httpError(415, 'Content-Type must be application/octet-stream');
      const body = await readRawBody(req, MAX_OPPORTUNITY_FILE);
      return send(res, 200, JSON.stringify(opportunityFiles.upload({ id: url.searchParams.get('id'), name: url.searchParams.get('name'), type: url.searchParams.get('type'), body })));
    }
    if (url.pathname === '/api/opportunity-file/save' || url.pathname === '/api/opportunity-file/delete') {
      if (String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') throw httpError(415, 'Content-Type must be application/json');
      const body = await readJsonBody(req);
      return send(res, 200, JSON.stringify(url.pathname.endsWith('/save') ? opportunityFiles.saveCopy(body || {}) : opportunityFiles.remove((body || {}).fileUrls)));
    }
    const mailRoute = mailRoutes[`${req.method} ${url.pathname}`];
    if (mailRoute) {
      let body;
      if (req.method === 'POST') {
        if (String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') throw httpError(415, 'Content-Type must be application/json');
        body = await readJsonBody(req);
      }
      return send(res, 200, JSON.stringify(await mailRoute(url.searchParams, body)));
    }
    if (url.pathname === '/api/save-changes') {
      if (String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') throw httpError(415, 'Content-Type must be application/json');
      const request = await readJsonBody(req);
      const result = store.saveChanges(request?.changes, { baseRevision: request?.baseRevision, importLog: request?.importLog });
      return send(res, 200, JSON.stringify({ ok: true, storageMode: 'sqlite', ...result, backup: store.backupStatus() }));
    }
    if (url.pathname === '/api/backup-status') return send(res, 200, JSON.stringify({ ok: true, backup: store.backupStatus() }));
    if (url.pathname === '/api/manual-backup') {
      const backup = store.backup(true, 'manual');
      return send(res, backup.ok ? 200 : 503, JSON.stringify(backup));
    }
    if (url.pathname === '/api/backups') return send(res, 200, JSON.stringify({ ok: true, backups: store.listBackups() }));
    if (url.pathname === '/api/restore') {
      if (String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') throw httpError(415, 'Content-Type must be application/json');
      const body = await readJsonBody(req);
      // 群发还在发送时不恢复：发送记录会写进换上来的数据里。
      if (await bulkSending()) throw httpError(409, '群发邮件还在发送，请等它发完或先停止，再恢复备份。', { code: 'bulk_sending' });
      // 保存和恢复都是同步执行的（中间不让出），所以恢复不会和一次保存交错；保存要么在恢复前完成，要么在恢复后按版本号被拒（409）。
      const result = store.restoreBackup(body?.name);
      // 恢复后邮箱账号可能换了：丢掉旧的邮箱连接和缓存。
      mailService.forget();
      return send(res, 200, JSON.stringify(result));
    }
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 500;
    return send(res, status, JSON.stringify({ ok: false, message: error.message || 'internal server error', ...(Number.isInteger(error.currentRevision) ? { currentRevision: error.currentRevision } : {}), ...(typeof error.code === 'string' && /^[a-z_]+$/.test(error.code) ? { code: error.code } : {}) }), 'application/json; charset=utf-8', status === 401 ? { 'WWW-Authenticate': 'Bearer' } : {});
  }
});

let stopping = false;
// Browser preconnections have no HTTP request for closeIdleConnections to close.
const awaitingRequest = new Set();
server.on('connection', socket => {
  if (stopping) return socket.destroy();
  awaitingRequest.add(socket);
  socket.once('close', () => awaitingRequest.delete(socket));
});
server.on('request', req => awaitingRequest.delete(req.socket));
server.listen(port, '127.0.0.1', () => {
  if (process.env.LAI_APP_NO_OPEN !== '1') spawn('/usr/bin/open', [`http://127.0.0.1:${port}/trade-order-system.html?token=${encodeURIComponent(apiToken)}#customers`], { detached: true, stdio: 'ignore' }).unref();
});
function shutdown() {
  if (stopping) return;
  stopping = true;
  const timeout = setTimeout(() => process.exit(1), 5000); timeout.unref();
  server.close(() => {
    try { store.close(); clearTimeout(timeout); process.exit(0); }
    catch (_) { clearTimeout(timeout); process.exit(1); }
  });
  for (const socket of awaitingRequest) socket.destroy();
  server.closeIdleConnections?.();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
