const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/segments.js');
const M = require('../src/model.js');

test('restoring an archived segment uses the same unique-name rule as creating it',()=>{
 const state={customers:{Alpha:{}},orders:[],unknown:{keep:true},previewSegments:[
  {id:'active',name:'Elodie',kind:'manual',members:[],archived:false},
  {id:'old',name:' Élodie ',kind:'manual',members:['Alpha'],archived:true,unknown:{keep:true}},
 ]},before=structuredClone(state);
 assert.throws(()=>S.restoreSegment(state,'old'),/同名客群已存在/);
 assert.throws(()=>S.restoreSegment(state,'missing'),/不存在/);
 assert.throws(()=>S.restoreSegment(state,'active'),/已归档/);
 assert.deepEqual(state,before);
 const renamed=S.upsertSegment(state,'active',{name:'Other',kind:'manual',match:'all',members:[]});
 const restored=S.restoreSegment(renamed,'old');
 assert.deepEqual(restored.previewSegments[1],{...state.previewSegments[1],archived:false});
 assert.deepEqual(restored.customers,state.customers);
 assert.deepEqual(S.resolveMembers(M.buildCustomers(restored),restored.previewSegments[1]).map(row=>row.name),['Alpha']);
 assert.deepEqual(state,before);
});
const state = {extra:{keep:1},customers:{Alpha:{history:[{time:'2026-09-01',text:'old'},{time:'2026-09-05',text:'call',type:'followup'},{time:'2026-09-08',text:'edit'}],updated:'2026-09-20',opportunityLastWonDate:'2026-08-10'},Beta:{country:'France',createdAt:'2026-08-01',customerCode:'B-001'}},orders:[{client:'Alpha',amount:100,currency:'USD',stage:'done',createdAt:'2026-08-01',shippedAt:'2026-08-04'},{client:'Alpha',amount:200,currency:'USD',stage:'quote',createdAt:'2026-09-01'},{client:'Foreign',amount:20,currency:'EUR',stage:'shipment',createdAt:'2026-08-09'}]};
const rows = () => S.enrich(M.buildCustomers(state),state);
test('enrichment preserves honest order metrics and unknown dates',()=>{
 const [a,b,f] = ['Alpha','Beta','Foreign'].map(n=>rows().find(r=>r.name===n));
 assert.equal(a.lastWonDate,'2026-08-10');assert.equal(a.latestOrderDate,'2026-08-04');assert.equal(a.total,300);assert.equal(a.average,150);assert.equal(a.orderCount,2);
 assert.equal(a.latestActivity,'edit');assert.equal(a.lastFollowup,'2026-09-05');assert.equal(a.createdAt,'');assert.equal(a.lastContact,'');
 assert.equal(b.createdAt,'2026-08-01');assert.equal(b.customerCode,'B-001');assert.equal(b.average,null);assert.equal(f.average,null);assert.equal(f.total,null);
});
test('opportunity date and completed-order date remain separate in segment rules',()=>{
 const input=rows();
 assert.deepEqual(S.filterByRules(input,{rules:[{field:'lastWonDate',op:'eq',value:'2026-08-10'}]}).map(r=>r.name),['Alpha']);
 assert.deepEqual(S.filterByRules(input,{rules:[{field:'latestOrderDate',op:'eq',value:'2026-08-04'}]}).map(r=>r.name),['Alpha']);
 assert.equal(S.catalog.find(field=>field.id==='lastWonDate').label,'最近赢单日期');
 assert.equal(S.catalog.find(field=>field.id==='latestOrderDate').label,'最近成交订单日期');
});
test('first completed order fields use the earliest settled order and only show USD amounts',()=>{
 const source={customers:{USD:{},EUR:{},Open:{}},orders:[
  {client:'USD',amount:900,currency:'USD',stage:'quote',createdAt:'2026-01-01'},
  {client:'USD',amount:80,currency:'USD',stage:'done',createdAt:'2026-03-01',shippedAt:'2026-03-05'},
  {client:'USD',amount:40,currency:'USD',stage:'shipment',createdAt:'2026-02-01',shippedAt:'2026-02-10'},
  {client:'EUR',amount:20,currency:'EUR',stage:'done',createdAt:'2026-01-01',shippedAt:'2026-01-08'},
  {client:'EUR',amount:30,currency:'USD',stage:'done',createdAt:'2026-04-01',shippedAt:'2026-04-03'},
  {client:'Open',amount:50,currency:'USD',stage:'quote',createdAt:'2026-01-05'},
 ]};
 const before=structuredClone(source);
 const rows=new Map(S.enrich(M.buildCustomers(source),source).map(row=>[row.name,row]));
 assert.equal(rows.get('USD').firstOrderDate,'2026-02-10');
 assert.equal(rows.get('USD').firstOrderTotal,40);
 assert.equal(rows.get('USD').latestOrderDate,'2026-03-05');
 assert.equal(rows.get('EUR').firstOrderDate,'2026-01-08');
 assert.equal(rows.get('EUR').firstOrderTotal,null);
 assert.equal(rows.get('Open').firstOrderDate,'');
 assert.equal(rows.get('Open').firstOrderTotal,null);
 assert.deepEqual(source,before);
});
test('rules use all or any and reject invalid fields/operators/types before filtering',()=>{
 assert.deepEqual(S.filterByRules(rows(),{match:'all',rules:[{field:'total',op:'gte',value:250},{field:'name',op:'contains',value:'ALP'}]}).map(r=>r.name),['Alpha']);
 assert.equal(S.filterByRules(rows(),{match:'any',rules:[{field:'name',op:'eq',value:'alpha'},{field:'country',op:'eq',value:'France'}]}).length,2);
 assert.throws(()=>S.filterByRules([],{rules:[{field:'secret',op:'eq',value:1}]}));
 assert.throws(()=>S.filterByRules(rows(),{rules:[{field:'name',op:'execute',value:''}]}));
 assert.throws(()=>S.filterByRules(rows(),{rules:[{field:'name',op:'gte',value:10}]}));
 assert.throws(()=>S.filterByRules(rows(),{rules:[{field:'total',op:'gte',value:'bad'}]}));
 for(const match of ['',null,'bogus']) {
  assert.throws(()=>S.filterByRules(rows(),{match,rules:[]}),/请选择全部或任一条件/);
  assert.throws(()=>S.upsertSegment({customers:{}},'invalid',{name:'Invalid',kind:'rules',match,rules:[{field:'country',op:'eq',value:'US'}]}),/请选择全部或任一条件/);
 }
});
test('tag rules match any or all comma-separated labels alongside other conditions',()=>{
 const input=[
  {name:'Both US',tags:['LaiTagA','LaiTagB'],country:'美国'},
  {name:'First US',tags:['LaiTagA'],country:'美国'},
  {name:'Second US',tags:['LaiTagB'],country:'美国'},
  {name:'Both FR',tags:['LaiTagA','LaiTagB'],country:'法国'},
 ];
 const country={field:'country',op:'eq',value:'美国'};
 const tagged=op=>S.filterByRules(input,{match:'all',rules:[{field:'tags',op,value:'LaiTagA， LaiTagB'},country]}).map(row=>row.name);
 assert.deepEqual(tagged('containsAny'),['Both US','First US','Second US']);
 assert.deepEqual(tagged('containsAll'),['Both US']);
 assert.throws(()=>S.filterByRules(input,{rules:[{field:'name',op:'containsAny',value:'LaiTagA'}]}),/不支持/);
 assert.throws(()=>S.filterByRules(input,{rules:[{field:'tags',op:'containsAll',value:' , ， '}]},'2026-09-23'),/条件值/);
});
test('email rules include additional contact addresses without copying them to the primary field',()=>{
 const state={orders:[],customers:{
  Acme:{email:'main@acme.test',extraContacts:[{id:'second',contact:'Maya',email:'maya@acme.test'}]},
  Beta:{email:'buyer@beta.test'},
 }};
 const input=M.buildCustomers(state), before=structuredClone(input);
 const names=(op,value)=>S.filterByRules(input,{rules:[{field:'email',op,value}]}).map(row=>row.name);
 assert.deepEqual(names('contains','maya@acme.test'),['Acme']);
 assert.deepEqual(names('eq','maya@acme.test'),['Acme']);
 assert.deepEqual(names('notContains','maya@acme.test'),['Beta']);
 assert.deepEqual(names('neq','maya@acme.test'),['Beta']);
 assert.deepEqual(input,before);
 assert.equal(input[0].email,'main@acme.test');
});
test('segment rules can reproduce identity, stars, and followed ordinary filters',()=>{
 const source={orders:[],customers:{
  Alpha:{alibabaIdentity:'买家',customerStars:5,previewFollowed:true},
  Beta:{alibabaIdentity:'买家',customerStars:5,previewFollowed:false},
  Gamma:{alibabaIdentity:'卖家',customerStars:1,previewFollowed:true},
 }};
 const input=M.buildCustomers(source);
 const rules=[{field:'alibabaIdentity',op:'eq',value:'买家'},{field:'customerStars',op:'eq',value:'5'},{field:'followed',op:'eq',value:'true'}];
 assert.deepEqual(S.filterByRules(input,{match:'all',rules}).map(row=>row.name),['Alpha']);
 assert.deepEqual(S.filterByRules(input,{rules:[{field:'followed',op:'eq',value:'false'}]}).map(row=>row.name),['Beta']);
 assert.equal(S.catalog.find(field=>field.id==='customerStars')?.type,'number');
 assert.equal(S.catalog.find(field=>field.id==='followed')?.type,'boolean');
});
test('a customer-level segment includes automatically graded customers',()=>{
 const input=M.buildCustomers({customers:{Auto:{},Manual:{level:'B级翡翠客户'}},orders:[
  {client:'Auto',amount:600,currency:'USD'},
  {client:'Auto',amount:300,currency:'USD'},
 ]});
 assert.deepEqual(S.filterByRules(input,{rules:[{field:'level',op:'eq',value:'E级白银客户'}]}).map(row=>row.name),['Auto']);
 assert.deepEqual(S.filterByRules(input,{rules:[{field:'level',op:'eq',value:'B级翡翠客户'}]}).map(row=>row.name),['Manual']);
});
test('array-backed group and tag rules match individual labels without joining boundaries',()=>{
 const input=[
  {name:'Split',group:['East','VIP'],tags:['Buyer','Repeat']},
  {name:'Whole',group:['East VIP'],tags:['Buyer Repeat']},
 ];
 const names=(field,op,value)=>S.filterByRules(input,{rules:[{field,op,value}]}).map(row=>row.name);
 assert.deepEqual(names('group','contains','st V'),['Whole']);
 assert.deepEqual(names('group','eq','East VIP'),['Whole']);
 assert.deepEqual(names('group','notContains','st V'),['Split']);
 assert.deepEqual(names('tags','contains','yer R'),['Whole']);
 assert.deepEqual(names('tags','eq','Buyer Repeat'),['Whole']);
});
test('date and monetary comparisons exclude missing values; clock can be injected',()=>{
 assert.equal(S.filterByRules(rows(),{rules:[{field:'total',op:'lte',value:0}]}).length,1);
 assert.deepEqual(S.filterByRules(rows(),{rules:[{field:'lastFollowup',op:'olderDays',value:10}]},'2026-09-20').map(r=>r.name),['Alpha']);
 assert.equal(S.filterByRules(rows(),{rules:[{field:'lastFollowup',op:'before',value:'2026-09-20'}]}).length,1);
 assert.equal(S.filterByRules(rows(),{rules:[{field:'lastFollowup',op:'empty'}]}).length,2);
 assert.throws(()=>S.filterByRules(rows(),{rules:[{field:'lastFollowup',op:'olderDays',value:-1}]}));
});
test('segments survive JSON roundtrip and rules recalculate with changed rows',()=>{
 const next = S.upsertSegment(state,'s1',{name:' High value ',kind:'rules',match:'all',rules:[{field:'total',op:'gte',value:200}]});
 assert.equal(next.previewSegments[0].name,'High value');assert.equal(state.previewSegments,undefined);assert.deepEqual(next.extra,state.extra);
 const saved=JSON.parse(JSON.stringify(next));assert.deepEqual(S.resolveMembers(rows(),saved.previewSegments[0]).map(r=>r.name),['Alpha']);
 assert.equal(S.resolveMembers(rows().map(r=>({...r,total:100})),saved.previewSegments[0]).length,0);
 assert.throws(()=>S.upsertSegment(next,'s2',{name:'high VALUE',kind:'manual'}));
 assert.throws(()=>S.upsertSegment(state,'s1',{name:'x',kind:'rules',rules:[]}));
 assert.throws(()=>S.upsertSegment(state,'s1',{name:' ',kind:'manual'}));
});
test('manual membership accepts order-only clients; archive preserves customers; rename migrates',()=>{
 let next=S.upsertSegment(state,'s1',{name:'Manual',kind:'manual'});
 next=S.assignMembers(next,'s1',['Alpha','Foreign','Alpha']);assert.deepEqual(next.previewSegments[0].members,['Alpha','Foreign']);
 assert.throws(()=>S.assignMembers(next,'s1',['Missing']));assert.equal(state.previewSegments,undefined);
 const renamed=S.renameMember(next,'Alpha','Renamed');assert.deepEqual(renamed.previewSegments[0].members,['Renamed','Foreign']);
 assert.deepEqual(next.previewSegments[0].members,['Alpha','Foreign']);
 next=S.assignMembers(next,'s1',['Alpha'],'remove');assert.deepEqual(next.previewSegments[0].members,['Foreign']);
 next=S.archiveSegment(next,'s1');assert.equal(next.previewSegments[0].archived,true);assert.deepEqual(next.customers,state.customers);assert.deepEqual(next.orders,state.orders);assert.equal(S.resolveMembers(rows(),next.previewSegments[0]).length,0);
});
test('editing a customer group updates the matching manual segment and its displayed field',()=>{
 const original={customers:{Alpha:{previewGroup:'Legacy',owner:'Cherry'},Beta:{owner:'Kris'}},orders:[{id:'o1',client:'Alpha',amount:10}],previewSegments:[
  {id:'a',name:'Old',kind:'manual',members:['Alpha','Beta']},
  {id:'b',name:'New',kind:'manual',members:['Beta']},
  {id:'c',name:'Archived',kind:'manual',members:['Alpha'],archived:true},
  {id:'r',name:'Rule',kind:'rules',rules:[{field:'country',op:'eq',value:'US'}]},
 ]};
 const before=JSON.stringify(original);
 const next=S.setEditorGroup(original,'Alpha','New','Legacy');
 assert.deepEqual(next.previewSegments.map(item=>item.members),[['Beta'],['Beta','Alpha'],['Alpha'],undefined]);
 assert.equal(next.customers.Alpha.previewGroup,'');
 assert.equal(next.customers.Alpha.owner,'Cherry');
 assert.deepEqual(next.orders,original.orders);
 assert.deepEqual(S.enrich(M.buildCustomers(next),next).find(row=>row.name==='Alpha').group,['New']);
 assert.equal(JSON.stringify(original),before);
});

