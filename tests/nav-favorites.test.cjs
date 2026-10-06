const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const F = require('../src/nav-favorites.js');
const RM = require('../src/rail-menu.js');
const {escapeHtml} = require('../src/model.js');

const ALL = ['screen:active', 'screen:pool', 'screen:duplicates'];

// ---------------- pure favorites logic ----------------
test('never configured means every favoritable entry is favorited; an explicit empty list stays empty', () => {
  for (const unset of [undefined, null, {}, {favoriteNav: 'screen:pool'}, {favoriteNav: {0: 'screen:pool'}}])
    assert.deepEqual(F.list(unset), ALL);
  assert.deepEqual(F.list({favoriteNav: []}), []);
  assert.equal(F.isFavorite(undefined, 'screen:pool'), true);
});

test('toggle removes from the default set, re-adds at the end, and never mutates the input', () => {
  const start = {defaultOwner: 'Amy'};
  const off = F.toggle(start, 'screen:pool');
  assert.deepEqual(F.list(off), ['screen:active', 'screen:duplicates']);
  assert.equal(off.defaultOwner, 'Amy', 'other settings are preserved');
  assert.equal(start.favoriteNav, undefined, 'input untouched');
  const back = F.toggle(off, 'screen:pool');
  assert.deepEqual(F.list(back), ['screen:active', 'screen:duplicates', 'screen:pool']);
  assert.deepEqual(off.favoriteNav, ['screen:active', 'screen:duplicates'], 'earlier result untouched');
  let none = {favoriteNav: []};
  none = F.toggle(none, 'screen:duplicates');
  assert.deepEqual(F.list(none), ['screen:duplicates']);
});

test('unknown entries are rejected on write and silently filtered on read', () => {
  assert.throws(() => F.toggle({}, 'screen:nope'), /不能加入常用/);
  assert.throws(() => F.toggle({}, undefined), /不能加入常用/);
  assert.throws(() => F.remove({}, '__proto__'), /不能加入常用/);
  assert.deepEqual(F.list({favoriteNav: ['screen:pool', 'screen:pool', 'x', 7, null, {}, 'screen:active']}), ['screen:pool', 'screen:active']);
  assert.deepEqual(F.toggle({favoriteNav: ['screen:pool', 'screen:pool', 'gone']}, 'screen:active').favoriteNav, ['screen:pool', 'screen:active']);
});

test('move reorders by one step and clamps at both ends', () => {
  const s = {favoriteNav: ALL};
  assert.deepEqual(F.list(F.move(s, 'screen:duplicates', -1)), ['screen:active', 'screen:duplicates', 'screen:pool']);
  assert.deepEqual(F.list(F.move(s, 'screen:active', 1)), ['screen:pool', 'screen:active', 'screen:duplicates']);
  assert.deepEqual(F.list(F.move(s, 'screen:active', -1)), ALL, 'first item cannot move up');
  assert.deepEqual(F.list(F.move(s, 'screen:duplicates', 1)), ALL, 'last item cannot move down');
  assert.deepEqual(s.favoriteNav, ALL, 'input untouched');
  assert.throws(() => F.move({favoriteNav: ['screen:pool']}, 'screen:active', 1), /尚未加入常用/);
});

test('remove drops one entry and keeps the order of the rest', () => {
  assert.deepEqual(F.list(F.remove({favoriteNav: ALL}, 'screen:pool')), ['screen:active', 'screen:duplicates']);
  assert.deepEqual(F.list(F.remove({favoriteNav: []}, 'screen:pool')), [], 'removing a non-favorite is a no-op');
  assert.deepEqual(F.list(F.remove({}, 'screen:pool')), ['screen:active', 'screen:duplicates'], 'default set can be edited too');
});

