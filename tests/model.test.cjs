const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const modelPath = path.join(__dirname, '../src/model.js');
const M = fs.existsSync(modelPath) ? require(modelPath) : {};
const S = require('../src/segments.js');

test('backup email list honors explicit clears before legacy aliases without changing stored data',()=>{
 const state={orders:[],customers:{Cleared:{alternateEmail:'',alternativeEmail:'stale@example.test'},Canonical:{alternateEmail:'current@example.test',alternativeEmail:'stale@example.test'},Legacy:{alternativeEmail:'legacy@example.test'},Old:{backupEmail:'old@example.test'}}};
 const before=structuredClone(state),rows=new Map(M.buildCustomers(state).map(row=>[row.name,row]));
 assert.equal(rows.get('Cleared').alternativeEmail,'');
 assert.equal(rows.get('Canonical').alternativeEmail,'current@example.test');
 assert.equal(rows.get('Legacy').alternativeEmail,'legacy@example.test');
 assert.equal(rows.get('Old').alternativeEmail,'old@example.test');
 assert.deepEqual(state,before);
});
const source = () => ({customers:{'Élodie Martin':{country:'法国',contacts:['Élodie','Marie'],emails:['sales@example.test'],tags:['睫毛'],owner:'Cherry',customLegacy:{preserve:true}},'No Orders':{country:'美国',owner:'Naomi'}},orders:[{id:'o1',client:'Élodie Martin',amount:100,paidAmount:20,currency:'USD',stage:'deposit',createdAt:'2026-09-01'},{id:'o2',client:'Order Only',amount:45,paidAmount:0,currency:'USD',stage:'done',createdAt:'2026-09-02'},{id:'draft',client:'Élodie Martin',amount:9000,isDraft:true}]});
test('customers include order-only records without counting drafts, settled stages count fully paid',()=>{const rows=M.buildCustomers?.(source()); assert.equal(rows?.length,3);const a=rows.find(r=>r.name==='Élodie Martin');assert.equal(a.total,100);assert.equal(a.due,80);assert.equal(a.orderCount,1);assert.equal(rows.find(r=>r.name==='Order Only').due,0);});
test('the list derives the same customer level as the name badge without changing the saved level',()=>{
 const state={customers:{Auto:{},Manual:{level:'B级翡翠客户'},Reset:{level:'自动判断'}},orders:[
  {client:'Auto',amount:600,currency:'USD',createdAt:'2026-09-01'},
  {client:'Auto',amount:300,currency:'USD',createdAt:'2026-09-02'},
  {client:'Manual',amount:200,currency:'USD',createdAt:'2026-09-01'},
  {client:'Reset',amount:100,currency:'USD',createdAt:'2026-09-01'},
 ]};
 const byName=new Map(M.buildCustomers(state).map(row=>[row.name,row]));
 assert.equal(byName.get('Auto').displayLevel,'E级白银客户');
 assert.equal(byName.get('Auto').level,'');
 assert.equal(byName.get('Manual').displayLevel,'B级翡翠客户');
 assert.equal(byName.get('Reset').displayLevel,'F级青铜客户');
 assert.equal(state.customers.Reset.level,'自动判断');
});
test('a missing contact name stays blank instead of borrowing the company name',()=>{
 const state={customers:{Acme:{email:'sales@example.test'},Empty:{}},orders:[{client:'Order Only',amount:5,email:'buyer@example.test'}]};
 const rows=M.buildCustomers(state);
 assert.equal(rows.find(row=>row.name==='Acme').contact,'');
 assert.equal(rows.find(row=>row.name==='Empty').contact,'');
 assert.equal(rows.find(row=>row.name==='Order Only').contact,'');
});

test('company payment plan and account period remain distinct editable customer fields',()=>{
 const state={orders:[],customers:{Acme:{country:'US',source:'Referral'}}};
 const next=M.upsertCustomer(state,'Acme',{name:'Acme',defaultPaymentPlan:'30% deposit',customerAccountPeriod:'Net 30'});
 assert.equal(next.customers.Acme.defaultPaymentPlan,'30% deposit');
 assert.equal(next.customers.Acme.customerAccountPeriod,'Net 30');
 assert.equal(next.customers.Acme.source,'Referral');
 assert.equal(state.customers.Acme.defaultPaymentPlan,undefined);
});

