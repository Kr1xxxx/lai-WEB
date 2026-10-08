const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('the 刷新 button sits after the entries and sticks to the bottom in both skins, so it never covers the last entry when the window is short', () => {
  assert.match(read('src/customer-replica.css'), /\.rail-refresh \{\n  position: sticky;\n  bottom: 0;\n  margin-top: auto;/);
  assert.match(read('src/skin-glass.css'), /\.rail-refresh \{ position: sticky; left: auto; right: auto; bottom: 0; margin-top: auto;/);
  assert.doesNotMatch(read('src/customer-replica.css'), /\.rail-refresh \{\n  position: absolute;/);
});
