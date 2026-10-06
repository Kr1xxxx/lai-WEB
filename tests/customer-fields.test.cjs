const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const F = require('../src/customer-fields.js');

test('company display layout keeps required fields visible and preserves valid ordering', () => {
  const defaults = F.normalizeCompanyDisplayLayout();
  assert.equal(defaults.common[0], 'website');
  assert.deepEqual(defaults.common.slice(1, 4), ['name', 'country', 'source']);
  assert.ok(defaults.other.includes('timezone'));
  const changed = F.normalizeCompanyDisplayLayout({
    common: ['tags', 'name', 'country', 'source', 'website'],
    other: ['productType', 'tags', 'timezone', 'unknown'],
  });
  assert.deepEqual(changed.common.slice(0, 5), ['tags', 'name', 'country', 'source', 'website']);
  assert.equal(changed.other[0], 'productType');
  assert.equal(changed.common.filter((id) => id === 'tags').length, 1);
  assert.equal(changed.other.includes('tags'), false);
  assert.deepEqual([...changed.common, ...changed.other].sort(), F.companyDisplayFields.map((field) => field.id).sort());
  const required = F.normalizeCompanyDisplayLayout({ common: ['tags'], other: ['name', 'country', 'source'] });
  for (const id of ['name', 'country', 'source']) assert.ok(required.common.includes(id));
});

test('table column sort uses field values and source-backed missing-value order', () => {
  const input=[
    {name:'Ten',source:'Zeta',opportunityCount:10,lastWonDate:'2026-09-20',followed:true},
    {name:'Two',source:'Alpha',opportunityCount:2,lastWonDate:'2026-01-10',followed:false},
    {name:'Empty',source:'',opportunityCount:null,lastWonDate:'',followed:null},
  ];
  const names=(items)=>items.map(row=>row.name);
  assert.deepEqual(names(F.sortRows(input,'source','asc')),['Two','Ten','Empty']);
  assert.deepEqual(names(F.sortRows(input,'source','desc')),['Ten','Two','Empty']);
  assert.deepEqual(names(F.sortRows(input,'opportunityCount','asc')),['Two','Ten','Empty']);
  assert.deepEqual(names(F.sortRows(input,'opportunityCount','desc')),['Ten','Two','Empty']);
  assert.deepEqual(names(F.sortRows(input,'lastWonDate','asc')),['Empty','Two','Ten']);
  assert.deepEqual(names(F.sortRows(input,'lastWonDate','desc')),['Ten','Two','Empty']);
  assert.deepEqual(names(F.sortRows(input,'followed','asc')),['Two','Ten','Empty']);
  assert.deepEqual(names(input),['Ten','Two','Empty']);
});
test('country sorting follows the visible localized name instead of flag code points', () => {
  const rows=[{name:'US',country:'US'},{name:'CN',country:'CN'},{name:'DE',country:'DE'}];
  assert.deepEqual(F.sortRows(rows,'country','asc').map(row=>row.name),['DE','US','CN']);
  assert.deepEqual(F.sortRows(rows,'country','desc').map(row=>row.name),['CN','US','DE']);
});