test('editor follow draft saves as a boolean only on customer submission',()=>{
 const state={orders:[],customers:{Acme:{country:'US',source:'Referral',previewFollowed:false,unknown:'keep'}}};
 const next=M.upsertCustomer(state,'Acme',{name:'Acme',previewFollowed:'true'});
 assert.equal(next.customers.Acme.previewFollowed,true);
 assert.equal(M.buildCustomers(next)[0].followed,true);
 assert.equal(state.customers.Acme.previewFollowed,false);
 assert.equal(next.customers.Acme.unknown,'keep');
 const created=M.upsertCustomer({orders:[],customers:{}},'',{name:'Beta',country:'US',source:'Referral',previewFollowed:'true'});
 assert.equal(created.customers.Beta.previewFollowed,true);
 assert.throws(()=>M.upsertCustomer(state,'Acme',{name:'Acme',previewFollowed:'yes'}),/关注状态/);
});
test('customer profile update time stays distinct from the order date used for recent sorting',()=>{
 const state={customers:{
  Profile:{updated:'2026-09-10T09:00:00Z'},
  OrderBacked:{country:'美国'},
 },orders:[{id:'o1',client:'OrderBacked',amount:10,stage:'done',createdAt:'2026-09-20T12:00:00Z'}]};
 const rows=M.buildCustomers(state);
 const byName=new Map(rows.map(row=>[row.name,row]));
 assert.equal(byName.get('Profile').updated,'2026-09-10T09:00:00Z');
 assert.equal(byName.get('OrderBacked').updated,'');
 assert.equal(byName.get('OrderBacked').sortUpdated,'2026-09-20T12:00:00Z');
 assert.deepEqual(M.filterCustomers(rows,{sort:'recent'}).map(row=>row.name),['OrderBacked','Profile']);
 assert.equal(state.customers.OrderBacked.updated,undefined);
});
test('contact count reflects the available primary and additional contact cards',()=>{
 const state={customers:{
  Empty:{},
  BlankSlot:{contacts:[''],emails:[''],phones:[''],addresses:['']},
  UnnamedSecond:{contacts:[''],emails:['','second@example.test'],phones:['','222'],addresses:['','Berlin']},
  EmailOnly:{email:'sales@example.test'},
  Named:{contacts:['Main','Second'],extraContacts:[{contact:'Second'}]},
  ExtraOnly:{extraContacts:[{contact:'Second'}]},
 },orders:[]};
 const rows=new Map(M.buildCustomers(state).map(row=>[row.name,row]));
 assert.equal(rows.get('Empty').contactCount,0);
 assert.equal(rows.get('BlankSlot').contactCount,0);
 assert.equal(rows.get('UnnamedSecond').contactCount,2);
 assert.equal(rows.get('EmailOnly').contactCount,1);
 assert.equal(rows.get('Named').contactCount,2);
 assert.equal(rows.get('ExtraOnly').contactCount,2);
});
test('TOS customer notes do not become a contact note when building customer rows',()=>{
 const state={customers:{Acme:{note:'Customer preference',permanentNote:'Every order: plain packaging'}},orders:[]};
 const row=M.buildCustomers(state)[0];
 assert.equal(row.contactNote,'');
 assert.equal(row.note,'Customer preference');
 assert.equal(row.permanentNote,'Every order: plain packaging');
});
test('editing a contact note preserves both TOS customer notes',()=>{
 const state={customers:{Acme:{note:'Customer preference',permanentNote:'Every order: plain packaging'}},orders:[]};
 const next=M.upsertCustomer(state,'Acme',{name:'Acme',contactNote:'Ask for Maya'},'2026-09-23T09:00:00Z');
 assert.equal(next.customers.Acme.contactNote,'Ask for Maya');
 assert.equal(next.customers.Acme.note,'Customer preference');
 assert.equal(next.customers.Acme.permanentNote,'Every order: plain packaging');
});
test('TOS payment preferences remain customer fields when a contact is edited',()=>{
 const state={customers:{Acme:{paymentMethod:'PayPal',paymentEmail:'billing@example.test',currency:'EUR',repurchaseCycle:60}},orders:[]};
 const row=M.buildCustomers(state)[0];
 assert.equal(row.contactPaymentMethod,'');
 const next=M.upsertCustomer(state,'Acme',{name:'Acme',contactPaymentMethod:'Bank transfer'},'2026-09-23T09:00:00Z').customers.Acme;
 assert.equal(next.contactPaymentMethod,'Bank transfer');
 assert.equal(next.paymentMethod,'PayPal');
 assert.equal(next.paymentEmail,'billing@example.test');
 assert.equal(next.currency,'EUR');
 assert.equal(next.repurchaseCycle,60);
});
test('customer payment preferences can be edited without changing contact payment preference',()=>{
 const state={customers:{Acme:{contactPaymentMethod:'Cash'}},orders:[]};
 const next=M.upsertCustomer(state,'Acme',{name:'Acme',paymentMethod:'PayPal',paymentEmail:'billing@example.test',currency:'GBP',repurchaseCycle:'90'},'2026-09-23T09:00:00Z').customers.Acme;
 assert.equal(next.paymentMethod,'PayPal');
 assert.equal(next.paymentEmail,'billing@example.test');
 assert.equal(next.currency,'GBP');
 assert.equal(next.repurchaseCycle,90);
 assert.equal(next.contactPaymentMethod,'Cash');
});
test('legacy extra-contact payment method migrates only when that contact is saved',()=>{
 const state={customers:{Acme:{paymentMethod:'PayPal',extraContacts:[{id:'second',paymentMethod:'Bank transfer',contact:'Second'}]}},orders:[]};
 const next=M.upsertCustomer(state,'Acme',{name:'Acme',extraContacts:[{id:'second',contact:'Second',contactPaymentMethod:'Cash'}]}).customers.Acme;
 assert.equal(next.paymentMethod,'PayPal');
 assert.equal(next.extraContacts[0].contactPaymentMethod,'Cash');
 assert.equal(Object.hasOwn(next.extraContacts[0],'paymentMethod'),false);
 assert.equal(state.customers.Acme.extraContacts[0].paymentMethod,'Bank transfer');
});
test('additional phone and social methods remain attached to their own contact through edits',()=>{
 const state={orders:[],customers:{Acme:{contact:'Main',phone:'111',
   additionalPhones:[{id:'p1',phoneCountryCode:'+44',phone:'222',legacyFlag:'keep'}],
   extraContacts:[{id:'second',contact:'Second',phone:'333',additionalSocialAccounts:[{id:'s2',socialPlatform:'Facebook',socialAccount:'@second'}]}],
 }}};
 const next=M.upsertCustomer(state,'Acme',{name:'Acme',contact:'Main',phone:'111',
   additionalPhones:[{id:'p1',phoneCountryCode:'+49',phone:'444'}],
   additionalSocialAccounts:[{id:'s1',socialPlatform:'Instagram',socialAccount:'@main'}],
   extraContacts:[{id:'second',contact:'Second',phone:'333',additionalSocialAccounts:[{id:'s2',socialPlatform:'Facebook',socialAccount:'@second-new'}],additionalPhones:[{id:'p2',phoneCountryCode:'+1',phone:'555'}]}],
 },'2026-09-23T12:00:00Z');
 const profile=next.customers.Acme;
 assert.deepEqual(profile.additionalPhones,[{id:'p1',phoneCountryCode:'+49',phone:'444',legacyFlag:'keep'}]);
 assert.deepEqual(profile.additionalSocialAccounts,[{id:'s1',socialPlatform:'Instagram',socialAccount:'@main'}]);
 assert.deepEqual(profile.extraContacts[0].additionalPhones,[{id:'p2',phoneCountryCode:'+1',phone:'555'}]);
 assert.deepEqual(profile.extraContacts[0].additionalSocialAccounts,[{id:'s2',socialPlatform:'Facebook',socialAccount:'@second-new'}]);
 assert.deepEqual(state.customers.Acme.additionalPhones,[{id:'p1',phoneCountryCode:'+44',phone:'222',legacyFlag:'keep'}]);
 const removed=M.upsertCustomer(next,'Acme',{name:'Acme',additionalPhones:[],extraContacts:[{id:'second',contact:'Second',additionalPhones:[],additionalSocialAccounts:[]}]}).customers.Acme;
 assert.deepEqual(removed.additionalPhones,[]);
 assert.deepEqual(removed.extraContacts[0].additionalPhones,[]);
 assert.deepEqual(removed.extraContacts[0].additionalSocialAccounts,[]);
 assert.deepEqual(removed.additionalSocialAccounts,profile.additionalSocialAccounts);
});
test('invalid repurchase cycles cannot be saved to a customer',()=>{
 const state={customers:{Acme:{}},orders:[]};
 assert.throws(()=>M.upsertCustomer(state,'Acme',{name:'Acme',repurchaseCycle:'-10'}),/复购周期/);
 assert.throws(()=>M.upsertCustomer(state,'Acme',{name:'Acme',repurchaseCycle:'soon'}),/复购周期/);
});
test('accent-insensitive search combines country and owner filters',()=>{const rows=M.buildCustomers?.(source());const found=M.filterCustomers?.(rows,{query:'elodie',country:'法国',owner:'Cherry'});assert.equal(found?.length,1);assert.equal(M.filterCustomers(rows,{query:'elodie',country:'美国'}).length,0);});
test('country groups include only customers in the completed-customer branch',()=>{
 const rows=M.buildCustomers({customers:{'US buyer':{country:'美国'},'US prospect':{country:'美国'},'FR buyer':{country:'法国'},'DE prospect':{country:'德国'}},orders:[
  {id:'us',client:'US buyer',amount:20,currency:'USD',stage:'done'},
  {id:'fr',client:'FR buyer',amount:30,currency:'USD',stage:'done'},
 ]});
 assert.deepEqual(M.filterCustomers(rows,{group:'country:美国'}).map(row=>row.name),['US buyer']);
 assert.deepEqual(M.filterCustomers(rows,{group:'country:法国'}).map(row=>row.name),['FR buyer']);
 assert.deepEqual(M.filterCustomers(rows,{group:'country:德国'}).map(row=>row.name),[]);
});
test('missing exchange rates never count foreign units as USD',()=>{const rows=M.buildCustomers?.({customers:{},orders:[{client:'Euro',id:'e',amount:100,currency:'EUR',stage:'quote'}]});assert.equal(rows?.[0]?.total,null);assert.equal(rows[0].missingRates,1);});
test('missing exchange rates leave automatic customer grade unknown while preserving manual grade',()=>{
 const state={customers:{Auto:{},Reset:{level:'自动判断'},Manual:{level:'B级翡翠客户'}},orders:[
  {client:'Auto',amount:100,currency:'EUR'},
  {client:'Reset',amount:300,currency:'EUR'},
  {client:'Manual',amount:50,currency:'EUR'},
 ]};
 const byName=new Map(M.buildCustomers(state).map(row=>[row.name,row]));
 assert.equal(byName.get('Auto').displayLevel,'');
 assert.equal(byName.get('Reset').displayLevel,'');
 assert.equal(byName.get('Manual').displayLevel,'B级翡翠客户');
 assert.equal(state.customers.Reset.level,'自动判断');
});
test('pagination clamps page after filter shrinks results and handles empty results',()=>{const p=M.paginate?.([1,2,3],9,2);assert.deepEqual(p,{items:[3],page:2,pageCount:2,total:3});assert.deepEqual(M.paginate([],4,20),{items:[],page:1,pageCount:1,total:0});});
test('customer editing preserves undisplayed fields, extra contacts and orders, without mutating input',()=>{const s=source();const before=JSON.stringify(s);const next=M.upsertCustomer?.(s,'Élodie Martin',{name:'Elodie New',contact:'Elodie',email:'new@example.test',country:'法国'},'2026-09-21T00:00:00Z');assert.equal(next?.customers?.['Elodie New']?.customLegacy?.preserve,true);assert.deepEqual(next.customers['Elodie New'].contacts,['Elodie','Marie']);assert.equal(next.customers['Elodie New'].history[0].type,'operation');assert.equal(next.orders[0].client,'Elodie New');assert.equal(JSON.stringify(s),before);assert.equal(next.customers['Élodie Martin'],undefined);});
test('case-insensitive duplicates and blank names do not overwrite existing profiles',()=>{assert.throws(()=>M.upsertCustomer?.(source(),'',{name:'no orders'}),/已存在/);assert.throws(()=>M.upsertCustomer?.(source(),'',{name:'  '}),/名称/);});
test('followup prepends a quick-record event while preserving unknown properties',()=>{const s=source();const next=M.addFollowup?.(s,'Élodie Martin','确认规格','2026-10-01','2026-09-21T00:00:00Z');assert.equal(next?.customers?.['Élodie Martin']?.history?.[0]?.text,'确认规格');assert.equal(next.customers['Élodie Martin'].history[0].subtype,'quick');assert.equal(next.customers['Élodie Martin'].nextFollow,'2026-10-01');assert.equal(next.customers['Élodie Martin'].customLegacy.preserve,true);assert.equal(s.customers['Élodie Martin'].history,undefined);});
test('recycled customers cannot be edited or followed until they are restored',()=>{
 const L=require('../src/modules.js');
 const state={orders:[],customers:{Recycled:{laiBucket:'trash',contact:'Old',history:[]}}};
 const before=structuredClone(state);
 assert.throws(()=>M.upsertCustomer(state,'Recycled',{name:'Recycled',contact:'Changed'}),/恢复回收站客户/);
 assert.throws(()=>M.addFollowup(state,'Recycled','Called'),/恢复回收站客户/);
 assert.deepEqual(state,before);
 const restored=L.moveCustomers(state,['Recycled'],'restore');
 assert.equal(M.upsertCustomer(restored,'Recycled',{name:'Recycled',contact:'Changed'}).customers.Recycled.contact,'Changed');
 assert.equal(M.addFollowup(restored,'Recycled','Called').customers.Recycled.history[0].text,'Called');
});
test('dynamic HTML strings are escaped before rendering',()=>{assert.equal(M.escapeHtml?.('<img src=x onerror="x">&'), '&lt;img src=x onerror=&quot;x&quot;&gt;&amp;');});

