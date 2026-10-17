const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const tokenPath = path.join(root, 'src/ui-tokens.css');
const tokens = fs.existsSync(tokenPath) ? fs.readFileSync(tokenPath, 'utf8') : '';

test('the UI baseline is loaded before application styles', () => {
  const template = read('src/template.html');
  const build = read('scripts/build.py');
  assert.ok(fs.existsSync(tokenPath), 'src/ui-tokens.css must define the shared design tokens');
  assert.ok(template.indexOf('<!--UI_TOKENS-->') < template.indexOf('<!--PREVIEW_STYLE-->'));
  assert.match(build, /'<!--UI_TOKENS-->',\s*'ui-tokens\.css',\s*'style'/);
});

test('the shared token sheet implements the approved spacing, type, color and shadow system', () => {
  for (const name of [
    '--space-1', '--space-2', '--space-4', '--space-6', '--space-8',
    '--font-size-assist', '--font-size-body', '--font-size-section', '--font-size-page',
    '--color-primary-50', '--color-primary-500', '--color-primary-700',
    '--color-neutral-0', '--color-neutral-300', '--color-neutral-800', '--color-neutral-900',
    '--color-success', '--color-warning', '--color-danger',
    '--radius-sm', '--radius-md', '--radius-lg', '--radius-xl',
    '--shadow-card', '--shadow-popover', '--shadow-focus'
  ]) assert.match(tokens, new RegExp(`${name}:`), `missing ${name}`);
  assert.match(tokens, /--shadow-card:[^;]*,[^;]*;/s, 'card shadow must use two layers');
  assert.match(tokens, /--shadow-popover:[^;]*,[^;]*;/s, 'popover shadow must use two layers');
});

test('customer surfaces consume shared tokens for core hierarchy and floating layers', () => {
  const shared = read('src/styles.css');
  const customer = read('src/customer-replica.css');
  const select = read('src/customer-select.css');
  const suggestions = read('src/customer-suggestions.css');
  assert.match(shared, /background:\s*var\(--color-primary-500\)/);
  assert.match(shared, /box-shadow:\s*var\(--shadow-focus\)/);
  assert.match(customer, /\.panel\s*\{[^}]*box-shadow:\s*var\(--shadow-card\)/s);
  assert.match(customer, /\.popover\s*\{[^}]*box-shadow:\s*var\(--shadow-popover\)/s);
  assert.match(select, /\.lai-select-menu\s*\{[^}]*box-shadow:\s*var\(--shadow-popover\)/s);
  assert.match(suggestions, /box-shadow:\s*var\(--shadow-popover\)/);
});

