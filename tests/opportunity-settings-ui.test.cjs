// 商机设置页和商机表单新字段的界面与控制器测试（不开浏览器；真实浏览器流程见 tests/e2e/opportunity-settings.e2e.mjs）。
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
const CS = require('../src/customer-settings-model.js');
const {escapeHtml} = require('../src/model.js');

const ui = U.create(escapeHtml, O);
const NOW = '2026-10-06T04:00:00.000Z', TODAY = '2026-10-06';
const base = {laiSettings: {defaultOwner: 'Amy'}, customers: {'Alpha Co': {owner: 'Amy', contacts: ['Ann'], source: '社媒'}, 'Beta Ltd': {owner: 'Bob'}}, orders: []};
const input = extra => ({client: 'Beta Ltd', amount: '100', currency: 'USD', endDate: '2026-11-05', owner: 'Amy', stage: 'open', ...extra});
const add = (state, id, extra) => O.upsert(state, id, input(extra), {now: NOW, today: TODAY});
const get = (state, id) => O.list(state).find(item => item.id === id);
const withSources = state => {
  let s = CS.addSource(state, {name: '常规获客'});
  s = CS.addSource(s, {name: '展会', parentId: CS.get(s).sources[0].id});
  return CS.addSource(s, {name: '社媒'});
};

const source = fs.readFileSync(path.join(__dirname, '../src/business-ui.js'), 'utf8');
function controller(initial) {
  let current = initial, form = null;
  const mounted = [], dialogs = [], listeners = {}, toasts = [], closed = [], errors = {};
  let uuid = 0;
  const sandbox = {crypto: {randomUUID: () => `${String(++uuid).padStart(8, '0')}-new`}, FormData: function (f) { return Object.entries(f.values)[Symbol.iterator](); }, document: {
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    getElementById: id => id === 'opp-form' ? form : id ? (errors[id] ||= {textContent: '', classList: {add() {}}}) : null,
    querySelectorAll: () => [], querySelector: () => null}};
  sandbox.window = {LaiBusinessModel: B, LaiModules: require('../src/modules.js'), LaiTeamModel: T, LaiTeamUI: TU, LaiOpportunityModel: O, LaiOpportunityUI: U};
  vm.createContext(sandbox); vm.runInContext(source, sandbox);
  const page = sandbox.window.LaiBusinessUI.create({getState: () => current, escape: escapeHtml, mount: html => mounted.push(html),
    save: async next => { current = next; return true; }, openCustomer() {}, refreshCustomer() {}, navigate() {},
    toast: text => toasts.push(text), dialog: (...args) => dialogs.push(args), closeDialog: () => closed.push(1)});
  const target = dataset => ({closest: sel => sel === 'button' ? {dataset, disabled: false} : null});
  return {page, mounted, dialogs, toasts, closed, errors, state: () => current,
    click: dataset => Promise.all(listeners.click.map(fn => fn({target: target(dataset)}))),
    // groups：表单里的多选区域 [{key, picked:[...]}]
    submit: (id, values, dataset = {}, groups = []) => Promise.all(listeners.submit.map(fn => fn({target: {id, values, dataset, elements: {isDraft: {checked: false}},
      querySelectorAll: sel => sel === '[data-multi]' ? groups.map(group => ({dataset: {multi: group.key}, querySelectorAll: () => group.picked.map(value => ({checked: true, value})).concat([{checked: false, value: 'unchecked'}])})) : []}, preventDefault() {}}))),
    change: el => { el.dataset ||= {}; el.closest ||= () => null; return Promise.all(listeners.change.map(fn => fn({target: el}))); }};
}
const last = c => c.mounted.at(-1);

test('settings page: three tabs, the flows tab is the old flows page, the rest are cs-style panels', () => {
  const c = controller(base);
  c.page.navigate('opp-flows');
  assert.match(last(c), /<h1>商机设置<\/h1>/);
  assert.deepEqual([...last(c).matchAll(/data-opp-set-tab="(\w+)"[^>]*>([^<]+)</g)].map(m => [m[1], m[2]]), [['flows', '销售流程'], ['reasons', '输单原因'], ['fields', '商机字段']]);
  assert.match(last(c), /<button type="button" data-opp-set-tab="flows" class="active" aria-current="page">/);
  assert.match(last(c), /id="opp-flow-add"/); assert.match(last(c), /data-flow-rename="default"/);
});

