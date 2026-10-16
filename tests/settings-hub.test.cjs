const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Hub = require('../src/settings-hub.js');
const RM = require('../src/rail-menu.js');

const E = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('the settings center is a menu entry under 设置, after the existing 设置 page; 企业管理 is its own entry', () => {
  assert.deepEqual(RM.menuFor('设置').map((r) => [r.label, r.kind, r.target]), [['设置', 'route', 'settings'], ['设置中心', 'route', 'settings-hub']]);
  assert.equal(RM.sectionFor('settings-hub').label, '设置');
  assert.equal(RM.sectionFor('settings').label, '设置');
  assert.deepEqual(RM.menuFor('企业管理').map((r) => [r.label, r.kind, r.target]), [['角色权限', 'route', 'roles'], ['成员管理', 'route', 'members']], '企业管理放角色权限和成员管理');
});

test('every entry opens something that really exists: a business page, a customer page, or an action app.js handles', () => {
  const app = read('src/app.js'), business = read('src/business-ui.js');
  const routes = new Set(RM.favoritable().filter((r) => r.kind === 'route').map((r) => r.target));
  const screens = new Set(['customer-settings']);
  for (const group of Hub.GROUPS) for (const item of group.items) {
    const [kind, target] = item.open;
    if (kind === 'route') assert.ok(routes.has(target), `${item.title}: no page ${target}`);
    if (kind === 'screen') assert.ok(screens.has(target), item.title);
    if (kind === 'action') assert.ok(app.includes(`"${target}"`), `${item.title}: app.js has no handler for ${target}`);
  }
  assert.match(business, /"settings-hub": renderSettingsHub/);
});

test('the page lists every group and entry once, shows the current defaults and theme, and escapes values', () => {
  const html = Hub.markup({ orderPrefix: 'A<B', currency: 'EUR', themeName: '粉色' }, E);
  for (const group of Hub.GROUPS) {
    assert.equal(html.split(`data-sh-group="${group.id}"`).length - 1, 1, group.id);
    for (const item of group.items) assert.equal(html.split(`data-sh-item="${item.id}"`).length - 1, 1, item.id);
  }
  assert.match(html, /A&lt;B · EUR/);
  assert.match(html, /<em class="sh-now">粉色<\/em>/);
  assert.doesNotMatch(html, /A<B/);
  assert.equal((html.match(/<button /g) || []).length, Hub.GROUPS.flatMap((g) => g.items).length, 'one button per entry');
  assert.doesNotThrow(() => Hub.markup());
});

test('the parts a user can set are all covered: defaults, theme, favorites, columns, segments, customer settings, sales flow, product settings, document templates, rates, targets, mailbox', () => {
  const ids = Hub.GROUPS.flatMap((g) => g.items.map((i) => i.id));
  assert.deepEqual(ids, ['defaults', 'theme', 'favorites', 'columns', 'segments', 'customer-settings', 'flows', 'product-settings', 'doc-templates', 'rates', 'targets', 'mail-account']);
});

test('the 测试数据 entry shows only in the web trial, once, and opens the trial panel', () => {
  assert.doesNotMatch(Hub.markup({}, E), /测试数据/, '应用本体没有这一项');
  const html = Hub.markup({ testData: true }, E);
  assert.equal(html.split('data-sh-group="test-data"').length - 1, 1);
  assert.match(html, /data-sh-item="test-data"[\s\S]*?data-action="web-trial-data"/);
  assert.match(read('src/business-ui.js'), /testData: Boolean\(root\.LaiWebTrial\)/);
  assert.match(read('scripts/web-trial/data-panel.js'), /web-trial-data/);
});

test('产品设置 needs both product.view and settings.product, 单据模板 needs settings.docTemplate, 客户设置 opens with any of its three permissions', () => {
  const has = (...keys) => (key) => keys.includes(key);
  const ids = (can) => [...Hub.markup({ can }, E).matchAll(/data-sh-item="([\w-]+)"/g)].map((m) => m[1]);
  assert.ok(!ids(has('settings.product')).includes('product-settings'), 'the products page itself would be closed');
  assert.ok(!ids(has('product.view')).includes('product-settings'));
  assert.ok(ids(has('product.view', 'settings.product')).includes('product-settings'));
  assert.ok(ids(has('settings.docTemplate')).includes('doc-templates'));
  assert.ok(!ids(has()).includes('doc-templates'));
  for (const key of ['settings.customer', 'settings.dedupe', 'settings.source']) assert.ok(ids(has(key)).includes('customer-settings'), key);
  assert.ok(!ids(has('settings.opportunity')).includes('customer-settings'));
  const html = Hub.markup({}, E);
  assert.match(html, /data-sh-item="product-settings"[\s\S]*?data-lai-route="products"/);
  assert.match(html, /data-sh-item="doc-templates"[\s\S]*?data-lai-route="doc-templates"/);
  assert.match(html, /月度和季度目标/);
  assert.doesNotMatch(html, /来财里能设置的内容都在这里/, 'some settings still live on their own pages, so the subtitle must not promise everything');
});
