const test = require('node:test');
const assert = require('node:assert/strict');
const Editor = require('../src/customer-editor-ui.js');

function formHarness(records, { isNew = true } = {}) {
  const html = Editor.render({name:'Synthetic Co',...records[0],extraContacts:records.slice(1)},
    {isNew,state:{customers:{},orders:[]}}).body.split('<template data-contact-template>')[0];
  const markup = [...html.matchAll(/<section class="ce-contact-card"[^>]*>([\s\S]*?)<\/section>/g)].map(match=>match[1]);
  const cards = records.map((record,index)=>{
    const controls = {};
    for (const key of ['contact','email','alternateEmail','phone','socialAccount','alibabaId','phoneCountryCode','primaryContactMethod']) {
      const name = key + (index ? 'Extra' : '');
      const tag = markup[index].match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0] || '';
      controls[key] = {name,value:String(record[key]??''),required:/\srequired(?:\s|>)/.test(tag),type:/type="([^"]+)"/.exec(tag)?.[1]||'text',validationMessage:'',
        setCustomValidity(message){this.validationMessage=message;}};
    }
    const methods = kind => (record[kind==='phone'?'additionalPhones':'additionalSocialAccounts']||[]).map(item=>({
      querySelector:selector=>selector==='[data-method-value]'?{value:item[kind==='phone'?'phone':'socialAccount']||''}:null,
    }));
    return {controls,
      querySelector(selector){const names=[...selector.matchAll(/\[name=["']?([^\]"']+)["']?\]/g)].map(match=>match[1]);return Object.values(controls).find(control=>names.includes(control.name))||null;},
      querySelectorAll(selector){return methods(selector.includes('"phone"')?'phone':'social');},
    };
  });
  const paymentEmail={name:"paymentEmail",value:"",validationMessage:"",setCustomValidity(message){this.validationMessage=message;}};
  const listeners = new Map();
  const form = {dataset:{},querySelector:selector=>selector==='[name="paymentEmail"]'?paymentEmail:null,querySelectorAll:selector=>selector==='[data-contact-card]'?cards:[],
    addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);},
    reportValidity(){return !paymentEmail.validationMessage&&!cards.some(card=>Object.values(card.controls).some(control=>control.validationMessage||(control.required&&!control.value)));},
  };
  Editor.bind({querySelector:()=>form});
  const fire = (type,target=cards[0].controls.contact) => {
    const event={target,prevented:false,stopped:false,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;}};
    for(const listener of listeners.get(type)||[])listener(event);
    return event;
  };
  return {cards,paymentEmail,fire,form,valid:()=>form.reportValidity()};
}

test('new contacts require a name but do not require both email and telephone',()=>{
  const html=Editor.render({}, {isNew:true,state:{customers:{}}}).body;
  for(const suffix of ['', 'Extra']){
    const tag=name=>html.match(new RegExp(`<input[^>]*name="${name+suffix}"[^>]*>`))[0];
    assert.match(tag('contact'),/\srequired(?:\s|>)/);
    assert.doesNotMatch(tag('phone'),/\srequired(?:\s|>)/);
    assert.doesNotMatch(tag('email'),/\srequired(?:\s|>)/);
    assert.match(tag('email'),/type="email"/);
    assert.match(tag('alternateEmail'),/type="email"/);
  }
});

for(const [label,record] of [
  ['email',{email:'finance@example.test'}],
  ['phone',{phone:'+44 20 1234 5678'}],
  ['social account',{socialAccount:'@finance'}],
  ['Alibaba ID',{alibabaId:'finance-team'}],
  ['alternate email',{alternateEmail:'finance@example.test'}],
  ['additional phone',{additionalPhones:[{id:'p',phone:'+1 555 0123'}]}],
  ['additional social account',{additionalSocialAccounts:[{id:'s',socialAccount:'@finance'}]}],
]) test(`a named new contact can save with only ${label}`,()=>{
  const h=formHarness([{contact:'Finance',...record}]);
  assert.equal(h.valid(),true);
  assert.equal(h.fire('submit').prevented,false);
});