test('reasons tab: add, duplicate error, rename restores on failure, move, two-step delete, blocked delete', async () => {
  const c = controller(base);
  c.page.navigate('opp-flows');
  await c.click({oppSetTab: 'reasons'});
  assert.match(last(c), /id="opp-reasons-add"/);
  assert.equal((last(c).match(/data-set-rename="reasons"/g) || []).length, 6);
  await c.submit('opp-reasons-add', {text: '客户关系'}, {list: 'reasons'});
  assert.equal(O.lostReasons(c.state()).at(-1), '客户关系');
  assert.match(last(c), /data-set-rename="reasons" data-key="客户关系"/);
  await c.submit('opp-reasons-add', {text: '客户关系'}, {list: 'reasons'});
  assert.equal(c.errors['opp-set-error'].textContent, '已经有同名的输单原因');
  const input = {dataset: {setRename: 'reasons', key: '客户关系'}, value: '价格原因'};
  await c.change(input);
  assert.equal(input.value, '客户关系', 'a failed rename puts the saved name back');
  await c.change({dataset: {setRename: 'reasons', key: '客户关系'}, value: ' 关系问题 '});
  assert.equal(O.lostReasons(c.state()).at(-1), '关系问题');
  await c.click({setAction: 'up', list: 'reasons', key: '关系问题'});
  assert.equal(O.lostReasons(c.state()).at(-2), '关系问题');
  // 删除：没人用时点两次
  await c.click({setAction: 'remove', list: 'reasons', key: '关系问题'});
  assert.ok(O.lostReasons(c.state()).includes('关系问题')); assert.match(last(c), /再点一次确认删除/);
  await c.click({setAction: 'remove', list: 'reasons', key: '关系问题'});
  assert.ok(!O.lostReasons(c.state()).includes('关系问题'));
  // 有商机在用：直接提示，不删
  let s = O.moveStage(add(c.state(), 'a'), 'a', 'lost', {lostReason: '价格原因', now: NOW});
  const d = controller(s);
  d.page.navigate('opp-flows'); await d.click({oppSetTab: 'reasons'});
  assert.match(last(d), /1 个商机在用/);
  await d.click({setAction: 'remove', list: 'reasons', key: '价格原因'});
  assert.equal(d.errors['opp-set-error'].textContent, '还有 1 个商机用了这个原因，先改掉它们');
  assert.ok(O.lostReasons(d.state()).includes('价格原因'));
  // 改名同步到商机
  await d.change({dataset: {setRename: 'reasons', key: '价格原因'}, value: '价格太高'});
  assert.equal(get(d.state(), 'a').lostReason, '价格太高');
  // 输单对话框用配置的名单
  d.page.navigate('opportunities');
  await d.click({oppAction: 'move', id: 'a', stage: 'open'});
  await d.click({oppAction: 'move', id: 'a', stage: 'lost'});
  assert.match(d.dialogs.at(-1)[1], /<option value="价格太高">/);
});

