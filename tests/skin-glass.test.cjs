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
    // 团队数据的第一名是组件套件的提醒徽标（k-badge--warning）：字色、底色都是 ui-tokens.css 里的值
    ['.k-badge--warning (第一名)', tokens.match(/--warning-fg:\s*(#[0-9a-fA-F]{6})/)[1], tokens.match(/--color-warning-soft:\s*(#[0-9a-fA-F]{6})/)[1]],
    ['.tag', decl(':root[data-skin="glass"] .tag', 'color'), '#fae7e4'],
    ['.tag.green', decl(':root[data-skin="glass"] .tag.green', 'color'), '#ecf8f1'],
  ];
  for (const [name, fg, bg] of pairs) assert.ok(ratio(fg, bg) >= 4.5, `${name}: ${fg} on ${bg} is only ${ratio(fg, bg).toFixed(2)}:1`);
});

test('buttons with a coloured background keep white text instead of the dark default button text', () => {
  // 客户详情（D-028 组件套件）：「写邮件」「保存跟进」是 .k-btn--primary，白字来自组件；身份标签（私海客户）是中性徽标的颜色
  const detail = read('src/customer-detail-ui.js');
  assert.match(detail, /feature\("写邮件", "写邮件", "k-btn k-btn--primary"\)/);
  assert.match(detail, /<button type="submit" class="k-btn k-btn--primary">保存跟进<\/button>/);
  assert.doesNotMatch(skin, /lcd-primary|lcd-person/);
  assert.match(read('src/customer-detail.css'), /\.lcd-person > span \{[^}]*background: var\(--muted-bg\); color: var\(--muted-fg\)/);
  // 客户列表（D-028 组件套件）：「团队客户」和「新建客户」是 .k-tab／.k-btn--primary，白字来自组件，不再要皮肤单独补
  const list = read('src/customer-list-ui.js');
  assert.match(list, /class="k-btn k-btn--primary" data-action="new"/);
  assert.match(read('src/ui-kit.css'), /\.k-btn--primary \{ background: var\(--primary\); border-color: var\(--primary\); color: var\(--primary-fg\); \}/);
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

test('团队数据 tabs and the new-target cell come from the kit, so the glass skin needs no fixes for them', () => {
  // 结果目标/过程目标/商机目标 are .k-tabs (segmented, kit radius); 新建目标 is a dashed tile drawn in business.css with tokens.
  const team = read('src/team-ui.js');
  assert.match(team, /<div class="k-tabs team-tabs" role="tablist">\$\{[^]*?<button type="button" class="k-tab" role="tab" data-team-tab=/);
  assert.match(read('src/team-ui.js'), /team-rank k-badge \$\{rank===1\?'k-badge--warning':'k-badge--neutral'\}/);
  assert.match(read('src/business.css'), /:root\[data-skin\] \.team-goal-new \{[^}]*border: 1px dashed var\(--input\); border-radius: var\(--r-xl\)/);
  assert.doesNotMatch(skin, /\.team-(tabs|goal-new|rank)/, 'no glass overrides left for the team pages');
});

test('the active rail item is a brand pill around icon and text; the batch bar is light', () => {
  const light = skin.slice(skin.indexOf('深色强调色改浅'));
  assert.ok(light.length > 100, 'section exists after the earlier dark rules, so it wins the cascade');
  assert.match(light, /\.rail-item\.active:hover \{ background: var\(--nav-active\); color: #fff; box-shadow: none; font-weight: 700; \}/, 'the whole item, text included, is the pill');
  assert.match(tokens, /--nav-active: var\(--brand-700\);/, 'pink and orange: the pill is the darker brand tone');
  assert.match(light, /\.rail-item\.active :is\(\.icon, \.icon-duo\) \{ stroke: #fff; color: #fff; \}/);
  assert.doesNotMatch(light, /\.rail-item\.active[^{]*\{[^}]*inset 3px 0 0/, 'no left bar any more');
  // 客户列表的批量操作条是浅色的：迁到组件套件后写在 customer-replica.css 的「kit: 客户列表」块里，浅主色底（D-028）
  const replica = read('src/customer-replica.css');
  assert.match(replica.slice(replica.indexOf('/* kit: 客户列表 */')), /\.replica-batch \{[^}]*background: var\(--accent-bg\)/);
  assert.doesNotMatch(skin, /\.replica-batch/, 'no old batch-bar rules left in the skin');
  assert.doesNotMatch(skin, /\.wb-dark|\.wb-follow|\.wb-stat/, 'the old dark follow-up card and counter tiles are gone; the workbench draws light panels (business.css)');
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

test('科技蓝: flat white panels, a navy rail with light icons and a cobalt active item, cobalt buttons, no glow blobs', () => {
  const tech = skin.slice(skin.indexOf(':root[data-skin="glass"][data-theme="tech"] {'));
  assert.ok(tech.length > 500, 'the tech section exists at the end, so it wins the cascade');
  // No glow blobs, no blur and white cards for every theme now (D-028): the base glass block says so once.
  assert.match(skin, /:root\[data-skin="glass"\] #app::before,\s*:root\[data-skin="glass"\] #app::after \{ content: none; display: none; \}/);
  assert.match(tokens, /--card-bg: #fff;/);
  assert.match(skin, /:root\[data-skin="glass"\] \{[^}]*--skin-blur: none;/);
  assert.match(tech, /--nav-bg: var\(--brand-900\);/);
  assert.match(tech, /--nav-active: var\(--brand-500\);/);
  assert.match(tech, /\.rail \{ background: var\(--nav-bg\);/);
  assert.match(tech, /\.rail-item\.active:hover \{ background: var\(--nav-active\); color: #fff;/);
  // Primary buttons are the brand colour in every theme (cobalt here), through --primary.
  assert.match(tokens, /--primary: var\(--brand-500\);/);
  assert.match(skin, /\[data-theme\] button\.primary,[\s\S]*?\{ background: var\(--primary\); border-color: var\(--primary\); color: var\(--primary-fg\); \}/);
  // The workbench's 新建订单 is the kit's primary button (D-028), which is var(--primary) in every theme.
  assert.match(read('src/workbench.js'), /class="k-btn k-btn--primary" data-biz-action="new-order"/);
  assert.match(read('src/ui-kit.css'), /\.k-btn--primary \{ background: var\(--primary\); border-color: var\(--primary\); color: var\(--primary-fg\); \}/);
  // every tech rule is limited to the tech theme (the glass skin test above already pins data-skin)
  const rules = tech.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+\{/g);
  // The section shrinks on purpose as pages move onto the kit (their colours come from tokens), so this only checks
  // that a real tech section is left; the specific rail, button and panel rules are pinned above.
  assert.ok(rules.length > 10);
  for (const rule of rules) {
    const selectors = rule.replace(/\{$/, '').replace(/:(?:is|not)\([^)]*\)/g, '').split(',').map((x) => x.trim());
    for (const selector of selectors) assert.ok(selector.startsWith(':root[data-skin="glass"][data-theme="tech"]'), selector);
  }
});

test('科技蓝 colours: text on white, on the cool page and on navy keeps the contrast, and the greys are cool, not warm', () => {
  const block = tokens.slice(tokens.indexOf(':root[data-theme="tech"]'));
  const get = (name) => block.match(new RegExp(name + ':\\s*(#[0-9a-fA-F]{6})'))[1];
  assert.equal(get('--skin-page'), '#eef2f7');
  assert.equal(get('--brand-500'), '#2f5bff');
  assert.ok(ratio(get('--brand-700'), '#ffffff') >= 4.5 && ratio(get('--brand-700'), get('--brand-50')) >= 4.5, 'brand text on white and on the light tint');
  assert.ok(ratio('#ffffff', get('--brand-500')) >= 4.5, 'white text on the cobalt button');
  assert.ok(ratio('#ffffff', get('--brand-900')) >= 7, 'white on the navy rail');
  assert.ok(ratio('#c4cad3', get('--brand-900')) >= 7, 'the rail text (74% white over navy is about this grey) on navy');
  assert.ok(ratio(get('--brand-300'), get('--brand-900')) >= 4.5, 'light cobalt icons on navy');
  // The glass skin turns the grey text tokens warm for pink and orange; the tech section sets them back to cool greys.
  const muted = skin.slice(skin.indexOf('科技蓝（data-theme="tech"）'));
  for (const name of ['--muted', '--ink-500', '--ink-600', '--text-muted']) {
    const color = muted.match(new RegExp(name + ':\\s*(#[0-9a-fA-F]{6})'))[1];
    assert.ok(ratio(color, '#ffffff') >= 4.5, `${name} ${color} on white`);
    assert.ok(ratio(color, '#eef2f7') >= 4.5, `${name} ${color} on the page`);
  }
  for (const n of [900, 800, 700, 600, 500, 400, 300, 200, 100, 50]) {
    const [r, g, b] = rgb(get('--ink-' + n));
    assert.ok(b >= g && g >= r - 2, `--ink-${n} is a cool grey`);
  }
});
