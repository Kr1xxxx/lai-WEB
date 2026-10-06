const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../src/customer-replica.css'), 'utf8');

test('top-left wordmark keeps the Lai identity and clears native window controls', () => {
  assert.match(app, /class="brand" aria-label="来财Lai"/);
  assert.match(app, /class="brand-cn">来财<\/span>/);
  assert.match(app, /class="brand-lai">Lai<\/span>/);
  assert.match(css, /\.topbar-left-drag-region\s*\{[^}]*padding-left:\s*52px/s);
  assert.match(css, /\.brand-cn\s*\{/);
  assert.match(css, /\.brand-lai\s*\{/);
});
