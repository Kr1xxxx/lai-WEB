const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const importPath = path.join(__dirname, '../src/customer-import.js');
const I = fs.existsSync(importPath) ? require(importPath) : {};
const XLSX = require('../vendor/sheetjs-0.20.3/xlsx.full.min.js');

test('official customer template columns map company and contact fields separately', () => {
  const headers=['公司名称','联系人昵称','联系人邮箱','公司简称','国家地区','标签','客户阶段',
    '客户来源','公司网址','座机','详细地址','公司备注','客户编号','公海分组',
    '联系人电话','Facebook','Twitter','LinkedIn','职位','性别','联系人备注'];
  assert.deepEqual(I.suggestMapping(headers),{
    name:0,contact:1,email:2,shortName:3,country:4,tags:5,customerStage:6,
    source:7,website:8,landline:9,companyAddress:10,companyRemark:11,
    customerCode:12,poolGroup:13,phone:14,facebook:15,twitter:16,
    linkedin:17,contactTitle:18,contactGender:19,contactNote:20,
  });
});

test('multiple template rows for one company create one customer with distinct contacts', () => {
  const parsed={headers:['公司名称','联系人昵称','联系人邮箱','国家地区','标签','联系人电话','Facebook','LinkedIn','职位','性别','联系人备注'],
    rows:[
      ['Acme','Ana','ana@acme.test','法国','重点;展会','0012345678','https://facebook.test/ana','','采购','女','主联系人'],
      ['Acme','Ben','ben@acme.test','法国','重点;展会','0012345679','','https://linkedin.test/ben','经理','男','第二联系人'],
    ],lineNumbers:[2,3]};
  const mapping=I.suggestMapping(parsed.headers);
  const out=I.applyImport({orders:[],customers:{}},parsed,mapping,{destination:'active',duplicate:'skip'});
  assert.deepEqual(out.result,{created:1,updated:0,skipped:0,contactsAdded:1});
  assert.deepEqual(out.details.map(item=>[item.row,item.status]),[[2,'created'],[3,'contact-added']]);
  const c=out.state.customers.Acme;
  assert.deepEqual(c.tags,['重点','展会']);
  assert.deepEqual(c.contacts,['Ana','Ben']);
  assert.deepEqual(c.emails,['ana@acme.test','ben@acme.test']);
  assert.deepEqual(c.phones,['0012345678','0012345679']);
  assert.equal(c.contactNote,'主联系人');
  assert.equal(c.contactTitle,'采购');
  assert.equal(c.socialPlatform,'Facebook');
  assert.equal(c.socialAccount,'https://facebook.test/ana');
  assert.equal(c.extraContacts[0].contactNote,'第二联系人');
  assert.equal(c.extraContacts[0].contactGender,'男');
  assert.equal(c.extraContacts[0].socialPlatform,'LinkedIn');
  assert.equal(c.extraContacts[0].socialAccount,'https://linkedin.test/ben');
});

test('updating a known company adds a new contact without replacing its existing primary contact', () => {
  const state={orders:[],customers:{Acme:{contact:'Ana',email:'ana@acme.test',phone:'0012345678',
    contacts:['Ana'],emails:['ana@acme.test'],phones:['0012345678'],companyRemark:'keep'}}};
  const parsed={headers:['公司名称','联系人昵称','联系人邮箱','联系人电话','公司备注'],
    rows:[['Acme','Ben','ben@acme.test','0012345679','new']]};
  const out=I.applyImport(state,parsed,I.suggestMapping(parsed.headers),{duplicate:'update'});
  assert.deepEqual(out.result,{created:0,updated:1,skipped:0,contactsAdded:1});
  assert.equal(out.state.customers.Acme.email,'ana@acme.test');
  assert.equal(out.state.customers.Acme.extraContacts[0].email,'ben@acme.test');
  assert.equal(out.state.customers.Acme.companyRemark,'new');
  assert.equal(state.customers.Acme.companyRemark,'keep');
});

