'use strict';
// `npm start` (scripts/start.cjs). Never touches the real data directory: every run sets LAI_DATA_DIR to a
// lai-test-* directory under the system temp dir, LAI_APP_NO_OPEN=1, a free LAI_APP_PORT, and preloads
// scripts/test-data-guard.cjs into the script and the server it starts.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const start = require('../scripts/start.cjs');
const appFiles = require('../scripts/app-files.cjs');

const tempRoot = fs.realpathSync(os.tmpdir());
const testDir = (name) => fs.mkdtempSync(path.join(tempRoot, `lai-test-start-${name}-`));
const freePort = () => new Promise((resolve) => {
  const server = net.createServer();
  server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
});
const portIsFree = (port) => new Promise((resolve) => {
  const server = net.createServer();
  server.once('error', () => resolve(false));
  server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
});

function launch({ dataDir, port }) {
  const guard = path.join(root, 'scripts/test-data-guard.cjs');
  const child = spawn(process.execPath, [path.join(root, 'scripts/start.cjs')], {
    cwd: root,
    env: { ...process.env, LAI_DATA_DIR: dataDir, LAI_APP_NO_OPEN: '1', LAI_APP_PORT: String(port), NODE_OPTIONS: `--require ${JSON.stringify(guard)}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  const output = () => ({ stdout, stderr });
  async function waitFor(pattern, ms = 60000) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const match = stdout.match(pattern);
      if (match) return match;
      if (child.exitCode !== null) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`no ${pattern} in output:\n${stdout}\n${stderr}`);
  }
  return { child, exited, output, waitFor };
}

test('runtime check explains what to install in Chinese', () => {
  assert.equal(start.runtimeProblem('24.1.0', () => ({})), '');
  assert.match(start.runtimeProblem('20.18.0', () => ({})), /需要 Node 24 或更新的版本.*20\.18\.0/);
  assert.match(start.runtimeProblem('22.4.1', () => ({})), /需要 Node 24/);
  // 22.5+ has node:sqlite and runs, with a hint to upgrade.
  assert.equal(start.runtimeProblem('22.11.0', () => ({})), '');
  assert.match(start.runtimeHint('22.11.0'), /建议升级到 Node 24/);
  assert.equal(start.runtimeHint('24.1.0'), '');
  assert.match(start.runtimeProblem('24.0.0', () => { throw new Error('No such built-in module: node:sqlite'); }), /没有 node:sqlite/);
});

test('default port is fixed, outside the range the system hands out to outgoing connections on macOS and Windows', () => {
  assert.equal(start.DEFAULT_PORT, 47830);
});

test('assemble step copies the backend, the shared vendor list and the assembled page', () => {
  const out = path.join(testDir('assemble'), 'app');
  try {
    start.assembleApp(out);
    for (const name of appFiles.backendFiles()) assert.deepEqual(fs.readFileSync(path.join(out, name)), fs.readFileSync(path.join(root, 'backend', name)), name);
    assert.ok(appFiles.backendFiles().includes('server.js'));
    for (const [from, to] of appFiles.VENDOR_FILES) assert.deepEqual(fs.readFileSync(path.join(out, 'vendor', to)), fs.readFileSync(path.join(root, from)), to);
    assert.equal(fs.readFileSync(path.join(out, 'trade-order-system.html'), 'utf8'), appFiles.assembleHtml());
    assert.deepEqual(fs.readdirSync(out).filter((name) => name.includes('.tmp-')), [], 'no temp files left behind');
  } finally { fs.rmSync(path.dirname(out), { recursive: true, force: true }); }
});

test('the browser tests use the same file list as npm start', () => {
  const harness = fs.readFileSync(path.join(root, 'tests/e2e/harness.mjs'), 'utf8');
  assert.match(harness, /require\('\.\.\/\.\.\/scripts\/app-files\.cjs'\)/);
  assert.doesNotMatch(harness, /vendor\/sheetjs/);
});

test('package.json runs the start script', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.start, 'node scripts/start.cjs');
  assert.equal(pkg.dependencies, undefined);
});

test('npm start serves the page with the real backend, refuses a second server, and stops on Ctrl+C', { timeout: 120000 }, async () => {
  const dataDir = testDir('run');
  const port = await freePort();
  const first = launch({ dataDir, port });
  let second;
  try {
    const [, url] = await first.waitFor(/来财已启动：(\S+)（关掉这个窗口或按 Ctrl\+C 就会停止）/);
    const parsed = new URL(url);
    assert.equal(parsed.host, `127.0.0.1:${port}`);
    assert.equal(parsed.pathname, '/trade-order-system.html');
    const token = parsed.searchParams.get('token');
    assert.ok(token && token.length >= 32);

    // The token link sets the session cookie and redirects; the page then loads with that cookie.
    const redirect = await fetch(url, { redirect: 'manual' });
    assert.equal(redirect.status, 303);
    const cookie = redirect.headers.get('set-cookie').split(';')[0];
    const page = await fetch(`http://127.0.0.1:${port}/trade-order-system.html`, { headers: { cookie } });
    assert.equal(page.status, 200);
    assert.equal(await page.text(), appFiles.assembleHtml());
    const health = await (await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { 'x-trade-token': token } })).json();
    assert.equal(health.ok, true);
    assert.ok(fs.readdirSync(dataDir).length > 0, 'the server writes into the test data directory');

    // A second start on the same data directory finds the running one instead of starting another server.
    second = launch({ dataDir, port: await freePort() });
    const result = await second.exited;
    assert.equal(result.code, 0, second.output().stderr);
    assert.match(second.output().stdout, new RegExp(`来财已经在运行：http://127\\.0\\.0\\.1:${port}/`));

    first.child.kill('SIGINT');
    const stopped = await first.exited;
    assert.equal(stopped.code, 0, first.output().stderr);
    assert.match(first.output().stdout, /来财已停止/);
    assert.equal(await portIsFree(port), true, 'the server stopped with it');
    assert.doesNotMatch(first.output().stderr, /LAI_TEST_DATA_BLOCK/);
  } finally {
    for (const run of [first, second]) if (run && run.child.exitCode === null) run.child.kill('SIGKILL');
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('a server that cannot start is reported with its error, in Chinese', { timeout: 60000 }, async () => {
  const dataDir = testDir('fail');
  // A file where the data directory should be: the server cannot open its storage and exits.
  const blocker = path.join(dataDir, 'data');
  fs.writeFileSync(blocker, 'not a directory');
  const run = launch({ dataDir: blocker, port: await freePort() });
  try {
    const { code } = await run.exited;
    assert.equal(code, 1);
    assert.match(run.output().stderr, /来财没能启动/);
  } finally {
    if (run.child.exitCode === null) run.child.kill('SIGKILL');
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
