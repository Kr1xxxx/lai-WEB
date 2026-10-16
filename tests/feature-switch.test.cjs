const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const FS = require('../src/feature-switch-model.js');
const FUI = require('../src/feature-switch-ui.js');
const R = require('../src/role-model.js');
const RM = require('../src/rail-menu.js');
const NF = require('../src/nav-favorites.js');
const CS = require('../src/customer-settings-model.js');
const T = require('../src/task-rule-model.js');
const Hub = require('../src/settings-hub.js');
const W = require('../src/workbench.js');
const B = require('../src/business-model.js');
const OM = require('../src/opportunity-model.js');
const TM = require('../src/team-model.js');
const L = require('../src/modules.js');
const CSUI = require('../src/customer-settings-ui.js');
const { escapeHtml: E } = require('../src/model.js');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const off = (...ids) => ids.reduce((s, id) => FS.set(s, id, false), {});

test('everything is on by default: no setting, an empty setting, junk and unknown ids all mean on', () => {
  for (const state of [undefined, null, {}, { laiSettings: {} }, { laiSettings: { featureSwitch: {} } }, { laiSettings: { featureSwitch: { off: 'lead' } } }, { laiSettings: { featureSwitch: 5 } }]) {
    for (const id of FS.IDS) assert.equal(FS.enabled(state, id), true, id);
    assert.deepEqual(FS.offList(state), []);
  }
  assert.deepEqual(FS.IDS, ['lead', 'opp', 'product', 'doc', 'mail', 'chat', 'team']);
  assert.deepEqual(FS.MODULES.map((m) => m.label), ['线索', '商机', '产品', '单据', '邮件', '沟通', '团队数据']);
  const junk = { laiSettings: { featureSwitch: { off: ['mail', 'nope', 'mail', 42] } } };
  assert.deepEqual(FS.offList(junk), ['mail'], 'unknown and repeated entries are ignored');
  assert.equal(FS.enabled(junk, 'mail'), false);
  assert.equal(FS.enabled(junk, 'lead'), true);
});

test('modules that are not switchable are always on, even if someone wrote them into the list', () => {
  const state = { laiSettings: { featureSwitch: { off: ['customers', 'orders', 'dashboard', 'calendar', 'settings', 'roles', 'lead'] } } };
  for (const id of ['customers', 'orders', 'dashboard', 'calendar', 'settings', 'roles', '', undefined]) assert.equal(FS.enabled(state, id), true, String(id));
  assert.equal(FS.enabled(state, 'lead'), false);
  assert.deepEqual(FS.offList(state), ['lead']);
});

test('set turns one module off or on, keeps the order and every other setting, and never changes the old state', () => {
  const base = { orders: [1], laiSettings: { theme: 'pink', featureSwitch: { off: ['team'], note: 'x' } } };
  const a = FS.set(base, 'lead', false);
  assert.deepEqual(a.laiSettings.featureSwitch.off, ['lead', 'team'], 'fixed module order');
  assert.equal(a.laiSettings.theme, 'pink');
  assert.equal(a.laiSettings.featureSwitch.note, 'x');
  assert.equal(a.orders, base.orders);
  assert.deepEqual(base.laiSettings.featureSwitch.off, ['team']);
  const b = FS.set(a, 'team', true);
  assert.deepEqual(b.laiSettings.featureSwitch.off, ['lead']);
  assert.deepEqual(FS.set(b, 'lead', true).laiSettings.featureSwitch.off, [], 'back to all on');
  assert.deepEqual(FS.set(a, 'lead', false).laiSettings.featureSwitch.off, ['lead', 'team'], 'turning off twice is the same');
  assert.deepEqual(FS.set(undefined, 'doc', false).laiSettings.featureSwitch.off, ['doc']);
  assert.throws(() => FS.set({}, 'customers', false), /不能关闭/);
  assert.throws(() => FS.set({}, 'mail', 'no'), /开关状态无效/);
});