test('fields tab: system fields table, field toggles, types list, custom field add / options / required / move / delete', async () => {
  const c = controller(base);
  c.page.navigate('opp-flows');
  await c.click({oppSetTab: 'fields'});
  const html = last(c);
  for (const label of ['客户', '商机名称', '销售金额 / 币种', '销售阶段', '结束日期', '负责人', '销售流程', '输单原因', '商机编号', '关联联系人', '协同跟进人', '商机来源', '商机类型', '来源线索', '汇率', '商机标签', '备注', '关联产品']) assert.ok(html.includes(`<td>${label}`), label);
  assert.match(html, /data-set-field="client" data-prop="show" checked disabled/);
  assert.match(html, /data-set-field="sources" data-prop="show" checked aria-label/);
  assert.match(html, /data-set-field="exchangeRate" data-prop="required" checked aria-label/, 'the rate\'s required switch is free');
  assert.match(html, /data-set-field="exchangeRate" data-prop="show" checked disabled/);
  await c.change({dataset: {setField: 'note', prop: 'required'}, checked: true});
  assert.equal(O.fieldMap(c.state()).note.required, true);
  await c.change({dataset: {setField: 'note', prop: 'show'}, checked: false});
  assert.equal(O.fieldMap(c.state()).note.show, false);
  assert.match(last(c), /data-set-field="note" data-prop="required" disabled aria-label="备注必填"/, 'a hidden field cannot be required');
  // 类型
  await c.submit('opp-types-add', {text: '代理商机'}, {list: 'types'});
  assert.equal(O.typeChoices(c.state()).at(-1), '代理商机');
  assert.match(last(c), /data-set-rename="types" data-key="代理商机"/);
  await c.click({setAction: 'remove', list: 'types', key: '代理商机'}); await c.click({setAction: 'remove', list: 'types', key: '代理商机'});
  assert.ok(!O.typeChoices(c.state()).includes('代理商机'));
  // 自定义字段
  await c.submit('opp-cf-add', {name: '付款方式', type: 'select', required: 'on', options: 'T/T\nL/C'});
  const [cf] = O.customFields(c.state());
  assert.deepEqual([cf.id, cf.name, cf.type, cf.options, cf.required], ['c00000001', '付款方式', 'select', ['T/T', 'L/C'], true]);
  assert.match(last(c), /data-cf-options="c00000001"/); assert.match(last(c), /<textarea[^>]*>T\/T\nL\/C<\/textarea>/);
  await c.submit('opp-cf-add', {name: '付款方式', type: 'text'});
  assert.equal(c.errors['opp-set-error'].textContent, '已经有同名的字段');
  await c.submit('opp-cf-add', {name: '日期', type: 'date'});
  const second = O.customFields(c.state())[1].id;
  await c.change({dataset: {cfRequired: cf.id}, checked: false});
  assert.equal(O.customFields(c.state())[0].required, false);
  await c.change({dataset: {cfOptions: cf.id}, value: 'T/T\nL/C\n现金'});
  assert.deepEqual(O.customFields(c.state())[0].options, ['T/T', 'L/C', '现金']);
  const bad = {dataset: {cfOptions: cf.id}, value: ''};
  await c.change(bad);
  assert.equal(bad.value, 'T/T\nL/C\n现金', 'invalid options put the saved ones back');
  const nameInput = {dataset: {cfRename: cf.id}, value: '日期'};
  await c.change(nameInput);
  assert.equal(nameInput.value, '付款方式');
  await c.change({dataset: {cfRename: cf.id}, value: '支付方式'});
  assert.equal(O.customFields(c.state())[0].name, '支付方式');
  await c.click({setAction: 'cf-down', key: cf.id});
  assert.deepEqual(O.customFields(c.state()).map(f => f.id), [second, cf.id]);
  // 删除：没有值的直接删；有值的先提示，再点一次
  await c.click({setAction: 'cf-remove', key: second});
  assert.deepEqual(O.customFields(c.state()).map(f => f.id), [cf.id]);
  const withValue = add(c.state(), 'v', {custom: {[cf.id]: 'T/T'}});
  const d = controller(withValue);
  d.page.navigate('opp-flows'); await d.click({oppSetTab: 'fields'});
  assert.match(last(d), /1 个商机已填/);
  await d.click({setAction: 'cf-remove', key: cf.id});
  assert.equal(O.customFields(d.state()).length, 1); assert.match(last(d), /有 1 个商机填过这个字段。删除后它们的内容不再显示，但数据还留着。/);
  await d.click({setAction: 'cf-remove', key: cf.id});
  assert.equal(O.customFields(d.state()).length, 0);
  assert.deepEqual(get(d.state(), 'v').custom, {[cf.id]: 'T/T'});
  // 页签只在这个页面生效
  d.page.navigate('opportunities');
  await d.click({oppSetTab: 'reasons'});
  assert.doesNotMatch(last(d), /opp-reasons-add/);
});

