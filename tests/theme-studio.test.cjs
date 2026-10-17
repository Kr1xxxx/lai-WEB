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
    const selectors = rule.slice(0, rule.indexOf('{')).split(',').map((s) => s.trim()).filter(Boolean);
    for (const selector of selectors) {
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
  assert.match(read('src/business.css'), /\.theme-preview\[data-preview="studio"\]\s*\{[^}]*--pv-nav/);
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
  const white = '#ffffff', side = token('--studio-side'), surface3 = token('--studio-surface-3');
  for (const [fg, bg, where] of [
    [token('--ink-900'), white, 'body text'],
    [token('--ink-700'), side, 'left column labels'],
    [token('--ink-700'), surface3, 'tabs and hover rows'],
    [token('--ink-600'), white, 'secondary text, table headers'],
    [token('--ink-600'), side, 'second-level nav heading'],
    [token('--brand-500'), white, 'links and accents'],
    [white, token('--brand-500'), 'primary button text'],
    [token('--brand-700'), token('--brand-50'), 'selected / accent badges'],
  ]) {
    assert.ok(contrast(fg, bg) >= 4.5, `${where}: ${fg} on ${bg} is ${contrast(fg, bg).toFixed(2)}:1`);
  }
});
