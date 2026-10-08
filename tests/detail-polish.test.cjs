// 三处小改动：计划日程在客户详情左栏、商机「⋮」菜单贴着卡片、订单表单顶部的「由商机生成」提示条。
process.env.TZ = 'Asia/Taipei';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../src/model.js');
const D = require('../src/customer-detail-ui.js');
const O = require('../src/opportunity-model.js');
const U = require('../src/opportunity-ui.js');
const ui = U.create(M.escapeHtml, O);
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('the 计划日程 card is in the left column, once, and no longer in the right column', () => {
  const state = { orders: [], customers: { Acme: { nextFollow: '2026-11-05' } } };
  const html = D.render(M.buildCustomers(state)[0], { state, escape: M.escapeHtml });
  const left = html.slice(html.indexOf('<aside class="lcd-left">'), html.indexOf('</aside>', html.indexOf('<aside class="lcd-left">')));
  const right = html.slice(html.indexOf('<div class="lcd-right">'));
  assert.equal(html.split('lcd-card lcd-schedule').length - 1, 1);
  assert.match(left, /lcd-card lcd-schedule/);
  assert.doesNotMatch(right, /lcd-card lcd-schedule/);
  assert.ok(left.indexOf('lcd-summary') < left.indexOf('lcd-schedule') && left.indexOf('lcd-schedule') < left.indexOf('lcd-contacts'), '在资料摘要和联系人之间');
});

test('the opportunity menu sits beside its card: right first, then left, then the window edge; never off screen', () => {
  const view = { width: 1440, height: 900 }, size = { width: 232, height: 420 };
  const card = { left: 300, right: 520, top: 200, bottom: 300 };
  assert.deepEqual(ui.menuPosition(card, view, size), { left: 528, top: 200, maxHeight: 884 });
  const nearRight = { left: 1200, right: 1420, top: 200, bottom: 300 };
  assert.equal(ui.menuPosition(nearRight, view, size).left, 1200 - 8 - 232, '右边放不下就放左边');
  const tall = ui.menuPosition({ left: 300, right: 520, top: 800, bottom: 880 }, view, size);
  assert.equal(tall.top, 900 - 8 - 420, '靠下的卡片，菜单上移到能完整显示');
  const tiny = ui.menuPosition({ left: 5, right: 215, top: 0, bottom: 80 }, { width: 400, height: 300 }, size);
  assert.ok(tiny.left >= 8 && tiny.left + 232 <= 392 && tiny.top >= 8, '窄窗口里也在窗口内');
  assert.equal(tiny.maxHeight, 284, '菜单比窗口高时限制高度、内部滚动');
});

test('the menu is anchored only in the glass skin, from the clicked card, and the dock rule stays as the fallback', () => {
  const business = read('src/business-ui.js'), skin = read('src/skin-glass.css');
  assert.match(business, /if \(glassSkin\(\)\) anchorOppMenu\(id\);/);
  assert.match(business, /trigger\.closest\("\.opp-card, tr"\)/);
  assert.match(skin, /\.overlay:has\(\.opp-menu\) \.drawer \{ top: 128px; right: 12px;/);
});

test('an order made from an opportunity shows where it came from, escaped, and the form passes the source on', () => {
  const html = ui.sourceBannerMarkup({ name: 'Q4 <Lash>', client: 'Acme & Co', amount: 5000, currency: 'USD' });
  assert.match(html, /<strong>由商机生成<\/strong>/);
  assert.match(html, /Q4 &lt;Lash&gt;/);
  assert.match(html, /Acme &amp; Co/);
  assert.match(html, /role="note"/);
  assert.equal(ui.sourceBannerMarkup(null), '', '商机不存在时不显示');
  const business = read('src/business-ui.js');
  assert.match(business, /orderEditor\(undefined, \{ \.\.\.OM\(\)\.orderDraft\(item, B\.localDate\(\)\), num: nextOrderNumber\(\) \}, back, id\);/);
  assert.match(business, /draft\.fromOpportunity \? OU\(\)\.sourceBannerMarkup\(oppCard\(draft\.fromOpportunity\)\) : ""/);
  assert.match(read('src/business.css'), /\.opp-source-banner \{/);
});