test('followup explicitly clears a scheduled date while omission keeps it',()=>{
 const state={orders:[],customers:{Alpha:{nextFollow:'2026-09-22',history:[]}}};
 assert.equal(M.addFollowup(state,'Alpha','Customer called','').customers.Alpha.nextFollow,'');
 assert.equal(M.addFollowup(state,'Alpha','Customer called',undefined).customers.Alpha.nextFollow,'2026-09-22');
});
test('customer schedule sets or clears only the next follow date and flows into the calendar',()=>{
 const B=require('../src/business-model.js');
 const state={orders:[{id:'o1',client:'Alpha',createdAt:'2026-09-01'}],customers:{
  Alpha:{nextFollow:'2026-10-01',lastFollowup:'2026-09-20T10:00:00Z',history:[{type:'followup',text:'Called'}],unknown:{keep:true}},
  Beta:{nextFollow:'2026-10-03'},
 }};
 const before=structuredClone(state);
 const scheduled=M.setCustomerNextFollow(state,'Alpha','2026-11-05','2026-09-23T10:00:00Z');
 assert.deepEqual(state,before);
 assert.deepEqual(scheduled.orders,state.orders);
 assert.deepEqual(scheduled.customers.Beta,state.customers.Beta);
 assert.equal(scheduled.customers.Alpha.nextFollow,'2026-11-05');
 assert.equal(scheduled.customers.Alpha.lastFollowup,state.customers.Alpha.lastFollowup);
 assert.deepEqual(scheduled.customers.Alpha.unknown,{keep:true});
 assert.equal(scheduled.customers.Alpha.history[0].type,'operation');
 assert.deepEqual(B.calendarEvents(scheduled,'2026-11').filter(event=>event.kind==='followup').map(event=>event.customer),['Alpha']);
 const cleared=M.setCustomerNextFollow(scheduled,'Alpha','','2026-09-23T11:00:00Z');
 assert.equal(cleared.customers.Alpha.nextFollow,'');
 assert.equal(B.calendarEvents(cleared,'2026-11').filter(event=>event.kind==='followup').length,0);
 assert.equal(cleared.customers.Alpha.history[0].type,'operation');
});
test('customer schedule rejects impossible dates, missing or archived customers, and no-op changes',()=>{
 const state={orders:[],customers:{Alpha:{nextFollow:'2026-10-01'},Trash:{laiBucket:'trash'}}};
 for(const value of ['0000-01-01','2026-02-30','2026-13-01','2026/11/05','junk'])
  assert.throws(()=>M.setCustomerNextFollow(state,'Alpha',value),/日期无效/);
 assert.throws(()=>M.setCustomerNextFollow(state,'Unknown','2026-11-05'),/客户不存在/);
 assert.throws(()=>M.setCustomerNextFollow(state,'Trash','2026-11-05'),/回收站/);
 assert.throws(()=>M.setCustomerNextFollow({...state,trashCustomers:['Alpha']},'Alpha','2026-11-05'),/回收站/);
 assert.throws(()=>M.setCustomerNextFollow(state,'Alpha','2026-10-01'),/无需更新/);
});
test('batch schedule sets only changed selected customers without creating completed followups',()=>{
 const time='2026-09-24T12:00:00Z';
 const state={orders:[],customers:{
  Alpha:{nextFollow:'2030-10-01',lastFollowup:'2026-01-01',history:[{type:'followup',text:'Old'}]},
  Beta:{nextFollow:'2030-11-01'},Gamma:{nextFollow:'2030-12-01'},
 }};
 const before=structuredClone(state);
 const next=M.batchSetCustomerNextFollow(state,['Alpha','Beta','Beta'],'2030-10-01',time);
 assert.deepEqual(next.customers.Alpha,before.customers.Alpha);
 assert.equal(next.customers.Beta.nextFollow,'2030-10-01');
 assert.equal(next.customers.Beta.updated,time);
 assert.deepEqual(next.customers.Beta.history.map(item=>item.type),['operation']);
 assert.equal(next.customers.Beta.lastFollowup,undefined);
 assert.deepEqual(next.customers.Gamma,before.customers.Gamma);
 assert.deepEqual(state,before);
});
test('batch schedule validates all selected customers and date before changing any record',()=>{
 const state={orders:[],customers:{Alpha:{},Beta:{laiBucket:'pool'},Recycled:{laiBucket:'trash'}}};
 const before=structuredClone(state);
 assert.throws(()=>M.batchSetCustomerNextFollow(state,[],'2030-10-01'),/选择客户/);
 assert.throws(()=>M.batchSetCustomerNextFollow(state,['Alpha','Missing'],'2030-10-01'),/不存在/);
 assert.throws(()=>M.batchSetCustomerNextFollow(state,['Alpha','Beta'],'2030-10-01'),/私海客户/);
 assert.throws(()=>M.batchSetCustomerNextFollow(state,['Alpha','Recycled'],'2030-10-01'),/私海客户/);
 assert.throws(()=>M.batchSetCustomerNextFollow(state,['Alpha'],''),/日期/);
 assert.throws(()=>M.batchSetCustomerNextFollow(state,['Alpha'],'2030-02-30'),/日期无效/);
 const scheduled=M.batchSetCustomerNextFollow(state,['Alpha'],'2030-10-01');
 assert.throws(()=>M.batchSetCustomerNextFollow(scheduled,['Alpha'],'2030-10-01'),/无需更新/);
 assert.deepEqual(state,before);
});
test('batch followup writes only selected customers and preserves existing due dates when omitted',()=>{
 const state={orders:[{client:'Alpha',amount:25,currency:'USD'}],customers:{
  Alpha:{nextFollow:'2026-10-01',history:[{time:'2026-09-01',text:'Earlier'}],custom:{keep:1}},
  Beta:{nextFollow:'2026-10-02'},Gamma:{nextFollow:'2026-10-03'},
 }};
 const before=structuredClone(state);
 const next=M.batchAddFollowup(state,['Alpha','Beta','Alpha'],'  Called about samples  ',undefined,'2026-09-23T10:00:00Z');
 assert.deepEqual(state,before);
 assert.deepEqual(next.orders,state.orders);
 assert.equal(next.customers.Alpha.history.length,2);
 for(const name of ['Alpha','Beta']){
  const profile=next.customers[name];
  assert.equal(profile.history[0].text,'Called about samples');
  assert.equal(profile.history[0].type,'followup');
  assert.equal(profile.history[0].subtype,'quick');
  assert.equal(profile.lastFollowup,'2026-09-23T10:00:00Z');
  assert.equal(profile.nextFollow,state.customers[name].nextFollow);
 }
 assert.deepEqual(next.customers.Gamma,state.customers.Gamma);
 assert.deepEqual(next.customers.Alpha.custom,{keep:1});
 const scheduled=M.batchAddFollowup(next,['Beta'],'Sent quote','2026-10-12','2026-09-23T11:00:00Z');
 assert.equal(scheduled.customers.Beta.nextFollow,'2026-10-12');
 assert.equal(scheduled.customers.Alpha.nextFollow,'2026-10-01');
});
test('batch followup rejects empty text, stale targets and invalid dates without mutating state',()=>{
 const state={orders:[],customers:{Alpha:{nextFollow:'2026-10-01'}}};
 const before=structuredClone(state);
 assert.throws(()=>M.batchAddFollowup(state,[],'Note'),/选择客户/);
 assert.throws(()=>M.batchAddFollowup(state,['Alpha'],'   '),/跟进内容/);
 assert.throws(()=>M.batchAddFollowup(state,['Alpha','Missing'],'Note'),/不存在/);
 assert.throws(()=>M.batchAddFollowup(state,['Alpha'],'Note','2026-02-31'),/日期/);
 assert.deepEqual(state,before);
});
test('batch owner assignment preserves orders and records previous effective owners',()=>{
 const state={customers:{Alpha:{owner:'Alice',custom:{keep:1}},Gamma:{owner:'Carol'}},orders:[
  {id:'o1',client:'Beta',owner:'Bob',amount:25,currency:'USD'},
 ]};
 const before=structuredClone(state),time='2026-09-23T12:00:00Z';
 const assigned=M.batchSetOwner(state,['Alpha','Beta','Alpha'],'Maya',time);
 assert.deepEqual(state,before);
 assert.deepEqual(assigned.orders,state.orders);
 assert.deepEqual(assigned.customers.Gamma,state.customers.Gamma);
 for(const [name,previous] of [['Alpha','Alice'],['Beta','Bob']]){
  const profile=assigned.customers[name];
  assert.equal(profile.owner,'Maya');
  assert.equal(profile.previousOwner,previous);
  assert.equal(profile.ownerUpdatedAt,time);
  assert.equal(profile.updated,time);
  assert.equal(profile.history[0].type,'operation');
 }
 assert.deepEqual(assigned.customers.Alpha.custom,{keep:1});
 assert.deepEqual(M.buildCustomers(assigned).map(row=>[row.name,row.owner]),[['Alpha','Maya'],['Gamma','Carol'],['Beta','Maya']]);
 const cleared=M.batchSetOwner(assigned,['Beta'],'','2026-09-23T13:00:00Z');
 assert.equal(cleared.customers.Beta.owner,'');
 assert.equal(cleared.customers.Beta.previousOwner,'Maya');
 assert.equal(M.buildCustomers(cleared).find(row=>row.name==='Beta').owner,'');
 assert.equal(cleared.orders[0].owner,'Bob');
});
test('owner changes skip unchanged customers and reject stale or non-active targets',()=>{
 const state={customers:{Alpha:{owner:'Alice'},Beta:{owner:'Bob'},Pool:{laiBucket:'pool',owner:''}},orders:[]};
 const before=structuredClone(state);
 const mixed=M.batchSetOwner(state,['Alpha','Beta'],'Alice','2026-09-23T12:00:00Z');
 assert.deepEqual(mixed.customers.Alpha,state.customers.Alpha);
 assert.equal(mixed.customers.Beta.previousOwner,'Bob');
 assert.throws(()=>M.batchSetOwner(state,[],'Maya'),/选择客户/);
 assert.throws(()=>M.batchSetOwner(state,['Missing'],'Maya'),/不存在/);
 assert.throws(()=>M.batchSetOwner(state,['Pool'],'Maya'),/私海/);
 assert.throws(()=>M.batchSetOwner(state,['Alpha'],'Alice'),/无需更新/);
 assert.deepEqual(state,before);
});
test('editing an owner updates the same previous-owner and owner-time fields',()=>{
 const state={customers:{Alpha:{owner:'Alice',previousOwner:'Old'}},orders:[]};
 const changed=M.upsertCustomer(state,'Alpha',{name:'Alpha',owner:'Maya'},'2026-09-23T12:00:00Z').customers.Alpha;
 assert.equal(changed.previousOwner,'Alice');
 assert.equal(changed.ownerUpdatedAt,'2026-09-23T12:00:00Z');
 const unchanged=M.upsertCustomer(state,'Alpha',{name:'Alpha',owner:'Alice'},'2026-09-23T12:00:00Z').customers.Alpha;
 assert.equal(unchanged.previousOwner,'Old');
 assert.equal(unchanged.ownerUpdatedAt,undefined);
});
test('reserved dictionary key cannot silently disappear as a customer',()=>{
 assert.throws(()=>M.upsertCustomer({orders:[],customers:{}},'',{name:'__proto__'}),/保留名称/);
});

