const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const skin = read('src/skin-glass.css');
const tokens = read('src/ui-tokens.css');

const rgb = (hex) => { const h = hex.replace('#', ''); const f = h.length === 3 ? [...h].map((c) => c + c).join('') : h; return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)); };
const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// 从皮肤文件里取出某条规则里某个属性的颜色值
const decl = (selector, prop) => {
  const rule = skin.match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'));
  assert.ok(rule, `skin-glass.css has no rule for ${selector}`);
  const value = rule[1].match(new RegExp('(?:^|[;\\s])' + prop + ':\\s*(#[0-9a-fA-F]{3,6})'));
  assert.ok(value, `${selector} has no ${prop}`);
  return value[1];
};
const themePage = (id) => tokens.match(new RegExp(`:root\\[data-theme="${id}"\\]\\s*\\{[^}]*?--skin-page:\\s*(#[0-9a-fA-F]{6})`))[1];

test('grey text tokens in the glass skin are readable on white cards and on the page background of both themes', () => {
  const block = skin.match(/:root\[data-skin="glass"\] \{\s*--muted:[^}]*\}/)[0];
  for (const name of ['--muted', '--color-neutral-500', '--color-neutral-600', '--ink-500', '--ink-600']) {
    const color = block.match(new RegExp(name + ':\\s*(#[0-9a-fA-F]{6})'))[1];
    for (const [where, bg] of [['white', '#ffffff'], ['pink page', themePage('pink')], ['orange page', themePage('orange')]]) {
      assert.ok(ratio(color, bg) >= 4.5, `${name} ${color} on ${where} is only ${ratio(color, bg).toFixed(2)}:1`);
    }
  }
});

test('badges, tags and tinted labels in the glass skin keep a text contrast of at least 4.5:1', () => {
  const pairs = [
    ['.new-badge', '#ffffff', decl(':root[data-skin="glass"] .new-badge', 'background')],
    ['.team-rank-1', '#ffffff', decl(':root[data-skin="glass"] .team-rank-1', 'background')],
    ['.lcd-person span', '#ffffff', decl(':root[data-skin="glass"] .lcd-person span', 'background')],
    ['.tag', decl(':root[data-skin="glass"] .tag', 'color'), '#fae7e4'],
    ['.tag.green', decl(':root[data-skin="glass"] .tag.green', 'color'), '#ecf8f1'],
    ['.calendar-event.task', decl(':root[data-skin="glass"] .calendar-event.task', 'color'), '#fff5e9'],
  ];
  for (const [name, fg, bg] of pairs) assert.ok(ratio(fg, bg) >= 4.5, `${name}: ${fg} on ${bg} is only ${ratio(fg, bg).toFixed(2)}:1`);
});

test('buttons with a coloured background keep white text instead of the dark default button text', () => {
  for (const selector of ['.owner-switch button.active', '.lcd-root .lcd-primary', '.global-search-empty-actions button:last-child']) {
    assert.match(skin, new RegExp(':root\\[data-skin="glass"\\] ' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^{]*\\{[^}]*color:\\s*#fff'), selector);
  }
});

test('placeholder text is lighter than typed text but still at least 4.5:1', () => {
  // 占位文字用深色 50% 透明度：在白底上换算成实色再算对比度
  const ink = [35, 23, 32];
  const flat = ink.map((v) => Math.round(v * 0.6 + 255 * 0.4));
  const hex = '#' + flat.map((v) => v.toString(16).padStart(2, '0')).join('');
  assert.ok(ratio(hex, '#ffffff') >= 4.5, `placeholder ${hex} is ${ratio(hex, '#ffffff').toFixed(2)}:1`);
  assert.match(skin, /button\.lai-select-trigger\[data-empty="true"\] \{ color: rgba\(var\(--skin-ink-rgb\), 0\.6\)/);
  assert.match(skin, /input::placeholder,[\s\S]*?textarea::placeholder \{ color: rgba\(var\(--skin-ink-rgb\), 0\.6\)/);
});

test('tab strips, calendar cells and agenda rows keep square corners and their own thin lines in the glass skin', () => {
  assert.match(skin, /:is\(\.team-tabs button, \.calendar-day, \.agenda-item, \.team-goal-new\) \{ border-radius: 0; \}/);
  assert.match(skin, /\.team-tabs button\[aria-selected="true"\]:hover:not\(:disabled\) \{ border-color: transparent transparent var\(--brand-700\); \}/);
});

test('the active rail item is a brand pill around icon and text; the batch bar and the follow-up card are light', () => {
  const light = skin.slice(skin.indexOf('深色强调色改浅'));
  assert.ok(light.length > 100, 'section exists after the earlier dark rules, so it wins the cascade');
  assert.match(light, /\.rail-item\.active:hover \{ background: var\(--brand-700\); color: #fff; box-shadow: [^;]*; font-weight: 700; \}/, 'the whole item, text included, is the pill');
  assert.match(light, /\.rail-item\.active :is\(\.icon, \.icon-duo\) \{ stroke: #fff; color: #fff; \}/);
  assert.doesNotMatch(light, /\.rail-item\.active[^{]*\{[^}]*inset 3px 0 0/, 'no left bar any more');
  assert.match(light, /\.replica-batch \{ background: #fff;[^}]*border: 1px solid var\(--brand-500\)/);
  assert.match(light, /\.wb-dark \{ background: var\(--card-bg\); color: rgb\(var\(--skin-ink-rgb\)\)/);
  assert.doesNotMatch(light, /background: rgb\(var\(--skin-ink-rgb\)\)/, 'no dark fills in this section');
  // 浅粉底上的玫粉字：粉色、橙色两套主题都要 ≥ 4.5
  for (const theme of ['pink', 'orange']) {
    const block = tokens.slice(tokens.indexOf(`:root[data-theme="${theme}"]`));
    const brand700 = block.match(/--brand-700:\s*(#[0-9a-fA-F]{6})/)[1];
    const brand50 = block.match(/--brand-50:\s*(#[0-9a-fA-F]{6})/)[1];
    assert.ok(ratio(brand700, brand50) >= 4.5, `${theme}: ${brand700} on ${brand50} is ${ratio(brand700, brand50).toFixed(2)}:1`);
    assert.ok(ratio(brand700, '#ffffff') >= 4.5, `${theme}: ${brand700} on white`);
  }
});
