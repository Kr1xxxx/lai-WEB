const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const M=require('../src/model.js');
const S=require('../src/segments.js');
const O=require('../src/opportunity-model.js');
const D=require('../src/customer-detail-ui.js');
const fixture=()=>({customers:{Aurora:{}},orders:[{id:'o1',client:'Aurora',num:'SO-1',amount:2500,paidAmount:750,currency:'USD',stage:'shipment',createdAt:'2026-10-07',sourceOpportunityId:'p1'}],laiOpportunities:[{id:'p1',name:'500盒首单',client:'Aurora',amount:2500,currency:'USD',stage:'balance',flow:'default',createdAt:'2026-10-01',closedAt:'2026-10-07',orderId:'o1',products:[{name:'测试睫毛',quantity:500,unitPrice:5}]}]});
test('customer receivables keep the unpaid balance after shipping and preserve currency totals',()=>{
 const s=fixture();s.orders.push({id:'o2',client:'Aurora',currency:'EUR',amount:100,paidAmount:25,stage:'done'},{id:'draft',client:'Aurora',currency:'USD',amount:99999,isDraft:true});
 const before=structuredClone(s),row=M.buildCustomers(s)[0];
 assert.equal(row.orderAmounts.find(x=>x.currency==='USD').paid,750);
 assert.equal(row.orderAmounts.find(x=>x.currency==='USD').due,1750);
 assert.equal(row.orderAmounts.find(x=>x.currency==='EUR').due,75);
 assert.equal(M.filterCustomers([row],{group:'due'}).length,1);
 assert.deepEqual(s,before);
});
test('single-currency customer balance uses entered payment, not shipment or completion',()=>{
 const row=M.buildCustomers(fixture())[0];assert.equal(row.paid,750);assert.equal(row.due,1750);
});
test('customer list pipeline derives live opportunity numbers and dates rather than stale profile values',()=>{
 const state=fixture();state.customers.Aurora={opportunityTotal:99999,opportunityCount:88};
 const source=fs.readFileSync(require.resolve('../src/app.js'),'utf8');
 const body=source.slice(source.indexOf('  const allCustomerRows ='),source.indexOf('  function rebuildRows()'));
 const context=vm.createContext({state,M,S,window:{LaiOpportunityModel:O}});
 vm.runInContext(body+';globalThis.rowsResult=allCustomerRows();',context);
 const row=context.rowsResult[0];assert.equal(row.opportunityTotal,2500);assert.equal(row.opportunityCount,1);assert.equal(row.lastWonDate,'2026-10-07');
});
test('trade tab renders actual opportunity/product records and linked order debt instead of empty placeholders',()=>{
 const s=fixture(),c={...M.buildCustomers(s)[0],...O.customerStats(s,'Aurora')};
 const html=D.render(c,{state:s,tab:'trade',escape:M.escapeHtml,money:v=>Number(v).toFixed(2)});
 assert.match(html,/500盒首单/);assert.match(html,/测试睫毛/);assert.match(html,/500/);assert.match(html,/1750\.00/);
 assert.doesNotMatch(html,/暂无商机数据|暂无关联产品数据/);
 assert.match(html,/data-feature="商机记录:p1"/);assert.match(html,/data-lai-order="o1"/);
});
test('trade detail distinguishes absent payment data and escapes business names',()=>{
 const s=fixture();s.orders[0].paidAmount=null;s.laiOpportunities[0].name='<img src=x onerror=boom>';
 const html=D.render({...M.buildCustomers(s)[0],...O.customerStats(s,'Aurora')},{state:s,tab:'trade',escape:M.escapeHtml});
 assert.match(html,/未记录/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img src=x/);
});

test('draft linked orders explicitly exclude both payment cells from financial totals',()=>{
 const s=fixture();s.orders[0].isDraft=true;
 const html=D.render({...M.buildCustomers(s)[0],...O.customerStats(s,'Aurora')},{state:s,tab:'trade',escape:M.escapeHtml});
 assert.equal((html.match(/草稿不计/g)||[]).length,2);
});

