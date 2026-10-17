const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const B = require('../src/business-model.js');
const L = require('../src/modules.js');
const { escapeHtml } = require('../src/model.js');

const source = fs.readFileSync(path.join(__dirname, '../src/business-ui.js'), 'utf8');
const decode = value => String(value || '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const attributes = text => Object.fromEntries([...text.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(([, key, value]) => [key, decode(value ?? '')]));

// A small DOM boundary for controller tests: parse its actual form markup,
// dispatch registered events, and emulate button default submission.
function harness({ failSave = false, clock, customers, tasks, orders } = {}) {
  let state = { orders: [{ id: 'order-1', num: 'L-1', client: 'Synthetic Customer', createdAt: '2026-09-22', orderMonth: '2026-09', currency: 'USD', stage: 'quote', amount: 10, paidAmount: 0, note: 'saved note', isDraft: false }], customers: { 'Synthetic Customer': {} }, laiSettings: { companyName: 'Saved Company' } };
  let page = [], overlay = [], pageHtml = '', dialogHtml = '', saveCalls = 0, closeCalls = 0;
  const returnedCustomers = [];
  const listeners = new Map();
  function parse(html) {
    const forms = [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)].map(match => ({ id: attributes(match[1]).id, start: match.index, end: match.index + match[0].length, elements: {} }));
    const nodes = forms.slice();
    for (const match of html.matchAll(/<(input|select|textarea|button)\b([^>]*)(?:>([\s\S]*?)<\/\1>|>)/g)) {
      const [, tag, text, inner = ''] = match, attrs = attributes(text);
      const form = forms.find(f => f.id === attrs.form) || forms.find(f => match.index > f.start && match.index < f.end);
      const node = { tagName: tag.toUpperCase(), id: attrs.id || '', name: attrs.name || '', type: attrs.type || (tag === 'button' ? 'submit' : 'text'), disabled: Object.hasOwn(attrs, 'disabled'), checked: Object.hasOwn(attrs, 'checked'), value: attrs.value || '', dataset: {}, form, attrs };
      for (const [key, value] of Object.entries(attrs)) if (key.startsWith('data-')) node.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
      if (tag === 'textarea') node.value = decode(inner);
      if (tag === 'select') {
        const options = [...inner.matchAll(/<option\b([^>]*)>/g)].map(m => attributes(m[1]));
        node.value = (options.find(o => Object.hasOwn(o, 'selected')) || options[0] || {}).value || '';
      }
      node.closest = selector => selector === 'button' ? (tag === 'button' ? node : null) : selector === '#' + form?.id ? form : null;
      if (form && node.name) form.elements[node.name] = node;
      nodes.push(node);
    }
    for (const [, id] of html.matchAll(/<div\b[^>]*id="([^"]+)"[^>]*>/g)) nodes.push({ id, textContent: '', classList: { add() {} } });
    return nodes;
  }
  const document = {
    addEventListener(kind, callback) { const list = listeners.get(kind) || []; list.push(callback); listeners.set(kind, list); },
    getElementById(id) { if (!id) return null; return [...overlay, ...page].find(node => node.id === id) || null; },
    querySelectorAll() { return [...page, ...overlay].filter(node => ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(node.tagName)); },
  };
  class FormData {
    constructor(form) { this.entries = Object.values(form.elements).filter(el => !el.disabled && (el.type !== 'checkbox' || el.checked)).map(el => [el.name, el.type === 'checkbox' ? el.value || 'on' : el.value]); }
    [Symbol.iterator]() { return this.entries[Symbol.iterator](); }
  }
  if (customers) state.customers = customers;
  if (tasks) state.laiTasks = tasks;
  if (orders) state.orders = orders;
  // Control only the wall clock; actual date arithmetic remains native.
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.instant])); this.wallClock = args.length === 0; }
    getFullYear() { return this.wallClock ? clock.year : super.getFullYear(); }
    getMonth() { return this.wallClock ? clock.month - 1 : super.getMonth(); }
    getDate() { return this.wallClock ? clock.day : super.getDate(); }
  }
  const context = { window: { LaiBusinessModel: B, LaiModules: L, LaiWorkbench: require('../src/workbench.js'), LaiOrdersPage: require('../src/orders-page.js') }, document, FormData, crypto: webcrypto, ...(clock ? { Date: ClockDate } : {}) };
  vm.createContext(context);
  if (clock) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/business-model.js'), 'utf8'), context);
  vm.runInContext(source, context);
  const controller = context.window.LaiBusinessUI.create({
    getState: () => state, escape: escapeHtml,
    mount(html) { pageHtml = html; page = parse(html); },
    dialog(title, body, footer) { dialogHtml = body + footer; overlay = parse(dialogHtml); },
    closeDialog() { closeCalls++; overlay = []; },
    async save(next) { saveCalls++; if (failSave) throw new Error('Synthetic save failure'); state = next; },
    toast() {}, navigate() {}, openCustomer() {}, refreshCustomer(name) { returnedCustomers.push(name); },
  });
  async function emit(kind, target) {
    const event = { target, preventDefault() { this.defaultPrevented = true; } };
    for (const fn of listeners.get(kind) || []) await fn(event);
    if (kind === 'click' && !event.defaultPrevented && target.type === 'submit' && target.form) await emit('submit', target.form);
  }
  return {
    controller, document, emit, returnedCustomers,
    replaceState(next) { state = next; },
    action(name) { const node = [...overlay, ...page].find(node => node.dataset?.bizAction === name); assert.ok(node, `Rendered action ${name} exists`); return node; },
    async click(name) { await emit('click', this.action(name)); },
    async openOrder() { await emit('click', { disabled: false, dataset: { bizOrder: 'order-1' }, closest() { return this; } }); },
    get saveCalls() { return saveCalls; }, get closeCalls() { return closeCalls; }, get state() { return state; }, get pageHtml() { return pageHtml; }, get dialogHtml() { return dialogHtml; },
  };
}

