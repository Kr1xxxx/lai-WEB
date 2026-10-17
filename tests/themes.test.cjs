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

test('设置: the picker lists all four colours, 科技蓝 included, and marks pink as the default', () => {
  const html = page('settings');
  const ids = [...html.matchAll(/data-biz-action="set-theme" data-theme-id="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['pink', 'orange', 'xiaoman', 'tech']);
  assert.match(html, /<strong>粉色（默认）<\/strong>/);
  assert.match(html, /<strong>科技蓝<\/strong>/);
  assert.match(html, /data-preview="tech"/);
  assert.match(html, /class="theme-option selected" data-biz-action="set-theme" data-theme-id="pink"/, 'nothing chosen: the default is highlighted');
});

test('设置: the chosen colour is highlighted, and the default label follows the one constant', () => {
  assert.match(page('settings', { theme: 'tech' }), /class="theme-option selected" data-biz-action="set-theme" data-theme-id="tech"/);
  const swapped = page('settings', { defaultTheme: 'tech' });
  assert.match(swapped, /<strong>科技蓝（默认）<\/strong>/);
  assert.match(swapped, /<strong>粉色<\/strong>/);
  assert.match(swapped, /class="theme-option selected" data-biz-action="set-theme" data-theme-id="tech"/);
});

test('设置中心: the 界面配色 card names the current colour, and the note lists all four', () => {
  assert.match(page('settings-hub', { theme: 'tech' }), /界面配色[\s\S]*?科技蓝/);
  assert.match(page('settings-hub'), /粉色（默认）/);
  assert.match(Hub.markup({ themeName: '科技蓝' }, escapeHtml), /粉色、橙色、小满、科技蓝/);
});

test('app.js: tech uses the glass skin like pink and orange, only xiaoman is classic; an unknown id falls back to the default', () => {
  const applyTheme = new Function('document', app.slice(app.indexOf('const THEME_IDS'), app.indexOf('// 已保存数据的快照')) + '; return applyTheme;');
  const root = { dataset: {} };
  const apply = applyTheme({ documentElement: root });
  for (const [id, skin] of [['pink', 'glass'], ['orange', 'glass'], ['tech', 'glass'], ['xiaoman', 'classic']]) {
    apply(id);
    assert.deepEqual({ ...root.dataset }, { theme: id, skin });
  }
  apply('nonsense');
  assert.deepEqual({ ...root.dataset }, { theme: 'pink', skin: 'glass' });
  apply(undefined);
  assert.equal(root.dataset.theme, 'pink');
});
