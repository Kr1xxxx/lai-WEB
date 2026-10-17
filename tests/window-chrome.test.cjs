const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { appSource } = require('./helpers/source.cjs');

const app = appSource();
const css = fs.readFileSync(path.join(__dirname, '../src/customer-replica.css'), 'utf8');

test('top-left wordmark shows only 来财 (no Lai text) and clears native window controls', () => {
  assert.match(app, /class="brand" aria-label="来财Lai"/);
  assert.match(app, /<svg class="brand-cn"[^>]*><text[^>]*>来财<\/text><\/svg>/);
  assert.doesNotMatch(app, /brand-lai/);
  assert.match(css, /\.topbar-left-drag-region\s*\{[^}]*padding-left:\s*52px/s);
  assert.match(css, /\.brand-cn\s*\{/);
  assert.doesNotMatch(css, /\.brand-lai/);
  assert.match(css, /\.brand-cn text\s*\{[^}]*stroke-linejoin:\s*round/s);
});
