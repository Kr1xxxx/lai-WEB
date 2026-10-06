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
  for (const id of ['opp-search', 'opp-sort', 'opp-flow', 'opp-date-field', 'opp-from', 'opp-to', 'opp-archived', 'opp-currency']) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(html, /<option value="default" selected>默认销售流程<\/option>/);
  assert.match(html, /总销售金额：<b>USD 631\.74<\/b>/); assert.match(html, /进行中金额：<b class="opp-open">USD 431\.74<\/b>/); assert.match(html, /赢单金额：<b class="opp-won">USD 200\.00<\/b>/);
  assert.match(html, /另有 1 个其他币种的商机/);
  assert.deepEqual([...html.matchAll(/<section class="opp-column opp-kind-(\w+)" data-opp-drop="(\w+)"[^>]*><header class="opp-stage"><span>([^<]+)<\/span><\/header><div class="opp-stage-amount">([^<]+)</g)].map(m => [m[1], m[2], m[3], m[4]]),
    [['open', 'open', '未成单(2)', 'USD 431.74'], ['open', 'unpaid', '付款未到账(0)', 'USD 0.00'], ['won', 'balance', '待付尾款(0)', 'USD 0.00'], ['won', 'done', '已完成(1)', 'USD 200.00'], ['lost', 'lost', '输单(1)', 'USD 50.00']]);
  assert.equal((html.match(/class="opp-card"/g) || []).length, 4);
  assert.equal((html.match(/draggable="true"/g) || []).length, 4);
  assert.equal((html.match(/暂无商机/g) || []).length, 2);
  assert.match(html, /结束日期：04-02/, 'this year: month-day only');
  assert.match(html, /结束日期：2025-12-15/, 'other years: full date');
  assert.equal((html.match(/class="opp-overdue"/g) || []).length, 2, 'two open opportunities are past their end date');
  assert.match(html, /输单原因：价格原因/);
  assert.match(html, /data-opp-view="board" aria-pressed="true"/);
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
  assert.match(html, /<td>已完成<\/td>/); assert.match(html, /data-opp-view="list" aria-pressed="true"/);
  let many = base;
  for (let i = 0; i < 65; i++) many = add(many, 'm' + i, {nameMode: 'custom', name: 'N' + String(i).padStart(2, '0')});
  const big = O.board(many, {}, TODAY);
  const first = ui.boardMarkup(big, {}, {today: TODAY});
  assert.equal((first.match(/class="opp-card"/g) || []).length, 30);
  assert.match(first, /data-opp-action="more" data-stage="open">再显示 30 个（还有 35 个）/);
  const more = ui.boardMarkup(big, {limits: {open: 60}}, {today: TODAY});
  assert.equal((more.match(/class="opp-card"/g) || []).length, 60);
  assert.match(more, /再显示 5 个（还有 5 个）/);
  assert.doesNotMatch(ui.boardMarkup(big, {limits: {open: 90}}, {today: TODAY}), /data-opp-action="more"/);
  assert.match(ui.boardMarkup(big, {mode: 'list'}, {today: TODAY}), /data-stage="list">再显示 30 个（还有 35 个）/);
});