test('country sorting places unspecified countries first ascending and last descending', () => {
  const rows=[{name:'US',country:'US'},{name:'Unknown',country:''},{name:'DE',country:'DE'}];
  assert.deepEqual(F.sortRows(rows,'country','asc').map(row=>row.name),['Unknown','DE','US']);
  assert.deepEqual(F.sortRows(rows,'country','desc').map(row=>row.name),['US','DE','Unknown']);
});
test('recent follow-up sorting places missing dates first ascending and last descending', () => {
  const rows=[
    {name:'Recent',lastFollowup:'2026-09-20'},
    {name:'Missing',lastFollowup:''},
    {name:'Older',lastFollowup:'2026-03-10'},
  ];
  assert.deepEqual(F.sortRows(rows,'lastFollowup','asc').map(row=>row.name),['Missing','Older','Recent']);
  assert.deepEqual(F.sortRows(rows,'lastFollowup','desc').map(row=>row.name),['Recent','Older','Missing']);
});
test('won-opportunity USD amounts place missing values first ascending and last descending', () => {
  const rows=[
    {name:'Large',opportunityTotal:300,opportunityAverage:150},
    {name:'Missing',opportunityTotal:null,opportunityAverage:null},
    {name:'Small',opportunityTotal:100,opportunityAverage:100},
  ];
  for(const field of ['opportunityTotal','opportunityAverage']){
    assert.deepEqual(F.sortRows(rows,field,'asc').map(row=>row.name),['Missing','Small','Large']);
    assert.deepEqual(F.sortRows(rows,field,'desc').map(row=>row.name),['Large','Small','Missing']);
  }
});
test('customer level column, ordinary filter, and sort use the same effective grade as the name badge', () => {
  const M=require('../src/model.js');
  const source={orders:[
    {client:'Auto',amount:600,currency:'USD'},
    {client:'Auto',amount:300,currency:'USD'},
  ],customers:{Auto:{},Manual:{level:'B级翡翠客户'},Reset:{level:'自动判断'}}};
  const rows=M.buildCustomers(source), h=appHarness();
  const field=F.catalog.find(item=>item.id==='level');
  assert.equal(h.api.displayCell(rows.find(row=>row.name==='Auto'),field),'E级白银客户');
  assert.equal(h.api.displayCell(rows.find(row=>row.name==='Reset'),field),'F级青铜客户');
  assert.deepEqual(F.filter(rows,{level:'E级白银客户'}).map(row=>row.name),['Auto']);
  assert.deepEqual(F.sortRows(rows,'level','asc').map(row=>row.name),['Manual','Auto','Reset']);
});
test('an unresolved automatic grade stays empty in list filters, sort and rule groups',()=>{
  const M=require('../src/model.js'), S=require('../src/segments.js');
  const state={customers:{Known:{level:'B级翡翠客户'},Unknown:{level:'自动判断'}},orders:[
    {client:'Unknown',amount:100,currency:'EUR'},
  ]};
  const rows=M.buildCustomers(state), unknown=rows.find(row=>row.name==='Unknown');
  const h=appHarness(), field=F.catalog.find(item=>item.id==='level');
  assert.equal(h.api.displayCell(unknown,field),'—');
  assert.deepEqual(F.filter(rows,{level:'自动判断'}).map(row=>row.name),[]);
  assert.deepEqual(F.sortRows(rows,'level','asc').map(row=>row.name),['Known','Unknown']);
  assert.deepEqual(S.filterByRules(rows,{rules:[{field:'level',op:'empty'}]}).map(row=>row.name),['Unknown']);
});
test('first completed order date and USD amount reach their visible customer columns', () => {
  const M=require('../src/model.js'), S=require('../src/segments.js');
  const state={customers:{Acme:{}},orders:[
    {client:'Acme',amount:75,currency:'USD',stage:'done',createdAt:'2026-03-01',shippedAt:'2026-03-05'},
  ]};
  const row=S.enrich(M.buildCustomers(state),state)[0], h=appHarness();
  assert.equal(h.api.displayCell(row,F.catalog.find(field=>field.id==='firstOrderDate')),'2026-03-05');
  assert.equal(h.api.displayCell(row,F.catalog.find(field=>field.id==='firstOrderTotal')),'75.00');
});

test('catalog retains every captured field and the exact 18 default columns', () => {
  const capture = fs.readFileSync(path.join(__dirname, 'fixtures/cus-list-003-fields.txt'), 'utf8');
  const modal = capture.slice(capture.indexOf('602 container 设置'));
  const labels = [...modal.matchAll(/checkbox .*Description: (.*?)\s*, Value/g)].map(m => m[1].trim());
  assert.ok(labels.length > 80);
  for (const label of labels) assert.ok(F.catalog.some(f => f.label === label), `Missing captured field: ${label}`);
  assert.equal(new Set(F.catalog.map(f => f.id)).size, F.catalog.length);
  assert.deepEqual(F.catalog.slice(0,labels.length).map(f=>f.label),labels);
  assert.deepEqual(F.normalizeColumns().order, ['name','contact','country','tags','owner','lastWonDate','lastFollowup','latestActivity','opportunityTotal','opportunityAverage','opportunityCount','alibabaId','lastContact','createdAt','source','customerCode','email','phone']);
  assert.equal(F.catalog.find(f => f.id === 'total').label, '成交订单金额(USD)');
  assert.equal(F.catalog.find(f => f.id === 'opportunityTotal').label, '赢单商机金额(USD)');
  for (const f of F.catalog) assert.ok(f.id && f.label && f.category && ['text','number','date','boolean'].includes(f.type) && f.width > 0);
});

