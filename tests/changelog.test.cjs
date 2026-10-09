const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../src/changelog.js');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('the newest release in the changelog is the current app version', () => {
  const version = JSON.parse(read('package.json')).version;
  assert.equal(C.RELEASES[0].version, version);
  assert.equal(C.RELEASES.filter((r) => r.current).length, 1);
  assert.equal(C.RELEASES[0].current, true);
});

test('releases are newest first, every one has dated groups with plain Chinese items', () => {
  const dates = C.RELEASES.map((r) => r.date);
  assert.deepEqual([...dates].sort().reverse(), dates);
  for (const r of C.RELEASES) {
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(r.groups.length > 0);
    for (const g of r.groups) {
      assert.ok(g.title && g.items.length > 0);
      for (const item of g.items) assert.match(item, /[一-鿿]/);
    }
  }
});

test('render escapes text and marks the current version', () => {
  const html = C.render([{ version: '9.9.9', date: '2030-01-01', current: true, groups: [{ title: '<b>x</b>', items: ['a & "b"'] }] }]);
  assert.match(html, /<h3>v9\.9\.9<\/h3>/);
  assert.match(html, /class="changelog-current">当前版本/);
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(html, /a &amp; &quot;b&quot;/);
  assert.doesNotMatch(html, /<b>x/);
});

test('the changelog script is loaded before the app, in the template and in the build script', () => {
  assert.match(read('src/template.html'), /<!--CHANGELOG-->/);
  assert.match(read('scripts/build.py'), /'<!--CHANGELOG-->','changelog\.js','script'/);
  assert.match(read('src/app.js'), /data-action="version-history"/);
});
