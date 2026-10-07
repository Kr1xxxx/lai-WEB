(function(root){
'use strict';
const customerModel=typeof module!=='undefined'&&module.exports?require('./model.js'):root.PreviewModel;
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
 const M=root.PreviewModel||(typeof require==='function'?require('./model.js'):null);
 for(const [name,c] of Object.entries(state.customers||{})){
  if(bucket(c)==='trash')continue;
  const {email:emails,phone:phones}=M.customerContactValues(c);
  const values=[
   ...new Set(emails.map(value=>String(value??'').trim().toLowerCase()).filter(Boolean).map(value=>'email:'+value)),
   ...new Set(phones.filter(Boolean).map(value=>'phone:'+value)),
  ];
  for(const value of values){if(value==='email:'||value==='phone:')continue;const members=index.get(value)||new Set();members.add(name);index.set(value,members);}
 }
 return [...index.entries()].filter(([,names])=>names.size>1).map(([key,names])=>({type:key.startsWith('email:')?'邮箱':'电话',value:key.slice(key.indexOf(':')+1),names:[...names]}));
}
const api={bucket,moveCustomers,findDuplicates};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LaiModules=api;
})(typeof window!=='undefined'?window:globalThis);
