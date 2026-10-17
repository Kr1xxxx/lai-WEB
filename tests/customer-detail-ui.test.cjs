const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/model.js');
const S = require('../src/segments.js');
const D = require('../src/customer-detail-ui.js');

test('quick activity cards show minute precision while retaining the exact stored time in details',()=>{
 const state={customers:{Acme:{history:[
  {type:'followup',subtype:'quick',time:'2026-09-23T11:22:33',text:'Current call',contact:'Alice'},
  {type:'followup',subtype:'quick',time:'2024-07-31T15:28:49',text:'Old call'},
 ]}},orders:[]};
 const before=structuredClone(state);
 const html=D.render(M.buildCustomers(state)[0],{state,tab:'activity',activityFilter:'followup',now:'2026-09-27T10:00:00',escape:M.escapeHtml});
 assert.match(html,/<time title="2026-09-23 11:22:33">09-23 11:22<\/time>/);
 assert.match(html,/<time title="2024-07-31 15:28:49">2024-07-31 15:28<\/time>/);
 assert.match(html,/<dt>时间<\/dt><dd>2026-09-23 11:22:33<\/dd>/);
 assert.match(html,/lcd-quick-record/);
 assert.match(html,/快速记录/);
 assert.deepEqual(state,before);
});

test('quick activity metadata uses the recorded contact without inventing a main-contact association',()=>{
 const state={customers:{Acme:{contact:'Company main',history:[
  {type:'followup',subtype:'quick',time:'2026-09-23T11:22:33',text:'<script>note</script>',contactName:'<Alice>'},
  {type:'followup',subtype:'quick',time:'2026-09-22T11:22:33',text:'No linked contact'},
 ]}},orders:[]};
 const html=D.render(M.buildCustomers(state)[0],{state,tab:'activity',activityFilter:'followup',escape:M.escapeHtml});
 assert.equal((html.match(/class="lcd-activity-contact"/g)||[]).length,1);
 assert.match(html,/关联联系人：<\/span>&lt;Alice&gt;/);
 assert.match(html,/&lt;script&gt;note&lt;\/script&gt;/);
 assert.doesNotMatch(html,/<script>note/);
 assert.equal((html.match(/data-action="toggle-activity-detail"/g)||[]).length,2);
});

test('contact phone display includes saved dial codes without duplicating international prefixes',()=>{
 const profile={contact:'Main',phone:'5550101',phoneCountryCode:'+1',
  additionalPhones:[{phoneCountryCode:'+44',phone:'+44 7700 900123'},{phoneCountryCode:'+33',phone:'0033 612345678'},{phoneCountryCode:'+49',phone:''}],
  extraContacts:[{contact:'Second',phone:'612345678',phoneCountryCode:'+33'}]};
 const state={orders:[],customers:{Acme:profile}},before=structuredClone(state);
 const html=D.render(M.buildCustomers(state)[0],{state,escape:M.escapeHtml});
 assert.match(html,/<dt>联系电话<\/dt><dd>\+1 5550101、\+44 7700 900123、0033 612345678<\/dd>/);
 assert.match(html,/<dt>联系电话<\/dt><dd>\+33 612345678<\/dd>/);
 assert.deepEqual(state,before);
});

test('explicitly cleared backup email stays empty while unmigrated aliases remain visible',()=>{
 for(const [profile,expected] of [
  [{alternateEmail:'',alternativeEmail:'stale@example.test',backupEmail:'older@example.test'},'—'],
  [{alternativeEmail:'legacy@example.test'},'legacy@example.test'],
  [{backupEmail:'old@example.test'},'old@example.test'],
  [{alternateEmail:'current@example.test',alternativeEmail:'stale@example.test'},'current@example.test'],
 ]){
  const state={orders:[],customers:{Acme:{contact:'Main',...profile}}};
  const html=D.render(M.buildCustomers(state)[0],{state,escape:M.escapeHtml});
  assert.ok(html.includes(`<dt>备用邮箱</dt><dd>${expected}</dd>`));
 }
});

test('contact card and search ignore stale single values behind explicit empty array slots',()=>{
 const state={orders:[],customers:{Acme:{contact:'Stale name',contacts:[''],
  email:'stale@example.test',emails:[''],phone:'999',phones:[''],address:'Stale address',addresses:['']}}};
 const html=D.render(M.buildCustomers(state)[0],{state,escape:M.escapeHtml});
 assert.match(html,/联系人\(0\)/);
 assert.match(html,/暂无联系人/);
 assert.doesNotMatch(html,/<article class="lcd-contact"/);
 assert.doesNotMatch(html,/Stale name|stale@example\.test|Stale address/);
});

test('imported company and contact fields remain visible in customer details',()=>{
 const profile={contact:'Ana',email:'ana@acme.test',shortName:'ACE',landline:'001-222',
  companyAddress:'Paris',companyRemark:'Blue packaging',poolGroup:'Europe',
  contactTitle:'Buyer',contactGender:'女',contactNote:'Morning calls'};
 const state={orders:[],customers:{Acme:profile}};
 const html=D.render(M.buildCustomers(state)[0],{state,tab:'info',escape:M.escapeHtml});
 for(const [label,value] of [['公司简称','ACE'],['座机','001-222'],['详细地址','Paris'],
   ['公司备注','Blue packaging'],['公海分组','Europe'],['职位','Buyer'],['性别','女']])
  assert.match(html,new RegExp(`<dt>${label}<\\/dt><dd>${value}<\\/dd>`));
});

test('company detail mirrors the captured 9+4 fields without duplicating editor-only fields',()=>{
 const state={orders:[],customers:{Acme:{website:'https://acme.test',tags:['VIP'],country:'US'}},
  previewCompanyDisplayLayout:{common:['tags','name','country','source'],other:['website']}};
 const html=D.render(M.buildCustomers(state)[0],{state,tab:'info',escape:M.escapeHtml});
 const common=html.match(/公司常用信息[\s\S]*?<dl class="lcd-info-fields">([\s\S]*?)<\/dl>/)?.[1]||'';
 const other=html.match(/公司其他信息[\s\S]*?<dl class="lcd-info-fields">([\s\S]*?)<\/dl>/)?.[1]||'';
 assert.equal((common.match(/class="lcd-field"/g)||[]).length,9);
 assert.equal((other.match(/class="lcd-field"/g)||[]).length,4);
 assert.match(common,/<dt>公司网址<\/dt><dd>https:\/\/acme\.test<\/dd>/);
 assert.doesNotMatch(common,/客户标签|默认付款计划|客户账期/);
 assert.doesNotMatch(other,/客户标签|默认付款计划|客户账期|公司网址/);
 assert.match(html,/class="lcd-tags">标签：<span class="lcd-tag k-badge">VIP<\/span>/);
 assert.match(html,/data-action="company-display-settings"/);
});

