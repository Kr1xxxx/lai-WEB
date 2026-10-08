const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const glass = read('src/skin-glass.css');

test('the board has the view switch both in the page header (classic) and in the filter card (new skin); only one is shown per skin', () => {
  const ui = read('src/opportunity-ui.js');
  assert.match(ui, /viewSwitch\(view,' opp-view-in'\)/);
  assert.match(ui, /class="opp-analysis-link" data-lai-route="opp-analysis"/);
  assert.match(read('src/business.css'), /\.opp-view-in, \.opp-analysis-link \{ display: none; \}/);
  assert.match(glass, /\.pagebar \.opp-view \{ display: none; \}/);
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
