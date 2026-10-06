const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../src/nav-favorites.js');

test('toggle adds in click order, removes again, and never mutates the input', () => {
  const start = {defaultOwner: 'Amy'};
  const a = F.toggle(start, 'screen:pool');
  const b = F.toggle(a, 'screen:active');
  assert.deepEqual(F.list(b), ['screen:pool', 'screen:active']);
  assert.equal(b.defaultOwner, 'Amy', 'other settings are preserved');
  assert.equal(start.favoriteNav, undefined, 'input untouched');
  assert.deepEqual(a.favoriteNav, ['screen:pool'], 'earlier result untouched');
  assert.deepEqual(F.list(F.toggle(b, 'screen:pool')), ['screen:active']);
  assert.equal(F.isFavorite(b, 'screen:active'), true);
  assert.equal(F.isFavorite(b, 'screen:duplicates'), false);
});

test('unknown entries are rejected on write and silently filtered on read', () => {
  assert.throws(() => F.toggle({}, 'screen:nope'), /不能加入常用/);
  assert.throws(() => F.toggle({}, undefined), /不能加入常用/);
  assert.throws(() => F.remove({}, '__proto__'), /不能加入常用/);
  const dirty = {favoriteNav: ['screen:pool', 'screen:pool', 'x', 7, null, {}, 'screen:active']};
  assert.deepEqual(F.list(dirty), ['screen:pool', 'screen:active']);
  for (const bad of [undefined, null, {}, {favoriteNav: 'screen:pool'}, {favoriteNav: {0: 'screen:pool'}}])
    assert.deepEqual(F.list(bad), []);
});

test('write on dirty stored data cleans it', () => {
  const next = F.toggle({favoriteNav: ['screen:pool', 'screen:pool', 'gone']}, 'screen:active');
  assert.deepEqual(next.favoriteNav, ['screen:pool', 'screen:active']);
});

test('move reorders by one step and clamps at both ends', () => {
  const s = {favoriteNav: ['screen:active', 'screen:pool', 'screen:duplicates']};
  assert.deepEqual(F.list(F.move(s, 'screen:duplicates', -1)), ['screen:active', 'screen:duplicates', 'screen:pool']);
  assert.deepEqual(F.list(F.move(s, 'screen:active', 1)), ['screen:pool', 'screen:active', 'screen:duplicates']);
  assert.deepEqual(F.list(F.move(s, 'screen:active', -1)), F.list(s), 'first item cannot move up');
  assert.deepEqual(F.list(F.move(s, 'screen:duplicates', 1)), F.list(s), 'last item cannot move down');
  assert.deepEqual(s.favoriteNav, ['screen:active', 'screen:pool', 'screen:duplicates'], 'input untouched');
  assert.throws(() => F.move({favoriteNav: ['screen:pool']}, 'screen:active', 1), /尚未加入常用/);
});

test('remove drops one entry and keeps the order of the rest', () => {
  const s = {favoriteNav: ['screen:active', 'screen:pool', 'screen:duplicates']};
  assert.deepEqual(F.list(F.remove(s, 'screen:pool')), ['screen:active', 'screen:duplicates']);
  assert.deepEqual(F.list(F.remove({}, 'screen:pool')), [], 'removing a non-favorite is a no-op');
});

test('entries resolves labels and targets for the management panel', () => {
  const entries = F.entries({favoriteNav: ['screen:duplicates', 'screen:active']});
  assert.deepEqual(entries.map(e => [e.label, e.route, e.screen]), [['客户查重', 'customers', 'duplicates'], ['客户列表', 'customers', 'active']]);
  assert.deepEqual(F.catalog.map(e => e.label), ['客户列表', '公海客户', '客户查重']);
});

// ---- Run the shipped app.js helpers against a stubbed persistence/UI boundary ----
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
const start = app.indexOf('  function favoriteStarState(');
const end = app.indexOf('  function subnav() {', start);
assert.ok(start >= 0 && end > start, 'favorite helpers must sit before subnav()');
const source = app.slice(start, end);
const {escapeHtml} = require('../src/model.js');

function harness({settings, flush = true, failSave = null} = {}) {
  const calls = {persist: [], toasts: [], drawers: [], navigate: [], screens: []};
  const buttons = [];
  const boundary = {
    NF: F, E: escapeHtml,
    state: {customers: {}, orders: [], laiSettings: settings},
    persist: async next => { if (failSave) throw new Error(failSave); calls.persist.push(next); boundary.state = next; return true; },
    toast: message => calls.toasts.push(message),
    window: {flushPendingSave: async () => flush},
    document: {querySelectorAll: () => buttons},
    drawer: (...args) => calls.drawers.push(args),
    $: () => null,
    navigateApp: async route => { calls.navigate.push(route); return boundary.navigateResult !== false; },
    showCustomerScreen: screen => calls.screens.push(screen),
    navigateResult: true,
  };
  vm.createContext(boundary); vm.runInContext(source, boundary);
  return {boundary, calls, buttons};
}
const run = (h, code) => vm.runInContext(code, h.boundary);

test('star markup shows an outline when not favorited and a filled star with pressed state when favorited', () => {
  let h = harness({settings: undefined});
  let html = run(h, 'favoriteStar("screen:active","客户列表")');
  assert.match(html, /data-nav-favorite="screen:active"/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /aria-label="收藏客户列表"/);
  assert.match(html, />☆<\/button>/);
  assert.doesNotMatch(html, /is-favorite/);
  h = harness({settings: {favoriteNav: ['screen:active']}});
  html = run(h, 'favoriteStar("screen:active","客户列表")');
  assert.match(html, /is-favorite/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /aria-label="取消收藏客户列表"/);
  assert.match(html, />★<\/button>/);
});

