const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const RM = require('../src/rail-menu.js');
const F = require('../src/nav-favorites.js');
const {escapeHtml} = require('../src/model.js');
require('../src/mail-ui.js');
const Mail = globalThis.LaiMailUI;

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const app = read('src/app.js');

// 所有真实入口（任务书第二节第 3 点）：客户 4 + 商机 3 + 工作台 1 + 邮件 6 + 沟通 2 + 交易 5 + 团队数据 8 + 协同 2 + 设置 3 + 企业管理 2。线索和 Leads 已去掉（D-030）。
const ALL = [
  'screen:active', 'screen:pool', 'screen:duplicates', 'screen:customer-settings',
  'route:opportunities', 'route:opp-analysis', 'route:opp-flows',
  'route:dashboard',
  'mail:inbox', 'mail:pending', 'mail:unread', 'mail:drafts', 'mail:sent', 'mail:bulk',
  'route:chats', 'route:chat-templates',
  'route:order-list', 'route:order-trash', 'route:products', 'route:doc-templates', 'route:rates',
  'route:team-goals', 'route:team-targets', 'route:team-wall', 'route:analysis', 'route:team-assets', 'route:team-followups', 'route:team-tasks', 'route:team-orders',
  'route:calendar', 'route:task-settings', 'route:settings', 'route:settings-hub', 'route:feature-switch',
  'route:roles', 'route:members'
];
const MENUS = ['客户', '商机', '工作台', '邮件', '沟通', '交易', '团队数据', '协同', '设置', '企业管理'];
// 沟通 became a real menu (WhatsApp, D-023); no menu is a pure placeholder any more. 线索 and Leads were removed (D-030).
const RESERVED = [];

// ---------------- 清单只有一份来源 ----------------
test('every real entry of every menu is favoritable, in menu order; the reserved menus have nothing to favorite', () => {
  assert.deepEqual(F.catalog.map(e => e.id), ALL);
  assert.deepEqual(RM.favoritable().map(e => e.id), ALL);
  assert.equal(new Set(ALL).size, ALL.length, 'ids are unique');
  const fromMenus = MENUS.flatMap(label => RM.menuFor(label).map(row => row.id));
  assert.deepEqual(fromMenus, ALL, 'the catalog is exactly the menus\' real rows');
  for (const row of MENUS.flatMap(label => RM.menuFor(label))) assert.equal(row.id, `${row.kind}:${row.target}`, row.label);
  for (const label of RESERVED) assert.equal(RM.menuFor(label), null, label + ' has no rows, so nothing to favorite');
  assert.equal(RM.menuFor('常用'), null, '常用 builds its list from the saved favorites (nav-favorites.js), not from a fixed menu');
  assert.deepEqual(F.catalog.map(e => [e.id, e.label, e.menu]).filter(([id]) => /^(screen|mail):/.test(id) || id === 'route:dashboard').map(([, label, menu]) => `${menu}/${label}`),
    ['客户/客户列表', '客户/公海客户', '客户/客户查重', '客户/客户设置', '工作台/工作台', '邮件/收件箱', '邮件/待处理邮件', '邮件/未读邮件', '邮件/草稿箱', '邮件/发件箱', '邮件/群发箱']);
});

