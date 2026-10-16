const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../src/model.js'),T=require('../src/customer-tools.js'),L=require('../src/modules.js'),S=require('../src/segments.js'),CS=require('../src/customer-settings-model.js');
const mk=(n)=>({customers:Object.fromEntries(Array.from({length:n},(_,i)=>['C'+i,{client:'C'+i,country:'US',source:'web'}])),orders:[]});

test('batch follow-up on many customers stays fast',()=>{
  const s=mk(10000),names=Array.from({length:200},(_,i)=>'C'+i*10);
  const t=Date.now();
  const out=M.batchAddFollowup(s,names,'hello');
  assert.ok(Date.now()-t<1000,'took '+(Date.now()-t));
  assert.equal(out.customers.C0.history[0].text,'hello');
  const t2=Date.now();
  M.batchSetCustomerNextFollow(s,names,'2026-12-01');
  assert.ok(Date.now()-t2<1000);
  assert.throws(()=>M.addFollowup(s,'nobody','x'),/客户不存在/);
  assert.throws(()=>M.setCustomerNextFollow(s,'nobody','2026-12-01'),/客户不存在/);
});
test('order-only customers still count as existing',()=>{
  const s={customers:{},orders:[{id:1,client:'O',amount:1}]};
  assert.ok(M.addFollowup(s,'O','hi').customers.O);
});
test('duplicate name check ignores case, spaces and full/half width',()=>{
  const s={customers:{'Acme Co':{client:'Acme Co'}},orders:[]};
  for(const n of ['ACME CO','acme   co','Ａｃｍｅ　Ｃｏ',' Acme Co '])
    assert.throws(()=>M.upsertCustomer(s,'',{name:n,country:'US',source:'x'}),/已存在/,n);
  const ok=M.upsertCustomer(s,'',{name:'Acme  Corp',country:'US',source:'x'});
  assert.ok(ok.customers['Acme  Corp']);
  assert.equal(M.nameKey('Ａ  b'),'a b');
});
test('rename repoints opportunities and tasks',()=>{
  const s={customers:{Old:{client:'Old',country:'US',source:'x'}},orders:[],laiOpportunities:[{id:1,client:'Old'},{id:2,client:'Z'}],laiTasks:[{id:1,customer:'Old'}]};
  const out=M.upsertCustomer(s,'Old',{name:'New'});
  assert.equal(out.laiOpportunities[0].client,'New');assert.equal(out.laiOpportunities[1].client,'Z');
  assert.equal(out.laiTasks[0].customer,'New');
});
test('star rating 0 means empty and can clear',()=>{
  const s={customers:{A:{client:'A',customerStars:'3'}},orders:[]};
  assert.equal(M.upsertCustomer(s,'A',{name:'A',customerStars:'0'}).customers.A.customerStars,'');
  assert.equal(M.upsertCustomer(s,'A',{name:'A',customerStars:0}).customers.A.customerStars,'');
  assert.equal(M.upsertCustomer(s,'A',{name:'A',customerStars:'4'}).customers.A.customerStars,'4');
});
test('merge fills every empty scalar profile field',()=>{
  const s={customers:{
    P:{client:'P',customerCode:'',country:'US'},
    Q:{client:'Q',customerCode:'C-9',customerStars:'4',timezone:'UTC+8',customerType:'贸易商',shortName:'Q',companyAddress:'Addr',laiBucket:'pool',laiPreviousOwner:'Zed',poolEntryCount:3},
    R:{client:'R',customerStars:'2',timezone:'UTC+1',companyRemark:'r'}},orders:[]};
  const b=T.mergeCustomers(s,'P',['Q','R']).customers.P;
  assert.equal(b.customerCode,'C-9');assert.equal(b.customerStars,'4');assert.equal(b.timezone,'UTC+8');
  assert.equal(b.customerType,'贸易商');assert.equal(b.shortName,'Q');assert.equal(b.companyAddress,'Addr');assert.equal(b.companyRemark,'r');
  assert.equal(b.laiBucket,undefined);assert.equal(b.laiPreviousOwner,undefined);assert.equal(b.poolEntryCount,undefined);
});
test('a broken segment does not break the others',()=>{
  const state={customers:{A:{client:'A'},B:{client:'B'}},orders:[],previewSegments:[
    {id:'1',name:'bad',kind:'rules',match:'all',rules:[{field:'nope',op:'eq',value:'x'}]},
    {id:'2',name:'good',kind:'manual',members:['A']}]};
  const rows=S.enrich(M.buildCustomers(state),state);
  assert.deepEqual(rows.find(r=>r.name==='A').segments,['good']);
  assert.throws(()=>S.filterByRules([],{rules:[{field:'previewFollowed',op:'eq',value:'maybe'}]}),/请选择是或否|未知/);
});
test('duplicate check ignores short phones and non-emails',()=>{
  const s={customers:{A:{phone:'12345',email:'-'},B:{phone:'12345',email:'-'},C:{phone:'+1 555 123 4567',email:'x@y.com'},D:{phone:'15551234567',email:'x@y.com'}},orders:[]};
  const g=L.findDuplicates(s);
  assert.deepEqual(g.map(x=>x.type).sort(),['电话','邮箱']);
  assert.ok(g.every(x=>x.names.every(n=>['C','D'].includes(n))));
});
test('customer cap owner match ignores case and spaces',()=>{
  const s={customers:{A:{owner:'kris'},B:{owner:' KRIS '}},orders:[]};
  assert.equal(CS.ownerCount(s,'Kris'),2);
});