const rows = () => [
  { name:'Élodie', email:'sales@example.test', country:'France', owner:'A', stage:'已成交', tags:['工具','VIP'], source:'展会', level:'A', followed:true, alibabaIdentity:'买家', group:['重点客户'], total:100 },
  { name:'Beta', email:'elodie@example.test', country:'France', owner:'B', stage:'未成交', tags:['工具'], source:'网站', level:'B', followed:false, alibabaIdentity:'卖家', group:['普通客户'], total:200 },
  { name:'Gamma', email:'other@example.test', country:'US', owner:'A', stage:'已成交', tags:['VIP'], source:'展会', level:'A', followed:'false', alibabaIdentity:'买家', group:['重点客户'] },
];

test('quick search stays within its selected field, handles arrays, and never aliases unknown fields to all', () => {
  const input = rows();
  assert.deepEqual(F.filter(input, {field:'name',query:'elodie'}), [input[0]]);
  assert.deepEqual(F.filter(input, {field:'email',query:'elodie'}), [input[1]]);
  assert.deepEqual(F.filter(input, {field:'tag',query:'vip'}), [input[0], input[2]]);
  assert.deepEqual(F.filter(input, {field:'customerGroup',query:'重点'}), [input[0],input[2]]);
  assert.deepEqual(F.filter(input, {field:'unknown',query:'elodie'}), []);
  assert.deepEqual(F.filter(input, {field:'all',query:'elodie'}), []);
  assert.deepEqual(F.filter(input, {field:'toString',query:'object'}), []);
  assert.deepEqual(F.filter(input, {field:'opportunityTotal',query:'100'}), []);
});

test('email filters find the owning customer through an additional contact email', () => {
  const M = require('../src/model.js');
  const state = {orders:[],customers:{
    Acme:{email:'main@acme.test',extraContacts:[{id:'second',contact:'Maya',email:'maya@acme.test'}]},
    Beta:{email:'buyer@beta.test'},
  }};
  const input = M.buildCustomers(state), before = structuredClone(input);
  assert.deepEqual(F.filter(input,{field:'email',query:'maya@acme.test'}).map(row=>row.name),['Acme']);
  assert.deepEqual(F.filter(input,{email:'maya@acme.test'}).map(row=>row.name),['Acme']);
  assert.deepEqual(F.filter(input,{field:'name',query:'maya@acme.test'}),[]);
  assert.deepEqual(input,before);
});

test('global customer search matches the selected captured field and includes additional contacts', () => {
  const M = require('../src/model.js');
  const input = M.buildCustomers({orders:[],customers:{
    Acme:{customerCode:'CUS-041',note:'仅客户备注',companyRemark:'包装偏好',shortName:'ACE',website:'https://acme.test',
      extraContacts:[{contact:'Maya',email:'maya@acme.test',phone:'12345',socialAccount:'@maya'}]},
    Beta:{customerCode:'CUS-042',note:'其他备注',shortName:'BEE',website:'https://beta.test'},
  }});
  const names = (field, query) => F.globalCustomerSearch(input, {field, query}).map(row => row.name);
  assert.deepEqual(names('customerCode', '041'), ['Acme']);
  assert.deepEqual(names('customerCode', 'maya'), []);
  assert.deepEqual(names('contact', 'maya'), ['Acme']);
  assert.deepEqual(names('email', 'maya@'), ['Acme']);
  assert.deepEqual(names('phone', '12345'), ['Acme']);
  assert.deepEqual(names('social', '@maya'), ['Acme']);
  assert.deepEqual(names('website', 'acme.test'), ['Acme']);
  assert.deepEqual(names('note', '包装'), ['Acme']);
  assert.deepEqual(names('note', '仅客户备注'), []);
  assert.deepEqual(names('all', '仅客户备注'), []);
  assert.deepEqual(names('shortName', 'ace'), ['Acme']);
  assert.deepEqual(names('nameOrShort', 'ace'), ['Acme']);
  assert.deepEqual(names('all', 'CUS-041'), ['Acme']);
  assert.deepEqual(names('unknown', 'Acme'), []);
});

