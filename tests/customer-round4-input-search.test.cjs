'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/model.js');
const B = require('../src/business-model.js');
const I = require('../src/customer-import.js');
const L = require('../src/modules.js');
const F = require('../src/customer-fields.js');
const importRows = (state, headers, rows, duplicate='skip') => {
  const parsed={headers,rows};
  return I.applyImport(state,parsed,I.suggestMapping(headers),{duplicate},'2026-10-07T00:00:00Z');
};
const order = client => ({num:'SYN-ROUND4',client,amount:10,paidAmount:null,createdAt:'2026-10-07'});

for (const incoming of ['Synthetic  Brown','Ｓｙｎｔｈｅｔｉｃ Brown',' synthetic brown ','Synthétic Brown']) {
  test(`equivalent imported company is skipped instead of creating an ambiguous order customer: ${incoming}`,()=>{
    const state={customers:{'Synthetic Brown':{contact:'Original',email:'original@example.test',unrelated:{keep:true}}},orders:[]};
    const before=structuredClone(state);
    const out=importRows(state,['公司名称','联系人邮箱'],[[incoming,'new@example.test']]);
    assert.deepEqual(out.result,{created:0,updated:0,skipped:1});
    assert.deepEqual(out.state.customers,state.customers);
    assert.equal(B.upsertOrder(out.state,'new',order(incoming)).orders[0].client,'Synthetic Brown');
    assert.deepEqual(state,before);
  });
}

test('equivalent rows within one file stay in one company with distinct contacts',()=>{
  const out=importRows({customers:{},orders:[]},['公司名称','联系人昵称','联系人邮箱'],[
    ['Synthetic Brown','First','first@example.test'],['Synthetic  Brown','Second','second@example.test'],
  ]);
  assert.deepEqual(Object.keys(out.state.customers),['Synthetic Brown']);
  assert.deepEqual(out.state.customers['Synthetic Brown'].emails,['first@example.test','second@example.test']);
});

test('an existing ambiguous company identity is skipped rather than updating either customer',()=>{
  const state={customers:{'Synthetic Brown':{companyRemark:'first'},'Synthetic  Brown':{companyRemark:'second'}},orders:[]};
  const before=structuredClone(state);
  const out=importRows(state,['公司名称','公司备注'],[['Synthetic Brown','wrong replacement']],'update');
  assert.deepEqual(out.result,{created:0,updated:0,skipped:1});
  assert.match(out.details[0].reason,/多个等价/);
  assert.deepEqual(out.state.customers,before.customers);
  assert.deepEqual(state,before);
});

test('company identity never matches another company address substring',()=>{
  const state={customers:{Outlet:{address:'7 browncroft Lane'}},orders:[]};
  const out=importRows(state,['公司名称','联系人邮箱'],[['Brown','brown@example.test']]);
  assert.deepEqual(Object.keys(out.state.customers),['Outlet','Brown']);
  assert.equal(B.upsertOrder(out.state,'new',order('brown')).orders[0].client,'Brown');
});

for (const [label,profile,field,value] of [
  ['primary alternate email',{alternateEmail:'backup@example.test'},'联系人邮箱','backup@example.test'],
  ['legacy alternate alias',{alternativeEmail:'backup@example.test'},'联系人邮箱','backup@example.test'],
  ['legacy backup alias',{backupEmail:'backup@example.test'},'联系人邮箱','backup@example.test'],
  ['extra-contact alternate email',{extraContacts:[{alternateEmail:'backup@example.test'}]},'联系人邮箱','backup@example.test'],
  ['legacy contact object email',{contacts:[{email:'backup@example.test'}]},'联系人邮箱','backup@example.test'],
  ['primary additional phone',{additionalPhones:[{phone:'+1 555 010 2000'}]},'联系人电话','15550102000'],
  ['additional phone with separate prefix',{additionalPhones:[{phoneCountryCode:'+1',phone:'5550102000'}]},'联系人电话','+1 555 010 2000'],
  ['extra-contact additional phone',{extraContacts:[{additionalPhones:[{phoneCountryCode:'+1',phone:'5550102000'}]}]},'联系人电话','15550102000'],
]) test(`import skips another company matching ${label}`,()=>{
  const state={customers:{Existing:{...profile,unrelated:{keep:true}}},orders:[]};
  const before=structuredClone(state);
  const out=importRows(state,['公司名称',field],[['Other',value]]);
  assert.deepEqual(out.result,{created:0,updated:0,skipped:1});
  assert.match(out.details[0].reason,/与其他客户重复/);
  assert.deepEqual(out.state.customers,before.customers);
  assert.deepEqual(state,before);
});

test('duplicate report includes primary and extra-contact backup email aliases without mutating profiles',()=>{
  const state={customers:{A:{alternateEmail:'Backup@example.test'},B:{extraContacts:[{backupEmail:'backup@example.test'}]}},orders:[]};
  const before=structuredClone(state);
  assert.deepEqual(L.findDuplicates(state),[{type:'邮箱',value:'backup@example.test',names:['A','B']}]);
  assert.deepEqual(state,before);
});

test('cleared canonical contact values never resurrect stale primary or backup aliases',()=>{
  const state={customers:{A:{email:'stale@example.test',emails:[''],alternateEmail:'',alternativeEmail:'stale@example.test',backupEmail:'stale@example.test'}},orders:[]};
  const out=importRows(state,['公司名称','联系人邮箱'],[['B','stale@example.test']]);
  assert.equal(out.result.created,1);
  assert.deepEqual(L.findDuplicates(out.state),[]);
});

test('phone duplicate detection requires a complete normalized number rather than suffix matches',()=>{
  const state={customers:{A:{additionalPhones:[{phone:'+1 555 010 2000'}]}},orders:[]};
  const out=importRows(state,['公司名称','联系人电话'],[['B','+44 555 010 2000']]);
  assert.equal(out.result.created,1);
  assert.deepEqual(L.findDuplicates(out.state),[]);
});

