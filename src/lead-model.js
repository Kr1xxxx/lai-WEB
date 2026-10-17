(function(root){
  'use strict';
  // 线索：还没成为客户的潜在买家。保存在 state.laiLeads（数组）。
  // 流转：新线索 → 跟进中 → 转为客户（新建客户档案，或关联到已有客户）；也可以标记为无效、移入回收站。
  const node=typeof module!=='undefined'&&module.exports;
  const CM=node?require('./model.js'):root.PreviewModel;
  const LM=node?require('./modules.js'):root.LaiModules;
  const LS=node?require('./lead-settings-model.js'):root.LaiLeadSettings;
  const RMODEL=()=>node?require('./role-model.js'):root.LaiRoleModel;
  const FM=()=>node?require('./field-model.js'):root.LaiFieldModel;
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
  // ---- 自定义字段（线索设置 → 自定义字段；设置和规则见 field-model.js）----
  const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  const sameValue=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const customDefs=state=>FM()?FM().get(state,'lead').customFields:[];
  const customKey=id=>`custom.${id}`;
  // 整理表单传来的自定义字段值并检查必填，返回新的 custom 对象。
  // 只处理设置里还在的字段；input 里没带的字段（账号不能改的）和已经删掉的字段，原来的值原样保留。
  // 必填：新建线索全部要填；编辑旧线索时，本来就空、这次也没动的字段不拦；账号不能改（只读、隐藏）的字段不检查。
  function applyCustom(state,previous,input){
    const fm=FM();
    if(!fm)return previous?.custom;
    const settings=fm.get(state,'lead'),before=plain(previous?.custom),out={...before},sent=Object.hasOwn(input||{},'custom')?plain(input.custom):{},touched=new Set();
    for(const field of settings.customFields){
      if(!Object.hasOwn(sent,field.id))continue;
      const value=fm.cleanValue(field,sent[field.id],before[field.id]);
      if(value===undefined)delete out[field.id];else out[field.id]=value;
      if(!sameValue(value,before[field.id]))touched.add(field.id);
    }
    const levels=RMODEL();
    const missing=fm.missingRequired(settings,out,{editable:id=>!levels||levels.fieldLevel(state,'lead',customKey(id))==='edit',previous:previous?before:undefined,touched});
    if(missing.length)throw new Error(`请填写${missing.join('、')}`);
    return Object.keys(out).length||previous?.custom!==undefined?out:undefined;
  }
  // 详情用：设置里的自定义字段，只留下有值的和必填的。value 是已排好的文字。
  function customView(state,item){
    const fm=FM();
    if(!fm)return [];
    const values=plain(item?.custom);
    return fm.get(state,'lead').customFields.map(field=>({id:field.id,name:field.name,type:field.type,required:field.required,text:fm.formatValue(field,values[field.id])})).filter(entry=>entry.text||entry.required);
  }
  const LABELS={contact:'联系人',email:'邮箱',phone:'电话',country:'国家地区',source:'线索来源',website:'网址',product:'意向产品',note:'备注'};

  // 新建或编辑线索的基本资料。状态、跟进记录、转客户不在这里改。
  function upsert(state,id,input,options={}){
    requireList(state);
    if(typeof id!=='string'||!id.trim())throw new Error('找不到这条线索');
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
    // 线索设置里「显示且必填」的字段必须填；当前账号不能改的字段（只读、隐藏）不检查。转为客户有它自己的规则。
    const levels=RMODEL();
    for(const name of LS.requiredFields(state)){
      if(name!=='nextFollow'&&levels&&levels.fieldLevel(state,'lead',name)!=='edit')continue;
      // 老线索里本来就是空的、这次保存也没改它的字段不拦（和客户一样，不逼人补老资料）；新线索和这次动过的字段才检查。
      if(previous&&!trim(previous[name])&&trim(next[name])===trim(previous[name]))continue;
      if(!trim(next[name]))throw new Error(`请填写${LS.FIELDS.find(field=>field.id===name).label}`);
    }
    const custom=applyCustom(state,previous,input);
    if(custom!==undefined)next.custom=custom;else delete next.custom;
    const checked=checkedFields(previous,next);
    const blocked=customerConflicts(state,next).filter(item=>item.mode==='block'&&checked.includes(item.field));
    if(blocked.length)throw new Error(conflictMessage(blocked));
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
  // 线索重名索引：按线索数组缓存（保存时数组会换成新的），避免每条线索都扫一遍全部线索。
  const leadIndexCache=new WeakMap();
  function leadIndex(state){
    const source=raw(state);
    const cached=leadIndexCache.get(source);
    if(cached&&cached.length===source.length)return cached;
    const names=new Map(),emails=new Map();
    const push=(map,k,entry)=>{const bucket=map.get(k);if(bucket)bucket.push(entry);else map.set(k,[entry]);};
    list(state).forEach((other,pos)=>{
      if(other.trashed||statusOf(other)==='converted')return;
      const entry={pos,id:other.id,name:other.name};
      push(names,key(other.name),entry);
      if(trim(other.email))push(emails,key(other.email),entry);
    });
    const index={names,emails,length:source.length};
    leadIndexCache.set(source,index);
    return index;
  }
  function otherLeads(state,item){
    const index=leadIndex(state),found=new Map();
    for(const entry of index.names.get(key(item.name))||[])if(entry.id!==item.id)found.set(entry.pos,entry);
    if(trim(item.email))for(const entry of index.emails.get(key(item.email))||[])if(entry.id!==item.id)found.set(entry.pos,entry);
    return [...found.values()].sort((a,b)=>a.pos-b.pos).map(entry=>entry.name);
  }
  // 可能重复：名称或邮箱与已有客户相同，或与另一条未删除的线索相同。只提示，不拦截。
  function duplicatesOf(state,item){
    // 已转客户的线索不再提示；别的线索已转客户的，由「与客户相同」这一条覆盖。
    if(statusOf(item)==='converted')return {customer:'',leads:[]};
    const index=customerIndex(state);
    const modes=leadModes(state);
    const byName=modes.name==='off'?null:index.names.get(key(item.name)),byEmail=modes.email!=='off'&&trim(item.email)?index.emails.get(key(item.email)):'';
    const leads=otherLeads(state,item);
    return {customer:byName?.name||byEmail||'',leads};
  }


  // ---- 新线索与已有客户的判重（客户设置 → 判重设置 → 新线索与已有客户）----
  const DEDUPE_LABELS={name:'公司名称',website:'公司网址',email:'邮箱',phone:'联系电话'};
  const DEDUPE_KEYS=Object.keys(DEDUPE_LABELS);
  const leadModes=state=>{
    const set=CSM?CSM.get(state).leadDedupe:null;
    return Object.fromEntries(DEDUPE_KEYS.map(field=>[field,set?.[field]||'block']));
  };
  // 网址只比主机名：小写，去掉协议、www.、路径和末尾斜杠。
  function websiteHost(value){
    return trim(value).toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//,'').replace(/[/?#].*$/,'').replace(/^www\./,'').replace(/\.+$/,'');
  }
  const digitsOf=value=>{const digits=trim(value).replace(/\D/g,'');return digits.length>=6?digits:'';};
  // 客户资料里这一项的全部取值（已整理成可比对的形式）。
  function customerValues(field,name,profile){
    if(field==='name')return [key(name)];
    if(field==='website')return [websiteHost(profile?.website)].filter(Boolean);
    if(field==='email')return CSM.dedupeValues(profile,'email');
    return [...CSM.dedupeValues(profile,'phone'),...CSM.dedupeValues(profile,'landline')];
  }
  function leadValue(field,lead){
    if(field==='name')return key(lead?.name);
    if(field==='website')return websiteHost(lead?.website);
    if(field==='email')return trim(lead?.email).toLowerCase();
    return digitsOf(lead?.phone);
  }
  // 线索和已有客户（不含回收站）有哪些资料相同。mode 为不判重的项不返回。
  function customerConflicts(state,lead){
    if(!CSM)return [];
    const modes=leadModes(state),profiles=profilesOf(state),out=[];
    for(const field of DEDUPE_KEYS){
      if(modes[field]==='off')continue;
      const mine=leadValue(field,lead);
      if(!mine)continue;
      const hit=Object.keys(profiles).find(name=>LM.bucket(profiles[name])!=='trash'&&customerValues(field,name,profiles[name]).includes(mine));
      if(hit)out.push({field,label:DEDUPE_LABELS[field],customer:hit,mode:modes[field]});
    }
    return out;
  }
  // 新建时四项都查；编辑时只查这次改过的。
  function checkedFields(previous,next){
    return previous?DEDUPE_KEYS.filter(field=>leadValue(field,previous)!==leadValue(field,next)):DEDUPE_KEYS;
  }
  function conflictMessage(conflicts,tail){
    const byCustomer=new Map();
    for(const item of conflicts){if(!byCustomer.has(item.customer))byCustomer.set(item.customer,[]);byCustomer.get(item.customer).push(item.label);}
    const text=[...byCustomer].map(([customer,labels])=>`和已有客户「${customer}」的${labels.join('、')}相同`).join('；');
    return tail?`${text}，${tail}`:`${text}，不能保存。可以直接给这个客户写跟进。`;
  }
  // 保存前的提醒：设为「判重但允许保存」的项里有哪些和客户相同。表单据此先提示一次，再让人确认。
  function saveWarnings(state,id,input,options={}){
    const previous=list(state).find(item=>item.id===id);
    const has=name=>Object.hasOwn(input||{},name);
    const next={...(previous||{}),id};
    for(const field of ['name','website','email','phone'])next[field]=has(field)?input[field]:previous?.[field]??'';
    next.name=cleanName(next.name);
    const checked=checkedFields(options.mustExist?previous:null,next);
    const found=customerConflicts(state,next).filter(item=>item.mode==='allow'&&checked.includes(item.field));
    return {conflicts:found,message:found.length?conflictMessage(found,'确定还要保存吗？'):''};
  }

  // 线索的自定义字段带到新客户：客户设置里有同名（不分大小写、全半角）同类型的字段才带；值在客户那边不合格（例如选项不存在）的跳过。
  function convertCustom(state,item){
    const fm=FM(),out={};
    if(!fm)return out;
    const values=plain(item.custom),customer=fm.get(state,'customer').customFields;
    for(const field of fm.get(state,'lead').customFields){
      if(!fm.hasValue(values[field.id]))continue;
      const target=customer.find(entry=>entry.type===field.type&&fm.sameName(entry.name,field.name));
      if(!target||Object.hasOwn(out,target.id))continue;
      try{
        const value=fm.cleanValue(target,values[field.id]);
        if(value!==undefined)out[target.id]=value;
      }catch{/* 不合格的值不带 */}
    }
    return out;
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
      const custom=convertCustom(state,item);
      if(Object.keys(custom).length)fields.custom=custom;
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
  const sourceNames=state=>[...((CSM&&CSM.sourceChoices(state))||distinct([...list(state).map(item=>item.source),...Object.values(profilesOf(state)).map(profile=>profile?.source),...SOURCE_HINTS]))];
  // 线索设置：无效原因、字段显示与必填（见 lead-settings-model.js）。
  const reasons=state=>LS.reasonsOf(state);
  const fieldRules=state=>LS.get(state).fields;

  function row(state,item,today){
    const status=statusOf(item),history=historyOf(item);
    const nextFollow=validDate(item.nextFollow)?item.nextFollow:'';
    return {id:item.id,name:trim(item.name)||'（未命名线索）',contact:trim(item.contact),email:trim(item.email),phone:trim(item.phone),country:trim(item.country),source:trim(item.source),website:trim(item.website),
      product:trim(item.product),note:trim(item.note),owner:cleanName(item.owner),status,statusLabel:statusLabel(status),createdAt:trim(item.createdAt),createdDay:localDay(item.createdAt),
      lastFollowAt:trim(item.lastFollowAt),lastFollowDay:localDay(item.lastFollowAt),lastFollowText:history.find(entry=>entry.type==='followup')?.text||'',nextFollow,
      overdue:!!nextFollow&&OPEN.includes(status)&&nextFollow<today,dueToday:!!nextFollow&&OPEN.includes(status)&&nextFollow===today,
      invalidReason:trim(item.invalidReason),invalidNote:trim(item.invalidNote),convertedTo:trim(item.convertedTo),convertedExists:!!trim(item.convertedTo)&&customerNames(state).includes(trim(item.convertedTo)),convertedDay:localDay(item.convertedAt),trashed:!!item.trashed,trashedDay:localDay(item.trashedAt),
      history:history.map(entry=>({time:trim(entry.time),day:localDay(entry.time),text:trim(entry.text),type:entry.type==='followup'?'followup':'operation'})),duplicate:duplicatesOf(state,item),custom:{...plain(item.custom)}};
  }
  // 详情里带上当前的无效原因名单，「标记无效」窗口用它。
  const detail=(state,id,today=isoDay(new Date()))=>{const item=list(state).find(entry=>entry.id===id);return item?{...row(state,item,today),reasons:reasons(state),customView:customView(state,item)}:null;};
  const compare={
    'createdAt-desc':(a,b)=>b.createdAt.localeCompare(a.createdAt),
    'createdAt-asc':(a,b)=>a.createdAt.localeCompare(b.createdAt),
    'lastFollowAt-desc':(a,b)=>b.lastFollowAt.localeCompare(a.lastFollowAt),
    // 没定下次跟进日期的排在最后。
    'nextFollow-asc':(a,b)=>(a.nextFollow||'9999').localeCompare(b.nextFollow||'9999'),
    'name-asc':(a,b)=>a.name.localeCompare(b.name,'zh')
  };
  // 线索列表：先按搜索、跟进人、来源、「只看该跟进的」筛，再数各状态的数量，最后按所选状态显示。
  // hidden：当前账号看不到的字段名（字段权限）；这些字段不参与搜索，也不能按它筛选。
  function page(state,filters={},today=isoDay(new Date()),hidden=[]){
    const gone=new Set(Array.isArray(hidden)?hidden:[]);
    const f={status:['all',...STATUS_IDS].includes(filters.status)?filters.status:'all',search:trim(filters.search),owner:cleanName(filters.owner),source:gone.has('source')?'':cleanName(filters.source),
      due:filters.due===true||filters.due==='1',sort:Object.hasOwn(compare,filters.sort)?filters.sort:'createdAt-desc'};
    const all=list(state).filter(item=>!item.trashed).map(item=>row(state,item,today));
    const needle=f.search.toLowerCase();
    const matched=all.filter(item=>(!needle||[item.name,...['contact','email','phone','country','source','product','note'].filter(name=>!gone.has(name)).map(name=>item[name]),item.convertedTo].some(text=>text.toLowerCase().includes(needle)))
      &&(!f.owner||(f.owner==='未分配'?!item.owner:item.owner.toLowerCase()===f.owner.toLowerCase()))
      &&(!f.source||item.source.toLowerCase()===f.source.toLowerCase())
      &&(!f.due||item.overdue||item.dueToday));
    const counts={all:matched.length};
    for(const id of STATUS_IDS)counts[id]=matched.filter(item=>item.status===id).length;
    const rows=matched.filter(item=>f.status==='all'||item.status===f.status).sort((a,b)=>compare[f.sort](a,b)||b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id));
    return {filters:f,rows,counts,total:all.length,dueCount:all.filter(item=>item.overdue||item.dueToday).length,trashCount:list(state).filter(item=>item.trashed).length,
      owners:distinct(all.map(item=>item.owner)),hasUnassigned:all.some(item=>!item.owner),sources:gone.has('source')?[]:distinct(all.map(item=>item.source))};
  }
  // 字段权限（角色权限 → 设置字段权限）能设的线索字段：键就是线索上保存的字段名。
  // 线索名称、跟进人、状态、时间是线索必须有或自动生成的，不在清单里。
  const ROLE_GROUPS={contact:'基本信息',email:'基本信息',phone:'基本信息',country:'基本信息',website:'基本信息',source:'跟进信息',product:'跟进信息',note:'跟进信息'};
  // 自定义字段的权限键是 custom.<字段ID>，和客户一样。
  const roleFieldList=state=>[...['contact','email','phone','country','website','source','product','note'].map(name=>({key:name,label:LABELS[name],group:ROLE_GROUPS[name]})),
    ...customDefs(state).map(field=>({key:customKey(field.id),label:field.name,group:'自定义字段'}))];
  const trash=(state,today=isoDay(new Date()))=>list(state).filter(item=>item.trashed).map(item=>row(state,item,today)).sort((a,b)=>String(b.trashedDay).localeCompare(String(a.trashedDay))||a.name.localeCompare(b.name,'zh'));

  const api={STATUSES,INVALID_REASONS,reasons,fieldRules,SORTS,list,statusOf,statusLabel,upsert,addFollowup,markInvalid,reopen,setTrashed,remove,convert,convertDefaults,duplicatesOf,customerConflicts,saveWarnings,websiteHost,defaults,ownerNames,sourceNames,customerNames,customFields:customDefs,customView,convertCustom,
    detail,page,trash,localDay,validDate,roleFieldList};
  if(node)module.exports=api;else root.LaiLeadModel=api;
})(typeof window!=='undefined'?window:globalThis);
