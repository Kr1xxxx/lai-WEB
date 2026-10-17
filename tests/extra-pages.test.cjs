const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const B = require('../src/business-model.js');
const L = require('../src/modules.js');
const R = require('../src/role-model.js');
const { escapeHtml } = require('../src/model.js');

const source = fs.readFileSync(path.join(__dirname, '../src/business-ui.js'), 'utf8');

// The page registry in business-ui.js: LaiExtraPages[route] is rendered next to the built-in views and receives
// click / input / change / submit events while that route is showing.
function setup({ state = { orders: [], customers: {}, laiSettings: { defaultOwner: 'Kris' } }, active = true, withRoles = false } = {}) {
  const listeners = new Map();
  const document = {
    addEventListener(kind, callback) { const list = listeners.get(kind) || []; list.push(callback); listeners.set(kind, list); },
    getElementById() { return null; },
    querySelectorAll() { return []; },
  };
  const window = { LaiBusinessModel: B, LaiModules: L, ...(withRoles ? { LaiRoleModel: R } : {}) };
  const context = { window, document, FormData: class {}, crypto: require('node:crypto').webcrypto };
  vm.createContext(context);
  vm.runInContext(source, context);
  const calls = { mount: [], toast: [] };
  let isActive = active;
  const controller = window.LaiBusinessUI.create({
    getState: () => state, escape: escapeHtml, mount: html => calls.mount.push(html), dialog() {}, closeDialog() {},
    save: async next => { state = next; }, toast: message => calls.toast.push(message), navigate() {}, openCustomer() {},
    isActive: () => isActive,
  });
  const emit = (kind, event) => { for (const fn of listeners.get(kind) || []) fn(event); };
  return { window, controller, calls, emit, setActive: value => { isActive = value; }, getState: () => state };
}

const buttonEvent = () => ({ target: { closest: selector => (selector === 'button' ? null : null), id: 'x', dataset: {} } });

test('the registry exists on window and a fake page renders in the main area with the shared ctx', () => {
  const h = setup();
  assert.deepEqual({ ...h.window.LaiExtraPages }, {});
  let seen = null;
  h.window.LaiExtraPages.fake = {
    render(c) { seen = c; return `<section>fake ${c.escape('<b>')} ${c.can('lead.view')}</section>`; },
    afterRender(c) { h.calls.after = c.route(); },
  };
  h.controller.navigate('fake');
  assert.deepEqual(h.calls.mount, ['<section>fake &lt;b&gt; true</section>']);
  assert.equal(h.calls.after, 'fake');
  for (const key of ['getState', 'save', 'toast', 'dialog', 'closeDialog', 'escape', 'state', 'can', 'need', 'sees', 'scoped', 'refresh', 'route']) assert.equal(typeof seen[key], 'function', key);
  assert.equal(seen.state(), h.getState());
});

test('a page that mounts itself (returns no string) is not mounted twice; refresh() renders it again', () => {
  const h = setup();
  let renders = 0;
  h.window.LaiExtraPages.fake = { render() { renders++; } };
  h.controller.navigate('fake');
  h.controller.refresh();
  assert.equal(renders, 2);
  assert.equal(h.calls.mount.length, 0);
});

test('click, input, change and submit go to the page of the current route; returning true stops the built-in handlers', () => {
  const h = setup();
  const log = [];
  h.window.LaiExtraPages.fake = {
    render: () => '<p>x</p>',
    click: (c, e) => { log.push(['click', e.target.id, typeof c.toast]); return true; },
    input: (c, e) => { log.push(['input', e.target.id]); return true; },
    change: (c, e) => { log.push(['change', e.target.id]); return true; },
    submit: (c, e) => { log.push(['submit', e.target.id]); return true; },
  };
  h.controller.navigate('fake');
  const event = id => ({ target: { id, dataset: {}, closest: () => null }, preventDefault() {} });
  h.emit('click', event('a'));
  h.emit('input', event('b'));
  h.emit('change', event('c'));
  h.emit('submit', event('d'));
  assert.deepEqual(log, [['click', 'a', 'function'], ['input', 'b'], ['change', 'c'], ['submit', 'd']]);
});

test('events are not forwarded on other routes, to a page that is not showing, or for a route without a page', () => {
  const h = setup();
  let hits = 0;
  h.window.LaiExtraPages.fake = { render: () => '<p>x</p>', click: () => { hits++; return true; } };
  h.controller.navigate('dashboard');
  h.emit('click', buttonEvent());
  assert.equal(hits, 0, 'dashboard has no registered page');
  h.controller.navigate('fake');
  h.setActive(false); // the customer or mail page is showing
  h.emit('click', buttonEvent());
  assert.equal(hits, 0, 'not a business page right now');
  h.setActive(true);
  h.emit('click', buttonEvent());
  assert.equal(hits, 1);
});

test('a registered page cannot replace a built-in page, and an unknown route still falls back to the dashboard', () => {
  const h = setup();
  h.window.LaiExtraPages.calendar = { render: () => '<p>hijacked</p>' };
  h.controller.navigate('calendar');
  assert.ok(!h.calls.mount.at(-1).includes('hijacked'));
  h.controller.navigate('nothing-here');
  assert.ok(h.calls.mount.at(-1).length > 0 && !h.calls.mount.at(-1).includes('hijacked'));
});

test('role permissions still gate a registered route through PAGE_PERMS', () => {
  const state = { orders: [], customers: { a: { owner: 'Amy' } }, laiSettings: { defaultOwner: 'Kris' } };
  const sales = R.switchTo(state, R.settings(state).members.find(m => m.name === 'Amy').id);
  assert.equal(R.isAdmin(sales), false);
  const h = setup({ state: sales, withRoles: true });
  h.window.LaiExtraPages['feature-switch'] = { render: () => '<p>secret page</p>' };
  h.window.LaiExtraPages.chats = { render: () => '<p>chats page</p>' };
  h.controller.navigate('feature-switch');
  assert.ok(!h.calls.mount.at(-1).includes('secret page'));
  assert.match(h.calls.mount.at(-1), /没有权限/);
  h.controller.navigate('chats');
  assert.match(h.calls.mount.at(-1), /chats page/);
});

test('broken registry entries are ignored instead of throwing', () => {
  const h = setup();
  h.window.LaiExtraPages.weird = 'not an object';
  h.window.LaiExtraPages.empty = {};
  h.controller.navigate('weird');
  h.controller.navigate('empty');
  h.emit('click', buttonEvent());
  assert.ok(h.calls.mount.length >= 2);
});
