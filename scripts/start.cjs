#!/usr/bin/env node
'use strict';
// `npm start`: assemble the local app into dist/app/, start the real backend (backend/server.js) on
// 127.0.0.1 with the default data directory (backend/storage-path.js), and open it in the browser.
// No dependencies. Needs Node 24+ (node:sqlite) and Python 3 (scripts/build.py assembles the page).
//
// Env: LAI_APP_PORT (port; default 47830, falls back to a free port when something else holds it),
// LAI_APP_NO_OPEN=1 (print the address instead of opening the browser), LAI_DATA_DIR (passed through;
// storage-path.js only accepts lai-test-* directories under the system temp dir, for tests).
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const DEFAULT_PORT = 47830;
const HEALTH_TIMEOUT_MS = 30000;
const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');

/**
 * Returns a Chinese message when this Node cannot run 来财, or '' when it can. Node 24+ is what we support
 * (CI runs it); 22.5–23 has node:sqlite too and still runs, with a hint to upgrade (see runtimeHint).
 */
function runtimeProblem(version = process.versions.node, loadSqlite = () => require('node:sqlite')) {
  const [major, minor] = String(version).split('.').map(Number);
  if (!(major > 22 || (major === 22 && minor >= 5))) return `来财需要 Node 24 或更新的版本，这台电脑上是 ${version}。请到 https://nodejs.org 下载安装最新的 Node（LTS 版），再运行 npm start。`;
  try { loadSqlite(); } catch (_) {
    return `这个 Node（${version}）里没有 node:sqlite，来财用不了。请到 https://nodejs.org 下载安装最新的 Node（LTS 版），再运行 npm start。`;
  }
  return '';
}
function runtimeHint(version = process.versions.node) {
  return Number(String(version).split('.')[0]) >= 24 ? '' : `提示：这台电脑上的 Node 是 ${version}，建议升级到 Node 24 或更新的版本（https://nodejs.org）。`;
}

function writeAtomic(file, content) {
  const temp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  fs.writeFileSync(temp, content);
  fs.renameSync(temp, file);
}

/** Copies backend/*.js and the vendor files, and writes the assembled page, into outDir. */
function assembleApp(outDir = path.join(distDir, 'app')) {
  const { VENDOR_FILES, backendFiles, assembleHtml } = require('./app-files.cjs');
  let html;
  try { html = assembleHtml(root); } catch (error) {
    const reason = error.code === 'ENOENT' ? '没有找到 python3。请先安装 Python 3（https://www.python.org）。' : String(error.stderr || error.message).trim();
    throw new Error('拼装页面失败：' + reason);
  }
  fs.mkdirSync(path.join(outDir, 'vendor'), { recursive: true });
  for (const name of backendFiles(root)) writeAtomic(path.join(outDir, name), fs.readFileSync(path.join(root, 'backend', name)));
  for (const [from, to] of VENDOR_FILES) writeAtomic(path.join(outDir, 'vendor', to), fs.readFileSync(path.join(root, from)));
  writeAtomic(path.join(outDir, 'trade-order-system.html'), html);
  return outDir;
}

const appUrl = (port, token) => `http://127.0.0.1:${port}/trade-order-system.html?token=${encodeURIComponent(token)}#dashboard`;

/** GET /api/health; resolves to the parsed body when it answers like a 来财 server, else null. */
async function laiHealth(port, token) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: token ? { 'x-trade-token': token } : {}, signal: AbortSignal.timeout(2000),
    });
    const body = await response.json();
    return body && typeof body === 'object' && 'instanceNonce' in body && 'storageMode' in body ? { status: response.status, body } : null;
  } catch (_) { return null; }
}

const portIsFree = (port) => new Promise((resolve) => {
  const server = net.createServer();
  server.once('error', () => resolve(false));
  server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
});
const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
});