test('ordinary conditions intersect without reordering or mutating source rows', () => {
  const input = rows(), before = structuredClone(input);
  assert.deepEqual(F.filter(input, {country:'France',owner:'A',stage:'已成交',tag:'VIP',source:'展会',level:'A',followed:true,alibabaIdentity:'买家',customerGroup:'重点客户',name:'elodie',email:'sales@'}), [input[0]]);
  assert.deepEqual(F.filter(input, {owner:'A',source:'展会'}), [input[0],input[2]]);
  assert.deepEqual(input, before);
  assert.notEqual(F.filter(input, {}), input);
  assert.deepEqual(F.filter(input, {}), input);
});

test('ordinary tag filter distinguishes any from all selected labels', () => {
  const input = [
    {name:'Both',tags:['VIP','复购'],country:'美国'},
    {name:'First',tags:['VIP'],country:'美国'},
    {name:'Second',tags:['复购'],country:'美国'},
    {name:'Other Country',tags:['VIP','复购'],country:'法国'},
  ];
  const before=structuredClone(input);
  assert.deepEqual(F.filter(input,{tag:'VIP，复购',tagMode:'包含任一',country:'美国'}).map(row=>row.name),['Both','First','Second']);
  assert.deepEqual(F.filter(input,{tag:'VIP, 复购',tagMode:'包含全部',country:'美国'}).map(row=>row.name),['Both']);
  assert.deepEqual(F.filter(input,{tag:'VIP',tagMode:'包含全部'}).map(row=>row.name),['Both','First','Other Country']);
  assert.deepEqual(F.filter(input,{tag:'',tagMode:'包含全部'}),input);
  assert.deepEqual(input,before);
});

test('followed conditions use explicit true and false, never JavaScript string truthiness', () => {
  const input = rows();
  assert.deepEqual(F.filter(input, {followed:'false'}), [input[1],input[2]]);
  assert.deepEqual(F.filter(input, {field:'followed',query:'true'}), [input[0]]);
  assert.deepEqual(F.filter(input, {field:'followed',query:'false'}), [input[1],input[2]]);
  assert.deepEqual(F.filter(input, {followed:'garbage'}), []);
  assert.deepEqual(F.filter(input, {followed:''}), input);
});

test('column normalization knows new fields, keeps name first, and limits frozen columns to three', () => {
  const settings = {order:['email','opportunityTotal','name','source','country','email','unknown'],frozen:['country','opportunityTotal','email','source']};
  const before = structuredClone(settings), out = F.normalizeColumns(settings);
  assert.deepEqual(out, {order:['name','email','opportunityTotal','source','country'],frozen:['name','email','opportunityTotal']});
  assert.deepEqual(settings, before);
  assert.equal(F.normalizeColumns().order.length,18);
  assert.deepEqual(F.normalizeColumns({order:[],frozen:['unknown'] }), {order:['name'],frozen:['name']});
});

test('module loads without CommonJS as window.LaiCustomerFields', () => {
  const context = {window:{}}; vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/customer-fields.js'), 'utf8'), context);
  assert.equal(typeof context.window.LaiCustomerFields.filter, 'function');
  assert.equal(context.window.LaiCustomerFields.catalog.length, F.catalog.length);
});

test('company and custom product fields remain distinct, and persisted aliases retain columns', () => {
  for (const [id,label] of [['companyProducts','主营产品'],['productType','主营产品.'],['cardStock','卡纸']]) assert.equal(F.catalog.find(f=>f.id===id)?.label,label);
  assert.deepEqual(F.normalizeColumns({order:['name','customMainProduct','cardPaper'],frozen:['customMainProduct','cardPaper']}), {order:['name','productType','cardStock'],frozen:['name','productType','cardStock']});
  const input=[{name:'A',customerStars:5,level:'A'},{name:'B',customerStars:1,level:'5'}];
  assert.deepEqual(F.filter(input,{customerStars:'5'}),[input[0]]);
});

test('country display translates known regions without changing source values', () => {
  for(const [raw,label] of [['🇺🇸 美国 United States','🇺🇸 美国'],['United States','🇺🇸 美国'],['France','🇫🇷 法国'],['中国 China','🇨🇳 中国'],['','—']]) assert.equal(F.countryLabel(raw),label);
});

test('customer date columns use the same local day as customer detail for timestamps', () => {
  const h=appHarness();
  const timestamp='2026-09-24T20:59:00.000Z';
  const field={id:'lastFollowup',type:'date'};
  assert.equal(h.api.displayCell({lastFollowup:timestamp},field),new Date(timestamp).toLocaleDateString('sv-SE'));
  assert.equal(h.api.displayCell({lastFollowup:'2026-09-24'},field),'2026-09-24');
});