test('settings cancel is a non-submit button, discards unsaved input and releases the draft guard', async () => {
  const h = harness(); h.controller.navigate('settings');
  const form = h.document.getElementById('biz-settings-form');
  form.elements.orderPrefix.value = 'ZZ';
  await h.emit('input', form.elements.orderPrefix);
  assert.equal(h.controller.hasDraft(), true);
  assert.equal(h.action('discard-settings').type, 'button');
  await h.click('discard-settings');
  assert.equal(h.saveCalls, 0);
  assert.equal(h.controller.hasDraft(), false);
  assert.equal(h.document.getElementById('biz-settings-form').elements.orderPrefix.value, 'L');
});

test('cancelling archive restores unsaved order values and keeps the draft guard until explicit cancellation', async () => {
  const h = harness(); await h.openOrder();
  const form = h.document.getElementById('biz-order-form');
  form.elements.amount.value = '42.50';
  form.elements.note.value = 'Unsaved <note> & "quote"';
  form.elements.currency.value = 'EUR';
  form.elements.isDraft.checked = true;
  await h.click('archive-order');
  assert.equal(h.controller.hasDraft(), true);
  assert.equal(h.document.getElementById('biz-order-form'), null);
  await h.click('cancel-archive');
  const restored = h.document.getElementById('biz-order-form');
  assert.equal(restored.elements.amount.value, '42.50');
  assert.equal(restored.elements.note.value, 'Unsaved <note> & "quote"');
  assert.equal(restored.elements.currency.value, 'EUR');
  assert.equal(restored.elements.isDraft.checked, true);
  assert.equal(h.controller.hasDraft(), true);
  assert.equal(h.saveCalls, 0);
  assert.equal(h.state.orders[0].amount, 10);
  await h.click('close-editor');
  assert.equal(h.controller.hasDraft(), false);
});

test('failed order save keeps edited fields, restores controls and continues to guard the draft', async () => {
  const h = harness({ failSave: true }); await h.openOrder();
  const form = h.document.getElementById('biz-order-form');
  form.elements.amount.value = '33'; form.elements.note.value = 'Retry this note';
  await h.emit('submit', form);
  assert.equal(h.saveCalls, 1);
  assert.equal(h.closeCalls, 0);
  assert.equal(h.controller.hasDraft(), true);
  assert.equal(form.elements.note.value, 'Retry this note');
  assert.equal(form.elements.amount.disabled, false);
  assert.equal(h.document.getElementById('biz-order-error').textContent, 'Synthetic save failure');
  assert.equal(h.state.orders[0].amount, 10);
  h.controller.discardDraft();
  assert.equal(h.controller.hasDraft(), false);
});

