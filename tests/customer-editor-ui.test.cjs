const test=require('node:test');
const assert=require('node:assert/strict');
const Editor=require('../src/customer-editor-ui.js');

test('backup email editor keeps cleared values and presents existing aliases consistently',()=>{
 for(const [profile,expected] of [[{alternateEmail:'',alternativeEmail:'stale@example.test'},''],[{alternativeEmail:'legacy@example.test'},'legacy@example.test'],[{backupEmail:'old@example.test'},'old@example.test']]){
  const html=Editor.render({name:'Acme',...profile},{state:{customers:{Acme:profile}}}).body;
  assert.ok(html.includes(`name="alternateEmail" type="text" value="${expected}"`));
 }
});

test('imported company and contact fields can be edited without replacing other contact data',()=>{
 const profile={name:'Acme',shortName:'ACE',landline:'001-222',companyAddress:'Paris',
  companyRemark:'Blue packaging',poolGroup:'Europe',contactTitle:'Buyer',contactGender:'女',
  extraContacts:[{id:'second',contact:'Ben',contactTitle:'Manager',contactGender:'男'}]};
 const html=Editor.render(profile,{state:{customers:{Acme:profile}}}).body;
 for(const [field,value] of [['shortName','ACE'],['landline','001-222'],['companyAddress','Paris'],
   ['companyRemark','Blue packaging'],['poolGroup','Europe'],['contactTitle','Buyer'],
   ['contactGender','女'],['contactTitleExtra','Manager'],['contactGenderExtra','男']])
  assert.match(html,new RegExp(`name="${field}"[^>]*value="${value}"`));
});

test('customer editor carries follow state as a saved-or-cancelled form draft',()=>{
 const followed=Editor.render({name:'Acme',followed:true},{state:{customers:{Acme:{previewFollowed:true}}}}).body;
 const plain=Editor.render({name:'Beta',followed:false},{state:{customers:{Beta:{}}}}).body;
 assert.match(followed,/<input type="hidden" name="previewFollowed" value="true">/);
 assert.match(plain,/<input type="hidden" name="previewFollowed" value="false">/);
});

test('customer code pencil edits the existing form draft without opening a placeholder feature',()=>{
 const html=Editor.render({name:'Acme',customerCode:'A&17'},{state:{customers:{Acme:{}}}}).body;
 assert.match(html,/<span data-customer-code-display>A&amp;17<\/span>/);
 assert.match(html,/data-editor-action="edit-customer-code"/);
 assert.match(html,/<input[^>]*name="customerCode"[^>]*value="A&amp;17"[^>]*hidden/);
 assert.doesNotMatch(html,/data-feature="客户编号规则"/);
});

test('new customer and newly added contacts validate the starred fields without blocking legacy edits',()=>{
 const fresh=Editor.render({}, {isNew:true,state:{customers:{}}}).body;
 for(const name of ['name','country','source','contact','email','phone'])
  assert.match(fresh,new RegExp(`<input[^>]*name="${name}"[^>]*required`));
 for(const name of ['contactExtra','emailExtra','phoneExtra'])
  assert.match(fresh,new RegExp(`<template data-contact-template>[\\s\\S]*?<input[^>]*name="${name}"[^>]*required`));
 const legacy=Editor.render({name:'Legacy',extraContacts:[{id:'old',contact:'Older'}]},
  {isNew:false,state:{customers:{Legacy:{}}}}).body;
 const existingCards=legacy.split('<template data-contact-template>')[0];
 for(const name of ['country','source','contact','email','phone','contactExtra','emailExtra','phoneExtra'])
  assert.doesNotMatch(existingCards,new RegExp(`<input[^>]*name="${name}"[^>]*required`));
 for(const name of ['contactExtra','emailExtra','phoneExtra'])
  assert.match(legacy,new RegExp(`<template data-contact-template>[\\s\\S]*?<input[^>]*name="${name}"[^>]*required`));
});