function appHarness() {
  const callbacks = {}, elements = {}, timers = [];
  let focused='', html='';
  const dialog={focus(){focused='dialog';},classList:{add(){}},isConnected:true};
  elements['#overlay-root']={set innerHTML(v){html=v;},get innerHTML(){return html;}};
  elements['.drawer']=dialog;
  elements['#filter-error']={textContent:'',classList:{add(){}}};
  elements['#toast']={textContent:'',classList:{add(){},remove(){}}};
  const document={activeElement:null,querySelector(q){return elements[q]||null;},addEventListener(event,fn){(callbacks[event]||=[]).push(fn);}};
  class FormData {constructor(form){this.entries=form.entries||form.elements.filter(e=>e.name&&!['button','submit'].includes(e.type)&&(e.type!=='radio'||e.checked)).map(e=>[e.name,e.value]);}[Symbol.iterator](){return this.entries[Symbol.iterator]();}}
  let draft=false,opened=0,navigated=0;
  const business={hasDraft:()=>draft,navigate(){navigated++;},openOrder(){opened++;}};
  const M=require('../src/model.js'), S=require('../src/segments.js');
  const context={window:{addEventListener(event,fn){(callbacks[event]||=[]).push(fn);},PreviewModel:M,PreviewSegments:S,LaiCustomerFields:F,LaiModules:require('../src/modules.js'),LaiBusinessUI:{create:()=>business},LaiMailUI:(require('../src/mail-ui.js'),globalThis.LaiMailUI)},document,FormData,structuredClone,Intl,crypto:require('node:crypto').webcrypto,history:{replaceState(){}},setTimeout(fn){timers.push(fn);return timers.length;},clearTimeout(){}};
  vm.createContext(context);
  const source=fs.readFileSync(path.join(__dirname,'../src/app.js'),'utf8').replace('  boot();','  window.testApp={filterForm,drawer,navigateApp,displayCell,snapshot:()=>({filters,advancedSpec,modal,segmentDraft}), setRows:value=>{rows=value;}};');
  vm.runInContext(source,context);
  return {api:context.window.testApp,elements,setDraft(value){draft=value;},get opened(){return opened;},get navigated(){return navigated;},get html(){return html;},get focused(){return focused;},timers,
    async click(dataset){const target={dataset,closest(){return this;}};for(const fn of callbacks.click||[])await fn({target});},
    async dispatch(event,data){for(const fn of callbacks[event]||[])await fn(data);},
    form(entries){elements['#filter-form']={entries,elements:[],querySelectorAll(){return [];}};},
    advanced(match,rules){elements['#filter-form']={entries:[['match',match]],elements:{match:{value:match}},querySelectorAll(){return rules.map(rule=>({querySelectorAll(){return Object.entries(rule).map(([advancedProp,value])=>({dataset:{advancedProp},value}));}}));}};},
  };
}

test('moving group toggle activates on pointer press and ignores its later click',async()=>{
  const h=appHarness(),classes=new Set();
  h.elements['.panel']={classList:{
    toggle(name,force){const value=force??!classes.has(name);value?classes.add(name):classes.delete(name);},
    remove(name){classes.delete(name);},contains(name){return classes.has(name);},
  }};
  const attrs={};
  const glyph={textContent:'‹'};
  const button={dataset:{action:'collapse-groups'},disabled:false,
    closest(selector){return selector==='button[data-action="collapse-groups"]'?this:null;},querySelector(name){return name==='.collapse-groups-glyph'?glyph:null;},setAttribute(name,value){attrs[name]=value;}};
  await h.dispatch('pointerdown',{target:button,button:0});
  assert.equal(classes.has('groups-collapsed'),true);
  await h.dispatch('pointerup',{target:button,button:0});
  await h.dispatch('click',{target:button,detail:1});
  assert.equal(classes.has('groups-collapsed'),true);
  assert.equal(glyph.textContent,'›');
  await h.dispatch('pointerdown',{target:button,button:0});
  assert.equal(classes.has('groups-collapsed'),false);
  assert.equal(glyph.textContent,'‹');
  await h.dispatch('pointerup',{target:button,button:0});
  await h.dispatch('click',{target:button,detail:1});
  assert.equal(classes.has('groups-collapsed'),false);
  assert.equal(attrs['aria-expanded'],'true');
});

