const test=require('node:test'),assert=require('node:assert/strict');
const T=require('../src/customer-tools.js');
const M=require('../src/model.js');
const L=require('../src/modules.js');

const base=()=>({
  customers:{
    Acme:{client:'Acme',country:'美国',owner:'Kris',source:'展会',email:'a@acme.com',emails:['a@acme.com'],contact:'Amy',contacts:['Amy'],tags:['VIP'],nextFollow:'2026-11-10',note:'主客户',history:[{time:'2026-01-02T00:00:00.000Z',text:'新建',type:'operation'}]},
    'Acme Ltd':{client:'Acme Ltd',country:'美国',owner:'Mia',source:'官网',website:'acme.com',email:'b@acme.com',contact:'Bob',phone:'+1 555 0100',tags:['VIP','样品'],nextFollow:'2026-10-20',note:'重复档案',previewFollowed:true,history:[{time:'2026-03-05T00:00:00.000Z',text:'电话沟通',type:'followup'}]},
    Other:{client:'Other',country:'英国',owner:'Kris',source:'展会',tags:['样品'],createdAt:'2025-01-01T00:00:00.000Z'}
  },
  orders:[{id:'o1',client:'Acme Ltd',amount:100,stage:'quote'},{id:'o2',client:'Acme',amount:50,stage:'done'}],
  trashOrders:[{id:'o3',client:'Acme Ltd',amount:10}],
  laiTasks:[{id:'t1',title:'回电',customer:'Acme Ltd',date:'2026-10-10'}],
  laiOpportunities:[{id:'p1',name:'大单',client:'Acme Ltd'}],
  previewSegments:[{id:'s1',name:'重点',kind:'manual',members:['Acme Ltd','Other']},{id:'s2',name:'全部',kind:'manual',members:['Acme','Acme Ltd']}]
});

test('合并客户：订单、任务、商机、客群里的名字一起改，被合并的档案删除',()=>{
  const s0=base(),before=structuredClone(s0);
  const s=T.mergeCustomers(s0,'Acme',['Acme Ltd'],'2026-10-08T00:00:00.000Z');
  assert.deepEqual(s0,before,'输入不被修改');
  assert.equal(s.customers['Acme Ltd'],undefined);
  assert.deepEqual(s.orders.map(o=>o.client),['Acme','Acme']);
  assert.equal(s.trashOrders[0].client,'Acme');
  assert.equal(s.laiTasks[0].customer,'Acme');
  assert.equal(s.laiOpportunities[0].client,'Acme');
  assert.deepEqual(s.previewSegments[0].members,['Acme','Other']);
  assert.deepEqual(s.previewSegments[1].members,['Acme'],'同一客群里不会出现两次');
  assert.equal(M.buildCustomers(s).filter(c=>c.name.startsWith('Acme')).length,1);
  assert.equal(M.buildCustomers(s).find(c=>c.name==='Acme').orderCount,2);
});

test('合并客户：资料补空、标签并集、联系人去重、动态保留、下次跟进取最早',()=>{
  const s=T.mergeCustomers(base(),'Acme',['Acme Ltd'],'2026-10-08T00:00:00.000Z');
  const p=s.customers.Acme;
  assert.equal(p.owner,'Kris','保留客户已有的不被覆盖');
  assert.equal(p.website,'acme.com','空着的用被合并客户补上');
  assert.deepEqual(p.tags,['VIP','样品']);
  assert.equal(p.nextFollow,'2026-10-20');
  assert.equal(p.previewFollowed,true);
  assert.match(p.note,/主客户/);assert.match(p.note,/【来自 Acme Ltd】重复档案/);
  assert.equal(p.extraContacts.length,1);
  assert.equal(p.extraContacts[0].email,'b@acme.com');
  assert.equal(p.extraContacts[0].phone,'+1 555 0100');
  assert.deepEqual(p.emails,['a@acme.com','b@acme.com']);
  assert.equal(p.history[0].type,'operation');
  assert.match(p.history[0].text,/合并客户：Acme Ltd → Acme/);
  assert.ok(p.history.some(h=>h.text==='电话沟通'&&h.mergedFrom==='Acme Ltd'));
  assert.deepEqual(p.mergedFrom.map(x=>x.name),['Acme Ltd']);
});