test('new contact with a name but no reachable address is blocked even if a channel or country code is selected',()=>{
  for(const record of [{},{phoneCountryCode:'+44'},{primaryContactMethod:'邮件'},{phone:'not a telephone'}]){
    const h=formHarness([{contact:'Finance',...record}]);
    assert.equal(h.valid(),false);
    assert.ok(h.cards[0].controls.contact.validationMessage);
    assert.equal(h.fire('submit').prevented,true);
  }
});

test('whitespace-only contact name is rejected even with a valid email',()=>{
  const h=formHarness([{contact:'  ',email:'finance@example.test'}]);
  assert.equal(h.valid(),false);
  assert.ok(h.cards[0].controls.contact.validationMessage);
});

test('a filled malformed email is rejected even when a valid phone is present',()=>{
  for(const key of ['email','alternateEmail']){
    const h=formHarness([{contact:'Finance',phone:'+1 555 0123',[key]:'not-an-email'}]);
    assert.ok(h.cards[0].controls[key].validationMessage);
    assert.equal(h.valid(),false);
    h.cards[0].controls[key].value='finance@example.test';
    h.fire('input',h.cards[0].controls[key]);
    assert.equal(h.valid(),true);
  }
});

test('each contact is checked independently and editing clears only the resolved error',()=>{
  const h=formHarness([{contact:'Main',email:'main@example.test'},{contact:'Finance'}]);
  assert.equal(h.cards[0].controls.contact.validationMessage,'');
  assert.ok(h.cards[1].controls.contact.validationMessage);
  h.cards[1].controls.phone.value='+1 555 0123';
  h.fire('input',h.cards[1].controls.phone);
  assert.equal(h.valid(),true);
  h.cards[0].controls.email.value='';
  h.fire('input',h.cards[0].controls.email);
  assert.ok(h.cards[0].controls.contact.validationMessage);
  assert.equal(h.cards[1].controls.contact.validationMessage,'');
});

test('legacy incomplete contacts remain editable and validation does not mutate their records',()=>{
  const record={contact:'',historicalProperty:{unknown:true},additionalPhones:[{id:'p',phone:'',legacyMetadata:42}]};
  const before=JSON.stringify(record);
  const h=formHarness([record],{isNew:false});
  assert.equal(h.valid(),true);
  assert.equal(h.fire('submit').prevented,false);
  assert.equal(JSON.stringify(record),before);
});

test('pasted mailto links become mailbox values before native email validation for every contact',()=>{
  const h=formHarness([{contact:'Main',email:'main@example.test'},{contact:'Second',email:'second@example.test'}]);
  for(const card of h.cards){
    card.controls.email.value='mailto:hello%2Bsales@example.test?subject=Quote';
    h.fire('input',card.controls.email);
    assert.equal(card.controls.email.value,'hello+sales@example.test');
    card.controls.alternateEmail.value='MAILTO:backup@example.test';
    h.fire('input',card.controls.alternateEmail);
    assert.equal(card.controls.alternateEmail.value,'backup@example.test');
  }
  assert.equal(h.valid(),true);
});

test('invalid mailto text is retained for correction and blocks submission',()=>{
  const h=formHarness([{contact:'Main',email:'main@example.test'}]);
  h.cards[0].controls.email.value='mailto:a@example.test,b@example.test';
  h.fire('input',h.cards[0].controls.email);
  assert.equal(h.cards[0].controls.email.value,'mailto:a@example.test,b@example.test');
  assert.equal(h.valid(),false);
});


test('payment email accepts mailto links but remains separate from customer contact identity',()=>{
  const h=formHarness([{contact:'Main',email:'main@example.test'}]);
  h.paymentEmail.value='mailto:billing@example.test?subject=Invoice';
  h.fire('input',h.paymentEmail);
  assert.equal(h.paymentEmail.value,'billing@example.test');
  assert.equal(h.cards[0].controls.email.value,'main@example.test');
  assert.equal(h.valid(),true);
  h.paymentEmail.value='mailto:bad';
  h.fire('input',h.paymentEmail);
  assert.equal(h.valid(),false);
});