test('company editor follows the saved common and other field layout',()=>{
 const html=Editor.render({name:'Acme',website:'https://acme.test',tags:['VIP'],timezone:'UTC'},
  {state:{customers:{Acme:{}},previewCompanyDisplayLayout:{common:['tags','name','country','source'],other:['website','timezone']}}}).body;
 const common=html.match(/data-company-common>([\s\S]*?)<\/div>/)?.[1]||'';
 const other=html.match(/data-company-other>([\s\S]*?)<h3>来财交易偏好/)?.[1]||'';
 assert.match(common,/name="tags"/);
 assert.doesNotMatch(common,/name="website"/);
 assert.match(other,/name="website"/);
 assert.match(other,/name="timezone"/);
 assert.match(html,/data-action="company-display-settings"/);
});
test('company editor retains legacy optional values but honors an explicit clear',()=>{
 const state={customers:{Acme:{}}};
 const legacy=Editor.render({name:'Acme',mainProducts:'Legacy lashes',cardPaper:'Legacy card',["定制盒"]:'Legacy box'},{state}).body;
 for(const [field,value] of [['companyProducts','Legacy lashes'],['cardStock','Legacy card'],['customBox','Legacy box']])
  assert.match(legacy,new RegExp(`<select[^>]*name="${field}"[^>]*>[\\s\\S]*?<option value="${value}" selected>`));
 const cleared=Editor.render({name:'Acme',companyProducts:'',mainProducts:'Legacy lashes',cardStock:'',cardPaper:'Legacy card',customBox:'',["定制盒"]:'Legacy box'},{state}).body;
 for(const field of ['companyProducts','cardStock','customBox']){
  const control=cleared.match(new RegExp(`<select[^>]*name="${field}"[^>]*>([\\s\\S]*?)<\\/select>`))?.[1]||'';
  assert.match(control,/<option value="" selected>/);
  assert.doesNotMatch(control,/Legacy/);
 }
});

test('customer and contact notes occupy separate editor fields',()=>{
 const state={customers:{Acme:{}}};
 const html=Editor.render({name:'Acme',contact:'Main',note:'Customer preference',permanentNote:'Every order: plain packaging',contactNote:'Ask for Maya',extraContacts:[{id:'second',contact:'Second',contactNote:'Ask for Nina'}]},{state}).body;
 const company=html.match(/<section class="ce-company">([\s\S]*?)<\/section>/)?.[1]||'';
 const contact=html.match(/<section class="ce-contacts">([\s\S]*?)<\/section>/)?.[1]||'';
 assert.match(company,/<textarea[^>]*name="note"[^>]*>Customer preference<\/textarea>/);
 assert.match(company,/<textarea[^>]*name="permanentNote"[^>]*>Every order: plain packaging<\/textarea>/);
 assert.match(contact,/<textarea[^>]*name="contactNote"[^>]*>Ask for Maya<\/textarea>/);
 assert.match(html,/<textarea[^>]*name="contactNoteExtra"[^>]*>Ask for Nina<\/textarea>/);
 assert.doesNotMatch(contact,/Customer preference|Every order: plain packaging/);
});
test('TOS payment preferences belong to company options, separate from contact payment method',()=>{
 const state={customers:{Acme:{}}};
 const html=Editor.render({name:'Acme',paymentMethod:'PayPal',paymentEmail:'billing@example.test',currency:'EUR',repurchaseCycle:60,contactPaymentMethod:'Cash'},{state}).body;
 const company=html.match(/<section class="ce-company">([\s\S]*?)<\/section>/)?.[1]||'';
 const contact=html.match(/<section class="ce-contacts">([\s\S]*?)<\/section>/)?.[1]||'';
 assert.match(company,/<select[^>]*name="currency"[^>]*>[\s\S]*?<option value="EUR" selected>/);
 assert.match(company,/<input[^>]*name="paymentEmail"[^>]*value="billing@example\.test"/);
 assert.match(company,/<select[^>]*name="repurchaseCycle"[^>]*>[\s\S]*?<option value="60" selected>60 天<\/option>/);
 assert.match(company,/<select[^>]*name="paymentMethod"[^>]*>[\s\S]*?<option value="PayPal" selected>/);
 assert.match(contact,/<select[^>]*name="contactPaymentMethod"[^>]*>[\s\S]*?<option value="Cash" selected>/);
 assert.doesNotMatch(contact,/billing@example\.test/);
});

