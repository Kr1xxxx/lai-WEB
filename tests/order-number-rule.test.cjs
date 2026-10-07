'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const B=require('../src/business-model.js');
const DAY='2026-10-07',DEFAULT={prefix:'L',dateFormat:'YYYYMMDD',sequenceDigits:3};
const configured=(rule,extra={})=>({orders:[],trashOrders:[],deletedOrders:[],laiSettings:{orderNumberRule:{...DEFAULT,...rule}},...extra});
test('default rule keeps existing format and preview does not reserve a number',()=>{
 const state={orders:[]},before=structuredClone(state);assert.deepEqual(B.orderNumberRule(state),DEFAULT);assert.equal(B.orderNumberPreview(DEFAULT,DAY),'L20261007-001');assert.equal(B.nextOrderNumber(state,DAY),'L20261007-001');assert.equal(B.nextOrderNumber(state,DAY),'L20261007-001');assert.deepEqual(state,before);
});
test('legacy prefix inheritance is per field even when laiSettings exists for other settings',()=>{
 const state={laiSettings:{favoriteNav:['route:order-list']},orderSettings:{orderPrefix:'Old'}};assert.equal(B.orderNumberRule(state).prefix,'Old');assert.equal(B.nextOrderNumber(state,DAY),'Old20261007-001');assert.equal(B.orderNumberRule({...state,laiSettings:{orderPrefix:'New'}}).prefix,'New');assert.equal(B.orderNumberRule({...state,laiSettings:{orderPrefix:'',orderNumberRule:{dateFormat:'YYYY'}}}).prefix,'Old');
});
test('saving a rule preserves unrelated settings and historical orders without changing input',()=>{
 const state=configured({custom:{retain:true}},{orderSettings:{orderPrefix:'Old',custom:'safe'},orders:[{id:'old',num:'OLD-0001',metadata:{keep:true}}]});state.laiSettings.favoriteNav=['route:order-list'];state.laiSettings.defaultCurrency='EUR';const before=structuredClone(state);
 const next=B.setOrderNumberRule(state,{prefix:' So ',dateFormat:'YYYYMM',sequenceDigits:'4',untrusted:'discard'});assert.deepEqual(B.orderNumberRule(next),{prefix:'So',dateFormat:'YYYYMM',sequenceDigits:4});assert.deepEqual(next.laiSettings.orderNumberRule.custom,{retain:true});assert.equal(next.laiSettings.orderNumberRule.untrusted,undefined);assert.deepEqual(next.laiSettings.favoriteNav,before.laiSettings.favoriteNav);assert.equal(next.laiSettings.defaultCurrency,'EUR');assert.deepEqual(next.orders,before.orders);assert.deepEqual(next.orderSettings,before.orderSettings);assert.deepEqual(state,before);
});
for(const [dateFormat,result] of [['YYYYMMDD','L20261007-001'],['YYYYMM','L202610-001'],['YYYY','L2026-001'],['none','L-001']])test(`date format ${dateFormat} renders the specified group`,()=>{assert.equal(B.nextOrderNumber(configured({dateFormat}),DAY),result);});
test('sequence advances from the maximum across all buckets including drafts and variant padding',()=>{
 const state=configured({},{orders:[{num:'l20261007-001'},{num:' L20261007-003 ',isDraft:true}],trashOrders:[{num:'l20261007-000009'}],deletedOrders:[{num:'L20261007-005'}]});assert.equal(B.nextOrderNumber(state,DAY),'L20261007-010');assert.equal(B.nextOrderNumber(B.setOrderNumberRule(state,{...DEFAULT,sequenceDigits:6}),DAY),'L20261007-000010');
});
test('only complete matching numeric suffixes contribute and prefix/date groups remain independent',()=>{
 const state=configured({prefix:'SO-'},{orders:[{num:'SO-20261007-004'},{num:'SO-20261006-999'},{num:'SO20261007-888'},{num:'SO-20261007-25-tail'},{num:'XSO-20261007-500'},{num:'SO-20261007-1e6'}]});assert.equal(B.nextOrderNumber(state,DAY),'SO-20261007-005');assert.equal(B.nextOrderNumber(state,'2026-10-08'),'SO-20261008-001');
});
test('day month year and undated groups reset only when their visible date grouping changes',()=>{
 for(const [format,number,today,next] of [['YYYYMMDD','L20261231-008','2027-01-01','L20270101-001'],['YYYYMM','L202610-008','2026-10-31','L202610-009'],['YYYYMM','L202610-008','2026-11-01','L202611-001'],['YYYY','L2026-008','2026-12-31','L2026-009'],['YYYY','L2026-008','2027-01-01','L2027-001'],['none','L-008','2027-01-01','L-009']])assert.equal(B.nextOrderNumber(configured({dateFormat:format},{orders:[{num:number}]}),today),next);
});
test('minimum width expands beyond its digits and is not a sequence namespace',()=>{assert.equal(B.nextOrderNumber(configured({},{orders:[{num:'L20261007-999'}]}),DAY),'L20261007-1000');assert.equal(B.orderNumberPreview({...DEFAULT,sequenceDigits:6},DAY,1000000),'L20261007-1000000');});
test('unsafe matching suffixes refuse generation instead of truncating or reusing a number',()=>{
 for(const value of ['9007199254740991','9007199254740992','999999999999999999999999999999'])assert.throws(()=>B.nextOrderNumber(configured({},{orders:[{num:'L20261007-'+value}]}),DAY),/序号.*(?:范围|核对|安全)/);
 assert.equal(B.nextOrderNumber(configured({},{orders:[{num:'L20261007-9007199254740990'}]}),DAY),'L20261007-9007199254740991');
});
test('invalid rule fields are rejected without silently replacing legacy values',()=>{
 for(const prefix of ['',null,false,[],{},'A B','客户','ABCDEFGHIJKLM'])assert.throws(()=>B.setOrderNumberRule({}, {...DEFAULT,prefix}),/前缀/);
 for(const dateFormat of ['',null,false,'YY','yyyyMMdd'])assert.throws(()=>B.orderNumberPreview({...DEFAULT,dateFormat},DAY),/日期格式/);
 for(const sequenceDigits of ['',null,true,2,7,3.5,'3.0','3e0'])assert.throws(()=>B.orderNumberPreview({...DEFAULT,sequenceDigits},DAY),/位数/);
 const state={orderSettings:{orderPrefix:'Old invalid'}};assert.equal(B.orderNumberRuleDraft(state).prefix,'Old invalid');assert.throws(()=>B.nextOrderNumber(state,DAY),/前缀/);
});
test('malformed stored rule is displayed raw and cannot generate until explicitly corrected',()=>{
 for(const raw of [null,[],true,'legacy unknown']){const state={laiSettings:{orderNumberRule:raw,defaultOwner:'Keep'}};assert.deepEqual(B.orderNumberRuleDraft(state),raw);assert.throws(()=>B.orderNumberRule(state),/规则/);assert.throws(()=>B.nextOrderNumber(state,DAY),/规则/);const next=B.setOrderNumberRule(state,DEFAULT);assert.equal(next.laiSettings.defaultOwner,'Keep');assert.deepEqual(B.orderNumberRule(next),DEFAULT);assert.deepEqual(state.laiSettings.orderNumberRule,raw);}
});
test('missing fields use explicit defaults while present invalid values remain visible',()=>{
 assert.deepEqual(B.orderNumberRule({laiSettings:{orderPrefix:'SO',orderNumberRule:{sequenceDigits:4}}}),{prefix:'SO',dateFormat:'YYYYMMDD',sequenceDigits:4});const s={laiSettings:{orderNumberRule:{prefix:'',dateFormat:'weird',sequenceDigits:2}}};assert.deepEqual(B.orderNumberRuleDraft(s),s.laiSettings.orderNumberRule);assert.throws(()=>B.orderNumberRule(s),/前缀/);
});
test('invalid generation days and preview sequences are rejected',()=>{
 for(const day of ['2026-02-30','2026-13-01','2026-10-07T00:00:00Z','garbage',''])assert.throws(()=>B.nextOrderNumber({},day),/日期/);
 for(const sequence of [0,-1,1.5,NaN,Infinity,true,'1'])assert.throws(()=>B.orderNumberPreview(DEFAULT,DAY,sequence),/序号/);
 assert.equal(B.orderNumberPreview(DEFAULT,'2028-02-29'),'L20280229-001');
});
test('local default day follows the system local calendar without changing historical numbers',t=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-12-31T23:59:59').getTime()});assert.equal(B.nextOrderNumber({orders:[]}),'L20261231-001');t.mock.timers.tick(1000);assert.equal(B.nextOrderNumber({orders:[]}),'L20270101-001');
});
test('manual duplicate check and archive restore rules remain in force with a saved rule',()=>{
 const state=configured({prefix:'SO'},{orders:[],trashOrders:[{id:'archive',num:'SO20261007-004',client:'Synthetic',amount:1}],customers:{Synthetic:{}}});assert.equal(B.nextOrderNumber(state,DAY),'SO20261007-005');assert.throws(()=>B.upsertOrder(state,'new',{num:' so20261007-004 ',client:'Synthetic',amount:1}),/订单号已存在/);const next=B.restoreOrder(state,'archive');assert.equal(next.orders[0].num,'SO20261007-004');
});
