const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const B = require('../src/business-model.js');
const L = require('../src/modules.js');
const Hub = require('../src/settings-hub.js');
const { escapeHtml } = require('../src/model.js');

const source = fs.readFileSync(path.join(__dirname, '../src/business-ui.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');

// The 设置 page and the 设置中心 card read the theme list from business-ui.js; the default comes from app.js (ctx.defaultTheme).
function page(route, { theme, defaultTheme } = {}) {
  const listeners = new Map();
  const document = { addEventListener(kind, cb) { listeners.set(kind, [...(listeners.get(kind) || []), cb]); }, getElementById() { return null; }, querySelectorAll() { return []; } };
  const window = { LaiBusinessModel: B, LaiModules: L, LaiWorkbench: require('../src/workbench.js'), LaiSettingsHub: Hub };
  const context = { window, document, FormData: class {}, crypto: require('node:crypto').webcrypto };
  vm.createContext(context);
  vm.runInContext(source, context);
  const state = { orders: [], customers: {}, laiSettings: theme ? { theme } : {} };
  let html = '';
  const controller = window.LaiBusinessUI.create({
    getState: () => state, escape: escapeHtml, mount: (h) => { html = h; }, dialog() {}, closeDialog() {}, save: async () => {}, toast() {}, navigate() {}, openCustomer() {},
    ...(defaultTheme ? { defaultTheme } : {}),
  });
  controller.navigate(route);
  return html;
}

test('设置: the picker lists the three colours (小满 removed, D-029) and marks 科技蓝 as the default (D-033)', () => {
  const html = page('settings');
  const ids = [...html.matchAll(/data-biz-action="set-theme" data-theme-id="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['pink', 'orange', 'tech']);
  assert.doesNotMatch(html, /小满|xiaoman/);
  assert.match(html, /<strong>科技蓝（默认）<\/strong>/);
  assert.match(html, /<strong>粉色<\/strong>/);
  assert.match(html, /data-preview="tech"/);
  assert.match(html, /class="theme-option selected" data-biz-action="set-theme" data-theme-id="tech"/, 'nothing chosen: the default is highlighted');
});

test('设置: the chosen colour is highlighted, and the default label follows the one constant', () => {
  assert.match(page('settings', { theme: 'pink' }), /class="theme-option selected" data-biz-action="set-theme" data-theme-id="pink"/, 'a saved pink stays pink (D-033)');
  assert.match(page('settings', { theme: 'orange' }), /class="theme-option selected" data-biz-action="set-theme" data-theme-id="orange"/);
  const swapped = page('settings', { defaultTheme: 'pink' });
  assert.match(swapped, /<strong>粉色（默认）<\/strong>/);
  assert.match(swapped, /<strong>科技蓝<\/strong>/);
  assert.match(swapped, /class="theme-option selected" data-biz-action="set-theme" data-theme-id="pink"/);
});

test('设置中心: the 界面配色 card names the current colour, and the note lists the three', () => {
  assert.match(page('settings-hub', { theme: 'pink' }), /界面配色[\s\S]*?粉色/);
  assert.match(page('settings-hub'), /科技蓝（默认）/);
  assert.match(Hub.markup({ themeName: '科技蓝' }, escapeHtml), /粉色、橙色、科技蓝，/);
  assert.doesNotMatch(Hub.markup({ themeName: '科技蓝' }, escapeHtml), /小满/);
});

test('app.js: every theme uses the one (glass) layout, a saved xiaoman shows as tech, an unknown id falls back to the default', () => {
  const applyTheme = new Function('document', app.slice(app.indexOf('const THEME_IDS'), app.indexOf('// 已保存数据的快照')) + '; return applyTheme;');
  const root = { dataset: {} };
  const apply = applyTheme({ documentElement: root });
  assert.deepEqual({ ...root.dataset }, { skin: 'glass' }, 'the layout is set before any data is loaded');
  for (const [id, theme] of [['pink', 'pink'], ['orange', 'orange'], ['tech', 'tech'], ['xiaoman', 'tech']]) {
    apply(id);
    assert.deepEqual({ ...root.dataset }, { theme, skin: 'glass' });
  }
  for (const odd of ['toString', 'constructor', '__proto__']) {
    apply(odd);
    assert.deepEqual({ ...root.dataset }, { theme: 'tech', skin: 'glass' }, odd);
  }
  apply('nonsense');
  assert.deepEqual({ ...root.dataset }, { theme: 'tech', skin: 'glass' });
  apply(undefined);
  assert.equal(root.dataset.theme, 'tech', 'nothing chosen: 科技蓝 (D-033)');
});

// D-029: a saved 小满 theme is shown as 科技蓝; nothing is written on load, only the next normal settings save rewrites it.
function settingsHarness(theme) {
  const listeners = new Map();
  const forms = new Map();
  const document = {
    addEventListener(kind, cb) { listeners.set(kind, [...(listeners.get(kind) || []), cb]); },
    getElementById(id) { return forms.get(id) || null; },
    querySelectorAll() { return []; },
  };
  const window = { LaiBusinessModel: B, LaiModules: L, LaiWorkbench: require('../src/workbench.js'), LaiSettingsHub: Hub };
  class FormData { constructor(form) { this.entries = Object.entries(form.values); } [Symbol.iterator]() { return this.entries[Symbol.iterator](); } }
  const context = { window, document, FormData, crypto: require('node:crypto').webcrypto };
  vm.createContext(context);
  vm.runInContext(source, context);
  let state = { orders: [], customers: {}, laiSettings: { theme, orderPrefix: 'L' } };
  let html = '', saves = 0;
  const controller = window.LaiBusinessUI.create({
    getState: () => state, escape: escapeHtml, mount: (h) => { html = h; }, dialog() {}, closeDialog() {}, toast() {}, navigate() {}, openCustomer() {},
    save: async (next) => { saves++; state = next; return true; },
  });
  return {
    controller, get html() { return html; }, get state() { return state; }, get saves() { return saves; },
    async submit(values) {
      const form = { id: 'biz-settings-form', values, closest: (sel) => (sel === 'form' ? form : null), dataset: {}, querySelector: () => null };
      const event = { target: form, preventDefault() {} };
      for (const cb of listeners.get('submit') || []) await cb(event);
    },
  };
}

test('设置 and 设置中心 show a saved 小满 as 科技蓝 without writing anything', () => {
  const h = settingsHarness('xiaoman');
  h.controller.navigate('settings');
  assert.match(h.html, /class="theme-option selected" data-biz-action="set-theme" data-theme-id="tech"/);
  assert.equal((h.html.match(/theme-option selected/g) || []).length, 1);
  h.controller.navigate('settings-hub');
  assert.match(h.html, /界面配色[\s\S]*?科技蓝/);
  assert.equal(h.saves, 0, 'no write on load or on render');
  assert.equal(h.state.laiSettings.theme, 'xiaoman', 'the stored value is untouched until settings are saved');
});

test('the next normal settings save rewrites a saved 小满 to tech; other themes stay as they are', async () => {
  const h = settingsHarness('xiaoman');
  h.controller.navigate('settings');
  await h.submit({ orderPrefix: 'Q', defaultCurrency: 'USD', defaultOwner: '' });
  assert.equal(h.saves, 1);
  assert.equal(h.state.laiSettings.theme, 'tech');
  assert.equal(h.state.laiSettings.orderPrefix, 'Q');
  const pink = settingsHarness('orange');
  pink.controller.navigate('settings');
  await pink.submit({ orderPrefix: 'Q', defaultCurrency: 'USD', defaultOwner: '' });
  assert.equal(pink.state.laiSettings.theme, 'orange');
  const none = settingsHarness(undefined);
  none.controller.navigate('settings');
  await none.submit({ orderPrefix: 'Q', defaultCurrency: 'USD', defaultOwner: '' });
  assert.ok(!Object.hasOwn(none.state.laiSettings, 'theme') || none.state.laiSettings.theme === undefined, 'no theme is invented when none was chosen');
});
