// 固定时区：夹具里的时间按台北时间的日期来写。跨时区的行为在模型测试里单独验证。
process.env.TZ = 'Asia/Taipei';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const O = require('../src/opportunity-model.js');
const U = require('../src/opportunity-ui.js');
const T = require('../src/team-model.js');
const TU = require('../src/team-ui.js');
const B = require('../src/business-model.js');
const RM = require('../src/rail-menu.js');
const {escapeHtml} = require('../src/model.js');

const ui = U.create(escapeHtml, O);
const TODAY = '2026-10-06';
const base = {laiSettings: {defaultOwner: 'Amy'}, customers: {'Alpha <b>Co</b>': {owner: 'Amy', contacts: ['Ann', 'Bo']}, 'Beta Ltd': {owner: 'Bob'}}, orders: []};
const add = (state, id, extra = {}, now = '2026-10-06T04:00:00.000Z') => O.upsert(state, id, {client: 'Alpha <b>Co</b>', contact: 'Ann', amount: '331.74', currency: 'USD', endDate: '2026-11-05', owner: 'Amy', ...extra}, {now, today: now.slice(0, 10)});
function sample() {
  let s = add(base, 'p1', {endDate: '2026-04-02'});
  s = add(s, 'p2', {amount: '100', endDate: '2025-12-15', owner: 'Na<i>omi'});
  s = O.moveStage(add(s, 'p3', {amount: '200'}), 'p3', 'done', {now: '2026-10-06T05:00:00.000Z'});
  s = O.moveStage(add(s, 'p4', {amount: '50'}), 'p4', 'lost', {now: '2026-10-06T05:00:00.000Z', lostReason: '价格原因'});
  return add(s, 'p5', {amount: '70', currency: 'EUR', exchangeRate: '108', client: 'Beta Ltd', contact: ''});
}

test('board page: toolbar, totals, five stage columns with counts and amounts, cards', () => {
  const board = O.board(sample(), {}, TODAY);
  const html = ui.boardMarkup(board, {}, {today: TODAY});
  assert.match(html, /共 <b>4<\/b> 个商机/);
  for (const id of ['opp-search', 'opp-sort', 'opp-owner', 'opp-date-field', 'opp-from', 'opp-to', 'opp-archived', 'opp-currency']) assert.ok(html.includes(`id="${id}"`), id);
  assert.doesNotMatch(html, /opp-flow/, 'only one sales flow exists, so there is nothing to choose');
  // 四张金额卡片：名称、个数、金额；整数金额不带「.00」，币种下拉在筛选条里
  assert.deepEqual([...html.matchAll(/<div class="opp-stat k-card is-(\w+)"><span class="opp-stat-label"><i class="opp-dot" aria-hidden="true"><\/i>([^<]+)<span class="opp-stat-count">(\d+) 个<\/span><\/span><b><small>(\w+)<\/small> ([^<]+)<\/b><\/div>/g)].map(m => [m[1], m[2], m[3], `${m[4]} ${m[5]}`]),
    [['total', '总销售金额', '3', 'USD 631.74'], ['open', '进行中', '2', 'USD 431.74'], ['won', '赢单', '1', 'USD 200'], ['lost', '输单', '1', 'USD 50']]);
  assert.match(html, /<label class="opp-filter-currency"><span>币种<\/span><select id="opp-currency" class="k-select-trigger" aria-label="币种">/);
  assert.doesNotMatch(html, /opp-stat-currency/, 'the currency picker no longer takes a whole stat card');
  assert.match(html, /另有 1 个其他币种的商机/);
  assert.deepEqual([...html.matchAll(/<section class="opp-column opp-kind-(\w+)" data-opp-drop="(\w+)"[^>]*><header class="opp-stage"><span class="opp-stage-name"><i class="opp-dot" aria-hidden="true"><\/i>([^<]+)<\/span><span class="opp-stage-count k-badge k-badge--\w+">(\d+)<\/span><span class="opp-stage-amount">([^<]+)</g)].map(m => [m[1], m[2], `${m[3]}(${m[4]})`, m[5]]),
    [['open', 'open', '未成单(2)', 'USD 431.74'], ['open', 'unpaid', '付款未到账(0)', 'USD 0'], ['won', 'balance', '待付尾款(0)', 'USD 0'], ['won', 'done', '已完成(1)', 'USD 200'], ['lost', 'lost', '输单(1)', 'USD 50']]);
  assert.equal((html.match(/class="opp-card k-card"/g) || []).length, 4);
  assert.equal((html.match(/draggable="true"/g) || []).length, 4);
  assert.equal((html.match(/<p class="k-empty opp-drop-hint">拖到这里<\/p>/g) || []).length, 2, 'empty columns show a drop hint');
  const readOnly = U.create(escapeHtml, O, key => key !== 'opp.edit');
  assert.equal((readOnly.boardMarkup(board, {}, {today: TODAY}).match(/<p class="k-empty opp-drop-hint">暂无商机<\/p>/g) || []).length, 2, 'no drop hint for someone who cannot move cards');
  // 卡片：客户是标题（打开这位客户），商机名称是下面一行（打开详情）
  assert.match(html, /<div class="opp-card-head"><button type="button" class="opp-card-client" data-biz-customer="Alpha &lt;b&gt;Co&lt;\/b&gt;">Alpha &lt;b&gt;Co&lt;\/b&gt;<\/button><button type="button" class="opp-card-menu" data-opp-action="menu" data-id="p4"[^>]*>⋮<\/button><\/div><button type="button" class="opp-card-name" data-opp-action="detail" data-id="p4">26100604-Amy<\/button>/);
  assert.match(html, /<span class="opp-due is-overdue">逾期 04-02<\/span>/, 'this year: month-day only');
  assert.match(html, /<span class="opp-due is-overdue">逾期 2025-12-15<\/span>/, 'other years: full date');
  assert.equal((html.match(/class="opp-due is-overdue"/g) || []).length, 2, 'two open opportunities are past their end date');
  assert.equal((html.match(/<span class="opp-due">11-05<\/span>/g) || []).length, 2, 'won and lost cards show the date without 截止');
  assert.doesNotMatch(html, /截止/, 'no open card in this sample is still within its date');
  assert.match(html, /<i class="opp-avatar" aria-hidden="true">A<\/i><span class="opp-owner-name">Amy<\/span>/);
  assert.match(html, /输单原因：价格原因/);
  assert.match(ui.boardMarkup(board, {}, {today: TODAY}), /data-opp-view="board" aria-pressed="true"/);
  assert.doesNotMatch(ui.headerActions(board, {}, {}), /data-opp-view/, 'the view switch lives in the filter card only (D-029: no classic header copy)');
  const soon = ui.boardMarkup(O.board(add(base, 's1', {endDate: '2026-10-20'}), {}, TODAY), {}, {today: TODAY});
  assert.match(soon, /<span class="opp-due">10-20 截止<\/span>/, 'an open opportunity still within its date (14 days left)');
  const near = ui.boardMarkup(O.board(add(base, 's2', {endDate: '2026-10-13'}), {}, TODAY), {}, {today: TODAY});
  assert.match(near, /<span class="opp-due is-soon">10-13 截止<\/span>/, 'due within 7 days: marked in the warning colour');
  assert.doesNotMatch(ui.headerActions(board, {}, {}), /opp-analysis/, '商机分析 is a header tab, not a second button');
});

