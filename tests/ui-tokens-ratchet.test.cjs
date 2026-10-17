// Token ratchet (D-028): per CSS file in src/, the number of literal font sizes (px), literal border radii (px) and hex
// colours may not grow. New styles use the tokens in src/ui-tokens.css (--text-*, --r-*/--radius, the semantic colours)
// or the kit classes in src/ui-kit.css. ui-tokens.css is where the literals live, so it is exempt.
//
// Counts only look inside declaration blocks (so #app or #customer-form selectors are not "hex colours") and skip
// comments. When a page migrates to the kit and its counts drop, lower the baseline:
//   UPDATE_UI_RATCHET=1 node --test tests/ui-tokens-ratchet.test.cjs
// Never raise a number by hand to make a change pass; use a token instead.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = path.join(__dirname, '..', 'src');
const baselinePath = path.join(__dirname, 'fixtures', 'ui-tokens-ratchet.json');
const EXEMPT = new Set(['ui-tokens.css']);

function countLiterals(css) {
  const bodies = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]);
  const out = { fontSizePx: 0, radiusPx: 0, hex: 0 };
  for (const body of bodies) {
    for (const [, prop, value] of body.matchAll(/(?:^|;)\s*([a-z-]+)\s*:\s*([^;]*)/g)) {
      if (prop === 'font-size' && /(?:^|[\s(,])\d*\.?\d+px\b/.test(value)) out.fontSizePx += 1;
      else if (prop === 'font' && /(?:^|[\s(,/])\d*\.?\d+px\b/.test(value)) out.fontSizePx += 1;
      if (/(?:^|-)radius$/.test(prop) && /(?:^|[\s(,])\d*\.?\d+px\b/.test(value)) out.radiusPx += 1;
      out.hex += (value.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length;
    }
  }
  return out;
}

function measure() {
  const counts = {};
  for (const file of fs.readdirSync(src).filter((f) => f.endsWith('.css') && !EXEMPT.has(f)).sort()) {
    counts[file] = countLiterals(fs.readFileSync(path.join(src, file), 'utf8'));
  }
  return counts;
}

test('the counter sees literals inside declarations only', () => {
  const css = '/* #ffffff 12px */ #app .a { color: #fff; font-size: 12px; border-radius: 4px 0 0 4px; } .b { font: 600 13px/1.4 var(--font-ui); border-top-left-radius: var(--r-sm); background: var(--x, #abc); }';
  assert.deepEqual(countLiterals(css), { fontSizePx: 2, radiusPx: 1, hex: 2 });
});

test('no CSS file in src/ gains literal font sizes, radii or hex colours (use the ui-tokens.css tokens)', () => {
  const now = measure();
  if (process.env.UPDATE_UI_RATCHET) {
    fs.writeFileSync(baselinePath, JSON.stringify({ note: 'Literal font-size px, border-radius px and hex colours per src/*.css (ui-tokens.css exempt). May only go down. tests/ui-tokens-ratchet.test.cjs', files: now }, null, 1) + '\n');
  }
  const base = JSON.parse(fs.readFileSync(baselinePath, 'utf8')).files;
  const worse = [];
  for (const [file, counts] of Object.entries(now)) {
    const was = base[file] || { fontSizePx: 0, radiusPx: 0, hex: 0 };
    for (const key of Object.keys(counts)) if (counts[key] > was[key]) worse.push(`${file} ${key}: ${was[key]} → ${counts[key]}`);
  }
  assert.deepEqual(worse, [], 'new literals; use var(--text-*), var(--r-*)/var(--radius) and the semantic colour tokens instead');
});

test('the kit sheet itself has no literal font sizes, radii or colours', () => {
  assert.deepEqual(countLiterals(fs.readFileSync(path.join(src, 'ui-kit.css'), 'utf8')), { fontSizePx: 0, radiusPx: 0, hex: 0 });
});
