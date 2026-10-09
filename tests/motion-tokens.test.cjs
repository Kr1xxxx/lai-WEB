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

test('the pill in the left rail eases in and out', () => {
  const css = read('skin-glass.css');
  assert.match(css, /\.rail-item \{ transition: background-color var\(--motion-normal\) var\(--ease-out\)/);
});

test('easing curves come from the Arc Library presets and menus use the shared exit curve', () => {
  const tokens = read('ui-tokens.css');
  assert.match(tokens, /--ease-out:\s*cubic-bezier\(0\.16, 1, 0\.3, 1\)/);
  assert.match(tokens, /--ease-exit:\s*cubic-bezier\(0\.7, 0, 0\.84, 0\)/);
  assert.match(tokens, /Arc Library \(MIT/);
  assert.doesNotMatch(read('styles.css'), /cubic-bezier\(\.755|cubic-bezier\(\.23, ?1/);
});

test('motion no longer switches off for reduced motion (owner decision 2026-10-09)', () => {
  for (const f of fs.readdirSync(src).filter((n) => /\.(css|js)$/.test(n))) {
    assert.doesNotMatch(read(f), /prefers-reduced-motion/, `${f} still reads the reduced-motion setting`);
  }
});