test('detail schedule exposes the local add action for the saved follow date; the calendar link is gone (D-031)',()=>{
 const state={orders:[],customers:{Acme:{}}};
 const empty=D.render(M.buildCustomers(state)[0],{state,escape:M.escapeHtml});
 const emptyCard=empty.match(/<section class="lcd-card lcd-schedule k-card">([\s\S]*?)<\/section>/)?.[1]||'';
 assert.match(emptyCard,/计划日程 （0）/);
 assert.match(emptyCard,/data-action="schedule-edit"/);
 assert.doesNotMatch(emptyCard,/data-action="schedule-view"/);
 const scheduled={...state,customers:{Acme:{nextFollow:'2026-11-05'}}};
 const filled=D.render(M.buildCustomers(scheduled)[0],{state:scheduled,escape:M.escapeHtml});
 const card=filled.match(/<section class="lcd-card lcd-schedule k-card">([\s\S]*?)<\/section>/)?.[1]||'';
 assert.match(card,/计划日程 （1）/);
 assert.match(card,/2026-11-05/);
 assert.match(card,/data-action="schedule-edit"/);
 assert.doesNotMatch(card,/data-action="schedule-view"|日历/);
});
test('detail identity names the actual private, public-pool and recycle-bin customer state',()=>{
 const state={orders:[],customers:{Private:{},Public:{laiBucket:'pool'},Recycled:{laiBucket:'trash'}}};
 const rows=M.buildCustomers(state);
 const identity=name=>D.render(rows.find(row=>row.name===name),{state,escape:M.escapeHtml})
   .match(/<div class="lcd-person">[\s\S]*?<span>(.*?)<\/span>/)?.[1];
 assert.equal(identity('Private'),'私海客户');
 assert.equal(identity('Public'),'公海客户');
 assert.equal(identity('Recycled'),'回收站');
});

test('customer info groups expose accessible collapse controls without changing field values',()=>{
 const state={orders:[],customers:{Acme:{website:'https://acme.test',lastEmailSent:'2026-09-20T12:00:00Z'}}};
 const row=M.buildCustomers(state)[0];
 const html=D.render(row,{state,escape:M.escapeHtml,collapsedInfoSections:['company-other','followup']});
 for(const id of ['company-common','company-other','followup','system']){
  assert.match(html,new RegExp(`data-info-section="${id}"`));
  assert.match(html,new RegExp(`data-action="toggle-info-section"[^>]*data-info-id="${id}"`));
 }
 assert.match(html,/data-info-id="company-other"[^>]*aria-expanded="false"/);
 assert.match(html,/id="lcd-info-company-other"[^>]*aria-hidden="true"[^>]*inert/);
 assert.match(html,/data-info-id="followup"[^>]*aria-expanded="false"/);
 assert.match(html,/data-info-id="company-common"[^>]*aria-expanded="true"/);
 assert.match(html,/https:\/\/acme\.test/);
 assert.match(html,/最近发件时间/);
});

test('left detail cards expose their contact content as a collapsible region',()=>{
 const state={orders:[],customers:{Acme:{contact:'Ada',email:'ada@example.test'}}};
 const row=M.buildCustomers(state)[0];
 const expanded=D.render(row,{state,escape:M.escapeHtml});
 const collapsed=D.render(row,{state,escape:M.escapeHtml,collapsedDetailCards:['contacts']});
 for(const id of ['contacts']){
  assert.match(expanded,new RegExp(`data-detail-card="${id}"[^>]*data-collapsed="false"`));
  assert.match(expanded,new RegExp(`data-action="toggle-detail-card"[^>]*data-card-id="${id}"[^>]*aria-expanded="true"`));
  assert.match(collapsed,new RegExp(`data-detail-card="${id}"[^>]*data-collapsed="true"`));
  assert.match(collapsed,new RegExp(`id="lcd-card-panel-${id}"[^>]*aria-hidden="true"[^>]*inert`));
 }
 assert.match(collapsed,/ada@example\.test/);
 // The AI analysis placeholder card was removed (D-003): nothing is offered until it can really work.
 assert.doesNotMatch(expanded,/data-detail-card="analysis"|AI 客户分析/);
});

test('detail summary fields follow saved local selection and keep list field meanings',()=>{
 const state={orders:[],customers:{Acme:{source:'Trade fair',website:'https://acme.test',customerStage:'未成交',level:'B级翡翠客户',companyProducts:'Lashes',score:88},Beta:{source:'Referral',level:'A级钻石客户'}}};
 const row=S.enrich(M.buildCustomers(state),state)[0];
 const defaultHtml=D.render(row,{state,escape:M.escapeHtml});
 const defaultSummary=defaultHtml.match(/<div class="lcd-summary-fields"><dl>([\s\S]*?)<\/dl>/)?.[1]||'';
 assert.match(defaultSummary,/<dt>客户阶段:<\/dt><dd>未成交<\/dd>/);
 assert.match(defaultSummary,/<dt>客户来源:<\/dt><dd>Trade fair<\/dd>/);
 assert.match(defaultHtml,/data-action="summary-fields" aria-label="客户摘要字段设置"/);
 const chosenState={...state,previewDetailSummaryFields:['level','source','lastContact']};
 const chosen=D.render(row,{state:chosenState,escape:M.escapeHtml});
 const summary=chosen.match(/<div class="lcd-summary-fields"><dl>([\s\S]*?)<\/dl>/)?.[1]||'';
 assert.match(summary,/<dt>客户等级:<\/dt><dd>B级翡翠客户<\/dd>/);
 assert.match(summary,/<dt>客户来源:<\/dt><dd>Trade fair<\/dd>/);
 assert.match(summary,/<dt>最近联系时间:<\/dt><dd>—<\/dd>/);
 assert.doesNotMatch(summary,/客户阶段:|公司网址:|主营产品类型:/);
 const otherRow=S.enrich(M.buildCustomers(state),state).find(customer=>customer.name==='Beta');
 const other=D.render(otherRow,{state:chosenState,escape:M.escapeHtml});
 const otherSummary=other.match(/<div class="lcd-summary-fields"><dl>([\s\S]*?)<\/dl>/)?.[1]||'';
 assert.match(otherSummary,/<dt>客户来源:<\/dt><dd>Referral<\/dd>/);
 assert.match(otherSummary,/<dt>客户等级:<\/dt><dd>A级钻石客户<\/dd>/);
 assert.doesNotMatch(otherSummary,/Trade fair|B级翡翠客户|客户阶段:/);
 assert.deepEqual(D.normalizeSummaryFields(['source','unknown','source','level']),['source','level']);
 assert.deepEqual(D.normalizeSummaryFields([]),D.defaultSummaryFields);
});