test('nav-favorites.js holds no list of pages of its own and depends on rail-menu.js, never the other way round', () => {
  const code = text => text.split('\n').map(line => line.replace(/\/\/.*$/, '')).join('\n');
  const nf = code(read('src/nav-favorites.js')), rm = code(read('src/rail-menu.js'));
  assert.doesNotMatch(nf, /screen:|route:|mail:|客户列表|收件箱|订单|工作台|日历|设置/, 'no copied ids or labels');
  assert.match(nf, /RM\.favoritable\(\)/);
  assert.doesNotMatch(rm, /nav-favorites|LaiNavFavorites|require\(/, 'rail-menu.js must not reach back into nav-favorites.js (no circular dependency)');
});

test('a page added to a menu becomes favoritable without touching nav-favorites.js', () => {
  const source = name => read('src/' + name);
  const sandbox = {};
  vm.createContext(sandbox);
  sandbox.window = sandbox;
  const patched = source('rail-menu.js').replace("['任务设置','route','task-settings'])", "['任务设置','route','task-settings'],['新页面','route','brand-new'])");
  assert.notEqual(patched, source('rail-menu.js'), 'the fixture edit applied');
  vm.runInContext(patched, sandbox);
  vm.runInContext(source('nav-favorites.js'), sandbox);
  const NF = sandbox.LaiNavFavorites;
  assert.equal(NF.known('route:brand-new'), true);
  assert.deepEqual([...NF.list(NF.toggle({}, 'route:brand-new'))], ['route:brand-new']);
  assert.equal(NF.entry('route:brand-new').menu, '协同');
  assert.equal(F.known('route:brand-new'), false, 'the real catalog is untouched');
});

// ---------------- 保存的列表 ----------------
test('never configured means no favorites; an explicit empty list stays empty', () => {
  for (const unset of [undefined, null, {}, {favoriteNav: 'screen:pool'}, {favoriteNav: {0: 'screen:pool'}}, {favoriteNav: null}])
    assert.deepEqual(F.list(unset), []);
  assert.deepEqual(F.list({favoriteNav: []}), []);
  assert.equal(F.isFavorite(undefined, 'screen:pool'), false);
  assert.deepEqual(F.entries(undefined), []);
});

test('ids saved by the earlier version stay valid and keep their order', () => {
  const saved = {favoriteNav: ['screen:duplicates', 'screen:active', 'screen:pool']};
  assert.deepEqual(F.list(saved), ['screen:duplicates', 'screen:active', 'screen:pool']);
  assert.deepEqual(F.entries(saved).map(e => [e.id, e.label, e.kind, e.target]), [['screen:duplicates', '客户查重', 'screen', 'duplicates'], ['screen:active', '客户列表', 'screen', 'active'], ['screen:pool', '公海客户', 'screen', 'pool']]);
  assert.deepEqual(F.list({favoriteNav: ['screen:active', 'screen:pool', 'screen:duplicates']}), ['screen:active', 'screen:pool', 'screen:duplicates'], 'an old "all three" list is respected as saved, not reset');
  assert.deepEqual(F.list({favoriteNav: []}), [], 'an old explicit clear stays cleared');
});

test('every kind of entry can be toggled on and off, without touching the input or other settings', () => {
  for (const id of ALL) {
    const start = Object.freeze({defaultOwner: 'Amy'});
    const on = F.toggle(start, id);
    assert.deepEqual(F.list(on), [id], id);
    assert.equal(on.defaultOwner, 'Amy', 'other settings are preserved');
    assert.equal(start.favoriteNav, undefined, 'input untouched');
    assert.deepEqual(F.list(F.toggle(on, id)), [], id + ' toggles back off');
  }
  const mixed = ['route:order-trash', 'mail:pending', 'screen:pool'].reduce((settings, id) => F.toggle(settings, id), {});
  assert.deepEqual(F.list(mixed), ['route:order-trash', 'mail:pending', 'screen:pool'], 'new favorites are appended in the order they were added');
  assert.deepEqual(F.list(F.toggle(mixed, 'mail:pending')), ['route:order-trash', 'screen:pool']);
  assert.deepEqual(mixed.favoriteNav, ['route:order-trash', 'mail:pending', 'screen:pool'], 'earlier result untouched');
});

test('unknown and reserved entries are rejected on write and silently filtered on read', () => {
  for (const bad of ['screen:nope', undefined, null, '', 'feature:沟通', 'route:customers', 'route:mail', 'route:favorites', 'mail:trash', '__proto__', 'constructor'])
    assert.throws(() => F.toggle({}, bad), /不能加入常用/, String(bad));
  assert.throws(() => F.remove({}, '__proto__'), /不能加入常用/);
  assert.throws(() => F.move({}, 'x', 1), /不能加入常用/);
  assert.deepEqual(F.list({favoriteNav: ['screen:pool', 'screen:pool', 'x', 7, null, {}, 'route:calendar', 'feature:沟通']}), ['screen:pool', 'route:calendar']);
  assert.deepEqual(F.toggle({favoriteNav: ['screen:pool', 'screen:pool', 'gone']}, 'screen:active').favoriteNav, ['screen:pool', 'screen:active']);
});

test('move reorders any mix of entries by one step and clamps at both ends', () => {
  const list = ['route:order-list', 'mail:inbox', 'screen:pool'];
  const s = {favoriteNav: list};
  assert.deepEqual(F.list(F.move(s, 'screen:pool', -1)), ['route:order-list', 'screen:pool', 'mail:inbox']);
  assert.deepEqual(F.list(F.move(s, 'route:order-list', 1)), ['mail:inbox', 'route:order-list', 'screen:pool']);
  assert.deepEqual(F.list(F.move(s, 'route:order-list', -1)), list, 'first item cannot move up');
  assert.deepEqual(F.list(F.move(s, 'screen:pool', 1)), list, 'last item cannot move down');
  assert.deepEqual(s.favoriteNav, list, 'input untouched');
  assert.throws(() => F.move({favoriteNav: ['screen:pool']}, 'route:calendar', 1), /尚未加入常用/);
});

test('remove drops one entry of any kind and keeps the order of the rest', () => {
  const s = {favoriteNav: ['route:order-list', 'mail:inbox', 'screen:pool']};
  assert.deepEqual(F.list(F.remove(s, 'mail:inbox')), ['route:order-list', 'screen:pool']);
  assert.deepEqual(F.list(F.remove({favoriteNav: []}, 'route:calendar')), [], 'removing a non-favorite is a no-op');
  assert.deepEqual(F.list(F.remove({}, 'route:calendar')), [], 'nothing is favorited by default');
});

test('entries resolves labels, owning menu and target for every kind', () => {
  const entries = F.entries({favoriteNav: ['mail:bulk', 'route:analysis', 'screen:customer-settings', 'route:dashboard']});
  assert.deepEqual(entries.map(e => [e.label, e.menu, e.kind, e.target]), [['群发箱', '邮件', 'mail', 'bulk'], ['经营统计', '团队数据', 'route', 'analysis'], ['客户设置', '客户', 'screen', 'customer-settings'], ['工作台', '工作台', 'route', 'dashboard']]);
  assert.ok(Object.isFrozen(F.catalog[0]), 'catalog entries cannot be altered by callers');
});

// ---------------- 装载顺序 ----------------
test('rail-menu.js loads before nav-favorites.js and both before the app, in the template and in the build script', () => {
  const build = read('scripts/build.py'), template = read('src/template.html');
  const at = marker => template.indexOf(`<!--${marker}-->`);
  assert.ok(at('RAIL_MENU') > 0 && at('RAIL_MENU') < at('NAV_FAVORITES') && at('NAV_FAVORITES') < at('PREVIEW_APP'));
  assert.ok(at('LAI_MAIL_UI') < at('RAIL_MENU'), 'mail-ui needs neither (it gets hearts through the page shell)');
  assert.match(build, /'<!--RAIL_MENU-->','rail-menu\.js','script'\),\('<!--NAV_FAVORITES-->','nav-favorites\.js','script'\)/);
  for (const marker of ['RAIL_MENU', 'NAV_FAVORITES']) assert.equal(template.split(`<!--${marker}-->`).length, 2, marker);
  const css = read('src/customer-replica.css');
  assert.match(css, /\.rail-flyout-panel\s*\{[^}]*backdrop-filter:\s*blur\(/s);
  assert.match(css, /\.rail\s*\{[^}]*radial-gradient/s);
});

// ---------------- 悬停菜单与二级导航的内容 ----------------
test('rail menus list only existing destinations; callers cannot alter the menu definition', () => {
  const rows = label => RM.menuFor(label).map(r => [r.label, r.kind, r.target]);
  assert.deepEqual(rows('客户'), [['客户列表', 'screen', 'active'], ['公海客户', 'screen', 'pool'], ['客户查重', 'screen', 'duplicates'], ['客户设置', 'screen', 'customer-settings']]);
  assert.deepEqual(rows('交易'), [['全部订单', 'route', 'order-list'], ['订单回收站', 'route', 'order-trash'], ['产品', 'route', 'products'], ['单据模板', 'route', 'doc-templates'], ['汇率设置', 'route', 'rates']]);
  assert.deepEqual(rows('商机'), [['商机看板', 'route', 'opportunities'], ['商机分析', 'route', 'opp-analysis'], ['商机设置', 'route', 'opp-flows']]);
  assert.deepEqual(rows('邮件').map(r => r[2]), Mail.folders.map(f => f.id), 'the same six folders as the mail page');
  assert.deepEqual(rows('邮件').map(r => r[0]), Mail.folders.map(f => f.label));
  for (const unknown of ['不存在', '__proto__', 'constructor', ...RESERVED]) assert.equal(RM.menuFor(unknown), null, unknown);
  RM.menuFor('客户').pop(); RM.menuFor('客户')[0].label = 'x'; RM.favoritable()[0].label = 'x'; RM.sectionFor('calendar').entries.pop();
  assert.equal(RM.menuFor('客户').length, 4);
  assert.deepEqual([RM.menuFor('客户')[0].label, RM.favoritable()[0].label, RM.sectionFor('calendar').entries.length], ['客户列表', '客户列表', 2], 'callers get copies and cannot alter the menu definition');
});

test('every business page belongs to exactly one menu, and menus never repeat each other\'s entries', () => {
  const routes = ['dashboard', 'order-list', 'order-trash', 'products', 'doc-templates', 'rates', 'team-goals', 'team-targets', 'team-wall', 'analysis', 'team-assets', 'team-followups', 'team-tasks', 'team-orders', 'calendar', 'task-settings', 'settings', 'settings-hub', 'feature-switch', 'roles', 'members'];
  const sections = routes.map(route => [route, RM.sectionFor(route)]);
  for (const [route, section] of sections) assert.ok(section, route);
  assert.deepEqual(sections.map(([, s]) => s.label), ['工作台', '交易', '交易', '交易', '交易', '交易', '团队数据', '团队数据', '团队数据', '团队数据', '团队数据', '团队数据', '团队数据', '团队数据', '协同', '协同', '设置', '设置', '设置', '企业管理', '企业管理']);
  assert.deepEqual(RM.sectionFor('order-trash').entries.map(e => e.label), ['全部订单', '订单回收站', '产品', '单据模板', '汇率设置']);
  const labels = ['工作台', '交易', '团队数据', '协同', '设置', '企业管理'];
  const all = labels.flatMap(label => RM.sectionFor(RM.menuFor(label)[0].target).entries.filter(e => e.kind === 'route').map(e => e.target));
  assert.deepEqual([...all].sort(), [...routes].sort(), 'together they cover every page once, with no duplicates');
  for (const other of ['customers', 'nope', undefined, '__proto__', 'mail', 'favorites']) assert.equal(RM.sectionFor(other), null);
});

// ---------------- 从真实 app.js 取出的片段，放在替身边界后面运行 ----------------
// 片段一：左侧栏高亮、心形、常用模式、悬停浮层、各菜单二级导航、页面跳转（从 railActive 到 navigateApp 结束）。
// 片段二：点击分发（左侧栏／二级导航／浮层里的所有按钮）。
function between(from, to) {
  const start = app.indexOf(from), end = app.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `app.js must still contain ${from} … ${to}`);
  return app.slice(start, end);
}
const navCode = between('  // 当前页面属于哪个左侧菜单', '  function showCustomerScreen(');
const clickStart = app.indexOf('    if (d.flyoutKind) return activateRailFlyout');
assert.ok(clickStart > 0, 'the click dispatcher must still route flyout entries');
const clickCode = app.slice(app.lastIndexOf('  document.addEventListener("click", (e) => {', clickStart), app.indexOf('\n  });\n', clickStart) + '\n  });\n'.length);
assert.ok(clickCode.length > 200 && clickCode.length < 6000 && !/function \w+\(/.test(clickCode.replace(/\(\w+\) => /g, '')), 'only the dispatcher itself, no functions declared next to it');

function parseButtons(html, region, calls) {
  const out = [];
  for (const m of String(html).matchAll(/<button\b([^>]*)>/g)) {
    const attrs = m[1];
    const dataset = {};
    for (const [, key, value] of attrs.matchAll(/\bdata-([\w-]+)="([^"]*)"/g))
      dataset[key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const classes = new Set(((/\bclass="([^"]*)"/.exec(attrs) || [])[1] || '').split(/\s+/).filter(Boolean));
    const el = {
      region, dataset, attrs: Object.fromEntries([...attrs.matchAll(/\b(aria-[\w-]+|title|role)="([^"]*)"/g)].map(a => [a[1], a[2]])), disabled: /\bdisabled\b/.test(attrs),
      classList: {contains: c => classes.has(c), toggle: (c, on) => { on ? classes.add(c) : classes.delete(c); }, get list() { return [...classes]; }},
      setAttribute(k, v) { el.attrs[k] = String(v); }, getAttribute: k => el.attrs[k],
      get title() { return el.attrs.title; }, set title(v) { el.attrs.title = v; },
      closest: sel => (sel === 'button' ? el : sel === '.rail' && region === 'rail' ? {} : sel === '#app-subnav' && region === 'subnav' ? {} : sel === '.rail-flyout' && region === 'flyout' ? {} : null),
      focus: () => calls.focused.push(dataset.navFavorite || dataset.favoriteMove || dataset.action || dataset.favoriteOpen || 'button'),
    };
    out.push(el);
  }
  return out;
}

function harness({settings, flush = true, failSave = null, route = 'customers', favoritesMode = false, customerScreen = 'active', mail = {view: 'mail', folder: 'inbox'}} = {}) {
  const calls = {persist: [], toasts: [], drawers: [], focused: [], hash: [], customers: [], business: [], mailSelect: [], shells: 0, notices: [], timers: [], closeModal: 0, flushes: 0, collapsedRemoved: 0};
  const listeners = {};
  const ui = {rail: '', subnav: '', main: ''};
  const cache = {};
  let flyout = null;
  const mailState = {...mail};
  const boundary = {
    NF: F, RM, R: require('../src/role-model.js'), FS: require('../src/feature-switch-model.js'), E: escapeHtml, icons: {heart: 'M0 0h24v24z'}, icon: name => `<i:${name}>`, menuIcon: name => `<i:${name}>`,
    state: {customers: {}, orders: [], laiSettings: settings},
    activeRoute: route, favoritesMode, customerScreen, currentName: '', failSave, flush,
    mail: {view: () => mailState.view, folder: () => mailState.folder, subnav: () => '<MAIL-SUBNAV/>', composing: () => false, leave: async () => true, select: folder => { mailState.view = 'mail'; mailState.folder = folder || 'inbox'; calls.mailSelect.push(folder); boundary.shell('<MAIL-PAGE/>'); }},
    business: {navigate: target => { calls.business.push(target); boundary.shell(`<BUSINESS ${target}/>`); }},
    customerNavToggle: () => '<TOGGLE>',
    // 与真实 persist 一样：上一次保存还没完成时再保存会报错。
    persist: async next => {
      if (boundary.saving) throw new Error('上一项修改正在保存，请稍候');
      boundary.saving = true;
      try { if (boundary.gate) { boundary.held = true; await boundary.gate; } await Promise.resolve(); if (boundary.failSave) throw new Error(boundary.failSave); calls.persist.push(next); boundary.state = next; return true; } finally { boundary.saving = false; }
    },
    toast: message => calls.toasts.push(message),
    window: {flushPendingSave: async () => { calls.flushes++; return boundary.flush; }, LaiActivityCategoryNavigation: {mount() {}}},
    history: {replaceState: (a, b, hash) => calls.hash.push(hash)},
    rememberCustomerListViewport() {}, closeModal: () => { calls.closeModal++; }, closeDropdowns() {}, removePopover() {},
    drawer: (...args) => calls.drawers.push(args),
    list: () => { boundary.customerScreen = 'active'; boundary.shell('<CUSTOMER-LIST/>'); },
    detail: name => { calls.customers.push(['detail', name]); boundary.shell('<DETAIL/>'); },
    showCustomerScreen: screen => { calls.customers.push(['screen', screen]); boundary.customerScreen = screen; boundary.shell(`<CUSTOMER-${screen}/>`); },
    customerSettings: () => { calls.customers.push(['settings']); boundary.customerScreen = 'customer-settings'; boundary.shell('<CUSTOMER-SETTINGS/>'); },
    $: selector => selector === '#app' ? {classList: {remove: () => { calls.collapsedRemoved++; }, contains: () => false}} : null,
    document: {
      querySelectorAll: selector => {
        const scope = selector.startsWith('#app-subnav') ? ['subnav'] : ['rail', 'subnav', 'flyout'];
        return scope.flatMap(region => regionButtons(region)).filter(button => button.dataset.navFavorite);
      },
      querySelector: selector => {
        if (selector === '#app-subnav') return {set innerHTML(v) { ui.subnav = v; }, get innerHTML() { return ui.subnav; }};
        if (selector === '.main') return {set innerHTML(v) { ui.main = v; }, get innerHTML() { return ui.main; }};
        if (selector === '.rail-flyout') return flyout && !flyout.removed ? flyout : null;
        if (selector === '#app-subnav [data-action="favorite-nav-manage"]') return regionButtons('subnav').find(b => b.dataset.action === 'favorite-nav-manage') || null;
        return null;
      },
      createElement: () => (flyout = {dataset: {}, style: {}, className: '', innerHTML: '', offsetHeight: 100, removed: false, remove() { this.removed = true; }}),
      addEventListener: (type, fn) => { listeners[type] = fn; },
    },
    setTimeout: (fn, ms) => { calls.timers.push({fn, ms}); return calls.timers.length; }, clearTimeout() {},
  };
  function regionHtml(region) { return region === 'rail' ? ui.rail : region === 'subnav' ? ui.subnav : flyout && !flyout.removed ? flyout.innerHTML : ''; }
  function regionButtons(region) {
    const html = regionHtml(region);
    if (!cache[region] || cache[region].html !== html) cache[region] = {html, buttons: parseButtons(html, region, calls)};
    return cache[region].buttons;
  }
  vm.createContext(boundary);
  vm.runInContext(navCode, boundary);
  // 页面通过 renderShell 画进外框（真实的 renderShell 只换 main、就地更新外框）；替身每次都记下左侧栏、二级导航和 main 的标记。
  vm.runInContext(`function shell(content) { __ui.rail = appNav(); __ui.subnav = subnav(); __ui.main = content; __ui.shells++; return ''; }
function renderShell(content) { shell(content); }`, Object.assign(boundary, {__ui: Object.assign(ui, {shells: 0})}));
  vm.runInContext(clickCode, boundary);
  vm.runInContext(`function boundaryRender() { shell('<INITIAL/>'); }`, boundary);
  const h = {boundary, calls, ui, listeners, mailState, regionButtons,
    run: code => vm.runInContext(code, boundary),
    render: () => boundary.boundaryRender(),
    get flyout() { return flyout; },
    heart: (id, region = 'subnav') => regionButtons(region).find(b => b.dataset.navFavorite === id),
    hearts: region => regionButtons(region).filter(b => b.dataset.navFavorite),
    button: (region, predicate) => regionButtons(region).find(predicate),
    click: async button => { assert.ok(button, 'button to click exists'); return listeners.click({target: {closest: sel => (sel === 'button' ? button : null)}, detail: 1}); },
    favorites: () => F.list(boundary.state.laiSettings),
    labels: region => [...regionHtml(region).matchAll(/<span class="nav-label">([^<]*)<\/span>/g)].map(m => m[1]),
    active: region => [...regionHtml(region).matchAll(/class="nav-entry active"[^>]*>(?:<i:\w+>)?<span class="nav-label">([^<]*)</g)].map(m => m[1]),
    railActive: () => [...ui.rail.matchAll(/<button class="rail-item active" data-rail-menu="([^"]+)"/g)].map(m => m[1]),
    subnavTitle: () => (/^<h3>([^<]*)/.exec(ui.subnav) || [])[1],
  };
  return h;
}
const rail = (h, label) => h.button('rail', b => b.dataset.railMenu === label);
const railMenu = async (h, label) => { await h.click(rail(h, label)); };

// ---------------- 心形标志的标记 ----------------
test('heart markup: an inline SVG, off by default, and the labels say 设为常用 / 取消常用', () => {
  let h = harness({settings: undefined});
  let html = h.run('favoriteHeart("screen:active","客户列表")');
  assert.match(html, /^<button type="button" class="nav-heart" data-nav-favorite="screen:active" data-nav-label="客户列表"/);
  assert.match(html, /aria-label="设为常用：客户列表" title="设为常用：客户列表"/);
  assert.match(html, /<svg class="nav-heart-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M0 0h24v24z"\/><\/svg><\/button>$/, 'drawn as SVG, not as a text glyph');
  assert.doesNotMatch(html, /[♡♥❤★☆]|收藏|星标|aria-pressed|is-favorite/);
  h = harness({settings: {favoriteNav: ['screen:active']}});
  html = h.run('favoriteHeart("screen:active","客户列表")');
  assert.match(html, /class="nav-heart is-favorite"/); assert.match(html, /aria-label="取消常用：客户列表" title="取消常用：客户列表"/);
  assert.equal(h.run('favoriteHeart("screen:nope","x")'), '', 'unknown entries get no heart');
  assert.equal(h.run('favoriteHeart(undefined,"x")'), '');
  assert.equal(h.run('favoriteHeart("feature:沟通","沟通")'), '', 'reserved entries get no heart');
  assert.match(h.run('favoriteHeart("route:calendar","日历与待办",\' role="menuitem"\')'), / role="menuitem">/, 'extra attributes land on the button');
});

test('the heart is drawn from one path shared with the icon set, filled or outlined by CSS only', () => {
  assert.match(app, /heart: "M20\.84 4\.61a5\.5 5\.5 0 0 0-7\.78 0L12 5\.67/);
  assert.match(app, /const HEART_PATH = icons\.heart;/);
  assert.match(app, /\["heart", "常用", null\]/, 'the 常用 rail icon is a heart too');
  const css = read('src/customer-replica.css');
  const rule = selector => new RegExp(selector.replace(/[.[\]()]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 's').exec(css)?.[1] || '';
  assert.doesNotMatch(css, /\.nav-star/, 'the star styles are gone');
  assert.match(rule('.nav-heart'), /opacity:\s*0;/, 'hidden by opacity, so the position stays and Tab still reaches it');
  assert.doesNotMatch(rule('.nav-heart'), /display:\s*none|visibility:\s*hidden/);
  assert.match(rule(".nav-heart"), /transition:\s*opacity var\(--motion-fast\)[^;]*color var\(--motion-fast\)/);
  assert.match(rule('.nav-heart'), /color:\s*var\(--ink-400\)/, 'light grey like the old star (theme token, was #a9b2c3)');
  assert.match(rule('.nav-heart-icon'), /fill:\s*none;[^}]*stroke:\s*currentColor/s);
  assert.match(rule('.nav-heart.is-favorite .nav-heart-icon'), /fill:\s*currentColor/);
  assert.match(rule('.nav-heart.is-favorite'), /opacity:\s*1;[^}]*color:\s*#e5456b/s, 'warm rose red, always shown');
  assert.match(css, /\.nav-row:hover \.nav-heart,\s*\.nav-row:has\(:focus-visible\) \.nav-heart[^{]*\.nav-heart:focus-visible\s*\{\s*opacity:\s*1;/s, 'row hover or keyboard focus reveals it; the focused heart itself is always visible');
  assert.match(css, /\.nav-heart:hover\s*\{[^}]*color:\s*var\(--ink-600\)/s, 'a little darker under the pointer');
  assert.match(css, /\.nav-entry\.active ~ \.nav-heart\s*\{[^}]*color:\s*var\(--ink-500\)/s, 'darker on the light-blue selected row');
  assert.match(css, /@media \(hover: none\)\s*\{\s*\.nav-heart:not\(\.is-favorite\)\s*\{\s*opacity:\s*0\.55;/s, 'touch devices: faint but always there');
  assert.match(css, /\.rail-flyout \.nav-heart\.is-favorite\s*\{[^}]*color:\s*#ff7d9b/s, 'a brighter rose on the dark flyout');
  assert.match(css, /\.rail-flyout-panel\s*\{[^}]*max-height:\s*calc\(100dvh - 72px\);[^}]*overflow-y:\s*auto/s, 'a long 常用 list scrolls inside the flyout instead of running off the window');
  assert.match(css, /\.rail-flyout-item:hover,\s*\.rail-flyout-item:focus-visible\s*\{[^}]*color:\s*#fff/s, 'entry text stays white on hover (the global button:hover colour would turn it blue)');
});

test('hearts appear beside the real entries of the customer sub-navigation (four, none lit by default)', () => {
  const h = harness({settings: undefined});
  h.render();
  assert.equal(h.subnavTitle(), '客户');
  assert.deepEqual(h.hearts('subnav').map(b => b.dataset.navFavorite), ['screen:active', 'screen:pool', 'screen:duplicates', 'screen:customer-settings']);
  assert.ok(h.hearts('subnav').every(b => !b.classList.contains('is-favorite')), 'nothing lit for a user who never set favorites');
  assert.ok(h.hearts('subnav').every(b => /^设为常用：/.test(b.attrs['aria-label'])));
  assert.deepEqual(h.active('subnav'), ['客户列表']);
  assert.match(h.ui.subnav, /<div class="nav-row"><button type="button" class="nav-entry active" data-lai-screen="active" aria-current="page"><i:people><span class="nav-label">客户列表<\/span><\/button><button type="button" class="nav-heart"/, 'the heart sits beside the entry button, not inside it');
});

test('every business menu\'s sub-navigation has a heart on each of its entries, grouped menus included', () => {
  for (const label of ['工作台', '交易', '团队数据', '协同', '设置']) {
    const entries = RM.menuFor(label);
    const h = harness({settings: undefined, route: entries[0].target});
    h.render();
    assert.equal(h.subnavTitle(), label);
    assert.deepEqual(h.hearts('subnav').map(b => b.dataset.navFavorite), entries.map(e => e.id), label);
    assert.deepEqual(h.hearts('subnav').map(b => b.dataset.navLabel), entries.map(e => e.label), label);
    assert.deepEqual(h.active('subnav'), [entries[0].label], label + ': current page highlighted');
  }
  const grouped = harness({settings: undefined, route: 'team-tasks'});
  grouped.render();
  assert.deepEqual([...grouped.ui.subnav.matchAll(/<details class="subnav-group" open><summary>([^<]+)<\/summary>/g)].map(m => m[1]), ['目标数据', '统计报表']);
  assert.equal(grouped.hearts('subnav').length, 8);
  assert.doesNotMatch(grouped.ui.subnav, /<button[^>]*><button/, 'no button nested in a button');
});

test('the mail folders get hearts through the same shell function', () => {
  const h = harness({settings: {favoriteNav: ['mail:pending']}, route: 'mail'});
  const mail = Mail.create({escape: escapeHtml, icon: name => `<i:${name}>`, favoriteHeart: (id, label) => h.run(`favoriteHeart(${JSON.stringify(id)},${JSON.stringify(label)})`), request: async () => ({ok: true, status: 200, json: async () => ({})}), mount() {}});
  const html = mail.subnav();
  const hearts = [...html.matchAll(/data-nav-favorite="([^"]+)" data-nav-label="([^"]+)" aria-label="([^"]+)"/g)].map(m => m.slice(1));
  assert.deepEqual(hearts, Mail.folders.map(f => ['mail:' + f.id, f.label, `${f.id === 'pending' ? '取消常用' : '设为常用'}：${f.label}`]));
  assert.equal([...html.matchAll(/class="nav-heart is-favorite"/g)].length, 1);
  assert.match(app, /mail = window\.LaiMailUI\.create\(\{\s*escape: E,\s*icon,\s*favoriteHeart,/, 'the page shell hands its heart function to the mail page');
});

test('the 常用 sub-navigation lists favorites of every kind in order with a lit heart each, marks the current page, and always offers management', () => {
  const settings = {favoriteNav: ['route:order-trash', 'mail:sent', 'screen:duplicates', 'route:analysis']};
  let h = harness({settings, route: 'mail', favoritesMode: true, mail: {view: 'mail', folder: 'sent'}});
  h.render();
  assert.equal(h.subnavTitle(), '常用');
  assert.deepEqual(h.labels('subnav'), ['订单回收站', '发件箱', '客户查重', '经营统计']);
  assert.deepEqual(h.regionButtons('subnav').filter(b => b.dataset.favoriteOpen).map(b => b.dataset.favoriteOpen), settings.favoriteNav);
  assert.deepEqual(h.active('subnav'), ['发件箱'], 'the current mail folder is highlighted');
  assert.match(h.ui.subnav, /aria-current="page"/);
  assert.ok(h.hearts('subnav').every(b => b.classList.contains('is-favorite') && /^取消常用：/.test(b.attrs['aria-label'])), 'every row shows a lit heart');
  assert.deepEqual(h.hearts('subnav').map(b => b.dataset.navFavorite), settings.favoriteNav);
  assert.match(h.ui.subnav, /data-action="favorite-nav-manage"/);
  assert.match(h.ui.subnav, /data-mail-action="compose"/, 'writing mail stays possible while in 常用 mode');
  assert.doesNotMatch(h.ui.subnav, /<TOGGLE>/, 'the collapse toggle belongs to the customer pages only');
  for (const [route, screen, current, expected] of [['customers', 'duplicates', null, '客户查重'], ['order-trash', 'active', null, '订单回收站'], ['analysis', 'active', null, '经营统计'], ['calendar', 'active', null, null], ['favorites', 'active', null, null]]) {
    h = harness({settings, route, favoritesMode: true, customerScreen: screen}); h.render();
    assert.deepEqual(h.active('subnav'), expected ? [expected] : [], `${route}/${screen}`);
    assert.doesNotMatch(h.ui.subnav, /data-mail-action="compose"/);
  }
  h = harness({settings, route: 'customers', favoritesMode: true, customerScreen: 'duplicates'}); h.render();
  assert.match(h.ui.subnav, /^<h3>常用<TOGGLE><\/h3>/);
  h = harness({settings, route: 'mail', favoritesMode: true, mail: {view: 'customer', folder: 'inbox'}}); h.render();
  assert.deepEqual(h.active('subnav'), [], 'the mail customer view is not a folder');
});

test('with no favorites the 常用 sub-navigation explains how to add one instead of showing nothing', () => {
  const h = harness({settings: {favoriteNav: []}, route: 'favorites', favoritesMode: true});
  h.render();
  assert.match(h.ui.subnav, /还没有常用导航。把鼠标移到导航条目上，点右侧的心形，就能加到常用。/);
  assert.doesNotMatch(h.ui.subnav, /☆|★|收藏/);
  assert.deepEqual(h.hearts('subnav'), []);
  assert.match(h.ui.subnav, /favorite-nav-manage/);
});

// ---------------- 悬停浮层 ----------------
const railItem = (label, offsetTop = 120) => ({dataset: {railMenu: label}, offsetTop, closest(sel) { return sel.startsWith('.rail-item') ? this : sel === '.rail' ? railBox : null; }});
const railBox = {offsetTop: 56, offsetHeight: 700, scrollTop: 0, after(el) { railBox.child = el; }};
const hover = (h, item) => h.listeners.pointerover({pointerType: 'mouse', target: item});

test('hovering a rail menu shows its entries beside the rail, with a heart on each real one, and does not rebuild on repeat hovers', () => {
  const h = harness({settings: {favoriteNav: ['screen:pool']}});
  hover(h, railItem('客户'));
  const first = h.flyout;
  assert.equal(railBox.child, first);
  assert.equal(first.dataset.menu, '客户');
  assert.deepEqual([...first.innerHTML.matchAll(/data-flyout-kind="(\w+)" data-flyout-target="([\w-]+)">([^<]+)</g)].map(m => [m[3], m[1], m[2]]),
    [['客户列表', 'screen', 'active'], ['公海客户', 'screen', 'pool'], ['客户查重', 'screen', 'duplicates'], ['客户设置', 'screen', 'customer-settings']]);
  assert.deepEqual(h.hearts('flyout').map(b => [b.dataset.navFavorite, b.classList.contains('is-favorite')]), [['screen:active', false], ['screen:pool', true], ['screen:duplicates', false], ['screen:customer-settings', false]]);
  assert.match(first.innerHTML, /role="menu"/);
  assert.match(first.innerHTML, /<div class="rail-flyout-row" role="none"><button type="button" role="menuitem" class="rail-flyout-item"[^>]*>客户列表<\/button><button type="button" class="nav-heart"/, 'heart is a sibling of the entry button');
  assert.equal(first.style.top, '176px', 'aligned with the hovered item: rail top + item offset');
  hover(h, railItem('客户'));
  assert.equal(h.flyout, first, 'same menu is not rebuilt');
  hover(h, railItem('交易'));
  assert.equal(first.removed, true); assert.equal(h.flyout.dataset.menu, '交易');
  assert.deepEqual(h.hearts('flyout').map(b => b.dataset.navFavorite), ['route:order-list', 'route:order-trash', 'route:products', 'route:doc-templates', 'route:rates']);
});

test('every menu\'s flyout carries hearts for exactly its real entries (mail folders and team pages included)', () => {
  for (const label of MENUS) {
    const h = harness({settings: undefined});
    hover(h, railItem(label));
    assert.deepEqual(h.hearts('flyout').map(b => b.dataset.navFavorite), RM.menuFor(label).map(r => r.id), label);
    assert.deepEqual(h.hearts('flyout').map(b => b.attrs.role), RM.menuFor(label).map(() => 'menuitem'));
  }
});

test('reserved menus explain themselves, with no hearts; an empty 常用 flyout says how to add one', () => {
  let h = harness({settings: {}});
  for (const label of RESERVED) {
    hover(h, railItem(label));
    assert.match(h.flyout.innerHTML, /功能入口已保留/); assert.doesNotMatch(h.flyout.innerHTML, /data-flyout-kind|nav-heart/, label);
  }
  h = harness({settings: undefined});
  hover(h, railItem('常用'));
  assert.match(h.flyout.innerHTML, /还没有常用导航。把鼠标移到导航条目上，点右侧的心形，就能加到常用。/);
  assert.doesNotMatch(h.flyout.innerHTML, /☆|★|收藏|data-flyout-kind/);
});

test('沟通 is a real menu (WhatsApp): the rail icon opens 聊天记录, the flyout lists both pages with hearts and no reserved notice', () => {
  assert.deepEqual(RM.menuFor('沟通').map(r => [r.label, r.kind, r.target, r.id]), [['聊天记录', 'route', 'chats', 'route:chats'], ['聊天模板', 'route', 'chat-templates', 'route:chat-templates']]);
  assert.match(app, /\["chat", "沟通", "chats"\]/);
  assert.equal(RM.sectionFor('chats').label, '沟通');
  assert.equal(RM.sectionFor('chat-templates').label, '沟通');
  const h = harness({settings: undefined});
  hover(h, railItem('沟通'));
  assert.doesNotMatch(h.flyout.innerHTML, /功能入口已保留/);
  assert.deepEqual(h.hearts('flyout').map(b => b.dataset.navFavorite), ['route:chats', 'route:chat-templates']);
  assert.equal(RM.menuFor('线索'), null, '线索 is gone (D-030)');
  assert.equal(RM.menuFor('Leads'), null, 'Leads is gone (D-030)');
});

test('the 常用 flyout lists the favorites of every kind, each with a lit heart', () => {
  const h = harness({settings: {favoriteNav: ['route:team-wall', 'mail:inbox', 'screen:active']}});
  hover(h, railItem('常用'));
  assert.deepEqual([...h.flyout.innerHTML.matchAll(/data-flyout-kind="(\w+)" data-flyout-target="([^"]+)">([^<]+)</g)].map(m => [m[3], m[1], m[2]]),
    [['团队墙', 'favorite', 'route:team-wall'], ['收件箱', 'favorite', 'mail:inbox'], ['客户列表', 'favorite', 'screen:active']]);
  assert.ok(h.hearts('flyout').every(b => b.classList.contains('is-favorite') && /^取消常用：/.test(b.attrs['aria-label'])));
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

// ---------------- 点击：切换常用、保存、同步 ----------------
test('clicking a heart saves the toggled list, keeps other settings, and lights every copy of that heart', async () => {
  const h = harness({settings: {defaultOwner: 'Amy'}, route: 'order-list'});
  h.render();
  hover(h, railItem('交易'));
  const inSubnav = h.heart('route:order-trash', 'subnav'), inFlyout = h.heart('route:order-trash', 'flyout');
  assert.ok(inSubnav && inFlyout, 'the same entry is visible in two places');
  await h.click(inSubnav);
  assert.deepEqual(h.calls.persist[0].laiSettings, {defaultOwner: 'Amy', favoriteNav: ['route:order-trash']});
  assert.deepEqual(h.calls.persist[0].orders, [], 'the rest of the state is carried over unchanged');
  for (const heart of [inSubnav, inFlyout]) {
    assert.ok(heart.classList.contains('is-favorite'), heart.region + ' lit');
    assert.equal(heart.attrs['aria-label'], '取消常用：订单回收站'); assert.equal(heart.title, '取消常用：订单回收站');
  }
  assert.ok(!h.heart('route:order-list', 'subnav').classList.contains('is-favorite'), 'other hearts untouched');
  await h.click(inFlyout);
  assert.deepEqual(h.favorites(), []);
  for (const heart of [inSubnav, inFlyout]) assert.equal(heart.attrs['aria-label'], '设为常用：订单回收站');
  assert.equal(h.calls.persist.length, 2);
});

test('toggling works for every kind of entry through the real click dispatcher', async () => {
  for (const id of ALL) {
    const entry = F.entry(id);
    const h = harness({settings: undefined});
    hover(h, railItem(entry.menu));
    const before = h.calls.hash.length;
    await h.click(h.heart(id, 'flyout'));
    assert.deepEqual(h.favorites(), [id], id);
    assert.equal(h.calls.hash.length, before, id + ': a heart click never navigates');
    assert.equal(h.flyout.removed, false, id + ': and never closes the flyout');
    await h.click(h.heart(id, 'flyout'));
    assert.deepEqual(h.favorites(), [], id);
  }
});

test('a heart click in a flyout toggles only: no navigation, no notice, and the flyout stays open', async () => {
  const h = harness({settings: {}, route: 'order-list'});
  h.render();
  hover(h, railItem('团队数据'));
  const flyout = h.flyout;
  await h.click(h.heart('route:team-wall', 'flyout'));
  assert.deepEqual([h.favorites(), flyout.removed, h.calls.hash, h.calls.business, h.calls.customers, h.calls.mailSelect, h.calls.notices], [['route:team-wall'], false, [], [], [], [], []]);
  assert.equal(h.boundary.activeRoute, 'order-list');
});

test('removing in the 常用 flyout redraws it in place; removing the last one shows the how-to note', async () => {
  const h = harness({settings: {favoriteNav: ['route:order-list', 'mail:inbox']}});
  hover(h, railItem('常用'));
  const flyout = h.flyout;
  await h.click(h.heart('route:order-list', 'flyout'));
  assert.equal(h.flyout, flyout, 'same flyout element, redrawn');
  assert.deepEqual([...flyout.innerHTML.matchAll(/data-flyout-target="([^"]+)"/g)].map(m => m[1]), ['mail:inbox']);
  await h.click(h.heart('mail:inbox', 'flyout'));
  assert.match(flyout.innerHTML, /还没有常用导航。把鼠标移到导航条目上/);
  assert.deepEqual(h.favorites(), []);
});

test('in 常用 mode a heart in the list removes the item at once, and focus moves to the next heart (or 管理常用 when the list is empty)', async () => {
  const h = harness({settings: {favoriteNav: ['route:order-list', 'mail:inbox', 'screen:pool']}, route: 'order-list', favoritesMode: true});
  h.render();
  await h.click(h.heart('mail:inbox'));
  assert.deepEqual(h.labels('subnav'), ['全部订单', '公海客户'], 'list redrawn when the save succeeds');
  assert.deepEqual(h.active('subnav'), ['全部订单']);
  assert.deepEqual(h.calls.focused.at(-1), 'screen:pool', 'focus lands on the heart that took its place');
  await h.click(h.heart('screen:pool'));
  assert.deepEqual(h.calls.focused.at(-1), 'route:order-list', 'last row removed: focus goes to the previous one');
  await h.click(h.heart('route:order-list'));
  assert.deepEqual(h.calls.focused.at(-1), 'favorite-nav-manage');
  assert.match(h.ui.subnav, /还没有常用导航/);
  assert.equal(h.boundary.activeRoute, 'order-list', 'the page you are on stays');
  assert.equal(h.boundary.favoritesMode, true);
});

test('adding from a flyout while in 常用 mode adds the row to the list straight away', async () => {
  const h = harness({settings: {favoriteNav: ['route:order-list']}, route: 'order-list', favoritesMode: true});
  h.render();
  hover(h, railItem('邮件'));
  await h.click(h.heart('mail:drafts', 'flyout'));
  assert.deepEqual(h.labels('subnav'), ['全部订单', '草稿箱']);
});

test('the hearts and the 常用 list change only after the save has finished, not while it is still pending', async () => {
  const h = harness({settings: {favoriteNav: ['mail:inbox']}, route: 'order-list', favoritesMode: true});
  h.render(); hover(h, railItem('交易'));
  let release;
  h.boundary.gate = new Promise(resolve => { release = resolve; });
  const heart = h.heart('route:order-list', 'flyout');
  const click = h.click(heart);
  for (let i = 0; i < 20 && !h.boundary.held; i++) await Promise.resolve();
  assert.ok(h.boundary.held, 'the save request has started and is hanging');
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.ok(!heart.classList.contains('is-favorite'), 'heart unchanged while saving');
  assert.equal(heart.attrs['aria-label'], '设为常用：全部订单');
  assert.deepEqual(h.labels('subnav'), ['收件箱'], '常用 list unchanged while saving');
  assert.deepEqual(h.favorites(), ['mail:inbox']);
  release();
  assert.equal(await click, true);
  assert.ok(h.heart('route:order-list', 'flyout').classList.contains('is-favorite'), 'heart changes once saved');
  assert.deepEqual(h.labels('subnav'), ['收件箱', '全部订单']);
  assert.deepEqual(h.favorites(), ['mail:inbox', 'route:order-list']);
});

test('quick repeated clicks are applied in order instead of failing with "上一项修改正在保存"', async () => {
  const h = harness({settings: {}});
  hover(h, railItem('客户'));
  const heart = h.heart('screen:pool', 'flyout');
  await Promise.all([h.click(heart), h.click(heart), h.click(heart)]);
  assert.equal(h.calls.persist.length, 3);
  assert.deepEqual(h.favorites(), ['screen:pool'], 'on, off, on');
  assert.deepEqual(h.calls.toasts, []);
});

test('a failed save leaves every heart as it was and tells the user why; an unsaved edit blocks the change', async () => {
  let h = harness({settings: {}, failSave: '数据已发生变化，请重新打开来财后再编辑。', route: 'order-list'});
  h.render(); hover(h, railItem('交易'));
  const copies = [h.heart('route:order-list', 'subnav'), h.heart('route:order-list', 'flyout')];
  assert.equal(await h.click(copies[0]), false);
  assert.deepEqual(h.calls.toasts, ['数据已发生变化，请重新打开来财后再编辑。']);
  for (const heart of copies) { assert.ok(!heart.classList.contains('is-favorite')); assert.equal(heart.attrs['aria-label'], '设为常用：全部订单'); }
  assert.deepEqual(h.favorites(), []);
  h = harness({settings: {favoriteNav: ['route:order-list']}, route: 'order-list', favoritesMode: true, failSave: '保存失败，请重试'});
  h.render();
  await h.click(h.heart('route:order-list'));
  assert.deepEqual(h.labels('subnav'), ['全部订单'], 'a failed removal keeps the row in the list');
  assert.deepEqual(h.calls.toasts, ['保存失败，请重试']);
  h = harness({settings: {}, flush: false});
  hover(h, railItem('客户'));
  assert.equal(await h.click(h.heart('screen:pool', 'flyout')), false);
  assert.equal(h.calls.persist.length, 0, 'unsaved edits are checked first, as before');
  assert.ok(!h.heart('screen:pool', 'flyout').classList.contains('is-favorite'));
});

// ---------------- 打开条目、常用模式 ----------------
test('opening an entry goes through navigateApp for each kind, and a blocked navigation changes nothing', async () => {
  const cases = [
    [{kind: 'route', target: 'order-trash'}, false, () => assert.deepEqual([h.boundary.activeRoute, h.boundary.favoritesMode, h.calls.business], ['order-trash', false, ['order-trash']])],
    [{kind: 'route', target: 'analysis'}, true, () => assert.deepEqual([h.boundary.activeRoute, h.boundary.favoritesMode], ['analysis', true])],
    [{kind: 'mail', target: 'drafts'}, true, () => assert.deepEqual([h.boundary.activeRoute, h.boundary.favoritesMode, h.calls.mailSelect], ['mail', true, ['drafts']])],
    [{kind: 'screen', target: 'pool'}, true, () => assert.deepEqual([h.boundary.activeRoute, h.boundary.favoritesMode, h.calls.customers], ['customers', true, [['screen', 'active'], ['screen', 'pool']]])],
    [{kind: 'screen', target: 'customer-settings'}, true, () => assert.deepEqual([h.boundary.favoritesMode, h.calls.customers, h.boundary.customerScreen], [true, [['screen', 'active'], ['settings']], 'customer-settings'])],
    [{kind: 'screen', target: 'active'}, false, () => assert.deepEqual([h.boundary.favoritesMode, h.calls.customers, h.boundary.customerScreen], [false, [['screen', 'active']], 'active'])],
  ];
  var h;
  for (const [entry, fav, check] of cases) {
    h = harness({settings: {}, route: 'calendar'});
    assert.equal(await h.run(`openNavEntry(${JSON.stringify(entry)}, ${fav})`), true);
    check();
  }
  h = harness({settings: {}, route: 'calendar', flush: false});
  assert.equal(await h.run('openNavEntry({kind:"route",target:"order-list"}, true)'), false);
  assert.deepEqual([h.boundary.activeRoute, h.boundary.favoritesMode, h.calls.business, h.calls.closeModal], ['calendar', false, [], 0], 'an unsaved edit blocks the jump and nothing moves');
  h = harness({settings: {}, route: 'calendar', flush: false});
  assert.equal(await h.run('openNavEntry({kind:"screen",target:"pool"}, true)'), false);
  assert.deepEqual(h.calls.customers, []);
});

test('clicking 常用 opens the first favorite, whatever kind it is, with 常用 highlighted', async () => {
  for (const [first, expected] of [['route:team-tasks', {route: 'team-tasks'}], ['mail:unread', {route: 'mail', folder: 'unread'}], ['screen:duplicates', {route: 'customers', screen: 'duplicates'}], ['screen:customer-settings', {route: 'customers', screen: 'customer-settings'}], ['route:dashboard', {route: 'dashboard'}]]) {
    const h = harness({settings: {favoriteNav: [first, 'route:calendar']}, route: 'order-list'});
    h.render();
    await railMenu(h, '常用');
    assert.equal(h.boundary.activeRoute, expected.route, first);
    assert.equal(h.boundary.favoritesMode, true);
    assert.deepEqual(h.railActive(), ['常用'], first);
    assert.equal(h.subnavTitle(), '常用');
    assert.deepEqual(h.active('subnav'), [F.entry(first).label], first + ' is the highlighted row');
    if (expected.folder) assert.deepEqual(h.calls.mailSelect, [expected.folder]);
    if (expected.screen && expected.screen !== 'active') assert.ok(h.calls.customers.some(c => c[0] === (expected.screen === 'customer-settings' ? 'settings' : 'screen')));
  }
});

test('clicking 常用 with nothing saved shows an explicit empty state, not the customer list', async () => {
  const h = harness({settings: undefined, route: 'order-list'});
  h.render();
  await railMenu(h, '常用');
  assert.equal(h.boundary.activeRoute, 'favorites');
  assert.equal(h.boundary.favoritesMode, true);
  assert.deepEqual(h.calls.customers, [], 'does not quietly open the customer list');
  assert.deepEqual(h.railActive(), ['常用']);
  assert.match(h.ui.main, /<h1>常用<\/h1>/);
  assert.match(h.ui.main, /<strong>还没有常用导航<\/strong><span>把鼠标移到导航条目上，点右侧的心形，就能加到常用。<\/span>/);
  assert.match(h.ui.main, /设为常用的条目会一直亮着实心心形/);
  assert.doesNotMatch(h.ui.main, /☆|★|收藏/);
  assert.match(h.ui.main, /<svg class="favorites-empty-icon"/);
  assert.match(h.ui.subnav, /还没有常用导航/);
  assert.deepEqual(h.calls.hash, ['#favorites']);
});

test('the empty 常用 page turns into a pick-one prompt as soon as a favorite is added elsewhere', async () => {
  const h = harness({settings: {}, route: 'favorites', favoritesMode: true});
  h.run('showFavoritesHome()');
  assert.match(h.ui.main, /还没有常用导航/);
  hover(h, railItem('交易'));
  await h.click(h.heart('route:order-list', 'flyout'));
  assert.match(h.ui.main, /从左侧选一项常用导航/); assert.doesNotMatch(h.ui.main, /还没有常用导航/);
  assert.deepEqual(h.labels('subnav'), ['全部订单']);
});

test('in 常用 mode every kind of entry can be reached from the list and 常用 stays highlighted with the list showing', async () => {
  const settings = {favoriteNav: ['screen:pool', 'route:order-trash', 'mail:pending', 'route:team-orders', 'screen:customer-settings', 'route:calendar', 'route:dashboard', 'route:settings']};
  const h = harness({settings, route: 'order-list'});
  h.render();
  await railMenu(h, '常用');
  for (const id of settings.favoriteNav) {
    await h.click(h.button('subnav', b => b.dataset.favoriteOpen === id));
    const entry = F.entry(id);
    assert.equal(h.boundary.favoritesMode, true, id);
    assert.deepEqual(h.railActive(), ['常用'], id);
    assert.equal(h.subnavTitle(), '常用', id);
    assert.deepEqual(h.labels('subnav'), settings.favoriteNav.map(x => F.entry(x).label), id + ': the list is still the 常用 list');
    assert.deepEqual(h.active('subnav'), [entry.label], id);
    assert.equal(h.boundary.activeRoute, entry.kind === 'screen' ? 'customers' : entry.kind === 'mail' ? 'mail' : entry.target, id);
  }
  assert.deepEqual(h.calls.business, ['order-trash', 'team-orders', 'calendar', 'dashboard', 'settings']);
  assert.deepEqual(h.calls.mailSelect, ['pending']);
});

test('the flyout opens favorites in 常用 mode and ordinary menu entries outside it', async () => {
  let h = harness({settings: {favoriteNav: ['mail:sent']}, route: 'order-list'});
  hover(h, railItem('常用'));
  await h.click(h.button('flyout', b => b.dataset.flyoutKind === 'favorite'));
  assert.deepEqual([h.flyout.removed, h.boundary.activeRoute, h.boundary.favoritesMode, h.calls.mailSelect, h.railActive()], [true, 'mail', true, ['sent'], ['常用']]);
  h = harness({settings: {favoriteNav: ['mail:sent']}, route: 'calendar', favoritesMode: true});
  hover(h, railItem('交易'));
  await h.click(h.button('flyout', b => b.dataset.flyoutTarget === 'order-trash'));
  assert.deepEqual([h.boundary.activeRoute, h.boundary.favoritesMode], ['order-trash', false], 'choosing from another menu leaves 常用 mode');
  assert.deepEqual(h.railActive(), ['交易']);
  h = harness({settings: {}, route: 'order-list'});
  hover(h, railItem('邮件'));
  await h.click(h.button('flyout', b => b.dataset.flyoutTarget === 'bulk'));
  assert.deepEqual([h.boundary.activeRoute, h.boundary.favoritesMode, h.calls.mailSelect], ['mail', false, ['bulk']]);
});

test('clicking any other left menu leaves 常用 mode; each page highlights its own menu', async () => {
  const h = harness({settings: {favoriteNav: ['route:order-list']}, route: 'order-list', favoritesMode: true});
  h.render();
  assert.deepEqual(h.railActive(), ['常用']);
  await railMenu(h, '客户');
  assert.deepEqual([h.boundary.favoritesMode, h.railActive(), h.subnavTitle()], [false, ['客户'], '客户']);
  await railMenu(h, '常用');
  await h.click(rail(h, '邮件'));
  assert.deepEqual([h.boundary.favoritesMode, h.railActive()], [false, ['邮件']]);
  assert.equal(h.ui.subnav, '<MAIL-SUBNAV/>', 'the mail menu\'s own sub-navigation is back');
  await railMenu(h, '团队数据');
  assert.deepEqual([h.railActive(), h.subnavTitle()], [['团队数据'], '团队数据']);
});

test('the rail highlight follows the page: only 常用 in 常用 mode, otherwise the menu that owns the page', () => {
  const lit = (route, favoritesMode = false) => { const h = harness({settings: {}, route, favoritesMode}); h.render(); return h.railActive(); };
  assert.deepEqual(lit('customers'), ['客户']);
  assert.deepEqual(lit('customers', true), ['常用']);
  for (const [route, menu] of [['dashboard', '工作台'], ['order-list', '交易'], ['order-trash', '交易'], ['analysis', '团队数据'], ['team-orders', '团队数据'], ['calendar', '协同'], ['settings', '设置'], ['mail', '邮件']]) {
    assert.deepEqual(lit(route), [menu], route);
    assert.deepEqual(lit(route, true), ['常用'], route + ' in 常用 mode');
  }
  assert.deepEqual(lit('favorites', true), ['常用']);
});

test('navigateApp enters 常用 mode only when asked, for any page type, and restores a collapsed sub-navigation off the customer pages', async () => {
  for (const [route, folder] of [['customers'], ['dashboard'], ['order-trash'], ['team-wall'], ['calendar'], ['settings'], ['mail', 'unread'], ['favorites']]) {
    const h = harness({settings: {}});
    assert.equal(await h.run(`navigateApp(${JSON.stringify(route)}, "", true, true, ${JSON.stringify(folder || '')})`), true);
    assert.equal(h.boundary.favoritesMode, true, route);
    assert.equal(h.boundary.activeRoute, route, route);
    const plain = harness({settings: {}});
    await plain.run(`navigateApp(${JSON.stringify(route)}, "", true, false, "")`);
    assert.equal(plain.boundary.favoritesMode, route === 'favorites', route + ' without the flag (only the empty 常用 page is always in the mode)');
    assert.equal(plain.calls.collapsedRemoved, route === 'customers' ? 0 : 1, route + ': sub-navigation restored when leaving the customer pages');
  }
  const h = harness({settings: {}});
  await h.run('navigateApp("not-a-page", "", true, true)');
  assert.equal(h.boundary.activeRoute, 'customers', 'unknown routes fall back to the customer pages as before');
  assert.deepEqual(h.calls.hash, ['#customers']);
});

test('every business page in the menus is a route navigateApp accepts (the page list is read from the menus, not copied)', async () => {
  for (const entry of RM.favoritable().filter(e => e.kind === 'route')) {
    const h = harness({settings: {}});
    await h.run(`navigateApp(${JSON.stringify(entry.target)})`);
    assert.equal(h.boundary.activeRoute, entry.target, entry.id);
    assert.deepEqual(h.calls.business, [entry.target]);
  }
  assert.match(app, /const businessRoutes = new Set\(RM\.favoritable\(\)\.filter\(\(entry\) => entry\.kind === "route"\)\.map\(\(entry\) => entry\.target\)\);/);
  assert.doesNotMatch(app, /"team-wall",\s*"team-assets"/, 'the old hard-coded route list is gone');
});

// ---------------- 「管理常用」面板 ----------------
test('the management panel lists favorites of every kind with their menu, correct move limits, and explains the empty case', () => {
  let h = harness({settings: {favoriteNav: ['mail:inbox', 'route:order-trash', 'screen:pool', 'route:dashboard']}});
  h.run('favoriteNavPanel()');
  const [title, body, footer, type] = h.calls.drawers[0];
  assert.equal(title, '管理常用'); assert.equal(type, 'favorites');
  assert.deepEqual([...body.matchAll(/data-favorite-jump="([^"]+)"/g)].map(m => m[1]), ['mail:inbox', 'route:order-trash', 'screen:pool', 'route:dashboard']);
  assert.match(body, /收件箱<small>邮件<\/small>/); assert.match(body, /订单回收站<small>交易<\/small>/);
  assert.doesNotMatch(body, /工作台<small>/, 'no menu hint when it just repeats the name');
  const rows = body.split('<li class="favorite-nav-row">').slice(1);
  assert.match(rows[0], /data-direction="-1"[^>]*disabled/); assert.doesNotMatch(rows[0], /data-direction="1"[^>]*disabled/);
  assert.match(rows[3], /data-direction="1"[^>]*disabled/); assert.doesNotMatch(rows[1], /disabled/); assert.doesNotMatch(rows[2], /disabled/);
  assert.match(rows[1], /data-favorite-remove="route:order-trash" aria-label="从常用移除订单回收站"/);
  assert.match(body, /客户、工作台、邮件、交易、团队数据、日历与待办、设置里的页面都可以设为常用/);
  assert.doesNotMatch(body, /☆|★|收藏|目前可收藏/);
  assert.match(footer, /data-action="close-modal"/);
  h = harness({settings: {favoriteNav: []}});
  h.run('favoriteNavPanel()');
  assert.match(h.calls.drawers[0][1], /还没有常用导航<\/strong>把鼠标移到导航条目上，点右侧的心形，就能加到常用。/); assert.doesNotMatch(h.calls.drawers[0][1], /data-favorite-jump/);
});

test('management panel: jump, move and remove work on mixed entries through the click dispatcher', async () => {
  const h = harness({settings: {favoriteNav: ['mail:inbox', 'route:order-trash', 'screen:pool']}, route: 'calendar', favoritesMode: true});
  const press = async dataset => { const b = {dataset, disabled: false, closest: sel => (sel === 'button' ? b : null), focus() { h.calls.focused.push(dataset.favoriteMove || 'jump'); }}; return h.listeners.click({target: b, detail: 1}); };
  await press({favoriteJump: 'route:order-trash'});
  assert.deepEqual([h.boundary.activeRoute, h.boundary.favoritesMode], ['order-trash', true]);
  await press({favoriteMove: 'route:order-trash', direction: '-1'});
  assert.deepEqual(h.favorites(), ['route:order-trash', 'mail:inbox', 'screen:pool']);
  assert.equal(h.calls.drawers.at(-1)[0], '管理常用', 'panel redrawn after a move');
  await press({favoriteMove: 'screen:pool', direction: '1'});
  assert.deepEqual(h.favorites(), ['route:order-trash', 'mail:inbox', 'screen:pool'], 'the last row cannot move down');
  await press({favoriteRemove: 'mail:inbox'});
  assert.deepEqual(h.favorites(), ['route:order-trash', 'screen:pool']);
  assert.deepEqual(h.labels('subnav'), ['订单回收站', '公海客户'], 'the list in the sub-navigation follows when the panel changes it');
});

// ---------------- 其余接线（需要真实浏览器才能完整执行的部分，做静态核对） ----------------
test('the old star and "收藏" wording is gone and the real handlers are wired', () => {
  assert.doesNotMatch(app, /nav-star|favoriteStar|syncFavoriteStars|取消收藏|点导航条目右侧的 ☆|点 ☆|目前可收藏/);
  assert.doesNotMatch(app, /[☆★]/, 'no star glyph left anywhere in the app source');
  for (const hook of [
    'data-rail-menu="${label}"', 'label === "常用" ? \'data-action="favorite-nav"\'', 'd.action === "favorite-nav") return openFavorites()',
    'd.action === "favorite-nav-manage"', 'd.flyoutKind', 'd.navFavorite) return toggleFavoriteHeart(el, d.navFavorite)', 'd.favoriteOpen', 'd.favoriteJump', 'Number(d.direction)', 'd.favoriteMove', 'd.favoriteRemove',
    'if (favoritesMode) return favoritesSubnav();', 'favoritesMode = favorites || activeRoute === "favorites";',
    'railActive(label, route) ? "active" : ""', 'if (favoritesMode) return label === "常用";', 'if (location.hash === "#favorites") await openFavorites();'
  ]) assert.ok(app.includes(hook), hook);
  assert.ok(app.indexOf('d.flyoutKind') < app.indexOf('d.navFavorite'), 'a heart is never mistaken for a navigation entry');
  assert.ok(app.indexOf('d.navFavorite') < app.indexOf('d.laiScreen'), 'the heart is handled before the screen routing');
});

test('线索 and Leads left the rail with their pages (D-030); old favorites on them are ignored on read', () => {
  for (const route of ['leads', 'lead-trash', 'lead-settings']) assert.equal(RM.sectionFor(route), null, route);
  assert.ok(!RM.favoritable().some(r => /lead/.test(r.id) || ['线索', 'Leads'].includes(r.menu)));
  const NF = require('../src/nav-favorites.js');
  assert.deepEqual(NF.list({favoriteNav: ['route:leads', 'screen:active', 'route:lead-settings']}), ['screen:active']);
  const app = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src/app.js'), 'utf8');
  assert.doesNotMatch(app, /"Leads"|"线索", "leads"/);
  assert.doesNotMatch(app, /\["search", "OKKI/);
});

test('管理常用: ↑ ↓ step over entries the account cannot see instead of swapping with them', () => {
  const app = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/app.js'), 'utf8');
  const body = app.slice(app.indexOf('  function moveFavoriteVisible('), app.indexOf('  const FAVORITE_HINT ='));
  const NF = require('../src/nav-favorites.js');
  const ids = ['screen:active', 'route:order-list', 'screen:pool', 'mail:inbox'];
  const hidden = new Set(['route:order-list']);
  const sandbox = { NF, favoriteEntries: () => ids.filter((id) => !hidden.has(id)).map((id) => ({ id })) };
  require('node:vm').createContext(sandbox);
  require('node:vm').runInContext(body, sandbox);
  const move = (list, id, direction) => sandbox.moveFavoriteVisible({ favoriteNav: list }, id, direction).favoriteNav;
  // screen:pool is the visible neighbour below screen:active, even though a hidden entry sits between them.
  assert.deepEqual(move(ids, 'screen:pool', -1), ['screen:pool', 'screen:active', 'route:order-list', 'mail:inbox']);
  assert.deepEqual(move(ids, 'screen:active', 1), ['route:order-list', 'screen:pool', 'screen:active', 'mail:inbox']);
  assert.deepEqual(move(ids, 'mail:inbox', -1), ['screen:active', 'route:order-list', 'mail:inbox', 'screen:pool']);
  // At the edge of the visible list nothing changes.
  assert.deepEqual(move(ids, 'screen:active', -1), ids);
  assert.deepEqual(move(ids, 'mail:inbox', 1), ids);
});

test('no placeholder entries are left: no reserved rows, no "功能入口已保留" text, no featureNotice handler (D-003)', () => {
  for (const label of MENUS) for (const row of RM.menuFor(label)) assert.notEqual(row.kind, 'feature', `${label}/${row.label}`);
  assert.doesNotMatch(app, /功能入口已保留|featureNotice|待后续实现/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../src/rail-menu.js'), 'utf8'), /保留入口|kind 为 feature/);
  assert.doesNotMatch(app, /kind === "feature"/);
});
