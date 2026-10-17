// 米白 (data-theme="studio"): a light theme modelled on Gr8r Studio. All of it lives in src/theme-studio.css,
// scoped to the theme, and loaded after every other stylesheet so it wins at equal strength.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const css = read('src/theme-studio.css');
const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+\{[^{}]*\}/g) || [];

test('every rule in theme-studio.css only applies when 米白 is chosen', () => {
  assert.ok(rules.length > 50, 'the theme has its rules');
  for (const rule of rules) {
    // split on commas outside :is(...) / :not(...)
    const selectors = [];
    let depth = 0, cur = '';
    for (const ch of rule.slice(0, rule.indexOf('{'))) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { selectors.push(cur.trim()); cur = ''; } else cur += ch;
    }
    selectors.push(cur.trim());
    for (const selector of selectors.filter(Boolean)) {
      if (selector === '.theme-preview[data-preview="studio"]') continue; // the 设置 picker draws every theme's preview
      assert.match(selector, /^:root(\[data-skin="glass"\])?\[data-theme="studio"\]/, `not scoped to 米白: ${selector}`);
    }
  }
});

test('the stylesheet is assembled last, so its rules win over the skin and the component kit', () => {
  const template = read('src/template.html');
  assert.match(template, /<!--UI_KIT_STYLE--><!--THEME_STUDIO_STYLE--><\/head>/);
  assert.match(read('scripts/build.py'), /\('<!--THEME_STUDIO_STYLE-->','theme-studio\.css','style'\)/);
});

test('米白 is an extra choice: the default colour and the other themes are untouched', () => {
  assert.doesNotMatch(read('src/ui-tokens.css'), /studio/, 'no 米白 colours leak into the shared tokens');
  assert.doesNotMatch(read('src/skin-glass.css'), /studio/);
  assert.match(css, /\.theme-preview\[data-preview="studio"\]\s*\{[^}]*--pv-nav/);
});

// The literal counter of tests/ui-tokens-ratchet.test.cjs, applied to every block except the S0 token block and the S9 preview.
function literals(cssText) {
  const out = [];
  for (const [, selector, body] of cssText.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const [, prop, value] of body.matchAll(/(?:^|;)\s*([a-z-]+)\s*:\s*([^;]*)/g)) {
      if ((prop === 'font-size' || prop === 'font') && /(?:^|[\s(,/])\d*\.?\d+px\b/.test(value)) out.push(`${selector.trim()} ${prop}: ${value}`);
      if (/(?:^|-)radius$/.test(prop) && /(?:^|[\s(,])\d*\.?\d+px\b/.test(value)) out.push(`${selector.trim()} ${prop}: ${value}`);
      if (/#[0-9a-fA-F]{3,8}\b/.test(value)) out.push(`${selector.trim()} ${prop}: ${value}`);
    }
  }
  return out;
}

test('literal font sizes, radii and colours only live in the S0 token block (and the S9 preview)', () => {
  const s0 = css.slice(css.indexOf('/* ===== S0'), css.indexOf('/* ===== /S0 ===== */'));
  const tokenBlock = s0.slice(s0.indexOf(':root[data-theme="studio"] {'), s0.indexOf('}', s0.indexOf(':root[data-theme="studio"] {')) + 1);
  assert.ok(tokenBlock.includes('--studio-accent: #4b5bd6'), 'the token block holds the Gr8r values');
  const rest = css.replace(tokenBlock, '').replace(/\.theme-preview\[data-preview="studio"\]\s*\{[^}]*\}/, '');
  assert.deepEqual(literals(rest), []);
});

test('the sections S0–S9 are each present once and in order', () => {
  let at = -1;
  for (const id of ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9']) {
    const open = css.indexOf(`/* ===== ${id}:`), close = css.indexOf(`/* ===== /${id} ===== */`);
    assert.ok(open > at && close > open, `section ${id}`);
    assert.equal(css.split(`/* ===== /${id} ===== */`).length, 2, `${id} closes once`);
    at = close;
  }
});

// WCAG contrast of the theme's text colours on the backgrounds they sit on.
function luminance(hex) {
  const [r, g, b] = hex.match(/[0-9a-f]{2}/gi).map((h) => parseInt(h, 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const token = (name) => {
  const m = css.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i'));
  assert.ok(m, `token ${name}`);
  return m[1];
};

test('text in 米白 stays readable (≥ 4.5:1 for normal text)', () => {
  const white = token('--studio-surface'), side = token('--studio-side'), surface3 = token('--studio-surface-3'), surface2 = token('--studio-surface-2');
  for (const [fg, bg, where] of [
    [token('--studio-text'), white, 'body text'],
    [token('--studio-text-2'), side, 'left column labels'],
    [token('--studio-text-2'), surface3, 'tabs and hover rows'],
    [token('--studio-text-3'), white, 'secondary text, table headers'],
    [token('--studio-text-3'), side, 'second-level nav heading'],
    [token('--studio-text-3'), surface2, 'muted text on hovered rows'],
    [token('--studio-accent'), white, 'links and accents'],
    [white, token('--studio-accent'), 'primary button text'],
    [token('--studio-green'), white, 'success text'],
    [token('--studio-amber'), white, 'warning text'],
    [token('--studio-red'), white, 'danger text'],
  ]) {
    assert.ok(contrast(fg, bg) >= 4.5, `${where}: ${fg} on ${bg} is ${contrast(fg, bg).toFixed(2)}:1`);
  }
});
