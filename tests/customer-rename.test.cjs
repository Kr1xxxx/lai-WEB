const test=require('node:test');
const assert=require('node:assert/strict');
const M=require('../src/model.js');
const S=require('../src/segments.js');
const B=require('../src/business-model.js');

function fixture(){
 const order=(id,client,amount)=>({id,num:id.toUpperCase(),client,amount,paidAmount:amount,currency:'USD',stage:'done',createdAt:'2026-09-01',orderMonth:'2026-09',note:'Original Old Company note',attachments:[{id:'doc-'+id}],logs:[{text:'Old Company history'}],unknown:{keep:true}});
 return {customers:{'Old Company':{country:'US',source:'Referral',contact:'Alex',nextFollow:'2026-09-20',unknown:{keep:true}},'Other Company':{country:'DE'}},orders:[order('active','Old Company',100)],trashOrders:[{...order('archived','Old Company',200),trashedAt:'2026-09-02'},order('other','Other Company',50)],deletedOrders:[{...order('deleted','Old Company',300),deletedAt:'2026-09-03'}],previewSegments:[{id:'manual',kind:'manual',members:['Old Company','Other Company']},{id:'archived-group',kind:'manual',archived:true,members:['Old Company']}]};
}

test('customer rename relinks archived and deleted orders without changing their retained metadata',()=>{
 const state=fixture(),before=structuredClone(state);
 const next=M.upsertCustomer(state,'Old Company',{name:'  New Company  '},'2026-09-21T00:00:00Z');
 assert.equal(next.trashOrders[0].client,'New Company');
 assert.equal(next.deletedOrders[0].client,'New Company');
 assert.equal(next.orders[0].client,'New Company');
 for(const bucket of ['orders','trashOrders','deletedOrders']){
  assert.equal(next[bucket].length,before[bucket].length);
  next[bucket].forEach((order,i)=>{const expected=structuredClone(before[bucket][i]);if(expected.client==='Old Company')expected.client='New Company';assert.deepEqual(order,expected);});
 }
 assert.deepEqual(state,before);
 assert.equal(next.customers['Old Company'],undefined);
 assert.deepEqual(next.customers['New Company'].unknown,{keep:true});
});

test('new or renamed company cannot claim a name held by a restorable archived order',()=>{
 const state={customers:{Current:{country:'US'}},orders:[],trashOrders:[{id:'archived',num:'SO-1',client:'Archived',amount:100,currency:'USD',stage:'done',createdAt:'2026-09-01'}]};
 const before=structuredClone(state);
 assert.throws(()=>M.upsertCustomer(state,'Current',{name:'Archived'}),/客户名称已存在/);
 assert.throws(()=>M.upsertCustomer(state,'',{name:'Archived'}),/客户名称已存在/);
 assert.deepEqual(state,before);
});

test('editing an unchanged company name tolerates its case-variant archived order alias',()=>{
 const state={customers:{Acme:{country:'US',note:'Old note'}},orders:[],trashOrders:[{id:'older',num:'SO-OLD',client:'ACME',amount:20,currency:'USD',stage:'done',createdAt:'2026-01-01'}]};
 const before=structuredClone(state);
 const next=M.upsertCustomer(state,'Acme',{name:'Acme',note:'Updated note'},'2026-09-29T00:00:00Z');
 assert.equal(next.customers.Acme.note,'Updated note');
 assert.strictEqual(next.trashOrders,state.trashOrders);
 assert.deepEqual(state,before);
});

test('editing an unchanged company name tolerates its case-variant active order alias without claiming other names',()=>{
 const state={customers:{Acme:{country:'US',note:'Old note'},Other:{country:'DE'}},orders:[{id:'active',num:'SO-ACTIVE',client:'ACME',amount:20,currency:'USD',stage:'done',createdAt:'2026-01-01'}]};
 const before=structuredClone(state);
 const next=M.upsertCustomer(state,'Acme',{name:'Acme',note:'Updated note'},'2026-09-29T00:00:00Z');
 assert.equal(next.customers.Acme.note,'Updated note');
 assert.deepEqual(next.orders,state.orders);
 assert.throws(()=>M.upsertCustomer(state,'Other',{name:'ACME'}),/客户名称已存在/);
 assert.throws(()=>M.upsertCustomer(state,'',{name:'ACME'}),/客户名称已存在/);
 assert.deepEqual(state,before);
});

test('restoring a renamed customer order keeps one customer and the original group, order and follow-up links',()=>{
 const state=fixture();
 const renamed=S.renameMember(M.upsertCustomer(state,'Old Company',{name:'New Company'}),'Old Company','New Company');
 const restored=B.restoreOrder(renamed,'archived');
 const rows=M.buildCustomers(restored);
 assert.deepEqual(rows.map(row=>row.name).sort(),['New Company','Other Company']);
 const customer=rows.find(row=>row.name==='New Company');
 assert.equal(customer.orderCount,2);
 assert.equal(customer.total,300);
 assert.deepEqual(restored.previewSegments.map(item=>item.members),[['New Company','Other Company'],['New Company']]);
 assert.deepEqual(restored.orders.map(order=>[order.id,order.client]).sort(),[['active','New Company'],['archived','New Company']]);
 assert.equal(restored.customers['New Company'].nextFollow,'2026-09-20');
 assert.equal(restored.customers['Old Company'],undefined);
 const W=require('../src/workbench.js');
 assert.deepEqual(W.queue({today:'2026-09-21',follow:Object.entries(restored.customers).filter(([,c])=>c.nextFollow)}).rows.map(row=>row.title),['跟进 New Company'],'the follow-up date follows the new name');
 assert.equal(restored.orders.find(order=>order.id==='archived').trashedAt,undefined);
 assert.equal(restored.deletedOrders.length,1);
});

test('non-rename edits leave archived orders intact and do not invent archival buckets',()=>{
 const state=fixture();
 const next=M.upsertCustomer(state,'Old Company',{name:'Old Company',note:'Updated'});
 assert.strictEqual(next.trashOrders,state.trashOrders);
 assert.strictEqual(next.deletedOrders,state.deletedOrders);
 const minimal=M.upsertCustomer({customers:{},orders:[]},'',{name:'New Company',country:'US',source:'Referral'});
 assert.equal(Object.hasOwn(minimal,'trashOrders'),false);
 assert.equal(Object.hasOwn(minimal,'deletedOrders'),false);
});
