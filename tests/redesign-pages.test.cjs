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
  assert.match(ui, /class="opp-analysis-link" data-lai-route="opp-analysis"/);
  assert.match(read('src/business.css'), /\.opp-view-in, \.opp-analysis-link \{ display: none; \}/);
  assert.doesNotMatch(glass, /\.pagebar \.opp-view/, 'no header copy left to hide');
  assert.match(glass, /\.opp-view-in \{ display: inline-flex; \}/);
});

test('the board, card menu and form dock rules are scoped to the new skin', () => {
  for (const rule of ['.opp-column', '.opp-stage', ':has(.opp-menu)', ':has(#opp-form)', ':has(#biz-order-form)', '.lcd-pagebar', '.lcd-card']) {
    const line = glass.split('\n').find((l) => l.includes(rule));
    assert.ok(line, rule);
    assert.match(line, /:root\[data-skin="glass"\]/, rule);
  }
});

test('the customer page greys use the readable token in the new skin and keep the old value elsewhere', () => {
  const css = read('src/customer-detail.css');
  assert.doesNotMatch(css, /^\s*color: #777;/m);
  assert.match(css, /color: var\(--text-muted, #777\)/);
  assert.match(css, /color: var\(--text-muted, #75777d\)/);
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
  assert.match(glass, /:root\[data-skin="glass"\] \.lcd-side \{ display: flex;/);
});
