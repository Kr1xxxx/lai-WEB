const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('the rail is two blocks: the entries scroll on their own, the 刷新 button sits outside the scroll area, so it can never cover an entry', () => {
  const app = read('src/app.js'), css = read('src/customer-replica.css'), glass = read('src/skin-glass.css');
  assert.match(app, /`<div class="rail-scroll">`/);
  assert.match(app, /`<\/div><button class="rail-item rail-refresh"/);
  assert.match(css, /\.rail \{[^}]*overflow: hidden;/);
  assert.match(css, /\.rail-scroll \{[^}]*flex: 1 1 auto;[^}]*min-height: 0;[^}]*overflow-y: auto;/);
  assert.doesNotMatch(css, /\.rail-refresh \{[^}]*position: (sticky|absolute)/);
  assert.doesNotMatch(glass, /\.rail-refresh \{[^}]*position: (sticky|absolute)/);
});

test('the 13 entries share the rail height: item height and gap come from the window height, in both skins, and shrink further on short windows', () => {
  const css = read('src/customer-replica.css'), glass = read('src/skin-glass.css');
  assert.match(css, /--rail-pitch: calc\(\(100vh - 152px\) \/ 13\);/);
  assert.match(css, /--rail-item-h: clamp\(36px, calc\(var\(--rail-pitch\) - var\(--rail-gap\)\), var\(--rail-max-h\)\);/);
  assert.match(css, /\.rail-item \{[^}]*height: var\(--rail-item-h\);[^}]*flex: 0 0 var\(--rail-item-h\);/);
  assert.match(css, /@media \(max-height: 800px\)/);
  assert.match(css, /@media \(max-height: 700px\)/);
  assert.match(glass, /--rail-pitch: calc\(\(100vh - 160px\) \/ 13\); --rail-max-h: 52px; --rail-max-gap: 2px;/);
  assert.match(glass, /\.rail-item \{[^}]*height: var\(--rail-item-h\)/);
  assert.match(glass, /@media \(max-height: 700px\)/);
});

test('the hover flyout lines up with the item even when the entry area has been scrolled', () => {
  assert.match(read('src/app.js'), /item\.closest\("\.rail-scroll"\)\?\.scrollTop \|\| 0/);
});