test('form: reference fields, required marks, and the parts that depend on what is filled in', () => {
  const fresh = ui.formMarkup(O.defaults(base, TODAY), {customers: O.customerNames(base), contacts: [], owners: ['Amy'], isNew: true});
  for (const name of ['nameMode', 'client', 'contact', 'amount', 'endDate', 'flow', 'exchangeRate', 'currency', 'stage', 'owner', 'collaborators', 'tags', 'note', 'products']) assert.ok(fresh.includes(`name="${name}"`), name);
  assert.match(fresh, /value="auto" checked/); assert.doesNotMatch(fresh, /name="name"/);
  assert.match(fresh, /name="endDate" type="date" value="2026-11-05"/, 'end date defaults to 30 days ahead');
  assert.match(fresh, /name="exchangeRate" value="100" inputmode="decimal" readonly/);
  assert.match(fresh, /<option value="">请先选择客户<\/option>/); assert.doesNotMatch(fresh, /name="contact" required/);
  assert.match(fresh, /name="owner" value="Amy"/); assert.doesNotMatch(fresh, /name="lostReason"/);
  const chosen = ui.formMarkup({...O.defaults(base, TODAY), client: 'Alpha <b>Co</b>', contact: 'Bo', nameMode: 'custom', name: '大单', currency: 'EUR', exchangeRate: 108, stage: 'lost', lostReason: '交期原因',
    collaborators: ['Bob', 'Cara'], tags: ['VIP'], products: [{name: 'A', quantity: 10, unitPrice: 2.5}, {name: 'B', quantity: 1, unitPrice: 4}]}, {contacts: ['Ann', 'Bo'], isNew: false});
  assert.match(chosen, /name="contact" required><option value="">请选择<\/option><option value="Ann">Ann<\/option><option value="Bo" selected>Bo<\/option>/);
  assert.match(chosen, /value="custom" checked/); assert.match(chosen, /name="name" value="大单"/);
  assert.match(chosen, /name="exchangeRate" value="108" inputmode="decimal" aria-describedby/); assert.doesNotMatch(chosen, /name="exchangeRate"[^>]*readonly/);
  assert.match(chosen, /<option value="交期原因" selected>/); assert.match(chosen, /name="lostNote"/);
  assert.match(chosen, /name="collaborators" value="Bob，Cara"/);
  assert.match(chosen, />A, 10, 2\.5\nB, 1, 4<\/textarea><span class="muted tiny">共 2 项，合计 29\.00/);
  assert.match(ui.formMarkup({client: 'Beta Ltd'}, {contacts: []}), /该客户没有联系人，可留空/);
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
  assert.match(ui.menuMarkup(card('p1'), true), /class="team-danger" data-opp-action="delete" data-id="p1">再点一次确认删除（不可恢复）/);
  assert.match(ui.lostMarkup(card('p1')), /<form class="drawer-body" id="opp-lost-form" data-id="p1">/);
});

test('analysis page shows the figures from the model', () => {
  const html = ui.analysisMarkup(O.analysis(sample(), {}, TODAY));
  assert.match(html, /<span>新建商机数<\/span><strong>4<\/strong>/);
  assert.match(html, /<span>赢单率<\/span><strong>50%<\/strong>/);
  assert.match(html, /<span>赢单<\/span><strong>1<\/strong><span class="muted tiny">USD 200\.00<\/span>/);
  assert.match(html, /<td>价格原因<\/td><td>1<\/td><td>USD 50\.00<\/td>/);
  assert.match(html, /另有 1 个其他币种的商机未计入本页/);
  const empty = ui.analysisMarkup(O.analysis({}, {}, TODAY));
  assert.match(empty, /<span>赢单率<\/span><strong>—<\/strong>/); assert.match(empty, /所选范围内没有商机/); assert.match(empty, /所选范围内没有输单/);
});

// ---------------- controller ----------------
const source = fs.readFileSync(path.join(__dirname, '../src/business-ui.js'), 'utf8');
function controller(initial, failWith = null) {
  let current = initial, form = null;
  const mounted = [], dialogs = [], listeners = {}, toasts = [], closed = [], errors = {};
  const sandbox = {crypto: {randomUUID: () => 'new-id'}, FormData: function (f) { return Object.entries(f.values)[Symbol.iterator](); }, document: {
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    getElementById: id => id === 'opp-form' ? form : id ? (errors[id] ||= {textContent: '', classList: {add() {}}}) : null,
    querySelectorAll: () => [], querySelector: () => null}};
  sandbox.window = {LaiBusinessModel: B, LaiModules: require('../src/modules.js'), LaiTeamModel: T, LaiTeamUI: TU, LaiOpportunityModel: O, LaiOpportunityUI: U};
  vm.createContext(sandbox); vm.runInContext(source, sandbox);
  const page = sandbox.window.LaiBusinessUI.create({getState: () => current, escape: escapeHtml, mount: html => mounted.push(html),
    save: async next => { if (failWith) throw new Error(failWith); current = next; return true; }, openCustomer() {}, refreshCustomer() {}, navigate() {},
    toast: text => toasts.push(text), dialog: (...args) => dialogs.push(args), closeDialog: () => closed.push(1)});
  const target = dataset => ({closest: sel => sel === 'button' ? {dataset, disabled: false} : null});
  return {page, mounted, dialogs, toasts, closed, errors, state: () => current, setForm: values => { form = values ? {values} : null; },
    click: dataset => Promise.all(listeners.click.map(fn => fn({target: target(dataset)}))),
    submit: (id, values, dataset = {}) => Promise.all(listeners.submit.map(fn => fn({target: {id, values, dataset, elements: {isDraft: {checked: false}}}, preventDefault() {}}))),
    change: el => listeners.change.forEach(fn => fn({target: {dataset: {}, closest: sel => sel === '#opp-form' ? (el.inForm ? {} : null) : null, ...el}})),
    drag: (type, el) => { let prevented = false; listeners[type].forEach(fn => fn({target: el, preventDefault() { prevented = true; }, dataTransfer: {setData() {}}})); return prevented; }};
}
const valid = {nameMode: 'auto', client: 'Beta Ltd', contact: '', amount: '120', endDate: '2026-11-05', flow: 'default', exchangeRate: '100', currency: 'USD', stage: 'open', owner: 'Amy', collaborators: '', tags: '', note: '', products: ''};

