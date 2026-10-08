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
  assert.deepEqual(RM.menuFor('企业管理').map((r) => [r.label, r.kind]), [['企业信息', 'feature']], '企业管理单独保留，先放一个保留入口');
  assert.ok(!RM.menuFor('企业管理').some((r) => r.id), '保留入口不能设为常用');
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

test('the parts a user can set are all covered: defaults, theme, favorites, columns, segments, customer settings, sales flow, targets, mailbox', () => {
  const ids = Hub.GROUPS.flatMap((g) => g.items.map((i) => i.id));
  assert.deepEqual(ids, ['defaults', 'theme', 'favorites', 'columns', 'segments', 'customer-settings', 'flows', 'targets', 'mail-account']);
});

test('the rail keeps room for the 刷新 button at the bottom in both skins, so the last entry is reachable when the window is short', () => {
  assert.match(read('src/customer-replica.css'), /padding: 16px 0 72px;\n  overflow-y: auto;/);
  assert.match(read('src/skin-glass.css'), /width: 68px; padding: 8px 6px 64px;/);
});