test('saving an order preserves the current table scroll while clear filters resets it', async () => {
  const h = harness(); h.controller.navigate('order-list');
  const viewport = h.document.getElementById('biz-order-scroll');
  assert.ok(viewport, 'Rendered order viewport exists');
  viewport.scrollTop = 400; viewport.scrollLeft = 200;
  await h.openOrder();
  const form = h.document.getElementById('biz-order-form');
  form.elements.note.value = 'Saved without losing list position';
  await h.emit('submit', form);
  const restored = h.document.getElementById('biz-order-scroll');
  assert.equal(restored.scrollTop, 400); assert.equal(restored.scrollLeft, 200);
  assert.equal(h.state.orders[0].note, 'Saved without losing list position');
  assert.equal(h.saveCalls, 1);
  await h.click('clear-filters');
  assert.ok(!h.document.getElementById('biz-order-scroll').scrollTop);
  assert.ok(!h.document.getElementById('biz-order-scroll').scrollLeft);
});

const midnightClock = { instant: '2026-09-30T16:30:00Z', year: 2026, month: 10, day: 1 };

test('calendar initially shows the local month after midnight at a month boundary', () => {
  const h = harness({ clock: midnightClock }); h.controller.navigate('calendar');
  assert.equal(h.document.getElementById('biz-month').value, '2026-10');
});

test('analysis initially uses the local month rather than the previous UTC month', () => {
  const h = harness({ clock: midnightClock }); h.controller.navigate('analysis');
  assert.equal(h.document.getElementById('biz-month').value, '2026-10');
});

for (const route of ['calendar', 'analysis']) {
  test(`${route} restores the displayed month after clearing the month picker without saving`, async () => {
    const h = harness({ clock: midnightClock }); h.controller.navigate(route);
    let input = h.document.getElementById('biz-month');
    input.value = '2026-09';
    await h.emit('change', input);
    const before = h.pageHtml;
    input = h.document.getElementById('biz-month');
    input.value = '';
    await h.emit('change', input);
    assert.equal(h.document.getElementById('biz-month').value, '2026-09');
    assert.equal(h.pageHtml, before);
    assert.equal(h.saveCalls, 0);
  });
}

test('dashboard includes followups due today locally and excludes tomorrow', () => {
  const h = harness({ clock: midnightClock, customers: {
    'Due Today': { nextFollow: '2026-10-01' }, 'Due Yesterday': { nextFollow: '2026-09-30' },
    'Due Tomorrow': { nextFollow: '2026-10-02' }, 'Archived Due': { nextFollow: '2026-10-01', laiBucket: 'trash' },
  } }); h.controller.navigate('dashboard');
  assert.match(h.pageHtml, /data-biz-customer="Due Today"/);
  assert.match(h.pageHtml, /data-biz-customer="Due Yesterday"/);
  assert.doesNotMatch(h.pageHtml, /data-biz-customer="Due Tomorrow"|data-biz-customer="Archived Due"/);
  assert.equal(h.saveCalls, 0);
});

test('new order date and generated number use the same local calendar day', async () => {
  const h = harness({ clock: midnightClock }); h.controller.navigate('order-list'); await h.click('new-order');
  const form = h.document.getElementById('biz-order-form');
  assert.equal(form.elements.createdAt.value, '2026-10-01');
  // The only saved order has another style of number, so today's first number is free (it used to be count + 1).
  assert.equal(form.elements.num.value, 'L20261001-001');
  await h.click('close-editor'); assert.equal(h.saveCalls, 0);
});

test('the suggested order number follows the highest number used today, including archived orders', async () => {
  const common = { client: 'Synthetic Customer', createdAt: '2026-10-01', orderMonth: '2026-10', currency: 'USD', stage: 'quote', amount: 10, paidAmount: 0, isDraft: false };
  const h = harness({ clock: midnightClock, orders: [{ ...common, id: 'a', num: 'L20261001-001' }] });
  h.replaceState({ ...h.state, trashOrders: [{ ...common, id: 'b', num: 'L20261001-002', trashedAt: '2026-10-01T00:00:00.000Z' }] });
  h.controller.navigate('order-list'); await h.click('new-order');
  assert.equal(h.document.getElementById('biz-order-form').elements.num.value, 'L20261001-003');
  await h.click('close-editor');
});

