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

test('interaction polish has bounded motion and respects reduced motion', () => {
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
  assert.match(tokensAndShared, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(tokensAndShared, /transition-duration:\s*0\.01ms/);
});

test('the customer sub-navigation no longer offers the removed profile-suggestion entry', () => {
  const app = read('src/app.js');
  assert.doesNotMatch(app, /建档建议/);
  const block = app.slice(app.indexOf('function subnav()'), app.indexOf('return `<h3>经营管理</h3>'));
  const labels = [...block.matchAll(/\["([^"]+)", (?:"[^"]+"|null), (?:true|false)\]/g)].map((match) => match[1]);
  assert.deepEqual(labels, ['客户列表', '公海客户', '客户查重', '客户设置']);
});

