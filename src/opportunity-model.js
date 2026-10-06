(function(root){
  'use strict';
  // 商机：保存在 state.laiOpportunities（数组）。阶段、字段参照用户提供的参考界面；不同币种不折算、不相加。
  const node=typeof module!=='undefined'&&module.exports;
  const LM=node?require('./modules.js'):root.LaiModules;
  const trim=value=>String(value??'').trim();
  // 销售阶段：kind 决定金额归入「进行中」「赢单」还是「输单」。
  const STAGES=Object.freeze([
    {id:'open',label:'未成单',kind:'open'},
    {id:'unpaid',label:'付款未到账',kind:'open'},
    {id:'balance',label:'待付尾款',kind:'won'},
    {id:'done',label:'已完成',kind:'won'},
    {id:'lost',label:'输单',kind:'lost'}
  ].map(stage=>Object.freeze(stage)));
  const stageById=new Map(STAGES.map(stage=>[stage.id,stage]));
  const FLOWS=Object.freeze([Object.freeze({id:'default',label:'默认销售流程'})]);
  const LOST_REASONS=Object.freeze(['价格原因','交期原因','选择了竞争对手','需求变化或取消','客户无回复','其他']);
  const SORTS=Object.freeze([['createdAt-desc','创建时间 / 降序'],['createdAt-asc','创建时间 / 升序'],['endDate-asc','结束日期 / 升序'],['endDate-desc','结束日期 / 降序'],['amount-desc','销售金额 / 降序'],['amount-asc','销售金额 / 升序']]);
  const cleanName=name=>trim(name).normalize('NFKC').replace(/\s+/g,' ').trim();
  const sameName=(a,b)=>cleanName(a).toLowerCase()===cleanName(b).toLowerCase();

  function validDate(value){
    const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(trim(value));
    if(!match)return false;
    const date=new Date(Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3])));
    return date.getUTCFullYear()===Number(match[1])&&date.getUTCMonth()===Number(match[2])-1&&date.getUTCDate()===Number(match[3]);
  }
  const pad=number=>String(number).padStart(2,'0');
  const isoDay=date=>`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
  // 带时间的值按本地日期显示和比较；只有日期的原样使用。
  function localDay(value){
    const source=trim(value);
    if(/^\d{4}-\d{2}-\d{2}$/.test(source))return validDate(source)?source:'';
    if(!/^\d{4}-\d{2}-\d{2}/.test(source))return '';
    const parsed=new Date(source.replace(' ','T'));
    return Number.isFinite(parsed.getTime())?isoDay(parsed):'';
  }
  function addDays(day,count){
    const [year,month,date]=day.split('-').map(Number);
    const next=new Date(year,month-1,date+count);
    return isoDay(next);
  }
  function decimal(value,label,{min=0,allowZero=true}={}){
    const text=typeof value==='number'&&Number.isFinite(value)?String(value):typeof value==='string'?value.trim():'';
    if(!/^\d+(\.\d+)?$/.test(text))throw new Error(`${label}请填写数字（不要带逗号或符号）`);
    const number=Number(text);
    if(!Number.isFinite(number)||number>1e15)throw new Error(`${label}数值过大`);
    if(number<min||(!allowZero&&number===0))throw new Error(`${label}必须大于 ${allowZero?'或等于 ':''}${min}`);
    return number;
  }
  // 拆成列表并去重（不区分大小写，保留先出现的写法）。
  function splitList(value){
    const seen=new Map();
    for(const text of (Array.isArray(value)?value:String(value??'').split(/[,，、;；\n]/)).map(cleanName).filter(Boolean))if(!seen.has(text.toLowerCase()))seen.set(text.toLowerCase(),text);
    return [...seen.values()];
  }

  const list=state=>(Array.isArray(state?.laiOpportunities)?state.laiOpportunities:[]).filter(item=>item&&typeof item==='object'&&typeof item.id==='string'&&item.id);
  function requireList(state){
    if(state?.laiOpportunities!==undefined&&state.laiOpportunities!==null&&!Array.isArray(state.laiOpportunities))throw new Error('已保存的商机数据格式异常，为避免覆盖，未做任何修改');
  }
  const raw=state=>Array.isArray(state?.laiOpportunities)?state.laiOpportunities:[];

  // 客户名单直接取自客户资料与订单上的客户名（与客户列表的来源一致），不做整表汇总；按 state 对象缓存。
  const customerCache=new WeakMap();
  function customers(state){
    if(state&&typeof state==='object'&&customerCache.has(state))return customerCache.get(state);
    const profiles=state?.customers&&typeof state.customers==='object'&&!Array.isArray(state.customers)?state.customers:{};
    const names=new Set(Object.keys(profiles));
    for(const order of Array.isArray(state?.orders)?state.orders:[])if(order&&typeof order.client==='string'&&order.client)names.add(order.client);
    const rows=[...names].map(name=>{const profile=Object.hasOwn(profiles,name)?profiles[name]:undefined;return {name,owner:cleanName(profile?.owner),bucket:LM.bucket(profile)};});
    if(state&&typeof state==='object')customerCache.set(state,rows);
    return rows;
  }
  const customerNames=state=>customers(state).filter(row=>row.bucket!=='trash').map(row=>row.name).sort((a,b)=>a.localeCompare(b,'zh'));
  // 某个客户的全部联系人姓名（主要联系人＋其他联系人），去重。
  function contactsOf(state,client){
    const profile=state?.customers&&Object.hasOwn(state.customers,client)?state.customers[client]:null;
    if(!profile||typeof profile!=='object')return [];
    const names=[];
    if(Array.isArray(profile.contacts))names.push(...profile.contacts);else names.push(profile.contact);
    if(Array.isArray(profile.extraContacts))for(const extra of profile.extraContacts)names.push(extra?.contact);
    return [...new Set(names.map(trim).filter(Boolean))];
  }
  function ownerNames(state){
    const seen=new Map();
    const add=name=>{const text=cleanName(name);if(text&&text!=='未分配'&&!seen.has(text.toLowerCase()))seen.set(text.toLowerCase(),text);};
    for(const row of customers(state))add(row.owner);
    for(const order of Array.isArray(state?.orders)?state.orders:[])add(order?.owner);
    for(const item of list(state))add(item.owner);
    add(state?.laiSettings?.defaultOwner);
    return [...seen.values()].sort((a,b)=>a.localeCompare(b,'zh'));
  }

  // 自动名称：创建日期的年月日（各两位）＋当天序号（至少两位）＋「-负责人」，例如 26100601-Amy。
  function autoName(state,day,owner,excludeId=''){
    const pattern=new RegExp(`^${day.slice(2,4)+day.slice(5,7)+day.slice(8,10)}(\\d{2,4})-`);
    let highest=0;
    // 只看自动命名的商机（自定义名称即使长得像也不占用序号），也不把正在改名的这一条算进去。
    for(const item of list(state)){
      if(item.nameMode!=='auto'||item.id===excludeId)continue;
      const match=pattern.exec(trim(item.name));
      if(match)highest=Math.max(highest,Number(match[1]));
    }
    return `${day.slice(2,4)+day.slice(5,7)+day.slice(8,10)}${pad(highest+1)}-${owner}`;
  }
  // 关联产品：每行「名称, 数量, 单价」；数量缺省为 1，单价缺省为 0。
  function parseProducts(value){
    if(Array.isArray(value))return value.filter(item=>item&&typeof item==='object'&&trim(item.name)).map(item=>({...item,name:trim(item.name),quantity:decimal(item.quantity??1,'产品数量'),unitPrice:decimal(item.unitPrice??0,'产品单价')}));
    return String(value??'').split('\n').map(line=>line.trim()).filter(Boolean).map(line=>{
      const parts=line.split(/[,，\t]/).map(part=>part.trim());
      const [name,quantity,unitPrice]=parts;
      if(!name)throw new Error('关联产品每行需以产品名称开头');
      if(parts.length>3)throw new Error(`「${name}」这一行多于三项：请按「名称, 数量, 单价」填写，数字里不要带逗号`);
      return {name,quantity:quantity?decimal(quantity,`「${name}」的数量`):1,unitPrice:unitPrice?decimal(unitPrice,`「${name}」的单价`):0};
    });
  }
  const productsText=products=>(Array.isArray(products)?products:[]).filter(item=>item&&typeof item==='object'&&trim(item.name)).map(item=>`${trim(item.name)}, ${item.quantity??1}, ${item.unitPrice??0}`).join('\n');

  function applyStage(next,previous,stageId,input,now){
    // 阶段没变、输单原因也没改：原样保留（历史数据里不认识的阶段或原因不会挡住别的修改）。
    if(previous&&previous.stage===stageId&&(!Object.hasOwn(input,'lostReason')||trim(input.lostReason)===trim(previous.lostReason))){
      if(Object.hasOwn(input,'lostNote')&&stageById.get(stageId)?.kind==='lost')next.lostNote=trim(input.lostNote);
      return;
    }
    if(!stageById.has(stageId))throw new Error('请选择有效的销售阶段');
    const stage=stageById.get(stageId);
    if(stage.kind==='lost'){
      const reason=trim(Object.hasOwn(input,'lostReason')?input.lostReason:previous?.lostReason);
      if(!LOST_REASONS.includes(reason))throw new Error('请选择输单原因');
      next.lostReason=reason;
      next.lostNote=trim(Object.hasOwn(input,'lostNote')?input.lostNote:previous?.lostNote);
    }else{delete next.lostReason;delete next.lostNote;}
    if(previous?.stage!==stageId){
      next.stageHistory=[...(Array.isArray(previous?.stageHistory)?previous.stageHistory:[]),{stage:stageId,at:now}];
      // 进入赢单或输单阶段时记下结束时间；回到进行中则清掉。
      if(stage.kind==='open')delete next.closedAt;
      else if(!previous||stageById.get(previous.stage)?.kind!==stage.kind||!previous.closedAt)next.closedAt=now;
    }
    next.stage=stageId;
  }

  function upsert(state,id,input,options={}){
    requireList(state);
    if(typeof id!=='string'||!id.trim())throw new Error('商机 ID 无效');
    const now=options.now||new Date().toISOString(),today=options.today||isoDay(new Date());
    const previous=list(state).find(item=>item.id===id);
    if(options.mustExist&&!previous)throw new Error('商机不存在，可能已被删除，未保存');
    const next={...(previous||{}),id};
    const has=key=>Object.hasOwn(input,key);
    const value=(key,fallback='')=>has(key)?input[key]:previous?.[key]??fallback;

    next.owner=cleanName(value('owner'));
    if(!next.owner||next.owner==='未分配')throw new Error('请填写负责人');
    next.client=trim(value('client'));
    if(!next.client)throw new Error('请选择客户');
    if(next.client!==previous?.client&&!customerNames(state).includes(next.client))throw new Error('客户不存在或已在回收站，请从列表中选择');
    const contacts=contactsOf(state,next.client);
    next.contact=trim(value('contact'));
    if(next.contact!==previous?.contact||next.client!==previous?.client){
      if(contacts.length&&!next.contact)throw new Error('请选择关联联系人');
      if(next.contact&&contacts.length&&!contacts.includes(next.contact))throw new Error('关联联系人不属于所选客户');
    }
    next.amount=decimal(value('amount'),'销售金额');
    next.currency=trim(value('currency','USD')).toUpperCase();
    if(!/^[A-Z]{3}$/.test(next.currency))throw new Error('请填写三位币种代码');
    // 汇率按「每 100 外币折合多少美元」填写，仅作记录；美元固定为 100。金额汇总不使用它。
    next.exchangeRate=next.currency==='USD'?100:decimal(value('exchangeRate',100),'汇率',{allowZero:false});
    next.endDate=trim(value('endDate'));
    if(!validDate(next.endDate))throw new Error('请选择有效的结束日期');
    next.flow=FLOWS.some(flow=>flow.id===value('flow','default'))?value('flow','default'):'default';
    next.note=trim(value('note'));
    next.collaborators=splitList(value('collaborators',[])).filter(name=>!sameName(name,next.owner));
    next.tags=splitList(value('tags',[]));
    // 产品文本没改动时保留原来保存的产品（包括上面不认识的字段和带逗号的名称）。
    next.products=has('products')&&!(typeof input.products==='string'&&previous&&input.products.trim()===productsText(previous.products))?parseProducts(input.products):Array.isArray(previous?.products)?previous.products:[];
    if(!previous){next.createdAt=now;next.archived=false;}
    next.updatedAt=now;

    next.nameMode=value('nameMode','auto')==='custom'?'custom':'auto';
    if(next.nameMode==='custom'){
      next.name=trim(value('name'));
      if(!next.name)throw new Error('请填写商机名称');
    }else if(!previous||previous.nameMode!=='auto'||!trim(previous.name)){
      next.name=autoName(state,localDay(next.createdAt)||today,next.owner,id);
    }
    applyStage(next,previous,trim(value('stage','open'))||'open',input,now);
    return {...state,laiOpportunities:previous?replaceFirst(state,id,next):[next,...raw(state)]};
  }
  // 万一存了两条相同 ID 的商机，只改第一条，另一条原样保留。
  function replaceFirst(state,id,next){
    let done=false;
    return raw(state).map(item=>{if(!done&&item?.id===id){done=true;return next;}return item;});
  }
  function requireItem(state,id){
    const item=list(state).find(entry=>entry.id===id);
    if(!item)throw new Error('商机不存在，可能已被删除');
    return item;
  }
  function moveStage(state,id,stageId,options={}){
    requireList(state);
    const previous=requireItem(state,id),now=options.now||new Date().toISOString();
    const next={...previous,updatedAt:now};
    applyStage(next,previous,stageId,{...(Object.hasOwn(options,'lostReason')?{lostReason:options.lostReason}:{}),...(Object.hasOwn(options,'lostNote')?{lostNote:options.lostNote}:{})},now);
    return {...state,laiOpportunities:replaceFirst(state,id,next)};
  }
  function setArchived(state,id,archived,options={}){
    requireList(state);
    const previous=requireItem(state,id);
    return {...state,laiOpportunities:replaceFirst(state,id,{...previous,archived:archived===true,updatedAt:options.now||new Date().toISOString()})};
  }
  function remove(state,id){
    requireList(state);
    requireItem(state,id);
    return {...state,laiOpportunities:raw(state).filter(item=>item?.id!==id)};
  }
  // 把商机与由它生成的订单关联起来（只记订单 ID）。
  function linkOrder(state,id,orderId){
    requireList(state);
    const previous=requireItem(state,id);
    return {...state,laiOpportunities:replaceFirst(state,id,{...previous,orderId:trim(orderId)})};
  }

  const amountOf=item=>Number.isFinite(Number(item.amount))&&Number(item.amount)>0?Number(item.amount):0;
  const currencyOf=item=>/^[A-Z]{3}$/.test(trim(item.currency).toUpperCase())?trim(item.currency).toUpperCase():'USD';
  const stageOf=item=>stageById.get(item.stage)||STAGES[0];
  function defaultCurrency(state){
    const code=trim(state?.laiSettings?.defaultCurrency||state?.orderSettings?.defaultCurrency).toUpperCase();
    return /^[A-Z]{3}$/.test(code)?code:'USD';
  }
  function currenciesOf(items,preferred='USD'){
    const counts=new Map();
    for(const item of items)counts.set(currencyOf(item),(counts.get(currencyOf(item))||0)+1);
    // 用得最多的币种排最前（看板默认显示它）；数量相同时先取默认币种，再按代码排序。
    return [...counts.entries()].sort((a,b)=>b[1]-a[1]||(a[0]===preferred?0:1)-(b[0]===preferred?0:1)||a[0].localeCompare(b[0])).map(entry=>entry[0]);
  }
  const card=(item,today,orderIds)=>({
    id:item.id,name:trim(item.name)||'（未命名商机）',amount:amountOf(item),currency:currencyOf(item),client:trim(item.client),contact:trim(item.contact),
    owner:cleanName(item.owner),endDate:trim(item.endDate),createdDay:localDay(item.createdAt),stage:stageOf(item).id,archived:item.archived===true,
    overdue:stageOf(item).kind==='open'&&validDate(item.endDate)&&item.endDate<today,lostReason:trim(item.lostReason),orderId:trim(item.orderId)&&(!orderIds||orderIds.has(trim(item.orderId)))?trim(item.orderId):'',tags:Array.isArray(item.tags)?item.tags:[]
  });
  const activeOrderIds=state=>new Set((Array.isArray(state?.orders)?state.orders:[]).map(order=>order?.id).filter(Boolean));
  // 单个商机的卡片内容（操作菜单用），不受看板当前币种和筛选影响。
  function cardOf(state,id,today=isoDay(new Date())){
    const item=list(state).find(entry=>entry.id===id);
    return item?card(item,today,activeOrderIds(state)):null;
  }
  function applyFilters(state,filters={},today){
    const archived=['archived','all'].includes(filters.archived)?filters.archived:'active';
    let items=list(state).filter(item=>archived==='all'||(item.archived===true)===(archived==='archived'));
    if(cleanName(filters.owner))items=items.filter(item=>sameName(item.owner,filters.owner));
    const search=cleanName(filters.search).toLowerCase();
    if(search)items=items.filter(item=>[item.name,item.client,item.contact,item.owner,...(Array.isArray(item.tags)?item.tags:[])].some(text=>cleanName(text).toLowerCase().includes(search)));
    const field=filters.dateField==='endDate'?'endDate':'createdAt';
    const from=validDate(filters.from)?filters.from:'',to=validDate(filters.to)?filters.to:'';
    if(from||to)items=items.filter(item=>{const day=field==='endDate'?trim(item.endDate):localDay(item.createdAt);return day&&(!from||day>=from)&&(!to||day<=to);});
    return {items,archived,field,from,to};
  }
  function sortCards(cards,sort){
    const [key,direction]=(SORTS.some(entry=>entry[0]===sort)?sort:'createdAt-desc').split('-');
    const value=item=>key==='amount'?item.amount:key==='endDate'?item.endDate:item.createdAt;
    const factor=direction==='asc'?1:-1;
    return [...cards].sort((a,b)=>{
      const x=value(a),y=value(b);
      return (x<y?-1:x>y?1:0)*factor||a.name.localeCompare(b.name,'zh');
    });
  }
  // 看板：同一时间只汇总一种币种（不折算），默认取商机数最多的币种。
  function board(state,filters={},today=isoDay(new Date())){
    const {items,archived,field,from,to}=applyFilters(state,filters,today);
    const currencies=currenciesOf(items,defaultCurrency(state));
    const currency=currencies.includes(trim(filters.currency).toUpperCase())?trim(filters.currency).toUpperCase():currencies[0]||defaultCurrency(state);
    const orderIds=activeOrderIds(state);
    const selected=items.filter(item=>currencyOf(item)===currency).map(item=>({...card(item,today,orderIds),createdAt:trim(item.createdAt)}));
    const sorted=sortCards(selected,filters.sort);
    const columns=STAGES.map(stage=>{
      const cards=sorted.filter(item=>item.stage===stage.id);
      return {...stage,count:cards.length,amount:cards.reduce((sum,item)=>sum+item.amount,0),cards};
    });
    const sum=kind=>columns.filter(column=>column.kind===kind).reduce((total,column)=>total+column.amount,0);
    return {
      currency,currencies,count:selected.length,otherCurrencyCount:items.length-selected.length,columns,cards:sorted,
      totals:{open:sum('open'),won:sum('won'),lost:sum('lost'),total:sum('open')+sum('won')},
      filters:{archived,dateField:field,from,to,owner:cleanName(filters.owner),search:trim(filters.search),sort:SORTS.some(entry=>entry[0]===filters.sort)?filters.sort:'createdAt-desc'}
    };
  }
  // 商机分析：按创建月份取一批商机（months 为空表示全部时间），看各阶段分布、赢单率、输单原因和各负责人表现。
  function analysis(state,options={},today=isoDay(new Date())){
    const months=Array.isArray(options.months)&&options.months.length?new Set(options.months):null;
    const all=list(state).filter(item=>!months||months.has(localDay(item.createdAt).slice(0,7)));
    const currencies=currenciesOf(all,defaultCurrency(state));
    const currency=currencies.includes(trim(options.currency).toUpperCase())?trim(options.currency).toUpperCase():currencies[0]||defaultCurrency(state);
    const items=all.filter(item=>currencyOf(item)===currency);
    const rate=(won,lost)=>won+lost?Math.floor(won/(won+lost)*100):null;
    const summarise=group=>{
      const of=kind=>group.filter(item=>stageOf(item).kind===kind);
      const won=of('won'),lost=of('lost'),open=of('open');
      const amount=rows=>rows.reduce((sum,item)=>sum+amountOf(item),0);
      const durations=won.map(item=>{const start=localDay(item.createdAt),end=localDay(item.closedAt);return start&&end?Math.round((Date.parse(end)-Date.parse(start))/86400000):null;}).filter(days=>days!==null&&days>=0);
      return {created:group.length,open:open.length,won:won.length,lost:lost.length,openAmount:amount(open),wonAmount:amount(won),lostAmount:amount(lost),
        winRate:rate(won.length,lost.length),averageDays:durations.length?Math.round(durations.reduce((a,b)=>a+b,0)/durations.length*10)/10:null};
    };
    const stages=STAGES.map(stage=>{const rows=items.filter(item=>stageOf(item).id===stage.id);return {...stage,count:rows.length,amount:rows.reduce((sum,item)=>sum+amountOf(item),0),percent:items.length?Math.round(rows.length/items.length*100):0};});
    const reasons=new Map();
    for(const item of items.filter(entry=>stageOf(entry).kind==='lost')){
      const key=LOST_REASONS.includes(trim(item.lostReason))?trim(item.lostReason):'未填写';
      const row=reasons.get(key)||{reason:key,count:0,amount:0};
      row.count++;row.amount+=amountOf(item);reasons.set(key,row);
    }
    const owners=new Map();
    for(const item of items){
      const key=cleanName(item.owner).toLowerCase();
      if(!owners.has(key))owners.set(key,{spellings:new Map(),items:[]});
      const group=owners.get(key),text=cleanName(item.owner)||'未分配';
      group.spellings.set(text,(group.spellings.get(text)||0)+1);
      group.items.push(item);
    }
    // 同一个人多种大小写写法时，显示出现最多的；次数相同取字符顺序靠前的。
    for(const group of owners.values())group.label=[...group.spellings.entries()].sort((a,b)=>b[1]-a[1]||(a[0]<b[0]?-1:1))[0][0];
    return {
      currency,currencies,otherCurrencyCount:all.length-items.length,summary:summarise(items),stages,
      lostReasons:[...reasons.values()].sort((a,b)=>b.count-a.count||a.reason.localeCompare(b.reason,'zh')),
      owners:[...owners.values()].map(group=>({owner:group.label,...summarise(group.items)})).sort((a,b)=>b.wonAmount-a.wonAmount||b.created-a.created||a.owner.localeCompare(b.owner,'zh'))
    };
  }
  // 某个客户的商机情况（客户详情页用）：进行中的商机列表、赢单数量与美元金额、赢单率、平均销售周期。
  function customerStats(state,client,today=isoDay(new Date())){
    const name=trim(client),orderIds=activeOrderIds(state);
    const all=list(state).filter(item=>trim(item.client)===name);
    const kind=item=>stageOf(item).kind;
    const won=all.filter(item=>kind(item)==='won'),lost=all.filter(item=>kind(item)==='lost');
    const active=sortCards(all.filter(item=>kind(item)==='open'&&item.archived!==true).map(item=>({...card(item,today,orderIds),createdAt:trim(item.createdAt),note:trim(item.note)})),'createdAt-desc');
    // 详情页这两项标明是美元：只统计美元的赢单商机，其他币种不折算、不计入。
    const usd=won.filter(item=>currencyOf(item)==='USD');
    const total=usd.reduce((sum,item)=>sum+amountOf(item),0);
    const days=won.map(item=>{const start=localDay(item.createdAt),end=localDay(item.closedAt);return start&&end?Math.round((Date.parse(end)-Date.parse(start))/86400000):null;}).filter(value=>value!==null&&value>=0);
    return {
      opportunityAllCount:all.length,activeOpportunityCount:active.length,opportunityCount:won.length,
      opportunityTotal:usd.length?total:null,opportunityAverage:usd.length?total/usd.length:null,
      opportunityWinRate:won.length+lost.length?Math.floor(won.length/(won.length+lost.length)*100):null,
      opportunityCycle:days.length?Math.round(days.reduce((a,b)=>a+b,0)/days.length*10)/10:null,
      activeOpportunities:active
    };
  }
  // 新建表单的默认值。
  function defaults(state,today=isoDay(new Date())){
    return {nameMode:'auto',name:'',client:'',contact:'',amount:'',endDate:addDays(today,30),flow:'default',exchangeRate:100,currency:defaultCurrency(state),
      stage:'open',note:'',owner:cleanName(state?.laiSettings?.defaultOwner||state?.orderSettings?.defaultOwner),collaborators:[],tags:[],products:[],lostReason:'',lostNote:''};
  }
  // 由赢单商机生成订单时预填的内容（交给现有的订单表单，由用户确认保存）。
  function orderDraft(item,today=isoDay(new Date())){
    return {client:trim(item.client),amount:amountOf(item),currency:currencyOf(item),owner:cleanName(item.owner),stage:'quote',paidAmount:0,createdAt:today,orderMonth:today.slice(0,7),
      note:`由商机「${trim(item.name)}」生成`,productType:(Array.isArray(item.products)?item.products:[]).map(product=>product.name).join('、')};
  }
  const api={STAGES,FLOWS,LOST_REASONS,SORTS,list,cardOf,customerStats,upsert,moveStage,setArchived,remove,linkOrder,board,analysis,defaults,orderDraft,customerNames,contactsOf,ownerNames,autoName,parseProducts,productsText,addDays,localDay,validDate};
  if(node)module.exports=api;else root.LaiOpportunityModel=api;
})(typeof window!=='undefined'?window:globalThis);
