const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/doc-template-model.js');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const UI = require('../src/doc-template-ui.js').create(esc, M);

const LINES = [{ code: 'A', name: '睫毛', model: 'M1', unit: '盒', qty: 10, price: 2.5 }];
const save = (state, over = {}) => M.saveDocument(state, { type: 'quote', today: '2026-10-15', date: '2026-10-15', client: 'ACME', currency: 'USD', lines: LINES, source: { kind: 'order', id: 'o1', label: 'L1' }, ...over });
const numbers = (state) => state.laiDocuments.map((d) => d.number);

test('default rules per type and the live example format', () => {
  const n = M.settings({}).numbering;
  assert.deepEqual(['quote', 'pi', 'order', 'shipping'].map((t) => n[t].prefix), ['QT', 'PI', 'SO', 'DN']);
  assert.equal(n.quote.dateMode, 'day');
  assert.equal(n.quote.digits, 3);
  assert.equal(M.nextNumber({}, 'quote', '2026-10-15').number, 'QT-20261015-001');
  assert.equal(M.nextNumber({}, 'shipping', '2026-10-15').number, 'DN-20261015-001');
});

test('number format for each date mode and digit count', () => {
  const at = (rule) => M.formatNumber(M.checkRule(rule, 'quote'), '2026-03-09', 7);
  assert.equal(at({ dateMode: 'none' }), 'QT-007');
  assert.equal(at({ dateMode: 'year' }), 'QT-2026-007');
  assert.equal(at({ dateMode: 'month' }), 'QT-202603-007');
  assert.equal(at({ dateMode: 'day' }), 'QT-20260309-007');
  assert.equal(at({ dateMode: 'day', digits: 5, prefix: 'bj-1' }), 'bj-1-20260309-00007');
});

test('rule validation messages', () => {
  const bad = (rule, re) => assert.throws(() => M.setNumbering({}, 'quote', rule), re);
  bad({ prefix: '' }, /前缀要填 1 到 10 个字符/);
  bad({ prefix: 'ABCDEFGHIJK' }, /前缀要填 1 到 10 个字符/);
  bad({ prefix: '报价' }, /只能用字母、数字和横线/);
  bad({ prefix: 'A B' }, /只能用字母、数字和横线/);
  bad({ digits: 2 }, /序号位数请选 3 到 6 位/);
  bad({ digits: 7 }, /序号位数请选 3 到 6 位/);
  bad({ dateMode: 'week' }, /日期部分请从列表里选/);
  bad({ reset: 'hour' }, /重置方式请从列表里选/);
  bad({ dateMode: 'none', reset: 'day' }, /没有日期部分时，序号只能选“不重置”/);
  bad({ dateMode: 'month', reset: 'day' }, /不能比日期部分更细/);
  bad({ dateMode: 'year', reset: 'month' }, /不能比日期部分更细/);
  assert.throws(() => M.setNumbering({}, 'nope', {}), /没有这种单据/);
  // allowed combinations
  M.setNumbering({}, 'quote', { dateMode: 'day', reset: 'year' });
  M.setNumbering({}, 'quote', { dateMode: 'month', reset: 'never' });
  const none = M.setNumbering({}, 'quote', { dateMode: 'none', reset: '' });
  assert.equal(M.nextNumber(none, 'quote', '2026-10-15').number, 'QT-001');
});

test('setNumbering keeps other settings and other types', () => {
  let s = M.setCompany({}, { name: 'ACME' });
  s = M.setNumbering(s, 'quote', { prefix: 'BJ', digits: 4 });
  s = M.setTemplate(s, 'pi', { title: 'PI 单' });
  const st = M.settings(s);
  assert.equal(st.numbering.quote.prefix, 'BJ');
  assert.equal(st.numbering.quote.digits, 4);
  assert.equal(st.numbering.pi.prefix, 'PI');
  assert.equal(st.company.name, 'ACME');
  assert.equal(st.templates.pi.title, 'PI 单');
  assert.equal(M.nextNumber(s, 'quote', '2026-10-15').number, 'BJ-20261015-0001');
});

test('stored garbage rules fall back to defaults', () => {
  const s = { laiSettings: { docTemplates: { numbering: { quote: { prefix: '###', digits: 99 } }, counters: { quote: { seq: 'x' } } } } };
  assert.equal(M.settings(s).numbering.quote.prefix, 'QT');
  assert.equal(M.nextNumber(s, 'quote', '2026-10-15').number, 'QT-20261015-001');
});

