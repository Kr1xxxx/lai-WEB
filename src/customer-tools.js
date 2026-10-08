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
  const count={orders:0,tasks:0,opportunities:0,segments:0,followups:0,contacts:0};
  const set=new Set(list);
  for(const bucket of ['orders','trashOrders','deletedOrders'])count.orders+=(state[bucket]||[]).filter(o=>set.has(o.client)).length;
  count.tasks=(state.laiTasks||[]).filter(t=>set.has(t.customer)).length;
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
  for(const key of FILL_KEYS){
    if(trim(base[key]))continue;
    const hit=srcs.find(s=>trim(s.p[key]));
    if(hit)base[key]=hit.p[key];
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
  const history=[...(Array.isArray(base.history)?base.history:[])];
  for(const s of srcs)for(const h of Array.isArray(s.p.history)?s.p.history:[])history.push(h&&typeof h==='object'?{...h,mergedFrom:s.name}:h);
  history.sort((a,b)=>(time(b?.time)||0)-(time(a?.time)||0));
  history.unshift({time:at,text:`合并客户：${list.join('、')} → ${primary}`,type:'operation'});
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
  const emails=new Map(),phones=new Map();
  for(const row of M.buildCustomers(state)){
    for(const e of [row.email,...(row.emails||[])])if(norm(e))emails.set(norm(e),row.name);
    for(const p of [row.phone,...(row.phones||[])])if(digits(p).length>=6)phones.set(digits(p),row.name);
  }
  for(const row of rows){
    const country=row.country||trim(defaults.country);
    try{
      if(!row.name)throw new Error('缺少客户名称');
      if(row.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email))throw new Error('邮箱格式不对');
      if(!country)throw new Error('缺少国家地区（请在上面填默认国家，或在这一行末尾写上）');
      const dupe=(row.email&&emails.get(norm(row.email)))||(digits(row.phone).length>=6&&phones.get(digits(row.phone)));
      if(dupe)throw new Error(`邮箱或电话和已有客户「${dupe}」相同`);
      cur=M.upsertCustomer(cur,'',{name:row.name,contact:row.contact,email:row.email,phone:row.phone,country,source,owner:trim(defaults.owner),tags},at);
      if(row.email)emails.set(norm(row.email),row.name);
      if(digits(row.phone).length>=6)phones.set(digits(row.phone),row.name);
      created.push(row.name);
    }catch(e){skipped.push({line:row.line,raw:row.raw,reason:e.message});}
  }
  return {state:cur,created,skipped};
}

// ============ 公海规则 ============
const DEFAULT_POOL_RULES=Object.freeze({enabled:false,noFollowDays:90,skipOpenOrders:true,skipTags:[],skipFollowed:true});
function poolRules(state){
  const r=state?.laiSettings?.poolRules||{};
  const days=Math.floor(Number(r.noFollowDays));
  return {
    enabled:r.enabled===true,
    noFollowDays:Number.isFinite(days)&&days>=1&&days<=3650?days:DEFAULT_POOL_RULES.noFollowDays,
    skipOpenOrders:r.skipOpenOrders!==false,
    skipTags:M.tags(r.skipTags),
    skipFollowed:r.skipFollowed!==false
  };
}
function setPoolRules(state,input){
  const days=Math.floor(Number(input.noFollowDays));
  if(!Number.isFinite(days)||days<1||days>3650)throw new Error('未跟进天数请填 1–3650 之间的整数');
  const rules={enabled:input.enabled===true,noFollowDays:days,skipOpenOrders:input.skipOpenOrders!==false,skipTags:M.tags(input.skipTags),skipFollowed:input.skipFollowed!==false};
  return {...state,laiSettings:{...(state.laiSettings||{}),poolRules:rules}};
}
// 最近一次动静：写过的跟进、订单、邮件往来；都没有就用建档时间。
function lastActivity(state,name,profile){
  const stamps=[profile.lastFollowup,profile.lastWrittenFollowup,profile.lastPrivatePoolEntry];
  for(const h of Array.isArray(profile.history)?profile.history:[])if(h&&['followup','mail'].includes(h.type))stamps.push(h.time);
  for(const o of state.orders||[])if(o.client===name)stamps.push(o.createdAt,o.updated);
  let t=stamps.map(time).filter(Number.isFinite);
  if(!t.length){
    const base=[profile.createdAt,...(Array.isArray(profile.history)?profile.history.map(h=>h?.time):[])].map(time).filter(Number.isFinite);
    if(base.length)t=[Math.min(...base)];
  }
  return t.length?Math.max(...t):NaN;
}
function poolCandidates(state,rules=poolRules(state),now=new Date()){
  const out=[];
  const openStages=new Set(['quote','deposit','production','balance']);
  for(const row of M.buildCustomers(state)){
    const p=profiles(state)[row.name]||{};
    if(bucketOf(p)!=='active')continue;
    if(!trim(row.owner))continue; // 没有跟进人的客户不算「被放着不管」
    if(rules.skipFollowed&&p.previewFollowed===true)continue;
    if(rules.skipTags.length&&M.tags(p.tags).some(t=>rules.skipTags.includes(t)))continue;
    if(rules.skipOpenOrders&&(state.orders||[]).some(o=>o.client===row.name&&!o.isDraft&&openStages.has(o.stage)))continue;
    const last=lastActivity(state,row.name,p);
    if(!Number.isFinite(last))continue;
    const days=Math.floor((now.getTime()-last)/86400000);
    if(days>=rules.noFollowDays)out.push({name:row.name,owner:row.owner,days,lastActivity:isoDay(new Date(last))});
  }
  return out.sort((a,b)=>b.days-a.days||a.name.localeCompare(b.name,'zh'));
}
function applyPoolRules(state,now=new Date()){
  const rules=poolRules(state);
  const list=poolCandidates(state,rules,now);
  if(!list.length)throw new Error('现在没有符合公海规则的客户');
  const at=now.toISOString();
  let next=LM.moveCustomers(state,list.map(c=>c.name),'pool',at);
  const customers={...next.customers};
  for(const c of list)customers[c.name]={...customers[c.name],history:[{time:at,text:`公海规则：${c.days} 天没有跟进，自动移入公海`,type:'operation'},...(customers[c.name].history||[])]};
  return {state:{...next,customers},moved:list};
}

const api={mergePreview,mergeCustomers,tagStats,renameTag,deleteTag,parseBatch,batchCreate,DEFAULT_POOL_RULES,poolRules,setPoolRules,poolCandidates,applyPoolRules};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LaiCustomerTools=api;
})(typeof window!=='undefined'?window:globalThis);
