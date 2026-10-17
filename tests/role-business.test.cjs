// 角色权限在业务页面里的效果：没有权限的按钮不画、没有权限的操作被挡住、角色只看“本人”时只显示自己的记录。
// 页面标记按 can(key) 生成（没传 can 时什么都显示，所以老的测试不受影响）；控制器的挡法用一个小的页面替身来测。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const R = require('../src/role-model.js');
const B = require('../src/business-model.js');
const L = require('../src/lead-model.js');
const O = require('../src/opportunity-model.js');
const P = require('../src/product-model.js');
const DM = require('../src/doc-template-model.js');
const TM = require('../src/team-model.js');
const Modules = require('../src/modules.js');
const LeadUI = require('../src/lead-ui.js');
const OppUI = require('../src/opportunity-ui.js');
const ProductUI = require('../src/product-ui.js');
const DocUI = require('../src/doc-template-ui.js');
const TeamUI = require('../src/team-ui.js');
const OrdersPage = require('../src/orders-page.js');
const Hub = require('../src/settings-hub.js');
const Workbench = require('../src/workbench.js');
const { escapeHtml: E } = require('../src/model.js');

const NOW = '2026-10-01T00:00:00.000Z', TODAY = '2026-10-02';
// Kris 是系统管理员，Amy 是业务；每人一条线索、商机、订单。
function seed() {
  let s = { laiSettings: { defaultOwner: 'Kris' } };
  for (const [id, owner] of [['a', 'Amy'], ['k', 'Kris']]) {
    s = L.upsert(s, `lead-${id}`, { name: `${owner} Lead`, owner }, { now: NOW });
    s = B.upsertOrder(s, `order-${id}`, { num: `L-${owner}`, client: `${owner} Buyer`, country: 'US', productType: 'Lash', amount: '100', currency: 'USD', paidAmount: '0', stage: 'quote', createdAt: '2026-10-01', owner, isDraft: false, items: [] });
    s = O.upsert(s, `opp-${id}`, { client: `${owner} Buyer`, amount: '10', currency: 'USD', owner, stage: 'open', endDate: '2026-11-05' }, { now: NOW, today: '2026-10-01' });
  }
  return s;
}
const admin = seed();
const amyId = R.settings(admin).members.find((m) => m.name === 'Amy').id;
const amy = R.switchTo(admin, amyId);
const canOf = (state) => (key) => R.can(state, key);
// 自定义的“少一两项权限”的角色，用来测每一个开关。
const without = (...keys) => (key) => !keys.includes(key);

test('the fixture: Amy is 业务 (本人), Kris is 系统管理员', () => {
  assert.equal(R.meName(amy), 'Amy');
  assert.equal(R.scopeOf(amy), 'self');
  assert.equal(R.isAdmin(admin), true);
  assert.equal(R.can(amy, 'lead.delete'), false);
  assert.equal(R.can(amy, 'opp.delete'), false);
  assert.equal(R.can(amy, 'order.delete'), false);
  assert.equal(R.can(amy, 'product.create'), false);
});

test('线索: no 删除 for 业务, the reassign owner is locked without 重新分配, and trash rows lose 彻底删除', () => {
  const ui = (can) => LeadUI.create(E, L, can);
  const row = (state) => L.detail(state, 'lead-a', TODAY);
  assert.doesNotMatch(ui(canOf(amy)).detailMarkup(row(amy), TODAY), /data-lead-action="trash"/);
  assert.match(ui(canOf(amy)).detailMarkup(row(amy), TODAY), /data-lead-action="edit"/);
  assert.match(ui(canOf(admin)).detailMarkup(row(admin), TODAY), /data-lead-action="trash"/);
  const trashed = L.trash(L.setTrashed(admin, 'lead-a', true), TODAY);
  assert.doesNotMatch(ui(canOf(amy)).trashMarkup(trashed, '', TODAY), /data-lead-action="delete"/);
  assert.match(ui(canOf(amy)).trashMarkup(trashed, '', TODAY), /data-lead-action="restore"/);
  assert.match(ui(canOf(admin)).trashMarkup(trashed, '', TODAY), /data-lead-action="delete"/);
  const page = L.page(admin, {}, TODAY);
  assert.doesNotMatch(ui(without('lead.create')).headerActions(page), /data-lead-action="new"/);
  assert.match(ui(canOf(admin)).headerActions(page), /data-lead-action="new"/);
  const noEdit = ui(without('lead.edit', 'lead.convert')).pageMarkup(page, {}, TODAY);
  assert.doesNotMatch(noEdit, /data-lead-action="follow"|data-lead-action="convert"/);
  assert.match(noEdit, /data-lead-action="open"/, 'they can still look');
  assert.match(ui(without('lead.reassign')).formMarkup({ owner: 'Amy' }, {}), /name="owner"[^>]*readonly/);
  assert.doesNotMatch(ui(canOf(admin)).formMarkup({ owner: 'Amy' }, {}), /name="owner"[^>]*readonly/);
  const detail = ui(without('lead.edit')).detailMarkup(row(admin), TODAY);
  assert.doesNotMatch(detail, /lead-follow-form|data-lead-action="edit"|data-lead-action="invalid"/);
});