test('customer and owner text is always escaped', () => {
  const s = sample(), board = O.board(s, {}, TODAY);
  const card = board.cards[0];
  const html = ui.boardMarkup(board, {}, {today: TODAY}) + ui.boardMarkup(board, {mode: 'list'}, {today: TODAY}) + ui.headerActions(board, {owners: O.ownerNames(s)})
    + ui.menuMarkup(card) + ui.lostMarkup(card) + ui.formMarkup({...O.list(s)[0], note: '<script>x</script>'}, {customers: O.customerNames(s), contacts: ['A"<b>'], owners: O.ownerNames(s)})
    + ui.analysisMarkup(O.analysis(s, {}, TODAY));
  assert.doesNotMatch(html, /<b>Co<\/b>|Na<i>omi|<script>x|A"<b>/);
  assert.match(html, /Alpha &lt;b&gt;Co&lt;\/b&gt;/); assert.match(html, /Na&lt;i&gt;omi/);
});

test('list view shows the same opportunities as a table; long columns are paged', () => {
  const board = O.board(sample(), {}, TODAY);
  const html = ui.boardMarkup(board, {mode: 'list'}, {today: TODAY});
  assert.doesNotMatch(html, /opp-board/);
  assert.equal((html.match(/data-opp-action="menu"/g) || []).length, 4);
  assert.match(html, /<td><span class="k-badge k-badge--success">已完成<\/span><\/td>/, 'won stage: a success badge'); assert.match(html, /<td><span class="k-badge k-badge--neutral">输单<\/span><\/td>/, 'lost stage: a neutral badge'); assert.match(html, /<table class="k-table opp-table">/); assert.match(html, /<td class="k-num">USD 200\.00<\/td>/, 'amounts are right-aligned tabular numbers'); assert.match(html, /<span class="opp-due is-overdue">逾期 2026-04-02<\/span>/);
  assert.match(html, /data-opp-view="list" aria-pressed="true"/);
  let many = base;
  for (let i = 0; i < 65; i++) many = add(many, 'm' + i, {nameMode: 'custom', name: 'N' + String(i).padStart(2, '0')});
  const big = O.board(many, {}, TODAY);
  const first = ui.boardMarkup(big, {}, {today: TODAY});
  assert.equal((first.match(/class="opp-card k-card"/g) || []).length, 30);
  assert.match(first, /data-opp-action="more" data-stage="open">再显示 30 个（还有 35 个）/);
  const more = ui.boardMarkup(big, {limits: {open: 60}}, {today: TODAY});
  assert.equal((more.match(/class="opp-card k-card"/g) || []).length, 60);
  assert.match(more, /再显示 5 个（还有 5 个）/);
  assert.doesNotMatch(ui.boardMarkup(big, {limits: {open: 90}}, {today: TODAY}), /data-opp-action="more"/);
  assert.match(ui.boardMarkup(big, {mode: 'list'}, {today: TODAY}), /data-stage="list">再显示 30 个（还有 35 个）/);
});

test('form: reference fields, required marks, and the parts that depend on what is filled in', () => {
  const fresh = ui.formMarkup(O.defaults(base, TODAY), {customers: O.customerNames(base), contacts: [], owners: ['Amy'], isNew: true});
  for (const name of ['nameMode', 'client', 'contact', 'amount', 'endDate', 'flow', 'exchangeRate', 'currency', 'stage', 'owner', 'collaborators', 'tags', 'note', 'products']) assert.ok(fresh.includes(`name="${name}"`), name);
  assert.match(fresh, /value="auto" checked/); assert.match(fresh, /name="name" value=""[^>]* hidden disabled>/, 'the name input is there but off until 自定义 is chosen');
  assert.match(fresh, /name="endDate" type="date" value="2026-11-05"/, 'end date defaults to 30 days ahead');
  assert.match(fresh, /<label class="opp-field" hidden><span class="opp-field-label">汇率<i[^>]*>\*<\/i><\/span><input class="k-input" name="exchangeRate" value="100" data-rate="100" inputmode="decimal" readonly/, 'USD needs no rate, so the field stays out of sight');
  assert.match(fresh, /<input type="hidden" name="flow" value="default">/);
  assert.equal((fresh.match(/<i class="opp-req" aria-hidden="true">\*<\/i>/g) || []).length, 8, 'name, customer, owner, amount, stage, end date, and the two hidden conditional ones');
  assert.match(fresh, /<option value="" selected>请先选择客户<\/option>/); assert.doesNotMatch(fresh, /name="contact" required/);
  assert.match(fresh, /name="owner" value="Amy"/); assert.match(fresh, /<label class="opp-field" hidden><span class="opp-field-label">输单原因<i class="opp-req" aria-hidden="true">\*<\/i><\/span><select class="k-select-trigger" name="lostReason" disabled>/, 'lost fields are present but hidden and disabled');
  const chosen = ui.formMarkup({...O.defaults(base, TODAY), client: 'Alpha <b>Co</b>', contact: 'Bo', nameMode: 'custom', name: '大单', currency: 'EUR', exchangeRate: 108, stage: 'lost', lostReason: '交期原因',
    collaborators: ['Bob', 'Cara'], tags: ['VIP'], products: [{name: 'A', quantity: 10, unitPrice: 2.5}, {name: 'B', quantity: 1, unitPrice: 4}]}, {contacts: ['Ann', 'Bo'], isNew: false});
  assert.match(chosen, /name="contact" aria-required="true" required><option value="">请选择<\/option><option value="Ann">Ann<\/option><option value="Bo" selected>Bo<\/option>/);
  assert.match(chosen, /value="custom" checked/); assert.match(chosen, /name="name" value="大单"[^>]* required>/);
  assert.match(chosen, /<select class="k-select-trigger" name="lostReason" aria-required="true" required>/);
  assert.match(chosen, /<label class="opp-field"><span class="opp-field-label">汇率<i[^>]*>\*<\/i><\/span><input class="k-input" name="exchangeRate" value="108" data-rate="108" inputmode="decimal" aria-describedby/); assert.doesNotMatch(chosen, /name="exchangeRate"[^>]*readonly/);
  assert.match(chosen, /<option value="交期原因" selected>/); assert.match(chosen, /name="lostNote"/);
  assert.match(chosen, /name="collaborators" value="Bob，Cara"/);
  assert.match(chosen, />A, 10, 2\.5\nB, 1, 4<\/textarea><span class="opp-field-hint">共 2 项，合计 29\.00/);
  assert.match(ui.formMarkup({client: 'Beta Ltd'}, {contacts: []}), /该客户没有联系人，可留空/);
  // 原来的联系人已不在客户联系人里：仍然作为已选项保留，保存别的修改时不会被清掉
  assert.match(ui.formMarkup({client: 'X', contact: 'Ann'}, {contacts: ['Bo']}), /<option value="Bo">Bo<\/option><option value="Ann" selected>Ann（已不在该客户的联系人中）<\/option>/);
  assert.match(ui.formMarkup({client: 'X', contact: 'Ann'}, {contacts: []}), /<option value="Ann" selected>Ann（已不在该客户的联系人中）<\/option><option value="">该客户没有联系人，可留空<\/option>/);
  assert.match(ui.formMarkup({stage: 'legacy'}, {}), /<option value="legacy" selected>原阶段：legacy<\/option>/);
  assert.match(ui.formMarkup({stage: 'lost', lostReason: '老原因'}, {}), /<option value="老原因" selected>老原因<\/option>/);
  assert.doesNotThrow(() => ui.formMarkup({products: [null, 'x', {name: 'A'}]}, {}));
});

test('card menu offers the right actions for each state', () => {
  const s = sample(), card = id => O.board(s, {archived: 'all'}, TODAY).cards.find(c => c.id === id);
  const open = ui.menuMarkup(card('p1'));
  assert.deepEqual([...open.matchAll(/data-opp-action="move" data-id="p1" data-stage="(\w+)"/g)].map(m => m[1]), ['unpaid', 'balance', 'done', 'lost']);
  assert.doesNotMatch(open, /生成订单/); assert.match(open, />归档<\/button>/); assert.match(open, />删除商机<\/button>/);
  assert.match(ui.menuMarkup(card('p3')), /data-opp-action="order" data-id="p3">生成订单/);
  const linked = ui.menuMarkup({...card('p3'), orderId: 'ord-9'});
  assert.doesNotMatch(linked, /生成订单/); assert.match(linked, /data-biz-order="ord-9">查看关联订单/);
  assert.match(ui.menuMarkup({...card('p1'), archived: true}), /data-archived="0">取消归档/);
  assert.match(ui.menuMarkup(card('p1'), true), /class="k-btn k-btn--ghost opp-menu-item is-danger team-danger" data-opp-action="delete" data-id="p1">再点一次确认删除（不可恢复）/);
  assert.match(ui.lostMarkup(card('p1')), /<form class="drawer-body opp-form" id="opp-lost-form" data-id="p1">/);
});

test('analysis page shows the figures from the model', () => {
  const html = ui.analysisMarkup(O.analysis(sample(), {}, TODAY));
  assert.match(html, /<span class="opp-stat-label">新建商机数<\/span><b>4<\/b>/);
  assert.match(html, /<span class="opp-stat-label">赢单率<\/span><b>50%<\/b>/);
  assert.match(html, /<div class="opp-stat k-card is-won"><span class="opp-stat-label"><i class="opp-dot" aria-hidden="true"><\/i>赢单<span class="opp-stat-count">1 个<\/span><\/span><b><small>USD<\/small> 200<\/b><\/div>/);
  assert.match(html, /<td>价格原因<\/td><td class="k-num">1<\/td><td class="k-num">USD 50\.00<\/td>/);
  assert.deepEqual([...html.matchAll(/<div class="opp-bar opp-kind-(\w+)"><span class="opp-bar-label">([^<]+)<\/span><span class="opp-bar-track"><i style="width:(\d+)%"><\/i><\/span><b class="opp-bar-count">([^<]+)<\/b><span class="opp-bar-amount">([^<]+)<\/span>/g)].map(m => m.slice(1)),
    [['open', '未成单', '100', '2 个 · 50%', 'USD 431.74'], ['open', '付款未到账', '0', '0 个 · 0%', 'USD 0.00'], ['won', '待付尾款', '0', '0 个 · 0%', 'USD 0.00'], ['won', '已完成', '50', '1 个 · 25%', 'USD 200.00'], ['lost', '输单', '50', '1 个 · 25%', 'USD 50.00']]);
  assert.match(html, /另有 1 个其他币种的商机未计入本页/);
  assert.doesNotMatch(html, /opp-analysis-currency/, 'the currency picker sits in the page header');
  assert.match(ui.analysisControls(O.analysis(sample(), {}, TODAY)), /<label class="opp-head-select"><span>币种<\/span><select id="opp-analysis-currency" class="k-select-trigger" aria-label="币种"><option value="USD" selected>USD<\/option><option value="EUR">EUR<\/option><\/select><\/label>/);
  const empty = ui.analysisMarkup(O.analysis({}, {}, TODAY));
  assert.match(empty, /<span class="opp-stat-label">赢单率<\/span><b>—<\/b>/); assert.match(empty, /所选范围内没有商机/); assert.match(empty, /所选范围内没有输单/);
});

// ---------------- controller ----------------
const source = fs.readFileSync(path.join(__dirname, '../src/business-ui.js'), 'utf8');
function controller(initial, failWith = null, extraAll = {}) {
  const {roleModel, ...extra} = extraAll;
  let current = initial, form = null, broken = false;
  const mounted = [], dialogs = [], listeners = {}, toasts = [], toastOptions = [], dismissed = [], closed = [], errors = {}, refreshed = [], navigated = [];
  const sandbox = {crypto: {randomUUID: () => 'new-id'}, FormData: function (f) { return Object.entries(f.values)[Symbol.iterator](); }, document: {
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    getElementById: id => id === 'opp-form' ? form : id ? (errors[id] ||= {textContent: '', classList: {add() {}}}) : null,
    querySelectorAll: () => [], querySelector: () => null}};
  sandbox.window = {LaiBusinessModel: B, LaiModules: require('../src/modules.js'), LaiTeamModel: T, LaiTeamUI: TU, LaiOpportunityModel: O, LaiOpportunityUI: U, ...(roleModel ? {LaiRoleModel: roleModel, LaiWhatsAppModel: require('../src/whatsapp-model.js')} : {})};
  vm.createContext(sandbox); vm.runInContext(source, sandbox);
  const page = sandbox.window.LaiBusinessUI.create({getState: () => current, escape: escapeHtml, mount: html => mounted.push(html),
    save: async next => { if (failWith) throw new Error(failWith); current = next; return true; }, openCustomer() {}, refreshCustomer: name => refreshed.push(name), navigate: to => navigated.push(to),
    toast: (text, options) => { toasts.push(text); toastOptions.push(options || null); return {dismiss: () => dismissed.push(text)}; }, dialog: (...args) => { if (broken) throw new Error('boom'); dialogs.push(args); }, closeDialog: () => closed.push(1), ...extra});
  const target = dataset => ({closest: sel => sel === 'button' ? {dataset, disabled: false} : null});
  const fakeForm = values => {
    const field = value => { const label = {hidden: false}; return {value, disabled: false, hidden: false, required: false, readOnly: false, innerHTML: '', dataset: {}, label, closest: () => label}; };
    const elements = Object.fromEntries(['client', 'contact', 'flow', 'stage', 'lostReason', 'lostNote', 'nameMode', 'name', 'currency', 'exchangeRate'].map(name => [name, field(values[name] ?? '')]));
    form = {elements, values};
    return elements;
  };
  return {page, mounted, dialogs, toasts, toastOptions, dismissed, undoOffer: () => toastOptions.at(-1)?.action || null, closed, errors, refreshed, navigated, state: () => current, fakeForm, setForm: values => { form = values ? {values} : null; },
    replaceState: next => { current = next; }, breakDialog: () => { broken = true; },
    click: dataset => Promise.all(listeners.click.map(fn => fn({target: target(dataset)}))),
    submit: (id, values, dataset = {}) => Promise.all(listeners.submit.map(fn => fn({target: {id, values, dataset, elements: {isDraft: {checked: false}}}, preventDefault() {}}))),
    changeTarget: target => { target.closest ||= () => null; listeners.change.forEach(fn => fn({target})); },
    change: el => listeners.change.forEach(fn => fn({target: {dataset: {}, closest: sel => sel === '#opp-form' ? (el.inForm ? {} : null) : null, ...el}})),
    drag: (type, el, props = {}) => { let prevented = false; listeners[type].forEach(fn => fn({target: el, preventDefault() { prevented = true; }, dataTransfer: {setData() {}}, ...props})); return prevented; },
    key: (el, props) => { let prevented = false; const result = Promise.all((listeners.keydown || []).map(fn => fn({target: el, preventDefault() { prevented = true; }, ...props}))); return result.then(() => prevented); },
    clickAt: el => Promise.all(listeners.click.map(fn => fn({target: el}))), change2: event => Promise.all(listeners.change.map(fn => fn(event)))};
}
const listenersChange = (c, target) => c.changeTarget(target);
const valid = {nameMode: 'auto', client: 'Beta Ltd', contact: '', amount: '120', endDate: '2026-11-05', flow: 'default', exchangeRate: '100', currency: 'USD', stage: 'open', owner: 'Amy', collaborators: '', tags: '', note: '', products: ''};

test('controller: board renders, a new opportunity can be created, edited and its form reacts to the customer', async () => {
  const c = controller(sample());
  c.page.navigate('opportunities');
  assert.match(c.mounted.at(-1), /<div class="k-pageheader opp-header"><div class="k-pageheader-text"><h1 class="k-pageheader-title">商机<\/h1><span class="k-pageheader-desc">按销售阶段跟进每一笔机会<\/span>/); assert.match(c.mounted.at(-1), /class="k-btn k-btn--primary" data-opp-action="new">新建商机/); assert.match(c.mounted.at(-1), /id="opp-owner"/);
  await c.click({oppAction: 'new'});
  assert.deepEqual([c.dialogs.at(-1)[0], c.dialogs.at(-1)[3]], ['新建商机', 'business-opportunity']);
  assert.equal(c.page.hasDraft(), true, 'an open form guards against losing input when navigating away');
  // 选了客户：只更新联系人下拉，不重画表单（已填的其他内容原样留在页面上）
  const dialogsBefore = c.dialogs.length;
  const f = c.fakeForm({client: 'Alpha <b>Co</b>', stage: 'open', nameMode: 'auto', currency: 'USD', exchangeRate: '100'});
  c.change({name: 'client', inForm: true});
  assert.match(f.contact.innerHTML, /<option value="">请选择<\/option><option value="Ann">Ann<\/option><option value="Bo">Bo<\/option>/);
  assert.equal(f.contact.required, true);
  f.stage.value = 'lost'; c.change({name: 'stage', inForm: true});
  assert.deepEqual([f.lostReason.disabled, f.lostReason.required, f.lostReason.label.hidden, f.lostNote.disabled], [false, true, false, false]);
  f.stage.value = 'open'; c.change({name: 'stage', inForm: true});
  assert.deepEqual([f.lostReason.disabled, f.lostReason.required, f.lostReason.label.hidden], [true, false, true]);
  f.nameMode.value = 'custom'; c.change({name: 'nameMode', inForm: true});
  assert.deepEqual([f.name.disabled, f.name.hidden, f.name.required], [false, false, true]);
  f.currency.value = 'eur'; f.exchangeRate.readOnly = true; c.change({name: 'currency', inForm: true});
  assert.deepEqual([f.exchangeRate.readOnly, f.exchangeRate.value], [false, '100']);
  f.exchangeRate.value = '108.5'; f.currency.value = 'USD'; c.change({name: 'currency', inForm: true});
  assert.deepEqual([f.exchangeRate.readOnly, f.exchangeRate.value], [true, '100']);
  f.currency.value = 'EUR'; c.change({name: 'currency', inForm: true});
  assert.deepEqual([f.exchangeRate.readOnly, f.exchangeRate.value], [false, '108.5'], 'the rate typed for EUR comes back after a detour through USD');
  assert.equal(c.dialogs.length, dialogsBefore, 'the dialog is never redrawn while filling in the form');
  await c.submit('opp-form', {...valid, client: 'Alpha <b>Co</b>'});
  assert.equal(c.errors['opp-error'].textContent, '请选择关联联系人'); assert.equal(c.closed.length, 0);
  await c.submit('opp-form', valid);
  assert.equal(c.closed.length, 1); assert.equal(c.page.hasDraft(), false);
  const made = O.list(c.state()).find(i => i.id === 'new-id');
  assert.deepEqual([made.client, made.amount, made.stage], ['Beta Ltd', 120, 'open']);
  assert.match(c.mounted.at(-1), /共 <b>5<\/b> 个商机/);
  await c.click({oppAction: 'edit', id: 'p1'});
  assert.equal(c.dialogs.at(-1)[0], '编辑商机'); assert.match(c.dialogs.at(-1)[1], /name="amount" value="331\.74"/);
  await c.submit('opp-form', {...valid, client: 'Alpha <b>Co</b>', contact: 'Bo', amount: '400'});
  assert.deepEqual([O.list(c.state()).find(i => i.id === 'p1').amount, O.list(c.state()).find(i => i.id === 'p1').contact], [400, 'Bo']);
  // 换了客户：原来选的联系人不带过去；换回原客户时恢复
  await c.click({oppAction: 'edit', id: 'p1'});
  assert.match(c.dialogs.at(-1)[1], /<option value="Bo" selected>/);
  const g = c.fakeForm({client: 'Beta Ltd'});
  c.change({name: 'client', inForm: true});
  assert.doesNotMatch(g.contact.innerHTML, /selected>Bo|Bo/); assert.equal(g.contact.required, false);
  g.client.value = 'Alpha <b>Co</b>'; c.change({name: 'client', inForm: true});
  assert.match(g.contact.innerHTML, /<option value="Bo" selected>Bo<\/option>/);
  c.page.discardDraft();
  await c.click({oppAction: 'edit', id: 'gone'});
  assert.match(c.toasts.at(-1), /商机不存在/);
});

test('controller: menu, stage moves, lost reason, archive, two-step delete', async () => {
  const c = controller(sample());
  c.page.navigate('opportunities');
  await c.click({oppAction: 'menu', id: 'p1'});
  assert.equal(c.dialogs.at(-1)[3], 'opp-menu'); assert.match(c.dialogs.at(-1)[1], /移到「付款未到账」/);
  await c.click({oppAction: 'move', id: 'p1', stage: 'unpaid'});
  assert.equal(O.list(c.state()).find(i => i.id === 'p1').stage, 'unpaid');
  await c.click({oppAction: 'move', id: 'p1', stage: 'lost'});
  assert.equal(c.dialogs.at(-1)[3], 'opp-lost'); assert.equal(O.list(c.state()).find(i => i.id === 'p1').stage, 'unpaid', 'nothing is saved until a reason is given');
  await c.submit('opp-lost-form', {lostReason: '', lostNote: ''}, {id: 'p1'});
  assert.equal(c.errors['opp-lost-error'].textContent, '请选择输单原因');
  await c.submit('opp-lost-form', {lostReason: '客户无回复', lostNote: '三次未回'}, {id: 'p1'});
  assert.deepEqual([O.list(c.state()).find(i => i.id === 'p1').stage, O.list(c.state()).find(i => i.id === 'p1').lostReason], ['lost', '客户无回复']);
  await c.click({oppAction: 'archive', id: 'p2', archived: '1'});
  assert.equal(O.list(c.state()).find(i => i.id === 'p2').archived, true);
  assert.match(c.mounted.at(-1), /共 <b>3<\/b> 个商机/, 'archived opportunities leave the default view');
  const count = O.list(c.state()).length;
  await c.click({oppAction: 'delete', id: 'p4'});
  assert.equal(O.list(c.state()).length, count); assert.match(c.dialogs.at(-1)[1], /再点一次确认删除/);
  await c.click({oppAction: 'menu', id: 'p4'});
  assert.doesNotMatch(c.dialogs.at(-1)[1], /再点一次确认删除/, 'any other action cancels the pending delete');
  await c.click({oppAction: 'delete', id: 'p4'}); await c.click({oppAction: 'delete', id: 'p4'});
  assert.equal(O.list(c.state()).length, count - 1);
});

test('controller: filters, views, paging and drag-and-drop', async () => {
  const c = controller(sample());
  c.page.navigate('opportunities');
  c.change({id: 'opp-currency', value: 'EUR'});
  assert.match(c.mounted.at(-1), /总销售金额<span class="opp-stat-count">1 个<\/span><\/span><b><small>EUR<\/small> 70<\/b>/);
  c.change({id: 'opp-currency', value: 'USD'}); c.change({id: 'opp-search', value: '26100602'});
  assert.match(c.mounted.at(-1), /共 <b>1<\/b> 个商机/);
  c.change({id: 'opp-search', value: ''}); c.change({id: 'opp-archived', value: 'all'}); c.change({id: 'opp-owner', value: 'amy'});
  assert.match(c.mounted.at(-1), /共 <b>3<\/b> 个商机/);
  c.change({id: 'opp-owner', value: ''});
  await c.click({oppView: 'list'});
  assert.match(c.mounted.at(-1), /data-opp-view="list" aria-pressed="true"/);
  await c.click({oppView: 'board'});
  // 拖动
  const cardEl = {closest: sel => sel === '[data-opp-id]' ? {dataset: {oppId: 'p1'}} : null};
  const column = stage => ({closest: sel => sel === '[data-opp-drop]' ? {dataset: {oppDrop: stage}} : null});
  assert.equal(c.drag('dragover', column('done')), false, 'nothing is being dragged yet');
  c.drag('dragstart', cardEl);
  assert.equal(c.drag('dragover', column('done')), true);
  c.drag('drop', column('done')); await new Promise(resolve => setImmediate(resolve));
  assert.equal(O.list(c.state()).find(i => i.id === 'p1').stage, 'done');
  c.drag('dragstart', cardEl); c.drag('drop', column('lost'));
  assert.equal(c.dialogs.at(-1)[3], 'opp-lost', 'dropping on 输单 asks for the reason first');
  c.drag('dragstart', cardEl); c.drag('dragend', cardEl);
  assert.equal(c.drag('dragover', column('open')), false);
  // 其他页面上这些动作无效
  c.page.navigate('analysis');
  const before = c.dialogs.length;
  await c.click({oppAction: 'new'}); c.drag('dragstart', cardEl);
  assert.equal(c.dialogs.length, before); assert.equal(c.drag('dragover', column('open')), false);
});

test('controller: a won opportunity becomes an order and stays linked to it', async () => {
  const c = controller(sample());
  c.page.navigate('opportunities');
  await c.click({oppAction: 'order', id: 'p3'});
  const [title, body] = c.dialogs.at(-1);
  assert.match(title, /订单/);
  assert.match(body, /name="client"[^>]*value="Alpha &lt;b&gt;Co&lt;\/b&gt;"/); assert.match(body, /name="amount"[^>]*value="200"/);
  assert.match(body, /name="num"[^>]*value="L20\d{6}-001"/, 'the order number is prefilled like any new order');
  await c.submit('biz-order-form', {num: 'L-OPP-1', client: 'Alpha <b>Co</b>', amount: '200', paidAmount: '0', currency: 'USD', stage: 'quote', createdAt: TODAY, orderMonth: '2026-10', owner: 'Amy'});
  const order = c.state().orders.find(o => o.num === 'L-OPP-1');
  assert.ok(order, 'order saved');
  assert.equal(O.list(c.state()).find(i => i.id === 'p3').orderId, order.id);
  assert.match(c.mounted.at(-1), /data-biz-order="new-id">查看关联订单/);
});

test('controller: a failed save keeps the form and its content; analysis page and ranges work', async () => {
  const c = controller(sample(), '数据已发生变化，请重新打开来财后再编辑。');
  c.page.navigate('opportunities');
  await c.click({oppAction: 'new'});
  await c.submit('opp-form', valid);
  assert.equal(c.errors['opp-error'].textContent, '数据已发生变化，请重新打开来财后再编辑。');
  assert.deepEqual([c.closed.length, c.page.hasDraft(), O.list(c.state()).length], [0, true, 5]);
  c.page.discardDraft();
  c.page.navigate('opp-analysis');
  assert.match(c.mounted.at(-1), /<h1>商机分析<\/h1>/); assert.match(c.mounted.at(-1), /全部时间 · 按商机创建时间统计/); assert.doesNotMatch(c.mounted.at(-1), /id="biz-month"/);
  await c.click({oppRange: 'quarter'});
  assert.match(c.mounted.at(-1), /年第 \d 季度 · 按商机创建时间统计/); assert.match(c.mounted.at(-1), /id="biz-month"/);
  c.change({id: 'opp-analysis-currency', value: 'EUR'});
  assert.match(c.mounted.at(-1), /<option value="EUR" selected>/);
});

test('navigation: 商机 is a real menu with its own pages and highlight', () => {
  assert.deepEqual(RM.sectionFor('opportunities').entries.map(e => [e.label, e.target]), [['商机看板', 'opportunities'], ['商机分析', 'opp-analysis'], ['商机设置', 'opp-flows']]);
  assert.equal(RM.sectionFor('opp-analysis').label, '商机');
  const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  assert.match(app, /\["globe", "商机", "opportunities"\]/);
  // 业务页面清单不再在 app.js 里另抄一份，而是取自 rail-menu.js（与「可设为常用」同一来源）。
  assert.match(app, /const businessRoutes = new Set\(RM\.favoritable\(\)\.filter/);
  for (const route of ['opportunities', 'opp-analysis', 'opp-flows']) assert.ok(RM.favoritable().some(e => e.kind === 'route' && e.target === route), route);
  const template = fs.readFileSync(path.join(__dirname, '../src/template.html'), 'utf8');
  const at = marker => template.indexOf(`<!--${marker}-->`);
  assert.ok(at('TEAM_UI') < at('OPP_MODEL') && at('OPP_MODEL') < at('OPP_UI') && at('OPP_UI') < at('LAI_BUSINESS_UI'));
  const build = fs.readFileSync(path.join(__dirname, '../scripts/build.py'), 'utf8');
  assert.match(build, /'<!--OPP_MODEL-->','opportunity-model\.js','script'/); assert.match(build, /'<!--OPP_UI-->','opportunity-ui\.js','script'/);
});

// ---------------- 独立评审后补充 ----------------
test('review: a broken stored product does not block the form or leave an editing state behind', async () => {
  const s = sample();
  const broken = {...s, laiOpportunities: s.laiOpportunities.map(item => item.id === 'p1' ? {...item, products: [null, {name: 'A', quantity: 2, unitPrice: 3}]} : item)};
  const c = controller(broken);
  c.page.navigate('opportunities');
  await c.click({oppAction: 'edit', id: 'p1'});
  assert.equal(c.dialogs.at(-1)[0], '编辑商机'); assert.match(c.dialogs.at(-1)[1], />A, 2, 3<\/textarea>/);
  c.page.discardDraft();
  // 表单打不开时不进入编辑状态
  const failing = controller(sample());
  failing.page.navigate('opportunities');
  failing.breakDialog();
  await failing.click({oppAction: 'new'});
  assert.equal(failing.page.hasDraft(), false);
  assert.match(failing.toasts.at(-1), /无法打开商机表单/);
});

test('review: saving an edit of an opportunity that was deleted meanwhile does not re-create it', async () => {
  const c = controller(sample());
  c.page.navigate('opportunities');
  await c.click({oppAction: 'edit', id: 'p1'});
  c.replaceState(O.remove(c.state(), 'p1'));
  await c.submit('opp-form', {...valid, client: 'Beta Ltd'});
  assert.match(c.errors['opp-error'].textContent, /商机不存在/);
  assert.equal(O.list(c.state()).some(i => i.id === 'p1'), false);
});

test('review: the menu works for an item with no currency, and a trashed linked order no longer blocks a new one', async () => {
  let s = add(add(base, 'e1', {currency: 'EUR', exchangeRate: '108'}), 'e2', {currency: 'EUR', exchangeRate: '108'});
  s = {...s, laiOpportunities: [{id: 'odd', name: '旧数据', client: 'Beta Ltd', amount: 5, stage: 'done', owner: 'Amy', endDate: '2026-11-05', orderId: 'gone-order'}, ...s.laiOpportunities]};
  const c = controller(s);
  c.page.navigate('opportunities');
  await c.click({oppAction: 'menu', id: 'odd'});
  assert.equal(c.dialogs.at(-1)[3], 'opp-menu');
  assert.match(c.dialogs.at(-1)[1], /data-opp-action="order" data-id="odd">生成订单/, 'the linked order is gone, so a new one can be made');
  assert.doesNotMatch(c.dialogs.at(-1)[1], /查看关联订单/);
  await c.click({oppAction: 'order', id: 'e1'});
  assert.equal(c.toasts.at(-1), '只有赢单阶段的商机可以生成订单');
});

// ---------------- 客户页面与商机的衔接 ----------------
test('customer page: the controller API opens the form for that customer and returns to the customer after saving', async () => {
  const c = controller(sample());
  c.page.navigate('analysis');
  c.page.newOpportunity('Beta Ltd');
  assert.equal(c.dialogs.at(-1)[0], '新建商机');
  assert.match(c.dialogs.at(-1)[1], /name="client" id="opp-client" value="Beta Ltd"/);
  const mountedBefore = c.mounted.length;
  await c.submit('opp-form', valid);
  assert.deepEqual(c.refreshed, ['Beta Ltd'], 'goes back to the customer instead of drawing the opportunity board');
  assert.equal(c.mounted.length, mountedBefore);
  c.page.opportunityMenu('p1', 'Alpha <b>Co</b>');
  assert.equal(c.dialogs.at(-1)[3], 'opp-menu');
  await c.click({oppAction: 'move', id: 'p1', stage: 'unpaid'});
  assert.equal(O.list(c.state()).find(i => i.id === 'p1').stage, 'unpaid', 'menu buttons work from the customer page');
  assert.deepEqual(c.refreshed, ['Beta Ltd', 'Alpha <b>Co</b>']);
  await c.page.moveOpportunity('p1', 'lost', 'Alpha <b>Co</b>');
  assert.equal(c.dialogs.at(-1)[3], 'opp-lost');
  await c.submit('opp-lost-form', {lostReason: '其他', lostNote: ''}, {id: 'p1'});
  assert.equal(O.list(c.state()).find(i => i.id === 'p1').stage, 'lost'); assert.equal(c.refreshed.length, 3);
  c.page.showOpportunities('Beta Ltd');
  assert.deepEqual(c.navigated, ['opportunities']);
  c.page.navigate('opportunities');
  assert.match(c.mounted.at(-1), /id="opp-search" value="Beta Ltd"/);
  await c.click({oppAction: 'archive', id: 'p2', archived: '1'});
  assert.equal(c.refreshed.length, 3, 'once on the opportunity page, saves redraw that page again');
});

test('customer page: detail shows the current in-progress opportunity, real counts, and its buttons are handled', () => {
  const D = require('../src/customer-detail-ui.js');
  const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  const body = app.slice(app.indexOf('  const detailOpp = {'), app.indexOf('  function detailMarkup(c) {'));
  const s = sample();
  const calls = [];
  const sandbox = {state: s, currentName: 'Alpha <b>Co</b>', activeRoute: 'customers', toast: t => calls.push(['toast', t]), detail: (...a) => calls.push(['detail', ...a]),
    business: {newOpportunity: n => calls.push(['new', n]), showOpportunities: n => calls.push(['all', n]), opportunityMenu: (...a) => calls.push(['menu', ...a]), moveOpportunity: (...a) => calls.push(['move', ...a])}};
  sandbox.window = {LaiOpportunityModel: O};
  // detailScopeState / customerOpportunities 按角色范围筛商机（本人／本部门只算自己能看到的）。
  sandbox.R = require('../src/role-model.js');
  vm.createContext(sandbox); vm.runInContext(body, sandbox);
  const run = code => vm.runInContext(code, sandbox);
  const stats = run('customerOpportunities(currentName)');
  assert.deepEqual([stats.activeOpportunityCount, stats.activeOpportunityIndex, stats.activeOpportunities.map(c => c.id)], [2, 0, ['p1', 'p2']]);
  for (const [feature, expected] of [['添加商机', ['new', 'Alpha <b>Co</b>']], ['新建商机', ['new', 'Alpha <b>Co</b>']], ['全部商机', ['all', 'Alpha <b>Co</b>']],
    ['商机更多操作', ['menu', 'p1', 'Alpha <b>Co</b>']], ['商机阶段：待付尾款', ['move', 'p1', 'balance', 'Alpha <b>Co</b>']], ['商机阶段：输单', ['move', 'p1', 'lost', 'Alpha <b>Co</b>']]]) {
    assert.equal(run(`customerOpportunityFeature(${JSON.stringify(feature)})`), true, feature);
    assert.deepEqual(calls.at(-1), expected, feature);
  }
  run('customerOpportunityFeature("下一个商机")');
  assert.deepEqual([calls.at(-1), run('customerOpportunities(currentName).activeOpportunityIndex')], [['detail', 'Alpha <b>Co</b>', true, ''], 1]);
  run('customerOpportunityFeature("商机更多操作")');
  assert.deepEqual(calls.at(-1), ['menu', 'p2', 'Alpha <b>Co</b>'], 'actions apply to the opportunity currently shown');
  run('customerOpportunityFeature("下一个商机")');
  assert.equal(run('customerOpportunities(currentName).activeOpportunityIndex'), 0, 'wraps around');
  assert.equal(run('customerOpportunityFeature("写邮件")'), false, 'buttons handled elsewhere are not touched');
  sandbox.currentName = 'Beta Ltd';
  assert.equal(run('customerOpportunities(currentName).activeOpportunityIndex'), 0, 'a different customer starts at the first opportunity');
  sandbox.activeRoute = 'mail';
  assert.equal(run('customerOpportunityFeature("添加商机")'), false);
  // 详情页标记：显示当前这个进行中商机，并标出它所在的阶段
  const html = D.render({name: 'Alpha <b>Co</b>', orders: [], history: [], ...O.customerStats(s, 'Alpha <b>Co</b>', TODAY), activeOpportunityIndex: 1}, {escape: escapeHtml});
  assert.match(html, /进行中的商机 （2）/);
  assert.match(html, /<span>26100602-Na&lt;i&gt;omi<\/span>/);
  assert.match(html, /销售金额 <b>USD 100<\/b>/); assert.match(html, /结束日期 <b>2025-12-15<\/b>/);
  assert.match(html, /class="lcd-feature lcd-phase phase-0 is-current" data-feature="商机阶段：未成单"/);
  assert.equal((html.match(/is-current/g) || []).length, 1);
});

test('customer page: 本部门 accounts see (and count) only their department\'s opportunities and orders in the detail, and own their new customers', () => {
  const R = require('../src/role-model.js');
  const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  const body = app.slice(app.indexOf('  const detailOpp = {'), app.indexOf('  function customerOpportunityFeature(')) +
    app.slice(app.indexOf('  function newCustomerOwner() {'), app.indexOf('  function editForm('));
  let s = {...sample(), orders: [{id: 'o1', client: 'Alpha <b>Co</b>', owner: 'Amy'}, {id: 'o2', client: 'Alpha <b>Co</b>', owner: 'Bob'}, {id: 'o3', client: 'Alpha <b>Co</b>', owner: 'Na<i>omi'}]};
  const member = (name) => R.settings(s).members.find((m) => m.name === name);
  s = R.addMember(s, {name: 'Kris', roleId: R.ADMIN});
  s = R.switchTo(s, R.settings(s).members.find((m) => m.name === 'Kris').id);
  for (const name of ['Amy', 'Bob', 'Na<i>omi']) if (!member(name)) s = R.addMember(s, {name, roleId: 'sales'});
  for (const name of ['Amy', 'Bob', 'Na<i>omi']) s = R.setMemberRole(s, member(name).id, 'sales');
  s = R.addDepartment(s, {name: '销售部'});
  const dept = R.deptTree(s).find((d) => d.name === '销售部').id;
  s = R.addDepartment(s, {name: '一组', parentId: dept});
  s = R.setMemberDept(s, member('Amy').id, dept);
  s = R.setMemberDept(s, member('Na<i>omi').id, R.deptTree(s).find((d) => d.name === '一组').id);
  const asAmy = (scope, extra = {}) => {
    const next = R.switchTo(R.updateRole(s, 'sales', {scope}), member('Amy').id);
    return {...next, laiSettings: {...next.laiSettings, ...extra}};
  };
  const sandbox = {state: asAmy('dept', {defaultOwner: 'Bob'}), R, window: {LaiOpportunityModel: O}};
  assert.equal(R.scopeOf(sandbox.state), 'dept');
  vm.createContext(sandbox); vm.runInContext(body, sandbox);
  const run = (code) => vm.runInContext(code, sandbox);
  // Bob is outside the department: his order and his p5 opportunity on Beta stay out; Na<i>omi (sub-department) is in.
  assert.deepEqual(run('detailScopeState().orders.map((o) => o.id)'), ['o1', 'o3']);
  assert.deepEqual(run('customerOpportunities("Alpha <b>Co</b>").activeOpportunities.map((o) => o.id)'), ['p1', 'p2']);
  // New customers: 本人 and 本部门 accounts always own them; company-wide accounts get the 默认跟进人 from settings.
  assert.equal(run('newCustomerOwner()'), 'Amy');
  sandbox.state = asAmy('self', {defaultOwner: 'Bob'});
  assert.deepEqual(run('customerOpportunities("Alpha <b>Co</b>").activeOpportunities.map((o) => o.id)'), ['p1'], '本人 sees only her own');
  assert.deepEqual(run('detailScopeState().orders.map((o) => o.id)'), ['o1']);
  assert.equal(run('newCustomerOwner()'), 'Amy');
  sandbox.state = asAmy('all', {defaultOwner: 'Bob'});
  assert.equal(run('detailScopeState() === state'), true);
  assert.equal(run('newCustomerOwner()'), 'Bob');
});

test('customer editor: ticking 同时新建商机 no longer blocks saving; it opens the opportunity form afterwards', () => {
  const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  assert.doesNotMatch(app, /商机创建待后续实现/);
  assert.match(app, /wantOpportunity = !!fd\.get\("createOpportunity"\);/);
  assert.match(app, /toast\("已保存到来财"\);\s*if \(wantOpportunity && form\.id === "customer-form"\) business\.newOpportunity\(data\.name\.trim\(\)\);/);
  assert.match(app, /if \(d\.feature && customerOpportunityFeature\(d\.feature\)\) return;\s*(\/\/[^\n]*\s*)?if \(d\.feature\) return;/);
});


// ---------------- 销售流程 ----------------
// 两个流程：默认流程，和「样品单」流程（阶段：寄样中 → 已确认(赢单) → 输单）。
function twoFlows() {
  let s = O.addFlow(sample(), {label: '样品单'}, {id: 'fs'});
  s = O.addFlowStage(s, 'fs', {label: '寄样中', kind: 'open'}, {id: 'sending'});
  s = O.addFlowStage(s, 'fs', {label: '已确认', kind: 'won'}, {id: 'confirmed'});
  for (const id of ['open', 'unpaid', 'balance', 'done']) s = O.removeFlowStage(s, 'fs', id);
  s = add(s, 's1', {flow: 'fs', stage: 'sending', amount: '10'});
  return O.moveStage(add(s, 's2', {flow: 'fs', stage: 'sending', amount: '20'}), 's2', 'confirmed', {now: '2026-10-06T06:00:00.000Z'});
}

test('board and analysis show one sales flow at a time; the flow picker appears only when there is a choice', () => {
  const one = ui.boardMarkup(O.board(sample(), {}, TODAY), {}, {today: TODAY});
  assert.doesNotMatch(one, /id="opp-flow"/);
  const s = twoFlows();
  const main = ui.boardMarkup(O.board(s, {}, TODAY), {}, {today: TODAY});
  assert.match(main, /<select id="opp-flow" class="k-select-trigger" aria-label="销售流程"><option value="default" selected>默认销售流程（5）<\/option><option value="fs">样品单（2）<\/option><\/select>/, 'the count is every opportunity in the flow, whatever the currency');
  assert.match(main, /共 <b>4<\/b> 个商机/);
  const sampleBoard = ui.boardMarkup(O.board(s, {flow: 'fs'}, TODAY), {}, {today: TODAY});
  assert.deepEqual([...sampleBoard.matchAll(/<section class="opp-column opp-kind-(\w+)" data-opp-drop="(\w+)"[^>]*><header class="opp-stage"><span class="opp-stage-name"><i class="opp-dot" aria-hidden="true"><\/i>([^<]+)<\/span><span class="opp-stage-count k-badge k-badge--\w+">(\d+)<\/span><span class="opp-stage-amount">([^<]+)</g)].map(m => m.slice(1)),
    [['open', 'sending', '寄样中', '1', 'USD 10'], ['won', 'confirmed', '已确认', '1', 'USD 20'], ['lost', 'lost', '输单', '0', 'USD 0']]);
  assert.match(sampleBoard, /总销售金额<span class="opp-stat-count">2 个<\/span><\/span><b><small>USD<\/small> 30<\/b>/);
  const list = ui.boardMarkup(O.board(s, {flow: 'fs'}, TODAY), {mode: 'list'}, {today: TODAY});
  assert.match(list, /<span class="k-badge k-badge--success">已确认<\/span>/);
  const report = ui.analysisMarkup(O.analysis(s, {flow: 'fs'}, TODAY));
  assert.match(ui.analysisControls(O.analysis(s, {flow: 'fs'}, TODAY)), /<select id="opp-analysis-flow" class="k-select-trigger" aria-label="销售流程"><option value="default">默认销售流程（5）<\/option><option value="fs" selected>样品单（2）<\/option>/);
  assert.deepEqual([...report.matchAll(/<div class="opp-bar opp-kind-(\w+)"><span class="opp-bar-label">([^<]+)<\/span>[\s\S]*?<b class="opp-bar-count">([^<]+)<\/b>/g)].map(m => m.slice(1)), [['open', '寄样中', '1 个 · 50%'], ['won', '已确认', '1 个 · 50%'], ['lost', '输单', '0 个 · 0%']]);
  assert.doesNotMatch(ui.analysisControls(O.analysis(sample(), {}, TODAY)), /opp-analysis-flow/);
});

test('form and menu offer the stages of the opportunity\'s own flow', () => {
  const s = twoFlows(), flows = O.flowsOf(s);
  const form = ui.formMarkup({...O.list(s).find(i => i.id === 's1')}, {flows, stages: O.flowOf(s, 'fs').stages});
  assert.match(form, /<select class="k-select-trigger" name="flow" id="opp-form-flow"><option value="default">默认销售流程<\/option><option value="fs" selected>样品单<\/option><\/select>/);
  assert.match(form, /<select class="k-select-trigger" name="stage" id="opp-form-stage"><option value="sending" selected>寄样中<\/option><option value="confirmed">已确认<\/option><option value="lost">输单<\/option><\/select>/);
  assert.doesNotMatch(form, /type="hidden" name="flow"/);
  assert.match(ui.formMarkup({stage: 'gone'}, {stages: O.flowOf(s, 'fs').stages}), /<option value="gone" selected>原阶段：gone<\/option>/);
  assert.equal(ui.stageOptions(O.flowOf(s, 'fs').stages, ''), '<option value="sending" selected>寄样中</option><option value="confirmed">已确认</option><option value="lost">输单</option>');
  const menu = ui.menuMarkup(O.cardOf(s, 's2', TODAY));
  assert.deepEqual([...menu.matchAll(/data-opp-action="move" data-id="s2" data-stage="(\w+)"><i class="opp-dot" aria-hidden="true"><\/i>移到「([^」]+)」/g)].map(m => [m[1], m[2]]), [['sending', '寄样中'], ['lost', '输单']]);
  assert.match(menu, /<span class="k-badge k-badge--success">已确认<\/span>/); assert.match(menu, /data-opp-action="order" data-id="s2">生成订单/);
  const detail = require('../src/customer-detail-ui.js');
  assert.deepEqual(O.customerStats(s, 'Alpha <b>Co</b>', TODAY).activeOpportunities.map(c => [c.id, c.stages.map(st => st.label).join('>')]), [['p1', '未成单>付款未到账>待付尾款>已完成>输单'], ['p2', '未成单>付款未到账>待付尾款>已完成>输单'], ['s1', '寄样中>已确认>输单']]);
  // 客户详情页的阶段条：用当前这个商机所在流程的阶段，并标出它所在的那一个
  const strip = index => [...detail.render({name: 'Alpha <b>Co</b>', orders: [], history: [], ...O.customerStats(s, 'Alpha <b>Co</b>', TODAY), activeOpportunityIndex: index}, {escape: escapeHtml}).matchAll(/class="lcd-feature lcd-phase phase-\d( is-current)?" data-feature="商机阶段：([^"]+)"/g)].map(m => m[2] + (m[1] ? '*' : ''));
  assert.deepEqual(strip(2), ['寄样中*', '已确认', '输单']);
  assert.deepEqual(strip(0), ['未成单*', '付款未到账', '待付尾款', '已完成', '输单']);
});

test('流程设置页: flows on the left, stages grouped by kind with usage, and the right buttons', () => {
  const s = twoFlows();
  const html = ui.flowsMarkup(O.flowSummary(s), {flow: 'default'});
  assert.deepEqual([...html.matchAll(/data-flow-select="(\w+)" aria-pressed="(\w+)"><span>([^<]+)<\/span><small>([^<]+)<\/small>/g)].map(m => m.slice(1)), [['default', 'true', '默认销售流程', '5 个阶段 · 5 个商机'], ['fs', 'false', '样品单', '3 个阶段 · 2 个商机']]);
  assert.deepEqual([...html.matchAll(/data-stage-rename="(\w+)" data-flow="default" value="([^"]+)"[^>]*><span class="opp-stage-usage">(\d+) 个商机/g)].map(m => m.slice(1)), [['open', '未成单', '3'], ['unpaid', '付款未到账', '0'], ['balance', '待付尾款', '0'], ['done', '已完成', '1'], ['lost', '输单', '1']]);
  assert.match(html, /默认流程不能删除/); assert.doesNotMatch(html, /data-flow-action="flow-remove"/);
  assert.match(html, /data-flow-action="stage-up" data-flow="default" data-stage="open"[^>]* disabled>/, 'first of its kind cannot move up');
  assert.match(html, /data-flow-action="stage-down" data-flow="default" data-stage="unpaid"[^>]* disabled>/);
  assert.doesNotMatch(html, /data-flow-action="stage-(up|down|remove)" data-flow="default" data-stage="lost"/, 'the lost stage is fixed');
  assert.match(html, /<form class="opp-stage-add" id="opp-stage-add-open" data-flow="default" data-kind="open">/); assert.match(html, /id="opp-stage-add-won"/); assert.doesNotMatch(html, /opp-stage-add-lost/);
  const other = ui.flowsMarkup(O.flowSummary(s), {flow: 'fs', armed: 'stage:sending'});
  assert.match(other, /data-flow-rename="fs" value="样品单"/);
  assert.match(other, /data-flow-action="flow-remove" data-flow="fs" disabled title="还有 2 个商机在用这个流程">删除这个流程/);
  assert.match(other, /data-flow-action="stage-remove" data-flow="fs" data-stage="sending" disabled title="至少保留一个进行中阶段"/, 'the only open stage cannot be removed');
  const empty = ui.flowsMarkup(O.flowSummary(O.addFlow(sample(), {label: 'X<b>'}, {id: 'fx'})), {flow: 'fx', armed: 'flow:fx'});
  assert.match(empty, /class="team-danger" data-flow-action="flow-remove" data-flow="fx">再点一次确认删除/); assert.doesNotMatch(empty, /X<b>/);
  assert.match(ui.flowsMarkup(O.flowSummary(s), {flow: 'default', armed: 'stage:unpaid'}), /class="text-button team-danger" data-flow-action="stage-remove" data-flow="default" data-stage="unpaid" aria-label="再点一次确认删除：付款未到账">再点一次确认删除/);
  assert.match(ui.flowsMarkup(O.flowSummary(s), {flow: 'nope'}), /data-flow-select="default" aria-pressed="true"/, 'an unknown flow falls back to the first');
  const flow = O.flowSummary(s)[0];
  const ask = ui.stageRemoveMarkup(flow, flow.stages[0]);
  assert.match(ask, /「未成单」里还有 3 个商机/);
  assert.deepEqual([...ask.matchAll(/<option value="(\w+)">/g)].map(m => m[1]), ['unpaid', 'balance', 'done'], 'never offers the stage itself or the lost stage');
});

test('controller: flow settings save each action, confirm deletions, and the board and form follow', async () => {
  const c = controller(sample());
  c.page.navigate('opp-flows');
  assert.match(c.mounted.at(-1), /<h1>商机设置<\/h1>/);
  await c.submit('opp-stage-add-open', {label: '已报价'}, {flow: 'default', kind: 'open'});
  assert.deepEqual(O.flowOf(c.state(), 'default').stages.map(st => st.label), ['未成单', '付款未到账', '已报价', '待付尾款', '已完成', '输单']);
  const quoted = O.flowOf(c.state(), 'default').stages[2].id;
  await c.click({flowAction: 'stage-up', flow: 'default', stage: quoted});
  assert.deepEqual(O.flowOf(c.state(), 'default').stages.map(st => st.label).slice(0, 3), ['未成单', '已报价', '付款未到账']);
  c.change({dataset: {stageRename: 'unpaid', flow: 'default'}, value: ' 等待付款 '}); await new Promise(r => setTimeout(r));
  assert.equal(O.flowOf(c.state(), 'default').stages[2].label, '等待付款');
  await c.submit('opp-stage-add-won', {label: '已完成'}, {flow: 'default', kind: 'won'});
  assert.equal(c.errors['opp-flow-error'].textContent, '这个流程里已经有同名的阶段');
  // 删除空阶段：点两次
  await c.click({flowAction: 'stage-remove', flow: 'default', stage: quoted});
  assert.ok(O.flowOf(c.state(), 'default').stages.some(st => st.id === quoted), 'first click only arms');
  assert.match(c.mounted.at(-1), /再点一次确认删除/);
  await c.click({flowAction: 'stage-remove', flow: 'default', stage: quoted});
  assert.ok(!O.flowOf(c.state(), 'default').stages.some(st => st.id === quoted));
  // 删除有商机的阶段：先问移到哪里
  await c.click({flowAction: 'stage-remove', flow: 'default', stage: 'open'});
  assert.equal(c.dialogs.at(-1)[0], '删除阶段'); assert.match(c.dialogs.at(-1)[1], /里还有 3 个商机/);
  await c.submit('opp-stage-remove-form', {moveTo: ''}, {flow: 'default', stage: 'open'});
  assert.match(c.errors['opp-stage-remove-error'].textContent, /请先选择把它们移到哪个阶段/);
  await c.submit('opp-stage-remove-form', {moveTo: 'unpaid'}, {flow: 'default', stage: 'open'});
  assert.deepEqual(O.list(c.state()).filter(i => i.currency === 'USD').map(i => i.stage).sort(), ['done', 'lost', 'unpaid', 'unpaid']);
  assert.deepEqual(O.flowOf(c.state(), 'default').stages.map(st => st.id), ['unpaid', 'balance', 'done', 'lost']);
  // 新建流程、改名、删除
  await c.submit('opp-flow-add', {label: '样品单', copyFrom: 'default'});
  assert.deepEqual(O.flowsOf(c.state()).map(f => [f.id, f.label, f.stages.length]), [['default', '默认销售流程', 4], ['fnew-id', '样品单', 4]]);
  assert.match(c.mounted.at(-1), /data-flow-select="fnew-id" aria-pressed="true"/, 'the new flow is shown right away');
  c.change({dataset: {flowRename: 'fnew-id'}, value: '样品流程'}); await new Promise(r => setTimeout(r));
  assert.equal(O.flowOf(c.state(), 'fnew-id').label, '样品流程');
  // 看板切到新流程；新建商机默认落在这个流程的第一个阶段
  c.page.navigate('opportunities');
  c.change({id: 'opp-flow', value: 'fnew-id'});
  assert.match(c.mounted.at(-1), /<option value="fnew-id" selected>样品流程（0）/); assert.match(c.mounted.at(-1), /共 <b>0<\/b> 个商机/);
  await c.click({oppAction: 'new'});
  assert.match(c.dialogs.at(-1)[1], /<option value="fnew-id" selected>样品流程<\/option>/);
  const f = c.fakeForm({flow: 'default', stage: 'unpaid'});
  f.flow.value = 'default'; c.change({name: 'flow', inForm: true});
  assert.match(f.stage.innerHTML, /^<option value="unpaid" selected>等待付款<\/option>/);
  assert.equal(f.stage.value, 'unpaid');
  // 编辑一个处在「已完成」的商机：换到别的流程再换回来，阶段回到原来的「已完成」，而不是落到第一个阶段
  await c.click({oppAction: 'edit', id: 'p3'});
  const g = c.fakeForm({flow: 'default', stage: 'done'});
  g.flow.value = 'fnew-id'; c.change({name: 'flow', inForm: true});
  assert.equal(g.stage.value, 'unpaid', 'another flow: its first stage');
  g.flow.value = 'default'; c.change({name: 'flow', inForm: true});
  assert.equal(g.stage.value, 'done', 'back to the original flow: the original stage');
  assert.match(g.stage.innerHTML, /<option value="done" selected>已完成<\/option>/);
  c.page.discardDraft();
  await c.click({oppAction: 'new'});
  await c.submit('opp-form', {...valid, flow: 'fnew-id', stage: 'unpaid'});
  assert.equal(O.list(c.state()).find(i => i.id === 'new-id').flow, 'fnew-id');
  c.page.navigate('opp-flows');
  await c.click({flowSelect: 'fnew-id'});
  await c.click({flowAction: 'flow-remove', flow: 'fnew-id'}); await c.click({flowAction: 'flow-remove', flow: 'fnew-id'});
  assert.match(c.errors['opp-flow-error'].textContent, /里还有 1 个商机/);
  assert.equal(O.flowsOf(c.state()).length, 2);
  // 页面外的点击不触发流程操作
  c.page.navigate('opportunities');
  await c.click({flowAction: 'flow-remove', flow: 'fnew-id'});
  assert.equal(O.flowsOf(c.state()).length, 2);
});


test('review fixes: matches in other flows are announced, a customer\'s board opens on the fullest flow, armed deletes do not survive leaving the page', async () => {
  const s = twoFlows();
  const main = ui.boardMarkup(O.board(s, {}, TODAY), {}, {today: TODAY});
  assert.match(main, /另有 2 个符合当前筛选的商机在其他销售流程里（样品单 2 个），在左上角切换流程查看。/);
  assert.doesNotMatch(ui.boardMarkup(O.board(sample(), {}, TODAY), {}, {today: TODAY}), /其他销售流程/);
  // Beta Ltd 只有一个商机（EUR，默认流程）；Alpha 在默认流程 4 个、样品单 2 个 → 再给样品单加 3 个，样品单变成最多
  let more = s;
  for (const id of ['s3', 's4', 's5']) more = add(more, id, {flow: 'fs', stage: 'sending'});
  const c = controller(more);
  c.page.showOpportunities('Alpha <b>Co</b>');
  c.page.navigate('opportunities');
  assert.match(c.mounted.at(-1), /<option value="fs" selected>样品单（5）/, 'opens the flow where this customer has most opportunities');
  assert.match(c.mounted.at(-1), /另有 4 个符合当前筛选的商机在其他销售流程里（默认销售流程 4 个）/);
  // 流程设置页：点了一次删除后离开，再回来不应该还停在“再点一次确认”
  const d = controller(O.addFlow(sample(), {label: '空流程'}, {id: 'fe'}));
  d.page.navigate('opp-flows');
  await d.click({flowSelect: 'fe'}); await d.click({flowAction: 'flow-remove', flow: 'fe'});
  assert.match(d.mounted.at(-1), /再点一次确认删除/);
  d.page.navigate('opportunities'); d.page.navigate('opp-flows');
  assert.doesNotMatch(d.mounted.at(-1), /再点一次确认删除/);
  await d.click({flowAction: 'flow-remove', flow: 'fe'});
  assert.equal(O.flowsOf(d.state()).length, 2, 'one click after coming back only arms again');
  // 改名失败：输入框恢复成已保存的名称
  const input = {dataset: {stageRename: 'unpaid', flow: 'default'}, value: '未成单'};
  listenersChange(d, input); await new Promise(r => setTimeout(r));
  assert.equal(d.errors['opp-flow-error'].textContent, '这个流程里已经有同名的阶段');
  assert.equal(input.value, '付款未到账');
  // 表单：原流程读不到的商机，表单里显示为默认流程并选中
  const lostLink = {...more, laiOpportunities: more.laiOpportunities.map(i => i.id === 'p1' ? {...i, flow: 'gone'} : i)};
  const e = controller(lostLink);
  e.page.navigate('opportunities');
  await e.click({oppAction: 'edit', id: 'p1'});
  assert.match(e.dialogs.at(-1)[1], /<select class="k-select-trigger" name="flow" id="opp-form-flow"><option value="default" selected>默认销售流程<\/option>/);
});

// ---------------- 附件、详情、拖动改进 ----------------
const flush = () => new Promise(resolve => setImmediate(resolve));
const okResponse = body => ({ok: true, status: 200, json: async () => body});
const failResponse = (status, body) => ({ok: false, status, json: async () => body});
function fileCtx({uploadFail = [], deleteFail = false} = {}) {
  const calls = [];
  let counter = 0;
  return {calls,
    request: async (path, payload) => { calls.push([path, payload]); if (path.endsWith('/delete') && deleteFail) return failResponse(500, {ok: false, message: 'boom'}); return okResponse(path.endsWith('/save') ? {ok: true, filename: payload.name} : {ok: true, removed: 1}); },
    upload: async (path, file) => {
      calls.push([path, file.name]);
      if (uploadFail.includes(file.name)) return failResponse(413, {ok: false, message: `「${file.name}」超过 20 MB，请压缩后再传`});
      counter += 1;
      return okResponse({ok: true, file: {name: file.name, size: file.size, type: file.type, fileUrl: `/attachments/opportunities/p1/aa${String(counter).padStart(8, '0')}-${encodeURIComponent(file.name)}`}});
    }};
}
const plain = (name, size = 100, type = 'text/plain') => ({name, size, type});
const withAttachments = (state, id, files) => O.addAttachments(state, id, files.map((file, index) => ({id: 'att' + index, ...file})), {now: '2026-10-07T01:00:00.000Z'});
const FILES = [{name: '报价单.pdf', size: 2048, type: 'application/pdf', fileUrl: '/attachments/opportunities/p1/aa00000001-q.pdf'}, {name: '样品<b>.png', size: 5 * 1024 * 1024, type: 'image/png', fileUrl: '/attachments/opportunities/p1/aa00000002-s.png'}];

test('cards show a clip with the count and open the detail; detail markup lists facts, history and attachments (escaped)', () => {
  const s = withAttachments(sample(), 'p1', FILES);
  const board = O.board(s, {}, TODAY);
  const html = ui.boardMarkup(board, {}, {today: TODAY});
  assert.match(html, /class="opp-card-amount"><span><small>USD<\/small>331\.74<\/span><span class="opp-clip" title="2 个附件" aria-label="2 个附件"><svg[^>]*>.*<\/svg>2<\/span>/);
  assert.equal((html.match(/class="opp-clip"/g) || []).length, 1, 'only cards with attachments get one');
  assert.match(html, /data-opp-action="detail" data-id="p1">/);
  assert.doesNotMatch(html, /class="opp-card-name" data-opp-action="edit"/);
  assert.match(ui.boardMarkup(board, {mode: 'list'}, {today: TODAY}), /data-opp-action="detail"/);
  const detail = ui.detailMarkup(O.detailOf(s, 'p1', TODAY), {today: TODAY}, {});
  assert.match(detail, /<dt>客户<\/dt><dd><button type="button" class="company-link" data-biz-customer="Alpha &lt;b&gt;Co&lt;\/b&gt;">/);
  assert.match(detail, /<span class="k-badge k-badge--danger">已逾期<\/span>/);
  assert.match(detail, /<div class="form-section">阶段记录<\/div><ol class="opp-history"><li class="opp-kind-open is-current">/);
  assert.match(detail, /<span class="opp-attach-count k-badge k-badge--neutral">2 \/ 30<\/span>/);
  assert.match(detail, /data-attach-action="save" data-att="att0"[^>]*>保存到「下载」/);
  assert.match(detail, /样品&lt;b&gt;\.png/); assert.doesNotMatch(detail, /样品<b>/);
  assert.match(detail, /5\.0 MB · \d{4}-\d{2}-\d{2} \d{2}:\d{2}/); assert.match(detail, /2\.0 KB/);
  assert.match(detail, /<span class="opp-file-ext" aria-hidden="true">PNG<\/span>/);
  assert.equal((detail.match(/data-attach-action="preview"[^>]*>预览/g) || []).length, 1, 'only the image can be previewed');
  assert.doesNotMatch(detail, /关联产品|<dt>备注|关联订单/, 'empty facts are left out');
  // 状态：改名、确认删除、预览、已满、上传中
  const inner = view => ui.attachmentsInner(O.detailOf(s, 'p1', TODAY).attachments, view);
  assert.match(inner({renaming: 'att0'}), /<form class="opp-file-rename" id="opp-attach-rename" data-att="att0"><input class="k-input" name="name" value="报价单\.pdf"/);
  assert.match(inner({armed: 'att1'}), /team-danger" data-attach-action="delete" data-att="att1"[^>]*>再点一次确认删除/);
  assert.match(inner({preview: 'att1'}), /<figure class="opp-preview"><img data-opp-fetch="\/attachments\/opportunities\/p1\/aa00000002-s\.png" alt="样品&lt;b&gt;\.png">/);
  assert.match(inner({preview: 'att1'}), /关闭预览/);
  assert.doesNotMatch(inner({preview: 'att0'}), /opp-preview/, 'a pdf has no preview');
  assert.match(inner({busy: true}), /id="opp-attach-input" multiple hidden disabled/);
  let full = O.addAttachments(sample(), 'p1', Array.from({length: 30}, (_, i) => ({id: 'f' + i, ...FILES[0]})));
  assert.match(ui.attachmentsInner(O.detailOf(full, 'p1', TODAY).attachments, {}), /is-full[^>]*>.*已达到 30 个附件的上限/);
  assert.doesNotMatch(ui.attachmentsInner([], {}), /还没有附件/, 'the drop zone already says what goes here');
  assert.match(ui.attachmentsInner([], {}), /报价单、合同、样品图拖到这里/);
  assert.match(U.create(escapeHtml, O, key => key !== 'opp.edit').attachmentsInner([], {}), /<p class="k-empty opp-files-none">还没有附件。<\/p>/, 'without the drop zone the empty list says so');
  assert.equal(ui.fileSize(0), '0 B'); assert.equal(ui.fileSize(1536), '1.5 KB'); assert.equal(ui.fileSize(20 * 1024 * 1024), '20.0 MB');
  assert.equal(ui.stamp(''), '—'); assert.equal(ui.stamp('2026-10-07T01:05:00.000Z'), '2026-10-07 09:05');
});

test('controller: the detail drawer opens from a card name or its blank area, and offers edit and more actions', async () => {
  const c = controller(withAttachments(sample(), 'p1', FILES));
  c.page.navigate('opportunities');
  await c.click({oppAction: 'detail', id: 'p1'});
  const [title, body, footer, type] = c.dialogs.at(-1);
  assert.deepEqual([title, type], ['Alpha &lt;b&gt;Co&lt;/b&gt;', 'opp-detail'], 'the drawer title is the customer; the opportunity name is the first line of the body');
  assert.match(body, /class="drawer-body opp-detail" data-id="p1"/);
  assert.match(footer, /data-opp-action="menu" data-id="p1">更多操作<\/button><button class="k-btn k-btn--primary" type="button" data-opp-action="edit" data-id="p1">编辑商机/);
  await c.click({oppAction: 'edit', id: 'p1'});
  assert.equal(c.dialogs.at(-1)[0], '编辑商机');
  c.page.discardDraft();
  // 点卡片空白处
  const blank = {closest: sel => sel === '.opp-card' ? {dataset: {oppId: 'p2'}} : null};
  await c.clickAt(blank);
  assert.equal(c.dialogs.at(-1)[3], 'opp-detail'); assert.match(c.dialogs.at(-1)[1], /data-id="p2"/);
  // 点卡片里的按钮、链接不会误开详情
  const count = c.dialogs.length;
  await c.clickAt({closest: sel => /button/.test(sel) && sel !== 'button' ? {} : sel === '.opp-card' ? {dataset: {oppId: 'p2'}} : null});
  assert.equal(c.dialogs.length, count);
  await c.click({oppAction: 'detail', id: 'ghost'});
  assert.match(c.toasts.at(-1), /商机不存在/);
});

test('controller: uploading files stores them, saves their details with the opportunity and refreshes the drawer', async () => {
  const io = fileCtx();
  const c = controller(sample(), null, io);
  c.page.navigate('opportunities');
  await c.click({oppAction: 'detail', id: 'p1'});
  const input = {id: 'opp-attach-input', files: [plain('合同.pdf', 3000, 'application/pdf'), plain('图.png', 500, 'image/png')], value: 'C:\\fakepath\\x', closest: () => null};
  await c.change2({target: input}); await flush();
  assert.equal(input.value, '', 'the file input is cleared so the same file can be chosen again');
  const saved = O.attachmentsOf(O.list(c.state()).find(i => i.id === 'p1'));
  assert.deepEqual(saved.map(a => [a.name, a.size, a.type]), [['合同.pdf', 3000, 'application/pdf'], ['图.png', 500, 'image/png']]);
  assert.ok(saved.every(a => a.fileUrl.startsWith('/attachments/opportunities/p1/') && a.uploadedAt));
  assert.deepEqual(io.calls.map(call => call[0].split('?')[0]), ['/api/opportunity-file/upload', '/api/opportunity-file/upload']);
  assert.match(io.calls[0][0], /\?id=p1&name=%E5%90%88%E5%90%8C\.pdf&type=application%2Fpdf$/);
  assert.match(c.mounted.at(-1), /class="opp-clip" title="2 个附件"/, 'the board behind the drawer shows the clip');
  assert.equal(c.errors['opp-attach-error'].textContent, '');
  assert.equal(c.page.hasDraft(), false);
});

test('controller: files that are not allowed are refused before upload, the rest still go through', async () => {
  const io = fileCtx({uploadFail: ['big.zip']});
  const c = controller(sample(), null, io);
  c.page.navigate('opportunities');
  await c.click({oppAction: 'detail', id: 'p1'});
  await c.change2({target: {id: 'opp-attach-input', value: '', closest: () => null, files: [plain('安装.exe'), plain('空.txt', 0), plain('大.dat', 20 * 1024 * 1024 + 1), plain('big.zip', 10), plain('好.txt', 10)]}}); await flush();
  assert.deepEqual(io.calls.map(call => call[1]), ['big.zip', '好.txt'], 'blocked, empty and oversize files never reach the server');
  assert.deepEqual(O.attachmentsOf(O.list(c.state()).find(i => i.id === 'p1')).map(a => a.name), ['好.txt']);
  const message = c.errors['opp-attach-error'].textContent;
  assert.match(message, /「安装\.exe」是可执行或安装类文件/); assert.match(message, /「空\.txt」是空文件/); assert.match(message, /「大\.dat」超过 20 MB/); assert.match(message, /「big\.zip」超过 20 MB/);
  assert.doesNotMatch(message, /好\.txt/);
  // 只选了不合格的文件：什么也不上传、不保存
  const callsBefore = io.calls.length, saved = c.state();
  await c.change2({target: {id: 'opp-attach-input', value: '', closest: () => null, files: [plain('a.sh')]}}); await flush();
  assert.equal(io.calls.length, callsBefore); assert.equal(c.state(), saved);
});

test('controller: the 30-file limit counts what is already there and says how many were left out', async () => {
  const io = fileCtx();
  const start = O.addAttachments(sample(), 'p1', Array.from({length: 28}, (_, i) => ({id: 'f' + i, ...FILES[0]})));
  const c = controller(start, null, io);
  c.page.navigate('opportunities');
  await c.click({oppAction: 'detail', id: 'p1'});
  await c.change2({target: {id: 'opp-attach-input', value: '', closest: () => null, files: [plain('1.txt'), plain('2.txt'), plain('3.txt'), plain('4.txt')]}}); await flush();
  assert.equal(io.calls.length, 2); assert.equal(O.attachmentsOf(O.list(c.state()).find(i => i.id === 'p1')).length, 30);
  assert.match(c.errors['opp-attach-error'].textContent, /最多 30 个附件，还能再添加 2 个，其余 2 个没有上传/);
});

test('controller: when saving fails the uploaded files are deleted again; a failed delete does not break anything', async () => {
  const io = fileCtx();
  const c = controller(sample(), '保存失败了', io);
  c.page.navigate('opportunities');
  await c.click({oppAction: 'detail', id: 'p1'});
  await c.change2({target: {id: 'opp-attach-input', value: '', closest: () => null, files: [plain('a.txt'), plain('b.txt')]}}); await flush();
  assert.equal(c.errors['opp-attach-error'].textContent, '保存失败了');
  const deletion = io.calls.find(call => call[0] === '/api/opportunity-file/delete');
  assert.equal(deletion[1].fileUrls.length, 2, 'both stored files are removed');
  assert.deepEqual(O.attachmentsOf(O.list(c.state()).find(i => i.id === 'p1')), []);
  const flaky = fileCtx({deleteFail: true}), d = controller(sample(), '保存失败了', flaky);
  d.page.navigate('opportunities'); await d.click({oppAction: 'detail', id: 'p1'});
  await d.change2({target: {id: 'opp-attach-input', value: '', closest: () => null, files: [plain('a.txt')]}}); await flush();
  assert.equal(d.errors['opp-attach-error'].textContent, '保存失败了');
});

test('controller: no upload service means a clear message, not a crash', async () => {
  const c = controller(sample());
  c.page.navigate('opportunities');
  await c.click({oppAction: 'detail', id: 'p1'});
  await c.change2({target: {id: 'opp-attach-input', value: '', closest: () => null, files: [plain('a.txt')]}}); await flush();
  assert.match(c.errors['opp-attach-error'].textContent, /不能上传附件/);
});

test('controller: rename, save-a-copy and two-click delete of an attachment', async () => {
  const io = fileCtx();
  const c = controller(withAttachments(sample(), 'p1', FILES), null, io);
  c.page.navigate('opportunities');
  await c.click({oppAction: 'detail', id: 'p1'});
  const att = id => O.attachmentsOf(O.list(c.state()).find(i => i.id === 'p1')).find(a => a.id === id);
  await c.click({attachAction: 'rename', att: 'att0'});
  await c.submit('opp-attach-rename', {name: '  合同 终版.pdf '}, {att: 'att0'}); await flush();
  assert.equal(att('att0').name, '合同 终版.pdf'); assert.equal(att('att0').fileUrl, FILES[0].fileUrl);
  await c.submit('opp-attach-rename', {name: 'x.exe'}, {att: 'att0'}); await flush();
  assert.match(c.errors['opp-attach-error'].textContent, /可执行或安装类文件/); assert.equal(att('att0').name, '合同 终版.pdf');
  await c.click({attachAction: 'save', att: 'att0'}); await flush();
  assert.equal(JSON.stringify(io.calls.at(-1)), JSON.stringify(['/api/opportunity-file/save', {fileUrl: FILES[0].fileUrl, name: '合同 终版.pdf'}]));
  assert.match(c.toasts.at(-1), /已保存到「下载」：合同 终版\.pdf/);
  // 删除：第一次只是确认，第二次才删，并删除文件
  await c.click({attachAction: 'delete', att: 'att1'});
  assert.ok(att('att1'), 'first click only arms'); assert.equal(io.calls.filter(call => call[0].endsWith('/delete')).length, 0);
  await c.click({attachAction: 'rename', att: 'att0'});
  await c.click({attachAction: 'delete', att: 'att1'});
  assert.ok(att('att1'), 'another action in between disarms it');
  await c.click({attachAction: 'delete', att: 'att1'}); await c.click({attachAction: 'delete', att: 'att1'}); await flush();
  assert.equal(att('att1'), undefined);
  assert.equal(JSON.stringify(io.calls.at(-1)), JSON.stringify(['/api/opportunity-file/delete', {fileUrls: [FILES[1].fileUrl]}]));
  await c.click({attachAction: 'delete', att: 'ghost'});
  assert.match(c.errors['opp-attach-error'].textContent, /附件不存在/);
});

test('controller: deleting an opportunity removes its files; archiving does not', async () => {
  const io = fileCtx();
  const c = controller(withAttachments(sample(), 'p1', FILES), null, io);
  c.page.navigate('opportunities');
  await c.click({oppAction: 'archive', id: 'p1', archived: '1'}); await flush();
  assert.equal(io.calls.length, 0);
  await c.click({oppAction: 'delete', id: 'p1'}); await c.click({oppAction: 'delete', id: 'p1'}); await flush();
  assert.equal(O.list(c.state()).find(i => i.id === 'p1'), undefined);
  assert.equal(JSON.stringify(io.calls.at(-1)), JSON.stringify(['/api/opportunity-file/delete', {fileUrls: FILES.map(f => f.fileUrl)}]));
  // 删除没保存成功时文件保留
  const kept = fileCtx(), d = controller(withAttachments(sample(), 'p1', FILES), '不行', kept);
  d.page.navigate('opportunities');
  await d.click({oppAction: 'delete', id: 'p1'}); await d.click({oppAction: 'delete', id: 'p1'}); await flush();
  assert.equal(kept.calls.length, 0);
});

const dragColumn = (stage, cards = []) => {
  const column = {dataset: {oppDrop: stage}, classList: {add() {}, remove() {}}, querySelectorAll: () => cards.map(([id, top, bottom]) => ({dataset: {oppId: id}, getBoundingClientRect: () => ({top, bottom})}))};
  return {closest: sel => sel === '[data-opp-drop]' ? column : null};
};
const cardEl = id => ({closest: sel => sel === '[data-opp-id]' ? {dataset: {oppId: id}} : null});
const inColumn = (state, stage) => O.board(state, {sort: 'manual'}, TODAY).columns.find(column => column.id === stage).cards.map(card => card.id);

test('controller: manual sort lets a card be dropped between others, and the move can be undone', async () => {
  let s = base;
  for (const [index, id] of ['m1', 'm2', 'm3'].entries()) s = add(s, id, {amount: String(100 + index)}, `2026-10-0${index + 1}T04:00:00.000Z`);
  const c = controller(s);
  c.page.navigate('opportunities');
  // 不是手动排序：同一列里拖动只提示，不保存
  c.drag('dragstart', cardEl('m1'));
  const same = c.state();
  c.drag('drop', dragColumn('open', [['m3', 0, 100], ['m2', 110, 210]]), {clientY: 50}); await flush();
  assert.equal(c.state(), same); assert.match(c.toasts.at(-1), /当前不是「手动排序」/);
  // 手动排序
  c.change({id: 'opp-sort', value: 'manual'});
  assert.match(c.mounted.at(-1), /<option value="manual" selected>手动排序/);
  assert.deepEqual(inColumn(c.state(), 'open'), ['m3', 'm2', 'm1']);
  c.drag('dragstart', cardEl('m1'));
  assert.equal(c.drag('dragover', dragColumn('open', [['m3', 0, 100], ['m2', 110, 210]]), {clientY: 20}), true);
  c.drag('drop', dragColumn('open', [['m3', 0, 100], ['m2', 110, 210]]), {clientY: 20}); await flush();
  assert.deepEqual(inColumn(c.state(), 'open'), ['m1', 'm3', 'm2'], 'dropped above the first card');
  // 撤销放在唯一的提示条里：提示「已调整…的位置」，带「撤销」按钮；页面里不再画单独的撤销条。
  assert.match(c.toasts.at(-1), /^已调整「[^」]+」的位置$/);
  assert.equal(c.undoOffer().label, '撤销');
  assert.doesNotMatch(c.mounted.at(-1), /opp-undo|data-opp-action="undo"/);
  // 撤销：回到原来的样子
  await c.undoOffer().run(); await flush();
  assert.equal(c.state(), s, 'the very same state comes back');
  assert.equal(c.toasts.at(-1), '已撤销'); assert.equal(c.toastOptions.at(-1), null, 'the follow-up toast has no button');
  // 放到下面：y 在所有卡片中点之后 = 放到最后
  c.drag('dragstart', cardEl('m3'));
  c.drag('drop', dragColumn('open', [['m2', 0, 100], ['m1', 110, 210]]), {clientY: 500}); await flush();
  assert.deepEqual(inColumn(c.state(), 'open'), ['m2', 'm1', 'm3']);
  // 跨列拖动：换阶段，并放在指定位置；撤销后阶段也回来
  const beforeMove = c.state();
  c.drag('dragstart', cardEl('m2'));
  c.drag('drop', dragColumn('unpaid', []), {clientY: 10}); await flush();
  assert.equal(O.list(c.state()).find(i => i.id === 'm2').stage, 'unpaid');
  assert.equal(c.toasts.at(-1), '已移到「付款未到账」');
  await c.undoOffer().run(); await flush();
  assert.equal(c.state(), beforeMove);
});

test('controller: undo is refused once something else changed, and disappears when leaving the page', async () => {
  let s = add(add(base, 'm1'), 'm2', {}, '2026-10-07T04:00:00.000Z');
  const c = controller(s);
  c.page.navigate('opportunities');
  c.drag('dragstart', cardEl('m1')); c.drag('drop', dragColumn('unpaid', []), {clientY: 1}); await flush();
  const first = c.undoOffer();
  assert.ok(first, 'the move offers 撤销 in the toast');
  c.replaceState(O.setArchived(c.state(), 'm2', true));      // 之后有了别的修改（也可能来自另一个窗口）
  const changed = c.state();
  await first.run(); await flush();
  assert.equal(c.state(), changed); assert.match(c.toasts.at(-1), /已有新的修改，不能撤销/);
  c.drag('dragstart', cardEl('m2')); c.drag('drop', dragColumn('balance', []), {clientY: 1}); await flush();
  const second = c.undoOffer();
  assert.equal(c.toasts.at(-1), '已移到「待付尾款」');
  c.page.navigate('analysis');
  assert.equal(c.dismissed.at(-1), '已移到「待付尾款」', 'leaving the page takes the undo toast away');
  c.page.navigate('opportunities');
  await second.run(); await flush();
  assert.equal(O.list(c.state()).find(i => i.id === 'm2').stage, 'balance', 'nothing to undo any more');
});

test('controller: keyboard moves a focused card between stages and, in manual sort, within its column', async () => {
  let s = base;
  for (const [index, id] of ['m1', 'm2', 'm3'].entries()) s = add(s, id, {}, `2026-10-0${index + 1}T04:00:00.000Z`);
  const c = controller(s);
  c.page.navigate('opportunities');
  const stage = id => O.list(c.state()).find(i => i.id === id).stage;
  const cards = ids => ids.map(id => ({dataset: {oppId: id}}));
  let card;
  const press = async (id, props, siblings = [], columnStage = 'open') => {
    const list = cards(siblings.length ? siblings : [id]);
    card = {dataset: {oppId: id}, parentElement: {querySelectorAll: () => list}, closest: sel => sel === '[data-opp-drop]' ? {dataset: {oppDrop: columnStage}} : null};
    list[Math.max(0, siblings.indexOf(id))] = card;
    return c.key({closest: sel => sel === '.opp-card' ? card : null}, props);
  };
  assert.equal(await press('m1', {key: 'ArrowRight'}), true);
  await flush(); assert.equal(stage('m1'), 'unpaid');
  assert.equal(await press('m1', {key: 'ArrowLeft'}), true); await flush(); assert.equal(stage('m1'), 'open');
  assert.equal(await press('m1', {key: 'ArrowLeft'}), true); await flush(); assert.equal(stage('m1'), 'open', 'already in the first column');
  for (let i = 0; i < 4; i++) { await press('m1', {key: 'ArrowRight'}); await flush(); }
  assert.equal(stage('m1'), 'done', 'the last step stops at the reason form instead of moving');
  assert.equal(c.dialogs.at(-1)[3], 'opp-lost', 'moving into 输单 asks for a reason');
  // 修饰键、输入框、不在卡片上：不处理
  assert.equal(await press('m2', {key: 'ArrowRight', metaKey: true}), false);
  assert.equal(await press('m2', {key: 'ArrowUp'}), false, 'plain up/down belongs to scrolling');
  assert.equal(await press('m2', {key: 'Enter'}), false);
  assert.equal(await c.key({closest: () => null}, {key: 'ArrowRight'}), false);
  assert.equal(await c.key({closest: sel => sel === 'input,select,textarea,[contenteditable]' ? {} : sel === '.opp-card' ? card : null}, {key: 'ArrowRight'}), false);
  // Alt+上下：非手动排序时只提示
  const before = c.state();
  assert.equal(await press('m2', {key: 'ArrowUp', altKey: true}, ['m3', 'm2']), true); await flush();
  assert.equal(c.state(), before); assert.match(c.toasts.at(-1), /请先把排序改成「手动排序」/);
  c.change({id: 'opp-sort', value: 'manual'});
  await press('m2', {key: 'ArrowUp', altKey: true}, ['m3', 'm2']); await flush();
  assert.deepEqual(inColumn(c.state(), 'open').slice(0, 2), ['m2', 'm3']);
  const moved = c.state();
  await press('m2', {key: 'ArrowUp', altKey: true}, ['m2', 'm3']); await flush();
  assert.equal(c.state(), moved, 'already first');
  await press('m2', {key: 'ArrowDown', altKey: true}, ['m2', 'm3']); await flush();
  assert.deepEqual(inColumn(c.state(), 'open'), ['m3', 'm2']);
  // 列表视图里没有键盘移动
  await c.click({oppView: 'list'});
  const list = c.state();
  assert.equal(await press('m3', {key: 'ArrowRight'}), false); assert.equal(c.state(), list);
});

test('drag helpers: where to insert and when to scroll', () => {
  const rects = [{id: 'a', top: 0, bottom: 100}, {id: 'b', top: 110, bottom: 210}];
  assert.deepEqual([ui.dropBefore(rects, -5), ui.dropBefore(rects, 49), ui.dropBefore(rects, 51), ui.dropBefore(rects, 159), ui.dropBefore(rects, 161), ui.dropBefore([], 10), ui.dropBefore(rects, undefined), ui.dropBefore(null, 3)], ['a', 'a', 'b', 'b', '', '', '', '']);
  assert.deepEqual([ui.scrollStep(500, 0, 1000), ui.scrollStep(0, 0, 1000), ui.scrollStep(1000, 0, 1000), ui.scrollStep(36, 0, 1000), ui.scrollStep(964, 0, 1000), ui.scrollStep(-50, 0, 1000)], [0, -28, 28, -14, 14, -28]);
  assert.deepEqual([ui.scrollStep(10, 0, 100, 72, 28), ui.scrollStep(NaN, 0, 100), ui.scrollStep(5, 100, 100), ui.scrollStep(60, 0, 100)], [-23, 0, 0, 6]);
});

test('review fixes: an error shown after a failed save survives the list refresh; names with ".." upload fine; held-down keys do not repeat moves', async () => {
  const io = fileCtx();
  const c = controller(sample(), '数据已发生变化', io);
  // 模拟真实页面：重画附件区时错误框是新建的空框
  c.errors['opp-attach'] = {set innerHTML(value) { if (c.errors['opp-attach-error']) c.errors['opp-attach-error'].textContent = ''; }};
  c.page.navigate('opportunities');
  await c.click({oppAction: 'detail', id: 'p1'});
  await c.change2({target: {id: 'opp-attach-input', value: '', closest: () => null, files: [plain('a.txt')]}}); await flush();
  assert.equal(c.errors['opp-attach-error'].textContent, '数据已发生变化');
  const d = controller(sample(), null, fileCtx());
  d.page.navigate('opportunities'); await d.click({oppAction: 'detail', id: 'p1'});
  await d.change2({target: {id: 'opp-attach-input', value: '', closest: () => null, files: [plain('v1..2.txt'), plain('好.txt')]}}); await flush();
  assert.equal(O.attachmentsOf(O.list(d.state()).find(i => i.id === 'p1')).length, 2);
  const before = d.state(), card = {dataset: {oppId: 'p1'}, closest: () => null};
  assert.equal(await d.key({closest: sel => sel === '.opp-card' ? card : null}, {key: 'ArrowRight', repeat: true}), false);
  assert.equal(d.state(), before);
});


test('detail: the 电话 line with a WhatsApp button appears only when the page passes a number for the linked contact', () => {
  const s = add(base, 'w1', {contact: 'Ann'});
  const detail = O.detailOf(s, 'w1', TODAY);
  const html = ui.detailMarkup(detail, {today: TODAY, whatsapp: {phone: '+44 7700 900123', contact: 'Ann'}}, {});
  assert.match(html, /<dt>电话<\/dt><dd>\+44 7700 900123 <button type="button" class="k-btn k-btn--sm opp-wa" data-opp-action="wa" data-id="w1"/);
  assert.doesNotMatch(html, /data-chat-action/);
  assert.doesNotMatch(ui.detailMarkup(detail, {today: TODAY}, {}), /data-opp-action="wa"|<dt>电话<\/dt>/);
  assert.match(ui.detailMarkup(detail, {today: TODAY, whatsapp: {phone: '<i>1', contact: ''}}, {}), /&lt;i&gt;1/, 'the number is escaped');
});

test('opportunity WhatsApp / 电话: needs 联系电话 not hidden, a customer the account can see, and chat permission', async () => {
  const RMODEL = require('../src/role-model.js');
  const customers = {
    'Alpha <b>Co</b>': {owner: 'Amy', contact: 'Ann', phone: '+44 7700 900123', country: '英国'},
    'Beta Ltd': {owner: 'Bob', contact: 'Cy', phone: '+49 1512 3456789', country: '德国'},
    'Pool Co': {owner: '', laiBucket: 'pool', contact: 'Pia', phone: '+49 1512 0000000', country: '德国'},
  };
  let s = {...base, customers};
  s = add(s, 'mine', {client: 'Alpha <b>Co</b>', contact: 'Ann'});
  s = add(s, 'theirs', {client: 'Beta Ltd', contact: 'Cy'});          // Amy owns the opportunity, Bob owns the customer
  s = add(s, 'pooled', {client: 'Pool Co', contact: 'Pia'});
  const account = (perms, fields = {}, scope = 'self') => ({...s, laiSettings: {...s.laiSettings, roles: {
    roles: [{id: 'ops', name: '运营', scope, perms: {'customer.view': true, 'opp.view': true, 'chat.send': true, ...perms}, fields}],
    members: [{id: 'm-kris', name: 'Kris', roleId: 'admin'}, {id: 'm-amy', name: 'Amy', roleId: 'ops'}], current: 'm-amy'}}});
  const run = async (state, id) => {
    const opened = [], c = controller(state, null, {roleModel: RMODEL, openWhatsApp: options => opened.push(options)});
    c.page.navigate('opportunities');
    await c.click({oppAction: 'detail', id});
    const html = c.dialogs.at(-1)[1];
    await c.click({oppAction: 'wa', id});
    return {html, opened, toasts: c.toasts};
  };
  // allowed: own customer, phone visible
  let got = await run(account({}), 'mine');
  assert.match(got.html, /<dt>电话<\/dt><dd>\+44 7700 900123 <button[^>]*data-opp-action="wa"/);
  assert.equal(got.opened.length, 1);
  assert.equal(got.opened[0].customer, 'Alpha <b>Co</b>');
  // 联系电话 hidden by the role: no number, no button, and the button action refuses
  got = await run(account({}, {customer: {'contact.phone': 'hidden'}}), 'mine');
  assert.doesNotMatch(got.html, /<dt>电话<\/dt>|7700 900123|data-opp-action="wa"/);
  assert.equal(got.opened.length, 0);
  assert.deepEqual(got.toasts.slice(-1), ['这个联系人没有可用的电话']);
  // 联系电话 read-only is still visible
  assert.equal((await run(account({}, {customer: {'contact.phone': 'read'}}), 'mine')).opened.length, 1);
  // a 本人 account that owns an opportunity on someone else's customer: nothing leaks
  got = await run(account({}), 'theirs');
  assert.doesNotMatch(got.html, /<dt>电话<\/dt>|1512 3456789|data-opp-action="wa"/);
  assert.equal(got.opened.length, 0);
  // a 全公司 account sees that customer
  assert.equal((await run(account({}, {}, 'all'), 'theirs')).opened.length, 1);
  // pool customers need 公海查看
  assert.equal((await run(account({}, {}, 'all'), 'pooled')).opened.length, 0);
  got = await run(account({'pool.view': true}, {}, 'all'), 'pooled');
  assert.match(got.html, /<dt>电话<\/dt>/);
  assert.equal(got.opened.length, 1);
  // no chat permission: no button, no number
  got = await run(account({'chat.send': false}), 'mine');
  assert.doesNotMatch(got.html, /<dt>电话<\/dt>|data-opp-action="wa"/);
  assert.equal(got.opened.length, 0);
  // the detail markup never prints a number it was not given
  assert.doesNotMatch(ui.detailMarkup(O.detailOf(s, 'theirs', TODAY), {today: TODAY}, {}), /<dt>电话<\/dt>|1512/);
});

test('detail: subtitle, compact amount, stage progress by meaning and the newest stage record first', () => {
  const s = O.moveStage(sample(), 'p1', 'unpaid', {now: '2026-10-07T05:00:00.000Z'});
  const steps = html => [...html.matchAll(/<li class="(is-\w+)( is-end)?"(?: aria-current="step")?><span>([^<]+)<\/span><\/li>/g)].map(m => `${m[3]}:${m[1]}${m[2] ? '+end' : ''}`);
  const open = ui.detailMarkup(O.detailOf(s, 'p1', TODAY), {today: TODAY}, {});
  assert.match(open, /<p class="opp-detail-sub"><span>26100601-Amy<\/span><span class="opp-num">OPP-/);
  assert.match(open, /<div class="opp-detail-amount"><small>USD<\/small>331\.74<\/div>/);
  assert.match(open, /<ol class="opp-progress opp-kind-open" aria-label="销售阶段">/);
  assert.deepEqual(steps(open), ['未成单:is-done', '付款未到账:is-current', '待付尾款:is-todo', '已完成:is-todo', '输单:is-todo+end']);
  assert.match(open, /<ol class="opp-history"><li class="opp-kind-open is-current"><i aria-hidden="true"><\/i><span>付款未到账<\/span>[\s\S]*?<li class="opp-kind-open"><i aria-hidden="true"><\/i><span>未成单<\/span>/, 'newest first');
  const won = ui.detailMarkup(O.detailOf(s, 'p3', TODAY), {today: TODAY}, {});
  assert.match(won, /<ol class="opp-progress opp-kind-won"/);
  assert.match(won, /<div class="opp-detail-amount"><small>USD<\/small>200<\/div>/, 'whole amounts drop .00');
  assert.deepEqual(steps(won), ['未成单:is-done', '付款未到账:is-done', '待付尾款:is-done', '已完成:is-current', '输单:is-todo+end']);
  const lost = ui.detailMarkup(O.detailOf(s, 'p4', TODAY), {today: TODAY}, {});
  assert.match(lost, /<ol class="opp-progress opp-kind-lost"/);
  assert.deepEqual(steps(lost), ['未成单:is-done', '付款未到账:is-todo', '待付尾款:is-todo', '已完成:is-todo', '输单:is-current+end'], 'only the stages it went through');
});