test('repeated company rows reject conflicting company information with original row number', () => {
  const parsed={headers:['公司名称','国家地区','联系人昵称'],rows:[['Acme','法国','Ana'],['Acme','德国','Ben']],lineNumbers:[2,5]};
  assert.throws(()=>I.mappedRecords(parsed,I.suggestMapping(parsed.headers)),/第 5 行.*国家地区/);
});

test('same contact repeated in one new-company file is skipped without overwriting the first row',()=>{
  const parsed={headers:['公司名称','联系人昵称','联系人邮箱','联系人备注'],rows:[
    ['Acme','Ana','ana@acme.test','first'],['Acme','Ana','ana@acme.test','second'],
  ],lineNumbers:[2,3]};
  const out=I.applyImport({orders:[],customers:{}},parsed,I.suggestMapping(parsed.headers),{duplicate:'skip'});
  assert.deepEqual(out.result,{created:1,updated:0,skipped:1});
  assert.equal(out.state.customers.Acme.contactNote,'first');
  assert.deepEqual(out.details[1],{row:3,name:'Acme',status:'skipped',reason:'同一客户联系人重复'});
});

test('contacts added in separate imports get stable distinct IDs',()=>{
  const parsed={headers:['公司名称','联系人昵称','联系人邮箱'],rows:[['Acme','Ben','ben@acme.test']],lineNumbers:[2]};
  const mapping=I.suggestMapping(parsed.headers);
  const first=I.applyImport({orders:[],customers:{Acme:{contact:'Ana',email:'ana@acme.test'}}},parsed,mapping,{duplicate:'update'},'2026-09-24T00:00:00Z');
  const second=I.applyImport(first.state,{...parsed,rows:[['Acme','Cal','cal@acme.test']]},mapping,{duplicate:'update'},'2026-09-24T00:00:00Z');
  assert.equal(new Set(second.state.customers.Acme.extraContacts.map(contact=>contact.id)).size,2);
});

test('XLSX and XLS customer files preserve displayed values and worksheet row numbers', () => {
  const workbook=XLSX.utils.book_new();
  const sheet=XLSX.utils.aoa_to_sheet([
    ['公司名称','邮箱','联系电话'],
    [],
    ['Excel Acme','excel@example.test','0012345'],
  ]);
  XLSX.utils.book_append_sheet(workbook,sheet,'客户');
  for(const bookType of ['xlsx','biff8']) {
    const bytes=XLSX.write(workbook,{type:'array',bookType});
    const parsed=I.parseExcel?.(bytes,XLSX);
    assert.deepEqual(parsed?.headers,['公司名称','邮箱','联系电话']);
    assert.deepEqual(parsed?.rows,[['Excel Acme','excel@example.test','0012345']]);
    assert.deepEqual(parsed?.lineNumbers,[3]);
  }
});

test('Excel import rejects oversized files and data beyond the mapped header', () => {
  assert.throws(()=>I.parseExcel(new Uint8Array(5*1024*1024+1),XLSX),/5 MB/);
  const workbook=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([
    ['公司名称','邮箱'],['Acme','a@example.test','extra'],
  ]),'客户');
  assert.throws(()=>I.parseExcel(XLSX.write(workbook,{type:'array',bookType:'xlsx'}),XLSX),/列数/);
});

test('CSV import keeps quoted commas and newlines inside their own customer fields', () => {
  const parsed = I.parseCsv?.('\uFEFF公司名称,国家地区,客户备注\r\n"Acme, Inc",美国,"第一行\n第二行"\r\nBeta,法国,普通客户\r\n');
  assert.deepEqual(parsed?.headers, ['公司名称', '国家地区', '客户备注']);
  assert.deepEqual(parsed?.rows, [
    ['Acme, Inc', '美国', '第一行\n第二行'],
    ['Beta', '法国', '普通客户'],
  ]);
  assert.deepEqual(parsed?.lineNumbers,[2,4]);
});

test('CSV import failure row numbers follow original lines after blank rows', () => {
  const parsed=I.parseCsv('公司名称,邮箱\n\nAcme,a@example.test\n\nOther,a@example.test');
  const out=I.applyImport({orders:[],customers:{}},parsed,{name:0,email:1},{destination:'active',duplicate:'skip'});
  assert.deepEqual(out.details.map(item=>item.row),[3,5]);
});