function openBrowser(url) {
  const [command, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')]]
      : ['xdg-open', [url]];
  try {
    const child = childProcess.spawn(command, args, { detached: true, stdio: 'ignore', windowsVerbatimArguments: process.platform === 'win32' });
    child.on('error', () => console.log('没能自动打开浏览器，请把上面的地址复制到浏览器里打开。'));
    child.unref();
  } catch (_) { console.log('没能自动打开浏览器，请把上面的地址复制到浏览器里打开。'); }
}

// One record per data directory, under dist/run/ (never inside the data directory), so a second
// `npm start` finds the server that already uses that directory instead of starting another one.
function runRecordFile(dataDir) {
  return path.join(distDir, 'run', crypto.createHash('sha256').update(dataDir).digest('hex').slice(0, 16) + '.json');
}
function readRunRecord(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}
function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

const tail = (text) => text.trim().split('\n').slice(-20).join('\n');

async function main() {
  const problem = runtimeProblem();
  if (problem) { console.error(problem); return 1; }
  const hint = runtimeHint();
  if (hint) console.log(hint);

  // Resolve the data directory the server will use (and reject a bad LAI_DATA_DIR early).
  const { laiDataDirectory } = require('../backend/storage-path.js');
  const dataDir = laiDataDirectory({ scan: false });
  const noOpen = process.env.LAI_APP_NO_OPEN === '1';
  const announce = (url) => {
    console.log(`来财已启动：${url}（关掉这个窗口或按 Ctrl+C 就会停止）`);
    if (!noOpen) openBrowser(url);
  };

  // 1. Is 来财 already running on this data directory?
  const recordFile = runRecordFile(dataDir);
  const record = readRunRecord(recordFile);
  if (record && processAlive(record.pid)) {
    const health = await laiHealth(record.port, record.token);
    if (health && health.body.instanceNonce === record.nonce) {
      const url = appUrl(record.port, record.token);
      console.log(`来财已经在运行：${url}`);
      if (!noOpen) openBrowser(url);
      return 0;
    }
  }
  const requestedPort = process.env.LAI_APP_PORT ? Number(process.env.LAI_APP_PORT) : DEFAULT_PORT;
  if (!Number.isInteger(requestedPort) || requestedPort < 1 || requestedPort > 65535) {
    console.error(`LAI_APP_PORT 不是有效的端口号：${process.env.LAI_APP_PORT}`); return 1;
  }
  if (await laiHealth(requestedPort)) {
    // A 来财 server we did not start (or whose record is gone): we do not have its token, and starting a
    // second server on the same data could lose changes, so stop here.
    console.log(`来财已经在运行（端口 ${requestedPort}）。请回到已经打开的来财页面；找不到的话，先关掉原来的窗口再运行 npm start。`);
    return 0;
  }
  let port = requestedPort;
  if (!(await portIsFree(port))) {
    if (process.env.LAI_APP_PORT) { console.error(`端口 ${port} 被别的程序占用了，请换一个 LAI_APP_PORT 或不设它。`); return 1; }
    port = await freePort();
  }

  // 2. Assemble the app (every start, so the page always matches the source).
  let appDir;
  try { appDir = assembleApp(); } catch (error) { console.error(error.message); return 1; }

  // 3. Start the server.
  const token = crypto.randomBytes(32).toString('base64url');
  const nonce = crypto.randomBytes(24).toString('base64url');
  // On macOS the server opens the browser itself (and can show saved files in Finder); elsewhere its
  // /usr/bin/open does not exist, so this script opens the browser instead.
  const serverOpens = process.platform === 'darwin' && !noOpen;
  const env = { ...process.env, LAI_APP_PORT: String(port), LAI_API_TOKEN: token, LAI_INSTANCE_NONCE: nonce, LAI_APP_NO_OPEN: serverOpens ? '0' : '1' };
  let stderr = '';
  // POSIX: own process group, so Ctrl+C reaches the server once (forwarded below), not twice.
  const server = childProcess.spawn(process.execPath, [path.join(appDir, 'server.js')], {
    env, stdio: ['ignore', 'inherit', 'pipe'], detached: process.platform !== 'win32',
  });
  server.stderr.on('data', (chunk) => { process.stderr.write(chunk); stderr = (stderr + chunk).slice(-8192); });
  const exited = new Promise((resolve) => server.once('exit', (code, signal) => resolve({ code, signal })));
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      if (server.exitCode === null && server.signalCode === null) server.kill(signal === 'SIGINT' ? 'SIGINT' : 'SIGTERM');
    });
  }

  let ready = false;
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (!ready && Date.now() < deadline && server.exitCode === null && server.signalCode === null && !stopping) {
    const health = await laiHealth(port, token);
    ready = Boolean(health && health.status === 200 && health.body.instanceNonce === nonce);
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) {
    if (stopping) { await exited; return 0; }
    if (server.exitCode === null && server.signalCode === null) { server.kill('SIGTERM'); }
    await exited;
    console.error('来财没能启动。' + (stderr.trim() ? '出错信息：\n' + tail(stderr) : ''));
    return 1;
  }

  fs.mkdirSync(path.dirname(recordFile), { recursive: true });
  writeAtomic(recordFile, JSON.stringify({ pid: server.pid, port, token, nonce, dataDir }));
  try { fs.chmodSync(recordFile, 0o600); } catch (_) { /* best effort */ }
  const url = appUrl(port, token);
  if (serverOpens) console.log(`来财已启动：${url}（关掉这个窗口或按 Ctrl+C 就会停止）`);
  else announce(url);

  const { code, signal } = await exited;
  const current = readRunRecord(recordFile);
  if (current && current.pid === server.pid) fs.rmSync(recordFile, { force: true });
  if (stopping) { console.log('来财已停止。'); return code === 0 ? 0 : 1; }
  console.error(`来财意外停止了（${signal || '退出码 ' + code}）。` + (stderr.trim() ? '出错信息：\n' + tail(stderr) : ''));
  return 1;
}

module.exports = { DEFAULT_PORT, runtimeProblem, runtimeHint, assembleApp, appUrl, runRecordFile };

if (require.main === module) {
  main().then((code) => process.exit(code), (error) => { console.error('来财没能启动：' + (error && error.message || error)); process.exit(1); });
}
