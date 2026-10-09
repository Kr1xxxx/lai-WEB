const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = path.join(__dirname, '..', 'src');
const read = (f) => fs.readFileSync(path.join(src, f), 'utf8');

test('hover and colour transitions use the shared motion tokens, not loose numbers', () => {
  for (const f of ['business.css', 'customer-editor.css', 'customer-replica.css', 'skin-glass.css']) {
    const bad = read(f).split('\n').filter((l) =>
      /transition:[^;]*\b(0\.12s|120ms|150ms)\b/.test(l) && !/prefers-reduced-motion/.test(l));
    assert.deepEqual(bad.map((l) => l.trim()), [], `${f} still has hard-coded fast timings`);
  }
});

test('the pill in the left rail eases in and out, and turns off for reduced motion', () => {
  const css = read('skin-glass.css');
  assert.match(css, /\.rail-item \{ transition: background-color var\(--motion-normal\) var\(--ease-out\)/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{\s*:root\[data-skin="glass"\] \.rail-item[^}]*transition: none/);
});
