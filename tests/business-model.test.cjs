const test=require('node:test');
const assert=require('node:assert/strict');
const B=require('../src/business-model.js');
const base=()=>({customSetting:{safe:1},customers:{Alpha:{extra:'keep'}},orders:[{id:'a',num:'SO1',client:'Alpha',currency:'USD',amount:100,paidAmount:20,stage:'production',createdAt:'2026-09-01',attachments:[{id:'doc'}],logs:[{text:'first'}],unknown:3}],trashOrders:[],deletedOrders:[]});
test('currency metrics stay separate, exclude drafts and preserve settled paid convention',()=>{
 const result=B.orderMetrics([{currency:'USD',amount:100,paidAmount:20,stage:'production'},{currency:'EUR',amount:60,paidAmount:0,stage:'shipment'},{currency:'USD',amount:10,stage:'done'},{currency:'USD',amount:999,isDraft:true},{currency:'USD',amount:null,stage:'quote'}]);
 assert.equal(result.count,4);assert.equal(result.activeCount,3);
 assert.deepEqual(result.byCurrency.find(x=>x.currency==='USD'),{currency:'USD',total:110,paid:30,due:80,count:3});
 assert.deepEqual(result.byCurrency.find(x=>x.currency==='EUR'),{currency:'EUR',total:60,paid:60,due:0,count:1});
 assert.deepEqual(B.orderMetrics([]),{byCurrency:[],count:0,activeCount:0});
});
test('order edit preserves metadata and never mutates original; new clients create linked profiles',()=>{
 const state=base();const next=B.upsertOrder(state,'a',{num:'SO1',client:'Beta',amount:200,paidAmount:50,stage:'balance'});
 assert.equal(next.orders[0].unknown,3);assert.deepEqual(next.orders[0].attachments,state.orders[0].attachments);assert.deepEqual(next.orders[0].logs,state.orders[0].logs);
 assert.equal(state.orders[0].client,'Alpha');assert.equal(next.customers.Beta.client,'Beta');assert.deepEqual(next.customers.Alpha,state.customers.Alpha);assert.equal(state.customers.Beta,undefined);assert.deepEqual(next.customSetting,state.customSetting);
 const added=B.upsertOrder(state,'b',{num:'SO2',client:'Alpha',amount:0});assert.equal(added.orders.length,2);assert.equal(added.orders.find(x=>x.id==='b').paidAmount,0);assert.equal(added.orders.find(x=>x.id==='b').currency,'USD');
});
test('invalid numbers and duplicate numbers across active/trash/deleted are rejected',()=>{
 const state=base();state.trashOrders.push({id:'t',num:'SO2'});state.deletedOrders.push({id:'d',num:'SO3'});
 const create=fields=>B.upsertOrder(state,'b',{num:'SO4',client:'Alpha',amount:100,...fields});
 for(const amount of ['',null,-1,NaN,'bad'])assert.throws(()=>create({amount}));
 for(const paidAmount of ['',null,-1,101,Infinity])assert.throws(()=>create({paidAmount}));
 for(const num of ['SO1',' so2 ','so3',''])assert.throws(()=>create({num}));
 assert.throws(()=>create({client:''}));assert.throws(()=>create({stage:'invalid'}));assert.throws(()=>create({createdAt:'2026-02-30'}));assert.throws(()=>create({orderMonth:'2026-13'}));
 assert.throws(()=>B.upsertOrder(state,'t',{num:'SO4',client:'Alpha',amount:100}));assert.equal(state.orders[0].amount,100);
});
test('archive then restore retains id and unknown metadata without permanent deletion',()=>{
 const original=base();const archived=B.archiveOrder(original,'a','2026-09-22T10:00:00Z');
 assert.equal(archived.orders.length,0);assert.equal(archived.trashOrders[0].trashedAt,'2026-09-22T10:00:00Z');assert.equal(original.orders.length,1);assert.equal(archived.deletedOrders.length,0);
 const restored=B.restoreOrder(archived,'a');assert.deepEqual(restored.orders,original.orders);assert.deepEqual(restored.trashOrders,[]);assert.equal(archived.trashOrders.length,1);assert.throws(()=>B.restoreOrder(restored,'a'));
 const collision={...archived,orders:[{id:'other',num:'so1'}]};assert.throws(()=>B.restoreOrder(collision,'a'));
});
test('calendar validates dates, filters month and excludes trashed customer followups',()=>{
 const state={orders:[{id:'a',num:'SO1',client:'Alpha',createdAt:'2026-09-04T10:00:00'},{id:'b',num:'SO2',createdAt:'2026-02-30'}],customers:{Alpha:{nextFollow:'2026-09-02'},Trash:{nextFollow:'2026-09-03',trashedAt:'2026-09-01'},Other:{nextFollow:'2026-10-01'}},laiTasks:[{id:'t',title:'Call',date:'2026-09-01',done:false},{id:'bad',title:'Bad',date:'2026-09-31'}]};
 const events=B.calendarEvents(state,'2026-09');assert.deepEqual(events.map(e=>e.kind),['task','followup','order']);assert.deepEqual(events.map(e=>e.date),['2026-09-01','2026-09-02','2026-09-04']);assert.equal(events[1].customer,'Alpha');assert.equal(events[2].id,'a');assert.throws(()=>B.calendarEvents(state,'2026-13'));
});
test('tasks validate input and preserve unknown fields through updates',()=>{
 const state={extra:1,laiTasks:[{id:'t',title:'Before',date:'2026-09-01',done:false,custom:'safe'}]};
 const next=B.setTask(state,'t',{title:' After ',date:'2026-09-22',done:true});assert.deepEqual(next.laiTasks,[{id:'t',title:'After',date:'2026-09-22',done:true,custom:'safe'}]);assert.equal(state.laiTasks[0].done,false);assert.equal(next.extra,1);
 const added=B.setTask(next,'new',{title:'Second',date:'2026-09-23',done:false});assert.equal(added.laiTasks.length,2);
 assert.throws(()=>B.setTask(state,'t',{title:'',date:'2026-09-22',done:false}));assert.throws(()=>B.setTask(state,'t',{title:'x',date:'2026-02-30',done:false}));assert.throws(()=>B.setTask(state,'t',{title:'x',date:'2026-09-22',done:'false'}));
});
test('next action is free text and does not become a date requirement',()=>{
 const state=base();state.orders[0].next='确认报价条款';
 const next=B.upsertOrder(state,'a',{note:'Update'});assert.equal(next.orders[0].next,'确认报价条款');
 const edited=B.upsertOrder(next,'a',{next:'跟进定金到账'});assert.equal(edited.orders[0].next,'跟进定金到账');
});
test('calendar followups follow actual Lai customer recycle and restore lifecycle',()=>{
 const customerModules=require('../src/modules.js');
 const state={customers:{Alpha:{nextFollow:'2026-09-23'},Pool:{nextFollow:'2026-09-24',laiBucket:'pool'}},orders:[]};
 assert.equal(B.calendarEvents(state,'2026-09').length,2);
 const archived=customerModules.moveCustomers(state,['Alpha','Pool'],'trash');
 assert.equal(archived.customers.Alpha.laiBucket,'trash');assert.equal(B.calendarEvents(archived,'2026-09').length,0);
 const restored=customerModules.moveCustomers(archived,['Alpha','Pool'],'restore');
 assert.equal(restored.customers.Alpha.laiBucket,'active');assert.equal(restored.customers.Pool.laiBucket,'pool');assert.equal(B.calendarEvents(restored,'2026-09').length,2);
 assert.equal(B.calendarEvents(state,'2026-09').length,2);
});
test('monthly analysis hand-checks month rule, drafts, currency grouping and stage counts without converting currencies',()=>{
 const orders=[
  {id:'1',client:'Alpha',currency:'USD',amount:100,paidAmount:20,stage:'quote',orderMonth:'2026-10',createdAt:'2026-09-30'},
  {id:'2',client:'Alpha',currency:' usd ',amount:50,stage:'production',createdAt:'2026-10-05'},
  {id:'3',client:'Alpha',currency:'EUR',amount:70,stage:'shipment',orderMonth:'2026-10'},
  {id:'4',client:'Beta',currency:'USD',amount:300,stage:'done',orderMonth:'2026-10'},
  {id:'5',client:'Beta',currency:'USD',amount:999,isDraft:true,stage:'quote',orderMonth:'2026-10'},
  {id:'6',client:'Beta',currency:'USD',amount:1,stage:'quote',orderMonth:'2026-09'},
  {id:'7',client:'Gamma',currency:'USD',amount:-5,stage:'quote',orderMonth:'2026-10'}
 ];
 const before=JSON.parse(JSON.stringify(orders));
 const result=B.monthlyAnalysis(orders,'2026-10');
 assert.deepEqual(orders,before);
 assert.deepEqual(result.orders.map(order=>order.id),['1','2','3','4','7']);
 assert.deepEqual(result.stages.map(({id,count,percent})=>({id,count,percent})),[{id:'quote',count:2,percent:40},{id:'deposit',count:0,percent:0},{id:'production',count:1,percent:20},{id:'balance',count:0,percent:0},{id:'shipment',count:1,percent:20},{id:'done',count:1,percent:20}]);
 assert.deepEqual(result.contributions,[{client:'Alpha',currency:'EUR',amount:70,count:1},{client:'Beta',currency:'USD',amount:300,count:1},{client:'Alpha',currency:'USD',amount:150,count:2},{client:'Gamma',currency:'USD',amount:0,count:1}]);
 assert.deepEqual(result.metrics.byCurrency.find(row=>row.currency==='USD'),{currency:'USD',total:450,paid:320,due:130,count:4});
 assert.deepEqual(result.metrics.byCurrency.find(row=>row.currency==='EUR'),{currency:'EUR',total:70,paid:70,due:0,count:1});
 assert.equal(result.metrics.count,5);assert.equal(result.metrics.activeCount,4);
 assert.equal(result.contributions.reduce((sum,row)=>sum+row.count,0),result.metrics.count);
});
test('monthly analysis gives empty results for months without orders, draft-only months and invalid months',()=>{
 const orders=[{id:'d',client:'Alpha',currency:'USD',amount:10,stage:'quote',isDraft:true,orderMonth:'2026-10'}];
 for(const month of ['2026-10','2026-11','2026-13','',undefined]){
  const result=B.monthlyAnalysis(orders,month);
  assert.deepEqual(result.orders,[]);assert.deepEqual(result.contributions,[]);assert.deepEqual(result.metrics,{byCurrency:[],count:0,activeCount:0});
  assert.ok(result.stages.every(row=>row.count===0&&row.percent===0));assert.equal(result.stages.length,B.stages.length);
 }
 assert.deepEqual(B.monthlyAnalysis(undefined,'2026-10').orders,[]);
});
test('order items: amount and 产品 follow the items, bad rows are refused, no items keeps the typed amount',()=>{
 const state=base();
 const items=[{productId:'p1',code:'A-1',name:'Lash A',unit:'盒',qty:'100',price:'2.5'},{productId:'p2',name:'Lash B',qty:3,price:0.333}];
 const next=B.upsertOrder(state,'a',{num:'SO1',client:'Alpha',amount:1,items});
 const order=next.orders.find(o=>o.id==='a');
 assert.equal(order.amount,251);assert.equal(order.productType,'Lash A、Lash B');
 assert.deepEqual(order.items[0],{productId:'p1',code:'A-1',name:'Lash A',model:'',unit:'盒',qty:100,price:2.5});
 assert.deepEqual(order.attachments,[{id:'doc'}]);
 // An edit without items keeps the saved items and their total.
 assert.equal(B.upsertOrder(next,'a',{amount:5}).orders.find(o=>o.id==='a').amount,251);
 // Clearing the items goes back to the typed amount.
 const cleared=B.upsertOrder(next,'a',{amount:80,items:[]}).orders.find(o=>o.id==='a');
 assert.equal(cleared.amount,80);assert.deepEqual(cleared.items,[]);
 assert.throws(()=>B.upsertOrder(state,'a',{items:[{name:'',qty:1,price:1}]}),/第 1 行还没选产品/);
 assert.throws(()=>B.upsertOrder(state,'a',{items:[{name:'X',qty:0,price:1}]}),/数量要大于 0/);
 assert.throws(()=>B.upsertOrder(state,'a',{items:[{name:'X',qty:1,price:-1}]}),/单价/);
 assert.throws(()=>B.upsertOrder(state,'a',{items:'X'}),/格式无效/);
 assert.throws(()=>B.upsertOrder(state,'a',{items:Array.from({length:B.ITEM_LIMIT+1},()=>({name:'X',qty:1,price:1}))}),/最多/);
 assert.throws(()=>B.upsertOrder(state,'a',{paidAmount:300,items:[{name:'X',qty:1,price:100}]}),/已收款不能超过订单金额/);
});
test('order items helpers: from a product, linking by name, and document lines',()=>{
 assert.deepEqual(B.itemFromProduct({id:'p1',code:'A-1',name:'Lash A',model:'M',unit:'盒',fob:'1,200.5'},2),{productId:'p1',code:'A-1',name:'Lash A',model:'M',unit:'盒',qty:2,price:1200.5});
 assert.equal(B.itemFromProduct({id:'p2',name:'No price',fob:''}).price,0);
 const linked=B.linkItems([{productId:'',name:'Lash A',qty:5,price:9},{productId:'',name:'Other',qty:1,price:1}],[{id:'p1',code:'A-1',name:'Lash A',unit:'盒',fob:'2'}]);
 assert.deepEqual(linked[0],{productId:'p1',code:'A-1',name:'Lash A',model:'',unit:'盒',qty:5,price:9});
 assert.equal(linked[1].productId,'');
 assert.deepEqual(B.docLines({items:[{code:'A-1',name:'Lash A',unit:'盒',qty:100,price:2.5}]}),[{code:'A-1',name:'Lash A',model:'',unit:'盒',qty:100,price:2.5}]);
 assert.deepEqual(B.docLines({productType:'假睫毛',amount:300}),[{code:'',name:'假睫毛',model:'',unit:'',qty:1,price:300}]);
 assert.equal(B.docLines({amount:0})[0].name,'订单货款');
 assert.equal(B.itemsTotal([{qty:3,price:0.1}]),0.3);
});

