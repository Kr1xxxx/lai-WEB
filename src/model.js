(function (root) {
  'use strict';
  const CS = typeof module !== 'undefined' && module.exports ? require('./customer-settings-model.js') : root.LaiCustomerSettings;
  // 汇率（rate-model.js）：没载入时外币订单照旧不折算。
  const RT = typeof module !== 'undefined' && module.exports ? require('./rate-model.js') : null;
  const rates = () => RT || root.LaiRateModel || null;
  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  // 客户名称查重用：全角半角、大小写、空格多少都算同一个名字（D-003）。存的仍是用户填的原样。
  const nameKey = value => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
  // 只检查客户是否存在，不用把所有客户都算一遍。
  const customerExists = (state, name) => typeof name === 'string' && !!name && (Object.hasOwn(state?.customers || {}, name) || (state?.orders || []).some(o => o && o.client === name));
  const knownCustomerNames = state => new Set([...Object.keys(state?.customers || {}), ...(state?.orders || []).map(o => o && o.client).filter(Boolean)]);
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
    {id:'productType',label:'主营产品类型'},
    {id:'companyProducts',label:'主营产品'},
    {id:'timezone',label:'时区'},
    {id:'cardStock',label:'卡纸'},
    {id:'customBox',label:'定制盒'},
  ].map(field=>Object.freeze(field)));
  function buildCustomers(state = {}) {
    const orders = state.orders || [];
    const names = [...new Set([...Object.keys(state.customers || {}), ...orders.map(o => o.client).filter(Boolean)])];
    // Group the orders by customer once: filtering the whole order list per customer made this O(customers × orders).
    const ordersByClient = new Map();
    for (const order of orders) {
      if (!ordersByClient.has(order.client)) ordersByClient.set(order.client, []);
      ordersByClient.get(order.client).push(order);
    }
    const RTM = rates();
    return names.map(name => {
      const own = ordersByClient.get(name) || [];
      const related = own.filter(o => !o.isDraft && amount(o.amount)>0).sort((a,b)=>dateValue(b.createdAt||b.updated)-dateValue(a.createdAt||a.updated));
      const profile = state.customers?.[name] || {};
      const history = Array.isArray(profile.history) ? profile.history : [];
      const recent = related[0] || own[0] || {};
      const values = {...recent,...profile};
      let total=0,paid=0,missingRates=0,converted=false;
      for (const order of related) {
        const usd = (order.currency || 'USD').toUpperCase() === 'USD';
        // 外币订单按汇率折成美元（订单保存时记下的汇率优先，没有就用汇率设置里的）；没有汇率的照旧不算，客户金额显示为空。
        const rate = usd ? 100 : RTM ? RTM.orderRate(state, order) : null;
        if (rate === null) { missingRates++; continue; }
        if (!usd) converted = true;
        const full = usd ? amount(order.amount) : RTM.orderUsd(state, order, order.amount);
        total += full;
        paid += ['shipment','done'].includes(order.stage) ? full : Math.min(full, usd ? amount(order.paidAmount) : RTM.orderUsd(state, order, order.paidAmount));
      }
      if (converted) { total = Math.round(total * 100) / 100; paid = Math.round(paid * 100) / 100; }
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
        ||filters.group==='followed'&&c.followed||filters.group==='followup'&&c.nextFollow&&c.nextFollow<=today
        ||filters.group.startsWith('country:')&&c.orderCount>0&&c.country===filters.group.slice(8));
    }).sort((a,b)=>filters.sort==='name'?a.name.localeCompare(b.name):filters.sort==='amount'?(b.total??-1)-(a.total??-1):dateValue(b.sortUpdated||b.updated)-dateValue(a.sortUpdated||a.updated)||a.name.localeCompare(b.name));
  }
  function paginate(items, page=1, pageSize=20) {
    const size=Math.max(1,Math.floor(Number(pageSize)||20));
    const pageCount=Math.max(1,Math.ceil(items.length/size));
    page=Math.max(1,Math.min(pageCount,Math.floor(Number(page)||1)));
    return {items:items.slice((page-1)*size,page*size),page,pageCount,total:items.length};
  }
  // 自定义字段（客户设置 → 字段设置）：只收设置里还有的字段，按字段类型整理；没传的、设置里已删的字段保留原值。
  // 必填不在这里查：只有客户编辑表单保存时才查（见 customer-settings-model.js 的 assertRequired）。
  const fieldModel = () => root.LaiFieldModel || (typeof module !== 'undefined' && module.exports ? require('./field-model.js') : null);
  function withCustomValues(state, previous, next, given) {
    if (!given || typeof given !== 'object' || Array.isArray(given)) throw new Error('自定义字段格式无效');
    const FM = fieldModel();
    if (!FM) return next;
    const stored = previous.custom && typeof previous.custom === 'object' && !Array.isArray(previous.custom) ? previous.custom : {};
    const custom = { ...stored };
    for (const def of FM.get(state, 'customer').customFields) {
      if (!Object.hasOwn(given, def.id)) continue;
      const value = FM.cleanValue(def, given[def.id], stored[def.id]);
      if (value === undefined) delete custom[def.id]; else custom[def.id] = value;
    }
    return Object.keys(custom).length || previous.custom !== undefined ? { ...next, custom } : next;
  }
  function upsertCustomer(state, oldName, fields, time=new Date().toISOString()) {
    const name=String(fields.name||'').trim();
    if (!name) throw new Error('请输入公司 / 客户名称');
    if(name==='__proto__')throw new Error('该名称为系统保留名称，请填写完整公司名称');
    const orderNames=[...(state.orders||[]),...(state.trashOrders||[])].map(o=>o.client).filter(n=>n&&nameKey(n)!==nameKey(oldName));
    const known=[...Object.keys(state.customers||{}),...orderNames];
    if (known.some(n=>n!==oldName&&nameKey(n)===nameKey(name))) throw new Error('客户名称已存在，请使用其他名称');
    const previous=state.customers?.[oldName]||{};
    if(previous.laiBucket==='trash')throw new Error('请先恢复回收站客户');
    const record=oldName?(buildCustomers(state).find(c=>c.name===oldName)||{}):{};
    let next={...previous,client:name,updated:time};
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
    for(const key of ['country','owner','email','phone','contact','address','website','source','customerStage','nextFollow','note','permanentNote','contactNote','productType','paymentMethod','paymentEmail','currency','contactPaymentMethod','alibabaId','primaryContactMethod','level','customerStars','customerCode','timezone','defaultPaymentPlan','customerAccountPeriod','companyProducts','cardStock','customBox','socialPlatform','socialAccount','phoneCountryCode','alternateEmail','birthday','shortName','landline','companyAddress','companyRemark','poolGroup','contactTitle','contactGender','customerType']){
      if(Object.hasOwn(fields,key)) next[key]=String(fields[key]??'').trim();
    }
    // 星级 0 表示没打星：存成空，这样没评过星的客户保持为空，也可以清掉已打的星。
    if(Object.hasOwn(fields,'customerStars')&&/^0+(\.0*)?$/.test(next.customerStars))next.customerStars='';
    if(CS){
      const had=[previous.email,...(Array.isArray(previous.emails)?previous.emails:[]),...(Array.isArray(previous.extraContacts)?previous.extraContacts.map(c=>c&&c.email):[]),record.email];
      const incoming=[next.email,...(Object.hasOwn(fields,'extraContacts')&&Array.isArray(fields.extraContacts)?fields.extraContacts.map(c=>c&&c.email):[])];
      CS.assertEmailsAllowed(state,incoming,had);
      const ownerNow=String(next.owner||'').trim();
      if(ownerNow&&Object.hasOwn(fields,'owner')&&ownerNow!==String(record.owner||'').trim())CS.assertCanTake(state,ownerNow,1,[oldName]);
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
    if(Object.hasOwn(fields,'custom'))next=withCustomValues(state,previous,next,fields.custom);
    if(CS&&CS.assertNotDuplicate)CS.assertNotDuplicate(state,next,[previous,record],oldName);
    next.history=[{time,text:oldName?'更新客户资料':'新建客户档案',type:'operation'},...(previous.history||[])];
    const customers={...state.customers};
    if(oldName&&oldName!==name)delete customers[oldName];
    customers[name]=next;
    const relinkOrders=orders=>orders.map(o=>oldName&&o.client===oldName?{...o,client:name}:o);
    const linked={orders:relinkOrders(state.orders||[])};
    if(oldName&&oldName!==name){
      if(Array.isArray(state.laiOpportunities))linked.laiOpportunities=state.laiOpportunities.map(o=>o&&o.client===oldName?{...o,client:name}:o);
      // 协同（待办）已去掉（D-031），存着的 laiTasks 仍跟着改客户名，数据保持一致。
      if(Array.isArray(state.laiTasks))linked.laiTasks=state.laiTasks.map(t=>t&&t.customer===oldName?{...t,customer:name}:t);
      for(const bucket of ['trashOrders','deletedOrders'])
        if(Array.isArray(state[bucket]))linked[bucket]=relinkOrders(state[bucket]);
    }
    return {...state,customers,...linked};
  }
  function addFollowup(state,name,text,nextFollow,time=new Date().toISOString(),known) {
    if(!String(text||'').trim())throw new Error('请输入跟进内容');
    if(!(known?known.has(name):customerExists(state,name)))throw new Error('客户不存在');
    return {...state,customers:{...state.customers,[name]:followupProfile(state.customers?.[name]||{},name,text,nextFollow,time)}};
  }
  function followupProfile(previous,name,text,nextFollow,time) {
    if(previous.laiBucket==='trash')throw new Error('请先恢复回收站客户');
    // 补记过去的跟进时，不能把更新时间、最近跟进时间往回改。
    const later=(old)=>Number.isFinite(Date.parse(old))&&Date.parse(old)>Date.parse(time)?old:time;
    return {...previous,client:name,updated:later(previous.updated),lastFollowup:later(previous.lastFollowup),lastWrittenFollowup:later(previous.lastWrittenFollowup),nextFollow:nextFollow===undefined?(previous.nextFollow||''):String(nextFollow||''),history:[{time,text:String(text).trim(),type:'followup',subtype:'quick'},...(previous.history||[])]};
  }
  // 把一封邮件记到客户动态里（类型“往来邮件”）。同一封邮件只记一次；不改下次跟进，也不算写过跟进。
  const mailKey=mail=>String(mail?.messageId||'').replace(/\s+/g,' ').trim().slice(0,300)||(mail?.box&&mail?.uid?`${mail.box}|${mail.uid}`:'');
  function mailRecorded(state,name,mail) {
    const key=mailKey(mail);
    if(!key||typeof name!=='string'||!Object.hasOwn(state?.customers||{},name))return false;
    return (state.customers[name].history||[]).some(item=>item&&item.type==='email'&&item.mailRef&&mailKey(item.mailRef)===key);
  }
  function addMailActivity(state,name,mail,time=new Date().toISOString()) {
    if(!customerExists(state,name))throw new Error('客户不存在');
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
  function setCustomerNextFollow(state,name,rawDate,time=new Date().toISOString(),known) {
    if(typeof name!=='string'||!name||name==='__proto__'||!(known?known.has(name):customerExists(state,name)))
      throw new Error('客户不存在');
    return {...state,customers:{...state.customers,[name]:nextFollowProfile(state,state.customers?.[name]||{},name,rawDate,time)}};
  }
  function nextFollowProfile(state,previous,name,rawDate,time) {
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
    return {
      ...previous,client:name,nextFollow,updated:time,
      history:[{time,text,type:'operation'},...(Array.isArray(previous.history)?previous.history:[])],
    };
  }
  function batchSetCustomerNextFollow(state,names,rawDate,time=new Date().toISOString()) {
    if(!Array.isArray(names)||!names.length)throw new Error('请先选择客户');
    const selected=[...new Set(names)];
    const known=knownCustomerNames(state);
    if(selected.some(name=>!known.has(name)))throw new Error('所选客户不存在，请重新选择');
    if(selected.some(name=>['pool','trash'].includes(state.customers?.[name]?.laiBucket)))
      throw new Error('只能为私海客户安排跟进日程');
    const date=String(rawDate??'').trim();
    if(!date)throw new Error('请选择下次跟进日期');
    const changed=selected.filter(name=>String(state.customers?.[name]?.nextFollow||'').trim()!==date);
    if(!changed.length)throw new Error('所选客户的跟进日程无需更新');
    const customers={...state.customers};
    for(const name of changed)customers[name]=nextFollowProfile(state,customers[name]||{},name,date,time);
    return {...state,customers};
  }
  function batchAddFollowup(state,names,text,nextFollow,time=new Date().toISOString()) {
    if(!Array.isArray(names)||!names.length)throw new Error('请先选择客户');
    const content=String(text||'').trim();
    if(!content)throw new Error('请输入跟进内容');
    const selected=[...new Set(names)];
    const known=knownCustomerNames(state);
    if(selected.some(name=>!known.has(name)))throw new Error('所选客户不存在，请重新选择');
    const date=String(nextFollow??'').trim();
    if(date){
      const parsed=new Date(`${date}T00:00:00Z`);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)
        throw new Error('下次跟进日期无效');
    }
    // 只复制一次客户表，再逐个改（客户很多时，每人复制一次会很慢）。
    const customers={...state.customers};
    for(const name of selected)customers[name]=followupProfile(customers[name]||{},name,content,date||undefined,time);
    return {...state,customers};
  }
  function batchSetOwner(state,names,rawOwner,time=new Date().toISOString()) {
    if(!Array.isArray(names)||!names.length)throw new Error('请先选择客户');
    const selected=[...new Set(names)];
    const rows=new Map(buildCustomers(state).map(row=>[row.name,row]));
    if(selected.some(name=>!rows.has(name)))throw new Error('所选客户不存在，请重新选择');
    if(selected.some(name=>['pool','trash'].includes(state.customers?.[name]?.laiBucket)))
      throw new Error('只能更改私海客户的跟进人');
    const owner=String(rawOwner??'').trim();
    if(CS&&owner){const moving=selected.filter(name=>(rows.get(name).owner||'')!==owner);if(moving.length)CS.assertCanTake(state,owner,moving.length);}
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
    const known=knownCustomerNames(state);
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
      const record={...old,client:name,[field]:value,updated:time,
        history:[{time,text:`批量编辑客户字段：${editable.label}${clear?'（清空）':''}`,type:'operation'},...(Array.isArray(old.history)?old.history:[])]};
      // 判重设置里选了“不允许保存”的资料，批量改了也不能和别的客户（包括这一批里前面刚改的）重复。
      if(CS&&CS.assertNotDuplicate&&value){
        try{CS.assertNotDuplicate({...state,customers},record,old,name);}
        catch(error){throw new Error(`「${name}」${error.message}`);}
      }
      customers[name]=record;
    }
    if(!changed)throw new Error('所选客户的字段无需更新');
    return {...state,customers};
  }
  // 只保存改动：snapshotState 把已保存的数据按客户/订单/设置各存成一段文字，diffState 拿它和要保存的新数据比，
  // 只挑出变了的部分。按文字比较（不是比引用），所以就算某处直接改了旧对象也不会漏。
  const ORDER_BUCKETS=['orders','trashOrders','deletedOrders'];
  const ENTITY_KEYS=new Set([...ORDER_BUCKETS,'customers','trackingLookups']);
  function snapshotState(data={}) {
    const customers=new Map(),orders=new Map(),sequence={},app=new Map();
    for(const [name,customer] of Object.entries(data.customers||{}))customers.set(name,JSON.stringify(customer));
    for(const bucket of ORDER_BUCKETS){
      const ids=[];
      for(const order of Array.isArray(data[bucket])?data[bucket]:[]){orders.set(String(order?.id||''),{bucket,json:JSON.stringify(order)});ids.push(String(order?.id||''));}
      sequence[bucket]=ids.join('\u0001');
    }
    // 值是 undefined 的块和没有这个块一样（JSON 里本来就带不走）。
    for(const [key,value] of Object.entries(data))if(!ENTITY_KEYS.has(key)&&value!==undefined)app.set(key,JSON.stringify(value));
    return {customers,orders,sequence,app,lookups:JSON.stringify(data.trackingLookups||[])};
  }
  // 保存前先补块：新数据里缺了（或是 undefined）的顶层块，用上次保存的数据里的那块补上。
  // 页面出错时发来的数据可能缺块；补上后既不会让服务器删掉整块，保存后页面上的数据也和服务器一致
  // （不补的话页面会按默认值重建这块，下次保存就把服务器上的那份盖掉）。
  function completeState(saved, data) {
    if(!saved||typeof saved!=='object'||!data||typeof data!=='object')return data;
    const missing=Object.keys(saved).filter(key=>data[key]===undefined&&saved[key]!==undefined);
    if(!missing.length)return data;
    const result={...data};
    for(const key of missing)result[key]=saved[key];
    return result;
  }
  function diffState(saved, data={}) {
    const next=snapshotState(data);
    const changes={counts:{
      orders:(data.orders||[]).length,trashOrders:(data.trashOrders||[]).length,deletedOrders:(data.deletedOrders||[]).length,
      customers:next.customers.size,trackingLookups:(data.trackingLookups||[]).length}};
    let empty=true;
    const customerSet={},customerRemove=[];
    for(const [name,json] of next.customers)if(saved.customers.get(name)!==json){customerSet[name]=data.customers[name];empty=false;}
    for(const name of saved.customers.keys())if(!next.customers.has(name)){customerRemove.push(name);empty=false;}
    changes.customers={set:customerSet,remove:customerRemove};
    const orderSet={},orderRemove=[],sequence={};
    let byId=null;
    for(const [id,entry] of next.orders){
      const before=saved.orders.get(id);
      if(!before||before.json!==entry.json||before.bucket!==entry.bucket){
        byId??=new Map(ORDER_BUCKETS.flatMap(bucket=>(data[bucket]||[]).map(order=>[String(order?.id||''),order])));
        orderSet[id]={bucket:entry.bucket,order:byId.get(id)};empty=false;
      }
    }
    for(const id of saved.orders.keys())if(!next.orders.has(id)){orderRemove.push(id);empty=false;}
    for(const bucket of ORDER_BUCKETS)if(next.sequence[bucket]!==saved.sequence[bucket]){
      sequence[bucket]=(data[bucket]||[]).map(order=>String(order?.id||''));empty=false;
    }
    changes.orders={set:orderSet,remove:orderRemove,sequence};
    if(next.lookups!==saved.lookups){changes.trackingLookups=data.trackingLookups||[];empty=false;}
    const appState={};
    for(const [key,json] of next.app)if(saved.app.get(key)!==json){appState[key]=data[key];empty=false;}
    // 新数据里缺了的设置块不算删除（页面出错时可能缺块，服务器上的那份不能跟着没了）：不发给服务器，
    // 快照里保留已保存的那份，快照仍和服务器一致。removeAppState 保留为空列表，旧版服务器也认。
    for(const [key,json] of saved.app)if(!next.app.has(key))next.app.set(key,json);
    changes.appState=appState;changes.removeAppState=[];
    return {changes,snapshot:next,empty};
  }
  // 保存时版本冲突（别处先保存了）：saved 是这次改动所基于的快照，fresh 是服务器上的最新数据。
  // 这次改动碰到的客户、订单、设置在服务器上都没被别处改过时，把改动套到最新数据上（ok:true, data）；
  // 否则返回被别处改过的是哪些（ok:false, conflicts）。
  function rebaseChanges(saved, changes, fresh={}) {
    const now=snapshotState(fresh),conflicts=[];
    const customerSet=changes.customers?.set||{},customerRemove=changes.customers?.remove||[];
    const orderSet=changes.orders?.set||{},orderRemove=changes.orders?.remove||[],sequence=changes.orders?.sequence||{};
    const freshOrders=new Map(ORDER_BUCKETS.flatMap(bucket=>(Array.isArray(fresh[bucket])?fresh[bucket]:[]).map(order=>[String(order?.id||''),order])));
    for(const name of [...Object.keys(customerSet),...customerRemove])
      if(saved.customers.get(name)!==now.customers.get(name))conflicts.push({kind:'customer',name});
    const orderKey=entry=>entry?entry.bucket+'\u0001'+entry.json:'';
    for(const id of [...Object.keys(orderSet),...orderRemove])
      if(orderKey(saved.orders.get(id))!==orderKey(now.orders.get(id)))
        conflicts.push({kind:'order',id,num:String(freshOrders.get(id)?.num||orderSet[id]?.order?.num||id)});
    if(Object.keys(sequence).some(bucket=>saved.sequence[bucket]!==now.sequence[bucket]))conflicts.push({kind:'orderList'});
    if(changes.trackingLookups!==undefined&&saved.lookups!==now.lookups)conflicts.push({kind:'lookups'});
    for(const key of Object.keys(changes.appState||{}))
      if(saved.app.get(key)!==now.app.get(key))conflicts.push({kind:'setting',key});
    if(conflicts.length)return {ok:false,conflicts};
    const data={...fresh,customers:{...(fresh.customers||{})}};
    for(const name of customerRemove)delete data.customers[name];
    for(const [name,customer] of Object.entries(customerSet))data.customers[name]=customer;
    const removed=new Set(orderRemove.map(String)),byId=new Map(freshOrders);
    for(const [id,entry] of Object.entries(orderSet))byId.set(id,entry.order);
    for(const bucket of ORDER_BUCKETS){
      if(sequence[bucket]){
        const list=sequence[bucket].map(id=>byId.get(String(id)));
        if(list.some(order=>!order))return {ok:false,conflicts:[{kind:'orderList'}]};
        data[bucket]=list;
      }else data[bucket]=(Array.isArray(fresh[bucket])?fresh[bucket]:[]).filter(order=>!removed.has(String(order?.id||''))).map(order=>orderSet[String(order?.id||'')]?.order||order);
    }
    if(changes.trackingLookups!==undefined)data.trackingLookups=changes.trackingLookups;
    // 只套用改了的设置块；最新数据里的其它块（包括这次改动里没有的）都留着，不删任何块。
    for(const [key,value] of Object.entries(changes.appState||{}))data[key]=value;
    return {ok:true,data};
  }
  const api={snapshotState,diffState,rebaseChanges,completeState,contactRecordsWithIds,buildCustomers,filterCustomers,paginate,upsertCustomer,addFollowup,addMailActivity,mailRecorded,setCustomerNextFollow,batchSetCustomerNextFollow,batchAddFollowup,batchSetOwner,batchUpdateCustomerTags,batchEditCustomerField,batchEditableCustomerFields,customerLevelForRow,escapeHtml,norm,nameKey,tags};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.PreviewModel=api;
})(typeof window!=='undefined'?window:globalThis);