test('detail summary grade matches the list badge for automatic and manual customer levels',()=>{
 const state={orders:[
  {client:'Auto',amount:600,currency:'USD',createdAt:'2026-09-01'},
  {client:'Auto',amount:300,currency:'USD',createdAt:'2026-09-02'},
 ],customers:{Auto:{},Manual:{level:'B级翡翠客户'},Reset:{level:'自动判断'}},
 previewDetailSummaryFields:['level']};
 const rows=S.enrich(M.buildCustomers(state),state);
 for(const [name,expected] of [['Auto','E级白银客户'],['Manual','B级翡翠客户'],['Reset','F级青铜客户']]){
  const html=D.render(rows.find(row=>row.name===name),{state,escape:M.escapeHtml});
  const summary=html.match(/<div class="lcd-summary-fields"><dl>([\s\S]*?)<\/dl>/)?.[1]||'';
  assert.match(summary,new RegExp(`<dt>客户等级:<\\/dt><dd>${expected}<\\/dd>`),name);
 }
 assert.equal(state.customers.Auto.level,undefined);
 assert.equal(state.customers.Reset.level,'自动判断');
});
test('detail summary shows an empty grade when automatic conversion is unavailable',()=>{
 const state={orders:[{client:'Euro',amount:100,currency:'EUR'}],customers:{Euro:{level:'自动判断'}},previewDetailSummaryFields:['level']};
 const row=S.enrich(M.buildCustomers(state),state)[0];
 const html=D.render(row,{state,escape:M.escapeHtml});
 assert.match(html,/<dt>客户等级:<\/dt><dd>—<\/dd>/);
});
test('cleared company optional fields do not reappear from legacy aliases',()=>{
 const state={orders:[],customers:{Acme:{
  companyProducts:'',mainProducts:'Legacy lashes',cardStock:'',cardPaper:'Legacy card',customBox:'',["定制盒"]:'Legacy box',
 }}};
 const row=S.enrich(M.buildCustomers(state),state)[0];
 const html=D.render(row,{state,escape:M.escapeHtml,tab:'info'});
 const other=html.match(/data-info-section="company-other"[\s\S]*?<dl class="lcd-info-fields">([\s\S]*?)<\/dl>/)?.[1]||'';
 assert.match(other,/<dt>主营产品<\/dt><dd>—<\/dd>/);
 assert.match(other,/<dt>卡纸<\/dt><dd>—<\/dd>/);
 assert.match(other,/<dt>定制盒<\/dt><dd>—<\/dd>/);
 assert.doesNotMatch(other,/Legacy/);
});

test('detail system segment field follows current local memberships and retains imported labels',()=>{
 const state={orders:[],customers:{Acme:{country:'US',segments:['Imported']}},previewSegments:[
  {id:'manual',name:'Priority',kind:'manual',members:['Acme']},
  {id:'rule',name:'US Customers',kind:'rules',rules:[{field:'country',op:'eq',value:'US'}]},
 ]};
 const row=S.enrich(M.buildCustomers(state),state)[0];
 const html=D.render(row,{state,tab:'info',escape:M.escapeHtml});
 assert.match(html,/<dt>客群<\/dt><dd>Imported、Priority、US Customers<\/dd>/);
 assert.deepEqual(state.customers.Acme.segments,['Imported']);
});

test('customer notes keep their own labels and never appear as contact notes',()=>{
 const state={orders:[],customers:{Acme:{contact:'Main',note:'Customer preference',permanentNote:'Every order: plain packaging',contactNote:'Ask for Maya'}}};
 const html=D.render(M.buildCustomers(state)[0],{state,tab:'info',escape:M.escapeHtml});
 const card=html.match(/<article class="lcd-contact"[^>]*>([\s\S]*?)<\/article>/)?.[1]||'';
 assert.match(card,/<dt>联系人备注<\/dt><dd>Ask for Maya<\/dd>/);
 assert.doesNotMatch(card,/Customer preference|Every order: plain packaging/);
 assert.match(html,/<dt>客户备注<\/dt><dd>Customer preference<\/dd>/);
 assert.match(html,/<dt>客户永久备注<\/dt><dd>Every order: plain packaging<\/dd>/);
});
test('customer payment preferences stay outside contact cards in detail',()=>{
 const state={orders:[],customers:{Acme:{contact:'Main',paymentMethod:'PayPal',paymentEmail:'billing@example.test',currency:'EUR',repurchaseCycle:60,contactPaymentMethod:'Cash'}}};
 const html=D.render(M.buildCustomers(state)[0],{state,tab:'info',escape:M.escapeHtml});
 const card=html.match(/<article class="lcd-contact"[^>]*>([\s\S]*?)<\/article>/)?.[1]||'';
 assert.match(card,/<dt>付款方式<\/dt><dd>Cash<\/dd>/);
 assert.doesNotMatch(card,/PayPal|billing@example\.test|EUR|60 天/);
 assert.match(html,/交易偏好/);
 assert.match(html,/<dt>客户付款方式<\/dt><dd>PayPal<\/dd>/);
 assert.match(html,/<dt>付款邮箱<\/dt><dd>billing@example\.test<\/dd>/);
 assert.match(html,/<dt>默认币种<\/dt><dd>EUR<\/dd>/);
 assert.match(html,/<dt>复购周期<\/dt><dd>60 天<\/dd>/);
});
test('customer detail offers no AI analysis, tips, background or data-analysis entries',()=>{
 const state={orders:[],customers:{Acme:{contact:'Main'}}};
 const html=D.render(M.buildCustomers(state)[0],{state,tab:'info',escape:M.escapeHtml});
 assert.doesNotMatch(html,/暂无客户分析报告|生成客户分析|AI 客户分析|AI写跟进|AI聊天旅程|AI 谈单卡点|入口已保留/);
 assert.doesNotMatch(html,/data-tab="(tips|ai|analytics)"/);
 assert.match(html,/data-tab="activity"/);
});

test('a nameless primary contact keeps saved email and phone in the detail card',()=>{
 const state={orders:[],customers:{Acme:{email:'sales@example.test',phone:'12345'}}};
 const row=M.buildCustomers(state)[0];
 const html=D.render(row,{state,escape:M.escapeHtml});
 assert.match(html,/联系人\(1\)/);
 assert.match(html,/class="lcd-main-contact k-badge k-badge--primary">主<\/span>/);
 assert.match(html,/class="lcd-contact-title"><strong>—<\/strong>/);
 assert.match(html,/aria-label="未命名联系人的更多操作"/);
 assert.match(html,/sales@example\.test/);
 assert.match(html,/12345/);
 assert.doesNotMatch(html,/class="lcd-contact-title"><strong>Acme<\/strong>/);
});

