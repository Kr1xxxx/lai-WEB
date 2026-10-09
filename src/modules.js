(function(root){
'use strict';
const customerModel=typeof module!=='undefined'&&module.exports?require('./model.js'):root.PreviewModel;
const CS=typeof module!=='undefined'&&module.exports?require('./customer-settings-model.js'):root.LaiCustomerSettings;
function bucket(profile){return ['pool','trash'].includes(profile?.laiBucket)?profile.laiBucket:'active';}
function knownNames(state){return new Set([...Object.keys(state.customers||{}),...(state.orders||[]).map(o=>o.client).filter(Boolean)]);}
function moveCustomers(state,names,target,time=new Date().toISOString()){
 if(!['active','pool','trash','restore'].includes(target))throw Error('不支持的客户操作');
 if(!Array.isArray(names)||!names.length)throw Error('请先选择客户');
 const known=knownNames(state);if(names.some(n=>!known.has(n)))throw Error('客户不存在');
 const customers={...state.customers};
 const effectiveOwners=new Map(customerModel.buildCustomers(state).map(c=>[c.name,c.owner]));
 for(const name of names){const old=customers[name]||{},previous=bucket(old);let next=target==='restore'?(old.laiPreviousBucket||'active'):target;
  if(target==='restore'&&previous!=='trash')throw Error('只能恢复回收站中的客户');
  if(previous==='trash'&&target!=='restore')throw Error('请先从回收站恢复客户');
  const profile={...old,client:name,laiBucket:next};
  if(next==='pool'&&previous==='active'){
   profile.laiPreviousOwner=effectiveOwners.get(name)||'';profile.owner='';
   profile.lastPoolEntry=time;
   profile.poolEntryCount=Math.max(0,Math.floor(Number(old.poolEntryCount)||0))+1;
  }
  if(next==='active'&&previous==='pool'){
   if(CS&&old.laiPreviousOwner)CS.assertCanTake({...state,customers},old.laiPreviousOwner,1,[name]);
   profile.owner=old.laiPreviousOwner||'';
   profile.lastPrivatePoolEntry=time;
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