test('new task defaults to today locally and retains an explicitly selected calendar date', async () => {
  const h = harness({ clock: midnightClock }); h.controller.navigate('calendar'); await h.click('new-task');
  assert.equal(h.document.getElementById('biz-task-form').elements.date.value, '2026-10-01');
  await h.click('close-editor'); h.controller.selectCalendarDate('2026-10-09'); await h.click('new-task');
  assert.equal(h.document.getElementById('biz-task-form').elements.date.value, '2026-10-09');
  await h.click('close-editor'); assert.equal(h.saveCalls, 0);
});


test('failed dashboard completion restores the checkbox and preserves the saved task', async () => {
  const task = { id: 'pending-task', title: 'Pending task', date: '2026-09-14', done: false, unknown: { keep: 1 } };
  const h = harness({ failSave: true, tasks: [task] }); h.controller.navigate('dashboard');
  const checkbox = h.document.querySelectorAll().find(node => node.dataset?.bizTask === task.id);
  checkbox.checked = true;
  await h.emit('change', checkbox);
  await new Promise(setImmediate);
  assert.equal(h.saveCalls, 1);
  assert.equal(checkbox.checked, false, 'Failed save cannot leave an unsaved completion check');
  assert.equal(checkbox.disabled, false);
  assert.deepEqual(h.state.laiTasks[0], task);
  assert.equal(h.closeCalls, 0);
});

test('successful dashboard completion preserves task metadata and removes it from pending view', async () => {
  const task = { id: 'pending-task', title: 'Pending task', date: '2026-09-14', done: false, unknown: { keep: 1 } };
  const h = harness({ tasks: [task] }); h.controller.navigate('dashboard');
  const checkbox = h.document.querySelectorAll().find(node => node.dataset?.bizTask === task.id);
  checkbox.checked = true;
  await h.emit('change', checkbox);
  await new Promise(setImmediate);
  assert.equal(h.saveCalls, 1);
  assert.equal(h.state.laiTasks[0].done, true);
  assert.deepEqual(h.state.laiTasks[0].unknown, task.unknown);
  assert.doesNotMatch(h.pageHtml, /data-biz-task="pending-task"/);
});

function analysisBars(html) {
  return [...html.matchAll(/<div><span>([^<]+)<\/span><div><i style="width:(\d+)%"><\/i><\/div><b>(\d+)<\/b><\/div>/g)].map(([, label, percent, count]) => ({label,percent:Number(percent),count:Number(count)}));
}
test('analysis stage proportions exclude drafts from both stage counts and denominator', () => {
  const common={client:'Synthetic Customer',currency:'USD',amount:100,createdAt:'2026-10-01',orderMonth:'2026-10'};
  const h=harness({clock:midnightClock,orders:[{...common,stage:'quote'},{...common,stage:'quote'},{...common,stage:'production'},{...common,stage:'quote',isDraft:true},{...common,stage:'done',orderMonth:'2026-09'}]});
  h.controller.navigate('analysis');
  assert.deepEqual(analysisBars(h.pageHtml),[{label:'报价',percent:67,count:2},{label:'定金',percent:0,count:0},{label:'生产中',percent:33,count:1},{label:'尾款',percent:0,count:0},{label:'已发货',percent:0,count:0},{label:'已完成',percent:0,count:0}]);
  assert.equal(h.saveCalls,0);
});
test('analysis stage bars remain zero when the selected month contains drafts only', () => {
  const h=harness({clock:midnightClock,orders:[{stage:'quote',isDraft:true,orderMonth:'2026-10',amount:999}]});h.controller.navigate('analysis');
  assert.equal(analysisBars(h.pageHtml).length,6);assert.ok(analysisBars(h.pageHtml).every(row=>row.percent===0&&row.count===0));assert.match(h.pageHtml,/本月暂无订单/);assert.equal(h.saveCalls,0);
});