test('enriched customer segments include current local memberships without replacing saved legacy labels',()=>{
 const source={orders:[],customers:{
  Alpha:{country:'US',previewGroup:'Legacy',segments:['Imported','Manual']},
  Beta:{country:'US'},
  Gamma:{country:'CN',segments:'Older imported group'},
 },previewSegments:[
  {id:'m',name:'Manual',kind:'manual',members:['Alpha']},
  {id:'r',name:'US Rule',kind:'rules',match:'all',rules:[{field:'country',op:'eq',value:'US'}]},
  {id:'a',name:'Archived',kind:'manual',members:['Alpha'],archived:true},
 ]};
 const before=structuredClone(source);
 const rows=new Map(S.enrich(M.buildCustomers(source),source).map(row=>[row.name,row]));
 assert.deepEqual(rows.get('Alpha').group,['Legacy','Manual']);
 assert.deepEqual(rows.get('Alpha').segments,['Imported','Manual','US Rule']);
 assert.deepEqual(rows.get('Beta').segments,['US Rule']);
 assert.deepEqual(rows.get('Gamma').segments,['Older imported group']);
 assert.deepEqual(source,before);
});
test('unchanged editor group preserves other memberships, and invalid group choices cannot save',()=>{
 const original={customers:{Alpha:{previewGroup:'A'}},orders:[],previewSegments:[
  {id:'a',name:'A',kind:'manual',members:['Alpha']},
  {id:'b',name:'B',kind:'manual',members:['Alpha']},
  {id:'r',name:'Rule',kind:'rules',rules:[{field:'name',op:'contains',value:'A'}]},
 ]};
 const unchanged=S.setEditorGroup(original,'Alpha','A','A');
 assert.deepEqual(unchanged.previewSegments.map(item=>item.members),[['Alpha'],['Alpha'],undefined]);
 assert.equal(unchanged.customers.Alpha.previewGroup,'');
 assert.throws(()=>S.setEditorGroup(original,'Alpha','Rule','A'),/手动分组/);
 assert.throws(()=>S.setEditorGroup(original,'Alpha','Unknown','A'),/手动分组/);
 assert.throws(()=>S.setEditorGroup(original,'Missing','A',''),/客户不存在/);
 const cleared=S.setEditorGroup(original,'Alpha','','A');
 assert.deepEqual(cleared.previewSegments.slice(0,2).map(item=>item.members),[[],[]]);
 const legacy={...original,customers:{Alpha:{previewGroup:'Legacy'}},previewSegments:original.previewSegments.map(item=>({...item}))};
 const retained=S.setEditorGroup(legacy,'Alpha','Legacy','Legacy');
 assert.equal(retained.customers.Alpha.previewGroup,'Legacy');
 assert.deepEqual(retained.previewSegments.slice(0,2).map(item=>item.members),[['Alpha'],['Alpha']]);
});
test('columns deduplicate, retain name, cap additional frozen fields and order them first',()=>{
 const defaults=S.normalizeColumns();assert.equal(defaults.order.length,18);assert.deepEqual(defaults.frozen,['name']);
 const columns=S.normalizeColumns({order:['email','country','owner','contact','email','bad'],frozen:['email','country','owner','bad']});
 assert.deepEqual(columns.frozen,['name','email','country']);assert.deepEqual(columns.order,['name','email','country','owner','contact']);
 assert.deepEqual(S.normalizeColumns({order:[],frozen:[]}),{order:['name'],frozen:['name']});
});
test('supported rule operators return observable subsets and preserve input rows',()=>{
 const sample=[{name:'Alpha',tags:['Buyer','VIP'],total:10,lastContact:'2026-09-10'},{name:'Beta',tags:[],total:20,lastContact:'2026-09-20'},{name:'Gamma',tags:[],total:null,lastContact:''}];
 const match=(field,op,value)=>S.filterByRules(sample,{rules:[{field,op,value}]},'2026-09-22').map(row=>row.name);
 assert.deepEqual(match('name','neq','alpha'),['Beta','Gamma']);assert.deepEqual(match('tags','contains','vip'),['Alpha']);assert.deepEqual(match('name','notContains','ALP'),['Beta','Gamma']);
 assert.deepEqual(match('total','eq',20),['Beta']);assert.deepEqual(match('total','neq',20),['Alpha']);assert.deepEqual(match('total','notEmpty'),['Alpha','Beta']);
 assert.deepEqual(match('lastContact','after','2026-09-15'),['Beta']);assert.deepEqual(match('lastContact','eq','2026-09-10'),['Alpha']);
 assert.notEqual(S.filterByRules(sample,{rules:[]}),sample);assert.deepEqual(sample[0].tags,['Buyer','VIP']);
});
test('segment update keeps identity/unknown properties; rule groups reject manual assignments',()=>{
 const created=S.upsertSegment(state,'one',{name:'Rules',kind:'rules',rules:[{field:'name',op:'eq',value:'Alpha'}]});
 created.previewSegments[0].legacy='keep';
 const edited=S.upsertSegment(created,'one',{name:'Renamed',kind:'rules',match:'any',rules:[{field:'country',op:'eq',value:'France'}]});
 assert.equal(edited.previewSegments.length,1);assert.equal(edited.previewSegments[0].legacy,'keep');assert.equal(created.previewSegments[0].name,'Rules');
 assert.throws(()=>S.assignMembers(edited,'one',['Alpha']));assert.throws(()=>S.archiveSegment(edited,'missing'));
 const archived=S.archiveSegment(edited,'one');assert.throws(()=>S.upsertSegment(archived,'one',{name:'Restore',kind:'manual'}));
});
test('date rules compare local calendar days while olderDays retains elapsed time',()=>{
 const sample=[{name:'Same',lastFollowup:'2026-09-22T10:00:00'},{name:'Previous',lastFollowup:'2026-09-21T23:59:59'},{name:'Next',lastFollowup:'2026-09-23T00:00:00'}];
 const match=op=>S.filterByRules(sample,{rules:[{field:'lastFollowup',op,value:'2026-09-22'}]},new Date('2026-09-22T15:00:00')).map(row=>row.name);
 assert.deepEqual(match('eq'),['Same']);assert.deepEqual(match('neq'),['Previous','Next']);assert.deepEqual(match('before'),['Previous']);assert.deepEqual(match('after'),['Next']);
 assert.deepEqual(S.filterByRules(sample,{rules:[{field:'lastFollowup',op:'olderDays',value:0.25}]},new Date('2026-09-22T15:00:00')).map(row=>row.name),['Previous']);
});
test('frozen columns follow configured column order rather than membership input order',()=>{
 assert.deepEqual(S.normalizeColumns({order:['phone','email','country'],frozen:['country','email','phone']}),{order:['name','phone','email','country'],frozen:['name','phone','email']});
 assert.deepEqual(S.normalizeColumns({order:['email','phone','country'],frozen:['phone','email']}),{order:['name','email','phone','country'],frozen:['name','email','phone']});
});
test('enrichment supports historical date/content/note aliases without guessing followup type',()=>{
 const profile={history:[{date:'2026-09-20T10:00:00',content:'Contacted',type:'followup'},{date:'2026-09-21',note:'Imported update'}]};
 const output=S.enrich([{name:'Alias',orders:[],orderCount:0,total:0}],{customers:{Alias:profile}})[0];
 assert.equal(output.lastFollowup,'2026-09-20T10:00:00');assert.equal(output.latestActivity,'Imported update');
});
test('recent activity ignores typed profile operations while preserving the latest customer interaction',()=>{
 const profile={history:[
  {time:'2026-09-21T09:00:00Z',text:'Sent a product update',type:'email'},
  {time:'2026-09-22T10:00:00Z',text:'Followed up on samples',type:'followup'},
  {time:'2026-09-23T11:00:00Z',text:'批量添加客户标签：VIP',type:'operation'},
 ]};
 const output=S.enrich([{name:'Alpha',orders:[],orderCount:0,total:0}],{customers:{Alpha:profile}})[0];
 assert.equal(output.latestActivity,'Followed up on samples');
 assert.equal(output.lastFollowup,'2026-09-22T10:00:00Z');
});
test('last contact follows explicit email or chat history without counting quick followup notes',()=>{
 const source={orders:[],customers:{
  Email:{history:[
   {time:'2026-09-22T10:00:00Z',type:'followup',text:'Internal note'},
   {time:'2026-09-20T09:00:00Z',type:'email',text:'Customer replied'},
   {time:'2026-09-18T08:00:00Z',type:'chat',text:'WhatsApp reply'},
  ]},
  SavedLater:{lastContact:'2026-09-21T12:00:00Z',history:[{time:'2026-09-20T09:00:00Z',type:'email',text:'Older email'}]},
  ChatLater:{lastContact:'2026-09-19T12:00:00Z',history:[{date:'2026-09-20T09:00:00Z',type:'chat',content:'Newer chat'}]},
  PhoneCall:{history:[{time:'2026-09-21T11:00:00Z',type:'call',text:'Customer call'}]},
  NoContact:{history:[{time:'2026-09-23T10:00:00Z',text:'Unclassified note'},{time:'bad',type:'email',text:'Invalid date'}]},
 }};
 const before=structuredClone(source);
 const rows=new Map(S.enrich(M.buildCustomers(source),source).map(row=>[row.name,row]));
 assert.equal(rows.get('Email').lastContact,'2026-09-20T09:00:00Z');
 assert.equal(rows.get('SavedLater').lastContact,'2026-09-21T12:00:00Z');
  assert.equal(rows.get('ChatLater').lastContact,'2026-09-20T09:00:00Z');
  assert.equal(rows.get('PhoneCall').lastContact,'2026-09-21T11:00:00Z');
 assert.equal(rows.get('NoContact').lastContact,'');
 assert.deepEqual(source,before);
});
test('known legacy profile operations do not replace recent customer activity',()=>{
 const profile={history:[
  {time:'2026-09-21T09:00:00Z',text:'Sent a product update',type:'email'},
  {time:'2026-09-22T10:00:00Z',text:'更新客户资料'},
  {time:'2026-09-23T11:00:00Z',text:'批量添加客户标签：VIP'},
  {time:'2026-09-24T11:00:00Z',text:'更新：客户地址：空 → 已填写'},
  {time:'2026-09-25T11:00:00Z',text:'合并客户档案：副档案 → 主档案'},
 ]};
 const output=S.enrich([{name:'Alpha',orders:[],orderCount:0,total:0}],{customers:{Alpha:profile}})[0];
 assert.equal(output.latestActivity,'Sent a product update');
});
test('enrichment derives current manual group labels and supports text rule matching',()=>{
 let next=S.upsertSegment(state,'m1',{name:'VIP Buyers',kind:'manual'});
 next=S.assignMembers(next,'m1',['Alpha']);
 const enriched=S.enrich(M.buildCustomers(next).map(row=>row.name==='Alpha'?{...row,group:'Legacy'}:row),next);
 assert.deepEqual(enriched.find(row=>row.name==='Alpha').group,['Legacy','VIP Buyers']);
 assert.deepEqual(S.filterByRules(enriched,{rules:[{field:'group',op:'contains',value:'buyers'}]}).map(row=>row.name),['Alpha']);
 const archived=S.archiveSegment(next,'m1');assert.deepEqual(S.enrich(M.buildCustomers(archived),archived).find(row=>row.name==='Alpha').group,[]);
});