test('reference customer fields and aligned additional contacts survive editing without losing metadata',()=>{
 const state={orders:[],customers:{Acme:{client:'Acme',contacts:['Main','Other'],emails:['','other@example.test'],phones:['1','2'],unknown:9,extraContacts:[{id:'c2',contact:'Other',hidden:'keep'}]}}};
 const result=M.upsertCustomer(state,'Acme',{name:'Acme',country:'US',contact:'Main',email:'',phone:'1',customerStars:'4',companyProducts:'custom',cardStock:'card',customBox:'box',customerCode:'C20',extraContacts:[{id:'c2',contact:'Other',email:'other@example.test',phone:'2',birthday:'2000-01-01'}]});
 assert.equal(result.customers.Acme.customerStars,'4');assert.equal(result.customers.Acme.companyProducts,'custom');assert.equal(result.customers.Acme.customerCode,'C20');assert.deepEqual(result.customers.Acme.emails,['','other@example.test']);assert.equal(result.customers.Acme.extraContacts[0].hidden,'keep');assert.equal(result.customers.Acme.unknown,9);assert.equal(state.customers.Acme.extraContacts[0].birthday,undefined);
});
test('clearing primary contact fields does not promote values from the second contact',()=>{
 const state={orders:[],customers:{Acme:{
  contact:'Main',contacts:['Main','Other'],email:'main@example.test',emails:['main@example.test','other@example.test'],
  phone:'111',phones:['111','222'],address:'Main address',addresses:['Main address','Other address'],
 }}};
 const next=M.upsertCustomer(state,'Acme',{name:'Acme',contact:'',email:'',phone:'',address:''});
 const profile=next.customers.Acme;
 for(const field of ['contact','email','phone','address'])assert.equal(profile[field],'');
 assert.deepEqual(profile.contacts,['','Other']);
 assert.deepEqual(profile.emails,['','other@example.test']);
 assert.deepEqual(profile.phones,['','222']);
 assert.deepEqual(profile.addresses,['','Other address']);
 const row=M.buildCustomers(next)[0];
 for(const field of ['contact','email','phone','address'])assert.equal(row[field],'');
 assert.equal(state.customers.Acme.email,'main@example.test');
});