// Editing a stale rendered id must not create a new record or replace a draft.
test('stale rendered order entry refuses a missing order instead of opening a new order', async () => {
  const h = harness(); h.controller.navigate('order-list');
  const entry = h.document.querySelectorAll().find(el => el.dataset.bizOrder === 'order-1');
  assert.ok(entry); const next = { ...h.state, orders: [] }; h.replaceState(next);
  await h.emit('click', entry);
  assert.equal(h.document.getElementById('biz-order-form'), null);
  assert.equal(h.controller.hasDraft(), false);
  assert.equal(h.saveCalls, 0); assert.deepEqual(h.state, next);
});

test('missing order id does not overwrite an existing unsaved order form', async () => {
  const h = harness(); await h.openOrder();
  const form = h.document.getElementById('biz-order-form'); form.elements.note.value = 'Keep this draft';
  h.controller.openOrder('missing-order');
  assert.equal(h.document.getElementById('biz-order-form'), form);
  assert.equal(form.elements.note.value, 'Keep this draft');
  assert.equal(h.controller.hasDraft(), true); assert.equal(h.saveCalls, 0);
});

test('explicit invalid order ids cannot act as the no-id new order action', () => {
  for (const id of ['', null, 'missing-order']) {
    const h = harness(); h.controller.openOrder(id);
    assert.equal(h.document.getElementById('biz-order-form'), null);
    assert.equal(h.controller.hasDraft(), false); assert.equal(h.saveCalls, 0);
  }
});

test('stale rendered task entry refuses a removed task instead of opening an add form', async () => {
  const h = harness({ clock: { instant: '2026-09-22T04:00:00Z', year: 2026, month: 9, day: 22 }, tasks: [{ id: 'task-stale', title: 'Existing task', date: '2026-09-22', done: false }] });
  h.controller.navigate('calendar');
  const entry = h.document.querySelectorAll().find(el => el.dataset.bizEditTask === 'task-stale');
  assert.ok(entry); const next = { ...h.state, laiTasks: [] }; h.replaceState(next);
  await h.emit('click', entry);
  assert.equal(h.document.getElementById('biz-task-form'), null);
  assert.equal(h.controller.hasDraft(), false); assert.equal(h.saveCalls, 0); assert.deepEqual(h.state, next);
});

test('explicit new order and new task actions still open their existing empty forms', async () => {
  const h = harness(); h.controller.navigate('order-list'); await h.click('new-order');
  assert.equal(h.document.getElementById('biz-order-form').elements.client.value, '');
  await h.click('close-editor'); h.controller.navigate('calendar'); await h.click('new-task');
  assert.equal(h.document.getElementById('biz-task-form').elements.title.value, '');
  assert.equal(h.controller.hasDraft(), true); assert.equal(h.saveCalls, 0);
});


test('customer-detail new order uses the existing editable customer field and cancellation preserves data', async () => {
  const h = harness(); const before = structuredClone(h.state);
  h.controller.createOrderForCustomer('Synthetic Customer');
  const form = h.document.getElementById('biz-order-form');
  assert.ok(form); assert.equal(form.elements.client.value, 'Synthetic Customer');
  assert.equal(form.elements.amount.value, ''); assert.equal(form.elements.client.disabled, false);
  assert.equal(h.controller.hasDraft(), true);
  await h.click('close-editor');
  assert.equal(h.saveCalls, 0); assert.deepEqual(h.state, before);
  assert.deepEqual(h.returnedCustomers, ['Synthetic Customer']);
  assert.equal(h.controller.hasDraft(), false);
});

test('customer-detail order saves the existing model once and returns to the originating customer', async () => {
  const h = harness(); const original = structuredClone(h.state.customers);
  h.controller.createOrderForCustomer('Synthetic Customer');
  const form = h.document.getElementById('biz-order-form'); form.elements.amount.value = '25';
  await h.emit('submit', form);
  assert.equal(h.saveCalls, 1); assert.equal(h.state.orders.length, 2);
  const created = h.state.orders.find(order => order.id !== 'order-1');
  assert.equal(created.client, 'Synthetic Customer');
  assert.equal(created.amount, 25);
  assert.deepEqual(h.state.customers, original);
  assert.deepEqual(h.returnedCustomers, ['Synthetic Customer']);
  assert.equal(h.pageHtml, '', 'customer detail is not replaced by the business dashboard');
});