test('saving a favorite persists the toggled list, keeps other settings and refreshes the stars', async () => {
  const h = harness({settings: {defaultOwner: 'Amy'}});
  const star = {dataset: {navFavorite: 'screen:pool', navLabel: '公海客户'}, classList: {toggle() {}}, setAttribute() {}};
  h.buttons.push(star);
  const saved = await run(h, 'saveFavoriteNav(settings => NF.toggle(settings, "screen:pool"))');
  assert.equal(saved, true);
  assert.equal(h.calls.persist.length, 1);
  assert.deepEqual(h.calls.persist[0].laiSettings, {defaultOwner: 'Amy', favoriteNav: ['screen:pool']});
  assert.deepEqual(h.calls.persist[0].customers, {}, 'rest of the state is carried over unchanged');
  assert.equal(star.textContent, '★', 'visible star updated after a successful save');
  assert.equal(star.title, '取消收藏公海客户');
});

test('a failed save keeps the star unchanged and tells the user why', async () => {
  const h = harness({settings: {}, failSave: '数据已发生变化，请重新打开来财后再编辑。'});
  const star = {dataset: {navFavorite: 'screen:pool', navLabel: '公海客户'}, classList: {toggle() {}}, setAttribute() {}, textContent: '☆'};
  h.buttons.push(star);
  assert.equal(await run(h, 'saveFavoriteNav(settings => NF.toggle(settings, "screen:pool"))'), false);
  assert.deepEqual(h.calls.toasts, ['数据已发生变化，请重新打开来财后再编辑。']);
  assert.equal(star.textContent, '☆');
});

test('an unsaved edit blocks the change without saving anything', async () => {
  const h = harness({settings: {}, flush: false});
  assert.equal(await run(h, 'saveFavoriteNav(settings => NF.toggle(settings, "screen:pool"))'), false);
  assert.equal(h.calls.persist.length, 0);
});

test('the management panel lists favorites in order with correct move limits, and explains the empty case', () => {
  let h = harness({settings: {favoriteNav: ['screen:pool', 'screen:active', 'screen:duplicates']}});
  run(h, 'favoriteNavPanel()');
  let [title, body, footer, type] = h.calls.drawers[0];
  assert.equal(title, '常用导航'); assert.equal(type, 'favorites');
  assert.deepEqual([...body.matchAll(/data-favorite-jump="([^"]+)"/g)].map(m => m[1]), ['screen:pool', 'screen:active', 'screen:duplicates']);
  const rows = body.split('<li class="favorite-nav-row">').slice(1);
  assert.match(rows[0], /data-direction="-1"[^>]*disabled/, 'first row cannot move up');
  assert.doesNotMatch(rows[0], /data-direction="1"[^>]*disabled/);
  assert.match(rows[2], /data-direction="1"[^>]*disabled/, 'last row cannot move down');
  assert.doesNotMatch(rows[1], /disabled/);
  assert.match(footer, /data-action="close-modal"/);
  h = harness({settings: {favoriteNav: ['stale:entry']}});
  run(h, 'favoriteNavPanel()');
  assert.match(h.calls.drawers[0][1], /还没有常用导航/);
  assert.doesNotMatch(h.calls.drawers[0][1], /data-favorite-jump/);
});

test('jumping opens the customer page first and only switches screen for non-default entries', async () => {
  let h = harness({settings: {}});
  await run(h, 'openFavoriteNav("screen:active")');
  assert.deepEqual([h.calls.navigate, h.calls.screens], [['customers'], []]);
  h = harness({settings: {}});
  await run(h, 'openFavoriteNav("screen:duplicates")');
  assert.deepEqual([h.calls.navigate, h.calls.screens], [['customers'], ['duplicates']]);
  h = harness({settings: {}}); h.boundary.navigateResult = false;
  await run(h, 'openFavoriteNav("screen:pool")');
  assert.deepEqual(h.calls.screens, [], 'a blocked navigation (unsaved edit) does not switch screens');
  h = harness({settings: {}});
  await run(h, 'openFavoriteNav("screen:gone")');
  assert.deepEqual(h.calls.navigate, []);
});

test('the placeholder entries are gone and the real handlers are wired', () => {
  assert.doesNotMatch(app, /常用导航管理/);
  assert.match(app, /label === "常用" \? 'data-action="favorite-nav"'/);
  for (const hook of ['Number(d.direction)', 'd.navFavorite', 'd.favoriteJump', 'd.favoriteMove', 'd.favoriteRemove', 'd.action === "favorite-nav"'])
    assert.ok(app.includes(hook), hook);
});

test('the module is loaded before the app in the built page', () => {
  const build = fs.readFileSync(path.join(__dirname, '../scripts/build.py'), 'utf8');
  const template = fs.readFileSync(path.join(__dirname, '../src/template.html'), 'utf8');
  assert.ok(template.indexOf('<!--NAV_FAVORITES-->') > 0 && template.indexOf('<!--NAV_FAVORITES-->') < template.indexOf('<!--PREVIEW_APP-->'));
  assert.match(build, /'<!--NAV_FAVORITES-->','nav-favorites\.js','script'/);
});
