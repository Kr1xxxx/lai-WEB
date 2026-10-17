// Starts the real Lai backend with the assembled single-page app in an isolated lai-test-* directory,
// then opens it in Chromium. Used by tests/e2e/*.e2e.mjs.
// Needs `playwright` (installed outside package.json, see AGENTS.md) and Node with node:sqlite.
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BACKEND_FILES = fs.readdirSync(path.join(root, 'backend')).filter((name) => name.endsWith('.js'));
const VENDOR_FILES = [
  ['vendor/sheetjs-0.20.3/xlsx.full.min.js', 'xlsx.full.min.js'],
  ['vendor/mail-libs/mail-libs.cjs', 'mail-libs.cjs'],
  ['vendor/squire/squire-raw.js', 'squire-raw.js'],
  ['vendor/dompurify/purify.min.js', 'purify.min.js'],
];

let cachedHtml;
function assembledHtml() {
  // The page is assembled by scripts/build.py (assemble_html), the same as the web trial build.
  cachedHtml ??= execFileSync('python3', ['-c', 'import sys; sys.path.insert(0, "scripts"); import build; sys.stdout.write(build.assemble_html())'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return cachedHtml;
}

const freePort = () => new Promise((resolve) => {
  const server = net.createServer();
  server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
});

/** Sample customers from docs/samples, in the shape the app stores. */
export function sampleCustomers() {
  const { customers } = JSON.parse(fs.readFileSync(path.join(root, 'docs/samples/lai-sample-customers.json'), 'utf8'));
  return Object.fromEntries(customers.map((c) => [c.client, {
    client: c.client, country: c.country, owner: c.owner, contact: c.contact, email: c.email, phone: c.phone, history: [],
  }]));
}

export async function startApp({ seed = true, env = {} } = {}) {
  const temp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'lai-test-e2e-'));
  const resources = path.join(temp, 'resources');
  fs.mkdirSync(path.join(resources, 'vendor'), { recursive: true });
  for (const name of BACKEND_FILES) fs.copyFileSync(path.join(root, 'backend', name), path.join(resources, name));
  for (const [from, to] of VENDOR_FILES) fs.copyFileSync(path.join(root, from), path.join(resources, 'vendor', to));
  fs.writeFileSync(path.join(resources, 'trade-order-system.html'), assembledHtml());

  const port = await freePort();
  const token = crypto.randomBytes(24).toString('hex');
  const dataDir = path.join(temp, 'data');
  let stderr = '';
  const server = spawn(process.execPath, [path.join(resources, 'server.js')], {
    env: { ...process.env, LAI_DATA_DIR: dataDir, LAI_APP_PORT: String(port), LAI_API_TOKEN: token, LAI_INSTANCE_NONCE: 'lai-test-e2e', LAI_APP_NO_OPEN: '1', ...env },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  server.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-8192); });
  const base = `http://127.0.0.1:${port}`;
  const api = (route, options = {}) => fetch(base + route, { ...options, headers: { 'x-trade-token': token, ...options.headers } });
  let ready = false;
  for (let i = 0; i < 200 && !ready; i++) {
    if (server.exitCode !== null) break;
    try { ready = (await fetch(base + '/api/health')).ok; } catch { /* not up yet */ }
    if (!ready) await new Promise((r) => setTimeout(r, 50));
  }
  if (!ready) throw new Error('Lai backend did not start:\n' + stderr);

  if (seed) {
    const state = await (await api('/api/data')).json();
    Object.assign(state.data.customers, sampleCustomers());
    const saved = await api('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, baseRevision: state.revision }) });
    if (saved.status !== 200) throw new Error('Seeding failed: ' + saved.status + ' ' + await saved.text());
  }

  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push('pageerror: ' + error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !/^Failed to load resource/.test(message.text())) errors.push('console.error: ' + message.text()); });
  // The page asks for /favicon.ico, which the backend does not serve; any other failed request is an error.
  page.on('response', (response) => { if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) errors.push(`HTTP ${response.status()}: ${response.url()}`); });
  const open = async (hash = 'customers') => {
    await page.goto(`${base}/trade-order-system.html?token=${encodeURIComponent(token)}#${hash}`);
    // The first request is answered with a redirect to #customers (it sets the session cookie), so any other
    // start page is reached by switching the hash and booting the page again.
    if (hash !== 'customers') {
      // Let the first page finish booting before switching the hash: a page still booting would read the new
      // hash itself, act on it (and maybe move on to another page), and the reload below would start from there.
      await page.waitForFunction(() => !document.querySelector('#app .boot'), null, { timeout: 15000 }).catch(() => {});
      await page.evaluate((h) => { location.hash = h; }, hash);
      await page.reload();
    }
    await page.waitForLoadState('networkidle');
  };
  const readData = async () => (await (await api('/api/data')).json()).data;

  async function close() {
    await browser.close().catch(() => {});
    if (server.exitCode === null) await new Promise((resolve) => { server.once('exit', resolve); server.kill('SIGTERM'); });
    fs.rmSync(temp, { recursive: true, force: true });
  }
  return { page, open, readData, errors, close, base, api };
}
