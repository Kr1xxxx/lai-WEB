'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const B=require('../src/business-model.js');
const O=require('../src/opportunity-model.js');
const M=require('../src/model.js');
const S=require('../src/segments.js');
const NOW={now:'2026-10-07T00:00:00Z',today:'2026-10-07'};
function base(){return O.upsert({customers:{Alpha:{contact:'Ann'},Beta:{contact:'Ben'}},orders:[],trashOrders:[]},'opp',{client:'Alpha',contact:'Ann',owner:'Tester',amount:100,currency:'USD',endDate:'2026-10-31',stage:'balance'},NOW);}
function linked(){let s=base();return O.linkOrder(B.upsertOrder(s,'order',{...O.orderDraft(s.laiOpportunities[0],'2026-10-07',s),num:'SYN-1'}),'opp','order');}
const rejectsUnchanged=(state,fn,pattern=/客户.*(?:关联|核对)|关联.*客户/)=>{const before=structuredClone(state);assert.throws(fn,pattern);assert.deepEqual(state,before);};

test('conversion cannot save an order for a different customer while retaining opportunity source',()=>{
 const s=base();rejectsUnchanged(s,()=>B.upsertOrder(s,'order',{...O.orderDraft(s.laiOpportunities[0],'2026-10-07',s),num:'SYN-1',client:'Beta'}));
});
test('linking an independent order requires the same customer',()=>{
 const s=base();s.orders=[{id:'other',num:'O',client:'Beta',amount:100}];rejectsUnchanged(s,()=>O.linkOrder(s,'opp','other'));
});
test('linking a missing order fails without storing a dangling pointer',()=>{
 const s=base();rejectsUnchanged(s,()=>O.linkOrder(s,'opp','missing'),/订单.*不存在/);
});
test('editing a linked order cannot change only its customer',()=>{
 const s=linked();rejectsUnchanged(s,()=>B.upsertOrder(s,'order',{client:'Beta'}));
});
test('editing a linked opportunity cannot change only its customer',()=>{
 const s=linked();rejectsUnchanged(s,()=>O.upsert(s,'opp',{client:'Beta',contact:'Ben'},NOW));
});
test('legacy reverse-only order link still protects order customer edits',()=>{
 const s=linked();delete s.orders[0].sourceOpportunityId;rejectsUnchanged(s,()=>B.upsertOrder(s,'order',{client:'Beta'}));
});
test('source-only order link still protects opportunity customer edits',()=>{
 const s=linked();delete s.laiOpportunities[0].orderId;rejectsUnchanged(s,()=>O.upsert(s,'opp',{client:'Beta',contact:'Ben'},NOW));
});
test('historical wrong-client association is reported during unrelated edits instead of silently repaired',()=>{
 const s=linked();s.orders[0].client='Beta';rejectsUnchanged(s,()=>B.upsertOrder(s,'order',{note:'unchanged relationship'}));rejectsUnchanged(s,()=>O.upsert(s,'opp',{note:'unchanged relationship'},NOW));
});
test('an archived linked order cannot be restored under a different customer opportunity',()=>{
 let s=B.archiveOrder(linked(),'order','2026-10-07');s.laiOpportunities[0].client='Beta';rejectsUnchanged(s,()=>B.restoreOrder(s,'order'));
});
test('canonical equal customer names may link without rewriting saved spelling',()=>{
 const s=base();s.customers={'Élodie Co':{}};s.laiOpportunities[0].client='Élodie Co';s.orders=[{id:'other',num:'O',client:' Ｅｌｏｄｉｅ  co ',amount:100}];
 const next=O.linkOrder(s,'opp','other');assert.equal(next.laiOpportunities[0].orderId,'other');assert.equal(next.orders[0].client,' Ｅｌｏｄｉｅ  co ');
});
test('ambiguous canonical customer profiles cannot be guessed during linking',()=>{
 const s=base();s.customers.ALPHA={};s.orders=[{id:'other',num:'O',client:'alpha',amount:100}];rejectsUnchanged(s,()=>O.linkOrder(s,'opp','other'),/等价客户|客户.*核对/);
});
test('conflicting source and reverse opportunity links remain blocked on ordinary order edits',()=>{
 const s=linked();s.laiOpportunities.push({...s.laiOpportunities[0],id:'other'});rejectsUnchanged(s,()=>B.upsertOrder(s,'order',{note:'do not hide conflict'}),/关联.*(?:不一致|其他商机)|多个商机/);
});
test('normal unified customer rename, order edit, archive and restore preserve the relationship',()=>{
 const s=linked();s.orders[0].custom={keep:true};s.previewSegments=[{id:'g',kind:'manual',members:['Alpha']}];
 let next=S.renameMember(M.upsertCustomer(s,'Alpha',{name:'Renamed'}),'Alpha','Renamed');
 next=B.upsertOrder(next,'order',{paidAmount:25});next=O.upsert(next,'opp',{note:'updated'},NOW);
 next=B.restoreOrder(B.archiveOrder(next,'order','2026-10-07'),'order');
 assert.equal(next.orders[0].client,'Renamed');assert.equal(next.laiOpportunities[0].client,'Renamed');assert.equal(next.laiOpportunities[0].orderId,'order');assert.deepEqual(next.orders[0].custom,{keep:true});assert.deepEqual(next.previewSegments[0].members,['Renamed']);assert.equal(next.orders[0].paidAmount,25);
});
test('unlinked orders and opportunities remain free to change customer',()=>{
 const s=base();let next=B.upsertOrder(s,'plain',{num:'PLAIN',client:'Alpha',amount:10});next=B.upsertOrder(next,'plain',{client:'Beta'});next=O.upsert(next,'opp',{client:'Beta',contact:'Ben'},NOW);assert.equal(next.orders[0].client,'Beta');assert.equal(next.laiOpportunities[0].client,'Beta');
});

test('canonical same-customer link remains visible in customer opportunity details',()=>{
 const s=base();s.customers={'Élodie Co':{}};s.laiOpportunities[0].client='Élodie Co';s.orders=[{id:'other',num:'O',client:' Ｅｌｏｄｉｅ  co ',amount:100,paidAmount:25}];
 const next=O.linkOrder(s,'opp','other');const projection=O.customerStats(next,'Élodie Co','2026-10-07').allOpportunities[0];assert.equal(projection.linkedOrder?.id,'other');assert.equal(projection.linkedOrder?.dueAmount,75);
});
for(const sourceOpportunityId of ['', 'another'])test(`source-only customer guard cannot be bypassed by replacing source with ${sourceOpportunityId||'empty'}`,()=>{
 const s=linked();delete s.laiOpportunities[0].orderId;
 if(sourceOpportunityId)s.laiOpportunities.push({...s.laiOpportunities[0],id:sourceOpportunityId,client:'Beta',contact:'Ben'});
 rejectsUnchanged(s,()=>B.upsertOrder(s,'order',{client:'Beta',sourceOpportunityId}));
});
