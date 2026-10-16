(function(root) {
  'use strict';
  const CS=root.LaiCustomerSettings||(typeof require==='function'?require('./customer-settings-model.js'):null);
  // 汇率（rate-model.js）：外币的首单按订单记下的汇率或汇率设置折成美元；没有汇率时照旧为空。
  const RT=()=>root.LaiRateModel||(typeof require==='function'?require('./rate-model.js'):null);
  const definitions = [
    ['name','公司名称','text',230,'基本信息'],['contact','主要联系人','text',160,'基本信息'],['country','国家地区','text',120,'基本信息'],['tags','客户标签','text',160,'基本信息'],['owner','跟进人','text',110,'基本信息'],
    ['lastWonDate','最近赢单日期','date',140,'商机信息'],['lastFollowup','最近跟进时间','date',150,'跟进信息'],['latestActivity','最近动态','text',220,'跟进信息'],['total','成交订单金额 (USD)','number',170,'订单信息'],['average','成交订单均价 (USD)','number',170,'订单信息'],['orderCount','成交订单数','number',110,'订单信息'],
    ['alibabaId','Alibaba会员ID','text',150,'联系方式'],['lastContact','最近联系时间','date',150,'跟进信息'],['createdAt','创建时间','date',150,'基本信息'],['source','客户来源','text',130,'基本信息'],['customerCode','客户编号','text',140,'基本信息'],['email','邮箱','text',230,'联系方式'],['phone','联系电话','text',180,'联系方式'],
    ['stage','客户阶段','text',120,'基本信息'],['level','客户等级','text',110,'基本信息'],['website','网站','text',230,'联系方式'],['address','地址','text',260,'联系方式'],['nextFollow','下次跟进','date',140,'跟进信息'],['due','待收款 (USD)','number',140,'订单信息'],['group','客户分组','text',140,'基本信息'],['latestOrderDate','最近成交订单日期','date',140,'订单信息'],
    ['alibabaIdentity','阿里买家身份','text',140,'基本信息'],['customerStars','客户星级','number',110,'基本信息'],['followed','是否关注','boolean',110,'基本信息']
  ];
  // 自定义字段（客户设置 → 字段设置）：每个字段一个条件字段 custom:<字段ID>，定义由 customer-fields.js 按当前数据给出。
  const CFD=()=>root.LaiCustomerFields||(typeof require==='function'?require('./customer-fields.js'):null);
  const customDefs=state=>{try{return CFD()?.customColumns(state)||[];}catch{return [];}};
  const catalog = definitions.map(([id,label,type,width,category])=>Object.freeze({id,label,type,width,category}));
  const fields = new Map(catalog.map(field=>[field.id,field]));
  const staticCatalog=catalog;
  const fieldCache=new WeakMap();
  // 全部条件字段（系统 + 自定义），按自定义字段的定义缓存。
  function registryFor(state){
    const custom=customDefs(state);
    if(!custom.length)return {list:staticCatalog,byId:fields};
    let hit=fieldCache.get(custom);
    if(!hit){const byId=new Map(fields);for(const def of custom)byId.set(def.id,def);hit={list:[...staticCatalog,...custom],byId};fieldCache.set(custom,hit);}
    return hit;
  }
  const catalogFor=state=>registryFor(state).list;
  const fieldFor=(state,id)=>registryFor(state).byId.get(id);
  const isChoice=def=>!!def&&def.custom===true&&(def.fieldType==='select'||def.fieldType==='multi');
  // 单选：是其中之一 / 不是其中之一；多选：包含任一 / 包含全部。值是用逗号隔开的几个选项。
  const choiceTerms=value=>(Array.isArray(value)?value:String(value??'').split(/[,，、;；\n]/)).map(term=>norm(text(term))).filter(Boolean);
  const norm=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
  const empty=value=>value===null||value===undefined||value===''||(Array.isArray(value)&&value.length===0);
  const text=value=>Array.isArray(value)?value.join(' '):String(value??'');
  const tagTerms=value=>String(value??'').split(/[,，]/).map(term=>norm(term)).filter(Boolean);
  const timestamp=value=>empty(value)?NaN:new Date(String(value).replace(' ','T')).getTime();
  const legacyOperation=/^(?:新建客户档案|更新客户资料|更新：|合并客户档案：|批量(?:添加|移除)客户标签：)/;
  const isOperation=item=>item.type==='operation'||(!item.type&&legacyOperation.test(String(item.text||item.content||item.note||'').trim()));
  const cloneRules=rules=>rules.map(rule=>({...rule}));
  // Date inputs represent a local calendar day, even where ISO date-only parsing is UTC.
  function calendarDay(value) {
    if(empty(value))return NaN;
    const source=String(value).trim();
    if(/^\d{4}-\d{2}-\d{2}$/.test(source))return Number(source.replace(/-/g,''));
    const parsed=new Date(timestamp(value));
    return Number.isFinite(parsed.getTime())?parsed.getFullYear()*10000+(parsed.getMonth()+1)*100+parsed.getDate():NaN;
  }
  const pad2=n=>String(n).padStart(2,'0');
  const localDay=ms=>{const d=new Date(ms);return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;};
  // WhatsApp 最近沟通 / 发送 / 接收：从聊天记录算出来，不存；历史只走一遍，按本地日期显示。
  function whatsAppTimes(history) {
    let sent=NaN,received=NaN;
    for(const item of history){
      if(!item||item.type!=='chat'||(item.subtype!=='whatsapp'&&item.subtype!=='whatsappgroup'))continue;
      const hasDir=item.lastSentAt||item.lastReceivedAt;
      const s=timestamp(hasDir?item.lastSentAt:(item.time||item.date));
      const r=timestamp(item.lastReceivedAt);
      if(Number.isFinite(s)&&!(s<=sent))sent=s;
      if(Number.isFinite(r)&&!(r<=received))received=r;
    }
    const both=Number.isFinite(sent)&&Number.isFinite(received)?Math.max(sent,received):Number.isFinite(sent)?sent:received;
    const day=ms=>Number.isFinite(ms)?localDay(ms):'';
    return {lastWhatsAppContact:day(both),lastWhatsAppSent:day(sent),lastWhatsAppReceived:day(received)};
  }
  function enrich(rows,state={}) {
    const customs=customDefs(state);
    const manualSets=(Array.isArray(state.previewSegments)?state.previewSegments:[]).filter(segment=>segment&&!segment.archived&&segment.kind==='manual')
      .map(segment=>({name:segment.name,members:new Set(Array.isArray(segment.members)?segment.members:[])}));
    const enriched=rows.map(row=>{
      const profile=state.customers?.[row.name]||{};
      const history=Array.isArray(profile.history)?profile.history:[];
      const dated=history.filter(item=>Number.isFinite(timestamp(item.time||item.date))).slice().sort((a,b)=>timestamp(b.time||b.date)-timestamp(a.time||a.date));
      const followup=dated.find(item=>item.type==='followup');
      const activity=dated.find(item=>!isOperation(item));
      const contact=dated.find(item=>['email','chat','call'].includes(item.type));
      const contactTime=contact?.time||contact?.date||'';
      const savedContact=profile.lastContact||row.lastContact||'';
      const times=CS&&CS.contactTimes?CS.contactTimes(state,row.name):null;
      const lastContact=times?(times.lastContact||row.lastContact||''):contactTime&&(!Number.isFinite(timestamp(savedContact))||timestamp(contactTime)>timestamp(savedContact))
        ? contactTime : savedContact;
      const settled=(row.orders||[])
        .filter(order=>['shipment','done'].includes(order.stage))
        .map(order=>({order,date:order.shippedAt||order.createdAt||''}))
        .filter(item=>Number.isFinite(timestamp(item.date)))
        .sort((a,b)=>timestamp(b.date)-timestamp(a.date));
      const firstOrder=settled.at(-1);
      const firstOrderTotal=firstOrder
        ? (firstOrder.order.currency||'USD').toUpperCase()==='USD'?Number(firstOrder.order.amount):RT()?RT().orderUsd(state,firstOrder.order):null
        : profile.firstOrderTotal??row.firstOrderTotal??null;
      const legacyGroups=Array.isArray(row.group)?row.group:row.group?[row.group]:[];
      const manualGroups=manualSets.filter(item=>item.members.has(row.name)).map(item=>item.name);
      // 自定义字段的值放到行上（键 custom:<字段ID>），列表、筛选、排序、客群、导出都读这个键。
      let customValues=null;
      if(customs.length&&profile.custom&&typeof profile.custom==='object'){
        for(const def of customs)if(Object.hasOwn(profile.custom,def.customId))(customValues||={})[def.id]=profile.custom[def.customId];
      }
      return {...row,...customValues,...whatsAppTimes(history),group:[...new Set([...legacyGroups,...manualGroups])],firstWonDate:profile.opportunityFirstWonDate||'',lastWonDate:CS&&CS.lastWonDate?CS.lastWonDate(state,row.name):profile.opportunityLastWonDate||'',latestOrderDate:settled[0]?.date||'',firstOrderDate:firstOrder?.date||profile.firstOrderDate||row.firstOrderDate||'',firstOrderTotal,lastFollowup:times?(times.lastFollowup||row.lastFollowup||''):followup?.time||followup?.date||profile.lastFollowup||row.lastFollowup||'',lastDealDate:CS&&CS.lastDealDate?CS.lastDealDate(state,row.name):'',latestActivity:activity?.text||activity?.content||activity?.note||profile.latestActivity||row.latestActivity||'',average:row.total===null||!row.orderCount?null:row.total/row.orderCount,lastContact,createdAt:profile.createdAt||'',customerCode:profile.customerCode||''};
    });
    const memberships=(Array.isArray(state.previewSegments)?state.previewSegments:[])
      .filter(segment=>segment&&!segment.archived&&String(segment.name||'').trim())
      .map(segment=>{
        // 某个客群的条件有问题时，只跳过它，不影响其他客群和客户列表。
        try{return {name:String(segment.name).trim(),members:new Set(resolveMembers(enriched,segment,undefined,state).map(row=>row.name))};}
        catch{return null;}
      }).filter(Boolean);
    return enriched.map(row=>{
      const saved=Array.isArray(row.segments)?row.segments:typeof row.segments==='string'?[row.segments]:[];
      const labels=[...saved,...memberships.filter(item=>item.members.has(row.name)).map(item=>item.name)]
        .filter(label=>typeof label==='string'&&label.trim()).map(label=>label.trim());
      return {...row,segments:[...new Set(labels)]};
    });
  }
  function operatorsFor(state,fieldId){
    const def=fieldFor(state,fieldId);
    if(!def)return [];
    if(isChoice(def))return def.fieldType==='select'?['in','notIn','empty','notEmpty']:['containsAny','containsAll','empty','notEmpty'];
    return operators[def.type];
  }
  const operators = {text:['eq','neq','contains','notContains','empty','notEmpty'],number:['eq','neq','gte','lte','empty','notEmpty'],date:['eq','neq','before','after','olderDays','empty','notEmpty'],boolean:['eq','neq','empty','notEmpty']};
  function validateRules(spec={},state) {
    if(spec.match!==undefined&&!['all','any'].includes(spec.match))throw new Error('请选择全部或任一条件');
    if(spec.rules!==undefined&&!Array.isArray(spec.rules))throw new Error('客群条件格式无效');
    return (spec.rules||[]).map(rule=>{
      const def=rule&&fieldFor(state,rule.field);
      if(!def)throw new Error('未知的客群条件字段');
      const type=def.type;
      if(!(isChoice(def)?operatorsFor(state,rule.field):operators[type]).includes(rule.op)&&!(rule.field==='tags'&&['containsAny','containsAll'].includes(rule.op)))throw new Error('该字段不支持此条件运算');
      if(!['empty','notEmpty'].includes(rule.op)){
        if(empty(rule.value)||!text(rule.value).trim())throw new Error('请填写条件值');
        if(['containsAny','containsAll'].includes(rule.op)&&!(isChoice(def)?choiceTerms(rule.value):tagTerms(rule.value)).length)throw new Error('请填写条件值');
        if(isChoice(def)&&['in','notIn'].includes(rule.op)&&!choiceTerms(rule.value).length)throw new Error('请填写条件值');
        if(type==='number'&&!Number.isFinite(Number(rule.value)))throw new Error('请填写有效数字');
        if(type==='date'&&rule.op!=='olderDays'&&!Number.isFinite(timestamp(rule.value)))throw new Error('请填写有效日期');
        if(rule.op==='olderDays'&&(!Number.isFinite(Number(rule.value))||Number(rule.value)<0))throw new Error('天数必须为非负数字');
        if(type==='boolean'&&![true,false,'true','false'].includes(rule.value))throw new Error('请选择是或否');
      }
      return {...rule};
    });
  }
  function filterByRules(rows,spec={},today=new Date(),state) {
    const rules=validateRules(spec,state);
    const prepared=new Map(rules.map(rule=>{const def=fieldFor(state,rule.field);return [rule,{def,terms:isChoice(def)?choiceTerms(rule.value):null}];}));
    const clock=today instanceof Date?today.getTime():timestamp(today);
    if(!Number.isFinite(clock))throw new Error('当前日期无效');
    const matches=(row,rule)=>{
      const {def,terms:picked}=prepared.get(rule);
      if(picked){
        // 单选、多选的自定义字段：选项整个匹配，不区分大小写。
        const raw=row[rule.field];
        const have=(Array.isArray(raw)?raw:[raw]).filter(value=>!empty(value)).map(value=>norm(text(value)));
        if(rule.op==='empty')return !have.length;
        if(rule.op==='notEmpty')return have.length>0;
        if(!have.length)return false;
        if(rule.op==='in'||rule.op==='containsAny')return have.some(value=>picked.includes(value));
        if(rule.op==='notIn')return have.every(value=>!picked.includes(value));
        if(rule.op==='containsAll')return picked.every(value=>have.includes(value));
        return false;
      }
      const raw=rule.field==='email'
        ? [row.email,...(Array.isArray(row.emails)?row.emails:[]),...(Array.isArray(row.extraContacts)?row.extraContacts.map(contact=>contact?.email):[])]
        : rule.field==='level'?row.displayLevel??row.level:row[rule.field],type=def.type;
      const values=type==='text'&&Array.isArray(raw)?raw.filter(value=>!empty(value)).map(norm):null;
      const missing=values?!values.length:empty(raw);
      if(rule.op==='empty')return missing;
      if(rule.op==='notEmpty')return !missing;
      if(missing)return false;
      if(rule.field==='tags'&&['containsAny','containsAll'].includes(rule.op)){
        const terms=tagTerms(rule.value);
        const tags=Array.isArray(raw)?raw:[raw];
        return rule.op==='containsAll'
          ? terms.every(term=>tags.some(tag=>norm(tag).includes(term)))
          : terms.some(term=>tags.some(tag=>norm(tag).includes(term)));
      }
      if(values){
        const target=norm(text(rule.value));
        if(rule.op==='eq')return values.some(value=>value===target);
        if(rule.op==='neq')return values.every(value=>value!==target);
        if(rule.op==='contains')return values.some(value=>value.includes(target));
        if(rule.op==='notContains')return values.every(value=>!value.includes(target));
      }
      const actual=type==='number'?Number(raw):type==='date'?(rule.op==='olderDays'?timestamp(raw):calendarDay(raw)):type==='boolean'?raw===true:norm(text(raw));
      const target=type==='number'?Number(rule.value):type==='date'?calendarDay(rule.value):type==='boolean'?[true,'true'].includes(rule.value):norm(text(rule.value));
      if((type==='number'||type==='date')&&!Number.isFinite(actual))return false;
      switch(rule.op){
        case 'eq': return actual===target;
        case 'neq': return actual!==target;
        case 'contains': return actual.includes(target);
        case 'notContains': return !actual.includes(target);
        case 'gte': return actual>=target;
        case 'lte': return actual<=target;
        case 'before': return actual<target;
        case 'after': return actual>target;
        case 'olderDays': return actual<clock-Number(rule.value)*86400000;
        default: return false;
      }
    };
    if(!rules.length)return rows.slice();
    return rows.filter(row=>spec.match==='any'?rules.some(rule=>matches(row,rule)):rules.every(rule=>matches(row,rule)));
  }
  function knownNames(state) {return new Set([...Object.keys(state.customers||{}),...(state.orders||[]).map(order=>order.client).filter(Boolean)]);}
  function getSegment(state,id) {
    const segment=(state.previewSegments||[]).find(item=>item.id===id&&!item.archived);
    if(!segment)throw new Error('客群不存在或已归档');
    return segment;
  }
  function upsertSegment(state,id,input) {
    if(typeof id!=='string'||!id.trim())throw new Error('找不到这个客群');
    const name=String(input.name||'').trim();
    if(!name)throw new Error('请输入客群名称');
    const current=state.previewSegments||[];
    if(current.some(item=>item.id!==id&&!item.archived&&norm(item.name)===norm(name)))throw new Error('客群名称已存在');
    const previous=current.find(item=>item.id===id);
    if(previous?.archived)throw new Error('已归档客群不能编辑');
    if(!['manual','rules'].includes(input.kind))throw new Error('请选择客群类型');
    // 手动客群和“客户设置”里的客户分组共用一个分组下拉，重名会分不清选的是哪个。
    if(input.kind==='manual'&&CS&&previous?.name!==name&&CS.groupPaths(CS.get(state).groups).some(path=>norm(path)===norm(name)))
      throw new Error('客户设置里已有同名的客户分组，请换个客群名称');
    const rules=validateRules({match:input.match,rules:input.kind==='rules'?input.rules:[]},state);
    if(input.kind==='rules'&&!rules.length)throw new Error('条件客群至少需要一条条件');
    const members=[...new Set(input.members||previous?.members||[])];
    if(members.some(name=>!knownNames(state).has(name)))throw new Error('客群包含不存在的客户');
    const segment={...previous,id,name,kind:input.kind,match:input.match||'all',rules:cloneRules(rules),members:input.kind==='manual'?members:[],archived:false};
    return {...state,previewSegments:previous?current.map(item=>item.id===id?segment:item):[...current,segment]};
  }
  function archiveSegment(state,id) {
    getSegment(state,id);
    return {...state,previewSegments:state.previewSegments.map(item=>item.id===id?{...item,archived:true}:item)};
  }
  function restoreSegment(state,id) {
    const current=state.previewSegments||[];
    const target=current.find(item=>item.id===id);
    if(!target)throw new Error('客群不存在');
    if(!target.archived)throw new Error('客群未归档，请选择已归档客群');
    if(current.some(item=>item.id!==id&&!item.archived&&norm(item.name)===norm(target.name)))
      throw new Error('同名客群已存在，请先修改现有客群名称');
    return {...state,previewSegments:current.map(item=>item.id===id?{...item,archived:false}:item)};
  }
  function assignMembers(state,id,names,mode='add') {
    const segment=getSegment(state,id);
    if(segment.kind!=='manual')throw new Error('条件客群会自动更新，不能手动修改成员');
    if(!['add','remove'].includes(mode))throw new Error('成员操作无效');
    if(!Array.isArray(names)||names.some(name=>!knownNames(state).has(name)))throw new Error('请选择存在的客户');
    const members=mode==='add'?[...new Set([...(segment.members||[]),...names])]:(segment.members||[]).filter(name=>!names.includes(name));
    return {...state,previewSegments:state.previewSegments.map(item=>item.id===id?{...item,members}:item)};
  }
  function resolveMembers(rows,segment,today=new Date(),state) {
    if(!segment||segment.archived)return [];
    if(segment.kind==='rules')return filterByRules(rows,segment,today,state);
    if(segment.kind!=='manual')throw new Error('未知的客群类型');
    const members=new Set(segment.members||[]);
    return rows.filter(row=>members.has(row.name));
  }
  function renameMember(state,oldName,newName) {
    return {...state,previewSegments:(state.previewSegments||[]).map(item=>({...item,members:[...new Set((item.members||[]).map(name=>name===oldName?newName:name))]}))};
  }
  function setEditorGroup(state,name,rawSelected,rawPrevious) {
    if(!Object.hasOwn(state.customers||{},name))throw new Error('客户不存在');
    const selected=String(rawSelected||'').trim(),previous=String(rawPrevious||'').trim();
    const manual=(state.previewSegments||[]).filter(item=>item.kind==='manual'&&!item.archived);
    const target=manual.find(item=>item.name===selected);
    const configured=!!selected&&!target&&CS.isConfiguredGroup(state,selected);
    if(selected&&!target&&!configured&&selected!==previous)throw new Error('请选择现有的手动分组或设置里的分组');
    if(configured)CS.checkGroup(state,selected,state.customers[name].owner||'',previous);
    const changed=selected!==previous;
    const previewSegments=(state.previewSegments||[]).map(item=>{
      if(item.kind!=='manual'||item.archived)return item;
      const members=item.members||[];
      const next=changed
        ? item.id===target?.id?[...new Set([...members,name])]:members.filter(member=>member!==name)
        : item.id===target?.id?[...new Set([...members,name])]:members;
      return next.length===members.length&&next.every((member,index)=>member===members[index])?item:{...item,members:next};
    });
    const profile=state.customers[name];
    return {...state,customers:{...state.customers,[name]:{...profile,previewGroup:target?'':selected}},previewSegments};
  }
  function normalizeColumns(settings={}) {
    const order=[...new Set(['name',...(Array.isArray(settings.order)?settings.order:catalog.slice(0,18).map(field=>field.id))])].filter(id=>fields.has(id));
    const requestedFrozen=new Set(Array.isArray(settings.frozen)?settings.frozen:[]);
    const frozen=['name',...order.filter(id=>id!=='name'&&requestedFrozen.has(id)).slice(0,2)];
    return {order:[...frozen,...order.filter(id=>!frozen.includes(id))],frozen};
  }
  const api={catalog,catalogFor,fieldFor,operatorsFor,enrich,filterByRules,upsertSegment,archiveSegment,restoreSegment,assignMembers,resolveMembers,renameMember,setEditorGroup,normalizeColumns};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.PreviewSegments=api;
})(typeof window!=='undefined'?window:globalThis);
