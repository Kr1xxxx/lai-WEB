const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../src/export-model.js');
const XLSX = require('../vendor/sheetjs-0.20.3/xlsx.full.min.js');

const hide = (...ids) => ({ columnVisible: id => !ids.includes(id) });

test('customer columns follow the given order and labels', () => {
  const rows = [{ name: 'Acme', country: '法国', owner: '小王', total: 1200 }];
  const out = E.customerRows(rows, { columns: ['owner', 'name', 'total'], contactsCell: false });
  assert.deepEqual(out.header, ['跟进人', '公司名称', '成交订单金额(USD)']);
  assert.deepEqual(out.data, [['小王', 'Acme', 1200]]);
});

test('hidden email column is absent, also from the other-contacts cell', () => {
  const rows = [{ name: 'Acme', email: 'a@x.test', extraContacts: [{ contact: 'Ben', email: 'ben@x.test', phone: '123' }] }];
  const shown = E.customerRows(rows, { columns: ['name', 'email'] });
  assert.deepEqual(shown.header, ['公司名称', '邮箱', '其他联系人']);
  assert.equal(shown.data[0][2], 'Ben ben@x.test 123');
  const gated = E.customerRows(rows, { columns: ['name', 'email'], gate: hide('email') });
  assert.deepEqual(gated.header, ['公司名称', '其他联系人']);
  assert.equal(gated.data[0][1], 'Ben 123');
  assert.ok(!JSON.stringify(gated).includes('x.test'));
});

test('blank stays blank, never 0; numbers stay numbers; booleans and arrays', () => {
  const rows = [{ name: 'A', total: null, average: undefined, opportunityCount: 0, tags: ['重点', '展会'], followed: true }];
  const out = E.customerRows(rows, { columns: ['name', 'total', 'average', 'opportunityCount', 'tags', 'followed', 'country'], contactsCell: false });
  assert.deepEqual(out.data[0], ['A', '', '', 0, '重点、展会', '是', '']);
  assert.equal(typeof out.data[0][3], 'number');
});

test('dates are local YYYY-MM-DD', () => {
  const d = new Date(2026, 4, 3, 23, 30);
  assert.equal(E.localDay(d.toISOString()), '2026-05-03');
  assert.equal(E.localDay('2026-05-03'), '2026-05-03');
  assert.equal(E.localDay('bad'), '');
  const out = E.customerRows([{ name: 'A', createdAt: d.toISOString(), nextFollow: '2026-06-01' }], { columns: ['createdAt', 'nextFollow'], contactsCell: false });
  assert.deepEqual(out.data[0], ['2026-05-03', '2026-06-01']);
});

test('formula-injection guard and CSV/TSV quoting', () => {
  const sheet = { header: ['a', 'b'], data: [['=1+1', 'x'], ['+86 1', '@a'], ['-5x', '\tt'], [-5, 'say "hi"'], ['a,b', 'l1\nl2'], ['p\tq', null]] };
  const tsvText = E.toTSV(sheet);
  const tsv = tsvText.split('\n');
  assert.equal(tsv[0], 'a\tb');
  assert.equal(tsv[1], "'=1+1\tx");
  assert.equal(tsv[2], "'+86 1\t'@a");
  assert.equal(tsv[4], '-5\t"say ""hi"""');
  assert.ok(tsvText.includes('"p\tq"\t'));
  assert.ok(tsvText.includes('"l1\nl2"'));
  const csv = E.toCSV(sheet);
  assert.ok(csv.startsWith('﻿a,b\r\n'));
  assert.ok(csv.includes('"a,b","l1\nl2"'));
  assert.ok(csv.includes("'=1+1,x"));
  assert.ok(csv.includes('-5,"say ""hi"""'));
  assert.ok(!E.toCSV(sheet, { bom: false }).startsWith('﻿'));
});

test('row cap throws the Chinese error', () => {
  const many = Array.from({ length: E.MAX_ROWS + 1 }, (_, i) => ({ name: 'n' + i }));
  assert.equal(E.MAX_ROWS, 20000);
  assert.throws(() => E.customerRows(many, { columns: ['name'] }), /一次最多导出 20,000 行，请先筛选/);
  assert.equal(E.customerRows(many.slice(1), { columns: ['name'] }).data.length, E.MAX_ROWS);
  assert.throws(() => E.orderRows(many), /20,000/);
});