test('counter goes up per document, and restarts per day / month / year / never', () => {
  const run = (rule, dates) => {
    let s = M.setNumbering({}, 'quote', rule);
    return dates.map((d) => { const r = save(s, { today: d }); s = r.state; return r.doc.number; });
  };
  assert.deepEqual(run({ dateMode: 'day' }, ['2026-10-15', '2026-10-15', '2026-10-16', '2026-10-15']),
    ['QT-20261015-001', 'QT-20261015-002', 'QT-20261016-001', 'QT-20261015-003']);
  assert.deepEqual(run({ dateMode: 'day', reset: 'month' }, ['2026-10-15', '2026-10-16', '2026-11-01']),
    ['QT-20261015-001', 'QT-20261016-002', 'QT-20261101-001']);
  assert.deepEqual(run({ dateMode: 'month' }, ['2026-10-15', '2026-10-16', '2026-11-01']),
    ['QT-202610-001', 'QT-202610-002', 'QT-202611-001']);
  assert.deepEqual(run({ dateMode: 'day', reset: 'year' }, ['2026-12-30', '2026-12-31', '2027-01-01']),
    ['QT-20261230-001', 'QT-20261231-002', 'QT-20270101-001']);
  assert.deepEqual(run({ dateMode: 'day', reset: 'never' }, ['2026-12-31', '2027-01-01']),
    ['QT-20261231-001', 'QT-20270101-002']);
  assert.deepEqual(run({ dateMode: 'year' }, ['2026-05-01', '2026-06-01', '2027-01-01']),
    ['QT-2026-001', 'QT-2026-002', 'QT-2027-001']);
  assert.deepEqual(run({ dateMode: 'none' }, ['2026-05-01', '2027-06-01']), ['QT-001', 'QT-002']);
});

test('each type counts on its own', () => {
  let s = save({}).state;
  s = save(s, { type: 'pi' }).state;
  s = save(s).state;
  assert.deepEqual(numbers(s), ['QT-20261015-002', 'PI-20261015-001', 'QT-20261015-001']);
});

test('voided numbers are never reused, and removing a record from the list cannot lower the count', () => {
  let s = save({}).state;
  s = save(s).state;
  s = M.voidDocument(s, s.laiDocuments[0].id);
  assert.equal(M.nextNumber(s, 'quote', '2026-10-15').number, 'QT-20261015-003');
  // even if the records were lost, the counter keeps going
  const lost = { ...s, laiDocuments: [] };
  assert.equal(M.nextNumber(lost, 'quote', '2026-10-15').number, 'QT-20261015-003');
  // and if the counter were lost, the records still keep the number up
  const noCounter = { ...s, laiSettings: undefined };
  assert.equal(M.nextNumber(noCounter, 'quote', '2026-10-15').number, 'QT-20261015-003');
});

test('changing the rule does not renumber old documents and starts again from 1; same number is never made twice', () => {
  let s = save({}).state;
  s = M.setNumbering(s, 'quote', { prefix: 'BJ' });
  const r = save(s);
  assert.equal(r.doc.number, 'BJ-20261015-001');
  assert.deepEqual(numbers(r.state), ['BJ-20261015-001', 'QT-20261015-001']);
  // back to QT: counter belongs to BJ, but QT-...-001 is taken, so it moves on
  const back = M.setNumbering(r.state, 'quote', { prefix: 'QT' });
  assert.equal(M.nextNumber(back, 'quote', '2026-10-15').number, 'QT-20261015-002');
  // another type with the same prefix cannot collide either
  let t = save({}).state;
  t = M.setNumbering(t, 'pi', { prefix: 'QT' });
  assert.equal(save(t, { type: 'pi' }).doc.number, 'QT-20261015-002');
});

test('nextNumber can preview an unsaved rule', () => {
  assert.equal(M.nextNumber({}, 'order', '2026-10-15', { prefix: 'X1', dateMode: 'month', digits: 4 }).number, 'X1-202610-0001');
  assert.throws(() => M.nextNumber({}, 'order', '2026-10-15', { prefix: '' }), /前缀/);
});

