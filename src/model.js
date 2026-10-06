(function (root) {
  'use strict';
  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const tags = value => Array.isArray(value) ? value.filter(Boolean).map(String) : String(value || '').split(/[,，]/).map(s => s.trim()).filter(Boolean);
  const amount = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dateValue = value => Date.parse(String(value || '').replace(' ', 'T')) || 0;
  function customerLevelForRow(row) {
    const saved=String(row.level||'').trim();
    if(saved&&saved!=='自动判断')return saved;
    if(row.missingRates>0)return '';
    const value=Number(row.total||0),count=Number(row.orderCount||0);
    if(value>100000)return 'A级钻石客户';
    if(value>=50000)return 'B级翡翠客户';
    if(value>=10000&&count>1)return 'C级白金客户';
    if(value>=1000&&count>1)return 'D级黄金客户';
    if(value<1000&&count>1)return 'E级白银客户';
    return 'F级青铜客户';
  }
  function contactRecordsWithIds(records, prefix, offset = 0) {
    const entries = Array.isArray(records) ? records : [];
    const used = new Set(entries.map(entry => String(entry?.id || '').trim()).filter(Boolean));
    return entries.map((entry, index) => {
      let id = String(entry?.id || '').trim();
      if (!id) {
        const base = prefix + (index + offset);
        id = base;
        let suffix = 1;
        while (used.has(id)) id = base + '-' + suffix++;
        used.add(id);
      }
      return {...entry, id};
    });
  }
  function contactMethods(previous, incoming, keys, required) {
    if(!Array.isArray(incoming))throw new Error('联系人附加方式格式无效');
    const old=contactRecordsWithIds(previous,'method-');
    return incoming.map((entry,index)=>{
      if(!entry||typeof entry!=='object'||Array.isArray(entry))throw new Error('联系人附加方式格式无效');
      const id=String(entry.id||`method-${index}`).trim();
      const saved=old.find(item=>item?.id===id)||{};
      const result={...saved,id};
      for(const key of keys)result[key]=String(entry[key]??'').trim();
      return result;
    }).filter(entry=>entry[required]);
  }
  const methodFields=[['additionalPhones',['phoneCountryCode','phone'],'phone'],['additionalSocialAccounts',['socialPlatform','socialAccount'],'socialAccount']];
  const batchEditableCustomerFields=Object.freeze([
    {id:'source',label:'客户来源'},
    {id:'customerStage',label:'客户阶段'},
    {id:'country',label:'国家地区'},
    {id:'level',label:'客户等级'},
    {id:'customerStars',label:'客户星级'},
    {id:'website',label:'公司网址'},
    {id:'productType',label:'主营产品.'},
    {id:'companyProducts',label:'主营产品'},
    {id:'timezone',label:'时区'},
    {id:'cardStock',label:'卡纸'},
    {id:'customBox',label:'定制盒'},
  ].map(field=>Object.freeze(field)));
  function buildCustomers(state = {}) {
    const orders = state.orders || [];
    const names = [...new Set([...Object.keys(state.customers || {}), ...orders.map(o => o.client).filter(Boolean)])];
    return names.map(name => {
      const related = orders.filter(o => o.client === name && !o.isDraft && amount(o.amount)>0).sort((a,b)=>dateValue(b.createdAt||b.updated)-dateValue(a.createdAt||a.updated));
      const profile = state.customers?.[name] || {};
      const history = Array.isArray(profile.history) ? profile.history : [];
      const recent = related[0] || orders.find(o=>o.client===name) || {};
      const values = {...recent,...profile};
      let total=0,paid=0,missingRates=0;
      for (const order of related) {
        if ((order.currency || 'USD').toUpperCase() !== 'USD') { missingRates++; continue; }
        const full = amount(order.amount);
        total += full;
        paid += ['shipment','done'].includes(order.stage) ? full : Math.min(full,amount(order.paidAmount));
      }
      const contact=profile.contacts?.[0]??values.contact??'';
      const email=profile.emails?.[0]??values.email??'';
      const phone=profile.phones?.[0]??values.phone??'';
      const address=profile.addresses?.[0]??values.address??'';
      const savedSocial=Array.isArray(profile.socialPlatforms)
        ? profile.socialPlatforms.filter(Boolean) : String(profile.socialPlatforms||'').trim();
      const mainSocial=savedSocial.length?savedSocial:
        [profile.socialPlatform||profile.social,profile.socialAccount].filter(Boolean).join(' ');
      const extraSocial=(Array.isArray(profile.additionalSocialAccounts)?profile.additionalSocialAccounts:[])
        .map(entry=>[entry?.socialPlatform,entry?.socialAccount].filter(Boolean).join(' ')).filter(Boolean);
      const socialPlatforms=[...(Array.isArray(mainSocial)?mainSocial:[mainSocial]),...extraSocial].filter(Boolean).join('、');
      const hasPrimaryContact=Boolean(contact||email||phone||address||profile.additionalPhones?.length||profile.additionalSocialAccounts?.length);
      const extraCount=Array.isArray(profile.extraContacts)?profile.extraContacts.length:0;
      const savedContactCount=Array.isArray(profile.contacts)
        ? profile.contacts.length===1&&profile.contacts[0]===''?0:profile.contacts.length : 0;
      const alignedMethodCount=Math.max(0,...['emails','phones','addresses'].map(key=>{
        const entries=profile[key];
        if(!Array.isArray(entries))return 0;
        for(let i=entries.length-1;i>=0;i--)if(String(entries[i]??'').trim())return i+1;
        return 0;
      }));
      const contactCount=Math.max(savedContactCount,alignedMethodCount,extraCount?extraCount+1:0,hasPrimaryContact?1:0);
      const row={...profile,name,client:name,country:values.country||'',contact,contactCount,
        email,phone,address,
        owner:values.owner||'',tags:tags(profile.tags),orders:related,orderCount:related.length,
        total:missingRates?null:total,paid:missingRates?null:paid,due:missingRates?null:Math.max(0,total-paid),missingRates,
        updated:profile.updated||'',sortUpdated:profile.updated||recent.updated||recent.createdAt||'',latestOrderDate:recent.createdAt||recent.updated||'',
        history,nextFollow:profile.nextFollow||'',
        alternativeEmail:profile.alternateEmail??profile.alternativeEmail??profile.backupEmail??'',
        contactNote:profile.contactNote||'',
        contactPaymentMethod:profile.contactPaymentMethod||'',customerPaymentMethod:profile.paymentMethod||'',socialPlatforms,
        group:profile.previewGroup||'',source:profile.source||'',stage:profile.customerStage||(related.length?'已成交':'未成交'),
        followed:profile.previewFollowed===true,level:profile.level||'',productType:values.productType||''};
      return {...row,displayLevel:customerLevelForRow(row)};
    });
  }
  function filterCustomers(rows = [], filters = {}) {
    const q=norm(filters.query),clock=new Date();
    const today=`${clock.getFullYear()}-${String(clock.getMonth()+1).padStart(2,'0')}-${String(clock.getDate()).padStart(2,'0')}`;
    return rows.filter(c=>{
      const search=filters.field==='email'?c.email:filters.field==='tag'?c.tags.join(' '):filters.field==='name'?c.name:[c.name,c.contact,c.country,c.email,c.phone,c.tags.join(' '),c.owner].join(' ');
      return (!q||norm(search).includes(q))&&(!filters.country||c.country===filters.country)&&(!filters.owner||c.owner===filters.owner)
        &&(!filters.tag||c.tags.some(t=>norm(t).includes(norm(filters.tag))))
        &&(!filters.stage||c.stage===filters.stage)
        &&(!filters.group||filters.group==='all'||filters.group==='won'&&c.orderCount>0||filters.group==='new'&&c.orderCount===0
        ||filters.group==='followed'&&c.followed||filters.group==='due'&&c.due>0||filters.group==='followup'&&c.nextFollow&&c.nextFollow<=today
        ||filters.group.startsWith('country:')&&c.orderCount>0&&c.country===filters.group.slice(8));
    }).sort((a,b)=>filters.sort==='name'?a.name.localeCompare(b.name):filters.sort==='amount'?(b.total??-1)-(a.total??-1):dateValue(b.sortUpdated||b.updated)-dateValue(a.sortUpdated||a.updated)||a.name.localeCompare(b.name));
  }
  function paginate(items, page=1, pageSize=20) {
    const size=Math.max(1,Math.floor(Number(pageSize)||20));
    const pageCount=Math.max(1,Math.ceil(items.length/size));
    page=Math.max(1,Math.min(pageCount,Math.floor(Number(page)||1)));
    return {items:items.slice((page-1)*size,page*size),page,pageCount,total:items.length};
  }
  function upsertCustomer(state, oldName, fields, time=new Date().toISOString()) {
    const name=String(fields.name||'').trim();
    if (!name) throw new Error('请输入公司 / 客户名称');
    if(name==='__proto__')throw new Error('该名称为系统保留名称，请填写完整公司名称');
    const orderNames=[...(state.orders||[]),...(state.trashOrders||[])].map(o=>o.client).filter(n=>n&&norm(n)!==norm(oldName));
    const known=[...Object.keys(state.customers||{}),...orderNames];
    if (known.some(n=>n!==oldName&&norm(n)===norm(name))) throw new Error('客户名称已存在，请使用其他名称');
    const previous=state.customers?.[oldName]||{};
    if(previous.laiBucket==='trash')throw new Error('请先恢复回收站客户');
    const record=buildCustomers(state).find(c=>c.name===oldName)||{};
    const next={...previous,client:name,updated:time};
    if(!oldName){
      if(!String(fields.country??'').trim())throw new Error('请输入国家地区');
      if(!String(fields.source??'').trim())throw new Error('请输入客户来源');
      next.createdAt=time;
    }
    if(Object.hasOwn(fields,'previewFollowed')){
      const followed=fields.previewFollowed;
      if(![true,false,'true','false'].includes(followed))throw new Error('关注状态格式无效');
      next.previewFollowed=followed===true||followed==='true';
    }
    for(const key of ['country','owner','email','phone','contact','address','website','source','customerStage','nextFollow','note','permanentNote','contactNote','productType','paymentMethod','paymentEmail','currency','contactPaymentMethod','alibabaId','primaryContactMethod','level','customerStars','customerCode','timezone','defaultPaymentPlan','customerAccountPeriod','companyProducts','cardStock','customBox','socialPlatform','socialAccount','phoneCountryCode','alternateEmail','birthday','shortName','landline','companyAddress','companyRemark','poolGroup','contactTitle','contactGender']){
      if(Object.hasOwn(fields,key)) next[key]=String(fields[key]??'').trim();
    }
    if(oldName&&Object.hasOwn(fields,'owner')&&next.owner!==record.owner){
      next.previousOwner=record.owner||'';
      next.ownerUpdatedAt=time;
    }
    for(const [key,keys,required] of methodFields)
      if(Object.hasOwn(fields,key))next[key]=contactMethods(previous[key],fields[key],keys,required);
    if(Object.hasOwn(fields,'repurchaseCycle')){
      const cycle=String(fields.repurchaseCycle??'').trim();
      if(cycle&&!/^\d{1,4}$/.test(cycle))throw new Error('复购周期格式无效');
      next.repurchaseCycle=Number(cycle)||0;
    }
    for(const [single,multi] of [['email','emails'],['phone','phones'],['contact','contacts'],['address','addresses']]){
      if(Object.hasOwn(fields,single)) {
        const rest=(Array.isArray(previous[multi])?previous[multi]:[]).slice(1);
        next[multi]=rest.length||next[single]?[next[single],...rest]:[];
      } else if(!Object.hasOwn(next,single)&&record[single]) {next[single]=record[single];next[multi]=[record[single]];}
    }
    if(Object.hasOwn(fields,'extraContacts')){
      if(!Array.isArray(fields.extraContacts))throw Error('联系人格式无效');
      const old=contactRecordsWithIds(previous.extraContacts,'legacy-',1);
      next.extraContacts=fields.extraContacts.map((c,i)=>{
        const item={...(old.find(item=>item.id===c.id)||{}),id:String(c.id||('legacy-'+i))};
        for(const key of ['contact','email','phone','address','alibabaId','contactPaymentMethod','contactNote','contactTitle','contactGender','socialPlatform','socialAccount','primaryContactMethod','phoneCountryCode','alternateEmail','birthday'])if(Object.hasOwn(c,key))item[key]=String(c[key]??'').trim();
        for(const [key,keys,required] of methodFields)
          if(Object.hasOwn(c,key))item[key]=contactMethods(item[key],c[key],keys,required);
        if(Object.hasOwn(c,'contactPaymentMethod'))delete item.paymentMethod;
        return item;
      });
      for(const [single,multi] of [['contact','contacts'],['email','emails'],['phone','phones'],['address','addresses']]){
        const savedPrimary=Array.isArray(previous[multi])?previous[multi][0]:undefined;
        next[single]=String(fields[single]??savedPrimary??previous[single]??record[single]??'').trim();
        next[multi]=[next[single],...next.extraContacts.map(c=>c[single]||'')];
      }
    }
    if(Object.hasOwn(fields,'tags')) next.tags=tags(fields.tags);
    if(Object.hasOwn(fields,'previewGroup'))next.previewGroup=String(fields.previewGroup);
    next.history=[{time,text:oldName?'更新客户资料':'新建客户档案',type:'operation'},...(previous.history||[])];
    const customers={...state.customers};
    if(oldName&&oldName!==name)delete customers[oldName];
    customers[name]=next;
    const relinkOrders=orders=>orders.map(o=>oldName&&o.client===oldName?{...o,client:name}:o);
    const linked={orders:relinkOrders(state.orders||[])};
    if(oldName&&oldName!==name){
      for(const bucket of ['trashOrders','deletedOrders'])
        if(Array.isArray(state[bucket]))linked[bucket]=relinkOrders(state[bucket]);
    }
    return {...state,customers,...linked};
  }
  function addFollowup(state,name,text,nextFollow,time=new Date().toISOString()) {
    if(!String(text||'').trim())throw new Error('请输入跟进内容');
    const row=buildCustomers(state).find(c=>c.name===name);
    if(!row)throw new Error('客户不存在');
    const previous=state.customers?.[name]||{};
    if(previous.laiBucket==='trash')throw new Error('请先恢复回收站客户');
    return {...state,customers:{...state.customers,[name]:{...previous,client:name,updated:time,lastFollowup:time,lastWrittenFollowup:time,nextFollow:nextFollow===undefined?(previous.nextFollow||''):String(nextFollow||''),history:[{time,text:String(text).trim(),type:'followup',subtype:'quick'},...(previous.history||[])]}}};
  }
  // 把一封邮件记到客户动态里（类型“往来邮件”）。同一封邮件只记一次；不改下次跟进，也不算写过跟进。
  const mailKey=mail=>String(mail?.messageId||'').replace(/\s+/g,' ').trim().slice(0,300)||(mail?.box&&mail?.uid?`${mail.box}|${mail.uid}`:'');
  function mailRecorded(state,name,mail) {
    const key=mailKey(mail);
    if(!key||typeof name!=='string'||!Object.hasOwn(state?.customers||{},name))return false;
    return (state.customers[name].history||[]).some(item=>item&&item.type==='email'&&item.mailRef&&mailKey(item.mailRef)===key);
  }
  function addMailActivity(state,name,mail,time=new Date().toISOString()) {
    const row=buildCustomers(state).find(c=>c.name===name);
    if(!row)throw new Error('客户不存在');
    const previous=state.customers?.[name]||{};
    if(previous.laiBucket==='trash')throw new Error('请先恢复回收站客户');
    if(!mail||typeof mail!=='object'||!mailKey(mail))throw new Error('缺少邮件信息');
    if(mailRecorded(state,name,mail))throw new Error('这封邮件已经记在客户动态里了');
    const sent=mail.box==='sent';
    const line=(value,max)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
    const subject=line(mail.subject,300)||'（无主题）',snippet=line(mail.snippet,300);
    const who=sent?(Array.isArray(mail.to)?mail.to[0]:null):mail.from;
    const sentAt=new Date(mail.date||'');
    const item={time:Number.isFinite(sentAt.getTime())?sentAt.toISOString():time,text:`${sent?'发出邮件':'收到邮件'}：${subject}${snippet?'\n'+snippet:''}`,type:'email',subtype:sent?'sent':'received',channel:'邮件',
      ...(who&&(who.name||who.address)?{contact:line(who.name||who.address,120)}:{}),
      mailRef:{messageId:line(mail.messageId,300),box:sent?'sent':'inbox',uid:Number(mail.uid)||0}};
    return {...state,customers:{...state.customers,[name]:{...previous,client:name,updated:time,history:[item,...(previous.history||[])]}}};
  }
  function setCustomerNextFollow(state,name,rawDate,time=new Date().toISOString()) {
    if(typeof name!=='string'||!name||name==='__proto__'||!buildCustomers(state).some(row=>row.name===name))
      throw new Error('客户不存在');
    const previous=state.customers?.[name]||{};
    const archived=['trashCustomers','deletedCustomers'].some(bucket=>{
      const value=state[bucket];
      return Array.isArray(value)
        ? value.some(item=>typeof item==='string'?item===name:item?.name===name||item?.client===name)
        : value&&typeof value==='object'&&Object.hasOwn(value,name);
    });
    if(archived||previous.laiBucket==='trash'||previous.trashedAt||previous.deletedAt||previous.archived===true)
      throw new Error('回收站客户不能安排跟进日程');
    const nextFollow=String(rawDate??'').trim();
    if(nextFollow){
      const parsed=new Date(`${nextFollow}T00:00:00Z`);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(nextFollow)||Number(nextFollow.slice(0,4))<1||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==nextFollow)
        throw new Error('下次跟进日期无效');
    }
    if(String(previous.nextFollow||'').trim()===nextFollow)
      throw new Error('跟进日程无需更新');
    const text=nextFollow?`安排客户跟进日程：${nextFollow}`:'取消客户跟进日程';
    return {...state,customers:{...state.customers,[name]:{
      ...previous,client:name,nextFollow,updated:time,
      history:[{time,text,type:'operation'},...(Array.isArray(previous.history)?previous.history:[])],
    }}};
  }
  function batchSetCustomerNextFollow(state,names,rawDate,time=new Date().toISOString()) {
    if(!Array.isArray(names)||!names.length)throw new Error('请先选择客户');
    const selected=[...new Set(names)];
    const known=new Set(buildCustomers(state).map(row=>row.name));
    if(selected.some(name=>!known.has(name)))throw new Error('所选客户不存在，请重新选择');
    if(selected.some(name=>['pool','trash'].includes(state.customers?.[name]?.laiBucket)))
      throw new Error('只能为私海客户安排跟进日程');
    const date=String(rawDate??'').trim();
    if(!date)throw new Error('请选择下次跟进日期');
    const changed=selected.filter(name=>String(state.customers?.[name]?.nextFollow||'').trim()!==date);
    if(!changed.length)throw new Error('所选客户的跟进日程无需更新');
    return changed.reduce((next,name)=>setCustomerNextFollow(next,name,date,time),state);
  }
  function batchAddFollowup(state,names,text,nextFollow,time=new Date().toISOString()) {
    if(!Array.isArray(names)||!names.length)throw new Error('请先选择客户');
    const content=String(text||'').trim();
    if(!content)throw new Error('请输入跟进内容');
    const selected=[...new Set(names)];
    const known=new Set(buildCustomers(state).map(customer=>customer.name));
    if(selected.some(name=>!known.has(name)))throw new Error('所选客户不存在，请重新选择');
    const date=String(nextFollow??'').trim();
    if(date){
      const parsed=new Date(`${date}T00:00:00Z`);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)
        throw new Error('下次跟进日期无效');
    }
    return selected.reduce((next,name)=>addFollowup(next,name,content,date||undefined,time),state);
  }
  function batchSetOwner(state,names,rawOwner,time=new Date().toISOString()) {
    if(!Array.isArray(names)||!names.length)throw new Error('请先选择客户');
    const selected=[...new Set(names)];
    const rows=new Map(buildCustomers(state).map(row=>[row.name,row]));
    if(selected.some(name=>!rows.has(name)))throw new Error('所选客户不存在，请重新选择');
    if(selected.some(name=>['pool','trash'].includes(state.customers?.[name]?.laiBucket)))
      throw new Error('只能更改私海客户的跟进人');
    const owner=String(rawOwner??'').trim();
    const customers={...state.customers};
    let changed=false;
    for(const name of selected){
      const previousOwner=rows.get(name).owner||'';
      if(previousOwner===owner)continue;
      changed=true;
      const old=customers[name]||{};
      const record={...old,client:name,owner,previousOwner,ownerUpdatedAt:time,updated:time};
      record.history=[{time,text:`跟进人变更：${previousOwner||'未分配'} → ${owner||'未分配'}`,type:'operation'},...(Array.isArray(old.history)?old.history:[])];
      customers[name]=record;
    }
    if(!changed)throw new Error('所选客户的跟进人无需更新');
    return {...state,customers};
  }
  function batchUpdateCustomerTags(state,names,rawTags,mode,time=new Date().toISOString()) {
    if(!Array.isArray(names)||!names.length)throw new Error('请先选择客户');
    if(!['add','remove'].includes(mode))throw new Error('标签操作无效');
    const changes=[...new Set(tags(rawTags))];
    if(!changes.length)throw new Error('请输入至少一个客户标签');
    const known=new Set(buildCustomers(state).map(customer=>customer.name));
    const selected=[...new Set(names)];
    if(selected.some(name=>!known.has(name)))throw new Error('所选客户不存在，请重新选择');
    const customers={...state.customers};
    let changed=false;
    for(const name of selected){
      const previous=customers[name]||{};
      const current=tags(previous.tags);
      const nextTags=mode==='add'
        ? [...new Set([...current,...changes])]
        : current.filter(tag=>!changes.includes(tag));
      if(nextTags.length===current.length&&nextTags.every((tag,index)=>tag===current[index]))continue;
      changed=true;
      customers[name]={...previous,client:name,tags:nextTags,updated:time,
        history:[{time,text:`批量${mode==='add'?'添加':'移除'}客户标签：${changes.join('、')}`,type:'operation'},...(previous.history||[])]};
    }
    if(!changed)throw new Error('所选客户的标签无需更新');
    return {...state,customers};
  }
  function batchEditCustomerField(state,names,field,rawValue,clear=false,time=new Date().toISOString()) {
    if(!Array.isArray(names)||!names.length)throw new Error('请先选择客户');
    const editable=batchEditableCustomerFields.find(item=>item.id===field);
    if(!editable)throw new Error('该字段不可批量编辑');
    const selected=[...new Set(names)],rows=new Map(buildCustomers(state).map(row=>[row.name,row]));
    if(selected.some(name=>!rows.has(name)))throw new Error('所选客户不存在，请重新选择');
    if(selected.some(name=>['pool','trash'].includes(state.customers?.[name]?.laiBucket)))
      throw new Error('只能编辑私海客户');
    const value=clear?'':String(rawValue??'').trim();
    if(!clear&&!value)throw new Error('请输入字段值，或选择清空字段');
    if(value.length>500)throw new Error('字段值不能超过 500 个字符');
    if(field==='customerStars'&&value&&!/^[1-5]$/.test(value))throw new Error('客户星级只能填写 1–5');
    if(field==='level'&&value&&!['自动判断','A级钻石客户','B级翡翠客户','C级白金客户','D级黄金客户','E级白银客户','F级青铜客户'].includes(value))
      throw new Error('请选择有效的客户等级');
    const customers={...state.customers};
    let changed=false;
    for(const name of selected){
      const old=customers[name]||{};
      const current=String(old[field]??'').trim();
      if(current===value)continue;
      changed=true;
      customers[name]={...old,client:name,[field]:value,updated:time,
        history:[{time,text:`批量编辑客户字段：${editable.label}${clear?'（清空）':''}`,type:'operation'},...(Array.isArray(old.history)?old.history:[])]};
    }
    if(!changed)throw new Error('所选客户的字段无需更新');
    return {...state,customers};
  }
  const api={contactRecordsWithIds,buildCustomers,filterCustomers,paginate,upsertCustomer,addFollowup,addMailActivity,mailRecorded,setCustomerNextFollow,batchSetCustomerNextFollow,batchAddFollowup,batchSetOwner,batchUpdateCustomerTags,batchEditCustomerField,batchEditableCustomerFields,customerLevelForRow,escapeHtml,norm,tags};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.PreviewModel=api;
})(typeof window!=='undefined'?window:globalThis);
