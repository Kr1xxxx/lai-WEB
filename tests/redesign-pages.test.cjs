const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const glass = read('src/skin-glass.css');

test('the board has the view switch in the filter card only (the classic page-header copy is gone, D-029)', () => {
  const ui = read('src/opportunity-ui.js');
  assert.match(ui, /viewSwitch\(view,' opp-view-in'\)/);
  assert.equal((ui.match(/viewSwitch\(/g) || []).length, 1, 'one call: the filter card');
  // 「商机分析」是标题后的页签；页头里不再重复放一个按钮（2026-10 商机美化）。
  assert.doesNotMatch(ui, /opp-analysis-link/);
  assert.match(ui, /class="k-tabs opp-view\$\{extra\}"/, 'the switch is the kit tabs (D-028)');
  // 旧版页头里那份切换去掉后（D-029），隐藏/显示这一对规则也不需要了。
  assert.doesNotMatch(read('src/business.css'), /\.opp-view-in, \.opp-analysis-link \{ display: none; \}/);
  assert.doesNotMatch(glass, /\.pagebar \.opp-view/, 'no header copy left to hide');
  assert.doesNotMatch(glass, /\.opp-view-in|\.opp-analysis-link/);
});

test('the card menu and form dock rules are scoped to the new skin; the board itself is on the kit', () => {
  for (const rule of [':has(.opp-menu)', ':has(#opp-form)', ':has(#biz-order-form)']) {
    const line = glass.split('\n').find((l) => l.includes(rule));
    assert.ok(line, rule);
    assert.match(line, /:root\[data-skin="glass"\]/, rule);
  }
  // 客户详情的页头和卡片是组件套件的 .k-pageheader／.k-card（D-028），排版在 customer-detail.css 的「kit: 客户详情」块里，皮肤里不再另画一遍。
  const detailUi = read('src/customer-detail-ui.js');
  assert.match(detailUi, /<header class="lcd-pagebar k-pageheader">/);
  assert.match(detailUi, /<section class="lcd-card lcd-summary k-card">/);
  assert.ok(!glass.split('\n').some((l) => l.includes('.lcd-')), 'no 客户详情 rules left in the skin');
  const detailKit = read('src/customer-detail.css').split('/* kit: 客户详情 */')[1] || '';
  for (const rule of ['.lcd-pagebar.k-pageheader', '.lcd-card.k-card']) assert.ok(detailKit.includes(rule), rule);
  // 看板的列、列头、卡片和金额卡片改用组件套件（D-028），样式只在 business.css 里，皮肤里不再另画一遍。
  for (const rule of ['.opp-board', '.opp-column', '.opp-stage ', '.opp-stage-name', '.opp-cards', '.opp-card ', '.opp-card:', '.opp-stat']) {
    assert.ok(!glass.split('\n').some((l) => l.includes(rule)), `${rule} is styled in business.css on the kit`);
  }
});

test('the customer page greys use the readable token in the new skin and keep the old value elsewhere', () => {
  // 迁到组件套件后（D-028），灰色文字一律是 --muted-fg（各主题都 ≥ 4.5:1），不再有写死的灰色。
  const css = read('src/customer-detail.css');
  assert.doesNotMatch(css, /^\s*color: #777;/m);
  assert.doesNotMatch(css, /color:\s*(?:var\([^)]*,\s*)?#[0-9a-fA-F]{3,6}/, 'no literal text colours');
  assert.match(css, /\.lcd-field dt \{[^}]*color: var\(--muted-fg\)/);
  assert.match(css, /\.lcd-timeline time \{[^}]*color: var\(--muted-fg\)/);
});

test('focusing the view switch after a click picks the visible one when two exist', () => {
  assert.match(read('src/business-ui.js'), /querySelectorAll\(sel\)/);
});

test('the customer page has a summary column with info, orders, documents and history that reuses the existing handlers and escapes values', () => {
  const M = require('../src/model.js');
  const D = require('../src/customer-detail-ui.js');
  const state = {
    customers: { Acme: { history: [{ type: 'operation', time: '2026-09-23T11:22:33', text: '更新客户资料 <b>' }] } },
    orders: [{ id: 'o1', num: 'L-1', client: 'Acme', amount: 100, currency: 'USD', stage: 'production', createdAt: '2026-10-01', productType: '定制盒', attachments: [{ name: '报价单<x>.pdf' }] }],
  };
  const customer = M.buildCustomers(state)[0];
  const html = D.render(customer, { state, escape: M.escapeHtml });
  assert.doesNotMatch(html, /lcd-side/, 'off unless the app asks for it, so the other tabs and tests see only the page itself');
  const withSide = D.render(customer, { state, escape: M.escapeHtml, sideColumn: true });
  assert.match(withSide, /<aside class="lcd-side"/);
  assert.match(withSide, /data-new-customer-order="Acme"/);
  assert.match(withSide, /lcd-side-card[\s\S]*data-lai-order="o1"/);
  for (const tab of ['info', 'documents', 'history']) assert.match(withSide, new RegExp(`class="lcd-side-link" data-tab="${tab}"`));
  assert.match(withSide, /报价单&lt;x&gt;\.pdf/);
  assert.doesNotMatch(withSide, /报价单<x>/);
  assert.match(withSide, /更新客户资料 &lt;b&gt;/);
  const css = read('src/customer-detail.css');
  assert.match(css, /\.lcd-side \{ display: none; \}/);
  assert.match(css, /:root\[data-skin="glass"\] \.lcd-side \{ display: flex;/);
});