test('interaction polish has bounded motion', () => {
  const tokensAndShared = `${tokens}\n${read('src/styles.css')}`;
  const detail = read('src/customer-detail.css');
  const customer = read('src/customer-replica.css');
  assert.match(tokens, /--motion-fast:\s*120ms/);
  assert.match(tokens, /--motion-normal:\s*160ms/);
  assert.match(tokens, /--motion-list-exit:\s*100ms/);
  assert.match(tokens, /--motion-detail-enter:\s*240ms/);
  assert.match(tokens, /--motion-detail-exit:\s*160ms/);
  assert.match(tokens, /--motion-tab-indicator:\s*300ms/);
  assert.match(tokens, /--motion-field-reorder:\s*180ms/);
  assert.match(tokens, /--motion-filter-drawer:\s*300ms/);
  assert.match(detail, /translateX\(32px\)/);
  assert.match(detail, /translateX\(28px\)/);
  assert.doesNotMatch(detail, /lai-detail-tab-enter/);
  assert.match(customer, /\.customer-list-exit\s*\{/);
  assert.match(customer, /translateX\(-20px\)/);
  assert.doesNotMatch(tokensAndShared, /prefers-reduced-motion/);
});

test('the customer sub-navigation no longer offers the removed profile-suggestion entry', () => {
  const app = read('src/app.js');
  assert.doesNotMatch(app, /建档建议/);
  // 客户页的条目现在取自 rail-menu.js（和悬停浮层、可设为常用的清单同一份来源）。
  const block = app.slice(app.indexOf('function subnav()'), app.indexOf('async function navigateApp'));
  assert.match(block, /RM\.menuFor\("客户"\)/);
  assert.doesNotMatch(block, /\["客户列表"/);
  const labels = require('../src/rail-menu.js').menuFor('客户').map((row) => row.label);
  assert.deepEqual(labels, ['客户列表', '公海客户', '客户查重', '客户设置']);
});


test('every theme (pink, orange, tech) defines the same colour variables and nothing blue is left in app chrome', () => {
  const themeBlock = id => new RegExp(`:root(?:,\\s*:root)?\\[data-theme="${id}"\\]\\s*\\{([^}]*)\\}`, 's').exec(tokens)?.[1] || '';
  const names = block => [...block.matchAll(/(--[a-z0-9-]+):/g)].map(m => m[1]).sort();
  const orange = themeBlock('orange');
  assert.ok(orange.length > 0, 'orange theme block exists');
  const pink = themeBlock('pink');
  assert.equal(themeBlock('xiaoman'), '', 'the 小满 theme block is gone (D-029)');
  assert.deepEqual(names(orange), names(pink), 'both themes set exactly the same variables');
  assert.deepEqual(names(themeBlock('tech')), names(pink), '科技蓝 sets the same variables too');
  for (const name of ['--brand-500', '--brand-900', '--ink-900', '--chart-1', '--chart-2', '--chart-3', '--chart-rank-1', '--nav-top', '--nav-glow-rgb']) {
    assert.ok(names(pink).includes(name), `${name} is themed`);
  }
  const blue = /#(?:0a6aff|0c163d|1d273e|53617b|1a5cff|004fd9)\b/i;
  for (const file of fs.readdirSync(path.join(root, 'src')).filter(f => /\.(css|js|html)$/.test(f) && !/^mail-(ui|editor)\.js$/.test(f) && f !== 'ui-tokens.css')) {
    assert.doesNotMatch(read(`src/${file}`), blue, `${file} must use theme variables, not the old blue literals`);
  }
});

test('the chosen theme is stored in laiSettings.theme, applied to <html>, and switched from 设置', () => {
  const app = read('src/app.js');
  const ui = read('src/business-ui.js');
  assert.match(app, /const THEME_IDS = \["pink", "orange", "tech"\];/);
  assert.match(app, /const RETIRED_THEMES = \{ xiaoman: "tech" \};/, 'a saved 小满 is shown as 科技蓝 (D-029)');
  assert.match(app, /const DEFAULT_THEME = "pink";/, 'the default colour is one constant');
  assert.match(app, /const theme = THEME_IDS\.includes\(shown\) \? shown : DEFAULT_THEME;/);
  assert.equal((app.match(/"pink"/g) || []).length, 2, 'app.js names pink only in the id list and as the default');
  assert.match(app, /defaultTheme: DEFAULT_THEME,/, 'the settings page gets the default from the same constant');
  assert.match(app, /document\.documentElement\.dataset\.skin = "glass";/, '所有配色都用同一套界面（D-029）');
  assert.doesNotMatch(app, /"classic"/);
  const skin = read('src/skin-glass.css');
  assert.doesNotMatch(skin.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{((?:[^{}]*\{[^}]*\})*)\s*\}/g, '$1').replace(/:root\[data-skin="glass"\][^{]*\{[^}]*\}/g, ''), /\S/, '新皮肤的每条规则都限定在 data-skin="glass" 下（以后并进基础样式时再改）');
  assert.equal((app.match(/applyTheme\(state\.laiSettings\?\.theme\)/g) || []).length, 2, 'applied after loading and after every save');
  assert.match(ui, /data-biz-action="set-theme" data-theme-id="\$\{id\}"/);
  assert.match(ui, /action === "set-theme"/);
  assert.match(ui, /laiSettings: \{ \.\.\.state\(\)\.laiSettings, theme: id \}/);
});

test('the workbench and menus with three or fewer entries have no second-level navigation column; customers and mail keep theirs', () => {
  const app = read('src/app.js');
  assert.match(app, /id="app-subnav"\$\{\(activeRoute === "dashboard" && !favoritesMode\) \|\| sectionTabEntries\(\) \? " hidden" : ""\}/);
  assert.match(app, /const SECTION_TABS_MAX = 3;/);
  assert.match(app, /if \(favoritesMode \|\| activeRoute === "customers" \|\| activeRoute === "mail"\) return null;/, 'customers, mail and 常用 keep the column');
  const css = read('src/customer-replica.css');
  assert.match(css, /\.subnav\[hidden\] ~ \.main\s*\{\s*left:\s*72px;/s);
  assert.match(css, /\.subnav\[hidden\]\s*\{\s*display:\s*none;/s);
});

test('pink is the default colour, and every colour option in 设置 has its own preview picture', () => {
  const ui = read('src/business-ui.js');
  const css = read('src/business.css');
  assert.match(ui, /THEME_CHOICES = \[\["pink", "粉色"\], \["orange", "橙色"\], \["tech", "科技蓝"\]\]\.map/);
  assert.match(ui, /const DEFAULT_THEME = ctx\.defaultTheme \|\| "pink";/);
  assert.match(ui, /savedTheme\(settings\)\) \? savedTheme\(settings\) : DEFAULT_THEME/, 'the picker highlights the default colour when nothing was chosen');
  assert.match(tokens, /:root,\s*:root\[data-theme="pink"\]\s*\{/, 'pink also applies before data-theme is written');
  assert.doesNotMatch(tokens, /:root,\s*:root\[data-theme="xiaoman"\]/);
  assert.doesNotMatch(css, /data-preview="xiaoman"/, 'no 小满 preview any more (D-029)');
  for (const id of ['pink', 'orange', 'tech']) {
    assert.match(ui, /class="theme-preview" data-preview="\$\{id\}"/);
    if (id !== 'pink') assert.match(css, new RegExp(`\\.theme-preview\\[data-preview="${id}"\\]\\s*\\{[^}]*--pv-nav`), `${id} preview has its own colours`);
  }
});