test('every menu entry maps to the right module; customer, orders, workbench, collaboration, settings and company admin never do', () => {
  const owner = (label) => [...new Set(RM.menuFor(label).map((row) => FS.moduleOfEntry(row.kind, row.target)))];
  assert.deepEqual(owner('线索'), ['lead']);
  assert.deepEqual(owner('Leads'), ['lead']);
  assert.deepEqual(owner('商机'), ['opp']);
  assert.deepEqual(owner('邮件'), ['mail']);
  assert.deepEqual(owner('沟通'), ['chat']);
  assert.deepEqual(owner('团队数据'), ['team']);
  for (const label of ['客户', '工作台', '协同', '设置', '企业管理']) assert.deepEqual(owner(label), [''], label);
  assert.deepEqual(RM.menuFor('交易').map((row) => [row.target, FS.moduleOfEntry(row.kind, row.target)]),
    [['order-list', ''], ['order-trash', ''], ['products', 'product'], ['doc-templates', 'doc'], ['rates', '']]);
  assert.equal(FS.moduleOfRoute('mail'), 'mail');
  assert.equal(FS.moduleOfRoute('feature-switch'), '', 'the switch page itself can never be switched off');
  assert.equal(FS.moduleOfRoute('__proto__'), '');
});

test('permission keys map to modules; settings.switch and the other keys belong to none', () => {
  const expect = { 'lead.view': 'lead', 'lead.convert': 'lead', 'settings.lead': 'lead', 'opp.create': 'opp', 'settings.opportunity': 'opp', 'product.edit': 'product', 'settings.product': 'product',
    'doc.create': 'doc', 'doc.void': 'doc', 'settings.docTemplate': 'doc', 'mail.send': 'mail', 'chat.template': 'chat', 'team.targets': 'team', 'team.wall': 'team' };
  for (const [key, id] of Object.entries(expect)) assert.equal(FS.moduleOfKey(key), id, key);
  for (const key of ['settings.switch', 'settings.general', 'settings.rate', 'settings.task', 'settings.roles', 'customer.view', 'order.view', 'pool.view', 'activity.view', '', undefined, 'lead', 'toString.x']) assert.equal(FS.moduleOfKey(key), '', String(key));
  // every permission the role matrix lists falls in exactly the module its group names, nothing leaks to another module
  const groupModule = { 线索: 'lead', 商机: 'opp', 产品: 'product', 单据: 'doc', 邮件: 'mail', 沟通: 'chat', 目标与团队数据: 'team' };
  for (const [group, items] of R.GROUPS) for (const [key] of items) {
    const want = Object.hasOwn(groupModule, group) ? groupModule[group] : '';
    if (!want && FS.moduleOfKey(key)) assert.ok(['settings.lead', 'settings.opportunity', 'settings.product', 'settings.docTemplate'].includes(key), key);
    if (want) assert.equal(FS.moduleOfKey(key), want, key);
  }
});