test('商机: the menu only offers what the role may do; no 删除 for 业务; new / drag / files follow their keys', () => {
  const ui = (can) => OppUI.create(E, O, can);
  const card = O.cardOf(admin, 'opp-a', TODAY);
  const menu = ui(canOf(amy)).menuMarkup(card);
  assert.match(menu, /data-opp-action="edit"/);
  assert.match(menu, /data-opp-action="archive"/);
  assert.doesNotMatch(menu, /data-opp-action="delete"/);
  assert.match(ui(canOf(admin)).menuMarkup(card), /data-opp-action="delete"/);
  const noDocsNoEdit = ui(without('opp.edit', 'doc.create', 'opp.archive', 'opp.delete')).menuMarkup(card);
  assert.doesNotMatch(noDocsNoEdit, /data-opp-action="edit"|data-opp-doc|调整销售阶段|data-opp-action="archive"|data-opp-action="delete"|<h3>其他/);
  assert.match(ui(canOf(admin)).menuMarkup(card), /data-opp-doc="quote"/);
  assert.doesNotMatch(ui(without('opp.create')).headerActions({}, {}, {}), /data-opp-action="new"/);
  assert.match(ui(canOf(admin)).headerActions({}, {}, {}), /data-opp-action="new"/);
  assert.match(ui(without('opp.edit')).boardMarkup(O.board(admin, {}, TODAY), {}, { today: TODAY, owners: [] }), /draggable="false"/);
  assert.match(ui(canOf(admin)).boardMarkup(O.board(admin, {}, TODAY), {}, { today: TODAY, owners: [] }), /draggable="true"/);
  assert.match(ui(without('opp.transfer')).formMarkup({ owner: 'Amy' }, { owners: [], flows: O.flowsOf(admin), stages: O.flowOf(admin, 'default').stages, setup: O.formSetup(admin), customers: [], contacts: [] }), /name="owner"[^>]*readonly/);
  const files = [{ id: 'f1', name: 'quote.pdf', size: 10, uploadedAt: NOW, fileUrl: 'x' }];
  const all = ui(canOf(admin)).attachmentsInner(files, {});
  assert.match(all, /data-attach-action="save"/); assert.match(all, /data-attach-action="delete"/); assert.match(all, /data-attach-action="rename"/); assert.match(all, /data-opp-dropzone/);
  const none = ui(without('opp.fileDownload', 'opp.fileDelete', 'opp.edit')).attachmentsInner(files, {});
  assert.doesNotMatch(none, /data-attach-action|data-opp-dropzone/);
  assert.match(none, /quote\.pdf/);
});