test('CSV import rejects malformed or oversized input before any customer save', () => {
  assert.throws(() => I.parseCsv('公司名称\n"broken'), /引号/);
  assert.throws(() => I.parseCsv('公司名称,邮箱\nAcme'), /列数/);
  assert.throws(() => I.parseCsv('公司名称\n' + Array(10001).fill('A').join('\n')), /10,000/);
});

test('mapped import preserves existing fields, skips duplicates by default and creates private or pool customers', () => {
  const state = {orders:[{id:'o1',client:'Acme',amount:50}],customers:{Acme:{country:'US',note:'keep',emails:['old@acme.test','extra@acme.test']}}};
  const parsed = {headers:['公司名称','国家地区','邮箱','客户标签'],rows:[
    ['Acme','法国','new@acme.test','VIP'],
    ['Beta','德国','buyer@beta.test','展会,重点'],
  ]};
  const mapping = {name:0,country:1,email:2,tags:3};
  const skipped = I.applyImport?.(state,parsed,mapping,{destination:'pool',duplicate:'skip'},'2026-09-24T00:00:00Z');
  assert.deepEqual(skipped?.result, {created:1,updated:0,skipped:1});
  assert.equal(skipped?.state.customers.Acme.email,undefined);
  assert.equal(skipped?.state.customers.Beta.laiBucket,'pool');
  assert.deepEqual(skipped?.state.customers.Beta.tags,['展会','重点']);
  assert.deepEqual(state.customers.Acme.emails,['old@acme.test','extra@acme.test']);
  const updated = I.applyImport?.(state,parsed,mapping,{destination:'active',duplicate:'update'},'2026-09-24T00:00:00Z');
  assert.deepEqual(updated?.result,{created:1,updated:1,skipped:0});
  assert.equal(updated?.state.customers.Acme.note,'keep');
  assert.equal(updated?.state.customers.Acme.email,'new@acme.test');
  assert.deepEqual(updated?.state.customers.Acme.emails,['new@acme.test','extra@acme.test']);
  assert.equal(updated?.state.customers.Acme.laiBucket,undefined);
  assert.equal(updated?.state.orders[0].client,'Acme');
});

test('import never merges a different company only because a contact email matches', () => {
  // 邮箱判重默认是“允许保存”；这里按“不允许保存”测（判重按客户设置，S1 修复 4）
  const state={orders:[],customers:{Acme:{email:'sales@acme.test'}},laiSettings:{customerSettings:{dedupe:{email:'block'}}}};
  const parsed={headers:['公司名称','邮箱'],rows:[['Other','sales@acme.test']]};
  const out=I.applyImport?.(state,parsed,{name:0,email:1},{destination:'active',duplicate:'update'});
  assert.deepEqual(out?.result,{created:0,updated:0,skipped:1});
  assert.equal(out?.state.customers.Other,undefined);
});

test('import reports skipped rows and stores a local record even when all rows are skipped', () => {
  const state={orders:[],customers:{Acme:{email:'sales@acme.test'}},laiSettings:{customerSettings:{dedupe:{email:'block'}}}};
  const parsed={headers:['公司名称','邮箱'],rows:[
    ['Acme','sales@acme.test'],
    ['Other','sales@acme.test'],
  ]};
  const out=I.applyImport(state,parsed,{name:0,email:1},
    {destination:'active',duplicate:'skip',fileName:'customers.csv'},'2026-09-24T00:00:00Z');
  assert.deepEqual(out.result,{created:0,updated:0,skipped:2});
  assert.deepEqual(out.details,[
    {row:2,name:'Acme',status:'skipped',reason:'同名客户已存在'},
    {row:3,name:'Other',status:'skipped',reason:'邮箱和已有客户「Acme」相同，不能保存'},
  ]);
  assert.equal(out.state.laiImportHistory.length,1);
  assert.deepEqual(out.state.laiImportHistory[0],{
    id:'2026-09-24T00:00:00Z-customers.csv',time:'2026-09-24T00:00:00Z',fileName:'customers.csv',
    destination:'active',expected:2,result:{created:0,updated:0,skipped:2},
  });
  assert.equal(out.record.id,out.state.laiImportHistory[0].id);
  assert.equal(state.laiImportHistory,undefined);
});

