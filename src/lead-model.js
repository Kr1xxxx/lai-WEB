(function(root){
  'use strict';
  // 线索：还没成为客户的潜在买家。保存在 state.laiLeads（数组）。
  // 流转：新线索 → 跟进中 → 转为客户（新建客户档案，或关联到已有客户）；也可以标记为无效、移入回收站。
  const node=typeof module!=='undefined'&&module.exports;
  const CM=node?require('./model.js'):root.PreviewModel;
  const LM=node?require('./modules.js'):root.LaiModules;
  const trim=value=>String(value??'').trim();
  const cleanName=name=>trim(name).normalize('NFKC').replace(/\s+/g,' ').trim();
  const key=value=>cleanName(value).toLowerCase();
  const STATUSES=Object.freeze([['new','新线索'],['following','跟进中'],['converted','已转客户'],['invalid','无效']].map(([id,label])=>Object.freeze({id,label})));
  const STATUS_IDS=STATUSES.map(status=>status.id);
  const OPEN=['new','following'];
  const INVALID_REASONS=Object.freeze(['无法联系','没有需求','预算不符','重复线索','同行或广告','其他']);
  const SOURCE_HINTS=Object.freeze(['展会','官网询盘','阿里巴巴','社交媒体','客户介绍','邮件开发','搜索引擎','其他']);
  const SORTS=Object.freeze([['createdAt-desc','创建时间 / 新的在前'],['createdAt-asc','创建时间 / 旧的在前'],['lastFollowAt-desc','最近跟进 / 新的在前'],['nextFollow-asc','下次跟进 / 早的在前'],['name-asc','名称 / A-Z']]);
  const TEXT_FIELDS=['contact','email','phone','country','source','website','product','note'];
  const MAX={name:120,contact:80,email:120,phone:40,country:60,source:40,website:200,product:200,note:2000,owner:40,text:2000};

  function validDate(value){
    const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(trim(value));
    if(!match)return false;
    const date=new Date(Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3])));
    return date.getUTCFullYear()===Number(match[1])&&date.getUTCMonth()===Number(match[2])-1&&date.getUTCDate()===Number(match[3]);
  }
  const pad=number=>String(number).padStart(2,'0');
  const isoDay=date=>`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
  // 带时间的值按本地日期显示和比较。
  function localDay(value){
    const source=trim(value);
    if(/^\d{4}-\d{2}-\d{2}$/.test(source))return validDate(source)?source:'';
    if(!/^\d{4}-\d{2}-\d{2}/.test(source))return '';
    const parsed=new Date(source.replace(' ','T'));
    return Number.isFinite(parsed.getTime())?isoDay(parsed):'';
  }

  const raw=state=>Array.isArray(state?.laiLeads)?state.laiLeads:[];
  // 读不懂的条目（不是对象、没有 ID）不显示，但保存别的修改时原样保留。
  const list=state=>raw(state).filter(item=>item&&typeof item==='object'&&typeof item.id==='string'&&item.id);
  function requireList(state){
    if(state?.laiLeads!==undefined&&state.laiLeads!==null&&!Array.isArray(state.laiLeads))throw new Error('已保存的线索数据格式异常，为避免覆盖，未做任何修改');
  }
  const statusOf=item=>STATUS_IDS.includes(item?.status)?item.status:'new';
  const statusLabel=id=>STATUSES.find(status=>status.id===id)?.label||id;
  const historyOf=item=>(Array.isArray(item?.history)?item.history:[]).filter(entry=>entry&&typeof entry==='object'&&trim(entry.text));
  function requireItem(state,id){
    requireList(state);
    const item=list(state).find(entry=>entry.id===id);
    if(!item)throw new Error('线索不存在，可能已被删除，请刷新后重试');
    return item;
  }
  // 万一存了两条相同 ID 的线索，只改第一条，另一条原样保留。
  function replaceFirst(state,id,next){
    let done=false;
    return raw(state).map(item=>{
      if(!done&&item&&typeof item==='object'&&item.id===id){done=true;return next;}
      return item;
    });
  }
  const write=(state,id,next)=>({...state,laiLeads:replaceFirst(state,id,next)});
  const limited=(value,max,label)=>{const text=trim(value);if(text.length>max)throw new Error(`${label}最多 ${max} 个字`);return text;};
  const LABELS={contact:'联系人',email:'邮箱',phone:'电话',country:'国家地区',source:'线索来源',website:'网址',product:'意向产品',note:'备注'};

  // 新建或编辑线索的基本资料。状态、跟进记录、转客户不在这里改。
  function upsert(state,id,input,options={}){
    requireList(state);
    if(typeof id!=='string'||!id.trim())throw new Error('线索 ID 无效');
    const now=options.now||new Date().toISOString();
    const previous=list(state).find(item=>item.id===id);
    if(options.mustExist&&!previous)throw new Error('线索不存在，可能已被删除，未保存');
    if(!options.mustExist&&previous)throw new Error('线索已存在，未重复保存');
    if(previous?.trashed)throw new Error('请先从回收站恢复这条线索');
    const has=name=>Object.hasOwn(input||{},name);
    const value=name=>has(name)?input[name]:previous?.[name]??'';
    const next={...(previous||{}),id};
    next.name=limited(cleanName(value('name')),MAX.name,'线索名称');
    if(!next.name)throw new Error('请填写线索名称（公司或个人）');
    for(const name of TEXT_FIELDS)next[name]=limited(value(name),MAX[name],LABELS[name]);
    if(next.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email))throw new Error('邮箱格式不正确');
    const owner=cleanName(value('owner'));
    next.owner=owner==='未分配'?'':limited(owner,MAX.owner,'跟进人');
    next.nextFollow=trim(value('nextFollow'));
    if(next.nextFollow&&!validDate(next.nextFollow))throw new Error('请选择有效的下次跟进日期');
    if(!previous){
      next.status='new';
      next.createdAt=now;
      next.history=[];
      next.trashed=false;
    }
    next.updatedAt=now;
    return previous?write(state,id,next):{...state,laiLeads:[next,...raw(state)]};
  }

  // 写一条跟进记录；新线索写了跟进就进入「跟进中」。已转客户、无效的线索不能再写（先重新跟进）。
  function addFollowup(state,id,input,options={}){
    const item=requireItem(state,id);
    if(item.trashed)throw new Error('请先从回收站恢复这条线索');
    if(!OPEN.includes(statusOf(item)))throw new Error(statusOf(item)==='converted'?'这条线索已转为客户，请到客户资料里写跟进':'这条线索已标记为无效，请先点「重新跟进」');
    const now=options.now||new Date().toISOString();
    const text=limited(input?.text,MAX.text,'跟进内容');
    if(!text)throw new Error('请填写跟进内容');
    const nextFollow=Object.hasOwn(input||{},'nextFollow')?trim(input.nextFollow):trim(item.nextFollow);
    if(nextFollow&&!validDate(nextFollow))throw new Error('请选择有效的下次跟进日期');
    return write(state,id,{...item,status:'following',lastFollowAt:now,nextFollow,updatedAt:now,history:[{time:now,text,type:'followup'},...(Array.isArray(item.history)?item.history:[])]});
  }
  const note=(item,now,text)=>[{time:now,text,type:'operation'},...(Array.isArray(item.history)?item.history:[])];

  function markInvalid(state,id,input,options={}){
    const item=requireItem(state,id);
    if(item.trashed)throw new Error('请先从回收站恢复这条线索');
    if(statusOf(item)==='converted')throw new Error('这条线索已转为客户，不能标记为无效');
    const now=options.now||new Date().toISOString();
    const reason=limited(input?.reason,40,'无效原因');
    if(!reason)throw new Error('请选择无效原因');
    const detail=limited(input?.note,200,'补充说明');
    return write(state,id,{...item,status:'invalid',invalidReason:reason,invalidNote:detail,nextFollow:'',updatedAt:now,history:note(item,now,`标记为无效：${reason}${detail?`（${detail}）`:''}`)});
  }
  // 无效的线索重新跟进：有过跟进记录的回到「跟进中」，否则回到「新线索」。
  function reopen(state,id,options={}){
    const item=requireItem(state,id);
    if(item.trashed)throw new Error('请先从回收站恢复这条线索');
    if(statusOf(item)!=='invalid')throw new Error('只有无效的线索需要重新跟进');
    const now=options.now||new Date().toISOString();
    const next={...item,status:item.lastFollowAt?'following':'new',updatedAt:now,history:note(item,now,'重新跟进')};
    delete next.invalidReason;
    delete next.invalidNote;
    return write(state,id,next);
  }
  function setTrashed(state,id,trashed,options={}){
    const item=requireItem(state,id);
    const now=options.now||new Date().toISOString();
    if(!!item.trashed===!!trashed)return state;
    const next={...item,trashed:!!trashed,updatedAt:now};
    if(trashed)next.trashedAt=now;else delete next.trashedAt;
    return write(state,id,next);
  }
  // 彻底删除：只能删回收站里的。
  function remove(state,id){
    const item=requireItem(state,id);
    if(!item.trashed)throw new Error('请先把线索移入回收站，再彻底删除');
    let done=false;
    return {...state,laiLeads:raw(state).filter(entry=>{if(!done&&entry&&typeof entry==='object'&&entry.id===id){done=true;return false;}return true;})};
  }

  // ---- 客户名单（查重、转客户用）----
  const profilesOf=state=>state?.customers&&typeof state.customers==='object'&&!Array.isArray(state.customers)?state.customers:{};
  const customerCache=new WeakMap();
  function customerIndex(state){
    if(state&&typeof state==='object'&&customerCache.has(state))return customerCache.get(state);
    const profiles=profilesOf(state),names=new Map(),emails=new Map(),active=[];
    const add=(name,profile)=>{
      if(!name||names.has(key(name)))return;
      const bucket=LM.bucket(profile);
      names.set(key(name),{name,bucket});
      if(bucket!=='trash')active.push(name);
      for(const email of [profile?.email,...(Array.isArray(profile?.emails)?profile.emails:[])])if(trim(email)&&!emails.has(key(email)))emails.set(key(email),name);
    };
    for(const name of Object.keys(profiles))add(name,profiles[name]);
    for(const order of [...(Array.isArray(state?.orders)?state.orders:[]),...(Array.isArray(state?.trashOrders)?state.trashOrders:[])])if(order&&typeof order.client==='string')add(order.client,undefined);
    const index={names,emails,active:active.sort((a,b)=>a.localeCompare(b,'zh'))};
    if(state&&typeof state==='object')customerCache.set(state,index);
    return index;
  }
  const customerNames=state=>customerIndex(state).active;
  // 可能重复：名称或邮箱与已有客户相同，或与另一条未删除的线索相同。只提示，不拦截。
  function duplicatesOf(state,item){
    // 已转客户的线索不再提示；别的线索已转客户的，由「与客户相同」这一条覆盖。
    if(statusOf(item)==='converted')return {customer:'',leads:[]};
    const index=customerIndex(state);
    const byName=index.names.get(key(item.name)),byEmail=trim(item.email)?index.emails.get(key(item.email)):'';
    const leads=list(state).filter(other=>other.id!==item.id&&!other.trashed&&statusOf(other)!=='converted'&&(key(other.name)===key(item.name)||(trim(item.email)&&key(other.email)===key(item.email)))).map(other=>other.name);
    return {customer:byName?.name||byEmail||'',leads};
  }

  // 转为客户。mode='new'：用线索资料新建客户档案（名称、国家地区、客户来源必填）；mode='existing'：关联到已有客户，不改客户资料。
  // 两种方式都会在客户动态里留一条「由线索转入」，线索本身保留并标记为已转客户。
  function convert(state,id,input,options={}){
    const item=requireItem(state,id);
    if(item.trashed)throw new Error('请先从回收站恢复这条线索');
    if(statusOf(item)==='converted')throw new Error(`这条线索已转为客户「${trim(item.convertedTo)}」`);
    if(statusOf(item)==='invalid')throw new Error('这条线索已标记为无效，请先点「重新跟进」');
    const now=options.now||new Date().toISOString();
    const followups=historyOf(item).filter(entry=>entry.type==='followup').length;
    const origin=`由线索转入：${item.name}${followups?`（线索阶段有 ${followups} 条跟进记录，可在线索列表查看）`:''}`;
    let next,customer;
    if(input?.mode==='existing'){
      customer=trim(input.existing);
      const found=customerIndex(state).names.get(key(customer));
      if(!customer||!found||!Object.hasOwn(profilesOf(state),found.name))throw new Error('请从列表中选择一个已有客户');
      if(found.bucket==='trash')throw new Error('该客户在回收站里，请先恢复');
      customer=found.name;
      const profile=profilesOf(state)[customer];
      next={...state,customers:{...state.customers,[customer]:{...profile,updated:now,history:[{time:now,text:origin,type:'operation'},...(Array.isArray(profile.history)?profile.history:[])]}}};
    }else{
      customer=cleanName(Object.hasOwn(input||{},'name')?input.name:item.name);
      const fields={name:customer,country:trim(input?.country??item.country),source:trim(input?.source??item.source),owner:cleanName(input?.owner??item.owner)};
      for(const [from,to] of [['contact','contact'],['email','email'],['phone','phone'],['website','website'],['product','productType'],['note','note']])if(trim(item[from]))fields[to]=trim(item[from]);
      if(validDate(item.nextFollow))fields.nextFollow=item.nextFollow;
      next=CM.upsertCustomer(state,'',fields,now);
      const profile=next.customers[customer];
      next={...next,customers:{...next.customers,[customer]:{...profile,history:[{time:now,text:origin,type:'operation'},...(Array.isArray(profile.history)?profile.history:[])]}}};
    }
    const converted={...item,status:'converted',convertedTo:customer,convertedAt:now,nextFollow:'',updatedAt:now,history:note(item,now,`转为客户：${customer}${input?.mode==='existing'?'（关联已有客户）':''}`)};
    return {...next,laiLeads:replaceFirst(next,id,converted)};
  }
  // 转客户表单的默认值：名称或邮箱与已有客户相同的，默认关联到那个客户。
  function convertDefaults(state,id){
    const item=requireItem(state,id),duplicate=duplicatesOf(state,item).customer;
    const usable=duplicate&&customerNames(state).includes(duplicate)&&Object.hasOwn(profilesOf(state),duplicate);
    return {mode:usable?'existing':'new',existing:usable?duplicate:'',name:item.name,country:trim(item.country),source:trim(item.source),owner:cleanName(item.owner)||defaultOwner(state)};
  }

  const defaultOwner=state=>cleanName(state?.laiSettings?.defaultOwner||state?.orderSettings?.defaultOwner);
  const defaults=state=>({name:'',contact:'',email:'',phone:'',country:'',source:'',website:'',product:'',note:'',owner:defaultOwner(state),nextFollow:''});
  // 可选的跟进人、来源：已经用过的写法（去重，不区分大小写），加上常见来源。
  function distinct(values){
    const seen=new Map();
    for(const value of values){const text=cleanName(value);if(text&&text!=='未分配'&&!seen.has(text.toLowerCase()))seen.set(text.toLowerCase(),text);}
    return [...seen.values()].sort((a,b)=>a.localeCompare(b,'zh'));
  }
  const ownerNames=state=>distinct([defaultOwner(state),...list(state).map(item=>item.owner),...Object.values(profilesOf(state)).map(profile=>profile?.owner)]);
  const CSM=node?require('./customer-settings-model.js'):root.LaiCustomerSettings;
  const sourceNames=state=>(CSM&&CSM.sourceChoices(state))||distinct([...list(state).map(item=>item.source),...Object.values(profilesOf(state)).map(profile=>profile?.source),...SOURCE_HINTS]);

  function row(state,item,today){
    const status=statusOf(item),history=historyOf(item);
    const nextFollow=validDate(item.nextFollow)?item.nextFollow:'';
    return {id:item.id,name:trim(item.name)||'（未命名线索）',contact:trim(item.contact),email:trim(item.email),phone:trim(item.phone),country:trim(item.country),source:trim(item.source),website:trim(item.website),
      product:trim(item.product),note:trim(item.note),owner:cleanName(item.owner),status,statusLabel:statusLabel(status),createdAt:trim(item.createdAt),createdDay:localDay(item.createdAt),
      lastFollowAt:trim(item.lastFollowAt),lastFollowDay:localDay(item.lastFollowAt),lastFollowText:history.find(entry=>entry.type==='followup')?.text||'',nextFollow,
      overdue:!!nextFollow&&OPEN.includes(status)&&nextFollow<today,dueToday:!!nextFollow&&OPEN.includes(status)&&nextFollow===today,
      invalidReason:trim(item.invalidReason),invalidNote:trim(item.invalidNote),convertedTo:trim(item.convertedTo),convertedExists:!!trim(item.convertedTo)&&customerNames(state).includes(trim(item.convertedTo)),convertedDay:localDay(item.convertedAt),trashed:!!item.trashed,trashedDay:localDay(item.trashedAt),
      history:history.map(entry=>({time:trim(entry.time),day:localDay(entry.time),text:trim(entry.text),type:entry.type==='followup'?'followup':'operation'})),duplicate:duplicatesOf(state,item)};
  }
  const detail=(state,id,today=isoDay(new Date()))=>{const item=list(state).find(entry=>entry.id===id);return item?row(state,item,today):null;};
  const compare={
    'createdAt-desc':(a,b)=>b.createdAt.localeCompare(a.createdAt),
    'createdAt-asc':(a,b)=>a.createdAt.localeCompare(b.createdAt),
    'lastFollowAt-desc':(a,b)=>b.lastFollowAt.localeCompare(a.lastFollowAt),
    // 没定下次跟进日期的排在最后。
    'nextFollow-asc':(a,b)=>(a.nextFollow||'9999').localeCompare(b.nextFollow||'9999'),
    'name-asc':(a,b)=>a.name.localeCompare(b.name,'zh')
  };
  // 线索列表：先按搜索、跟进人、来源、「只看该跟进的」筛，再数各状态的数量，最后按所选状态显示。
  function page(state,filters={},today=isoDay(new Date())){
    const f={status:['all',...STATUS_IDS].includes(filters.status)?filters.status:'all',search:trim(filters.search),owner:cleanName(filters.owner),source:cleanName(filters.source),
      due:filters.due===true||filters.due==='1',sort:Object.hasOwn(compare,filters.sort)?filters.sort:'createdAt-desc'};
    const all=list(state).filter(item=>!item.trashed).map(item=>row(state,item,today));
    const needle=f.search.toLowerCase();
    const matched=all.filter(item=>(!needle||[item.name,item.contact,item.email,item.phone,item.country,item.source,item.product,item.note,item.convertedTo].some(text=>text.toLowerCase().includes(needle)))
      &&(!f.owner||(f.owner==='未分配'?!item.owner:item.owner.toLowerCase()===f.owner.toLowerCase()))
      &&(!f.source||item.source.toLowerCase()===f.source.toLowerCase())
      &&(!f.due||item.overdue||item.dueToday));
    const counts={all:matched.length};
    for(const id of STATUS_IDS)counts[id]=matched.filter(item=>item.status===id).length;
    const rows=matched.filter(item=>f.status==='all'||item.status===f.status).sort((a,b)=>compare[f.sort](a,b)||b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id));
    return {filters:f,rows,counts,total:all.length,dueCount:all.filter(item=>item.overdue||item.dueToday).length,trashCount:list(state).filter(item=>item.trashed).length,
      owners:distinct(all.map(item=>item.owner)),hasUnassigned:all.some(item=>!item.owner),sources:distinct(all.map(item=>item.source))};
  }
  const trash=(state,today=isoDay(new Date()))=>list(state).filter(item=>item.trashed).map(item=>row(state,item,today)).sort((a,b)=>String(b.trashedDay).localeCompare(String(a.trashedDay))||a.name.localeCompare(b.name,'zh'));

  const api={STATUSES,INVALID_REASONS,SORTS,list,statusOf,statusLabel,upsert,addFollowup,markInvalid,reopen,setTrashed,remove,convert,convertDefaults,duplicatesOf,defaults,ownerNames,sourceNames,customerNames,
    detail,page,trash,localDay,validDate};
  if(node)module.exports=api;else root.LaiLeadModel=api;
})(typeof window!=='undefined'?window:globalThis);