test('customer detail shows each contact\'s own saved fields after editing', () => {
  const state = {
    orders: [],
    customers: {
      Acme: {
        contact: 'Main', email: 'main@example.test', phone: '111',
        address: 'Main address', alibabaId: 'MAIN-ID',
        socialPlatform: 'Instagram', socialAccount: '@main',
        alternateEmail: 'main-backup@example.test', birthday: '1990-01-01',
        contactPaymentMethod: 'PayPal', contactNote: 'Main note',
        contacts: ['Main', 'Second'], emails: ['main@example.test', 'second@example.test'],
        phones: ['111', '222'], addresses: ['Main address', 'Second address'],
        extraContacts: [{
          id: 'second', contact: 'Second', email: 'second@example.test', phone: '222',
          address: 'Second address', alibabaId: 'SECOND-ID',
          socialPlatform: 'Facebook', socialAccount: '@second',
          alternateEmail: 'second-backup@example.test', birthday: '2000-02-02',
          paymentMethod: 'Bank transfer', contactNote: 'Second note',
        }],
      },
    },
  };
  const html = D.render(M.buildCustomers(state)[0], {state, escape:M.escapeHtml});
  const cards = [...html.matchAll(/<article class="lcd-contact"[^>]*>([\s\S]*?)<\/article>/g)].map((m) => m[1]);
  assert.equal(cards.length, 2);
  for (const value of ['MAIN-ID', '@main', 'main-backup@example.test', '1990-01-01', 'PayPal', 'Main note'])
    assert.ok(cards[0].includes(value), `primary contact missing ${value}`);
  for (const value of ['SECOND-ID', '@second', 'second-backup@example.test', '2000-02-02', 'Bank transfer', 'Second note'])
    assert.ok(cards[1].includes(value), `additional contact missing ${value}`);
  assert.ok(!cards[1].includes('MAIN-ID'));
  assert.ok(!cards[1].includes('Main note'));
  assert.ok(!cards[1].includes('PayPal'));
});

test('detail shows each contact additional phones and social accounts without mixing cards',()=>{
 const state={orders:[],customers:{Acme:{contact:'Main',phone:'111',socialPlatform:'Instagram',socialAccount:'@main',
   additionalPhones:[{id:'p1',phoneCountryCode:'+44',phone:'222'}],
   additionalSocialAccounts:[{id:'s1',socialPlatform:'LinkedIn',socialAccount:'main-team'}],
   extraContacts:[{id:'second',contact:'Second',phone:'333',additionalPhones:[{id:'p2',phoneCountryCode:'+49',phone:'444'}],additionalSocialAccounts:[{id:'s2',socialPlatform:'Facebook',socialAccount:'@second'}]}],
 }}};
 const html=D.render(M.buildCustomers(state)[0],{state,escape:M.escapeHtml});
 const cards=[...html.matchAll(/<article class="lcd-contact"[^>]*>([\s\S]*?)<\/article>/g)].map(match=>match[1]);
 assert.equal(cards.length,2);
 assert.match(cards[0],/<dt>联系电话<\/dt><dd>111、\+44 222<\/dd>/);
 assert.match(cards[0],/<dt>社交平台<\/dt><dd>Instagram @main、LinkedIn main-team<\/dd>/);
 assert.match(cards[1],/<dt>联系电话<\/dt><dd>333、\+49 444<\/dd>/);
 assert.match(cards[1],/<dt>社交平台<\/dt><dd>Facebook @second<\/dd>/);
 assert.doesNotMatch(cards[0],/444|@second/);
 assert.doesNotMatch(cards[1],/222|main-team/);
});

test('detail info mirrors captured followup and system fields without inventing unavailable data',()=>{
 const state={orders:[{id:'o1',client:'Acme',amount:100,stage:'done',createdAt:'2026-09-20'}],customers:{Acme:{
  contact:'Main',lastPoolEntry:'2026-09-21T08:00:00Z',poolEntryCount:0,
  lastEmailSent:'2026-09-22T08:00:00Z',lastWrittenFollowup:'2026-09-23T08:00:00Z',
  createdBy:'Cherry',createdAt:'2026-01-01T08:00:00Z',updatedBy:'Kris',
  sourceDetail:'Trade fair',customerConnectFirstSync:'2026-02-02T08:00:00Z',
 }}};
 const row=S.enrich(M.buildCustomers(state),state)[0];
 const html=D.render(row,{state,tab:'info',escape:M.escapeHtml});
 const field=(name)=>html.match(new RegExp(`<dt>${name}</dt><dd>(.*?)</dd>`))?.[1];
 assert.match(field('最近进入公海时间'),/^2026-09-21 \d{2}:00:00$/);
 assert.equal(field('进入公海次数'),'0');
 assert.match(field('最近发件时间'),/^2026-09-22 \d{2}:00:00$/);
 assert.match(field('最近「写跟进」时间'),/^2026-09-23 \d{2}:00:00$/);
 assert.equal(field('最近成交时间'),'2026-09-20');  // the 完成 order's date, from the A2 成交 rule
 assert.equal(field('创建人'),'Cherry');
 assert.equal(field('最近修改人'),'Kris');
 assert.equal(field('来源详情'),'Trade fair');
 assert.match(field('关联客户通客户首次同步时间'),/^2026-02-02 \d{2}:00:00$/);
 assert.match(html,/系统信息/);
});