for (const [input,want] of [
  [' mailto:Hello@example.test ','Hello@example.test'],
  ['MAILTO:hello@example.test?subject=Quotation&cc=ignored@example.test','hello@example.test'],
  ['mailto:hello%2Bsales@example.test?body=Test','hello+sales@example.test'],
]) test(`import saves the single mailbox from a mailto link: ${input}`,()=>{
  const out=importRows({customers:{},orders:[]},['公司名称','联系人邮箱'],[['Mail Test',input]]);
  assert.equal(out.state.customers['Mail Test'].email,want);
  assert.deepEqual(out.state.customers['Mail Test'].emails,[want]);
});

test('mailto normalization happens before cross-company duplicate checks',()=>{
  const state={customers:{Existing:{alternateEmail:'hello@example.test'}},orders:[]};
  const out=importRows(state,['公司名称','联系人邮箱'],[['Other','mailto:hello@example.test?subject=Test']]);
  assert.deepEqual(out.result,{created:0,updated:0,skipped:1});
  assert.deepEqual(out.state.customers,state.customers);
});

for (const input of ['mailto:','mailto:a@example.test,b@example.test','mailto:bad%ZZ@example.test','mailto:a%0Ab@example.test','https://a@example.test']) {
  test(`invalid mailbox input cannot enter imported customer data: ${input}`,()=>{
    const state={customers:{},orders:[]};
    assert.throws(()=>importRows(state,['公司名称','联系人邮箱'],[['Mail Test',input]]),/第 2 行.*邮箱/);
    assert.deepEqual(state,{customers:{},orders:[]});
  });
}

test('customer edits normalize supplied main, backup and extra-contact emails while preserving omitted legacy data',()=>{
  const state={customers:{Existing:{email:'legacy-incomplete',paymentEmail:'historical-value',unrelated:{keep:true}}},orders:[]};
  const untouched=M.upsertCustomer(state,'Existing',{name:'Existing',owner:'Review'});
  assert.equal(untouched.customers.Existing.email,'legacy-incomplete');
  const out=M.upsertCustomer(state,'Existing',{name:'Existing',email:'mailto:main@example.test',alternateEmail:'mailto:backup@example.test?subject=x',extraContacts:[{id:'second',contact:'Other',email:'mailto:other@example.test',alternateEmail:'mailto:other-backup@example.test'}]});
  const c=out.customers.Existing;
  assert.deepEqual(c.emails,['main@example.test','other@example.test']);
  assert.equal(c.alternateEmail,'backup@example.test');
  assert.equal(c.extraContacts[0].alternateEmail,'other-backup@example.test');
  assert.equal(c.paymentEmail,'historical-value');
  assert.deepEqual(c.unrelated,{keep:true});
  assert.equal(state.customers.Existing.email,'legacy-incomplete');
});

for(const [label,profile,email] of [
  ['primary backup',{alternateEmail:'backup@example.test'},'backup@example.test'],
  ['legacy alias',{alternativeEmail:'alias@example.test'},'alias@example.test'],
  ['older alias',{backupEmail:'older@example.test'},'older@example.test'],
  ['extra contact',{extraContacts:[{alternateEmail:'extra@example.test'}]},'extra@example.test'],
  ['extra legacy alias',{extraContacts:[{alternativeEmail:'extra-alias@example.test'}]},'extra-alias@example.test'],
  ['legacy contact object',{contacts:[{backupEmail:'object@example.test'}]},'object@example.test'],
]) test(`email searches include ${label} without broadening other field scopes`,()=>{
  const rows=M.buildCustomers({customers:{Found:profile,Other:{email:'different@example.test'}},orders:[]});
  const before=structuredClone(rows);
  for(const field of ['all','email'])assert.deepEqual(F.globalCustomerSearch(rows,{field,query:email}).map(row=>row.name),['Found']);
  assert.deepEqual(F.filter(rows,{field:'email',query:email}).map(row=>row.name),['Found']);
  assert.deepEqual(F.globalCustomerSearch(rows,{field:'contact',query:email}),[]);
  assert.deepEqual(rows,before);
});

test('email search never revives a cleared backup alias on any contact',()=>{
  const rows=M.buildCustomers({customers:{Cleared:{alternateEmail:'',alternativeEmail:'stale@example.test',extraContacts:[{alternateEmail:'',backupEmail:'stale@example.test'}]}},orders:[]});
  assert.deepEqual(F.globalCustomerSearch(rows,{field:'all',query:'stale@example.test'}),[]);
  assert.deepEqual(F.filter(rows,{field:'email',query:'stale@example.test'}),[]);
});

test('valid local-part punctuation remains intact in plain email and percent-encoded mailto links',()=>{
  for(const input of ['sales#tag?ref@example.test','mailto:sales%23tag%3Fref@example.test?subject=Quote']){
    const out=importRows({customers:{},orders:[]},['公司名称','联系人邮箱'],[['Punctuation',input]]);
    assert.equal(out.state.customers.Punctuation.email,'sales#tag?ref@example.test');
  }
});

test('backup email search tolerates empty legacy contact slots without mutating them',()=>{
  const state={customers:{Existing:{extraContacts:[null,{alternateEmail:'match@example.test'}],contacts:[null],emails:null,phones:null,additionalPhones:[null]}},orders:[]};
  const before=structuredClone(state),rows=M.buildCustomers(state);
  for(const field of ['email','all'])assert.deepEqual(F.globalCustomerSearch(rows,{field,query:'match@example.test'}).map(row=>row.name),['Existing']);
  assert.deepEqual(state,before);
});