test('entries resolves labels and targets', () => {
  const entries = F.entries({favoriteNav: ['screen:duplicates', 'screen:active']});
  assert.deepEqual(entries.map(e => [e.label, e.route, e.screen]), [['客户查重', 'customers', 'duplicates'], ['客户列表', 'customers', 'active']]);
  assert.deepEqual(F.catalog.map(e => e.label), ['客户列表', '公海客户', '客户查重']);
});

// ---------------- rail menu contents ----------------
test('rail menus list only existing destinations; reserved entries have no list', () => {
  const rows = label => RM.menuFor(label, {}).map(r => [r.label, r.kind, r.target]);
  assert.deepEqual(rows('客户'), [['客户列表', 'screen', 'active'], ['公海客户', 'screen', 'pool'], ['客户查重', 'screen', 'duplicates'], ['客户设置', 'screen', 'customer-settings']]);
  assert.deepEqual(rows('交易'), [['全部订单', 'route', 'order-list'], ['订单回收站', 'route', 'order-trash']]);
  assert.deepEqual(rows('工作台'), [['工作台', 'route', 'dashboard']]);
  assert.deepEqual(rows('团队数据'), [['目标完成情况', 'route', 'team-goals'], ['目标管理', 'feature', '目标管理'], ['团队墙', 'route', 'team-wall'], ['经营统计', 'route', 'analysis'], ['客户资产', 'route', 'team-assets'], ['跟进情况', 'route', 'team-followups'], ['任务完成', 'route', 'team-tasks'], ['订单业绩', 'route', 'team-orders']]);
  assert.deepEqual(rows('协同'), [['日历与待办', 'route', 'calendar']]);
  assert.deepEqual(rows('企业管理'), [['设置', 'route', 'settings']]);
  for (const reserved of ['沟通', '线索', '商机', '不存在', '__proto__', 'constructor'])
    assert.equal(RM.menuFor(reserved, {}), null, reserved);
  RM.menuFor('客户', {}).pop();
  assert.equal(RM.menuFor('客户', {}).length, 4, 'callers cannot alter the menu definition');
});

test('the 常用 menu follows the saved favorites, in order, and may be empty', () => {
  assert.deepEqual(RM.menuFor('常用', {favoriteNav: ['screen:duplicates', 'screen:active']}).map(r => [r.label, r.kind, r.target]),
    [['客户查重', 'favorite', 'duplicates'], ['客户列表', 'favorite', 'active']]);
  assert.deepEqual(RM.menuFor('常用', {favoriteNav: []}), []);
  assert.equal(RM.menuFor('常用', undefined).length, 3);
});

// ---------------- shipped app.js helpers behind a stubbed boundary ----------------
const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
const start = app.indexOf('  function favoriteStarState(');
const end = app.indexOf('  function subnav() {', start);
assert.ok(start >= 0 && end > start, 'favorite helpers must sit before subnav()');
const source = app.slice(start, end);

function fakeElement() {
  const el = {dataset: {}, style: {}, className: '', innerHTML: '', offsetHeight: 100, removed: false, remove() { el.removed = true; }};
  return el;
}
function harness({settings, flush = true, failSave = null, favoritesMode = false, customerScreen = 'active'} = {}) {
  const calls = {persist: [], toasts: [], drawers: [], navigate: [], screens: [], settingsOpened: 0, timers: []};
  const listeners = {};
  const buttons = [];
  let flyout = null;
  const doc = {
    querySelectorAll: () => buttons,
    querySelector: selector => selector === '.rail-flyout' ? (flyout && !flyout.removed ? flyout : null) : null,
    createElement: () => (flyout = fakeElement()),
    addEventListener: (type, fn) => { listeners[type] = fn; },
  };
  const boundary = {
    NF: F, RM, E: escapeHtml,
    state: {customers: {}, orders: [], laiSettings: settings},
    favoritesMode, customerScreen,
    customerNavToggle: () => '<TOGGLE>',
    persist: async next => { if (failSave) throw new Error(failSave); calls.persist.push(next); boundary.state = next; return true; },
    toast: message => calls.toasts.push(message),
    window: {flushPendingSave: async () => flush},
    document: doc,
    drawer: (...args) => calls.drawers.push(args),
    navigateApp: async (...args) => { calls.navigate.push(args); return boundary.navigateResult !== false; },
    showCustomerScreen: screen => calls.screens.push(screen),
    customerSettings: () => { calls.settingsOpened++; },
    featureNotice: name => { (calls.notices ||= []).push(name); },
    setTimeout: (fn, ms) => { calls.timers.push({fn, ms}); return calls.timers.length; },
    clearTimeout: () => {},
    navigateResult: true,
  };
  vm.createContext(boundary); vm.runInContext(source, boundary);
  return {boundary, calls, buttons, listeners, get flyout() { return flyout; }};
}
const run = (h, code) => vm.runInContext(code, h.boundary);

