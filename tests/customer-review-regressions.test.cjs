const test=require('node:test');
const assert=require('node:assert/strict');
const M=require('../src/model.js');

test('ID-less legacy contacts retain unshown metadata through editor draft IDs',()=>{
 const state={orders:[],customers:{Acme:{extraContacts:[{contact:'First',historicalReference:'first'},{contact:'Second',historicalReference:'second'}]}}};
 const after=M.upsertCustomer(state,'Acme',{name:'Acme',extraContacts:[{id:'legacy-2',contact:'Second'},{id:'new-contact',contact:'New'}]}).customers.Acme.extraContacts;
 assert.equal(after[0].historicalReference,'second');
 assert.equal(Object.hasOwn(after[1],'historicalReference'),false);
 assert.equal(state.customers.Acme.extraContacts[0].id,undefined);
});
test('ID-less legacy methods retain metadata after deletion and new insertion',()=>{
 const state={orders:[],customers:{Acme:{additionalPhones:[{phone:'111',historicalReference:'first'},{phone:'222',historicalReference:'second'}]}}};
 const after=M.upsertCustomer(state,'Acme',{name:'Acme',additionalPhones:[{id:'method-1',phone:'222'},{id:'new-method',phone:'333'}]}).customers.Acme.additionalPhones;
 assert.equal(after[0].historicalReference,'second');
 assert.equal(Object.hasOwn(after[1],'historicalReference'),false);
 assert.equal(state.customers.Acme.additionalPhones[1].id,undefined);
});
for(const value of ['', '   ', '\u3000\u3000'])for(const key of ['country','source'])test('new customer rejects blank '+key+' '+JSON.stringify(value),()=>{
 const state={orders:[],customers:{}};
 assert.throws(()=>M.upsertCustomer(state,'',{name:'New',country:'US',source:'Referral',[key]:value}),key==='country'?/国家地区/:/客户来源/);
 assert.deepEqual(state,{orders:[],customers:{}});
});
test('valid new company values are trimmed and old incomplete profiles remain editable',()=>{
 const initial={orders:[],customers:{Old:{}}};
 assert.equal(M.upsertCustomer(initial,'',{name:'New',country:' US ',source:' Referral '}).customers.New.source,'Referral');
 assert.equal(M.upsertCustomer(initial,'Old',{name:'Old',country:'',source:'',note:'Changed'}).customers.Old.note,'Changed');
});
const Editor=require('../src/customer-editor-ui.js');
for(const key of ['contacts','emails','phones','addresses'])test('array-only '+key+' tail gets unique identity and never inherits another contact metadata',()=>{
 const profile={name:'Hybrid',contact:'Main',extraContacts:[{id:'legacy-2',contact:'Structured',contactTitle:'Buyer',historicalReference:'STRUCTURED-ONLY'}],[key]:['Main','Structured','Array Only']};
 const state={orders:[],customers:{Hybrid:profile}};
 const live=Editor.render(profile,{state}).body.split('<template data-contact-template>')[0];
 const ids=[...live.matchAll(/name="contactIdExtra" value="([^"]+)"/g)].map(match=>match[1]);
 assert.equal(ids.length,2);
 assert.equal(new Set(ids).size,2);
 const next=M.upsertCustomer(state,'Hybrid',{name:'Hybrid',extraContacts:[{id:ids[0],contact:'Structured'},{id:ids[1],contact:'Array Only'}]}).customers.Hybrid;
 assert.equal(next.extraContacts[0].historicalReference,'STRUCTURED-ONLY');
 assert.equal(next.extraContacts[1].historicalReference,undefined);
 assert.equal(next.extraContacts[1].contactTitle,undefined);
 const deleted=M.upsertCustomer({orders:[],customers:{Hybrid:next}},'Hybrid',{name:'Hybrid',extraContacts:[{id:ids[1],contact:'Array Only'}]}).customers.Hybrid;
 assert.equal(deleted.extraContacts[0].historicalReference,undefined);
 assert.equal(profile.extraContacts.length,1);
});