test('an explicit empty primary array slot does not revive stale single contact values',()=>{
 const state={orders:[],customers:{Acme:{contact:'Stale name',contacts:[''],
  email:'stale@example.test',emails:[''],phone:'999',phones:[''],address:'Stale address',addresses:['']}}};
 const row=M.buildCustomers(state)[0];
 assert.equal(row.contact,'');
 assert.equal(row.email,'');
 assert.equal(row.phone,'');
 assert.equal(row.address,'');
});
test('editing only additional contacts preserves explicitly cleared primary slots',()=>{
 const state={orders:[],customers:{Acme:{contact:'Stale name',contacts:['','Second'],
  email:'stale@example.test',emails:['','second@example.test'],phone:'999',phones:['','222'],
  address:'Stale address',addresses:['','Second address'],extraContacts:[{id:'second',contact:'Second',email:'second@example.test',phone:'222',address:'Second address'}]}}};
 const before=structuredClone(state);
 const next=M.upsertCustomer(state,'Acme',{name:'Acme',extraContacts:[{id:'second',contact:'Second Updated',email:'second@example.test',phone:'222',address:'Second address'}]}).customers.Acme;
 for(const key of ['contact','email','phone','address'])assert.equal(next[key],'',key);
 for(const key of ['contacts','emails','phones','addresses'])assert.equal(next[key][0],'',key);
 assert.equal(next.extraContacts[0].id,'second');
 assert.equal(next.extraContacts[0].contact,'Second Updated');
 assert.deepEqual([next.contacts[1],next.emails[1],next.phones[1],next.addresses[1]],
  ['Second Updated','second@example.test','222','Second address']);
 assert.deepEqual(state,before);
});