test('activity categories show matching local history instead of opening a placeholder', () => {
  const state = {orders:[],customers:{Acme:{contact:'Main',history:[
    {time:'2026-09-23T10:00:00Z',type:'followup',text:'Called customer'},
    {time:'2026-09-22T10:00:00Z',type:'email',text:'Received email'},
    {time:'2026-09-21T10:00:00Z',text:'Created profile'},
  ]}}};
  const row=M.buildCustomers(state)[0];
  const render=(activityFilter)=>D.render(row,{state,tab:'activity',activityFilter,escape:M.escapeHtml});
  const followup=render('followup');
  assert.match(followup,/<button[^>]*data-activity-filter="followup"[^>]*aria-pressed="true"/);
  assert.match(followup,/Called customer/);
  assert.doesNotMatch(followup,/Received email|Created profile/);
  const email=render('email');
  assert.match(email,/Received email/);
  assert.doesNotMatch(email,/Called customer|Created profile/);
  const other=render('other');
  assert.match(other,/Created profile/);
  assert.doesNotMatch(other,/Called customer|Received email/);
});
test('activity search filters the selected category without counting profile operations',()=>{
 const state={orders:[],customers:{Acme:{contact:'Main',history:[
  {time:'2026-09-23T10:00:00Z',type:'followup',text:'Discussed samples'},
  {time:'2026-09-22T10:00:00Z',type:'email',text:'Received invoice'},
  {time:'2026-09-21T10:00:00Z',type:'operation',text:'更新客户资料'},
 ]}}};
 const row=M.buildCustomers(state)[0];
 const options={state,tab:'activity',activitySearchOpen:true,activityQuery:'SAMPles',escape:M.escapeHtml};
 const html=D.render(row,options);
 assert.match(html,/data-action="activity-search"[^>]*aria-expanded="true"/);
 assert.match(html,/id="activity-search-input"[^>]*value="SAMPles"/);
 assert.match(html,/Discussed samples/);
 assert.doesNotMatch(html,/Received invoice|更新客户资料/);
 assert.match(html,/全部\(1\)/);
 assert.match(html,/找到 1 条动态/);
 const empty=D.render(row,{...options,activityFilter:'email'});
 assert.match(empty,/暂无数据/);
 assert.doesNotMatch(empty,/Discussed samples|Received invoice|更新客户资料/);
});
test('activity refresh exposes a local reload control and status without changing the followup draft',()=>{
 const state={orders:[],customers:{Acme:{contact:'Main',history:[
  {time:'2026-09-23T10:00:00Z',type:'followup',text:'Called customer'},
 ]}}};
 const row=M.buildCustomers(state)[0];
 const html=D.render(row,{state,tab:'activity',followupDraft:{text:'Unsent call note'},escape:M.escapeHtml});
 assert.match(html,/data-action="refresh-activity"[^>]*aria-label="刷新动态"/);
 assert.match(html,/id="activity-refresh-status"[^>]*role="status"/);
 assert.match(html,/Unsent call note/);
});
test('activity timeline groups current month, earlier months and years with honest counts',()=>{
 const state={orders:[],customers:{Acme:{history:[
  {time:'2026-09-22T10:00:00Z',type:'followup',text:'Recent call'},
  {time:'2026-05-12T10:00:00Z',type:'email',text:'May invoice'},
  {time:'2025-12-12T10:00:00Z',type:'chat',text:'December chat'},
  {time:'2025-01-12T10:00:00Z',type:'operation',text:'更新客户资料'},
 ]}}};
 const row=M.buildCustomers(state)[0];
 const options={state,tab:'activity',now:'2026-09-23T10:00:00Z',escape:M.escapeHtml};
 const html=D.render(row,options);
 assert.match(html,/data-timeline-group="recent"[\s\S]*?aria-expanded="true"[\s\S]*?最近\(1\)/);
 assert.match(html,/data-timeline-group="month:2026-05"[\s\S]*?aria-expanded="false"[\s\S]*?五月\(1\)/);
 assert.match(html,/data-timeline-group="year:2025"[\s\S]*?aria-expanded="false"[\s\S]*?2025年\(1\)/);
 assert.doesNotMatch(html,/更新客户资料/);
 assert.match(html,/May invoice|December chat/);
 const queried=D.render(row,{...options,activityQuery:'December'});
 assert.doesNotMatch(queried,/data-timeline-group=/);
 assert.match(queried,/December chat/);
 assert.doesNotMatch(queried,/Recent call|May invoice/);
 const expanded=D.render(row,{...options,activityGroupState:{'month:2026-05':true}});
 assert.match(expanded,/data-timeline-group="month:2026-05"[\s\S]*?aria-expanded="true"/);
});
test('activity sort reverses the time group order without changing category counts or search scope',()=>{
 const state={orders:[],customers:{Acme:{history:[
  {time:'2026-09-22T10:00:00Z',type:'followup',text:'Newest call'},
  {time:'2026-09-20T10:00:00Z',type:'followup',text:'Older call'},
  {time:'2025-12-12T10:00:00Z',type:'email',text:'Old invoice'},
 ]}}};
 const row=M.buildCustomers(state)[0];
 const html=D.render(row,{state,tab:'activity',now:'2026-09-23T10:00:00Z',activitySort:'oldest',escape:M.escapeHtml});
 assert.match(html,/data-action="activity-sort"[^>]*aria-label="动态排序"/);
 assert.ok(html.indexOf('data-timeline-group="year:2025"')<html.indexOf('data-timeline-group="recent"'));
 assert.ok(html.indexOf('Older call')<html.indexOf('Newest call'));
 assert.match(html,/全部\(3\)/);
 const filtered=D.render(row,{state,tab:'activity',now:'2026-09-23T10:00:00Z',activitySort:'oldest',activityFilter:'followup',activityQuery:'call',escape:M.escapeHtml});
 assert.ok(filtered.indexOf('Older call')<filtered.indexOf('Newest call'));
 assert.doesNotMatch(filtered,/Old invoice/);
 assert.match(filtered,/找到 2 条动态/);
});
test('advanced activity filter intersects saved date, contact, owner, type, category and search',()=>{
 const state={orders:[],customers:{Acme:{contacts:['Alice','Bob'],history:[
  {time:'2026-09-23T10:00:00Z',type:'followup',text:'Alice sample call',contact:'Alice',owner:'Mira'},
  {time:'2026-09-22T10:00:00Z',type:'followup',text:'Bob sample call',contact:'Bob',owner:'Kris'},
  {time:'2026-09-21T10:00:00Z',type:'email',text:'Alice sample email',contact:'Alice',owner:'Mira'},
  {time:'2026-09-20T10:00:00Z',type:'chat',channel:'WhatsApp',text:'Alice WhatsApp',contact:'Alice',owner:'Mira'},
  {time:'2026-09-19T10:00:00Z',type:'chat',channel:'TM',text:'Alice TM',contact:'Alice',owner:'Mira'},
  {time:'2026-09-18T10:00:00Z',type:'operation',text:'更新客户资料'},
 ]}}};
 const row=M.buildCustomers(state)[0];
 const options={state,tab:'activity',activitySearchOpen:true,activityQuery:'sample',activityAdvanced:{startDate:'2026-09-22',endDate:'2026-09-23',contact:'Alice',owner:'Mira',types:['followup']},escape:M.escapeHtml};
 const html=D.render(row,options);
 assert.match(html,/Alice sample call/);
 assert.doesNotMatch(html,/Bob sample call|Alice sample email|Alice WhatsApp|Alice TM|更新客户资料/);
 assert.match(html,/全部\(3\)/);
 assert.match(html,/找到 1 条动态/);
 assert.match(html,/data-action="activity-advanced-filter"[^>]*aria-label="筛选动态"/);
 const none=D.render(row,{...options,activityFilter:'email'});
 assert.match(none,/暂无数据/);
 const channel=D.render(row,{...options,activitySearchOpen:false,activityQuery:'',activityFilter:'all',activityAdvanced:{types:['chat:whatsapp']}});
 assert.match(channel,/Alice WhatsApp/);
 assert.doesNotMatch(channel,/Alice TM|Alice sample call/);
});
test('typed profile operations appear in operation history but not customer activity',()=>{
 const state={orders:[],customers:{Acme:{contact:'Main',history:[
  {time:'2026-09-23T12:00:00Z',type:'operation',text:'批量添加客户标签：VIP'},
  {time:'2026-09-22T10:00:00Z',type:'followup',text:'Called customer'},
  {time:'2026-09-21T10:00:00Z',type:'email',text:'Received email'},
 ]}}};
 const row=M.buildCustomers(state)[0];
 const activity=D.render(row,{state,tab:'activity',escape:M.escapeHtml});
 assert.doesNotMatch(activity,/批量添加客户标签：VIP/);
 assert.match(activity,/Called customer|Received email/);
 const history=D.render(row,{state,tab:'history',escape:M.escapeHtml});
 assert.match(history,/批量添加客户标签：VIP/);
 assert.doesNotMatch(history,/Called customer|Received email/);
});
test('known legacy profile events remain in operation history without appearing in Other activity',()=>{
 const state={orders:[],customers:{Acme:{contact:'Main',history:[
  {time:'2026-09-23T12:00:00Z',text:'新建客户档案'},
  {time:'2026-09-22T10:00:00Z',text:'Customer replied',type:'chat'},
  {time:'2026-09-21T10:00:00Z',text:'Unclassified imported event'},
  {time:'2026-09-24T12:00:00Z',text:'更新：联系电话：空 → 已填写'},
  {time:'2026-09-25T12:00:00Z',text:'合并客户档案：副档案 → 主档案'},
 ]}}};
 const row=M.buildCustomers(state)[0];
 const activity=D.render(row,{state,tab:'activity',activityFilter:'other',escape:M.escapeHtml});
 assert.doesNotMatch(activity,/新建客户档案/);
 assert.doesNotMatch(activity,/更新：联系电话|合并客户档案：/);
 assert.match(activity,/Unclassified imported event/);
 const history=D.render(row,{state,tab:'history',escape:M.escapeHtml});
 assert.match(history,/新建客户档案/);
 assert.match(history,/更新：联系电话|合并客户档案：/);
 assert.match(history,/2026-09-23 \d{2}:00:00/);
 assert.doesNotMatch(history,/2026-09-23T12:00:00Z/);
 assert.doesNotMatch(history,/Customer replied/);
});