test('customer table keeps count fields as counts while formatting monetary fields', () => {
  const h=appHarness();
  const field=id=>F.catalog.find(item=>item.id===id);
  assert.equal(h.api.displayCell({opportunityCount:3},field('opportunityCount')),'3');
  assert.equal(h.api.displayCell({activeOpportunityCount:1},field('activeOpportunityCount')),'1');
  assert.equal(h.api.displayCell({contactCount:0},field('contactCount')),'0');
  assert.equal(h.api.displayCell({customerStars:4},field('customerStars')),'4');
  assert.equal(h.api.displayCell({score:4.5},field('score')),'4.5');
  assert.equal(h.api.displayCell({opportunityTotal:1200.5},field('opportunityTotal')),'1,200.50');
  assert.equal(h.api.displayCell({followed:true},field('followed')),'是');
  assert.equal(h.api.displayCell({followed:false},field('followed')),'否');
  assert.equal(h.api.displayCell({},field('followed')),'—');
  assert.equal(h.api.displayCell({group:[]},field('group')),'—');
});

test('contact columns use primary-contact data while customer payment remains a separate column', () => {
  const M = require('../src/model.js');
  const row = M.buildCustomers({orders:[],customers:{Acme:{
    paymentMethod:'PayPal', contactPaymentMethod:'Bank transfer',
    socialPlatform:'Instagram', socialAccount:'@acme',
  }}})[0];
  const field = id => F.catalog.find(item => item.id === id);
  const h = appHarness();
  assert.equal(field('contactPaymentMethod')?.category, '联系人信息');
  assert.equal(field('contactPaymentMethod')?.label, '付款方式');
  assert.equal(field('customerPaymentMethod')?.label, '客户付款方式');
  assert.deepEqual(F.normalizeColumns({order:['name','paymentMethod']}).order, ['name','contactPaymentMethod']);
  assert.equal(h.api.displayCell(row, field('contactPaymentMethod')), 'Bank transfer');
  assert.equal(h.api.displayCell(row, field('customerPaymentMethod')), 'PayPal');
  assert.equal(h.api.displayCell(row, field('socialPlatforms')), 'Instagram @acme');
});

test('reset filter preserves radio/button values and selects the unrestricted radio', async () => {
  const h=appHarness();
  const controls=[{type:'radio',value:'',checked:false},{type:'radio',value:'true',checked:true},{type:'radio',value:'false',checked:false},{type:'button',value:'keep'},{type:'text',value:'draft',name:'name'}];
  h.elements['#filter-form']={elements:controls};
  await h.click({action:'reset-filter-form'});
  assert.deepEqual(controls.map(c=>c.value),['','true','false','keep','']);
  assert.deepEqual(controls.slice(0,3).map(c=>c.checked),[true,false,false]);
});

test('switching filter modes keeps edits as drafts and cancelling does not apply them', async () => {
  const h=appHarness();h.api.filterForm();h.form([['name','Unsaved Company'],['tagMode','包含任一']]);
  await h.click({filterMode:'advanced'});
  assert.equal(h.api.snapshot().filters.name,undefined);
  await h.click({filterMode:'normal'});
  assert.match(h.html,/value="Unsaved Company"/);
  await h.click({filterMode:'advanced'});
  await h.click({action:'close-modal'});
  assert.equal(h.api.snapshot().filters.name,undefined);
  h.api.filterForm();
  assert.match(h.html,/data-filter-mode="normal" class="active"/);
  assert.doesNotMatch(h.html,/data-filter-mode="advanced" class="active"/);
});