test('new customer keeps its creation time and followup dates populate the customer list',()=>{
 const created=M.upsertCustomer({customers:{},orders:[]},'',{name:'Acme',country:'US',source:'Referral',contact:'Main',alternateEmail:'backup@example.test',contactNote:'Primary note'},'2026-09-21T09:00:00Z');
 const followed=M.addFollowup(created,'Acme','Confirmed samples','2026-10-01','2026-09-23T10:00:00Z');
 const row=S.enrich(M.buildCustomers(followed),followed)[0];
 assert.equal(row.createdAt,'2026-09-21T09:00:00Z');
 assert.equal(row.lastFollowup,'2026-09-23T10:00:00Z');
 assert.equal(row.lastWrittenFollowup,'2026-09-23T10:00:00Z');
 assert.equal(row.latestActivity,'Confirmed samples');
 assert.equal(row.alternativeEmail,'backup@example.test');
 assert.equal(row.contactNote,'Primary note');
 const edited=M.upsertCustomer(followed,'Acme',{name:'Acme',contact:'Main'},'2026-09-24T11:00:00Z');
 assert.equal(edited.customers.Acme.createdAt,'2026-09-21T09:00:00Z');
});

test('batch tags add and remove only selected customer tags while preserving profiles and orders',()=>{
 const state=source(), before=JSON.stringify(state), time='2026-09-23T12:00:00Z';
 const added=M.batchUpdateCustomerTags(state,['Élodie Martin','Order Only'],'睫毛, 复购, 复购','add',time);
 assert.deepEqual(added.customers['Élodie Martin'].tags,['睫毛','复购']);
 assert.deepEqual(added.customers['Order Only'].tags,['睫毛','复购']);
 assert.equal(added.customers['Élodie Martin'].customLegacy.preserve,true);
 assert.equal(added.customers['Élodie Martin'].owner,'Cherry');
 assert.deepEqual(added.customers['No Orders'],state.customers['No Orders']);
 assert.deepEqual(added.orders,state.orders);
 assert.equal(added.customers['Order Only'].client,'Order Only');
 assert.equal(added.customers['Order Only'].updated,time);
 assert.equal(added.customers['Order Only'].history[0].type,'operation');
 assert.equal(JSON.stringify(state),before);
 const removed=M.batchUpdateCustomerTags(added,['Élodie Martin','Order Only'],'睫毛','remove',time);
 assert.deepEqual(removed.customers['Élodie Martin'].tags,['复购']);
 assert.deepEqual(removed.customers['Order Only'].tags,['复购']);
 assert.deepEqual(added.customers['Élodie Martin'].tags,['睫毛','复购']);
});

