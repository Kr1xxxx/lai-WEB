(function(root){
'use strict';
// 客户管理工具：合并客户、标签管理、批量建档、公海规则。
// 全是纯函数：输入 state，返回新的 state（或预览结果），不碰界面，也不自己保存。
const M=typeof module!=='undefined'&&module.exports?require('./model.js'):root.PreviewModel;
const LM=typeof module!=='undefined'&&module.exports?require('./modules.js'):root.LaiModules;
const trim=v=>String(v??'').trim();
const norm=v=>trim(v).toLowerCase().replace(/\s+/g,' ');
const isoDay=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const time=v=>{const t=Date.parse(String(v||'').replace(' ','T'));return Number.isFinite(t)?t:NaN;};
const profiles=state=>state&&state.customers&&typeof state.customers==='object'?state.customers:{};
const knownNames=state=>new Set([...Object.keys(profiles(state)),...(state.orders||[]).map(o=>o.client).filter(Boolean)]);
const bucketOf=p=>['pool','trash'].includes(p?.laiBucket)?p.laiBucket:'active';
const digits=v=>String(v??'').replace(/\D/g,'');

// ============ 合并客户 ============
// 合并规则（写在 VALIDATION.md）：
// - 保留的客户（primary）的资料优先；它空着的资料用被合并客户的补上（按所选顺序）。
// - 联系人：被合并客户的联系人并进保留客户的「其他联系人」，邮箱或电话相同的不重复添加。
// - 标签取并集；动态记录全部保留并按时间排序；下次跟进取最早的一个；备注不一致时追加。
// - 订单（含回收站）、任务、商机、客群成员里的客户名一并改成保留客户；被合并的客户档案删除。
const FILL_KEYS=['country','owner','website','source','customerStage','productType','paymentMethod','paymentEmail','currency','level','previewGroup','alibabaId','socialPlatform','socialAccount'];
// 合并时哪些资料会补上：保留客户里空着的，凡是文字/数字/开关类的资料都从被合并客户里补（按所选顺序，第一个有值的）。
// 不补的：动态 history、标签 tags、联系人相关（联系人另有合并规则）、公海/回收站相关、系统记账用的 lai* 字段、
// 日期类（下次跟进、最近跟进、创建/更新时间）、备注（另有追加规则）、mergedFrom。
const SKIP_FILL=new Set(['client','history','tags','mergedFrom','updated','createdAt','nextFollow','lastFollowup','lastWrittenFollowup','note','permanentNote','previewFollowed',
  'contact','email','phone','address','contacts','emails','phones','addresses','extraContacts','additionalPhones','phoneCountryCode','alternateEmail','birthday','contactPaymentMethod','contactNote','contactTitle','contactGender','primaryContactMethod',
  'previousOwner','ownerUpdatedAt','lastPoolEntry','lastPrivatePoolEntry','poolEntryCount','poolReason','poolClaims']);
const isScalar=v=>typeof v==='string'||typeof v==='number'||typeof v==='boolean';
function fillKeys(base,srcs){
  const keys=new Set(FILL_KEYS);
  for(const p of [base,...srcs.map(s=>s.p)])for(const [k,v] of Object.entries(p))
    if(!SKIP_FILL.has(k)&&!/^lai/.test(k)&&isScalar(v))keys.add(k);
  return keys;
}
const NOTE_KEYS=[['note','备注'],['permanentNote','长期备注']];
const CONTACT_KEYS=['contact','email','phone','address','alibabaId','contactPaymentMethod','contactNote','contactTitle','contactGender','socialPlatform','socialAccount','phoneCountryCode','alternateEmail','birthday'];

function contactRecords(profile){
  const list=[];
  const main={};
  for(const [single,multi] of [['contact','contacts'],['email','emails'],['phone','phones'],['address','addresses']])
    main[single]=trim(Array.isArray(profile[multi])&&profile[multi][0]!==undefined?profile[multi][0]:profile[single]);
  if(main.contact||main.email||main.phone||main.address)list.push(main);
  for(const c of Array.isArray(profile.extraContacts)?profile.extraContacts:[])if(c&&typeof c==='object')list.push(c);
  return list;
}
function sameContact(a,b){
  const ea=norm(a.email),eb=norm(b.email),pa=digits(a.phone),pb=digits(b.phone);
  if(ea&&eb&&ea===eb)return true;
  if(pa&&pb&&pa===pb)return true;
  return false;
}

function mergePreview(state,primary,others){
  const known=knownNames(state);
  const list=[...new Set((others||[]).map(trim))].filter(n=>n!==primary);
  if(!known.has(primary))throw new Error('保留的客户不存在');
  if(!list.length)throw new Error('请至少再选一位要合并进来的客户');
  if(list.some(n=>!known.has(n)))throw new Error('所选客户不存在，请重新选择');
  if([primary,...list].some(n=>bucketOf(profiles(state)[n])==='trash'))throw new Error('回收站里的客户不能合并，请先恢复');
  const count={orders:0,opportunities:0,segments:0,followups:0,contacts:0};
  const set=new Set(list);
  for(const bucket of ['orders','trashOrders','deletedOrders'])count.orders+=(state[bucket]||[]).filter(o=>set.has(o.client)).length;
  count.opportunities=(state.laiOpportunities||[]).filter(o=>set.has(o.client)).length;
  count.segments=(state.previewSegments||[]).filter(s=>(s.members||[]).some(m=>set.has(m))).length;
  for(const n of list){
    const p=profiles(state)[n]||{};
    count.followups+=(Array.isArray(p.history)?p.history:[]).length;
    count.contacts+=contactRecords(p).length;
  }
  return {primary,others:list,count};
}

function mergeCustomers(state,primary,others,at=new Date().toISOString()){
  const {others:list}=mergePreview(state,primary,others);
  const all=profiles(state);
  const base={...(all[primary]||{}),client:primary};
  const srcs=list.map(n=>({name:n,p:all[n]||{}}));
  // 1. 空着的资料用被合并客户补上
  for(const key of fillKeys(base,srcs)){
    if(trim(base[key]))continue;
    const hit=srcs.find(s=>trim(s.p[key]));
    if(hit)base[key]=hit.p[key];
  }
  // 自定义字段：保留客户已填的优先；空着的用被合并客户补上（按所选顺序，第一个有值的）。设置里已删的字段的值也一样带上。
  const customOf=p=>p&&p.custom&&typeof p.custom==='object'&&!Array.isArray(p.custom)?p.custom:{};
  const filledValue=v=>Array.isArray(v)?v.length>0:v!==undefined&&v!==null&&trim(v)!=='';
  if(srcs.some(s=>Object.keys(customOf(s.p)).length)){
    const custom={...customOf(base)};
    for(const s of srcs)for(const [id,v] of Object.entries(customOf(s.p)))if(!filledValue(custom[id])&&filledValue(v))custom[id]=Array.isArray(v)?[...v]:v;
    base.custom=custom;
  }
  if(!trim(base.country)){const row=M.buildCustomers(state).find(c=>c.name===primary);if(row&&trim(row.country))base.country=row.country;}
  if(srcs.some(s=>s.p.previewFollowed===true))base.previewFollowed=true;
  for(const [key,label] of NOTE_KEYS){
    const parts=[trim(base[key])];
    for(const s of srcs){const t=trim(s.p[key]);if(t&&!parts.some(x=>x.includes(t)))parts.push(`【来自 ${s.name}】${t}`);}
    const joined=parts.filter(Boolean).join('\n');
    if(joined)base[key]=joined;
  }
  // 2. 联系人
  const mine=contactRecords(base);
  const extras=Array.isArray(base.extraContacts)?base.extraContacts.map(c=>({...c})):[];
  const seen=[...mine];
  let n=0;
  for(const s of srcs)for(const rec of contactRecords(s.p)){
    if(!CONTACT_KEYS.some(k=>trim(rec[k])))continue;
    if(seen.some(x=>sameContact(x,rec)))continue;
    const item={id:`merged-${Date.parse(at)||0}-${n++}`};
    for(const k of CONTACT_KEYS)if(trim(rec[k]))item[k]=trim(rec[k]);
    for(const mk of ['emails','phones','additionalPhones'])if(Array.isArray(rec[mk]))item[mk]=rec[mk];
    extras.push(item);seen.push(item);
  }
  if(extras.length){
    base.extraContacts=extras;
    for(const [single,multi] of [['contact','contacts'],['email','emails'],['phone','phones'],['address','addresses']]){
      const first=trim(Array.isArray(base[multi])&&base[multi][0]!==undefined?base[multi][0]:base[single]);
      base[multi]=[first,...extras.map(c=>trim(c[single]))];
    }
  }
  // 3. 标签、跟进时间、动态
  base.tags=[...new Set([base,...srcs.map(s=>s.p)].flatMap(p=>M.tags(p.tags)))];
  const nexts=[base,...srcs.map(s=>s.p)].map(p=>trim(p.nextFollow)).filter(Boolean).sort();
  if(nexts.length)base.nextFollow=nexts[0];
  for(const key of ['lastFollowup','lastWrittenFollowup']){
    const v=[base,...srcs.map(s=>s.p)].map(p=>trim(p[key])).filter(Boolean).sort().pop();
    if(v)base[key]=v;
  }
  const created=[base,...srcs.map(s=>s.p)].map(p=>trim(p.createdAt)).filter(Boolean).sort()[0];
  if(created)base.createdAt=created;
  let history=[...(Array.isArray(base.history)?base.history:[])];
  const incoming=[];
  for(const s of srcs)for(const h of Array.isArray(s.p.history)?s.p.history:[])incoming.push(h&&typeof h==='object'?{...h,mergedFrom:s.name}:h);
  // 两边都导入过同一段 WhatsApp 聊天时，重复的聊天行只留一份（沟通模块的规则）；没有沟通模块时按原来的办法合并。
  const WA=typeof module!=='undefined'&&module.exports?require('./whatsapp-model.js'):root.LaiWhatsAppModel;
  let droppedChat=0;
  if(WA&&typeof WA.mergeChatHistoryCapped==='function'){const merged=WA.mergeChatHistoryCapped(history,incoming);history=merged.history;droppedChat=merged.dropped;}
  else if(WA&&typeof WA.mergeChatHistory==='function')history=WA.mergeChatHistory(history,incoming);
  else{history.push(...incoming);history.sort((a,b)=>(time(b?.time)||0)-(time(a?.time)||0));}
  history.unshift({time:at,text:`合并客户：${list.join('、')} → ${primary}`,type:'operation'});
  // 合并后聊天太多放不下时，较早的聊天没有带过来，记一笔说明。
  if(droppedChat)history.unshift({time:at,text:`合并后聊天太多，较早的 ${droppedChat} 条聊天没有保留（只留最新的）`,type:'operation'});
  base.history=history;
  base.mergedFrom=[...(Array.isArray(base.mergedFrom)?base.mergedFrom:[]),...list.map(name=>({name,at}))];
  base.updated=at;
  // 4. 全局改名
  const set=new Set(list);
  const re=v=>set.has(v)?primary:v;
  const customers={...all};
  for(const name of list)delete customers[name];
  customers[primary]=base;
  const next={...state,customers};
  for(const bucket of ['orders','trashOrders','deletedOrders'])
    if(Array.isArray(state[bucket]))next[bucket]=state[bucket].map(o=>set.has(o.client)?{...o,client:primary}:o);
  // 协同（待办）已去掉（D-031），存着的 laiTasks 仍跟着改客户名，数据保持一致。
  if(Array.isArray(state.laiTasks))next.laiTasks=state.laiTasks.map(t=>set.has(t.customer)?{...t,customer:primary}:t);
  if(Array.isArray(state.laiOpportunities))next.laiOpportunities=state.laiOpportunities.map(o=>set.has(o.client)?{...o,client:primary}:o);
  if(Array.isArray(state.previewSegments))next.previewSegments=state.previewSegments.map(s=>Array.isArray(s.members)?{...s,members:[...new Set(s.members.map(re))]}:s);
  return next;
}

// ============ 标签管理 ============
function tagStats(state){
  const map=new Map();
  for(const [name,p] of Object.entries(profiles(state))){
    if(bucketOf(p)==='trash')continue;
    for(const t of M.tags(p.tags)){
      const e=map.get(t)||{tag:t,count:0,customers:[]};
      e.count++;e.customers.push(name);map.set(t,e);
    }
  }
  return [...map.values()].sort((a,b)=>b.count-a.count||a.tag.localeCompare(b.tag,'zh'));
}
function validTag(v){
  const t=trim(v);
  if(!t)throw new Error('请输入标签名称');
  if(/[,，]/.test(t))throw new Error('标签名称不能包含逗号');
  if(t.length>40)throw new Error('标签名称最长 40 个字');
  return t;
}
function mapTags(state,fn,label,at){
  const customers={...profiles(state)};
  let touched=0;
  for(const [name,p] of Object.entries(customers)){
    const cur=M.tags(p.tags);
    const out=[...new Set(fn(cur))];
    if(out.length===cur.length&&out.every((t,i)=>t===cur[i]))continue;
    touched++;
    customers[name]={...p,client:name,tags:out,updated:at,history:[{time:at,text:label,type:'operation'},...(Array.isArray(p.history)?p.history:[])]};
  }
  if(!touched)throw new Error('没有客户使用这个标签');
  return {state:{...state,customers},touched};
}
// 重命名；新名称已存在时等于把两个标签合并成一个。
function renameTag(state,oldTag,newTag,at=new Date().toISOString()){
  const from=trim(oldTag),to=validTag(newTag);
  if(from===to)throw new Error('新名称和原名称相同');
  return mapTags(state,tags=>tags.map(t=>t===from?to:t),`标签「${from}」改名为「${to}」`,at);
}
function deleteTag(state,tag,at=new Date().toISOString()){
  const t=trim(tag);
  return mapTags(state,tags=>tags.filter(x=>x!==t),`删除标签「${t}」`,at);
}

// ============ 批量建档 ============
// 每行一位客户，列用 Tab 或逗号分隔：名称，联系人，邮箱，电话，国家（后四列可省略）。
function parseBatch(text){
  return String(text??'').split(/\r?\n/).map((raw,i)=>({line:i+1,raw})).filter(r=>trim(r.raw)).map(r=>{
    const cols=r.raw.split(/\t|,|，/).map(trim);
    const [name='',contact='',email='',phone='',country='']=cols;
    return {line:r.line,raw:r.raw,name,contact,email,phone,country};
  });
}
function batchCreate(state,text,defaults={},at=new Date().toISOString()){
  const rows=parseBatch(text);
  if(!rows.length)throw new Error('请粘贴要建档的客户，每行一位');
  if(rows.length>500)throw new Error('一次最多建档 500 位客户');
  const source=trim(defaults.source)||'批量建档';
  const tags=M.tags(defaults.tags);
  let cur=state;
  const created=[],skipped=[];
  for(const row of rows){
    const country=row.country||trim(defaults.country);
    try{
      if(!row.name)throw new Error('缺少客户名称');
      if(row.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email))throw new Error('邮箱格式不对');
      if(!country)throw new Error('缺少国家地区（请在上面填默认国家，或在这一行末尾写上）');
      // 邮箱、电话等是否算重复，按“客户设置 → 判重设置”：不允许保存的跳过这一行并写明原因，允许保存的照建，不判重的不查。
      // upsertCustomer 保存前会按这份设置检查（包括这一批里前面刚建的客户）。
      cur=M.upsertCustomer(cur,'',{name:row.name,contact:row.contact,email:row.email,phone:row.phone,country,source,owner:trim(defaults.owner),tags},at);
      created.push(row.name);
    }catch(e){skipped.push({line:row.line,raw:row.raw,reason:e.message});}
  }
  return {state:cur,created,skipped};
}

// ============ 公海规则 ============
// 存在 state.laiSettings.poolRules（v2）。旧版（一条「未跟进天数」规则）读取时自动变成一条名为「N 天未联系」的规则。
// 规则：kind=noContact 按最近联系时间算，noDeal 按最近成交时间算；groups 为空表示所有客户；
// 一位客户同时命中几条规则时，取离到期最近（dueInDays 最小）的那一条。
const MAX_RULES=10,MAX_WHITELIST=200,MAX_REASONS=30;
const DEFAULT_POOL_RULES=Object.freeze({
  version:2,rules:Object.freeze([]),remindDays:7,whitelist:Object.freeze([]),skipOpenOrders:true,skipFollowed:true,skipTags:Object.freeze([]),
  reclaimBlockDays:0,claimLimit:Object.freeze({periodDays:1,defaultLimit:0,perOwner:Object.freeze({})}),
  showPoolContacts:true,requireReason:false,reasons:Object.freeze([])
});
const KINDS=['noContact','noDeal'];
const isPlain=v=>v&&typeof v==='object'&&!Array.isArray(v);
const intIn=(v,min,max)=>{
  if(v===''||v===null||v===undefined||typeof v==='boolean')return NaN;
  const n=Number(v);
  return Number.isInteger(n)&&n>=min&&n<=max?n:NaN;
};
const validDate=v=>{
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if(!m)return false;
  const d=new Date(+m[1],+m[2]-1,+m[3]);
  return d.getFullYear()===+m[1]&&d.getMonth()===+m[2]-1&&d.getDate()===+m[3];
};
const uniqueList=v=>[...new Set((Array.isArray(v)?v:[]).map(trim).filter(Boolean))];
const newRuleId=()=>`r${Date.now().toString(36)}${Math.random().toString(36).slice(2,7)}`;
// 把旧版（没有 rules 数组、有 noFollowDays）换成 v2 的写法。
function fromV1(raw,strict,stored){
  const hasV1=['enabled','noFollowDays','skipOpenOrders','skipTags','skipFollowed'].some(k=>raw[k]!==undefined);
  if(!hasV1)return [];
  const days=Math.floor(Number(raw.noFollowDays));
  if(!Number.isFinite(days)||days<1||days>3650){
    if(strict)throw new Error('未跟进天数请填 1–3650 之间的整数');
    return [{id:'legacy',name:'90 天未联系',enabled:!stored&&raw.enabled===true,kind:'noContact',days:90,groups:[],startDate:''}];
  }
  // 存着的旧规则以前只在点「立即执行」时才动；现在开着就每天自动执行，所以读出来先关着，等老板看过预览再打开。
  return [{id:'legacy',name:`${days} 天未联系`,enabled:!stored&&raw.enabled===true,kind:'noContact',days,groups:[],startDate:''}];
}
// strict=true：校验并报中文错误；strict=false：坏值回到默认值或丢掉，不报错。
function buildRule(r,strict){
  const fail=msg=>{if(strict)throw new Error(msg);return null;};
  if(!isPlain(r))return fail('规则格式不对');
  const name=trim(r.name);
  if(!name||name.length>20)return fail('规则名称请填 1–20 个字');
  const days=intIn(r.days,1,3650);
  if(Number.isNaN(days))return fail('天数请填 1–3650 之间的整数');
  let kind=r.kind;
  if(kind===undefined||kind===null||kind==='')kind='noContact';
  if(!KINDS.includes(kind)){if(strict)throw new Error('规则类型不对');kind='noContact';}
  let groups=[];
  if(Array.isArray(r.groups))groups=uniqueList(r.groups);
  else if(r.groups!==undefined&&r.groups!==null&&strict)throw new Error('客户分组格式不对');
  let startDate=trim(r.startDate);
  if(startDate&&!validDate(startDate)){if(strict)throw new Error('开始日期请填 YYYY-MM-DD');startDate='';}
  return {id:trim(r.id)||newRuleId(),name,enabled:r.enabled===true,kind,days,groups,startDate};
}
function buildRules(list,strict){
  if(list.length>MAX_RULES&&strict)throw new Error('最多 10 条规则');
  const out=[],names=new Set(),ids=new Set();
  for(const item of list.slice(0,MAX_RULES)){
    const rule=buildRule(item,strict);
    if(!rule)continue;
    const key=rule.name.toLowerCase();
    if(names.has(key)){if(strict)throw new Error('规则名称不能重复');continue;}
    names.add(key);
    if(ids.has(rule.id)){if(strict)throw new Error('规则编号重复');rule.id=newRuleId();}
    ids.add(rule.id);
    out.push(rule);
  }
  return out;
}
function buildPool(raw,strict,stored=false){
  raw=isPlain(raw)?raw:{};
  const d=DEFAULT_POOL_RULES;
  const num=(v,min,max,def,msg)=>{
    if(v===undefined||v===null)return def;
    const n=intIn(v,min,max);
    if(Number.isNaN(n)){if(strict)throw new Error(msg);return def;}
    return n;
  };
  let list;
  if(Array.isArray(raw.rules))list=raw.rules;
  else if(raw.rules!==undefined&&raw.rules!==null&&strict)throw new Error('规则格式不对');
  else list=fromV1(raw,strict,stored);
  const rules=buildRules(list,strict);
  const remindDays=num(raw.remindDays,0,30,d.remindDays,'提前提醒天数请填 0–30');
  const reclaimBlockDays=num(raw.reclaimBlockDays,0,365,d.reclaimBlockDays,'原跟进人限制天数请填 0–365');
  const cl=isPlain(raw.claimLimit)?raw.claimLimit:{};
  const periodDays=num(cl.periodDays,1,365,d.claimLimit.periodDays,'领取统计天数请填 1–365');
  const defaultLimit=num(cl.defaultLimit,0,100000,0,'领取上限请填 0–100000，0 表示不限');
  const perOwner={};
  if(isPlain(cl.perOwner))for(const [k,v] of Object.entries(cl.perOwner)){
    const owner=trim(k);
    if(!owner||v===null||v===undefined||v==='')continue;
    const n=intIn(v,0,100000);
    if(Number.isNaN(n)){if(strict)throw new Error('领取上限请填 0–100000，0 表示不限');continue;}
    perOwner[owner]=n;
  }
  let whitelist=uniqueList(raw.whitelist).map(n=>n.slice(0,120));
  whitelist=[...new Set(whitelist)];
  if(whitelist.length>MAX_WHITELIST){if(strict)throw new Error('白名单最多 200 人');whitelist=whitelist.slice(0,MAX_WHITELIST);}
  const rawReasons=(Array.isArray(raw.reasons)?raw.reasons:[]).map(trim).filter(Boolean);
  let reasons=[...new Set(rawReasons)];
  if(strict&&rawReasons.some(r=>r.length>20))throw new Error('原因最多 20 个字');
  if(strict&&reasons.length!==rawReasons.length)throw new Error('原因不能重复');
  reasons=reasons.filter(r=>r.length<=20);
  if(reasons.length>MAX_REASONS){if(strict)throw new Error('最多 30 个原因');reasons=reasons.slice(0,MAX_REASONS);}
  return {
    version:2,rules,remindDays,whitelist,
    skipOpenOrders:raw.skipOpenOrders!==false,skipFollowed:raw.skipFollowed!==false,skipTags:M.tags(raw.skipTags),
    reclaimBlockDays,claimLimit:{periodDays,defaultLimit,perOwner},
    showPoolContacts:raw.showPoolContacts!==false,requireReason:raw.requireReason===true,reasons
  };
}
function poolRules(state){return buildPool(state?.laiSettings?.poolRules,false,true);}
function store(state,rules){
  const kept=state?.laiSettings?.poolRules?.lastAutoRun;
  const saved=kept?{...rules,lastAutoRun:kept}:rules;
  return {...state,laiSettings:{...(state.laiSettings||{}),poolRules:saved}};
}
function setPoolRules(state,input){return store(state,buildPool(input,true));}
function savePoolRule(state,rule){
  const cur=poolRules(state);
  const id=trim(rule&&rule.id);
  const index=id?cur.rules.findIndex(r=>r.id===id):-1;
  const rules=cur.rules.slice();
  if(index>=0)rules[index]={...rule,id};
  else{
    if(rules.length>=MAX_RULES)throw new Error('最多 10 条规则');
    rules.push({...rule,id:id||newRuleId()});
  }
  return setPoolRules(state,{...cur,rules});
}
function deletePoolRule(state,id){
  const cur=poolRules(state);
  if(!cur.rules.some(r=>r.id===id))throw new Error('规则不存在');
  return setPoolRules(state,{...cur,rules:cur.rules.filter(r=>r.id!==id)});
}

// 建档时间：档案里最早的一个时间。
function creationTime(profile){
  const base=[profile.createdAt,...(Array.isArray(profile.history)?profile.history.map(h=>h?.time):[])].map(time).filter(Number.isFinite);
  return base.length?Math.min(...base):NaN;
}
// 最近一次动静：写过的跟进、订单、邮件往来；都没有就用建档时间。
function lastActivity(state,name,profile){
  const stamps=[profile.lastFollowup,profile.lastWrittenFollowup,profile.lastPrivatePoolEntry];
  for(const h of Array.isArray(profile.history)?profile.history:[])if(h&&['followup','mail'].includes(h.type))stamps.push(h.time);
  for(const o of state.orders||[])if(o.client===name)stamps.push(o.createdAt,o.updated);
  const t=stamps.map(time).filter(Number.isFinite);
  if(t.length)return Math.max(...t);
  return creationTime(profile);
}
// customer-settings-model.js 的 contactTimes / lastDealDate 由别的任务加；用到才取，没有就退回旧算法。
const settingsModel=()=>typeof module!=='undefined'&&module.exports?require('./customer-settings-model.js'):root.LaiCustomerSettings;
function lastDealOf(state,name){
  const stamps=(state.orders||[]).filter(o=>o.client===name&&!o.isDraft&&['shipment','done'].includes(o.stage)).map(o=>time(o.shippedAt||o.createdAt)).filter(Number.isFinite);
  return stamps.length?new Date(Math.max(...stamps)).toISOString():'';
}
const defaultTimes=Object.freeze({
  lastContact(state,name){
    const CS=settingsModel();
    // 刚从公海领回的客户，不管“最近联系”里有没有勾“从公海领回”，领回时间都算（否则刚领回就又被移走）。
    const claimed=trim(profiles(state)[name]?.lastPrivatePoolEntry);
    if(CS&&typeof CS.contactTimes==='function'){
      const contact=trim(CS.contactTimes(state,name)?.lastContact);
      return Number.isFinite(time(claimed))&&(!Number.isFinite(time(contact))||time(claimed)>time(contact))?claimed:contact;
    }
    const t=lastActivity(state,name,profiles(state)[name]||{});
    return Number.isFinite(t)?new Date(t).toISOString():'';
  },
  lastDeal(state,name){
    const CS=settingsModel();
    if(CS&&typeof CS.lastDealDate==='function')return trim(CS.lastDealDate(state,name));
    return lastDealOf(state,name);
  }
});
// 规则里选了一级分组，它下面的子分组也算。
const groupMatches=(rule,group)=>{
  if(!rule.groups.length)return true;
  const g=trim(group);
  return !!g&&rule.groups.some(p=>g===p||g.startsWith(`${p} / `));
};
const groupsOf=(row,profile)=>{
  const g=row.group??profile.previewGroup??profile.customerGroup;
  return Array.isArray(g)?g.map(trim):[trim(g)];
};
// 每位在用中的客户，取离到期最近的一条规则。dueInDays<=0 就是已到期。
function evaluate(state,rules,now,times,only){
  rules=buildPool(rules,false);
  const active=rules.rules.filter(r=>r.enabled);
  if(!active.length)return [];
  const out=[];
  const openStages=new Set(['quote','deposit','production','balance']);
  const lower=v=>trim(v).toLowerCase();
  const white=new Set(rules.whitelist.map(lower));
  const skipTags=new Set(rules.skipTags.map(lower));
  let openClients=null;
  const hasOpenOrder=name=>{
    if(!openClients)openClients=new Set((state.orders||[]).filter(o=>o&&!o.isDraft&&openStages.has(o.stage)).map(o=>o.client));
    return openClients.has(name);
  };
  // 只算一位客户时，只拿这一位的订单和资料来建行（行只取决于这两样），不用把所有客户都建一遍。
  const source=only?{...state,orders:(state.orders||[]).filter(o=>o.client===only),customers:Object.hasOwn(state.customers||{},only)?{[only]:state.customers[only]}:{}}:state;
  for(const row of M.buildCustomers(source)){
    if(only&&row.name!==only)continue;
    const p=profiles(state)[row.name]||{};
    if(bucketOf(p)!=='active')continue;
    const owner=trim(row.owner);
    if(!owner||white.has(lower(owner)))continue; // 没有跟进人的客户不算「被放着不管」
    if(rules.skipFollowed&&p.previewFollowed===true)continue;
    if(skipTags.size&&M.tags(p.tags).some(t=>skipTags.has(lower(t))))continue;
    if(rules.skipOpenOrders&&hasOpenOrder(row.name))continue;
    const groups=groupsOf(row,p);
    let best=null;
    // 最近联系 / 最近成交每位客户最多算一次，而且只在有规则用到时才算。
    const memo={};
    const timeOf=kind=>kind in memo?memo[kind]:(memo[kind]=time(kind==='noDeal'?times.lastDeal(state,row.name):times.lastContact(state,row.name)));
    for(const rule of active){
      if(!groups.some(g=>groupMatches(rule,g)))continue;
      let basis=timeOf(rule.kind);
      if(!Number.isFinite(basis))basis=creationTime(p);
      if(!Number.isFinite(basis))continue;
      if(rule.startDate){
        const [y,m,d]=rule.startDate.split('-').map(Number);
        basis=Math.max(basis,new Date(y,m-1,d).getTime());
      }
      const days=Math.floor((now.getTime()-basis)/86400000);
      const dueInDays=rule.days-days;
      if(!best||dueInDays<best.dueInDays)best={name:row.name,owner,ruleId:rule.id,ruleName:rule.name,kind:rule.kind,days,dueInDays,basis:isoDay(new Date(basis))};
    }
    if(best)out.push(best);
  }
  return out;
}
function poolCandidates(state,rules=poolRules(state),now=new Date(),times=defaultTimes){
  return evaluate(state,rules,now,times).filter(c=>c.dueInDays<=0).sort((a,b)=>b.days-a.days||a.name.localeCompare(b.name,'zh'));
}
function poolReminders(state,now=new Date(),times=defaultTimes){
  const rules=poolRules(state);
  if(!rules.remindDays)return [];
  return evaluate(state,rules,now,times).filter(c=>c.dueInDays>0&&c.dueInDays<=rules.remindDays).sort((a,b)=>a.dueInDays-b.dueInDays||a.name.localeCompare(b.name,'zh'));
}
function poolForecast(state,name,now=new Date(),times=defaultTimes){
  const rules=poolRules(state);
  const hit=evaluate(state,rules,now,times,name)[0];
  if(!hit||(hit.dueInDays>0&&hit.dueInDays>rules.remindDays))return null;
  return {ruleName:hit.ruleName,dueInDays:hit.dueInDays};
}
function applyPoolRules(state,now=new Date(),times=defaultTimes){
  const list=poolCandidates(state,poolRules(state),now,times);
  if(!list.length)return {state,moved:[]};
  const at=now.toISOString();
  let next=state;
  const byRule=new Map();
  for(const c of list)byRule.set(c.ruleId,[...(byRule.get(c.ruleId)||[]),c]);
  // 历史记录下面统一写（带天数），所以这里让 moveCustomers 不再写一条。
  for(const group of byRule.values())next=LM.moveCustomers(next,group.map(c=>c.name),'pool',at,{reason:group[0].ruleName,history:false});
  const customers={...next.customers};
  for(const c of list)customers[c.name]={...customers[c.name],history:[{time:at,text:`公海规则「${c.ruleName}」：${c.days} 天没有${c.kind==='noContact'?'联系':'成交'}，自动移入公海`,type:'operation'},...(customers[c.name].history||[])]};
  return {state:{...next,customers},moved:list};
}
const localDay=now=>isoDay(now instanceof Date?now:new Date(now));
// 一天自动执行一次：有开着的规则，且今天还没执行过。
function autoRunDue(state,now=new Date()){
  if(!poolRules(state).rules.some(r=>r.enabled))return false;
  return trim(state?.laiSettings?.poolRules?.lastAutoRun)!==localDay(now);
}
function markAutoRun(state,now=new Date()){
  const stored=isPlain(state?.laiSettings?.poolRules)?state.laiSettings.poolRules:poolRules(state);
  return {...state,laiSettings:{...(state.laiSettings||{}),poolRules:{...stored,lastAutoRun:localDay(now)}}};
}
const poolContactsVisible=state=>poolRules(state).showPoolContacts;
// 领回记录在客户资料的 poolClaims 里（moveCustomers 写入，每位客户留最近 20 条）。
function claimCount(state,owner,now=new Date()){
  const who=trim(owner),since=now.getTime()-poolRules(state).claimLimit.periodDays*86400000;
  let n=0;
  for(const p of Object.values(profiles(state)))
    for(const c of Array.isArray(p&&p.poolClaims)?p.poolClaims:[]){
      const t=time(c&&c.time);
      if(c&&trim(c.owner)===who&&Number.isFinite(t)&&t>since&&t<=now.getTime())n++;
    }
  return n;
}
function claimLimitFor(state,owner){
  const cl=poolRules(state).claimLimit,who=trim(owner);
  return Object.hasOwn(cl.perOwner,who)?cl.perOwner[who]:cl.defaultLimit;
}

const api={mergePreview,mergeCustomers,tagStats,renameTag,deleteTag,parseBatch,batchCreate,DEFAULT_POOL_RULES,poolRules,setPoolRules,savePoolRule,deletePoolRule,defaultTimes,poolCandidates,poolReminders,poolForecast,applyPoolRules,autoRunDue,markAutoRun,poolContactsVisible,claimCount,claimLimitFor};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LaiCustomerTools=api;
})(typeof window!=='undefined'?window:globalThis);