test('workbook reads back with header and row count; orders and item sheet', () => {
  const orders = [
    { id: '1', num: 'SO1', client: 'Acme', country: '法国', createdAt: '2026-05-01', stage: 'shipment', currency: 'usd', amount: 100, paidAmount: 0, productType: '盒', owner: '小王', trackingNumber: 'T1', carrier: 'DHL', note: 'n', isDraft: false,
      items: [{ code: 'P1', name: '盒', model: 'M', qty: 2, price: 50 }, { code: '', name: '纸', qty: 1, price: 0 }] },
    { id: '2', num: 'SO2', client: 'B', stage: 'quote', amount: 80, paidAmount: 10, isDraft: true },
  ];
  const o = E.orderRows(orders);
  assert.deepEqual(o.header, ['订单号', '客户', '国家', '订单日期', '阶段', '币种', '金额', '已收款', '产品', '跟进人', '物流单号', '承运商', '备注', '是否草稿']);
  assert.deepEqual(o.data[0].slice(4, 8), ['已发货', 'USD', 100, 100]);
  assert.equal(o.data[1][7], 10);
  assert.equal(o.data[1][13], '是');
  const items = E.orderItemRows(orders);
  assert.deepEqual(items.header, ['订单号', '产品编号', '名称', '型号', '数量', '单价']);
  assert.equal(items.data.length, 2);
  assert.deepEqual(items.data[0], ['SO1', 'P1', '盒', 'M', 2, 50]);
  const wb = E.toWorkbook(XLSX, [{ name: '订单', ...o }, { name: '产品明细', ...items }]);
  assert.deepEqual(wb.SheetNames, ['订单', '产品明细']);
  const back = XLSX.utils.sheet_to_json(wb.Sheets['订单'], { header: 1 });
  assert.deepEqual(back[0], o.header);
  assert.equal(back.length, 3);
  assert.equal(XLSX.utils.sheet_to_json(wb.Sheets['产品明细'], { header: 1 }).length, 3);
  assert.deepEqual(E.orderRows(orders, { gate: hide('note', 'draft') }).header.slice(-2), ['物流单号', '承运商']);
});

test('opportunities use flow and stage labels and custom fields', () => {
  const state = { laiSettings: {}, laiOpportunities: [] };
  const item = { id: 'o1', number: 'OPP1', name: '单', client: 'Acme', contact: 'Ana', amount: 5000, currency: 'EUR', exchangeRate: 108.5, endDate: '2026-07-01', owner: '小王', flow: 'default', stage: 'lost', lostReason: '价格', tags: ['a', 'b'], createdAt: '2026-05-03' };
  const out = E.opportunityRows([item], state);
  assert.deepEqual(out.header.slice(0, 17), ['编号', '名称', '客户', '联系人', '流程', '阶段', '状态', '金额', '币种', '汇率', '结束日期', '负责人', '来源', '类型', '标签', '输单原因', '创建时间']);
  assert.equal(out.data[0][6], '输单');
  assert.equal(out.data[0][15], '价格');
  assert.equal(out.data[0][7], 5000);
  assert.equal(out.data[0][14], 'a、b');
  assert.ok(!E.opportunityRows([item], state, { gate: hide('amount') }).header.includes('金额'));
});

test('leads: trash excluded unless includeTrash; labels and blanks', () => {
  const leads = [
    { id: 'a', name: 'L1', status: 'converted', convertedTo: 'Acme', createdAt: '2026-05-03', email: 'l@x.test' },
    { id: 'b', name: 'L2', status: 'invalid', invalidReason: '没有需求', trashed: true },
    { id: 'c', name: 'L3' },
  ];
  const out = E.leadRows(leads, {});
  assert.equal(out.header.length, 16);
  assert.deepEqual(out.data.map(r => r[0]), ['L1', 'L3']);
  assert.equal(out.data[0][9], '已转客户');
  assert.equal(out.data[0][15], 'Acme');
  assert.equal(out.data[1][9], '新线索');
  assert.equal(out.data[1][11], '');
  assert.equal(E.leadRows(leads, {}, { includeTrash: true }).data.length, 3);
  assert.ok(!E.leadRows(leads, {}, { gate: hide('email', 'phone') }).header.includes('邮箱'));
});
