const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { openStorage } = require('./storage.js');
const { createAuth } = require('./auth.js');
const { httpError } = require('./errors.js');

const port = Number(process.env.LAI_APP_PORT || (49152 + crypto.randomInt(16383)));
const apiToken = String(process.env.LAI_API_TOKEN || crypto.randomBytes(32).toString('base64url'));
const instanceNonce = String(process.env.LAI_INSTANCE_NONCE || crypto.randomBytes(24).toString('base64url'));
const htmlFile = path.join(__dirname, 'trade-order-system.html');
const store = openStorage({ seedFile: path.join(__dirname, 'trade-order-data.json') });
const auth = createAuth({ port, token: apiToken });
const allowedRoutes = new Set(['GET /', 'GET /trade-order-system.html', 'GET /vendor/xlsx.full.min.js', 'GET /api/health', 'GET /api/data', 'GET /api/import-log', 'POST /api/save', 'POST /api/manual-backup', 'POST /api/open-data-folder']);

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
      if (bytes > 16 * 1024 * 1024) {
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
    if (url.pathname === '/vendor/xlsx.full.min.js') return send(res, 200, fs.readFileSync(path.join(__dirname, 'vendor/xlsx.full.min.js')), 'text/javascript; charset=utf-8');
    if (url.pathname === '/api/data') return send(res, 200, JSON.stringify(store.readSnapshot()));
    if (url.pathname === '/api/import-log') return send(res, 200, JSON.stringify({ok:true,issues:store.readImportLog(url.searchParams.get('id'))}));
    if (url.pathname === '/api/save') {
      if (String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase() !== 'application/json') throw httpError(415, 'Content-Type must be application/json');
      const request = await readJsonBody(req);
      const payload = request?.state && typeof request.state === 'object' ? request.state : request;
      const result = store.save(payload, { baseRevision: request?.baseRevision ?? payload?.baseRevision, importLog:request?.importLog });
      let backup;
      try { backup = store.backup(false); } catch (error) { backup = { ok: false, message: error.message || 'automatic backup failed' }; }
      return send(res, 200, JSON.stringify({ ok: true, storageMode: 'sqlite', ...result, backup }));
    }
    if (url.pathname === '/api/manual-backup') {
      const backup = store.backup(true);
      return send(res, backup.ok ? 200 : 503, JSON.stringify(backup));
    }
    if (url.pathname === '/api/open-data-folder') {
      // Recheck the directory before handing the path to Finder.
      store.readSnapshot();
      await new Promise((resolve, reject) => {
        const child = spawn('/usr/bin/open', [store.directory], { stdio: 'ignore' });
        child.once('error', reject);
        child.once('close', code => code === 0 ? resolve() : reject(httpError(503, 'unable to open data directory')));
      });
      return send(res, 200, JSON.stringify({ ok: true, path: store.directory }));
    }
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 500;
    return send(res, status, JSON.stringify({ ok: false, message: error.message || 'internal server error', ...(Number.isInteger(error.currentRevision) ? { currentRevision: error.currentRevision } : {}) }), 'application/json; charset=utf-8', status === 401 ? { 'WWW-Authenticate': 'Bearer' } : {});
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