test('import history retains earlier runs and old contact values do not block later rows', () => {
  const state={orders:[],customers:{Acme:{email:'old@acme.test'}},laiImportHistory:Array.from({length:10},(_,i)=>({id:String(i)}))};
  const parsed={headers:['公司名称','邮箱'],rows:[
    ['Acme','new@acme.test'],
    ['Other','old@acme.test'],
  ]};
  const out=I.applyImport(state,parsed,{name:0,email:1},
    {destination:'active',duplicate:'update',fileName:'changed.csv'},'2026-09-24T00:00:01Z');
  assert.deepEqual(out.result,{created:1,updated:1,skipped:0});
  assert.deepEqual(out.details.map(item=>item.status),['updated','created']);
  assert.equal(out.state.laiImportHistory.length,11);
  assert.equal(out.state.laiImportHistory[0].fileName,'changed.csv');
  assert.equal(out.state.laiImportHistory.at(-1).id,'9');
});

test('failure log CSV escapes fields and neutralizes spreadsheet formulas', () => {
  const csv=I.failureLogCsv?.([{row:2,name:'=1+1',reason:'重复, "客户"'}]);
  assert.equal(csv,'\uFEFF行号,公司名称,跳过原因\r\n"2","\'=1+1","重复, ""客户"""');
});

// ---- 客户自定义字段的导入 ----
const FM = require('../src/field-model.js');
function stateWithCustom() {
  let state = { orders: [], customers: {} };
  state = FM.addField(state, 'customer', { name: '采购量', type: 'number' }, { id: 'qty' });
  state = FM.addField(state, 'customer', { name: '客户类别', type: 'select', options: ['经销商', '零售'] }, { id: 'kind' });
  state = FM.addField(state, 'customer', { name: '关注产品', type: 'multi', options: ['睫毛', '工具'] }, { id: 'like' });
  state = FM.addField(state, 'customer', { name: '首次见面', type: 'date' }, { id: 'met' });
  return state;
}

test('customFields lists the customer custom fields; suggestMapping matches them by header name only when the state is given', () => {
  const state = stateWithCustom();
  assert.deepEqual(I.customFields(state).map(f => f.key), ['custom:qty', 'custom:kind', 'custom:like', 'custom:met']);
  assert.deepEqual(I.customFields({ orders: [], customers: {} }), []);
  assert.deepEqual(I.customFields(null), []);
  const headers = ['公司名称', '采购量', ' 客户类别 ', '没有这个字段'];
  assert.deepEqual(I.suggestMapping(headers), { name: 0 }, 'without a state the custom headers are not offered');
  assert.deepEqual(I.suggestMapping(headers, state), { name: 0, 'custom:qty': 1, 'custom:kind': 2 });
});

test('custom field values are cleaned by the field type and stored in custom[字段ID]', () => {
  const state = stateWithCustom();
  const parsed = { headers: ['公司名称', '采购量', '客户类别', '关注产品', '首次见面'], rows: [['Acme', '1200', '经销商', '睫毛、工具', '2026-03-05']] };
  const mapping = I.suggestMapping(parsed.headers, state);
  assert.deepEqual(I.importWarnings(parsed, mapping, state), []);
  const out = I.applyImport(state, parsed, mapping, {}, '2026-10-17T00:00:00Z');
  assert.deepEqual(out.result, { created: 1, updated: 0, skipped: 0 });
  assert.deepEqual(out.state.customers.Acme.custom, { qty: 1200, kind: '经销商', like: ['睫毛', '工具'], met: '2026-03-05' });
  assert.deepEqual(out.warnings, []);
  assert.equal(out.details[0].warnings, undefined);
});