test('batch tags rejects empty, stale and no-op selections before saving',()=>{
 const state=source();
 assert.throws(()=>M.batchUpdateCustomerTags(state,[],'复购','add'),/选择客户/);
 assert.throws(()=>M.batchUpdateCustomerTags(state,['Missing'],'复购','add'),/客户不存在/);
 assert.throws(()=>M.batchUpdateCustomerTags(state,['No Orders'],' ','add'),/标签/);
 assert.throws(()=>M.batchUpdateCustomerTags(state,['Élodie Martin'],'睫毛','add'),/无需更新/);
 assert.throws(()=>M.batchUpdateCustomerTags(state,['Élodie Martin'],'不存在','remove'),/无需更新/);
});

test('batch field editing updates only selected customer profiles and keeps their orders',()=>{
 const state={customers:{Alpha:{source:'展会',owner:'Alice',custom:{keep:1}},Beta:{source:'网站'},Unselected:{source:'展会'},Pool:{laiBucket:'pool'}},orders:[{id:'o1',client:'Order Only',amount:25,currency:'USD',source:'旧来源'}]};
 const before=structuredClone(state),time='2026-09-23T12:00:00Z';
 const next=M.batchEditCustomerField(state,['Alpha','Order Only','Alpha'],'source','新渠道',false,time);
 assert.equal(next.customers.Alpha.source,'新渠道');
 assert.equal(next.customers['Order Only'].source,'新渠道');
 assert.deepEqual(next.customers.Alpha.custom,{keep:1});
 assert.deepEqual(next.customers.Beta,state.customers.Beta);
 assert.deepEqual(next.customers.Unselected,state.customers.Unselected);
 assert.deepEqual(next.orders,state.orders);
 assert.equal(next.customers.Alpha.updated,time);
 assert.equal(next.customers.Alpha.history[0].type,'operation');
 assert.equal(M.buildCustomers(next).find(row=>row.name==='Order Only').source,'新渠道');
 assert.deepEqual(state,before);
 const cleared=M.batchEditCustomerField(next,['Alpha'],'source','',true,'2026-09-23T13:00:00Z');
 assert.equal(cleared.customers.Alpha.source,'');
 assert.equal(cleared.customers['Order Only'].source,'新渠道');
});

