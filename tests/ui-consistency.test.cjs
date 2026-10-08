const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const skin = read('src/skin-glass.css');
const app = read('src/app.js');

test('checkboxes are one shape in every state: 16px rounded square, filled with a tick when checked, a dash when mixed', () => {
  const base = skin.match(/:root\[data-skin="glass"\] input\[type="checkbox"\] \{([^}]*)\}/)[1];
  assert.match(base, /appearance: none/);
  assert.match(base, /width: 16px; height: 16px/);
  assert.match(base, /border-radius: 5px/);
  assert.match(skin, /input\[type="checkbox"\]:checked \{[^}]*background-color: var\(--brand-500\)[^}]*stroke='white'/);
  assert.match(skin, /input\[type="checkbox"\]:indeterminate \{[^}]*stroke='white'/);
  // 没有哪条规则只给选中状态换成系统自带外观（会让选中后变成另一种形状）
  assert.doesNotMatch(skin, /checkbox"\][^{]*:checked[^{]*\{[^}]*appearance: auto/);
});

test('radios are circles with a dot; the groups drawn as text buttons or custom dots are left alone', () => {
  assert.match(skin, /input\[type="radio"\]:not\(:is\(\.segment-match-options, \.opp-seg, \.ce-rating\) input\) \{[^}]*border-radius: 50%/);
  assert.match(skin, /radial-gradient\(circle, var\(--brand-500\)/);
});

test('the customer list selection column is narrower in the new skin only', () => {
  assert.match(app, /const selectionWidth = document\.documentElement\.dataset\.skin === "glass" \? 48 : 84/);
});

test('the split 新建客户 button, page-header buttons and the customer form inputs follow the same 8px corners', () => {
  assert.match(skin, /\.split-new > button:first-child \{ border-radius: 8px 0 0 8px; \}/);
  assert.match(skin, /\.split-new > button:last-child \{ border-radius: 0 8px 8px 0; \}/);
  assert.match(skin, /\.pagebar \.page-actions > button \{ height: 32px; min-height: 32px; \}/);
  assert.match(skin, /\.ce-body :is\(input[^)]*\)[^{]*select, textarea\) \{ border-radius: 8px;/);
});

test('every left-menu entry has a tinted-line icon, each drawn from its own paths, and the old icon stays for the classic skin', () => {
  const rail = [...app.matchAll(/\["(\w+)", "([^"]+)", (?:null|"[\w-]+"),? ?(?:"(\w+)")?\]/g)].map((m) => ({ icon: m[1], label: m[2], duo: m[3] }));
  const labels = rail.map((r) => r.label);
  const expected = ['常用', '工作台', '邮件', '沟通', '线索', '客户', '商机', 'Leads', '交易', '团队数据', '协同', '设置', '企业管理'];
  for (const label of expected) assert.ok(labels.includes(label), label);
  const block = app.slice(app.indexOf('const duoIcons = {'), app.indexOf('const menuIcon'));
  const duoNames = new Set([...block.matchAll(/^\s{4}(\w+): \{ tint: "([^"]+)", line: "([^"]+)" \}/gm)].map((m) => { assert.ok(m[2].length > 10 && m[3].length > 10); return m[1]; }));
  const duoMap = Object.fromEntries([...app.match(/const duoNames = \{([^}]*)\}/)[1].matchAll(/(\w+): "(\w+)"/g)].map((m) => [m[1], m[2]]));
  const used = rail.filter((r) => expected.includes(r.label)).map((r) => r.duo || duoMap[r.icon]);
  for (const name of used) assert.ok(duoNames.has(name), `no tinted icon for ${name}`);
  assert.equal(new Set(used).size, used.length, 'no two menu entries share one icon');
  assert.match(app, /icon\(name\)\.replace\("class=\\"icon\\"", "class=\\"icon icon-classic\\""\)/);
  assert.match(read('src/styles.css'), /\.icon-duo \{ display: none; \}/);
  assert.match(skin, /:root\[data-skin="glass"\] \.icon-classic \{ display: none; \}/);
  assert.match(skin, /:root\[data-skin="glass"\] \.icon-duo \{ display: block;/);
});