test('star markup: filled and pressed by default, outline after the user removes it', () => {
  let h = harness({settings: undefined});
  let html = run(h, 'favoriteStar("screen:active","客户列表")');
  assert.match(html, /is-favorite/); assert.match(html, /aria-pressed="true"/);
  assert.match(html, /aria-label="取消收藏客户列表"/); assert.match(html, />★<\/button>/);
  h = harness({settings: {favoriteNav: []}});
  html = run(h, 'favoriteStar("screen:active","客户列表")');
  assert.doesNotMatch(html, /is-favorite/); assert.match(html, /aria-pressed="false"/);
  assert.match(html, /aria-label="收藏客户列表"/); assert.match(html, />☆<\/button>/);
});

test('saving a favorite persists the toggled list, keeps other settings and refreshes the stars', async () => {
  const h = harness({settings: {defaultOwner: 'Amy'}});
  const star = {dataset: {navFavorite: 'screen:pool', navLabel: '公海客户'}, classList: {toggle() {}}, setAttribute() {}};
  h.buttons.push(star);
  assert.equal(await run(h, 'saveFavoriteNav(settings => NF.toggle(settings, "screen:pool"))'), true);
  assert.deepEqual(h.calls.persist[0].laiSettings, {defaultOwner: 'Amy', favoriteNav: ['screen:active', 'screen:duplicates']});
  assert.deepEqual(h.calls.persist[0].customers, {}, 'rest of the state is carried over unchanged');
  assert.equal(star.textContent, '☆', 'visible star updated after a successful save');
  assert.equal(star.title, '收藏公海客户');
});

test('a failed save keeps the star unchanged and tells the user why; an unsaved edit blocks the change', async () => {
  let h = harness({settings: {}, failSave: '数据已发生变化，请重新打开来财后再编辑。'});
  const star = {dataset: {navFavorite: 'screen:pool', navLabel: '公海客户'}, classList: {toggle() {}}, setAttribute() {}, textContent: '★'};
  h.buttons.push(star);
  assert.equal(await run(h, 'saveFavoriteNav(settings => NF.toggle(settings, "screen:pool"))'), false);
  assert.deepEqual(h.calls.toasts, ['数据已发生变化，请重新打开来财后再编辑。']);
  assert.equal(star.textContent, '★');
  h = harness({settings: {}, flush: false});
  assert.equal(await run(h, 'saveFavoriteNav(settings => NF.toggle(settings, "screen:pool"))'), false);
  assert.equal(h.calls.persist.length, 0);
});