test('batch field editing validates the selected field, value and private customer scope',()=>{
 const state={customers:{Alpha:{customerStage:'已成交',level:'B级翡翠客户',customerStars:'3'},Pool:{laiBucket:'pool'}},orders:[]};
 const time='2026-09-23T12:00:00Z',before=structuredClone(state);
 const staged=M.batchEditCustomerField(state,['Alpha'],'customerStage','重点跟进',false,time);
 assert.equal(M.buildCustomers(staged)[0].stage,'重点跟进');
 const leveled=M.batchEditCustomerField(staged,['Alpha'],'level','自动判断',false,time);
 assert.equal(leveled.customers.Alpha.level,'自动判断');
 const starred=M.batchEditCustomerField(leveled,['Alpha'],'customerStars','5',false,time);
 assert.equal(starred.customers.Alpha.customerStars,'5');
 assert.throws(()=>M.batchEditCustomerField(state,[],'source','网站'),/选择客户/);
 assert.throws(()=>M.batchEditCustomerField(state,['Missing'],'source','网站'),/不存在/);
 assert.throws(()=>M.batchEditCustomerField(state,['Pool'],'source','网站'),/私海/);
 assert.throws(()=>M.batchEditCustomerField(state,['Alpha'],'owner','Maya'),/不可批量编辑/);
 assert.throws(()=>M.batchEditCustomerField(state,['Alpha'],'customerStars','6'),/星级/);
 assert.throws(()=>M.batchEditCustomerField(state,['Alpha'],'level','Z级'),/等级/);
 assert.throws(()=>M.batchEditCustomerField(state,['Alpha'],'source','   '),/字段值/);
  assert.throws(()=>M.batchEditCustomerField(state,['Alpha'],'customerStage','已成交'),/无需更新/);
  assert.throws(()=>M.batchEditCustomerField({customers:{OrderOnly:{}},orders:[{client:'OrderOnly',amount:10,currency:'USD',stage:'done'}]},['OrderOnly'],'customerStage','',true),/无需更新/);
  const reverted=M.batchEditCustomerField({customers:{OrderOnly:{customerStage:'重点跟进'}},orders:[{client:'OrderOnly',amount:10,currency:'USD',stage:'done'}]},['OrderOnly'],'customerStage','',true,time);
  assert.equal(M.buildCustomers(reverted)[0].stage,'已成交');
 assert.deepEqual(state,before);
});

test('a mail is recorded once in the customer activity as 往来邮件 without touching follow-up dates',()=>{
 const s=source();s.customers['Élodie Martin'].nextFollow='2026-10-20';s.customers['Élodie Martin'].lastFollowup='2026-09-01T00:00:00Z';
 const mail={box:'inbox',uid:7,messageId:'<m-7@x.example>',subject:'  Re:\n Quotation ',snippet:'The price   works for us.',date:'2026-10-05T14:20:00Z',from:{name:'Élodie',address:'sales@example.test'},to:[{name:'',address:'me@x.example'}],password:'nope'};
 assert.equal(M.mailRecorded(s,'Élodie Martin',mail),false);
 const next=M.addMailActivity(s,'Élodie Martin',mail,'2026-10-07T01:00:00Z');
 const profile=next.customers['Élodie Martin'];
 assert.deepEqual(profile.history[0],{time:'2026-10-05T14:20:00.000Z',text:'收到邮件：Re: Quotation\nThe price works for us.',type:'email',subtype:'received',channel:'邮件',contact:'Élodie',mailRef:{messageId:'<m-7@x.example>',box:'inbox',uid:7}});
 assert.equal(profile.updated,'2026-10-07T01:00:00Z');assert.equal(profile.nextFollow,'2026-10-20');assert.equal(profile.lastFollowup,'2026-09-01T00:00:00Z');assert.equal(profile.customLegacy.preserve,true);
 assert.equal(s.customers['Élodie Martin'].history,undefined,'the input state is not changed');
 assert.equal(M.mailRecorded(next,'Élodie Martin',mail),true);assert.equal(M.mailRecorded(next,'Élodie Martin',{box:'sent',uid:99,messageId:'<m-7@x.example>'}),true,'the same message is recognised wherever it is opened from');
 assert.equal(M.mailRecorded(next,'No Orders',mail),false);assert.equal(M.mailRecorded(next,'__proto__',mail),false);assert.equal(M.mailRecorded(next,'Élodie Martin',{}),false);
 assert.throws(()=>M.addMailActivity(next,'Élodie Martin',mail),/已经记在客户动态里/);
 const afterSent=M.addMailActivity(next,'Élodie Martin',{box:'sent',uid:3,subject:'',date:'not a date',to:[{name:'',address:'sales@example.test'}]},'2026-10-07T02:00:00Z');
 const sent=afterSent.customers['Élodie Martin'].history[0];
 assert.deepEqual(sent,{time:'2026-10-07T02:00:00Z',text:'发出邮件：（无主题）',type:'email',subtype:'sent',channel:'邮件',contact:'sales@example.test',mailRef:{messageId:'',box:'sent',uid:3}});
 assert.throws(()=>M.addMailActivity(afterSent,'Élodie Martin',{box:'sent',uid:3}),/已经记在客户动态里/,'without a Message-ID the folder and number identify the mail');
 assert.throws(()=>M.addMailActivity(s,'Nobody',mail),/客户不存在/);assert.throws(()=>M.addMailActivity(s,'Élodie Martin',{}),/缺少邮件信息/);assert.throws(()=>M.addMailActivity(s,'Élodie Martin',null),/缺少邮件信息/);
 assert.throws(()=>M.addMailActivity({orders:[],customers:{Bin:{laiBucket:'trash'}}},'Bin',mail),/恢复回收站客户/);
});