test('订单: new / 归档 / 恢复 / 经营统计 buttons follow the role; the edit button turns into 查看 without 编辑', () => {
  const order = admin.orders[0];
  const page = (can) => OrdersPage.markup({ items: [order], all: [order], total: 1, filters: { search: '', stage: '', currency: '', period: '' }, stages: B.stages, currencies: ['USD'], page: 1, pages: 1, trash: [order], can }, E);
  const mine = page(canOf(amy));
  assert.doesNotMatch(mine, /archive-order|data-lai-route="analysis"/);
  assert.match(mine, /data-biz-action="new-order"/, '业务 may create orders');
  assert.match(mine, /data-biz-action="restore-order"/, '业务 may edit, and restoring counts as editing');
  assert.match(mine, />编辑</);
  const everything = page(canOf(admin));
  assert.match(everything, /archive-order/); assert.match(everything, /data-biz-action="new-order"/); assert.match(everything, /data-lai-route="analysis"/);
  const viewOnly = page(without('order.edit'));
  assert.doesNotMatch(viewOnly, /restore-order/); assert.match(viewOnly, /op-mini" data-biz-order="[^"]+">查看</);
  assert.doesNotMatch(page(without('order.create')), /data-biz-action="new-order"/);
  assert.match(OrdersPage.markup({ items: [], all: [], total: 0, filters: { search: '', stage: '', currency: '', period: '' }, stages: B.stages, currencies: [], page: 1, pages: 1, trash: [], can: without('order.create') }, E), /调整筛选条件再看/);
  assert.doesNotThrow(() => page(undefined), 'without can everything shows');
});

test('产品: 业务 (只能查看) has no 新建 / 编辑 / 删除 / 同步 / 设置页签', () => {
  const state = P.upsert(amy, undefined, { name: 'Cloud Lash' });
  const view = { tab: 'list', search: '', group: '' };
  const ui = (can) => ProductUI.create(E, P, can);
  const mine = ui(canOf(amy)).pageMarkup(state, view);
  assert.doesNotMatch(mine, /data-prod-action="new"|data-prod-action="edit"|data-prod-action="delete"/);
  assert.deepEqual([...mine.matchAll(/data-prod-tab="(\w+)"/g)].map((m) => m[1]), ['list']);
  assert.match(mine, /data-prod-action="view"/, '产品名称还能点开看');
  assert.match(ui(canOf(amy)).pageMarkup(state, { ...view, tab: 'sync' }), /data-prod-panel="list"/, '没有权限的页签回到列表');
  const everything = ui(canOf(admin)).pageMarkup(P.upsert(admin, undefined, { name: 'Cloud Lash' }), view);
  assert.deepEqual([...everything.matchAll(/data-prod-tab="(\w+)"/g)].map((m) => m[1]), ['list', 'groups', 'sync', 'fields', 'specs', 'layouts']);
  assert.match(everything, /data-prod-action="new"/); assert.match(everything, /data-prod-action="edit"/); assert.match(everything, /data-prod-action="delete"/);
  assert.deepEqual([...ui(without('product.sync')).pageMarkup(state, view).matchAll(/data-prod-tab="(\w+)"/g)].map((m) => m[1]), ['list', 'groups', 'fields', 'specs', 'layouts']);
  assert.deepEqual([...ui(without('settings.product')).pageMarkup(state, view).matchAll(/data-prod-tab="(\w+)"/g)].map((m) => m[1]), ['list', 'sync']);
});

test('团队数据: 设置目标值 / 新建目标 / 删除目标 only with 目标管理', () => {
  const overview = TM.overview(admin, '2026-10');
  const mine = TeamUI.create(E, canOf(amy)).goalsMarkup(overview, {});
  assert.doesNotMatch(mine, /data-team-target=/);
  assert.match(TeamUI.create(E, canOf(admin)).goalsMarkup(overview, {}), /data-team-target="new"/);
  const target = { key: 'k', period: '2026-10', owner: null, metric: 'amount', value: 5, currency: 'USD' };
  assert.doesNotMatch(TeamUI.create(E, canOf(amy)).targetsMarkup([target], TM.periodLabel, ''), /data-team-target-remove/);
  assert.match(TeamUI.create(E, canOf(admin)).targetsMarkup([target], TM.periodLabel, ''), /data-team-target-remove/);
});

test('单据: 作废 only with doc.void', () => {
  const { state } = DM.saveDocument(admin, { type: 'quote', lines: B.docLines({ items: [], productType: 'Lash', amount: 100 }), currency: 'USD', client: 'X', date: '2026-10-01', reference: { label: '订单号', value: '1' }, source: { kind: 'order', id: 'o', label: '1' }, today: '2026-10-01' });
  const page = (can) => DocUI.create(E, DM, can).pageMarkup(state, { tab: 'records', armed: '', armedVoid: '', rec: { type: '', query: '' }, date: '2026-10-01' });
  assert.match(page(canOf(admin)), /data-doc-action="void"/);
  assert.doesNotMatch(page(canOf(amy)), /data-doc-action="void"/);
  assert.match(page(canOf(amy)), /data-doc-action="view"/);
});

test('设置中心: cards the account cannot use are hidden, and a group with no card disappears', () => {
  const ids = (html) => [...html.matchAll(/data-sh-item="([\w-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids(Hub.markup({ can: canOf(amy) }, E)), ['favorites', 'columns', 'segments', 'customer-settings', 'mail-account'], '业务有来源设置权限，所以客户设置入口在（页里只有来源设置页签）');
  assert.doesNotMatch(Hub.markup({ can: canOf(amy) }, E), /data-sh-group="(opportunity|team)"/);
  assert.deepEqual([...Hub.markup({ can: canOf(amy) }, E).matchAll(/data-sh-group="(\w+)"/g)].map((m) => m[1]), ['general', 'customer', 'mail']);
  assert.equal(ids(Hub.markup({ can: canOf(admin) }, E)).length, Hub.GROUPS.flatMap((g) => g.items).length);
  assert.equal(ids(Hub.markup({}, E)).length, Hub.GROUPS.flatMap((g) => g.items).length, 'without can everything shows');
});

test('工作台: blocks of modules the account cannot view are hidden', () => {
  const html = (can, state = admin) => Workbench.markup({ state, today: TODAY, B, OM: O, TM, bucket: (c) => Modules.bucket(c), mail: null, can }, E);
  const full = html(canOf(admin));
  for (const text of ['订单走到哪了', '已收款', 'id="wb-h-opp"', '本月成交', '客户来消息', '新建订单', '新建商机']) assert.ok(full.includes(text), text);
  const mine = html(canOf(amy));
  assert.ok(!mine.includes('本月成交'), '业务没有团队数据权限');
  assert.ok(mine.includes('订单走到哪了') && mine.includes('id="wb-h-opp"'));
  const none = html(without('order.view', 'opp.view', 'team.view', 'mail.view', 'chat.view', 'order.create', 'opp.create'));
  for (const text of ['订单走到哪了', '已收款', 'id="wb-h-opp"', '本月成交', '客户来消息', '新建订单', '新建商机', '钱和目标']) assert.ok(!none.includes(text), text);
  assert.ok(none.includes('今天先做') && none.includes('添加任务'), 'the queue and 添加任务 stay');
});

// 邮件页测试用的账号、邮件（和 mail-ui.test.cjs 一样）。
const ACCOUNT = { provider: 'zoho', email: 'sales@example-trade.com', site: 'cn', accountType: 'organization', host: 'imappro.zoho.com.cn', port: 993, boundAt: '2026-10-06T10:00:00.000Z', verifiedAt: '2026-10-06T10:00:00.000Z' };
const anna = { name: 'Anna Berg', address: 'anna@nordic-lamps.example' }, li = { name: '李伟', address: 'liwei@shenzhen-parts.example' }, self = { name: '', address: ACCOUNT.email };
const INBOX = [
  { box: 'inbox', uid: 4, from: li, to: [self], cc: [{ name: '', address: 'purchasing@shenzhen-parts.example' }], subject: '样品寄送确认', date: '2026-10-06T02:10:00.000Z', seen: false, pending: false, hasAttachment: true, snippet: '您好， 样品已寄出 <装箱单>' },
  { box: 'inbox', uid: 3, from: anna, to: [self], cc: [], subject: 'Re: Quotation <b>', date: '2026-10-05T14:20:00.000Z', seen: true, pending: true, hasAttachment: false },
];
const MESSAGE = { box: 'inbox', uid: 4, from: li, to: [self, { name: 'Ops', address: 'ops@example-trade.com' }], cc: [{ name: '', address: 'purchasing@shenzhen-parts.example' }], replyTo: [], subject: '样品寄送确认', date: '2026-10-06T02:10:00.000Z', messageId: '<s-9@shenzhen-parts.example>', references: '<s-8@x>', text: '您好，\n样品已寄出。', html: '', attachments: [{ index: 0, filename: '装箱单 <1>.pdf', contentType: 'application/pdf', size: 2048 }], seen: true, pending: false };
const CUSTOMERS = { 'Nordic Lamps AB': { email: 'Anna@Nordic-Lamps.example' }, '深圳配件': { contacts: [{ email: 'liwei@shenzhen-parts.example' }, { email: 'wanglei@shenzhen-parts.example' }, { email: 'bad' }] }, 'No Mail Co': {}, 'Archived Co': { email: 'old@x.example', laiBucket: 'trash' } };

test('邮件: 写信 / 回复 / 转发 / 群发 are hidden and refused without mail.send', async () => {
  const toasts = [], mounted = [];
  const previous = globalThis.document;
  globalThis.document = { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null, addEventListener() {} };
  require('../src/mail-ui.js');
  const reply = (body) => ({ ok: true, status: 200, json: async () => body });
  const routes = {
    '/api/mail-account': () => reply({ ok: true, available: true, account: ACCOUNT }),
    '/api/mail/messages': () => reply({ ok: true, folder: 'inbox', page: 1, pageSize: 50, total: INBOX.length, items: INBOX.map((item) => ({ ...item })), counts: { unread: 1, pending: 1 } }),
    '/api/mail/message': () => reply({ ok: true, message: { ...MESSAGE } }),
  };
  const make = (can) => globalThis.LaiMailUI.create({
    escape: E, icon: (name) => `<svg data-icon="${name}"></svg>`, mount: (html) => mounted.push(html),
    createEditor: () => ({ getHTML: () => '', getText: () => '', setHTML() {}, destroy() {}, focus() {} }), editorToolbar: () => '',
    request: async (url) => (routes[url.split('?')[0]] || (() => reply({ ok: true })))(),
    isActive: () => true, pollMs: 0, keyDelayMs: 0, hasDialog: () => false, openMail() {}, dialog() {}, closeDialog() {}, toast: (text) => toasts.push(text),
    getCustomers: () => CUSTOMERS, isArchived: () => false, openCustomer() {}, checkMs: 0, can,
  });
  try {
    const allowed = make(() => true);
    assert.match(allowed.subnav(), /data-mail-action="compose"/);
    await allowed.select(); await allowed.action('open', false, { dataset: { box: 'inbox', uid: '4' } });
    assert.match(mounted.at(-1), /data-mail-action="reply"/);
    assert.match(mounted.at(-1), /data-mail-action="forward"/);

    const denied = make((key) => key !== 'mail.send');
    assert.doesNotMatch(denied.subnav(), /data-mail-action="compose"/);
    await denied.select(); await denied.action('open', false, { dataset: { box: 'inbox', uid: '4' } });
    assert.doesNotMatch(mounted.at(-1), /data-mail-action="(reply|reply-all|forward|contact-compose)"/);
    assert.doesNotMatch(mounted.at(-1), /mail-quick/);
    assert.match(mounted.at(-1), /mail-reader/, 'they can still read');
    for (const name of ['compose', 'reply', 'reply-all', 'forward', 'contact-compose', 'customer-compose']) await denied.action(name, false, { dataset: { to: 'a@b.example' } });
    assert.equal(denied.composing(), false, 'no compose page opens');
    assert.ok(toasts.length >= 1 && toasts.every((text) => /邮件·写信和回复|写信和回复/.test(text)), toasts.join('|'));
  } finally { globalThis.document = previous; }
});

// ---------- 控制器：只看本人时的列表，和被硬点的操作 ----------
function controller(state) {
  let current = state, html = '', saves = 0;
  const toasts = [], dialogs = [], listeners = new Map();
  const document = {
    addEventListener(kind, fn) { (listeners.get(kind) || listeners.set(kind, []).get(kind)).push(fn); },
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  };
  class FormData { constructor() { this.entries = []; } [Symbol.iterator]() { return this.entries[Symbol.iterator](); } }
  const window = { LaiBusinessModel: B, LaiModules: Modules, LaiWorkbench: Workbench, LaiRoleModel: R, LaiLeadModel: L, LaiLeadUI: LeadUI, LaiOpportunityModel: O, LaiOpportunityUI: OppUI, LaiTeamModel: TM, LaiTeamUI: TeamUI, LaiProductModel: P, LaiProductUI: ProductUI, LaiDocTemplateModel: DM, LaiDocTemplateUI: DocUI, LaiOrdersPage: OrdersPage, LaiSettingsHub: Hub };
  const context = { window, document, FormData, crypto: webcrypto };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/business-ui.js'), 'utf8'), context);
  const ui = window.LaiBusinessUI.create({
    getState: () => current, escape: E, mount(next) { html = next; }, dialog(title, body) { dialogs.push(title); }, closeDialog() {},
    async save(next) { saves++; current = next; }, toast(text) { toasts.push(text); }, navigate() {}, openCustomer() {}, refreshCustomer() {},
  });
  // 像页面上点了一个按钮：按钮可以是已经不在页面上的（旧页面、键盘），所以直接造出来。
  const click = async (dataset) => { const target = { disabled: false, dataset, closest() { return this; } }; for (const fn of listeners.get('click') || []) await fn({ target, preventDefault() {} }); };
  return { ui, click, toasts, dialogs, get html() { return html; }, get saves() { return saves; }, get state() { return current; } };
}

test('业务 (本人): lists show only her own leads, opportunities and orders, with totals to match', () => {
  const c = controller(amy);
  c.ui.navigate('leads');
  assert.ok(c.html.includes('Amy Lead') && !c.html.includes('Kris Lead'));
  c.ui.navigate('opportunities');
  assert.equal([...c.html.matchAll(/<article class="opp-card/g)].length, 1);
  assert.ok(c.html.includes('Amy') && !c.html.includes('Kris'));
  c.ui.navigate('opp-analysis');
  assert.ok(!c.html.includes('Kris'));
  c.ui.navigate('order-list');
  assert.ok(c.html.includes('L-Amy') && !c.html.includes('L-Kris'));
  assert.match(c.html, /共 <?b?>?1<?\/?b?>? ?笔订单|共 1 笔订单/);
  c.ui.navigate('dashboard');
  assert.ok(!c.html.includes('Kris'));
});

test('系统管理员 sees every record', () => {
  const c = controller(admin);
  c.ui.navigate('leads');
  assert.ok(c.html.includes('Amy Lead') && c.html.includes('Kris Lead'));
  c.ui.navigate('order-list');
  assert.ok(c.html.includes('L-Amy') && c.html.includes('L-Kris'));
  assert.match(c.html, /共 2 笔订单/);
});

test('业务: a hand-made 删除 click does nothing but say why; admin gets the same click through', async () => {
  const c = controller(amy);
  c.ui.navigate('leads');
  await c.click({ leadAction: 'trash', id: 'lead-a' });
  assert.equal(c.saves, 0);
  assert.match(c.toasts.at(-1), /线索·删除/);
  await c.click({ leadAction: 'delete', id: 'lead-a' });
  assert.equal(c.saves, 0);
  c.ui.navigate('opportunities');
  await c.click({ oppAction: 'delete', id: 'opp-a' });
  await c.click({ oppAction: 'delete', id: 'opp-a' });
  assert.equal(c.saves, 0);
  assert.match(c.toasts.at(-1), /商机·删除/);
  await c.click({ oppAction: 'move', id: 'opp-a', stage: 'won' });
  assert.equal(c.saves, 0, '拖到别的阶段也要有编辑权限；业务有，所以这里是别的原因');
  c.ui.navigate('order-list');
  await c.click({ bizAction: 'archive-order', id: 'order-a' });
  await c.click({ bizAction: 'confirm-archive', id: 'order-a' });
  assert.equal(c.saves, 0);
  assert.match(c.toasts.at(-1), /订单·删除/);
  c.ui.navigate('products');
  await c.click({ prodAction: 'new' });
  await c.click({ prodAction: 'sync-open' });
  assert.equal(c.dialogs.length, 0);
  assert.match(c.toasts.at(-1), /产品·同步/);
  const adminC = controller(admin);
  adminC.ui.navigate('leads');
  await adminC.click({ leadAction: 'trash', id: 'lead-a' });
  assert.equal(adminC.saves, 1);
  assert.equal(L.list(adminC.state).find((l) => l.id === 'lead-a').trashed, true);
});

test('业务: a record that is not hers cannot be opened or changed by id', async () => {
  const c = controller(amy);
  c.ui.navigate('leads');
  await c.click({ leadAction: 'open', id: 'lead-k' });
  await c.click({ leadAction: 'edit', id: 'lead-k' });
  await c.click({ leadAction: 'convert', id: 'lead-k' });
  c.ui.navigate('opportunities');
  await c.click({ oppAction: 'detail', id: 'opp-k' });
  await c.click({ oppAction: 'edit', id: 'opp-k' });
  await c.click({ oppAction: 'archive', id: 'opp-k' });
  await c.click({ oppAction: 'move', id: 'opp-k', stage: 'won' });
  c.ui.navigate('order-list');
  await c.click({ bizOrder: 'order-k' });
  assert.equal(c.dialogs.length, 0);
  assert.equal(c.saves, 0);
  assert.equal(c.toasts.length, 8);
  assert.ok(c.toasts.every((text) => text === '这条记录不归你负责'), c.toasts.join('|'));
  await c.click({ bizOrder: 'order-a' });
  assert.deepEqual(c.dialogs, ['编辑订单'], 'her own order opens');
});

test('业务: pages she may not open show the no-permission notice instead of the page', () => {
  const c = controller(amy);
  for (const [route, text] of [['settings', '设置'], ['opp-flows', '商机设置'], ['team-goals', '团队数据'], ['team-targets', '目标管理'], ['doc-templates', '单据模版设置']]) {
    c.ui.navigate(route);
    assert.match(c.html, /class="empty role-blocked" role="status"/, route);
    assert.match(c.html, /没有“/, route);
    assert.ok(c.html.includes(text), `${route} names the missing permission (${text})`);
    assert.doesNotMatch(c.html, /biz-settings-form|opp-set|team-goal-grid|dt-form/, route);
  }
  const admin2 = controller(admin);
  admin2.ui.navigate('settings');
  assert.match(admin2.html, /biz-settings-form/);
});

test('an order the role can see but not edit opens as a read-only detail', async () => {
  const noEdit = R.updateRole(admin, 'sales', { perms: Object.fromEntries(R.SALES_DEFAULT.filter((key) => key !== 'order.edit').map((key) => [key, true])) });
  const state = R.switchTo(noEdit, R.settings(noEdit).members.find((m) => m.name === 'Amy').id);
  const c = controller(state);
  c.ui.navigate('order-list');
  await c.click({ bizOrder: 'order-a' });
  assert.deepEqual(c.dialogs, ['订单详情']);
  await c.click({ bizOrder: 'order-a' });
  assert.equal(c.saves, 0);
});

test('without 查看订单 the calendar hides order events and a hand-made order click is refused', async () => {
  const noView = R.updateRole(admin, 'sales', { perms: Object.fromEntries(R.SALES_DEFAULT.filter((key) => key !== 'order.view').map((key) => [key, true])) });
  const state = R.switchTo(noView, R.settings(noView).members.find((m) => m.name === 'Amy').id);
  assert.equal(R.can(state, 'order.view'), false);
  const c = controller(state);
  c.ui.selectCalendarDate('2026-10-01');
  assert.doesNotMatch(c.html, /data-biz-order=|订单 L-Amy/, 'order events are not drawn');
  await c.click({ bizOrder: 'order-a' });
  assert.deepEqual(c.dialogs, [], 'the editor does not open');
  assert.match(c.toasts.at(-1), /订单·查看/);
  // With the permission the same month shows the order again.
  const withView = controller(amy);
  withView.ui.selectCalendarDate('2026-10-01');
  assert.match(withView.html, /data-biz-order="order-a"/);
});