test('saveDocument: snapshot, totals, source, input state untouched', () => {
  let s = M.setCompany({}, { name: 'ACME Ltd' });
  const before = JSON.stringify(s);
  const r = save(s, { reference: { label: '订单号', value: 'L1' }, now: '2026-10-15T08:00:00.000Z', id: 'doc-1' });
  assert.equal(JSON.stringify(s), before);
  const d = r.doc;
  assert.equal(d.id, 'doc-1');
  assert.equal(d.type, 'quote');
  assert.equal(d.number, 'QT-20261015-001');
  assert.equal(d.total, 25);
  assert.equal(d.status, '有效');
  assert.equal(d.createdAt, '2026-10-15T08:00:00.000Z');
  assert.deepEqual(d.source, { kind: 'order', id: 'o1', label: 'L1' });
  assert.deepEqual(d.lines, [{ code: 'A', name: '睫毛', model: 'M1', unit: '盒', qty: 10, price: 2.5 }]);
  assert.equal(d.snapshot.number, d.number);
  assert.equal(d.snapshot.company.name, 'ACME Ltd');
  assert.deepEqual(d.snapshot.reference, { label: '订单号', value: 'L1' });
  assert.equal(r.state.laiDocuments[0], d);
  // changing the template afterwards does not change what was saved
  const changed = M.setTemplate(M.setCompany(r.state, { name: 'Other' }), 'quote', { title: '新标题' });
  assert.equal(changed.laiDocuments[0].snapshot.title, '报价单');
  assert.equal(changed.laiDocuments[0].snapshot.company.name, 'ACME Ltd');
  // counter sits in settings
  assert.deepEqual(M.settings(r.state).counters.quote, { period: '20261015', sig: 'QT|day|3', seq: 1 });
});

test('saveDocument: needs a client and lines, list is newest first and limited', () => {
  assert.throws(() => save({}, { client: '  ' }), /请先填写客户名称/);
  assert.throws(() => save({}, { lines: [] }), /请先添加产品/);
  assert.throws(() => save({}, { lines: [{ name: ' ', qty: 1 }] }), /请先添加产品/);
  assert.throws(() => save({}, { type: 'nope' }), /没有这种单据/);
  assert.throws(() => save({ laiDocuments: 'oops' }), /格式异常/);
  const full = { laiDocuments: Array.from({ length: M.LIMIT_DOCS }, (_, i) => ({ id: 'd' + i, number: 'X-' + i, type: 'pi', status: '有效' })) };
  assert.throws(() => save(full), /最多 5000 条/);
  assert.equal(M.LIMIT_DOCS, 5000);
  const a = save({}, { id: 'a' }), b = save(a.state, { id: 'b' });
  assert.deepEqual(b.state.laiDocuments.map((d) => d.id), ['b', 'a']);
});

test('voidDocument: marks, keeps the record and the number, cannot void twice', () => {
  const r = save({}, { id: 'a' });
  const v = M.voidDocument(r.state, 'a', '2026-10-16T01:00:00.000Z');
  const d = v.laiDocuments[0];
  assert.equal(d.status, '已作废');
  assert.equal(d.voidedAt, '2026-10-16T01:00:00.000Z');
  assert.equal(d.number, 'QT-20261015-001');
  assert.equal(r.state.laiDocuments[0].status, '有效', 'input state untouched');
  assert.throws(() => M.voidDocument(v, 'a'), /已经作废/);
  assert.throws(() => M.voidDocument(v, 'zzz'), /找不到/);
});

test('docsFor and listDocuments', () => {
  let s = save({}, { id: 'a', source: { kind: 'order', id: 'o1', label: 'L1' } }).state;
  s = save(s, { id: 'b', type: 'pi', client: 'Beta Co', source: { kind: 'opportunity', id: 'o1', label: '商机甲' } }).state;
  s = save(s, { id: 'c', source: { kind: 'order', id: 'o1', label: 'L1' } }).state;
  assert.deepEqual(M.docsFor(s, { kind: 'order', id: 'o1' }).map((d) => d.id), ['c', 'a']);
  assert.deepEqual(M.docsFor(s, { kind: 'opportunity', id: 'o1' }).map((d) => d.id), ['b']);
  assert.deepEqual(M.docsFor(s, { kind: 'order', id: 'zz' }), []);
  assert.deepEqual(M.docsFor({}, { kind: 'order', id: 'o1' }), []);
  assert.deepEqual(M.listDocuments(s, {}).map((d) => d.id), ['c', 'b', 'a']);
  assert.deepEqual(M.listDocuments(s, { type: 'pi' }).map((d) => d.id), ['b']);
  assert.deepEqual(M.listDocuments(s, { query: 'beta' }).map((d) => d.id), ['b']);
  assert.deepEqual(M.listDocuments(s, { query: 'qt-20261015-002' }).map((d) => d.id), ['c']);
  assert.deepEqual(M.getDocument(s, 'a').id, 'a');
  assert.equal(M.getDocument(s, 'x'), null);
});