test('合并客户：邮箱相同的联系人不重复；回收站客户和不存在的客户被拒绝',()=>{
  const s0=base();s0.customers['Acme Ltd'].email='A@ACME.COM';
  const s=T.mergeCustomers(s0,'Acme',['Acme Ltd']);
  assert.equal((s.customers.Acme.extraContacts||[]).length,0);
  const t=L.moveCustomers(base(),['Other'],'trash');
  assert.throws(()=>T.mergeCustomers(t,'Acme',['Other']),/回收站/);
  assert.throws(()=>T.mergeCustomers(base(),'Acme',['Nope']),/不存在/);
  assert.throws(()=>T.mergeCustomers(base(),'Acme',['Acme']),/至少/);
});

test('合并预览给出会改动的数量',()=>{
  const p=T.mergePreview(base(),'Acme',['Acme Ltd']);
  assert.deepEqual(p.count,{orders:2,tasks:1,opportunities:1,segments:2,followups:1,contacts:1});
});

test('标签统计、改名、合并同名、删除',()=>{
  const stats=T.tagStats(base());
  assert.deepEqual(Object.fromEntries(stats.map(x=>[x.tag,x.count])),{VIP:2,样品:2});
  let r=T.renameTag(base(),'样品','试样','2026-10-08T00:00:00.000Z');
  assert.equal(r.touched,2);
  assert.deepEqual(r.state.customers.Other.tags,['试样']);
  assert.match(r.state.customers.Other.history[0].text,/标签「样品」改名为「试样」/);
  r=T.renameTag(base(),'样品','VIP');
  assert.deepEqual(r.state.customers['Acme Ltd'].tags,['VIP'],'改成已有名称就是合并，不重复');
  r=T.deleteTag(base(),'VIP');
  assert.deepEqual(r.state.customers.Acme.tags,[]);
  assert.throws(()=>T.deleteTag(base(),'不存在'),/没有客户/);
  assert.throws(()=>T.renameTag(base(),'VIP','a,b'),/逗号/);
  assert.throws(()=>T.renameTag(base(),'VIP','VIP'),/相同/);
});

test('回收站客户的标签不计入统计，但改名时一并改',()=>{
  const s=L.moveCustomers(base(),['Other'],'trash');
  assert.equal(T.tagStats(s).find(x=>x.tag==='样品').count,1);
  assert.deepEqual(T.renameTag(s,'样品','试样').state.customers.Other.tags,['试样']);
});

test('批量建档：能建的建，不能建的说明原因',()=>{
  const text=['New Co\tTom\ttom@new.co\t+86 138 0000 1111\t中国','Second Co,,,,','Acme','Bad Mail,X,notmail,,德国','Dup Mail,Y,b@acme.com,,美国','','Second Co'].join('\n');
  // 邮箱判重默认是“允许保存”，这里按“不允许保存”测（判重按客户设置，S1 修复 4）
  const start={...base(),laiSettings:{customerSettings:{dedupe:{email:'block'}}}};
  const r=T.batchCreate(start,text,{country:'美国',owner:'Kris',tags:'新客户',source:'名单'},'2026-10-08T00:00:00.000Z');
  assert.deepEqual(r.created,['New Co','Second Co']);
  assert.equal(r.state.customers['New Co'].country,'中国');
  assert.equal(r.state.customers['Second Co'].country,'美国');
  assert.equal(r.state.customers['Second Co'].owner,'Kris');
  assert.equal(r.state.customers['Second Co'].source,'名单');
  assert.deepEqual(r.state.customers['Second Co'].tags,['新客户']);
  const why=Object.fromEntries(r.skipped.map(x=>[x.raw.split(/[,\t]/)[0],x.reason]));
  assert.match(why.Acme,/已存在/);
  assert.match(why['Bad Mail'],/邮箱格式/);
  assert.match(why['Dup Mail'],/Acme Ltd/);
  assert.match(why['Second Co'],/已存在/,'粘贴里重复的名字第二次被跳过');
});

