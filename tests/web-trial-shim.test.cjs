// The web trial's data stand-in (scripts/web-trial/data-shim.js): same save rules as backend/storage.js,
// kept in browser storage. Runs the script in a vm with a fake window and localStorage.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../scripts/web-trial/data-shim.js'), 'utf8');

function load({ storage = true } = {}) {
  const backing = new Map();
  const localStorage = {
    getItem: (k) => (backing.has(k) ? backing.get(k) : null),
    setItem: (k, v) => backing.set(k, String(v)),
    removeItem: (k) => backing.delete(k),
  };
  const passed = [];
  const window = { fetch: (...args) => { passed.push(args[0]); return Promise.resolve('inner'); }, Response, URLSearchParams };
  if (storage) window.localStorage = localStorage;
  else Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
  window.window = window;
  vm.runInNewContext(source, window);
  return { window, backing, passed };
}
const post = (window, url, body) => window.fetch(url, { method: 'POST', body: JSON.stringify(body) });
const getData = async (window) => (await window.fetch('/api/data')).json();
// Objects made inside the vm have another Object prototype; compare plain copies.
const plain = (value) => JSON.parse(JSON.stringify(value));
const state = (data) => ({ app: 'laicai-lai', version: 'x', data });

test('empty trial returns an empty snapshot the page accepts', async () => {
  const { window } = load();
  const payload = await getData(window);
  assert.equal(payload.revision, 1);
  assert.deepEqual(plain(payload.data.orders), []);
  assert.deepEqual(plain(payload.data.customers), {});
  assert.deepEqual(plain(window.LaiWebTrial.stats()), { customers: 0, orders: 0 });
  assert.equal(window.LaiWebTrial.persistent(), true);
});

test('save needs the current revision, bumps it, and survives a re-read', async () => {
  const { window, backing } = load();
  const first = await getData(window);
  first.data.customers.A = { name: 'A' };
  const ok = await post(window, '/api/save', { state: state(first.data), baseRevision: first.revision });
  const result = await ok.json();
  assert.equal(ok.status, 200);
  assert.equal(result.ok, true);
  assert.equal(result.revision, 2);
  assert.equal((await getData(window)).data.customers.A.name, 'A');
  assert.ok(backing.get('lai-web-trial-v1'));
  const stale = await post(window, '/api/save', { state: state(first.data), baseRevision: first.revision });
  assert.equal(stale.status, 409);
  const missing = await post(window, '/api/save', { state: state(first.data) });
  assert.equal(missing.status, 428);
  const broken = await post(window, '/api/save', { state: state({ orders: 'x' }), baseRevision: 2 });
  assert.equal(broken.status, 400);
});

test('other URLs pass through; backup explains itself; the removed data-folder route is not answered by the shim', async () => {
  const { window, passed } = load();
  assert.equal(await window.fetch('/something-else'), 'inner');
  assert.deepEqual(passed, ['/something-else']);
  const response = await window.fetch('/api/manual-backup', { method: 'POST' });
  const body = await response.json();
  assert.equal(response.status, 501);
  assert.equal(body.ok, false);
  assert.ok(body.message);
  assert.equal(await window.fetch('/api/open-data-folder', { method: 'POST' }), 'inner', 'the data-folder route no longer exists, so the shim leaves it alone');
});

test('the web trial has no backups to list or restore and says so in Chinese', async () => {
  const { window, passed } = load();
  for (const [route, init] of [['/api/backups', undefined], ['/api/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"manual-20260101-120000.sqlite"}' }]]) {
    const response = await window.fetch(route, init);
    const body = await response.json();
    assert.equal(response.status, 501);
    assert.equal(body.ok, false);
    assert.match(body.message, /网页试用版没有备份/);
  }
  assert.deepEqual(passed, []);
});

test('import log is stored per id', async () => {
  const { window } = load();
  const snap = await getData(window);
  const id = '12345678-1234-1234-1234-123456789abc';
  await post(window, '/api/save', { state: state(snap.data), baseRevision: snap.revision, importLog: { id, issues: [{ row: 2, name: 'x', reason: 'y' }] } });
  const log = await (await window.fetch('/api/import-log?id=' + id)).json();
  assert.equal(log.issues.length, 1);
  assert.deepEqual(plain((await (await window.fetch('/api/import-log?id=none')).json()).issues), []);
});

test('restore, snapshot and clear', async () => {
  const { window, backing } = load();
  const backup = { app: 'trade-order-system', version: 'sqlite-1', data: { orders: [{ id: 1 }], customers: { A: {}, B: {} } } };
  window.LaiWebTrial.restore(JSON.stringify(backup));
  assert.deepEqual(plain(window.LaiWebTrial.stats()), { customers: 2, orders: 1 });
  assert.equal((await getData(window)).revision, 2);
  assert.equal(JSON.parse(window.LaiWebTrial.snapshot()).data.orders.length, 1);
  window.LaiWebTrial.restore(JSON.stringify({ orders: [], customers: { Z: {} } }));
  assert.deepEqual(plain(window.LaiWebTrial.stats()), { customers: 1, orders: 0 });
  assert.throws(() => window.LaiWebTrial.restore('not json'), /不是有效的数据/);
  assert.throws(() => window.LaiWebTrial.restore('{"x":1}'), /缺少订单列表/);
  window.LaiWebTrial.clear();
  assert.deepEqual(plain(window.LaiWebTrial.stats()), { customers: 0, orders: 0 });
  assert.equal(backing.get('lai-web-trial-demo-seeded'), '1');
});

test('blocked storage: works in memory and says it is not persistent', async () => {
  const { window } = load({ storage: false });
  assert.equal(window.LaiWebTrial.persistent(), false);
  const snap = await getData(window);
  snap.data.customers.A = {};
  const response = await post(window, '/api/save', { state: state(snap.data), baseRevision: snap.revision });
  assert.equal(response.status, 200);
  assert.equal(Object.keys((await getData(window)).data.customers).length, 1);
});
