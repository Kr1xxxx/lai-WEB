const test=require('node:test');
const assert=require('node:assert/strict');
const O=require('../src/opportunity-model.js');
const DAY='2026-10-07';
const opp=(id,extra={})=>({id,name:`Opportunity ${id}`,client:'Synthetic',owner:'Amy',flow:'default',stage:'open',amount:100,currency:'USD',createdAt:'2026-09-01',endDate:'2026-11-01',...extra});
const base=()=>({customers:{Synthetic:{country:'GB',source:'Trade show'}},orders:[],laiOpportunities:[]});
test('round3 transfer retains structured products, contact, source, country and note without guessing payments',()=>{
 const item=opp('a',{stage:'balance',contact:'Ann',amount:500,note:'Invoice reference only: deposit $400 mentioned, receipt unverified',products:[{name:'Lashes',quantity:10,unitPrice:50,sku:'L1'}]});
 const before=JSON.stringify(item);const result=O.orderDraft(item,DAY,base());
 assert.deepEqual(result.products,item.products);
 assert.notEqual(result.products,item.products);assert.notEqual(result.products[0],item.products[0]);
 assert.equal(result.contact,'Ann');assert.equal(result.country,'GB');assert.equal(result.source,'Trade show');assert.equal(result.sourceOpportunityId,'a');
 assert.equal(result.stage,'balance');assert.equal(result.paidAmount,null);
 assert.equal(result.note,`${item.note}\n\n由商机「Opportunity a」生成`);
 assert.equal(result.productType,'Lashes');assert.equal(result.amount,500);
 assert.equal(JSON.stringify(item),before);
});
test('round3 direct transfer supports old signature and keeps receipt separate from fulfillment confirmation',()=>{
 assert.equal(O.orderDraft(opp('d',{stage:'done'}),DAY).stage,'quote');
 assert.equal(O.orderDraft(opp('d',{stage:'done'}),DAY).orderStageNeedsConfirmation,true);
 assert.equal(O.orderDraft(opp('d',{stage:'done'}),DAY).paidAmount,null);
 assert.equal(O.orderDraft(opp('d',{stage:'balance',paidAmount:40}),DAY).paidAmount,40);
 assert.equal(O.orderDraft(opp('d',{paidAmount:500}),DAY).paidAmount,500);
 assert.equal(O.orderDraft(opp('d',{paidAmount:'unknown'}),DAY).paidAmount,null);
 const draft=O.orderDraft(opp('d',{flow:'custom',stage:'signed',source:'Referral',country:'FR',products:[null,{name:'A',quantity:2,unitPrice:5}]}),DAY,base());
 assert.equal(draft.stage,'quote');assert.equal(draft.source,'Referral');assert.equal(draft.country,'FR');assert.equal(draft.products.length,1);
});
test('round3 customer projection gives all deals, actual win dates, separate currencies and associated products',()=>{
 const s={...base(),laiOpportunities:[
 opp('open',{createdAt:'2026-10-01',products:[{name:'Lashes',quantity:2,unitPrice:50}]}),
 opp('usd',{stage:'balance',amount:100,closedAt:'2026-09-05',products:[{name:'Lashes',quantity:2,unitPrice:50}]}),
 opp('eur',{stage:'done',amount:70,currency:'EUR',closedAt:'2026-09-10',products:[{name:'Glue',quantity:7,unitPrice:10}],archived:true}),
 opp('lost',{stage:'lost',closedAt:'2026-10-02'}),
 opp('unknown-date',{stage:'done',amount:300,closedAt:'not-a-date'}),
 opp('other',{client:'Other',stage:'done',amount:999,closedAt:'2026-12-12'})]};
 const before=JSON.stringify(s),r=O.customerStats(s,'Synthetic',DAY);
 assert.equal(r.allOpportunities.length,5);assert.equal(r.allOpportunities[0].id,'open');
 assert.equal(r.activeOpportunityCount,1);assert.equal(r.opportunityCount,3);
 assert.equal(r.opportunityTotal,400);assert.equal(r.opportunityAverage,200);
 assert.equal(r.firstWonDate,'2026-09-05');assert.equal(r.lastWonDate,'2026-09-10');
 assert.deepEqual(r.opportunityAmounts,[{currency:'EUR',total:70,count:1,average:70},{currency:'USD',total:400,count:2,average:200}]);
 const product=r.opportunityProducts.find(p=>p.name==='Lashes');
 assert.deepEqual(product.opportunityIds,['open','usd']);assert.deepEqual(product.orderIds,[]);
 assert.equal(r.allOpportunities.find(p=>p.id==='eur').archived,true);
 assert.equal(JSON.stringify(s),before);
});
test('round3 linked order projects actual receipts while keeping won amount and sales stage independent',()=>{
 const s={...base(),laiOpportunities:[opp('a',{stage:'balance',amount:3000,orderId:'o',closedAt:'2026-10-01',products:[{name:'Lashes',quantity:10,unitPrice:300}]})],orders:[{id:'o',num:'O-1',client:'Synthetic',stage:'done',amount:3000,currency:'USD',paidAmount:2500,sourceOpportunityId:'a'}]};
 const r=O.customerStats(s,'Synthetic',DAY),row=r.allOpportunities[0];
 assert.equal(row.stage,'balance');assert.equal(row.kind,'won');
 assert.deepEqual(row.linkedOrder,{id:'o',num:'O-1',stage:'done',stageLabel:'已完成',currency:'USD',amount:3000,paidAmount:2500,dueAmount:500,isDraft:false});
 assert.equal(r.opportunityTotal,3000);assert.deepEqual(r.opportunityProducts[0].orderIds,['o']);
 assert.equal(s.laiOpportunities[0].stage,'balance');
});
test('round3 absent payments remain unknown; source conflicts and archived orders are not attached',()=>{
 const s={...base(),laiOpportunities:[opp('a',{stage:'done',orderId:'o'})],orders:[{id:'o',client:'Synthetic',stage:'done',amount:100,currency:'EUR'}]};
 let row=O.customerStats(s,'Synthetic',DAY).allOpportunities[0];
 assert.equal(row.linkedOrder.paidAmount,null);assert.equal(row.linkedOrder.dueAmount,null);
 row=O.customerStats({...s,orders:[{...s.orders[0],sourceOpportunityId:'other'}]},'Synthetic',DAY).allOpportunities[0];assert.equal(row.linkedOrder,null);
 row=O.customerStats({...s,orders:[],trashOrders:s.orders},'Synthetic',DAY).allOpportunities[0];assert.equal(row.linkedOrder,null);
 row=O.customerStats({...s,laiOpportunities:[opp('a')],orders:[{...s.orders[0],sourceOpportunityId:'a'}]},'Synthetic',DAY).allOpportunities[0];assert.equal(row.linkedOrder.id,'o');
});
test('round3 empty customer projection has explicit empty lists and no fabricated winning date',()=>{
 const r=O.customerStats(base(),'Synthetic',DAY);
 assert.deepEqual(r.allOpportunities,[]);assert.deepEqual(r.opportunityProducts,[]);assert.deepEqual(r.opportunityAmounts,[]);
 assert.equal(r.firstWonDate,'');assert.equal(r.lastWonDate,'');assert.equal(r.opportunityTotal,null);
});
test('round3 customer CNY fields derive only CNY wins and do not borrow USD EUR or order money',()=>{
 const s={...base(),customers:{Synthetic:{opportunityTotalCny:99999,opportunityAverageCny:99999}},orders:[{id:'order',client:'Synthetic',amount:88888,currency:'CNY'}],laiOpportunities:[opp('usd',{stage:'done',amount:100,closedAt:'2026-10-01'}),opp('cny1',{stage:'balance',currency:'CNY',amount:200,closedAt:'2026-10-02'}),opp('cny2',{stage:'done',currency:'CNY',amount:400,closedAt:'2026-10-03'}),opp('eur',{stage:'done',currency:'EUR',amount:70,closedAt:'2026-10-04'})]};
 const r=O.customerStats(s,'Synthetic',DAY);
 assert.equal(r.opportunityTotal,100);assert.equal(r.opportunityAverage,100);
 assert.equal(r.opportunityTotalCny,600);assert.equal(r.opportunityAverageCny,300);
 assert.deepEqual(r.opportunityAmounts.map(x=>[x.currency,x.total]),[['CNY',600],['EUR',70],['USD',100]]);
 assert.equal(O.customerStats(base(),'Synthetic',DAY).opportunityTotalCny,null);
});
test('round3 projection review rounds monetary summaries and pending receipt to two decimals',()=>{
 const s={...base(),laiOpportunities:[opp('a',{stage:'done',amount:.1}),opp('b',{stage:'done',amount:.2}),opp('c',{stage:'done',currency:'CNY',amount:.1}),opp('d',{stage:'done',currency:'CNY',amount:.2})],orders:[{id:'o',client:'Synthetic',sourceOpportunityId:'a',currency:'USD',amount:.3,paidAmount:.1}]};
 const r=O.customerStats(s,'Synthetic',DAY);
 assert.equal(r.opportunityTotal,.3);assert.equal(r.opportunityAverage,.15);
 assert.equal(r.opportunityTotalCny,.3);assert.equal(r.opportunityAverageCny,.15);
 assert.deepEqual(r.opportunityAmounts.map(x=>[x.total,x.average]),[[.3,.15],[.3,.15]]);
 assert.equal(r.allOpportunities.find(x=>x.id==='a').linkedOrder.dueAmount,.2);
});
test('round3 projection review requires same customer for both forward and reverse order references',()=>{
 for(const orderId of ['', 'o']){
  const s={...base(),laiOpportunities:[opp('a',{orderId})],orders:[{id:'o',client:'Other',sourceOpportunityId:'a',currency:'USD',amount:100,paidAmount:50}]};
  assert.equal(O.customerStats(s,'Synthetic',DAY).allOpportunities[0].linkedOrder,null);
 }
});
test('round3 projection review drafts retain identifiable order link but expose no effective receipt or due',()=>{
 const s={...base(),laiOpportunities:[opp('a',{orderId:'o'})],orders:[{id:'o',client:'Synthetic',sourceOpportunityId:'a',currency:'USD',amount:100,paidAmount:50,isDraft:true}]};
 const r=O.customerStats(s,'Synthetic',DAY).allOpportunities[0].linkedOrder;
 assert.equal(r.id,'o');assert.equal(r.isDraft,true);assert.equal(r.paidAmount,null);assert.equal(r.dueAmount,null);
});
test('round3 projection review rejects malformed receipt values and preserves genuine zero',()=>{
 for(const paidAmount of [true,false,'',' ',null,undefined,NaN,Infinity,-1,[20],{valueOf:()=>20}]){
  const s={...base(),laiOpportunities:[opp('a')],orders:[{id:'o',client:'Synthetic',sourceOpportunityId:'a',currency:'USD',amount:100,paidAmount}]};
  const r=O.customerStats(s,'Synthetic',DAY).allOpportunities[0].linkedOrder;
  assert.equal(r.paidAmount,null,`invalid ${String(paidAmount)}`);assert.equal(r.dueAmount,null);
 }
 const s={...base(),laiOpportunities:[opp('a')],orders:[{id:'o',client:'Synthetic',sourceOpportunityId:'a',currency:'USD',amount:100,paidAmount:0}]};
 const r=O.customerStats(s,'Synthetic',DAY).allOpportunities[0].linkedOrder;
 assert.equal(r.paidAmount,0);assert.equal(r.dueAmount,100);
});
test('round3 shared ledger projection preserves known receipts when amount is unknown or historically overpaid',()=>{
 for(const [amount,paidAmount,expected]of [[undefined,25,[null,25,null]],[NaN,25,[null,25,null]],[100,150,[100,150,0]],[100,null,[100,null,null]]]){
  const s={...base(),laiOpportunities:[opp('a')],orders:[{id:'o',client:'Synthetic',sourceOpportunityId:'a',currency:'USD',amount,paidAmount}]};
  const r=O.customerStats(s,'Synthetic',DAY).allOpportunities[0].linkedOrder;
  assert.deepEqual([r.amount,r.paidAmount,r.dueAmount],expected);
 }
});
test('round3 shared ledger projection excludes retired flags even if record remains in active array',()=>{
 for(const flag of [{trashedAt:'2026-10-07'},{deletedAt:'2026-10-07'},{archived:true}]){
  const s={...base(),laiOpportunities:[opp('a',{orderId:'o'})],orders:[{id:'o',client:'Synthetic',sourceOpportunityId:'a',amount:100,paidAmount:20,...flag}]};
  assert.equal(O.customerStats(s,'Synthetic',DAY).allOpportunities[0].linkedOrder,null);
 }
});