test('controller: board renders, a new opportunity can be created, edited and its form reacts to the customer', async () => {
  const c = controller(sample());
  c.page.navigate('opportunities');
  assert.match(c.mounted.at(-1), /<h1>商机<\/h1>/); assert.match(c.mounted.at(-1), /data-opp-action="new">新建商机/); assert.match(c.mounted.at(-1), /id="opp-owner"/);
  await c.click({oppAction: 'new'});
  assert.deepEqual([c.dialogs.at(-1)[0], c.dialogs.at(-1)[3]], ['新建商机', 'business-opportunity']);
  assert.equal(c.page.hasDraft(), true, 'an open form guards against losing input when navigating away');
  // 选了客户：表单重画，联系人变为必选，已填的金额保留
  c.setForm({...valid, client: 'Alpha <b>Co</b>', amount: '55', contact: ''});
  c.change({name: 'client', inForm: true});
  assert.match(c.dialogs.at(-1)[1], /name="contact" required><option value="">请选择<\/option><option value="Ann">Ann/);
  assert.match(c.dialogs.at(-1)[1], /name="amount" value="55"/);
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
  // 换了客户：原来选的联系人不再带过去
  await c.click({oppAction: 'edit', id: 'p1'});
  assert.match(c.dialogs.at(-1)[1], /<option value="Bo" selected>/);
  c.setForm({...valid, client: 'Beta Ltd', contact: 'Bo'}); c.change({name: 'client', inForm: true});
  const {contact, ...withoutContact} = valid;
  c.setForm({...withoutContact, client: 'Alpha <b>Co</b>'}); c.change({name: 'client', inForm: true});
  assert.doesNotMatch(c.dialogs.at(-1)[1], /<option value="Bo" selected>/, 'a contact from the previous customer is not carried over');
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
  assert.match(c.mounted.at(-1), /总销售金额：<b>EUR 70\.00<\/b>/);
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
  assert.deepEqual(RM.sectionFor('opportunities').entries.map(e => [e.label, e.target]), [['商机看板', 'opportunities'], ['商机分析', 'opp-analysis']]);
  assert.equal(RM.sectionFor('opp-analysis').label, '商机');
  const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  assert.match(app, /\["globe", "商机", "opportunities"\]/);
  for (const route of ['"opportunities",', '"opp-analysis",']) assert.ok(app.includes(route), route);
  const template = fs.readFileSync(path.join(__dirname, '../src/template.html'), 'utf8');
  const at = marker => template.indexOf(`<!--${marker}-->`);
  assert.ok(at('TEAM_UI') < at('OPP_MODEL') && at('OPP_MODEL') < at('OPP_UI') && at('OPP_UI') < at('LAI_BUSINESS_UI'));
  const build = fs.readFileSync(path.join(__dirname, '../scripts/build.py'), 'utf8');
  assert.match(build, /'<!--OPP_MODEL-->','opportunity-model\.js','script'/); assert.match(build, /'<!--OPP_UI-->','opportunity-ui\.js','script'/);
});