test('effective access is role AND module: off wins for everyone including the admin, and the role matrix still lists the permissions', () => {
  const base = { laiSettings: {} };
  // the role model checks the switch itself: nothing is installed or patched at load time
  for (const gone of ['install', 'uninstall', 'patchDealDate', 'unpatchDealDate']) assert.equal(FS[gone], undefined, `FS.${gone} is gone`);
  {
    const admin = R.settings(base);
    assert.equal(R.roleOf(base).id, 'admin', 'the default account is the admin');
    const adminOn = (state, key) => R.can(state, key);
    assert.equal(adminOn(base, 'opp.view'), true);
    const noOpp = FS.set(base, 'opp', false);
    assert.equal(adminOn(noOpp, 'opp.view'), false, 'admin loses 商机 when it is off');
    assert.equal(adminOn(noOpp, 'settings.opportunity'), false);
    assert.equal(adminOn(noOpp, 'order.view'), true, 'other modules are not touched');
    assert.equal(adminOn(noOpp, 'settings.switch'), true, 'the switch page stays open');
    assert.equal(R.canOpen(noOpp, 'route', 'opportunities'), false);
    assert.equal(R.canOpen(noOpp, 'route', 'leads'), true);
    assert.equal(R.canOpen(FS.set(base, 'mail', false), 'mail', 'inbox'), false);
    // a salesperson who has the permission is closed out too, and has it again once the module is back
    const seeded = R.addMember({ laiSettings: { defaultOwner: 'Kris' } }, { name: 'Amy' });
    const amy = R.switchTo(seeded, R.settings(seeded).members.find((m) => m.name === 'Amy').id);
    assert.equal(R.roleOf(amy).id, 'sales');
    assert.equal(R.can(amy, 'opp.create'), true);
    assert.equal(R.can(FS.set(amy, 'opp', false), 'opp.create'), false);
    assert.equal(R.can(FS.set(amy, 'mail', false), 'opp.create'), true);
    assert.equal(R.can(FS.set(FS.set(amy, 'opp', false), 'opp', true), 'opp.create'), true);
    assert.ok(R.GROUPS.some(([name]) => name === '商机'), 'the matrix still lists the 商机 group');
    assert.ok(R.KEYS.includes('opp.create') && R.KEYS.includes('settings.switch'));
    assert.equal(admin.roles.find((role) => role.id === 'admin').perms['opp.create'], true, 'the stored permission is untouched');
    assert.equal(adminOn(FS.set(noOpp, 'opp', true), 'opp.create'), true, 'turning it back on restores everything');
    // the role model reads state.laiSettings.featureSwitch.off by itself, no feature-switch-model needed
    assert.equal(R.can({ laiSettings: { featureSwitch: { off: ['opp'] } } }, 'opp.view'), false);
    assert.equal(R.canOpen({ laiSettings: { featureSwitch: { off: ['mail'] } } }, 'mail', 'inbox'), false);
    for (const junk of [undefined, {}, { laiSettings: {} }, { laiSettings: { featureSwitch: { off: 'opp' } } }, { laiSettings: { featureSwitch: 5 } }]) assert.equal(R.can(junk, 'opp.view'), true, JSON.stringify(junk));
  }
});

test('the key/route/entry → module tables live in role-model.js and feature-switch-model.js exposes the same answers', () => {
  const keys = [...R.KEYS, 'lead.view', 'settings.lead', 'settings.opportunity', 'settings.product', 'settings.docTemplate', 'settings.switch', 'customer.view', '', 'toString.x', 'mail'];
  for (const key of keys) assert.equal(FS.moduleOfKey(key), R.moduleOfKey(key), String(key));
  for (const route of [...Object.keys(FS.ROUTE_MODULE), 'customers', 'dashboard', 'toString']) assert.equal(FS.moduleOfRoute(route), R.moduleOfRoute(route), route);
  assert.equal(R.moduleOfEntry('mail', 'inbox'), 'mail');
  assert.equal(R.moduleOfEntry('route', 'leads'), 'lead');
  assert.equal(R.moduleOfEntry('screen', 'active'), '');
  // every route the page table ties to a switchable permission is also mapped to the module that permission belongs to
  for (const [route, key] of Object.entries(R.PAGE_PERMS.route)) {
    const byKey = R.moduleOfKey(key);
    if (byKey) assert.equal(R.moduleOfRoute(route), byKey, route);
  }
  // role-model.js alone (fresh vm, nothing else loaded) answers the switch
  const vm = require('node:vm');
  const sandbox = { window: undefined };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read('src/role-model.js'), sandbox);
  assert.equal(sandbox.LaiRoleModel.can({ laiSettings: { featureSwitch: { off: ['chat'] } } }, 'chat.view'), false);
  assert.equal(sandbox.LaiRoleModel.can({ laiSettings: {} }, 'chat.view'), true);
});