test('a bad custom value skips only that cell and is reported as a row warning; the row still imports', () => {
  const state = stateWithCustom();
  const parsed = { headers: ['公司名称', '联系人昵称', '采购量', '客户类别', '关注产品', '首次见面'], lineNumbers: [2, 3],
    rows: [['Acme', 'Ana', '一千', '批发商', '睫毛;假睫毛', '2026-02-31'], ['Beta', 'Bo', '5', '零售', '', '']] };
  const mapping = I.suggestMapping(parsed.headers, state);
  const warnings = I.importWarnings(parsed, mapping, state);
  assert.deepEqual(warnings.map(w => [w.row, w.field]), [[2, '采购量'], [2, '客户类别'], [2, '关注产品'], [2, '首次见面']]);
  assert.match(warnings[0].message, /第 2 行.*请填写数字.*这一格没有导入/);
  assert.match(warnings[1].message, /选项“批发商”不在选项里/);
  assert.equal(I.mappedRecords(parsed, mapping, state).length, 2, 'the preview still lists both rows');
  const out = I.applyImport(state, parsed, mapping, {}, '2026-10-17T00:00:00Z');
  assert.deepEqual(out.result, { created: 2, updated: 0, skipped: 0 });
  assert.equal(out.state.customers.Acme.contact, 'Ana', 'the rest of the bad row is imported');
  assert.equal(out.state.customers.Acme.custom, undefined, 'no bad cell was stored');
  assert.deepEqual(out.state.customers.Beta.custom, { qty: 5, kind: '零售' });
  assert.equal(out.details[0].warnings.length, 4);
  assert.equal(out.details[1].warnings, undefined);
  assert.equal(out.warnings.length, 4);
});

test('an update keeps the other custom values, an empty cell changes nothing, and a deleted custom field cannot be mapped', () => {
  const state = { ...stateWithCustom(), customers: { Acme: { client: 'Acme', custom: { qty: 7, kind: '零售' } } } };
  const parsed = { headers: ['公司名称', '采购量', '客户类别'], rows: [['Acme', '', '经销商']] };
  const mapping = I.suggestMapping(parsed.headers, state);
  const out = I.applyImport(state, parsed, mapping, { duplicate: 'update' }, '2026-10-17T00:00:00Z');
  assert.deepEqual(out.state.customers.Acme.custom, { qty: 7, kind: '经销商' });
  assert.deepEqual(state.customers.Acme.custom, { qty: 7, kind: '零售' }, 'the input state is not changed');
  assert.throws(() => I.mappedRecords(parsed, { name: 0, 'custom:gone': 1 }, state), /字段匹配无效/);
  assert.throws(() => I.mappedRecords(parsed, { name: 0, 'custom:qty': 1 }), /字段匹配无效/, 'without the state a custom key is unknown');
});

test('rows of the same company: a different custom value is skipped with a warning, the first value wins', () => {
  const state = stateWithCustom();
  const parsed = { headers: ['公司名称', '联系人昵称', '客户类别'], lineNumbers: [2, 3, 4],
    rows: [['Acme', 'Ana', '经销商'], ['Acme', 'Ben', '零售'], ['Acme', 'Cy', '经销商']] };
  const mapping = I.suggestMapping(parsed.headers, state);
  const out = I.applyImport(state, parsed, mapping, {}, '2026-10-17T00:00:00Z');
  assert.deepEqual(out.state.customers.Acme.custom, { kind: '经销商' });
  assert.deepEqual(out.warnings.map(w => w.row), [3]);
  assert.match(out.warnings[0].message, /与同公司前面的行不一致/);
  assert.equal(out.state.customers.Acme.contacts.length, 3);
});

test('without custom fields the import behaves as before (no custom key, no warnings)', () => {
  const parsed = { headers: ['公司名称', '采购量'], rows: [['Acme', '5']] };
  const state = { orders: [], customers: {} };
  assert.deepEqual(I.suggestMapping(parsed.headers, state), { name: 0 });
  const out = I.applyImport(state, parsed, { name: 0 }, {}, '2026-10-17T00:00:00Z');
  assert.equal(out.state.customers.Acme.custom, undefined);
  assert.deepEqual(out.warnings, []);
});