test('customer-detail order rejects stale or recycled customers and retains the form on save failure', async () => {
  const h = harness({failSave:true});
  const recycled = harness({customers:{Recycled:{laiBucket:'trash'}}});
  recycled.controller.createOrderForCustomer('Recycled'); assert.equal(recycled.dialogHtml, '');
  h.controller.createOrderForCustomer('Missing'); assert.equal(h.dialogHtml, '');
  h.controller.createOrderForCustomer('Synthetic Customer');
  const form = h.document.getElementById('biz-order-form'); form.elements.amount.value = '25';
  await h.emit('submit', form);
  assert.equal(h.saveCalls, 1); assert.equal(h.state.orders.length, 1);
  assert.equal(h.document.getElementById('biz-order-form').elements.amount.value, '25');
  assert.deepEqual(h.returnedCustomers, []); assert.equal(h.controller.hasDraft(), true);
});


test('customer-detail order accepts an order-derived customer, cancels without creating a profile and saves through the existing model', async () => {
  const h = harness({customers:{}}), before = structuredClone(h.state);
  h.controller.createOrderForCustomer('Synthetic Customer');
  let form = h.document.getElementById('biz-order-form');
  assert.ok(form); assert.equal(form.elements.client.value, 'Synthetic Customer');
  await h.click('close-editor');
  assert.equal(h.saveCalls, 0); assert.deepEqual(h.state, before);
  h.controller.createOrderForCustomer('Synthetic Customer');
  form = h.document.getElementById('biz-order-form'); form.elements.amount.value = '25';
  await h.emit('submit', form);
  assert.equal(h.saveCalls, 1); assert.equal(h.state.orders.length, 2);
  assert.deepEqual(h.state.orders.find(order => order.id === 'order-1'), before.orders[0]);
  assert.equal(h.state.orders.find(order => order.id !== 'order-1').client, 'Synthetic Customer');
  assert.equal(h.state.customers['Synthetic Customer'].client, 'Synthetic Customer');
  assert.deepEqual(h.returnedCustomers, ['Synthetic Customer', 'Synthetic Customer']);
});

test('customer-detail order rejects inherited names and customers present only in archived orders', () => {
  const h = harness({customers:{},orders:[]});
  h.controller.createOrderForCustomer('toString'); assert.equal(h.dialogHtml, '');
  h.replaceState({...h.state, trashOrders:[{id:'archived',client:'Archived Customer'}]});
  h.controller.createOrderForCustomer('Archived Customer'); assert.equal(h.dialogHtml, '');
  const recycled = harness({customers:{'Synthetic Customer':{laiBucket:'trash'}}});
  recycled.controller.createOrderForCustomer('Synthetic Customer'); assert.equal(recycled.dialogHtml, '');
  assert.equal(h.saveCalls, 0); assert.equal(recycled.saveCalls, 0);
});
test('analysis customer contributions merge legacy currency spelling the same way as the money summary', () => {
  const common={client:'Synthetic Customer',stage:'quote',createdAt:'2026-10-01',orderMonth:'2026-10'};
  const h=harness({clock:midnightClock,orders:[{...common,currency:'USD',amount:100},{...common,currency:' usd ',amount:50}]});
  h.controller.navigate('analysis');
  const contribution=h.pageHtml.slice(h.pageHtml.indexOf('<h3>客户贡献</h3>'));
  const rows=[...contribution.matchAll(/<tr><td>.*?<\/tr>/g)].map(match=>match[0]);
  assert.equal(rows.length,1);
  assert.match(rows[0],/<td>2<\/td><td>150\.00 USD<\/td><\/tr>$/);
  assert.equal(h.saveCalls,0);
});

test('the settings form refuses an order prefix with other characters and keeps the old value', async () => {
  const h = harness(); h.controller.navigate('settings');
  assert.match(h.pageHtml, /pattern="\[A-Za-z0-9\\-\]\+"/, 'the hyphen is escaped so the v-flag accepts the pattern');
  const form = h.document.getElementById('biz-settings-form');
  form.elements.orderPrefix.value = 'A_B';
  await h.emit('submit', form);
  assert.equal(h.saveCalls, 0);
  assert.equal(h.state.laiSettings.orderPrefix, undefined);
  form.elements.orderPrefix.value = ' AB-1 ';
  await h.emit('submit', form);
  assert.equal(h.saveCalls, 1);
  assert.equal(h.state.laiSettings.orderPrefix, 'AB-1');
});
