const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('the rail keeps room for the 刷新 button at the bottom in both skins, so the last entry is reachable when the window is short', () => {
  assert.match(read('src/customer-replica.css'), /padding: 16px 0 72px;\n  overflow-y: auto;/);
  assert.match(read('src/skin-glass.css'), /width: 68px; padding: 8px 6px 64px;/);
});