test('editing the order date moves orderMonth unless it was set by hand',()=>{
 let s=B.upsertOrder({customers:{},orders:[]},'n',{num:'N1',client:'Zed',amount:10,createdAt:'2026-09-30'});
 assert.equal(s.orders[0].orderMonth,'2026-09');
 s=B.upsertOrder(s,'n',{num:'N1',client:'Zed',createdAt:'2026-10-02'});
 assert.equal(s.orders[0].orderMonth,'2026-10');
 s=B.upsertOrder(s,'n',{orderMonth:'2026-12'});
 s=B.upsertOrder(s,'n',{createdAt:'2026-11-05'});
 assert.equal(s.orders[0].orderMonth,'2026-12');
});
test('order client matches existing customer by normalised name and refuses trashed ones',()=>{
 const s0={customers:{'ABC Co':{client:'ABC Co'},'Old Co':{client:'Old Co',laiBucket:'trash'}},orders:[]};
 const s=B.upsertOrder(s0,'x',{num:'X1',client:'  abc   co ',amount:5});
 assert.equal(s.orders[0].client,'ABC Co');
 assert.deepEqual(Object.keys(s.customers),['ABC Co','Old Co']);
 assert.throws(()=>B.upsertOrder(s0,'y',{num:'Y1',client:'old co',amount:5}),/客户在回收站里，请先恢复/);
 const n=B.upsertOrder(s0,'z',{num:'Z1',client:'New Co',amount:5});
 assert.ok(Object.hasOwn(n.customers,'New Co'));
});