test('operation history exposes expandable local record details instead of a placeholder',()=>{
 const state={customers:{Acme:{history:[
  {type:'operation',time:'2026-09-23T10:00:00Z',text:'更新客户资料',owner:'Mira'},
 ]}},orders:[]};
 const row=M.buildCustomers(state)[0];
 const html=D.render(row,{state,tab:'history',escape:M.escapeHtml});
 assert.match(html,/data-action="toggle-operation"/);
 assert.match(html,/aria-expanded="false"/);
 assert.match(html,/aria-hidden="true"/);
 assert.match(html,/操作时间/);
 assert.match(html,/操作人/);
 assert.match(html,/Mira/);
 assert.doesNotMatch(html,/data-feature="查看操作详情"/);
});

test('operation history makes the full time and description row an accessible disclosure',()=>{
 const state={customers:{Acme:{history:[
  {type:'operation',time:'2026-09-23T10:00:00Z',text:'更新客户资料',owner:'Mira'},
 ]}},orders:[]};
 const html=D.render(M.buildCustomers(state)[0],{state,tab:'history',escape:M.escapeHtml});
 const header=html.match(/<button[^>]*data-action="toggle-operation"[^>]*>([\s\S]*?)<\/button>/)?.[1]||'';
 assert.match(header,/<time[^>]*>[^<]+<\/time>/);
 assert.match(header,/更新客户资料/);
 assert.match(header,/aria-hidden="true"/);
});

test('activity records expose only their saved detail fields through a real expansion control',()=>{
 const state={customers:{Acme:{history:[
  {type:'chat',time:'2026-09-23T10:00:00Z',text:'Asked for samples',owner:'Mira',contact:'Alice',channel:'WhatsApp'},
 ]}},orders:[]};
 const row=M.buildCustomers(state)[0];
 const html=D.render(row,{state,tab:'activity',now:'2026-09-23T10:30:00Z',escape:M.escapeHtml});
 assert.match(html,/data-action="toggle-activity-detail"/);
 assert.match(html,/aria-expanded="false"/);
 assert.match(html,/aria-hidden="true"/);
 assert.match(html,/操作人<\/dt><dd>Mira/);
 assert.match(html,/联系人<\/dt><dd>Alice/);
 assert.match(html,/渠道<\/dt><dd>WhatsApp/);
 assert.match(html,/Asked for samples/);
 assert.doesNotMatch(html,/data-feature="查看动态详情"/);
 const noExtras={customers:{Acme:{history:[{type:'followup',subtype:'quick',time:'2026-09-23T11:00:00Z',text:'Quick note'}]}},orders:[]};
 const plain=D.render(M.buildCustomers(noExtras)[0],{state:noExtras,tab:'activity',now:'2026-09-23T11:30:00Z',escape:M.escapeHtml});
 assert.doesNotMatch(plain,/联系人<\/dt>|渠道<\/dt>|操作人<\/dt>/);
});

test('trade metrics use saved opportunity fields without substituting order totals', () => {
  const state = {
    orders: [{id:'order-1',client:'Acme',amount:9000,currency:'USD',stage:'done',createdAt:'2026-09-20'}],
    customers: {Acme: {
      contact:'Main', opportunityTotal:1234.5, opportunityAverage:617.25,
      opportunityCount:2, activeOpportunityCount:1,
      opportunityFirstWonDate:'2026-01-02', opportunityLastWonDate:'2026-08-09',
    }},
  };
  const row = S.enrich(M.buildCustomers(state),state)[0];
  const html = D.render(row, {state,tab:'trade',escape:M.escapeHtml,money:v=>Number(v).toFixed(2)});
  const metrics = html.match(/<div class="lcd-metrics">([\s\S]*?)<\/div><div class="lcd-table-scroll">/)?.[1] || '';
  assert.match(metrics, /赢单商机金额\(USD\)<\/span><strong>1234\.50<\/strong>/);
  assert.match(metrics, /赢单商机均价\(USD\)<\/span><strong>617\.25<\/strong>/);
  assert.match(metrics, /首次赢单日期 ⓘ<\/span><strong>2026-01-02<\/strong>/);
  assert.match(metrics, /最近赢单日期 ⓘ<\/span><strong>2026-08-09<\/strong>/);
  assert.match(metrics, /进行中的商机数 ⓘ<\/span><strong>1<\/strong>/);
  assert.match(metrics, /赢单商机数<\/span><strong>2<\/strong>/);
  assert.match(html, /进行中的商机 （1）/);
  assert.doesNotMatch(metrics, /9000/);

  const noOpportunity = {orders:state.orders,customers:{Acme:{contact:'Main'}}};
  const emptyRow = S.enrich(M.buildCustomers(noOpportunity),noOpportunity)[0];
  const emptyHtml = D.render(emptyRow, {state:noOpportunity,tab:'trade',escape:M.escapeHtml});
  const emptyMetrics = emptyHtml.match(/<div class="lcd-metrics">([\s\S]*?)<\/div><div class="lcd-table-scroll">/)?.[1] || '';
  assert.match(emptyMetrics, /赢单商机金额\(USD\)<\/span><strong>—<\/strong>/);
  assert.match(emptyHtml, /进行中的商机 （—）/);
  assert.match(emptyHtml, /class="lcd-card lcd-opportunity is-empty k-card"/);
  assert.doesNotMatch(emptyHtml, /class="lcd-opportunity-row"|class="lcd-phases"/);
  assert.doesNotMatch(emptyMetrics, /9000/);
});

test('saved zero active opportunities render the captured single-row detail empty state', () => {
  const state={orders:[],customers:{Acme:{activeOpportunityCount:0}}};
  const html=D.render(M.buildCustomers(state)[0],{state,escape:M.escapeHtml});
  assert.match(html,/class="lcd-card lcd-opportunity is-empty k-card"/);
  assert.match(html,/进行中的商机 （0）/);
  assert.doesNotMatch(html,/class="lcd-opportunity-row"|class="lcd-phases"/);
  assert.match(html,/计划日程 （0）/);
});