test('entryAllowed in app.js is the module check AND the role check; menus, flyouts, sub-navigation and 常用 all read it', () => {
  const app = read('src/app.js');
  assert.match(app, /const entryAllowed = \(row\) =>\s*row\.kind === "feature" \|\| \(FS\.entryOn\(state, row\.kind, row\.target\) && /);
  for (const reader of ['menuRows = (label) => RM.menuFor(label)?.filter(entryAllowed)', 'favoriteEntries = () => NF.entries(state.laiSettings).filter(entryAllowed)', 'const railHidden', 'const railRoute']) assert.ok(app.includes(reader), reader);
  assert.match(app, /section\.entries = section\.entries\.filter\(entryAllowed\)/, 'sub-navigation');
  // the same rule, evaluated here against the real menus
  {
    const open = (state) => (row) => row.kind === 'feature' || (FS.entryOn(state, row.kind, row.target) && R.canOpen(state, row.kind, row.target));
    const rail = (state) => ['线索', '商机', 'Leads', '邮件', '沟通', '交易', '团队数据', '设置', '协同', '企业管理', '客户'].filter((label) => RM.menuFor(label).some(open(state)));
    assert.deepEqual(rail({}), ['线索', '商机', 'Leads', '邮件', '沟通', '交易', '团队数据', '设置', '协同', '企业管理', '客户']);
    for (const [id, label] of [['lead', '线索'], ['opp', '商机'], ['mail', '邮件'], ['chat', '沟通'], ['team', '团队数据']]) {
      const state = FS.set({}, id, false);
      assert.ok(!rail(state).includes(label), `${label} leaves the rail`);
      assert.equal(rail(state).length, 11 - (id === 'lead' ? 2 : 1), 'and nothing else does (线索 takes Leads with it)');
      assert.equal(RM.menuFor(label).filter(open(state)).length, 0, `${label} flyout is empty`);
    }
    assert.ok(!rail(FS.set({}, 'lead', false)).includes('Leads'), 'Leads (线索设置) goes with 线索');
    // 交易 stays; only 产品 and 单据模板 rows go
    assert.deepEqual(RM.menuFor('交易').filter(open(off('product'))).map((row) => row.target), ['order-list', 'order-trash', 'doc-templates', 'rates']);
    assert.deepEqual(RM.menuFor('交易').filter(open(off('doc'))).map((row) => row.target), ['order-list', 'order-trash', 'products', 'rates']);
    assert.deepEqual(RM.menuFor('交易').filter(open(off('product', 'doc'))).map((row) => row.target), ['order-list', 'order-trash', 'rates']);
    // 设置 keeps the switch page even with everything off
    const none = off(...FS.IDS);
    assert.deepEqual(RM.menuFor('设置').filter(open(none)).map((row) => row.target), ['settings', 'settings-hub', 'feature-switch']);
    assert.deepEqual(RM.menuFor('客户').filter(open(none)).length, 4);
    assert.deepEqual(RM.menuFor('工作台').filter(open(none)).map((row) => row.target), ['dashboard']);
    // canOpen alone already hides the entries of a switched-off module
    assert.equal(RM.menuFor('线索').filter((row) => R.canOpen(FS.set({}, 'lead', false), row.kind, row.target)).length, 0);
  }
});

test('常用 is hidden at read time: the saved list is not touched, and the entries come back when the module is on again', () => {
  const saved = ['route:leads', 'screen:active', 'mail:inbox', 'route:products', 'route:team-wall', 'route:order-list'];
  const state = { laiSettings: { favoriteNav: saved } };
  const shown = (s) => NF.entries(s.laiSettings).filter((row) => FS.entryOn(s, row.kind, row.target)).map((row) => row.id);
  assert.deepEqual(shown(state), saved);
  const closed = FS.set(FS.set(state, 'lead', false), 'mail', false);
  assert.deepEqual(shown(closed), ['screen:active', 'route:products', 'route:team-wall', 'route:order-list']);
  assert.deepEqual(closed.laiSettings.favoriteNav, saved, 'nothing was removed from the saved list');
  const opened = FS.set(FS.set(closed, 'lead', true), 'mail', true);
  assert.deepEqual(shown(opened), saved, 'order and entries come back');
  assert.deepEqual(NF.list(opened.laiSettings), saved);
  assert.match(read('src/app.js'), /const favoriteEntries = \(\) => NF\.entries\(state\.laiSettings\)\.filter\(entryAllowed\)/);
});

test('a direct route to an off module says 这个功能已关闭 and goes to the workbench; the workbench itself cannot be blocked', () => {
  const app = read('src/app.js');
  const nav = app.slice(app.indexOf('  async function navigateApp('), app.indexOf('  function showCustomerScreen('));
  assert.match(nav, /if \(!FS\.routeOn\(state, route\)\) \{\s*toast\("这个功能已关闭"\);\s*if \(route === "dashboard"\) return false;\s*return navigateApp\("dashboard"\);/);
  assert.ok(nav.indexOf('FS.routeOn') < nav.indexOf('activeRoute = route'), 'checked before anything changes');
  const closed = off(...FS.IDS);
  for (const route of ['dashboard', 'order-list', 'order-trash', 'rates', 'calendar', 'task-settings', 'settings', 'settings-hub', 'feature-switch', 'roles', 'members']) assert.equal(FS.routeOn(closed, route), true, route);
  for (const route of ['leads', 'lead-trash', 'lead-settings', 'opportunities', 'opp-analysis', 'opp-flows', 'products', 'doc-templates', 'mail', 'chats', 'chat-templates', 'team-goals', 'team-targets', 'team-wall', 'analysis', 'team-assets', 'team-followups', 'team-tasks', 'team-orders']) assert.equal(FS.routeOn(closed, route), false, route);
  assert.equal(FS.routeOn(closed, 'customers'), true);
});

test('the 设置中心 hides items of a module that is off, shows the switch page to those who may use it, and never loses the other groups', () => {
  const ids = (info) => [...Hub.markup(info, E).matchAll(/data-sh-item="([\w-]+)"/g)].map((m) => m[1]);
  const all = ids({});
  assert.ok(all.includes('feature-switch'));
  const hub = (state, can = () => true) => ids({ can, moduleOn: (id) => FS.enabled(state, id) });
  assert.deepEqual(hub({}), all);
  assert.ok(!hub(off('opp')).includes('flows'));
  assert.ok(!hub(off('product')).includes('product-settings') && hub(off('product')).includes('doc-templates'));
  assert.ok(!hub(off('doc')).includes('doc-templates') && hub(off('doc')).includes('product-settings'));
  assert.ok(!hub(off('chat')).includes('chat-templates'));
  assert.ok(!hub(off('team')).includes('targets'));
  assert.ok(!hub(off('mail')).includes('mail-account'));
  assert.deepEqual(hub(off('lead')), all, '线索 has no hub item of its own');
  const nothing = hub(off(...FS.IDS));
  for (const keep of ['defaults', 'theme', 'favorites', 'feature-switch', 'columns', 'segments', 'customer-settings', 'rates', 'task-settings']) assert.ok(nothing.includes(keep), keep);
  assert.ok(!ids({ can: (key) => key !== 'settings.switch' }).includes('feature-switch'), 'permission settings.switch is required');
  // through the role model the same thing happens without moduleOn
  {
    const viaRoles = (state) => ids({ can: (key) => R.can(state, key) });
    assert.ok(!viaRoles(off('opp')).includes('flows'));
    assert.ok(viaRoles(off('lead')).includes('feature-switch'));
  }
});

test('the switch page: one switch per module, the fixed sentence, switches disabled without settings.switch, and a note when 成交 follows 商机', () => {
  const ctx = (state, can = () => true) => ({ escape: E, can: (key) => can(key) });
  const html = FUI.markup({}, ctx({}));
  assert.equal([...html.matchAll(/data-fs-toggle="(\w+)"/g)].map((m) => m[1]).join(), FS.IDS.join());
  assert.equal((html.match(/checked/g) || []).length, 7, 'all on by default');
  assert.match(html, /关掉后，这个功能不再显示；数据都保留，重新打开就能用。/);
  assert.match(html, /客户、订单、工作台、协同、设置、企业管理是基础功能，不能关闭/);
  const mixed = FUI.markup(off('mail', 'chat'), ctx({}));
  assert.equal((mixed.match(/checked/g) || []).length, 5);
  assert.match(/data-fs-toggle="mail"[^>]*aria-label="邮件功能开关"><span>已关闭/.exec(mixed)?.[0] || '', /已关闭/);
  const locked = FUI.markup({}, ctx({}, () => false));
  assert.equal((locked.match(/ disabled/g) || []).length, 7);
  // 成交 follows 商机 note
  const oppRule = CS.setDealRule(off('opp'), 'opportunity');
  assert.match(FUI.markup(oppRule, ctx({})), /商机关着时先按订单算/);
  assert.doesNotMatch(FUI.markup(off('opp'), ctx({})), /商机关着时先按订单算/);
  assert.doesNotMatch(FUI.markup(CS.setDealRule({}, 'opportunity'), ctx({})), /商机关着时先按订单算/);
  assert.equal(FUI.page.title, '功能开关');
  assert.equal(globalThis.LaiExtraPages?.['feature-switch'], FUI.page);
});

test('toggling saves through the page, needs settings.switch, and redraws the whole shell', async () => {
  let state = {}, saved = 0, toasts = [], rerenders = 0, refreshes = 0;
  const c = {
    escape: E, state: () => state, can: () => true, need: () => true, toast: (m) => toasts.push(m),
    save: async (next) => { saved++; state = next; }, rerenderApp: async () => { rerenders++; }, refresh: () => { refreshes++; },
  };
  const change = (id, checked) => FUI.page.change(c, { target: { dataset: { fsToggle: id }, checked } });
  assert.equal(change('mail', false), true);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual([FS.enabled(state, 'mail'), saved, rerenders, refreshes], [false, 1, 1, 0]);
  assert.match(toasts[0], /邮件已关闭，数据都保留/);
  change('mail', true);
  await new Promise((r) => setImmediate(r));
  assert.equal(FS.enabled(state, 'mail'), true);
  assert.match(toasts[1], /邮件已开启/);
  assert.equal(FUI.page.change(c, { target: { dataset: {}, checked: true } }), false, 'other controls are not ours');
  const denied = { ...c, need: () => false, save: async () => { throw new Error('must not save'); } };
  FUI.page.change(denied, { target: { dataset: { fsToggle: 'lead' }, checked: false } });
  await new Promise((r) => setImmediate(r));
  assert.equal(FS.enabled(state, 'lead'), true);
});

test('workbench: cards of an off module are not drawn, and the 新建商机 button goes too', () => {
  const today = '2026-10-08';
  const render = (state) => W.markup({ state: { orders: [], customers: {}, ...state }, today, B, OM, TM, bucket: (c) => L.bucket(c), mail: { unread: 2, pending: 1, items: [] } }, E);
  const full = render({});
  for (const marker of ['进行中商机', '商机阶段', '未读邮件', '本月目标', 'data-biz-go="opp-new"', 'data-biz-go="mail:inbox"']) assert.ok(full.includes(marker), marker);
  const noOpp = render(off('opp'));
  assert.ok(!/进行中商机|商机阶段|opp-new|data-biz-go="opportunities"/.test(noOpp));
  assert.ok(noOpp.includes('未读邮件') && noOpp.includes('本月目标'));
  const noMail = render(off('mail'));
  assert.ok(!/未读邮件|mail:inbox|mail:unread/.test(noMail));
  const noTeam = render(off('team'));
  assert.ok(!/本月目标|team-goals|data-biz-go="analysis"/.test(noTeam));
  assert.ok(noTeam.includes('有效订单') && noTeam.includes('待办任务'), 'orders and tasks are never switchable');
});

test('成交 follows the order rule while 商机 is off, and goes back to the saved rule when it is on again', () => {
  const dealState = () => ({
    laiSettings: {}, customers: { Acme: { opportunityLastWonDate: '2026-05-05' } },
    orders: [{ client: 'Acme', stage: 'shipment', createdAt: '2026-02-01', shippedAt: '2026-03-03' }],
  });
  const byOpp = CS.setDealRule(dealState(), 'opportunity');
  assert.equal(CS.lastDealDate(byOpp, 'Acme'), '2026-05-05', 'opp on: the saved rule');
  const closed = FS.set(byOpp, 'opp', false);
  assert.equal(CS.lastDealDate(closed, 'Acme'), '2026-03-03', 'opp off: read as 按订单');
  assert.equal(CS.get(closed).dealRule.by, 'opportunity', 'the saved choice is not changed');
  assert.equal(FS.dealBasis(closed, CS), 'order');
  assert.equal(FS.dealBasis(byOpp, CS), 'opportunity');
  assert.equal(CS.lastDealDate(FS.set(closed, 'opp', true), 'Acme'), '2026-05-05', 'back on: back to 按商机');
  assert.equal(CS.lastDealDate(FS.set(CS.setDealRule(dealState(), 'order'), 'opp', false), 'Acme'), '2026-03-03', 'order rule: same either way');
  assert.equal(CS.lastDealDate(FS.set(byOpp, 'mail', false), 'Acme'), '2026-05-05', 'another module off: unchanged');
  assert.doesNotMatch(read('src/feature-switch-model.js'), /patchDealDate|\.lastDealDate\s*=/, 'nothing is patched at load time');
});

test('task rules: 商机快到结束日期 does not run while 商机 is off; the rule keeps its switch and runs again later', () => {
  const NOW = new Date(2026, 9, 16, 12, 0, 0);
  const base = {
    laiSettings: { defaultOwner: 'Kris' }, customers: { Stale: { client: 'Stale', owner: 'Kris', lastFollowup: '2026-09-01T09:00:00', history: [] } }, orders: [], laiTasks: [],
    laiOpportunities: [{ id: 'p1', name: 'Big deal', client: 'Stale', owner: 'Amy', endDate: '2026-10-20', flow: 'default', stage: 'open' }],
  };
  const autos = (state) => (state.laiTasks || []).filter((task) => task.auto).map((task) => task.auto.key).sort();
  let state = T.setRule(base, 'oppClose', { enabled: true, days: 7 });
  const closed = FS.set(state, 'opp', false);
  assert.equal(FS.ruleBlocked(closed, 'oppClose'), true);
  assert.equal(FS.ruleBlocked(closed, 'noFollow'), false);
  assert.equal(FS.runTaskRules(T, closed, { now: NOW }), null, 'only that rule is on: nothing to run, nothing to save');
  // with another rule also on, only that one runs, lastRun is recorded, and oppClose stays switched on
  const both = T.setRule(closed, 'noFollow', { enabled: true, days: 30 });
  const result = FS.runTaskRules(T, both, { now: NOW });
  assert.equal(autos(result.state).length, 1);
  assert.match(autos(result.state)[0], /^noFollow\|/);
  assert.equal(autos(result.state).some((key) => key.startsWith('oppClose')), false);
  const cfg = T.config(result.state);
  assert.equal(cfg.rules.find((rule) => rule.type === 'oppClose').enabled, true, 'the saved switch is kept');
  assert.equal(cfg.lastRun, '2026-10-16');
  // 商机 on again: the rule runs as it did before
  const reopened = FS.set(result.state, 'opp', true);
  const next = FS.runTaskRules(T, { ...reopened, laiSettings: { ...reopened.laiSettings, taskRules: { ...reopened.laiSettings.taskRules, lastRun: '' } } }, { now: NOW });
  assert.deepEqual(autos(next.state).filter((key) => key.startsWith('oppClose')), ['oppClose|p1|2026-10-20']);
  // nothing blocked: same as T.run when due, null when not
  assert.equal(FS.runTaskRules(T, base, { now: NOW }), null);
  assert.equal(autos(FS.runTaskRules(T, state, { now: NOW }).state).length, 1);
});

test('客户设置: the 新线索 dedupe tab goes when 线索 is off, and the 成交规则 tab explains the fallback', () => {
  const html = (state, ui = {}) => CSUI.markup(state, { tab: 'dedupe', ...ui }, E);
  assert.match(html({}), /data-cs-dedupe-sub="lead"/);
  assert.doesNotMatch(html(off('lead')), /data-cs-dedupe-sub="lead"/);
  assert.doesNotMatch(html(off('lead'), { dedupeSub: 'lead' }), /data-cs-form="lead-dedupe"/, 'a remembered 新线索 tab falls back to 新客户');
  assert.match(html(off('lead'), { dedupeSub: 'lead' }), /data-cs-form="dedupe"/);
  assert.match(html(off('lead')), /data-cs-dedupe-sub="customer"/);
  const deal = (state) => CSUI.markup(state, { tab: 'deal' }, E);
  assert.doesNotMatch(deal(CS.setDealRule({}, 'opportunity')), /data-cs-deal-off/);
  assert.match(deal(CS.setDealRule(off('opp'), 'opportunity')), /data-cs-deal-off/);
  assert.doesNotMatch(deal(CS.setDealRule(off('opp'), 'order')), /data-cs-deal-off/);
});

test('mail: nothing is sent to the mail service while 邮件 is off (polling, auto-record, workbench summary, 写邮件)', () => {
  const app = read('src/app.js');
  assert.match(app, /function startMailChecks\(\) \{\s*if \(mailChecksStarted \|\| !modOn\("mail"\)\) return;/);
  assert.match(app, /startMailChecks\(\);\s*\} catch \(err\)/, 'boot');
  assert.match(app, /\/\/ 邮件功能刚打开：开始定时检查新邮件。\s*startMailChecks\(\);/, 'turning it on starts the checks');
  assert.match(app, /if \(!since \|\| autoRecordingMail \|\| hasUnsavedWork\(\) \|\| !modOn\("mail"\)\) return 0;/);
  assert.match(app, /request: \(path, payload\) =>\s*!modOn\("mail"\)\s*\? Promise\.reject\(new Error\("这个功能已关闭"\)\)/);
  assert.match(app, /mailSummary: async \(\) => \{\s*if \(!modOn\("mail"\)\) return null;/);
  assert.match(app, /if \(d\.feature === "写邮件"\) \{\s*if \(!modOn\("mail"\)\) return toast\("这个功能已关闭"\);/);
});

test('files are wired: markers in the template and the build, load order after the role model and customer settings, and the route guard sits in app.js', () => {
  const template = read('src/template.html'), build = read('scripts/build.py');
  for (const [marker, file] of [['FEATURE_SWITCH_MODEL', 'feature-switch-model.js'], ['FEATURE_SWITCH_UI', 'feature-switch-ui.js'], ['FEATURE_SWITCH_STYLE', 'feature-switch.css']]) {
    assert.ok(template.includes(`<!--${marker}-->`), marker);
    assert.ok(build.includes(`('<!--${marker}-->','${file}'`), file);
  }
  const at = (marker) => template.indexOf(`<!--${marker}-->`);
  assert.ok(at('ROLE_MODEL') < at('FEATURE_SWITCH_MODEL') && at('CUSTOMER_SETTINGS_MODEL') < at('FEATURE_SWITCH_MODEL'), 'it wraps both when it loads');
  assert.ok(at('FEATURE_SWITCH_MODEL') < at('WORKBENCH') && at('FEATURE_SWITCH_MODEL') < at('CUSTOMER_DETAIL') && at('FEATURE_SWITCH_MODEL') < at('CUSTOMER_SETTINGS_UI') && at('FEATURE_SWITCH_MODEL') < at('PREVIEW_APP'));
  assert.ok(at('LAI_BUSINESS_UI') < at('FEATURE_SWITCH_UI'), 'the page registers after the registry exists');
  assert.equal(RM.sectionFor('feature-switch').label, '设置');
  assert.equal(R.pagePerm('route', 'feature-switch'), 'settings.switch');
  const item = Hub.GROUPS.flatMap((g) => g.items).find((i) => i.id === 'feature-switch');
  assert.deepEqual([item.open, item.perm], [['route', 'feature-switch'], 'settings.switch']);
  assert.match(read('src/app.js'), /"feature-switch": "settings"/, 'sub-navigation icon');
  assert.match(read('src/customer-detail-ui.js'), /modOn\("mail"\) \? filterButton\("email"/);
});