test('linesFromOpportunity: product rows, library match by name, and the no-products fallback', () => {
  const state = { laiProducts: [{ code: 'P-1', name: 'Lash Glue', model: 'G9', unit: '瓶', fob: '3' }] };
  const lines = M.linesFromOpportunity(state, {
    name: '春季询盘', amount: 999,
    products: [{ name: ' lash glue ', quantity: 20, unitPrice: 4.5 }, { name: 'Brush', quantity: 3, unitPrice: 1 }, { name: '', quantity: 1 }],
  });
  assert.deepEqual(lines, [
    { code: 'P-1', name: 'lash glue', model: 'G9', unit: '瓶', qty: 20, price: 4.5 },
    { code: '', name: 'Brush', model: '', unit: '', qty: 3, price: 1 },
  ]);
  assert.deepEqual(M.linesFromOpportunity({}, { name: '春季询盘', amount: 999, products: [] }), [{ code: '', name: '春季询盘', model: '', unit: '', qty: 1, price: 999 }]);
  assert.deepEqual(M.linesFromOpportunity({}, { name: 'X', amount: '1,200' }), [{ code: '', name: 'X', model: '', unit: '', qty: 1, price: 1200 }]);
  // the doc made from them has the right total
  const r = save({}, { lines });
  assert.equal(r.doc.total, 90 + 3);
});

test('preview: number note and reference show up in the document', () => {
  const doc = M.preview({}, 'quote', { client: 'A', number: '', numberNote: '保存后生成编号', reference: { label: '商机', value: '春季询盘' } });
  const html = UI.documentMarkup(doc);
  assert.match(html, /保存后生成编号/);
  assert.match(html, /<dt>商机<\/dt><dd>春季询盘<\/dd>/);
  const saved = M.preview({}, 'quote', { client: 'A', number: 'QT-1', numberNote: '保存后生成编号' });
  assert.match(UI.documentMarkup(saved), /<dd>QT-1<\/dd>/);
  assert.equal(M.preview({}, 'quote', {}).reference, null);
});

test('UI: numbering tab has a form and example per type; text is escaped', () => {
  const s = M.setNumbering({}, 'quote', { prefix: 'BJ' });
  const html = UI.pageMarkup(s, { tab: 'numbering', date: '2026-10-15' });
  assert.equal((html.match(/data-doc-form="numbering"/g) || []).length, 4);
  assert.match(html, /data-doc-example="quote">下一张：<strong>BJ-20261015-001<\/strong>/);
  assert.match(html, /data-doc-example="pi">下一张：<strong>PI-20261015-001<\/strong>/);
  assert.match(html, /<option value="day" selected>/);
  assert.match(UI.exampleMarkup('', '前缀不对'), /dt-example-error/);
  assert.match(UI.exampleMarkup('<x>'), /&lt;x&gt;/);
});

test('UI: records tab lists documents, greys voided ones, filters and escapes', () => {
  let s = save({}, { id: 'a', client: '<b>Evil</b>', source: { kind: 'order', id: 'o1', label: 'L1' } }).state;
  s = save(s, { id: 'b', type: 'pi', client: 'Beta', source: { kind: 'opportunity', id: 'p1', label: '商机甲' } }).state;
  s = M.voidDocument(s, 'b');
  const html = UI.pageMarkup(s, { tab: 'records', rec: {}, date: '2026-10-15' });
  assert.match(html, /QT-20261015-001/);
  assert.match(html, /PI-20261015-001/);
  assert.ok(html.includes('&lt;b&gt;Evil') && !html.includes('<b>Evil'));
  assert.match(html, /订单 L1/);
  assert.match(html, /商机 商机甲/);
  assert.match(html, /<tr class="is-void">/);
  assert.equal((html.match(/data-doc-action="void"/g) || []).length, 1, 'voided row has no void button');
  assert.equal((html.match(/data-doc-action="view"/g) || []).length, 2);
  assert.match(UI.pageMarkup(s, { tab: 'records', rec: {}, armedVoid: 'a' }), /确定作废/);
  const filtered = UI.pageMarkup(s, { tab: 'records', rec: { type: 'pi' } });
  assert.ok(!filtered.includes('QT-20261015-001') && filtered.includes('PI-20261015-001'));
  assert.match(UI.pageMarkup(s, { tab: 'records', rec: { query: 'nothing' } }), /没有符合条件的单据/);
  assert.match(UI.pageMarkup({}, { tab: 'records', rec: {} }), /还没有保存过单据/);
});

test('UI: saved document view and the saved list', () => {
  let s = save({}, { id: 'a' }).state;
  s = save(s, { id: 'b' }).state;
  s = M.voidDocument(s, 'b');
  const [vb, va] = s.laiDocuments;
  assert.match(UI.paperMarkup(va), /QT-20261015-001/);
  assert.ok(!UI.paperMarkup(va).includes('已作废'));
  assert.match(UI.paperMarkup(vb), /这张单据已作废/);
  const list = UI.savedListMarkup(s.laiDocuments);
  assert.equal((list.match(/data-biz-action="docrec-view"/g) || []).length, 2);
  assert.match(list, /已作废/);
  assert.equal(UI.savedListMarkup([]), '');
});
