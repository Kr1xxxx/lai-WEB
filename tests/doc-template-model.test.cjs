const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/doc-template-model.js');
const UI = require('../src/doc-template-ui.js').create((s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]), M);

test('defaults: four document types, name and qty columns always on, nothing is saved yet', () => {
  const s = M.settings({});
  assert.deepEqual(M.TYPES.map((t) => t[1]), ['报价单', '形式发票', '销售订单', '发货通知']);
  assert.equal(s.templates.pi.showBank, true);
  assert.equal(s.templates.shipping.showBank, false);
  assert.equal(s.templates.quote.columns.name && s.templates.quote.columns.qty, true);
  assert.equal(s.templates.quote.columns.model, false);
});

test('setTemplate: title required, fixed columns cannot be hidden, other types untouched', () => {
  const base = {};
  assert.throws(() => M.setTemplate(base, 'quote', { title: '  ' }), /请填写单据标题/);
  assert.throws(() => M.setTemplate(base, 'nope', {}), /没有这种单据/);
  const next = M.setTemplate(base, 'quote', { title: '报价', columns: { name: false, qty: false, model: true, price: false }, terms: 'a\nb', showBank: false });
  const t = M.settings(next).templates.quote;
  assert.equal(t.title, '报价');
  assert.equal(t.columns.name && t.columns.qty, true);
  assert.equal(t.columns.model, true);
  assert.equal(t.columns.price, false);
  assert.equal(t.showBank, false);
  assert.equal(M.settings(next).templates.pi.title, '形式发票');
  assert.equal(base.laiSettings, undefined, 'input state is not changed');
});

test('limits and reset', () => {
  assert.throws(() => M.setTemplate({}, 'quote', { title: 'x'.repeat(41) }), /最长 40/);
  assert.throws(() => M.setTemplate({}, 'quote', { terms: 'x'.repeat(2001) }), /最长 2000/);
  assert.throws(() => M.setCompany({}, { name: 'x'.repeat(201) }), /最长 200/);
  const changed = M.setTemplate({}, 'pi', { title: '我的PI', showSignature: false });
  assert.equal(M.settings(M.resetTemplate(changed, 'pi')).templates.pi.title, '形式发票');
});

test('company and bank are saved together settings and kept when a template changes', () => {
  let s = M.setCompany({}, { name: 'ACME', phone: '123' });
  s = M.setBank(s, { bank: 'HSBC', account: '999' });
  s = M.setTemplate(s, 'order', { title: 'SO' });
  assert.equal(M.settings(s).company.name, 'ACME');
  assert.equal(M.settings(s).bank.bank, 'HSBC');
  assert.equal(M.settings(s).templates.order.title, 'SO');
});

test('preview uses products when there are some, totals are price x qty, bank only when shown', () => {
  let s = M.setBank({ laiProducts: [{ code: 'P1', name: '睫毛', unit: '盒', fob: '2.5' }] }, { bank: 'HSBC', account: '999' });
  const doc = M.preview(s, 'pi');
  assert.equal(doc.rows.length, 1);
  assert.equal(doc.total, '250.00');
  assert.deepEqual(doc.bank.map((b) => b[0]), ['开户银行', '银行账号']);
  assert.deepEqual(M.preview(s, 'shipping').bank, []);
  assert.equal(M.preview({}, 'quote').rows.length, 2, 'sample lines when there are no products');
});

test('UI: tabs, hidden columns leave the table, text is escaped', () => {
  const s = M.setCompany(M.setTemplate({}, 'quote', { columns: { price: false, amount: false } }), { name: '<b>ACME</b>' });
  const html = UI.pageMarkup(s, { tab: 'quote' });
  assert.match(html, /data-doc-tab="company"/);
  assert.equal((html.match(/data-doc-tab=/g) || []).length, 5);
  assert.ok(!html.includes('<th class="num">单价</th>') && !html.includes('合计'));
  assert.ok(html.includes('&lt;b&gt;ACME') && !html.includes('<b>ACME'));
  assert.match(UI.pageMarkup(s, { tab: 'company' }), /data-doc-form="company"/);
  assert.match(UI.printHtml(M.preview(s, 'quote')), /^<!doctype html>/);
});