test('customer documents search matches only this customer’s attachment names and keeps honest counts',()=>{
 const state={customers:{Acme:{},Other:{}},orders:[
  {id:'a',num:'SO-1',client:'Acme',attachments:[{name:'Résumé.pdf'},{fileName:'Invoice.png'}]},
  {id:'b',num:'SO-2',client:'Other',attachments:[{name:'Resume from other.pdf'}]},
 ]};
 const row=M.buildCustomers(state).find(customer=>customer.name==='Acme');
 const all=D.render(row,{state,tab:'documents',escape:M.escapeHtml});
 assert.match(all,/data-action="document-search"/);
 assert.match(all,/Résumé\.pdf|Invoice\.png/);
 assert.doesNotMatch(all,/Resume from other\.pdf/);
 assert.match(all,/共 2 条/);
 const matched=D.render(row,{state,tab:'documents',documentQuery:'resume',escape:M.escapeHtml});
 assert.match(matched,/Résumé\.pdf/);
 assert.doesNotMatch(matched,/Invoice\.png|Resume from other\.pdf/);
 assert.match(matched,/共 1 条/);
 const missing=D.render(row,{state,tab:'documents',documentQuery:'unknown',escape:M.escapeHtml});
 assert.match(missing,/未找到文档/);
 assert.match(missing,/共 0 条/);
});

test('customer documents paginate actual attachment rows and preserve selection by attachment',()=>{
 const state={customers:{Acme:{}},orders:[{id:'order-1',num:'SO-1',client:'Acme',amount:0,
  attachments:Array.from({length:25},(_,i)=>({name:`File ${String(i+1).padStart(2,'0')}.pdf`}))}]};
 const row=M.buildCustomers(state)[0];
 const options={state,tab:'documents',escape:M.escapeHtml};
 const first=D.render(row,{...options,documentPage:1,documentPageSize:20});
 assert.equal((first.match(/data-document-row=/g)||[]).length,20);
 assert.match(first,/File 01\.pdf/);
 assert.doesNotMatch(first,/File 21\.pdf/);
 assert.match(first,/共 25 条/);
 assert.match(first,/data-action="document-prev"[^>]*disabled/);
 assert.match(first,/data-action="document-next"/);
 const second=D.render(row,{...options,documentPage:2,documentPageSize:20,documentSelected:['order-1:20']});
 assert.equal((second.match(/data-document-row=/g)||[]).length,5);
 assert.doesNotMatch(second,/File 01\.pdf/);
 assert.match(second,/File 21\.pdf/);
 assert.match(second,/data-document-select="order-1:20"[^>]*checked/);
 assert.match(second,/data-action="document-next"[^>]*disabled/);
 assert.match(second,/已选 1 条/);
 const filtered=D.render(row,{...options,documentPage:2,documentPageSize:20,documentQuery:'File 03'});
 assert.equal((filtered.match(/data-document-row=/g)||[]).length,1);
 assert.match(filtered,/File 03\.pdf/);
 assert.match(filtered,/共 1 条/);
 assert.match(filtered,/data-action="document-prev"[^>]*disabled/);
 const larger=D.render(row,{...options,documentPage:1,documentPageSize:50});
 assert.equal((larger.match(/data-document-row=/g)||[]).length,25);
 assert.match(larger,/50 条\/页/);
});

test('customer document names fall back to the source attachment type without fabricating folder or upload method',()=>{
 const state={customers:{Acme:{}},orders:[{id:'order-1',num:'SO-1',client:'Acme',amount:0,
  attachments:[{type:'图片附件',fileUrl:'/attachments/local/image.png'}]}]};
 const row=M.buildCustomers(state)[0];
 const all=D.render(row,{state,tab:'documents',escape:M.escapeHtml});
 assert.match(all,/选择文档 图片附件/);
 assert.match(all,/<td>图片附件<\/td>/);
 assert.doesNotMatch(all,/data-feature="(预览文档|文档操作|筛选文档|添加文档|文档更多操作)"/);
 assert.match(all,/<td>—<\/td><td>销售订单 SO-1<\/td><td>—<\/td><\/tr>/);
 const matched=D.render(row,{state,tab:'documents',documentQuery:'图片',escape:M.escapeHtml});
 assert.match(matched,/共 1 条/);
 assert.doesNotMatch(matched,/未找到文档/);
});

test('customer detail more button opens the local customer actions', () => {
  const state={orders:[],customers:{Acme:{contact:'Main'}}};
  const html=D.render(M.buildCustomers(state)[0],{state,escape:M.escapeHtml});
  assert.match(html,/<button[^>]*data-action="customer-actions"[^>]*aria-label="客户更多操作"/);
  assert.doesNotMatch(html,/data-feature="客户更多操作"/);
});

test('customer detail tag control opens local tag editing', () => {
  const state={orders:[],customers:{Acme:{tags:['Existing']}}};
  const html=D.render(M.buildCustomers(state)[0],{state,escape:M.escapeHtml});
  assert.match(html,/data-action="customer-tags"[^>]*aria-label="设置客户标签"/);
  assert.doesNotMatch(html,/data-feature="设置客户标签"/);
});

test('contact tools retain each contact index for local search and editing', () => {
  const state={orders:[],customers:{Acme:{
    contacts:['Main','Second'],emails:['main@example.test','second@example.test'],
    extraContacts:[{id:'second',contact:'Second',email:'second@example.test'}],
  }}};
  const html=D.render(M.buildCustomers(state)[0],{state,escape:M.escapeHtml});
  assert.match(html,/data-action="contact-search"[^>]*aria-label="搜索联系人"/);
  assert.match(html,/class="lcd-contact-search-row" hidden/);
  assert.match(html,/id="contact-search-input"/);
  assert.match(html,/id="contact-search-empty"[^>]*hidden/);
  const cards=[...html.matchAll(/<article class="lcd-contact"[^>]*>([\s\S]*?)<\/article>/g)];
  assert.equal(cards.length,2);
  assert.match(cards[0][0],/data-contact-index="0"/);
  assert.match(cards[0][0],/data-contact-more="0"/);
  assert.match(cards[1][0],/data-contact-index="1"/);
  assert.match(cards[1][0],/data-contact-more="1"/);
  assert.doesNotMatch(html,/data-feature="搜索联系人"|data-feature="联系人更多操作"/);
});

test('every contact card with an email gets its own 写邮件 button carrying that address', () => {
  const state={orders:[],customers:{Acme:{
    contact:'Main',email:'main@example.test',contacts:['Main','Second','Third'],
    extraContacts:[{id:'second',contact:'Second',email:'second@example.test'},{id:'third',contact:'Third'}],
  }}};
  const html=D.render(M.buildCustomers(state)[0],{state,escape:M.escapeHtml});
  const cards=[...html.matchAll(/<article class="lcd-contact"[^>]*>([\s\S]*?)<\/article>/g)].map(match=>match[0]);
  assert.equal(cards.length,3);
  assert.match(cards[0],/data-feature="写邮件" data-mail-to="main@example\.test" data-mail-contact="Main" aria-label="写邮件给Main"/);
  assert.match(cards[1],/data-feature="写邮件" data-mail-to="second@example\.test" data-mail-contact="Second" aria-label="写邮件给Second"/);
  assert.doesNotMatch(cards[2],/data-feature="写邮件"/,'no email, no button');
});