test('批量建档：没有默认国家且行里也没写时跳过；空内容报错；超过 500 行报错',()=>{
  const r=T.batchCreate(base(),'X Co',{});
  assert.equal(r.created.length,0);assert.match(r.skipped[0].reason,/国家/);
  assert.throws(()=>T.batchCreate(base(),'  \n ',{country:'美国'}),/粘贴/);
  assert.throws(()=>T.batchCreate(base(),Array.from({length:501},(_,i)=>'C'+i).join('\n'),{country:'美国'}),/500/);
});

test('公海规则：默认关闭，设置前后校验',()=>{
  assert.deepEqual(T.poolRules(base()).rules,[],'没有设置时没有规则（v2）');
  const s=T.setPoolRules(base(),{enabled:true,noFollowDays:'30',skipTags:'VIP，大客户'});
  const r=T.poolRules(s);
  assert.deepEqual(r.rules,[{id:'legacy',name:'30 天未联系',enabled:true,kind:'noContact',days:30,groups:[],startDate:''}],'旧版设置读成一条 v2 规则');
  assert.deepEqual([r.skipOpenOrders,r.skipTags,r.skipFollowed],[true,['VIP','大客户'],true]);
  assert.throws(()=>T.setPoolRules(base(),{noFollowDays:0}),/1–3650/);
  assert.throws(()=>T.setPoolRules(base(),{noFollowDays:'abc'}),/1–3650/);
});

test('公海规则：找出久未跟进的客户，跳过有跟进中订单、关注、被排除标签、没有跟进人的',()=>{
  const now=new Date('2026-10-08T12:00:00Z');
  const s=base();
  s.customers.Idle={client:'Idle',country:'德国',owner:'Kris',source:'x',createdAt:'2026-01-01T00:00:00.000Z'};
  s.customers.Tagged={client:'Tagged',country:'德国',owner:'Kris',source:'x',tags:['大客户'],createdAt:'2026-01-01T00:00:00.000Z'};
  s.customers.Nobody={client:'Nobody',country:'德国',source:'x',createdAt:'2026-01-01T00:00:00.000Z'};
  s.customers.Recent={client:'Recent',country:'德国',owner:'Kris',source:'x',createdAt:'2026-01-01T00:00:00.000Z',lastFollowup:'2026-10-01T00:00:00.000Z'};
  s.customers.Watched={client:'Watched',country:'德国',owner:'Kris',source:'x',previewFollowed:true,createdAt:'2026-01-01T00:00:00.000Z'};
  const rules={enabled:true,noFollowDays:90,skipOpenOrders:true,skipTags:['大客户'],skipFollowed:true};
  const names=T.poolCandidates(s,rules,now).map(c=>c.name);
  assert.ok(names.includes('Idle'));
  assert.ok(names.includes('Other'),'Other 2025 年建档后一直没动静');
  for(const n of ['Tagged','Nobody','Recent','Watched','Acme Ltd'])assert.ok(!names.includes(n),n);
  assert.ok(!names.includes('Acme Ltd'),'Acme Ltd 有报价中的订单');
  const loose=T.poolCandidates(s,{...rules,skipOpenOrders:false,skipFollowed:false,skipTags:[]},now).map(c=>c.name);
  assert.ok(loose.includes('Watched')&&loose.includes('Tagged'));
  assert.equal(T.poolCandidates(s,rules,now)[0].days>=T.poolCandidates(s,rules,now).at(-1).days,true,'按天数从多到少');
});

test('公海规则：执行后客户进公海并记一条动态，跟进人记在 laiPreviousOwner 里可恢复',()=>{
  const now=new Date('2026-10-08T12:00:00Z');
  let s=T.setPoolRules(base(),{enabled:true,noFollowDays:90});
  const r=T.applyPoolRules(s,now);
  assert.deepEqual(r.moved.map(c=>c.name),['Other','Acme'],'Acme 只有一年前的动态，也算久未跟进');
  const o=r.state.customers.Other;
  assert.equal(L.bucket(o),'pool');
  assert.equal(o.laiPreviousOwner,'Kris');
  assert.match(o.history[0].text,/公海规则「90 天未联系」/);
  assert.deepEqual(T.applyPoolRules(r.state,now).moved,[],'没有到期的客户时不再报错，返回空');
  const back=L.moveCustomers(r.state,['Other'],'active');
  assert.equal(back.customers.Other.owner,'Kris');
});