test('customer order count retains zero and missing amounts for financial reconciliation',()=>{
 const s={customers:{Audit:{}},orders:[{id:'zero',client:'Audit',amount:0,paidAmount:0,currency:'USD'},{id:'missing',client:'Audit',paidAmount:null,currency:'USD'}]};
 const row=M.buildCustomers(s)[0];assert.equal(row.orderCount,2);assert.equal(row.orders.length,2);assert.equal(row.orderAmounts[0].count,2);
});
test('customer due uses the rounded ledger balance without floating point residue',()=>{
 const s={customers:{Audit:{}},orders:[{id:'decimal',client:'Audit',amount:0.3,paidAmount:0.2,currency:'USD',stage:'deposit'}]};
 assert.equal(M.buildCustomers(s)[0].due,0.1);
});

test('rule-segment labels are calculated from the same live win date displayed in the list',()=>{
 const state=fixture();state.customers.Aurora.opportunityLastWonDate='2020-01-01';
 state.previewSegments=[{id:'recent',name:'十月赢单',kind:'rules',match:'all',rules:[{field:'lastWonDate',op:'after',value:'2026-10-01'}]}];
 const source=fs.readFileSync(require.resolve('../src/app.js'),'utf8');
 const body=source.slice(source.indexOf('  const allCustomerRows ='),source.indexOf('  function rebuildRows()'));
 const context=vm.createContext({state,M,S,window:{LaiOpportunityModel:O}});
 vm.runInContext(body+';globalThis.rowsResult=allCustomerRows();',context);
 const row=context.rowsResult[0];assert.equal(row.lastWonDate,'2026-10-07');assert.ok(row.segments.includes('十月赢单'));
});

test('customer order detail excludes records marked archived or deleted even in the active array',()=>{
 const s=fixture();for(const flag of ['trashedAt','deletedAt','archived'])s.orders.push({...s.orders[0],id:flag,[flag]:flag==='archived'?true:'2026-10-01'});
 const row=M.buildCustomers(s)[0];assert.equal(row.orders.length,1);assert.equal(row.orderCount,row.orderAmounts[0].count);
});

test('trade financial summary explains incomplete receivables when order amount is unknown but receipt exists',()=>{
 const s={customers:{Audit:{}},orders:[{id:'unknown',num:'U-1',client:'Audit',paidAmount:25,currency:'USD',stage:'done'}]};
 const c=M.buildCustomers(s)[0];
 assert.equal(c.orderAmounts[0].paid,25);assert.equal(c.orderAmounts[0].due,0);
 const html=D.render(c,{state:s,tab:'trade',escape:M.escapeHtml,money:v=>Number(v).toFixed(2)});
 assert.match(html,/1 笔订单金额未记录或无效/);
 assert.match(html,/订单金额与待收款汇总不完整/);
 assert.match(html,/已记录实收仍计入汇总/);
 assert.match(html,/25\.00/);
});
test('trade financial summary flags overpayment without netting it against another order debt',()=>{
 const s={customers:{Audit:{}},orders:[{id:'over',num:'O-1',client:'Audit',amount:100,paidAmount:150,currency:'USD'}, {id:'due',num:'D-1',client:'Audit',amount:100,paidAmount:0,currency:'USD'}]};
 const c=M.buildCustomers(s)[0];
 assert.equal(c.orderAmounts[0].paid,150);assert.equal(c.orderAmounts[0].due,100);
 const html=D.render(c,{state:s,tab:'trade',escape:M.escapeHtml,money:v=>Number(v).toFixed(2)});
 assert.match(html,/1 笔订单实收超过订单金额/);
 assert.match(html,/实收按原数保留/);
 assert.match(html,/超收部分不抵减其他订单待收/);
 assert.match(html,/请核对订单金额和到账记录/);
});
test('trade financial summary does not show anomaly prompts for ordinary reconciled orders',()=>{
 const s=fixture();
 const html=D.render(M.buildCustomers(s)[0],{state:s,tab:'trade',escape:M.escapeHtml});
 assert.doesNotMatch(html,/订单金额与待收款汇总不完整|笔订单实收超过订单金额/);
});