test('segment generation ignores form metadata, maps aliases, and rejects unsupported conditions visibly', async () => {
  const h=appHarness();h.form([['tagMode','包含任一'],['customerGroup','重点'],['tag','VIP']]);
  await h.click({action:'filter-segment'});
  assert.match(h.html,/value="group" selected/);
  assert.match(h.html,/value="tags" selected/);
  assert.doesNotMatch(h.html,/value="tagMode"/);
  const bad=appHarness();bad.form([['tagMode','包含任一'],['not-a-field','x']]);
  await bad.click({action:'filter-segment'});
  assert.match(bad.elements['#filter-error'].textContent,/not-a-field/);
  assert.equal(bad.api.snapshot().modal,null);
});
test('generating a segment preserves all-tag mode with comma-separated labels', async () => {
  const h=appHarness();
  h.form([['tagMode','包含全部'],['tag','LaiTagA, LaiTagB'],['country','美国']]);
  await h.click({action:'filter-segment'});
  assert.match(h.html,/value="tags" selected/);
  assert.match(h.html,/value="containsAll" selected/);
  assert.match(h.html,/value="LaiTagA, LaiTagB"/);
  assert.match(h.html,/value="country" selected/);
  assert.equal(h.elements['#filter-error'].textContent,'');
});
test('generating a segment accepts identity, stars, and followed conditions', async () => {
  const h=appHarness();
  h.form([['tagMode','包含任一'],['alibabaIdentity','买家'],['customerStars','5'],['followed','false']]);
  await h.click({action:'filter-segment'});
  assert.match(h.html,/value="alibabaIdentity" selected/);
  assert.match(h.html,/value="customerStars" selected/);
  assert.match(h.html,/value="followed" selected/);
  assert.match(h.html,/<select data-rule-prop="value" aria-label="条件3值"[^>]*><option value="true"[^>]*>是<\/option><option value="false" selected>否<\/option><\/select>/);
  assert.equal(h.elements['#filter-error'].textContent,'');
});

test('order links only open after navigation passes draft protection', async () => {
  const h=appHarness();h.setDraft(true);await h.click({laiOrder:'order1'});
  assert.equal(h.opened,0);assert.equal(h.navigated,0);
  h.setDraft(false);await h.click({laiOrder:'order1'});
  assert.equal(h.opened,1);assert.equal(h.navigated,1);
});

test('drawer initial focus is the dialog and editor headers retain the heart entry', () => {
  const h=appHarness();h.api.drawer('新建客户','<div class="drawer-body"></div>','','edit');
  assert.match(h.html,/role="dialog"[^>]*tabindex="-1"/);
  assert.match(h.html,/aria-label="关注客户"/);
  assert.match(h.html,/data-action="editor-follow"/);
  assert.doesNotMatch(h.html,/data-feature="关注客户"/);
  for(const fn of h.timers)fn();assert.equal(h.focused,'dialog');
});

 test('field settings use the reference headings and normal filters expose tag match radios', async () => {
  const h=appHarness();await h.click({action:'settings'});
  assert.match(h.html,/设置「全部客户」显示字段/);
  assert.match(h.html,/<h3>可选字段<\/h3>/);
  assert.match(h.html,/<h3>已选字段<\/h3>/);
  h.api.filterForm();
  assert.match(h.html,/type="radio" name="tagMode" value="包含任一"/);
  assert.match(h.html,/包含全部标签/);
  assert.match(h.html,/今年成交订单金额Top10客户/);
});


test('advanced filter changes remain uncommitted and generated segments preserve any matching', async () => {
  const h=appHarness();h.api.filterForm();h.form([]);await h.click({filterMode:'advanced'});
  h.advanced('any',[{field:'country',op:'contains',value:'France'},{field:'name',op:'contains',value:'Beta'}]);
  await h.click({filterMode:'normal'});
  assert.equal(h.api.snapshot().advancedSpec,null);
  h.form([]);await h.click({filterMode:'advanced'});
  assert.match(h.html,/value="France"/);
  assert.match(h.html,/value="any" selected/);
  h.advanced('any',[{field:'country',op:'contains',value:'France'},{field:'name',op:'contains',value:'Beta'}]);
  await h.click({action:'filter-segment'});
  assert.equal(h.api.snapshot().segmentDraft.match,'any');
  assert.deepEqual(Array.from(h.api.snapshot().segmentDraft.rules,r=>({...r})),[{field:'country',op:'contains',value:'France'},{field:'name',op:'contains',value:'Beta'}]);
  assert.equal(h.api.snapshot().advancedSpec,null);
});

test('clearing tag mode selects the default without changing choice values', async () => {
  const h=appHarness(), controls=[{type:'radio',name:'tagMode',value:'包含任一',checked:false},{type:'radio',name:'tagMode',value:'包含全部',checked:true}];
  h.elements['#filter-form']={elements:controls};await h.click({action:'reset-filter-form'});
  assert.deepEqual(controls.map(c=>[c.value,c.checked]),[['包含任一',true],['包含全部',false]]);
});