test('customer group editor selects the saved manual membership and excludes rule segments',()=>{
 const state={customers:{Alpha:{contact:'A'}},previewSegments:[
  {id:'manual',name:'VIP Buyers',kind:'manual',members:['Alpha']},
  {id:'rule',name:'Rule Customers',kind:'rules',members:[],rules:[]},
  {id:'archived',name:'Old Buyers',kind:'manual',members:['Alpha'],archived:true},
 ]};
 const html=Editor.render({name:'Alpha',group:['VIP Buyers']},{state}).body;
 assert.match(html,/<option value="VIP Buyers" selected>VIP Buyers<\/option>/);
 assert.match(html,/data-original-group="VIP Buyers"/);
  assert.doesNotMatch(html,/Rule Customers|Old Buyers/);
});
test('customer group editor keeps an unmatched legacy value visible until explicitly changed',()=>{
 const state={customers:{Alpha:{previewGroup:'Legacy'}},previewSegments:[{id:'manual',name:'VIP Buyers',kind:'manual',members:['Alpha']}]};
 const html=Editor.render({name:'Alpha',previewGroup:'Legacy',group:['Legacy','VIP Buyers']},{state}).body;
 assert.match(html,/<option value="Legacy" selected>Legacy<\/option>/);
 assert.match(html,/data-original-group="Legacy"/);
});
test('contact editor provides working per-contact method controls and restores saved rows',()=>{
 const html=Editor.render({name:'Acme',contact:'Main',
   additionalPhones:[{id:'p1',phoneCountryCode:'+44',phone:'222'}],
   additionalSocialAccounts:[{id:'s1',socialPlatform:'Instagram',socialAccount:'@main'}],
   extraContacts:[{id:'second',contact:'Second',additionalPhones:[{id:'p2',phoneCountryCode:'+49',phone:'333'}]}],
 },{state:{customers:{Acme:{}}}}).body;
 assert.match(html,/data-editor-action="add-method" data-method-type="social"/);
 assert.match(html,/data-editor-action="add-method" data-method-type="phone"/);
 assert.doesNotMatch(html,/data-feature="添加社交平台"|data-feature="添加联系电话"/);
 assert.match(html,/data-method-id="p1"[\s\S]*?value="222"/);
 assert.match(html,/data-method-id="s1"[\s\S]*?value="@main"/);
 assert.match(html,/data-method-id="p2"[\s\S]*?value="333"/);
});
test('secondary address-only array slot remains editable at its original contact index',()=>{
 const profile={name:'Acme',contacts:[''],emails:[''],phones:[''],addresses:['','Berlin']};
 const html=Editor.render(profile,{state:{customers:{Acme:profile}}}).body;
 const live=html.split('<template data-contact-template>')[0];
 const second=live.match(/<section class="ce-contact-card" data-contact-card="1">[\s\S]*?<\/section>/)?.[0]||'';
 assert.match(second,/name="contactIdExtra" value="legacy-1"/);
 assert.match(second,/name="addressExtra"[^>]*>Berlin<\/textarea>/);
});

test('a new customer starts with the settings default currency; an existing one keeps its stored currency',()=>{
 const selected=html=>(html.match(/<select id="ce-currency"[\s\S]*?<\/select>/)||[''])[0].match(/<option value="([^"]*)"[^>]*selected/)?.[1];
 const state=extra=>({customers:{},laiSettings:{defaultCurrency:'EUR'},...extra});
 assert.equal(selected(Editor.render({},{isNew:true,state:state()}).body),'EUR');
 assert.equal(selected(Editor.render({},{isNew:true,state:{customers:{},orderSettings:{defaultCurrency:'GBP'}}}).body),'GBP','falls back to the order settings');
 assert.equal(selected(Editor.render({},{isNew:true,state:{customers:{}}}).body),'USD','and then to USD');
 assert.equal(selected(Editor.render({name:'Acme',currency:'CNY'},{state:state()}).body),'CNY','a stored value is kept');
});
