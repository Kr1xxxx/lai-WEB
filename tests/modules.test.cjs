const test=require('node:test'),assert=require('node:assert/strict');
const L=require('../src/modules.js');
const fixture=()=>({customers:{A:{owner:'Kris',email:'SAME@example.com',x:9},B:{email:'same@example.com'},C:{phone:'+1 (901) 111-2222'},D:{phone:'19011112222'}},orders:[{id:'1',client:'A',amount:20},{id:'2',client:'Order only',amount:15}],previewSegments:[{id:'s',members:['A']}],extra:17});
test('pool and reclaim preserve owner, orders, group membership and input',()=>{const original=fixture(),before=structuredClone(original);let s=L.moveCustomers(original,['A','Order only'],'pool');assert.equal(L.bucket(s.customers.A),'pool');assert.equal(s.customers.A.owner,'');assert.equal(s.customers.A.laiPreviousOwner,'Kris');assert.equal(L.bucket(s.customers['Order only']),'pool');s=L.moveCustomers(s,['A'],'active');assert.equal(s.customers.A.owner,'Kris');assert.deepEqual(s.orders,original.orders);assert.deepEqual(s.previewSegments,original.previewSegments);assert.deepEqual(original,before);assert.equal(s.extra,17);});
test('recycle and restore preserve previous bucket and never delete orders',()=>{let s=L.moveCustomers(fixture(),['A'],'pool');s=L.moveCustomers(s,['A'],'trash');assert.equal(L.bucket(s.customers.A),'trash');s=L.moveCustomers(s,['A'],'restore');assert.equal(L.bucket(s.customers.A),'pool');assert.equal(s.orders.length,2);assert.equal(s.customers.A.x,9);assert.throws(()=>L.moveCustomers(s,['missing'],'pool'));assert.throws(()=>L.moveCustomers(s,['A'],'delete'));});
test('duplicate candidates normalize exact emails and phone punctuation but exclude trash',()=>{const s=fixture();let groups=L.findDuplicates(s);assert.equal(groups.length,2);assert.deepEqual(groups[0].names.sort(),['A','B']);s.customers.B.laiBucket='trash';groups=L.findDuplicates(s);assert.equal(groups.length,1);assert.deepEqual(groups[0].names.sort(),['C','D']);});
test('duplicate field matching ignores empty fields and does not merge records',()=>{const s={customers:{A:{email:''},B:{email:''},C:{emails:['x@EXAMPLE.com']},D:{email:'x@example.com'}},orders:[]};const before=structuredClone(s);assert.deepEqual(L.findDuplicates(s)[0].names,['C','D']);assert.deepEqual(s,before);});
test('explicitly cleared primary array slots do not raise duplicate hints from stale single values',()=>{
 const state={customers:{
  Cleared:{email:'stale@example.test',emails:[''],phone:'5550122',phones:[''],phoneCountryCode:'+1',extraContacts:[{email:'extra@example.test'}]},
  StaleMatch:{email:'stale@example.test',phone:'5550122',phoneCountryCode:'+1'},
  ExtraMatch:{email:'extra@example.test'},
 },orders:[]};
 const before=structuredClone(state);
 const groups=L.findDuplicates(state);
 assert.deepEqual(groups,[{type:'邮箱',value:'extra@example.test',names:['Cleared','ExtraMatch']}]);
 assert.deepEqual(state,before);
});
test('the aligned primary phone array slot keeps its selected dial code in duplicate matching',()=>{
 const state={customers:{
  US:{phone:'5550122',phones:['5550122'],phoneCountryCode:'+1'},
  GB:{phone:'5550122',phones:['5550122'],phoneCountryCode:'+44'},
 },orders:[]};
 assert.deepEqual(L.findDuplicates(state),[]);
});
test('duplicate search covers additional methods and each extra contact without changing profiles',()=>{
 const state={customers:{
  Main:{phone:'+44 555 0122',email:'team@example.test'},
  ExtraPhone:{additionalPhones:[{id:'p1',phoneCountryCode:'+44',phone:'555 0122'}]},
  ExtraContact:{extraContacts:[{id:'c2',email:' TEAM@example.test ',phone:'+49 333 444',additionalPhones:[{id:'p2',phoneCountryCode:'+1',phone:'555 0199'}]}]},
  Other:{phone:'+1 555 0199',email:'other@example.test'},
  Trashed:{email:'team@example.test',laiBucket:'trash'},
 },orders:[]};
 const before=structuredClone(state);
 const groups=L.findDuplicates(state);
 assert.deepEqual(groups.find(group=>group.type==='电话'&&group.value==='445550122')?.names,['Main','ExtraPhone']);
 assert.deepEqual(groups.find(group=>group.type==='电话'&&group.value==='15550199')?.names,['ExtraContact','Other']);
 assert.deepEqual(groups.find(group=>group.type==='邮箱'&&group.value==='team@example.test')?.names,['Main','ExtraContact']);
 assert.ok(groups.every(group=>!group.names.includes('Trashed')));
 assert.deepEqual(state,before);
});
test('order-only customer keeps the effective most recent order owner after pool and reclaim',()=>{const M=require('../src/model.js');let state={customers:{},orders:[{client:'Only',amount:4,createdAt:'2026-08-01',owner:'Old'},{client:'Only',amount:8,createdAt:'2026-09-01',owner:'Kris'}]};const owner=M.buildCustomers(state)[0].owner;state=L.moveCustomers(state,['Only'],'pool');state=L.moveCustomers(state,['Only'],'active');assert.equal(M.buildCustomers(state)[0].owner,owner);});
test('pool and private entry fields follow real transitions without double counting restores',()=>{
 let state={customers:{A:{owner:'Kris',poolEntryCount:0}},orders:[]};
 state=L.moveCustomers(state,['A'],'pool','2026-09-23T10:00:00Z');
 assert.equal(state.customers.A.lastPoolEntry,'2026-09-23T10:00:00Z');
 assert.equal(state.customers.A.poolEntryCount,1);
 state=L.moveCustomers(state,['A'],'pool','2026-09-23T11:00:00Z');
 assert.equal(state.customers.A.poolEntryCount,1);
 assert.equal(state.customers.A.lastPoolEntry,'2026-09-23T10:00:00Z');
 state=L.moveCustomers(state,['A'],'trash','2026-09-23T12:00:00Z');
 state=L.moveCustomers(state,['A'],'restore','2026-09-23T13:00:00Z');
 assert.equal(state.customers.A.poolEntryCount,1);
 assert.equal(state.customers.A.lastPoolEntry,'2026-09-23T10:00:00Z');
 state=L.moveCustomers(state,['A'],'active','2026-09-23T14:00:00Z');
 assert.equal(state.customers.A.lastPrivatePoolEntry,'2026-09-23T14:00:00Z');
 assert.equal(state.customers.A.owner,'Kris');
});