test('the opportunity form: new fields appear, hidden ones disappear, multi and custom values are collected on save', async () => {
  let s = withSources(base);
  s = {...s, laiLeads: [{id: 'L1', name: 'Zed Lashes'}]};
  s = O.addCustomField(s, {name: '付款方式', type: 'multi', options: 'T/T\nL/C'}, {id: 'pay'});
  s = O.addCustomField(s, {name: '折扣', type: 'number', required: 'on'}, {id: 'dc'});
  const c = controller(s);
  c.page.navigate('opportunities');
  await c.click({oppAction: 'new'});
  const form = c.dialogs.at(-1)[1];
  assert.match(form, /商机编号/); assert.match(form, /保存后自动生成/);
  assert.match(form, /data-multi="sources"/); assert.match(form, /<input type="checkbox" value="常规获客 \/ 展会">/);
  assert.match(form, /<select class="k-select-trigger" name="type"><option value="">请选择<\/option><option value="新客户商机">/);
  assert.match(form, /<select class="k-select-trigger" name="leadId"><option value="">不选<\/option><option value="L1">Zed Lashes<\/option>/);
  assert.match(form, /<div class="form-section">自定义字段<\/div>/); assert.match(form, /data-multi="custom:pay"/); assert.match(form, /name="custom:dc" value="" inputmode="decimal" autocomplete="off" aria-required="true" required/);
  assert.ok(form.indexOf('补充信息') < form.indexOf('自定义字段'));
  // 保存：多选从勾选框收集，自定义字段按 custom:ID 收集
  await c.submit('opp-form', {nameMode: 'auto', client: 'Beta Ltd', contact: '', amount: '120', endDate: '2026-11-05', flow: 'default', exchangeRate: '100', currency: 'USD', stage: 'open', owner: 'Amy', collaborators: '', tags: '', note: '', products: '',
    type: '样品单', leadId: 'L1', 'custom:dc': '5'}, {}, [{key: 'sources', picked: ['社媒', '常规获客 / 展会']}, {key: 'custom:pay', picked: ['L/C']}]);
  assert.equal(c.closed.length, 1, c.errors['opp-error']?.textContent);
  const made = get(c.state(), '00000001-new');
  assert.deepEqual([made.sources, made.type, made.leadId, made.custom], [['社媒', '常规获客 / 展会'], '样品单', 'L1', {pay: ['L/C'], dc: 5}]);
  assert.match(made.number, /^OPP-\d{8}-001$/);
  // 必填的自定义字段没填
  await c.click({oppAction: 'new'});
  await c.submit('opp-form', {nameMode: 'auto', client: 'Beta Ltd', contact: '', amount: '1', endDate: '2026-11-05', flow: 'default', exchangeRate: '100', currency: 'USD', stage: 'open', owner: 'Amy'}, {}, []);
  assert.equal(c.errors['opp-error'].textContent, '请填写折扣');
  // 来源不在名单
  await c.submit('opp-form', {nameMode: 'auto', client: 'Beta Ltd', amount: '1', endDate: '2026-11-05', flow: 'default', exchangeRate: '100', currency: 'USD', stage: 'open', owner: 'Amy', 'custom:dc': '1'}, {}, [{key: 'sources', picked: ['抖音']}]);
  assert.equal(c.errors['opp-error'].textContent, '商机来源“抖音”不在来源名单里');
  // 编辑已有商机：表单带出已存的值
  await c.click({oppAction: 'edit', id: '00000001-new'});
  const edit = c.dialogs.at(-1)[1];
  assert.match(edit, /OPP-\d{8}-001/); assert.doesNotMatch(edit, /保存后自动生成/);
  assert.match(edit, /<input type="checkbox" value="社媒" checked>/); assert.match(edit, /<option value="样品单" selected>/); assert.match(edit, /name="custom:dc" value="5"/);
  assert.match(edit, /<input type="checkbox" value="L\/C" checked>/);
});

test('the form hides fields switched off in settings; the shared source list being empty shows a hint', async () => {
  let s = base;
  for (const id of ['note', 'tags', 'products', 'collaborators', 'contact', 'sources', 'type', 'leadId']) s = O.setField(s, id, {show: false});
  const hidden = ui.formMarkup({...O.defaults(s, TODAY)}, {setup: O.formSetup(s), isNew: true});
  for (const name of ['note', 'tags', 'products', 'collaborators', 'contact', 'type', 'leadId']) assert.doesNotMatch(hidden, new RegExp(`name="${name}"`), name);
  assert.doesNotMatch(hidden, /data-multi="sources"/); assert.doesNotMatch(hidden, /补充信息/); assert.doesNotMatch(hidden, /自定义字段/);
  assert.match(hidden, /商机编号/, 'the number is always shown');
  const noList = ui.formMarkup(O.defaults(base, TODAY), {setup: O.formSetup(base), isNew: true});
  assert.match(noList, /data-multi="sources"[^>]*><legend[^>]*>商机来源<\/legend><span class="opp-field-hint">先在 客户设置 → 来源设置 里添加来源<\/span>/);
  // 必填的显示星号
  const must = ui.formMarkup(O.defaults(base, TODAY), {setup: O.formSetup(O.setField(base, 'type', {required: true})), isNew: true});
  assert.match(must, /商机类型<i class="opp-req" aria-hidden="true">\*<\/i>/);
  assert.doesNotMatch(ui.formMarkup(O.defaults(base, TODAY), {setup: O.formSetup(base), isNew: true}), /商机类型<i class="opp-req"/);
  // 隐藏联系人后，控制器换客户不会出错
  const c = controller(s);
  c.page.navigate('opportunities');
  await c.click({oppAction: 'new'});
});

