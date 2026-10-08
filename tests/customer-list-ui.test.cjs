const test=require('node:test');const assert=require('node:assert/strict');
const UI=require('../src/customer-list-ui.js');const M=require('../src/model.js');const S=require('../src/segments.js');const F=require('../src/customer-fields.js');
const row={name:'A <B>',country:'美国',tags:[],owner:'Kris',orderCount:1,orders:[],history:[],followed:false};
function render(extra={}){return UI.render({rows:[row],p:{items:[row],total:1,page:1,pageCount:1},filters:{group:'all',field:'country',query:'',owner:''},selected:new Set(),pageSize:20,segments:[],groupTab:'groups',expanded:new Set(),team:'team',icon:n=>`<svg data-icon="${n}"></svg>`,escape:M.escapeHtml,countryLabel:F.countryLabel,tableMarkup:()=>'<table data-live-customer-table></table>',...extra});}
test('followup group count uses the same due customers as its list and excludes future dates',()=>{
 const rows=[{...row,name:'Yesterday',nextFollow:'2000-01-01'},{...row,name:'Future',nextFollow:'9999-01-01'},{...row,name:'Empty',nextFollow:''}];
 const count=M.filterCustomers(rows,{group:'followup'}).length;
 assert.equal(count,1);
 assert.match(render({rows,followupCount:count}),/data-group="followup"[^>]*><span>待跟进客户<\/span><small>1<\/small>/);
});
test('future-only followup group displays zero rather than the number of planned dates',()=>{
 const rows=[{...row,nextFollow:'9999-01-01'}];
 assert.match(render({rows,followupCount:0}),/data-group="followup"[^>]*><span>待跟进客户<\/span><small>0<\/small>/);
});
test('reference list retains global customer controls and live table without legacy navigation',()=>{const html=render();for(const label of ['客户列表','我的客户','团队客户','选择部门或业务员','AI 客群','新建客户','国家地区'])assert.ok(html.includes(label),label);assert.doesNotMatch(html,/客群新特性|class="banner/,'AI 客群新特性横幅已删除');assert.ok(html.includes('data-live-customer-table'));assert.ok(!html.includes('orders.html'));assert.ok(!html.includes('6,862'));});
test('top customer search has its captured onboarding empty state without changing quick-filter empty state',()=>{
 const p={items:[],total:0,page:1,pageCount:1};
 const global=render({p,globalSearch:{field:'customerCode',query:'NO_MATCH'}});
 assert.match(global,/Hi~ 马上添加客户，体验先进的客户管理系统吧/);
 assert.match(global,/class="global-search-empty"/);
 assert.match(global,/data-action="new"[^>]*>新建客户<\/button>/);
 assert.doesNotMatch(global,/data-action="import-customers"/);
 assert.match(render({p,globalSearch:{field:'customerCode',query:'NO_MATCH'},importEnabled:true}),/data-action="import-customers"[^>]*>导入客户<\/button>/);
 assert.doesNotMatch(global,/class="empty-box"/);
 const quick=render({p,filters:{group:'all',field:'name',query:'NO_MATCH',owner:''},globalSearch:{field:'all',query:''}});
 assert.match(quick,/class="empty-box"/);
 assert.match(quick,/>暂无数据<\/span>/);
 assert.doesNotMatch(quick,/Hi~ 马上添加客户/);
});
test('selecting customers replaces standard toolbar with all reference batch actions',()=>{const html=render({selected:new Set(['A <B>'])});for(const label of ['跨页全选','写邮件','一键营销','设置标签','编辑字段','发送WhatsApp','写跟进','新建日程','移动至分组','更多'])assert.ok(html.includes(label),label);assert.ok(!html.includes('id="search-field"'));});
test('batch tag control opens the local tag editor',()=>{const html=render({selected:new Set(['A <B>'])});assert.match(html,/<button[^>]*data-action="batch-tags"[^>]*>设置标签<\/button>/);assert.doesNotMatch(html,/data-feature="设置标签"/);});
test('batch field control opens the local customer field editor',()=>{const html=render({selected:new Set(['A <B>'])});assert.match(html,/<button[^>]*data-action="batch-edit-field"[^>]*>编辑字段<\/button>/);assert.doesNotMatch(html,/data-feature="编辑字段"/);});
test('batch followup remains a real local action with multiple customers selected',()=>{const html=render({selected:new Set(['Alpha','Beta'])});assert.match(html,/<button[^>]*data-action="batch-followup"[^>]*>写跟进<\/button>/);assert.doesNotMatch(html,/data-feature="写跟进"/);});
test('real manual groups keep identity and escape their names',()=>{const html=render({segments:[{id:'x',name:'<img onerror=1>',kind:'manual',members:[row.name]}],expanded:new Set(['manual'])});assert.ok(html.includes('&lt;img onerror=1&gt;'));assert.ok(html.includes('segment:x'));assert.ok(!html.includes('<img onerror=1>'));});
test('country branch shows only countries with order-backed customers and matching counts',()=>{
 const rows=[
  {name:'US buyer',country:'美国',orderCount:1,tags:[]},
  {name:'US prospect',country:'美国',orderCount:0,tags:[]},
  {name:'FR buyer',country:'法国',orderCount:1,tags:[]},
  {name:'DE prospect',country:'德国',orderCount:0,tags:[]},
 ];
 const html=render({rows,expanded:new Set(['countries'])});
 assert.match(html,/title="🇺🇸 美国"><span>🇺🇸 美国<\/span><small>1<\/small>/);
 assert.match(html,/title="🇫🇷 法国"><span>🇫🇷 法国<\/span><small>1<\/small>/);
 assert.doesNotMatch(html,/data-group="country:🇩🇪 德国"/);
});
test('country branch merges equivalent saved country spellings into one customer group',()=>{
 const rows=[
  {name:'US code',country:'US',orderCount:1,tags:[]},
  {name:'US Chinese',country:'美国',orderCount:1,tags:[]},
  {name:'US English',country:'United States',orderCount:1,tags:[]},
  {name:'US prospect',country:'US',orderCount:0,tags:[]},
 ];
 const html=render({rows,expanded:new Set(['countries'])});
 assert.equal((html.match(/data-group="country:🇺🇸 美国"/g)||[]).length,1);
 assert.match(html,/title="🇺🇸 美国"><span>🇺🇸 美国<\/span><small>3<\/small>/);
 assert.doesNotMatch(html,/data-group="country:US"/);
});
test('ordinary customer filters expose their active count and clear action',()=>{
  const html=render({filters:{group:'all',field:'country',query:'',owner:'',email:'a@example.test',alibabaIdentity:'Buyer',customerStars:'5',followed:'false',tagMode:'包含全部'}});
  assert.match(html,/<span class="filter-count" aria-hidden="true">4<\/span>/);
  assert.match(html,/<span class="active-filters"><span class="filter-count-label">4 个筛选条件<\/span><button[^>]*data-action="reset-all">清空<\/button><\/span>/);
  assert.doesNotMatch(render({filters:{group:'all',field:'country',query:'',owner:'',tagMode:'包含全部'}}),/class="active-filters"/);
});
test('advanced rules count as active filters even without ordinary values',()=>{
  const html=render({advancedSpec:{match:'all',rules:[{field:'name',op:'contains',value:'A'},{field:'country',op:'equals',value:'美国'}]}});
  assert.match(html,/<span class="filter-count" aria-hidden="true">2<\/span>/);
  assert.match(html,/<span class="active-filters"><span class="filter-count-label">2 个筛选条件<\/span><button[^>]*data-action="reset-all">清空<\/button><\/span>/);
});
test('collapsed customer groups render a truthful reopen control after list refresh',()=>{
  const html=render({groupsCollapsed:true});
  assert.match(html,/class="panel replica-panel groups-collapsed/);
  assert.match(html,/data-action="collapse-groups" aria-label="展开客群" aria-expanded="false"><span class="collapse-groups-glyph">›<\/span><\/button>/);
});
test('customer tree branches keep an accessible controlled panel for smooth mouse toggles',()=>{
 const closed=render();
 assert.match(closed,/data-expand="won" aria-controls="group-branch-won" aria-expanded="false"/);
 assert.match(closed,/id="group-branch-won" class="group-branch-content" aria-hidden="true" inert/);
 assert.match(closed,/id="group-branch-won"[^>]*><div><button[^>]*data-group="won"/);
 const opened=render({expanded:new Set(['won'])});
 assert.match(opened,/data-expand="won" aria-controls="group-branch-won" aria-expanded="true"/);
 assert.match(opened,/id="group-branch-won" class="group-branch-content expanded" aria-hidden="false"/);
 assert.doesNotMatch(opened,/id="group-branch-won"[^>]*\sinert/);
});

test('pagination keeps the current page visible across first, middle and last customer pages',()=>{
 const controls=(page,count)=>render({p:{items:[row],total:count*20,page,pageCount:count}}).match(/<div class="pages">([\s\S]*?)<\/div>/)?.[1]||'';
 const first=controls(1,344);
 assert.match(first,/data-page="1" class="current" aria-current="page"/);
 for(const number of [2,3,344])assert.match(first,new RegExp(`data-page="${number}"`));
 assert.doesNotMatch(first,/data-page="4"/);
 const middle=controls(171,344);
 for(const number of [1,170,171,172,344])assert.match(middle,new RegExp(`data-page="${number}"`));
 assert.match(middle,/data-page="171" class="current" aria-current="page"/);
 const last=controls(344,344);
 for(const number of [1,342,343,344])assert.match(last,new RegExp(`data-page="${number}"`));
 assert.match(last,/data-page="344" class="current" aria-current="page"/);
 assert.doesNotMatch(last,/data-page="341"/);
 const short=controls(3,4);
 for(const number of [1,2,3,4])assert.match(short,new RegExp(`data-page="${number}"`));
 assert.doesNotMatch(short,/>…<\/span>/);
});
