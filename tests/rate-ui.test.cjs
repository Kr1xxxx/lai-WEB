const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const B = require('../src/business-model.js');
const L = require('../src/modules.js');
const R = require('../src/role-model.js');
const RT = require('../src/rate-model.js');
const { escapeHtml } = require('../src/model.js');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

// The 汇率设置 page, registered as LaiExtraPages.rates and driven through the real business-ui.js registry.
function setup(state, { withRoles = false } = {}) {
  const calls = { mount: [], toast: [], saved: [] };
  const listeners = new Map();
  const document = {
    addEventListener(kind, callback) { const list = listeners.get(kind) || []; list.push(callback); listeners.set(kind, list); },
    getElementById() { return null; },
    querySelectorAll() { return []; },
    // After the first mount the page is on screen, so a re-render keeps the row being edited.
    querySelector(sel) { return sel === '.rate-page' && calls.mount.some((html) => html.includes('rate-page')) ? {} : null; },
  };
  const window = { LaiBusinessModel: B, LaiModules: L, LaiRateModel: RT, ...(withRoles ? { LaiRoleModel: R } : {}) };
  const context = { window, document, FormData: class {}, crypto: require('node:crypto').webcrypto };
  vm.createContext(context);
  vm.runInContext(read('src/business-ui.js'), context);
  vm.runInContext(read('src/rate-ui.js'), context);
  const controller = window.LaiBusinessUI.create({
    getState: () => state, escape: escapeHtml, mount: (html) => calls.mount.push(html), dialog() {}, closeDialog() {},
    save: async (next) => { calls.saved.push(next); state = next; }, toast: (message) => calls.toast.push(message), navigate() {}, openCustomer() {},
    isActive: () => true,
  });
  const emit = (kind, event) => { for (const fn of listeners.get(kind) || []) fn(event); };
  const button = (dataset) => ({ target: { closest: (sel) => (sel === '[data-rate-action]' ? { dataset } : null), dataset }, preventDefault() {} });
  const form = (id, values, dataset = {}) => ({ target: { id, dataset, elements: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { value: v }])), closest: () => null }, preventDefault() {} });
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  return { window, controller, calls, emit, button, form, flush, getState: () => state, last: () => calls.mount.at(-1) };
}

const seed = () => ({
  customers: { A: { currency: 'GBP' } },
  orders: [{ id: '1', num: 'N1', client: 'A', currency: 'EUR', amount: 10 }],
  laiSettings: { defaultOwner: 'Kris', rates: { list: [{ code: 'CNY', usd100: 14, updatedAt: '2026-10-01' }, { code: 'EUR', usd100: 108, updatedAt: '2026-10-02' }] } },
});

test('the page registers itself as LaiExtraPages.rates and renders the table, the missing codes and the footer', () => {
  const h = setup(seed());
  assert.equal(typeof h.window.LaiExtraPages.rates.render, 'function');
  assert.equal(h.window.LaiExtraPages.rates.title, '汇率设置');
  h.controller.navigate('rates');
  const html = h.last();
  assert.match(html, /<h1>汇率设置<\/h1>/);
  for (const head of ['币种', '每 100 折合美元', '折合人民币', '更新日期']) assert.ok(html.includes(`<th>${head}</th>`), head);
  assert.match(html, /data-rate-row="USD"[\s\S]*?<td>100<\/td><td>714\.2857<\/td>/);
  assert.match(html, /data-rate-row="EUR"[\s\S]*?<td>108<\/td><td>771\.4286<\/td><td>2026-10-02<\/td>/);
  assert.match(html, /data-rate-row="GBP" class="rate-missing"[\s\S]*?未设置/, 'a code in use without a rate shows 未设置');
  assert.match(html, /改汇率不会改已经保存的订单。/);
  assert.match(html, /id="rate-add-form"/);
  assert.doesNotMatch(html, /data-rate-row="USD"[^]*?data-rate-action="delete" data-code="USD"/);
});

test('an empty table shows only the fixed USD row and no preset rates', () => {
  const h = setup({ orders: [], customers: {}, laiSettings: {} });
  h.controller.navigate('rates');
  const html = h.last();
  assert.equal((html.match(/data-rate-row=/g) || []).length, 1);
  assert.match(html, /data-rate-row="USD"/);
});

