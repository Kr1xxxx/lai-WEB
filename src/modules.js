(function(root){
'use strict';
const customerModel=typeof module!=='undefined'&&module.exports?require('./model.js'):root.PreviewModel;
const CS=typeof module!=='undefined'&&module.exports?require('./customer-settings-model.js'):root.LaiCustomerSettings;
function bucket(profile){return ['pool','trash'].includes(profile?.laiBucket)?profile.laiBucket:'active';}
function knownNames(state){return new Set([...Object.keys(state.customers||{}),...(state.orders||[]).map(o=>o.client).filter(Boolean)]);}
// 公海规则在 customer-tools.js（它要用到本文件），所以用到时才取，避免加载时互相等。
function poolTools(){return typeof module!=='undefined'&&module.exports?require('./customer-tools.js'):root.LaiCustomerTools;}
// opts.reason：移入公海的原因；opts.owner：领回时指定的跟进人；opts.history===false：不写「移入公海」动态（自动规则自己写）。
function moveCustomers(state,names,target,time=new Date().toISOString(),opts={}){
 if(!['active','pool','trash','restore'].includes(target))throw Error('不支持的客户操作');
 if(!Array.isArray(names)||!names.length)throw Error('请先选择客户');
 const known=knownNames(state);if(names.some(n=>!known.has(n)))throw Error('客户不存在');
 opts=opts||{};
 const customers={...state.customers};
 const effectiveOwners=new Map(customerModel.buildCustomers(state).map(c=>[c.name,c.owner]));
 const PT=poolTools();
 const rules=PT?PT.poolRules(state):null;
 const reason=String(opts.reason??'').trim();
 if(reason.length>50)throw Error('原因最多 50 个字');
 const claimOwner=String(opts.owner??'').trim();
 const claimedBy=name=>claimOwner||customers[name]?.laiPreviousOwner||'';
 const nowMs=Number.isFinite(Date.parse(time))?Date.parse(time):Date.now();
 if(target==='pool'&&rules&&rules.requireReason&&!reason&&names.some(n=>bucket(customers[n])==='active'))throw Error('请选择移入公海的原因');
 if(target==='active'&&rules){
  const claiming=names.filter(n=>bucket(customers[n])==='pool');
  // 1) 原跟进人在限制天数内不能领回
  if(rules.reclaimBlockDays>0)for(const name of claiming){
   const old=customers[name],who=claimedBy(name),entered=Date.parse(old.lastPoolEntry);
   if(who&&who===old.laiPreviousOwner&&Number.isFinite(entered)){
    const left=Math.ceil((rules.reclaimBlockDays*86400000-(nowMs-entered))/86400000);
    if(left>0)throw Error(`原跟进人 ${rules.reclaimBlockDays} 天内不能领回这个客户，还要等 ${left} 天`);
   }
  }
  // 2) 领取数量上限（一批里同一个人的都算进去）
  const batch=new Map();
  for(const name of claiming){const who=claimedBy(name);if(who)batch.set(who,(batch.get(who)||0)+1);}
  for(const [who,count] of batch){
   const limit=PT.claimLimitFor(state,who);
   if(limit>0){
    const done=PT.claimCount(state,who,new Date(nowMs));
    if(done+count>limit)throw Error(`${who} ${rules.claimLimit.periodDays} 天内最多领取 ${limit} 位客户，已领 ${done} 位`);
   }
  }
 }
 for(const name of names){const old=customers[name]||{},previous=bucket(old);let next=target==='restore'?(old.laiPreviousBucket||'active'):target;
  if(target==='restore'&&previous!=='trash')throw Error('只能恢复回收站中的客户');
  if(previous==='trash'&&target!=='restore')throw Error('请先从回收站恢复客户');
  const profile={...old,client:name,laiBucket:next};
  if(next==='pool'&&previous==='active'){
   profile.laiPreviousOwner=effectiveOwners.get(name)||'';profile.owner='';
   profile.lastPoolEntry=time;
   profile.poolEntryCount=Math.max(0,Math.floor(Number(old.poolEntryCount)||0))+1;
   if(reason)profile.poolReason=reason;
   if(opts.history!==false)profile.history=[{time,text:reason?`移入公海，原因：${reason}`:'移入公海',type:'operation'},...(Array.isArray(old.history)?old.history:[])];
  }
  if(next==='active'&&previous==='pool'){
   const owner=claimedBy(name);
   // 3) 跟进人客户数上限
   if(CS&&owner)CS.assertCanTake({...state,customers},owner,1,[name]);
   profile.owner=owner;
   profile.lastPrivatePoolEntry=time;
   if(owner)profile.poolClaims=[...(Array.isArray(old.poolClaims)?old.poolClaims:[]),{owner,time}].slice(-20);
  }
  if(next==='trash'){profile.laiPreviousBucket=previous;profile.laiArchivedAt=time;}
  if(target==='restore')delete profile.laiArchivedAt;
  customers[name]=profile;
 }
 return {...state,customers};
}
function findDuplicates(state){
 const index=new Map();
 const phoneKey=(phone,countryCode='')=>{
  const raw=String(phone??'').trim();
  if(!raw)return '';
  const digits=raw.replace(/\D/g,'');
  const prefix=String(countryCode??'').replace(/\D/g,'');
  return prefix&&!raw.startsWith('+')&&!digits.startsWith(prefix)?prefix+digits:digits;
 };
 for(const [name,c] of Object.entries(state.customers||{})){
  if(bucket(c)==='trash')continue;
  const contacts=Array.isArray(c.extraContacts)?c.extraContacts:[];
  const legacy=Array.isArray(c.contacts)?c.contacts.filter(item=>item&&typeof item==='object'):[];
  const savedEmails=Array.isArray(c.emails)?c.emails:[];
  const savedPhones=Array.isArray(c.phones)?c.phones:[];
  const emails=[savedEmails[0]??c.email,...savedEmails.slice(1),...contacts.map(item=>item?.email),...legacy.map(item=>item.email)];
  const phones=[
   [savedPhones[0]??c.phone,c.phoneCountryCode],
   ...savedPhones.slice(1).map(phone=>[phone,'']),
   ...contacts.map(item=>[item?.phone,item?.phoneCountryCode]),
   ...legacy.map(item=>[item.phone,item.phoneCountryCode]),
   ...(Array.isArray(c.additionalPhones)?c.additionalPhones:[]).map(item=>[item?.phone,item?.phoneCountryCode]),
   ...contacts.flatMap(item=>(Array.isArray(item?.additionalPhones)?item.additionalPhones:[]).map(phone=>[phone?.phone,phone?.phoneCountryCode])),
  ];
  const values=[
   ...new Set(emails.map(value=>String(value??'').trim().toLowerCase()).filter(Boolean).map(value=>'email:'+value)),
   ...new Set(phones.map(([phone,code])=>phoneKey(phone,code)).filter(Boolean).map(value=>'phone:'+value)),
  ];
  for(const value of values){if(value==='email:'||value==='phone:')continue;const members=index.get(value)||new Set();members.add(name);index.set(value,members);}
 }
 return [...index.entries()].filter(([,names])=>names.size>1).map(([key,names])=>({type:key.startsWith('email:')?'邮箱':'电话',value:key.slice(key.indexOf(':')+1),names:[...names]}));
}
const api={bucket,moveCustomers,findDuplicates};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LaiModules=api;
})(typeof window!=='undefined'?window:globalThis);