test('a blank primary contact slot does not shift additional contact fields or edit targets', () => {
  const state={orders:[],customers:{Acme:{
    contacts:['','Second'],emails:['main@example.test','second@example.test'],
    extraContacts:[{id:'second',contact:'Second',email:'second@example.test',alibabaId:'SECOND-ID'}],
  }}};
  const html=D.render(M.buildCustomers(state)[0],{state,escape:M.escapeHtml});
  const cards=[...html.matchAll(/<article class="lcd-contact"[^>]*>([\s\S]*?)<\/article>/g)].map(match=>match[0]);
  assert.equal(cards.length,2);
  assert.match(cards[0],/data-contact-index="0"/);
  assert.match(cards[0],/main@example\.test/);
  assert.doesNotMatch(cards[0],/SECOND-ID/);
  assert.match(cards[1],/data-contact-index="1"/);
  assert.match(cards[1],/data-contact-more="1"/);
  assert.match(cards[1],/second@example\.test/);
  assert.match(cards[1],/SECOND-ID/);
});

test('aligned secondary contact methods remain visible without a saved secondary name',()=>{
 const state={orders:[],customers:{Acme:{contacts:[''],emails:['','second@example.test'],
  phones:['','222'],addresses:['','Berlin']}}};
 const before=structuredClone(state);
 const row=M.buildCustomers(state)[0];
 const html=D.render(row,{state,escape:M.escapeHtml});
 const cards=[...html.matchAll(/<article class="lcd-contact"[^>]*>[\s\S]*?<\/article>/g)].map(match=>match[0]);
 assert.equal(row.contactCount,2);
 assert.match(html,/联系人\(2\)/);
 assert.equal(cards.length,2);
 assert.match(cards[0],/data-contact-index="0"/);
 assert.doesNotMatch(cards[0],/second@example\.test|222|Berlin/);
 assert.match(cards[1],/data-contact-index="1"/);
 assert.match(cards[1],/class="lcd-contact-title"><strong>—<\/strong>/);
 assert.match(cards[1],/second@example\.test/);
 assert.match(cards[1],/<dt>联系电话<\/dt><dd>222<\/dd>/);
 assert.match(cards[1],/<dt>地址<\/dt><dd>Berlin<\/dd>/);
 assert.deepEqual(state,before);
});

 test('followup category exposes old records directly while all and other retain groups',()=>{
 const state={orders:[],customers:{Acme:{history:[
 {type:'followup',time:'2024-07-31T10:00:00Z',text:'Latest old call'},
 {type:'followup',time:'2022-10-25T10:00:00Z',text:'Earliest old call'},
 {type:'created',time:'2023-01-01T10:00:00Z',text:'Created account'},
 ]}}};const before=structuredClone(state);const row=M.buildCustomers(state)[0];
 const options={state,tab:'activity',now:'2026-09-27T10:00:00Z',escape:M.escapeHtml};
 const follow=D.render(row,{...options,activityFilter:'followup'});
 assert.doesNotMatch(follow,/data-timeline-group=/);
 assert.match(follow,/Latest old call/);assert.match(follow,/Earliest old call/);
 assert.doesNotMatch(follow,/Created account/);
 const oldest=D.render(row,{...options,activityFilter:'followup',activitySort:'oldest'});
 assert.ok(oldest.indexOf('Earliest old call')<oldest.indexOf('Latest old call'));
 const all=D.render(row,options);assert.match(all,/data-timeline-group="year:2024"/);
 const other=D.render(row,{...options,activityFilter:'other'});assert.match(other,/data-timeline-group="year:2023"/);
 assert.deepEqual(state,before);
 });


test('sales-order create button is actionable and identifies the current company without an informational placeholder', () => {
 const state={customers:{'Company <A>':{}},orders:[]};
 const html=D.render(M.buildCustomers(state)[0],{state,tab:'trade',escape:M.escapeHtml});
 assert.match(html,/data-new-customer-order="Company &lt;A&gt;"/);
 assert.doesNotMatch(html,/data-feature="新建销售订单"/);
});

test('商机和订单 tab and the side order card are hidden for a role without opp.view / order.view',()=>{
 const R=require('../src/role-model.js');
 const admin={laiSettings:{defaultOwner:'Kris'},customers:{Acme:{owner:'Amy',history:[]}},orders:[{id:'o1',num:'L-1',client:'Acme',owner:'Amy',amount:'10',currency:'USD',stage:'quote',createdAt:'2026-10-01',attachments:[{name:'inv.pdf'}]}]};
 const members=R.settings(admin).members;
 const amyMember=members.find(m=>m.roleId==='sales'),adminMember=members.find(m=>m.roleId==='admin');
 const asAmy=R.switchTo(admin,amyMember.id);
 const render=(state,extra={})=>D.render(M.buildCustomers(state)[0],{state,tab:'trade',sideColumn:true,escape:M.escapeHtml,...extra});
 global.LaiRoleModel=R;
 try{
  const full=render(asAmy);
  assert.match(full,/data-tab="trade"/);
  assert.match(full,/data-lai-order="o1"/);
  assert.match(full,/inv\.pdf/);
  const keys=Object.keys(R.roleOf(asAmy).perms).filter(k=>R.roleOf(asAmy).perms[k]);
  assert.ok(keys.includes('order.view')&&keys.includes('opp.view'));
  const base=Object.fromEntries(keys.filter(k=>k!=='order.view'&&k!=='opp.view').map(k=>[k,true]));
  const asAdmin=R.switchTo(admin,adminMember.id);
  const edit=perms=>R.switchTo(R.updateRole(asAdmin,amyMember.roleId,{perms}),amyMember.id);
  const hidden=render(edit(base));
  assert.doesNotMatch(hidden,/data-tab="trade"/,'the tab is gone');
  assert.doesNotMatch(hidden,/data-lai-order=/,'no order links, in the tab or the side card');
  assert.doesNotMatch(hidden,/inv\.pdf/,'order attachments are not listed either');
  assert.doesNotMatch(hidden,/进行中的商机/,'the in-progress opportunity card is gone');
  const stale=render(edit(base),{tab:'trade'});
  assert.match(stale,/你的角色不能查看商机和订单/);
  const onlyOpp=render(edit({...base,'opp.view':true}));
  assert.match(onlyOpp,/data-tab="trade"/);
  assert.match(onlyOpp,/lcd-opportunity-table/);
  assert.doesNotMatch(onlyOpp,/data-lai-order=|销售订单 \(/);
 }finally{delete global.LaiRoleModel;}
});