test('adding, editing and deleting go through ctx.save; mistakes show in the error line without saving', async () => {
  const h = setup(seed());
  h.controller.navigate('rates');
  h.emit('submit', h.form('rate-add-form', { code: 'jpy', usd100: '0.67' }));
  await h.flush();
  assert.equal(h.calls.saved.length, 1);
  assert.deepEqual(RT.stored(h.getState()).map((r) => [r.code, r.usd100]), [['CNY', 14], ['EUR', 108], ['JPY', 0.67]]);
  assert.match(h.last(), /data-rate-row="JPY"/);
  assert.deepEqual(h.calls.toast, ['已保存到来财']);

  h.emit('submit', h.form('rate-add-form', { code: 'EU', usd100: '1' }));
  await h.flush();
  assert.equal(h.calls.saved.length, 1);
  assert.match(h.last(), /id="rate-error" role="alert">币种代码是 3 个英文字母/);

  h.emit('click', h.button({ rateAction: 'edit', code: 'EUR' }));
  assert.match(h.last(), /<form id="rate-edit-form" data-code="EUR" hidden>/);
  assert.match(h.last(), /name="usd100" form="rate-edit-form" value="108"/);
  h.emit('submit', h.form('rate-edit-form', { usd100: '1.1234567' }, { code: 'EUR' }));
  await h.flush();
  assert.equal(h.calls.saved.length, 1, 'too many decimals');
  assert.match(h.last(), /最多 6 位小数/);
  h.emit('submit', h.form('rate-edit-form', { usd100: '110' }, { code: 'EUR' }));
  await h.flush();
  assert.equal(RT.rateFor(h.getState(), 'EUR'), 110);
  assert.doesNotMatch(h.last(), /data-code="EUR" hidden/);

  // EUR is used by an order: deleting is refused with the reason.
  h.emit('click', h.button({ rateAction: 'delete', code: 'EUR' }));
  assert.match(h.last(), /还有1 笔订单在用 EUR，不能删除/);
  // JPY is unused: the first click arms, the second deletes.
  h.emit('click', h.button({ rateAction: 'delete', code: 'JPY' }));
  assert.match(h.last(), /data-code="JPY">确认删除/);
  assert.equal(h.calls.saved.length, 2);
  h.emit('click', h.button({ rateAction: 'delete', code: 'JPY' }));
  await h.flush();
  assert.equal(RT.rateFor(h.getState(), 'JPY'), null);
  assert.equal(h.calls.saved.length, 3);
});

test('the 设置 button on a missing code fills that code in place', async () => {
  const h = setup(seed());
  h.controller.navigate('rates');
  h.emit('click', h.button({ rateAction: 'edit', code: 'GBP' }));
  assert.match(h.last(), /data-rate-row="GBP" class="rate-missing"><td><span class="currency-badge">GBP<\/span><\/td><td><input class="rate-input" name="usd100"/);
  h.emit('submit', h.form('rate-edit-form', { usd100: '127' }, { code: 'GBP' }));
  await h.flush();
  assert.equal(RT.rateFor(h.getState(), 'GBP'), 127);
});

test('a 业务 account cannot open the page (settings.rate is admin-only by default)', () => {
  const state = { ...seed(), customers: { a: { owner: 'Amy' } } };
  const sales = R.switchTo(state, R.settings(state).members.find((m) => m.name === 'Amy').id);
  const h = setup(sales, { withRoles: true });
  h.controller.navigate('rates');
  assert.doesNotMatch(h.last(), /rate-add-form/);
  assert.match(h.last(), /没有权限/);
});

test('the page files are wired into the build, the rail and the settings center', () => {
  const build = read('scripts/build.py'), template = read('src/template.html');
  for (const [marker, file] of [['RATE_MODEL', 'rate-model.js'], ['RATE_UI', 'rate-ui.js'], ['RATE_STYLE', 'rate.css']]) {
    assert.ok(template.includes(`<!--${marker}-->`), marker);
    assert.ok(build.includes(`('<!--${marker}-->','${file}'`), file);
  }
  assert.ok(template.indexOf('<!--RATE_MODEL-->') < template.indexOf('<!--PREVIEW_MODEL-->'), 'the rate model loads before model.js');
  assert.ok(template.indexOf('<!--LAI_BUSINESS_UI-->') < template.indexOf('<!--RATE_UI-->'));
  const RM = require('../src/rail-menu.js');
  assert.equal(RM.sectionFor('rates').label, '交易');
  const Hub = require('../src/settings-hub.js');
  const item = Hub.GROUPS.flatMap((g) => g.items).find((i) => i.id === 'rates');
  assert.deepEqual([item.open, item.perm], [['route', 'rates'], 'settings.rate']);
});