test('the 常用 sub-navigation lists favorites in order, marks the current screen, and always offers management', () => {
  let h = harness({settings: {favoriteNav: ['screen:duplicates', 'screen:active']}, favoritesMode: true, customerScreen: 'duplicates'});
  let html = run(h, 'favoritesSubnav()');
  assert.match(html, /^<h3>常用<TOGGLE><\/h3>/);
  assert.deepEqual([...html.matchAll(/data-lai-screen="([^"]+)"/g)].map(m => m[1]), ['duplicates', 'active']);
  assert.match(html, /nav-entry active" data-lai-screen="duplicates"/);
  assert.doesNotMatch(html, /nav-entry active" data-lai-screen="active"/);
  assert.match(html, /data-action="favorite-nav-manage"/);
  h = harness({settings: {favoriteNav: []}, favoritesMode: true});
  html = run(h, 'favoritesSubnav()');
  assert.match(html, /还没有常用导航/); assert.doesNotMatch(html, /data-lai-screen/); assert.match(html, /favorite-nav-manage/);
});

test('the management panel lists favorites with correct move limits and explains the empty case', () => {
  let h = harness({settings: {favoriteNav: ['screen:pool', 'screen:active', 'screen:duplicates']}});
  run(h, 'favoriteNavPanel()');
  const [title, body, footer, type] = h.calls.drawers[0];
  assert.equal(title, '管理常用'); assert.equal(type, 'favorites');
  assert.deepEqual([...body.matchAll(/data-favorite-jump="([^"]+)"/g)].map(m => m[1]), ['screen:pool', 'screen:active', 'screen:duplicates']);
  const rows = body.split('<li class="favorite-nav-row">').slice(1);
  assert.match(rows[0], /data-direction="-1"[^>]*disabled/); assert.doesNotMatch(rows[0], /data-direction="1"[^>]*disabled/);
  assert.match(rows[2], /data-direction="1"[^>]*disabled/); assert.doesNotMatch(rows[1], /disabled/);
  assert.match(footer, /data-action="close-modal"/);
  h = harness({settings: {favoriteNav: []}});
  run(h, 'favoriteNavPanel()');
  assert.match(h.calls.drawers[0][1], /还没有常用导航/); assert.doesNotMatch(h.calls.drawers[0][1], /data-favorite-jump/);
});

test('opening a customer screen navigates first and keeps or drops favorites mode as asked', async () => {
  let h = harness({settings: {}});
  assert.equal(await run(h, 'openCustomerScreen("active", false)'), true);
  assert.deepEqual([h.calls.navigate, h.calls.screens, h.calls.settingsOpened], [[['customers', '', true, false]], [], 0]);
  h = harness({settings: {}});
  await run(h, 'openCustomerScreen("duplicates", true)');
  assert.deepEqual([h.calls.navigate, h.calls.screens], [[['customers', '', true, true]], ['duplicates']]);
  h = harness({settings: {}});
  await run(h, 'openCustomerScreen("customer-settings", false)');
  assert.deepEqual([h.calls.settingsOpened, h.calls.screens], [1, []]);
  h = harness({settings: {}}); h.boundary.navigateResult = false;
  assert.equal(await run(h, 'openCustomerScreen("pool", true)'), false);
  assert.deepEqual([h.calls.screens, h.calls.settingsOpened], [[], 0], 'a blocked navigation (unsaved edit) changes nothing');
});

test('clicking 常用 opens the first favorite in favorites mode; with none, the customer list', async () => {
  let h = harness({settings: {favoriteNav: ['screen:pool', 'screen:active']}});
  await run(h, 'openFavorites()');
  assert.deepEqual([h.calls.navigate, h.calls.screens], [[['customers', '', true, true]], ['pool']]);
  h = harness({settings: {favoriteNav: []}});
  await run(h, 'openFavorites()');
  assert.deepEqual([h.calls.navigate, h.calls.screens], [[['customers', '', true, true]], []]);
});

test('panel jump keeps the current favorites mode and ignores unknown ids', async () => {
  let h = harness({settings: {}, favoritesMode: true});
  await run(h, 'openFavoriteNav("screen:pool")');
  assert.deepEqual([h.calls.navigate, h.calls.screens], [[['customers', '', true, true]], ['pool']]);
  h = harness({settings: {}, favoritesMode: false});
  await run(h, 'openFavoriteNav("screen:duplicates")');
  assert.deepEqual(h.calls.navigate, [['customers', '', true, false]]);
  await run(h, 'openFavoriteNav("screen:gone")');
  assert.equal(h.calls.navigate.length, 1);
});

function railItem(label, offsetTop = 120) {
  return {dataset: {railMenu: label}, offsetTop, closest(sel) { return sel.startsWith('.rail-item') ? this : sel === '.rail' ? rail : null; }};
}
const rail = {offsetTop: 56, offsetHeight: 700, scrollTop: 0, after(el) { rail.child = el; }};
const hover = (h, item) => h.listeners.pointerover({pointerType: 'mouse', target: item});

test('hovering a rail menu shows its entries beside the rail and does not rebuild on repeat hovers', () => {
  const h = harness({settings: {}});
  hover(h, railItem('客户'));
  const first = h.flyout;
  assert.equal(rail.child, first);
  assert.equal(first.dataset.menu, '客户');
  assert.deepEqual([...first.innerHTML.matchAll(/data-flyout-kind="(\w+)" data-flyout-target="([\w-]+)">([^<]+)</g)].map(m => [m[3], m[1], m[2]]),
    [['客户列表', 'screen', 'active'], ['公海客户', 'screen', 'pool'], ['客户查重', 'screen', 'duplicates'], ['客户设置', 'screen', 'customer-settings']]);
  assert.match(first.innerHTML, /role="menu"/);
  assert.equal(first.style.top, '176px', 'aligned with the hovered item: rail top + item offset');
  hover(h, railItem('客户'));
  assert.equal(h.flyout, first, 'same menu is not rebuilt');
  hover(h, railItem('交易'));
  assert.equal(first.removed, true); assert.equal(h.flyout.dataset.menu, '交易');
});

test('reserved and empty menus explain themselves instead of showing a blank panel', () => {
  let h = harness({settings: {}});
  hover(h, railItem('沟通'));
  assert.match(h.flyout.innerHTML, /功能入口已保留/); assert.doesNotMatch(h.flyout.innerHTML, /data-flyout-kind/);
  h = harness({settings: {favoriteNav: []}});
  hover(h, railItem('常用'));
  assert.match(h.flyout.innerHTML, /还没有常用导航/);
  h = harness({settings: undefined});
  hover(h, railItem('常用'));
  assert.equal([...h.flyout.innerHTML.matchAll(/data-flyout-kind="favorite"/g)].length, 3);
});

test('the flyout stays inside the rail area when the hovered item is near the bottom', () => {
  const h = harness({settings: {}});
  hover(h, railItem('客户', 900));
  assert.equal(h.flyout.style.top, `${56 + 700 - 8 - 100}px`);
});

test('leaving for empty space closes the flyout after a short delay; moving onto it keeps it; touch never opens it', () => {
  const h = harness({settings: {}});
  hover(h, railItem('客户'));
  h.listeners.pointerover({pointerType: 'mouse', target: {closest: sel => sel === '.rail-flyout' ? {} : null}});
  assert.equal(h.calls.timers.length, 0, 'pointer on the flyout schedules nothing');
  h.listeners.pointerover({pointerType: 'mouse', target: {closest: () => null}});
  assert.equal(h.calls.timers.at(-1).ms, 160);
  h.calls.timers.at(-1).fn();
  assert.equal(h.flyout.removed, true);
  const t = harness({settings: {}});
  t.listeners.pointerover({pointerType: 'touch', target: railItem('客户')});
  assert.equal(t.flyout, null);
});

test('choosing a flyout entry closes it and goes to the right place', async () => {
  let h = harness({settings: {}});
  hover(h, railItem('交易'));
  const open = h.flyout;
  await run(h, 'activateRailFlyout("route", "order-trash")');
  assert.equal(open.removed, true);
  assert.deepEqual(h.calls.navigate, [['order-trash']]);
  h = harness({settings: {}});
  await run(h, 'activateRailFlyout("screen", "pool")');
  assert.deepEqual([h.calls.navigate, h.calls.screens], [[['customers', '', true, false]], ['pool']]);
  h = harness({settings: {}});
  await run(h, 'activateRailFlyout("favorite", "duplicates")');
  assert.deepEqual([h.calls.navigate, h.calls.screens], [[['customers', '', true, true]], ['duplicates']]);
});

// ---------------- wiring that needs a real browser to exercise ----------------
test('placeholders are gone and the real handlers, rail attributes and mode switch are wired', () => {
  assert.doesNotMatch(app, /常用导航管理/);
  for (const hook of [
    'data-rail-menu="${label}"', 'label === "常用" ? \'data-action="favorite-nav"\'', 'd.action === "favorite-nav") return openFavorites()',
    'd.action === "favorite-nav-manage"', 'd.flyoutKind', 'd.navFavorite', 'd.favoriteJump', 'Number(d.direction)', 'd.favoriteMove', 'd.favoriteRemove',
    'if (activeRoute === "customers" && favoritesMode) return favoritesSubnav();',
    'favoritesMode = favorites && activeRoute === "customers";',
    'railActive(label, route) ? "active" : ""', 'return RM.sectionFor(activeRoute)?.label === label;'
  ]) assert.ok(app.includes(hook), hook);
});

test('both modules are loaded before the app and the rail uses the glass styling', () => {
  const build = fs.readFileSync(path.join(__dirname, '../scripts/build.py'), 'utf8');
  const template = fs.readFileSync(path.join(__dirname, '../src/template.html'), 'utf8');
  for (const marker of ['NAV_FAVORITES', 'RAIL_MENU']) assert.ok(template.indexOf(`<!--${marker}-->`) > 0 && template.indexOf(`<!--${marker}-->`) < template.indexOf('<!--PREVIEW_APP-->'), marker);
  assert.ok(template.indexOf('<!--NAV_FAVORITES-->') < template.indexOf('<!--RAIL_MENU-->'), 'rail-menu needs nav-favorites first');
  assert.match(build, /'<!--RAIL_MENU-->','rail-menu\.js','script'/);
  const css = fs.readFileSync(path.join(__dirname, '../src/customer-replica.css'), 'utf8');
  assert.match(css, /\.rail-flyout-panel\s*\{[^}]*backdrop-filter:\s*blur\(/s);
  assert.match(css, /\.rail\s*\{[^}]*radial-gradient/s);
});

// ---------------- each rail menu owns its own sub-navigation ----------------
test('every business page belongs to exactly one menu, and menus never repeat each other\'s entries', () => {
  const routes = ['dashboard', 'order-list', 'order-trash', 'team-goals', 'team-wall', 'analysis', 'team-assets', 'team-followups', 'team-tasks', 'team-orders', 'calendar', 'settings'];
  const sections = routes.map(route => [route, RM.sectionFor(route)]);
  for (const [route, section] of sections) assert.ok(section, route);
  assert.deepEqual(sections.map(([, s]) => s.label), ['工作台', '交易', '交易', '团队数据', '团队数据', '团队数据', '团队数据', '团队数据', '团队数据', '团队数据', '协同', '企业管理']);
  assert.deepEqual(RM.sectionFor('order-trash').entries.map(e => e.label), ['全部订单', '订单回收站']);
  assert.deepEqual(RM.sectionFor('order-list'), RM.sectionFor('order-trash'));
  const labels = ['工作台', '交易', '团队数据', '协同', '企业管理'];
  const all = labels.flatMap(label => RM.sectionFor(RM.menuFor(label, {})[0].target).entries.filter(e => e.kind === 'route').map(e => e.target));
  assert.deepEqual([...all].sort(), [...routes].sort(), 'together they cover every page once, with no duplicates');
  for (const label of labels)
    assert.deepEqual(RM.sectionFor(RM.menuFor(label, {})[0].target).entries.map(e => e.target), RM.menuFor(label, {}).map(e => e.target), `${label}: sub-navigation matches the hover menu`);
  for (const other of ['customers', 'nope', undefined, '__proto__']) assert.equal(RM.sectionFor(other), null);
});

test('the shipped sub-navigation shows only the active menu and highlights the current page', () => {
  const body = app.slice(app.indexOf('  function subnav() {'), app.indexOf('  async function navigateApp'));
  const render = route => {
    const boundary = {RM, E: escapeHtml, activeRoute: route, favoritesMode: false, customerScreen: 'active', icon: name => `<i:${name}>`,
      favoritesSubnav: () => '', customerNavToggle: () => '', favoriteStar: () => ''};
    vm.createContext(boundary); vm.runInContext(body, boundary);
    return vm.runInContext('subnav()', boundary);
  };
  const entries = html => [...html.matchAll(/<button class="nav-entry ?(active)?" data-lai-route="([\w-]+)"><i:(\w+)>([^<]+)<\/button>/g)].map(m => [m[4], m[2], m[1] === "active", m[3]]);
  let html = render('order-trash');
  assert.match(html, /^<h3>交易<\/h3>/);
  assert.deepEqual(entries(html), [['全部订单', 'order-list', false, 'box'], ['订单回收站', 'order-trash', true, 'folder']]);
  html = render('analysis');
  assert.match(html, /^<h3>团队数据<\/h3>/);
  assert.deepEqual(entries(html), [['目标完成情况', 'team-goals', false, 'check'], ['团队墙', 'team-wall', false, 'grid'], ['经营统计', 'analysis', true, 'chart'], ['客户资产', 'team-assets', false, 'people'], ['跟进情况', 'team-followups', false, 'chat'], ['任务完成', 'team-tasks', false, 'check'], ['订单业绩', 'team-orders', false, 'note']]);
  html = render('team-tasks');
  assert.match(html, /^<h3>团队数据<\/h3>/);
  assert.deepEqual(entries(html), [['目标完成情况', 'team-goals', false, 'check'], ['团队墙', 'team-wall', false, 'grid'], ['经营统计', 'analysis', false, 'chart'], ['客户资产', 'team-assets', false, 'people'], ['跟进情况', 'team-followups', false, 'chat'], ['任务完成', 'team-tasks', true, 'check'], ['订单业绩', 'team-orders', false, 'note']]);
  assert.deepEqual([...html.matchAll(/<details class="subnav-group" open><summary>([^<]+)<\/summary>/g)].map(m => m[1]), ['目标数据', '统计报表'], 'grouped like the reference layout');
  assert.match(html, /<summary>目标数据<\/summary><button class="nav-entry " data-lai-route="team-goals">[^]*?<button class="nav-entry" data-feature="目标管理">[^]*?data-lai-route="team-wall"[^]*?<\/details><details/, 'reserved 目标管理 sits between the two live pages and only shows a notice');
  assert.doesNotMatch(render('order-list'), /<details/, 'menus without groups stay flat');
  assert.deepEqual(entries(render('calendar')), [['日历与待办', 'calendar', true, 'clock']]);
  assert.deepEqual(entries(render('settings')), [['设置', 'settings', true, 'settings']]);
  assert.deepEqual(entries(render('dashboard')), [['工作台', 'dashboard', true, 'grid']]);
  assert.doesNotMatch(app, /<h3>经营管理<\/h3>/);
});

test('a reserved flyout entry only shows the reserved-entry notice and navigates nowhere', async () => {
  const h = harness({settings: {}});
  hover(h, railItem('团队数据'));
  assert.match(h.flyout.innerHTML, /data-flyout-kind="feature" data-flyout-target="目标管理">目标管理</);
  assert.match(h.flyout.innerHTML, /data-flyout-kind="route" data-flyout-target="team-wall">团队墙</);
  await run(h, 'activateRailFlyout("feature", "目标管理")');
  assert.deepEqual([h.calls.notices, h.calls.navigate], [['目标管理'], []]);
});