test('creating from a customer prefills its source when it is on the shared list', async () => {
  const s = withSources(base);
  const c = controller({...s, customers: {...s.customers, 'Beta Ltd': {owner: 'Bob', source: '社媒'}, 'Alpha Co': {owner: 'Amy', source: '抖音'}}});
  c.page.newOpportunity('Beta Ltd');
  assert.match(c.dialogs.at(-1)[1], /<input type="checkbox" value="社媒" checked>/);
  c.page.newOpportunity('Alpha Co');
  assert.doesNotMatch(c.dialogs.at(-1)[1], /type="checkbox" value="[^"]*" checked/, 'a source that is not on the list is not taken over');
  // 在商机看板上直接新建：不预填
  c.page.navigate('opportunities');
  await c.click({oppAction: 'new'});
  assert.doesNotMatch(c.dialogs.at(-1)[1], /type="checkbox" value="[^"]*" checked/);
});

test('detail drawer: number, type, sources, lead and custom values; old opportunities show —', () => {
  let s = withSources({...base, laiLeads: [{id: 'L1', name: 'Zed <b>Lashes</b>'}]});
  s = O.addCustomField(s, {name: '付款方式', type: 'multi', options: 'T/T\nL/C'}, {id: 'pay'});
  s = O.addCustomField(s, {name: '说明', type: 'textarea'}, {id: 'tx'});
  s = add(s, 'a', {type: '样品单', leadId: 'L1', sources: ['社媒', '常规获客 / 展会'], custom: {pay: ['T/T', 'L/C'], tx: '第一行\n第二行'}});
  const html = ui.detailMarkup(O.detailOf(s, 'a', TODAY), {today: TODAY});
  assert.match(html, /<dt>商机编号<\/dt><dd>OPP-20261006-001<\/dd>/);
  assert.match(html, /<dt>商机类型<\/dt><dd>样品单<\/dd>/);
  assert.match(html, /<dt>商机来源<\/dt><dd><span class="k-badge k-badge--neutral">社媒<\/span> <span class="k-badge k-badge--neutral">常规获客 \/ 展会<\/span><\/dd>/);
  assert.match(html, /<dt>来源线索<\/dt><dd>Zed &lt;b&gt;Lashes&lt;\/b&gt;<\/dd>/);
  assert.match(html, /<dt>付款方式<\/dt><dd>T\/T、L\/C<\/dd>/);
  assert.match(html, /<dt>说明<\/dt><dd>第一行<br>第二行<\/dd>/);
  const legacy = {...base, laiOpportunities: [{id: 'old', client: 'Beta Ltd', owner: 'Amy', amount: 5, currency: 'USD', endDate: '2026-11-05', stage: 'open', name: 'n', nameMode: 'custom', createdAt: NOW}]};
  const old = ui.detailMarkup(O.detailOf(legacy, 'old', TODAY), {today: TODAY});
  assert.match(old, /<dt>商机编号<\/dt><dd>—<\/dd>/); assert.doesNotMatch(old, /商机类型|商机来源|来源线索/);
  // 列表页有编号一列
  const table = ui.boardMarkup(O.board(s, {}, TODAY), {mode: 'list'}, {today: TODAY});
  assert.match(table, /<th>商机编号<\/th>/); assert.match(table, /<td class="opp-num">OPP-20261006-001<\/td>/);
});

test('analysis page: 商机来源 table next to 输单原因', () => {
  let s = withSources(base);
  s = add(s, 'a', {sources: ['社媒', '常规获客 / 展会']}); s = add(s, 'b', {});
  const html = ui.analysisMarkup(O.analysis(s, {}, TODAY));
  assert.match(html, /<h3>商机来源<\/h3>/);
  assert.match(html, /<tr><td>社媒<\/td><td>1<\/td><td>USD 100\.00<\/td><\/tr>/);
  assert.match(html, /<tr><td>未填来源<\/td><td>1<\/td><td>USD 100\.00<\/td><\/tr>/);
  assert.ok(html.indexOf('<h3>输单原因</h3>') < html.indexOf('<h3>商机来源</h3>'));
});

test('rail menu and settings hub use the new name; the route id stays', () => {
  const RM = require('../src/rail-menu.js');
  assert.deepEqual(RM.menuFor('商机').map(r => [r.label, r.kind, r.target]).at(-1), ['商机设置', 'route', 'opp-flows']);
  const hub = fs.readFileSync(path.join(__dirname, '../src/settings-hub.js'), 'utf8');
  assert.match(hub, /id: "flows", title: "商机设置", note: "销售流程、输单原因和商机字段", open: \["route", "opp-flows"\]/);
});
