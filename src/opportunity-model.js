(function(root){
  'use strict';
  // 商机：保存在 state.laiOpportunities（数组）。阶段、字段参照用户提供的参考界面；不同币种不折算、不相加。
  // 销售流程（每个流程有自己的一组阶段）保存在 state.laiOpportunityFlows；没保存过时用下面的默认流程。
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
  const FLOWS=Object.freeze([Object.freeze({id:'default',label:'默认销售流程'})]);
  const KIND_LABELS=Object.freeze({open:'进行中',won:'赢单',lost:'输单'});
  const KIND_ORDER=['open','won','lost'];
  const DEFAULT_FLOW=Object.freeze({id:'default',label:'默认销售流程',stages:STAGES});
  const MAX_FLOWS=10,MAX_STAGES=12,MAX_LABEL=20;
  const LOST_REASONS=Object.freeze(['价格原因','交期原因','选择了竞争对手','需求变化或取消','客户无回复','其他']);
  const SORTS=Object.freeze([['createdAt-desc','创建时间 / 降序'],['createdAt-asc','创建时间 / 升序'],['endDate-asc','结束日期 / 升序'],['endDate-desc','结束日期 / 降序'],['amount-desc','销售金额 / 降序'],['amount-asc','销售金额 / 升序'],['manual','手动排序（可拖动调整）']]);
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

  // ---- 销售流程 ----
  // 每个流程：若干「进行中」阶段、若干「赢单」阶段、正好一个「输单」阶段（ID 固定为 lost）；显示顺序按这三类排。
  // 读不懂的流程或阶段跳过不用，但保存别的修改时原样保留。
  const rawFlows=state=>Array.isArray(state?.laiOpportunityFlows)?state.laiOpportunityFlows:[];
  function requireFlows(state){
    if(state?.laiOpportunityFlows!==undefined&&state.laiOpportunityFlows!==null&&!Array.isArray(state.laiOpportunityFlows))throw new Error('已保存的销售流程格式异常，为避免覆盖，未做任何修改');
  }
  function readFlow(entry){
    if(!entry||typeof entry!=='object'||typeof entry.id!=='string'||!entry.id.trim())return null;
    // used：保存的阶段条目里实际被采用的那些的位置（其余读不懂或重复的，保存时原样留着）。
    const seen=new Set(),stages=[],used=new Map();
    (Array.isArray(entry.stages)?entry.stages:[]).forEach((stage,position)=>{
      if(!stage||typeof stage!=='object'||typeof stage.id!=='string'||!stage.id||seen.has(stage.id)||!Object.hasOwn(KIND_LABELS,stage.kind)||!cleanName(stage.label))return;
      if((stage.kind==='lost')!==(stage.id==='lost'))return;
      seen.add(stage.id);
      used.set(stage.id,position);
      stages.push({id:stage.id,label:cleanName(stage.label),kind:stage.kind});
    });
    const count=kind=>stages.filter(stage=>stage.kind===kind).length;
    if(!count('open')||!count('won')||count('lost')!==1)return null;
    stages.sort((a,b)=>KIND_ORDER.indexOf(a.kind)-KIND_ORDER.indexOf(b.kind));
    const flow={id:entry.id,label:cleanName(entry.label)||'未命名流程',stages};
    // 不参与显示和比较，只给保存时用。
    Object.defineProperty(flow,'used',{value:used,enumerable:false});
    return flow;
  }
  const flowCache=new WeakMap();
  function flowsOf(state){
    if(state&&typeof state==='object'&&flowCache.has(state))return flowCache.get(state);
    const seen=new Map();
    for(const entry of rawFlows(state)){const flow=readFlow(entry);if(flow&&!seen.has(flow.id))seen.set(flow.id,flow);}
    const flows=[...seen.values()];
    if(!seen.has('default'))flows.unshift(DEFAULT_FLOW);
    if(state&&typeof state==='object')flowCache.set(state,flows);
    return flows;
  }
  // 找不到的流程（没填、已不存在）一律按默认流程处理。
  const flowOf=(state,id)=>{const flows=flowsOf(state);return flows.find(flow=>flow.id===trim(id))||flows.find(flow=>flow.id==='default');};
  const flowOfItem=(state,item)=>flowOf(state,item?.flow);
  const knownStage=(state,item)=>flowOfItem(state,item).stages.find(stage=>stage.id===item?.stage);
  // 商机所处的阶段；阶段不认识时按流程的第一个阶段显示。
  const stageOf=(state,item)=>knownStage(state,item)||flowOfItem(state,item).stages[0];

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

  function applyStage(state,next,previous,stageId,input,now){
    const flow=flowOf(state,next.flow),find=id=>flow.stages.find(stage=>stage.id===id);
    const sameFlow=!previous||flowOfItem(state,previous).id===flow.id;
    // 阶段没变、输单原因也没改：原样保留（历史数据里不认识的阶段或原因不会挡住别的修改）。
    if(previous&&sameFlow&&previous.stage===stageId&&(!Object.hasOwn(input,'lostReason')||trim(input.lostReason)===trim(previous.lostReason))){
      if(Object.hasOwn(input,'lostNote')&&find(stageId)?.kind==='lost')next.lostNote=trim(input.lostNote);
      return;
    }
    const stage=find(stageId);
    if(!stage)throw new Error(sameFlow?'请选择有效的销售阶段':'所选销售流程里没有这个阶段，请重新选择销售阶段');
    if(stage.kind==='lost'){
      const reason=trim(Object.hasOwn(input,'lostReason')?input.lostReason:previous?.lostReason);
      if(!LOST_REASONS.includes(reason))throw new Error('请选择输单原因');
      next.lostReason=reason;
      next.lostNote=trim(Object.hasOwn(input,'lostNote')?input.lostNote:previous?.lostNote);
    }else{delete next.lostReason;delete next.lostNote;}
    if(previous?.stage!==stageId||!sameFlow){
      next.stageHistory=[...(Array.isArray(previous?.stageHistory)?previous.stageHistory:[]),{stage:stageId,at:now}];
      // 进入赢单或输单阶段时记下结束时间；回到进行中则清掉。
      if(stage.kind==='open')delete next.closedAt;
      else if(!previous||knownStage(state,previous)?.kind!==stage.kind||!previous.closedAt)next.closedAt=now;
    }
    next.stage=stageId;
    if(previous&&(previous.stage!==stageId||!sameFlow))delete next.sortRank;
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
    // 流程：商机原来指向的流程现在读不到时按默认流程处理，但只要没有改选别的流程，就保留原来的指向（那个流程也许只是暂时读不懂）。
    const wantedFlow=trim(value('flow','default')),flowKnown=id=>flowsOf(state).some(flow=>flow.id===id);
    if(previous&&trim(previous.flow)&&!flowKnown(trim(previous.flow))&&flowOf(state,wantedFlow).id===flowOfItem(state,previous).id)next.flow=previous.flow;
    else next.flow=flowKnown(wantedFlow)?wantedFlow:'default';
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
    const firstStage=flowOf(state,next.flow).stages[0].id;
    applyStage(state,next,previous,trim(value('stage',firstStage))||firstStage,input,now);
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
    applyStage(state,next,previous,stageId,{...(Object.hasOwn(options,'lostReason')?{lostReason:options.lostReason}:{}),...(Object.hasOwn(options,'lostNote')?{lostNote:options.lostNote}:{})},now);
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
  const card=(state,item,today,orderIds,stage=stageOf(state,item))=>({
    flow:flowOfItem(state,item).id,stageLabel:stage.label,kind:stage.kind,
    id:item.id,name:trim(item.name)||'（未命名商机）',amount:amountOf(item),currency:currencyOf(item),client:trim(item.client),contact:trim(item.contact),
    owner:cleanName(item.owner),endDate:trim(item.endDate),createdDay:localDay(item.createdAt),stage:stage.id,archived:item.archived===true,
    overdue:stage.kind==='open'&&validDate(item.endDate)&&item.endDate<today,lostReason:trim(item.lostReason),orderId:trim(item.orderId)&&(!orderIds||orderIds.has(trim(item.orderId)))?trim(item.orderId):'',tags:Array.isArray(item.tags)?item.tags:[],attachmentCount:attachmentsOf(item).length,sortRank:rankOf(item)
  });
  const activeOrderIds=state=>new Set((Array.isArray(state?.orders)?state.orders:[]).map(order=>order?.id).filter(Boolean));
  // 单个商机的卡片内容（操作菜单用），不受看板当前币种和筛选影响。
  function cardOf(state,id,today=isoDay(new Date())){
    const item=list(state).find(entry=>entry.id===id);
    // stages：这个商机所在流程的全部阶段（操作菜单里「移到…」用）。
    return item?{...card(state,item,today,activeOrderIds(state)),stages:flowOfItem(state,item).stages}:null;
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
  // 手动排序：没排过的（新建的、刚移进来的）在最上面，按创建时间新的在前；排过的按 rank 从小到大。
  const rankOf=item=>Number.isFinite(item.sortRank)?item.sortRank:null;
  function manualOrder(cards){
    const unranked=cards.filter(item=>rankOf(item)===null).sort((a,b)=>(a.createdAt<b.createdAt?1:a.createdAt>b.createdAt?-1:0)||a.name.localeCompare(b.name,'zh'));
    const ranked=cards.filter(item=>rankOf(item)!==null).sort((a,b)=>a.sortRank-b.sortRank||a.name.localeCompare(b.name,'zh'));
    return [...unranked,...ranked];
  }
  function sortCards(cards,sort){
    if(sort==='manual')return manualOrder(cards);
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
    const {items:filtered,archived,field,from,to}=applyFilters(state,filters,today);
    // 一次只看一个销售流程：阶段列是这个流程的阶段。
    const flow=flowOf(state,filters.flow);
    const items=filtered.filter(item=>flowOfItem(state,item).id===flow.id);
    const currencies=currenciesOf(items,defaultCurrency(state));
    const currency=currencies.includes(trim(filters.currency).toUpperCase())?trim(filters.currency).toUpperCase():currencies[0]||defaultCurrency(state);
    const orderIds=activeOrderIds(state);
    const selected=items.filter(item=>currencyOf(item)===currency).map(item=>({...card(state,item,today,orderIds),createdAt:trim(item.createdAt)}));
    const sorted=sortCards(selected,filters.sort);
    const columns=flow.stages.map(stage=>{
      const cards=sorted.filter(item=>item.stage===stage.id);
      return {...stage,count:cards.length,amount:cards.reduce((sum,item)=>sum+item.amount,0),cards};
    });
    const sum=kind=>columns.filter(column=>column.kind===kind).reduce((total,column)=>total+column.amount,0);
    return {
      currency,currencies,count:selected.length,otherCurrencyCount:items.length-selected.length,columns,cards:sorted,
      flow:flow.id,flows:flowsOf(state).map(entry=>({id:entry.id,label:entry.label,count:filtered.filter(item=>flowOfItem(state,item).id===entry.id).length})),
      otherFlowCount:filtered.length-items.length,
      totals:{open:sum('open'),won:sum('won'),lost:sum('lost'),total:sum('open')+sum('won')},
      filters:{flow:flow.id,archived,dateField:field,from,to,owner:cleanName(filters.owner),search:trim(filters.search),sort:SORTS.some(entry=>entry[0]===filters.sort)?filters.sort:'createdAt-desc'}
    };
  }
  // 商机分析：按创建月份取一批商机（months 为空表示全部时间），看各阶段分布、赢单率、输单原因和各负责人表现。
  function analysis(state,options={},today=isoDay(new Date())){
    const months=Array.isArray(options.months)&&options.months.length?new Set(options.months):null;
    const flow=flowOf(state,options.flow);
    const inRange=list(state).filter(item=>!months||months.has(localDay(item.createdAt).slice(0,7)));
    const all=inRange.filter(item=>flowOfItem(state,item).id===flow.id);
    const currencies=currenciesOf(all,defaultCurrency(state));
    const currency=currencies.includes(trim(options.currency).toUpperCase())?trim(options.currency).toUpperCase():currencies[0]||defaultCurrency(state);
    const items=all.filter(item=>currencyOf(item)===currency);
    const rate=(won,lost)=>won+lost?Math.floor(won/(won+lost)*100):null;
    const summarise=group=>{
      const of=kind=>group.filter(item=>stageOf(state,item).kind===kind);
      const won=of('won'),lost=of('lost'),open=of('open');
      const amount=rows=>rows.reduce((sum,item)=>sum+amountOf(item),0);
      const durations=won.map(item=>{const start=localDay(item.createdAt),end=localDay(item.closedAt);return start&&end?Math.round((Date.parse(end)-Date.parse(start))/86400000):null;}).filter(days=>days!==null&&days>=0);
      return {created:group.length,open:open.length,won:won.length,lost:lost.length,openAmount:amount(open),wonAmount:amount(won),lostAmount:amount(lost),
        winRate:rate(won.length,lost.length),averageDays:durations.length?Math.round(durations.reduce((a,b)=>a+b,0)/durations.length*10)/10:null};
    };
    const stages=flow.stages.map(stage=>{const rows=items.filter(item=>stageOf(state,item).id===stage.id);return {...stage,count:rows.length,amount:rows.reduce((sum,item)=>sum+amountOf(item),0),percent:items.length?Math.round(rows.length/items.length*100):0};});
    const reasons=new Map();
    for(const item of items.filter(entry=>stageOf(state,entry).kind==='lost')){
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
      flow:flow.id,flows:flowsOf(state).map(entry=>({id:entry.id,label:entry.label,count:inRange.filter(item=>flowOfItem(state,item).id===entry.id).length})),
      lostReasons:[...reasons.values()].sort((a,b)=>b.count-a.count||a.reason.localeCompare(b.reason,'zh')),
      owners:[...owners.values()].map(group=>({owner:group.label,...summarise(group.items)})).sort((a,b)=>b.wonAmount-a.wonAmount||b.created-a.created||a.owner.localeCompare(b.owner,'zh'))
    };
  }
  // 某个客户的商机情况（客户详情页用）：进行中的商机列表、赢单数量与美元金额、赢单率、平均销售周期。
  function customerStats(state,client,today=isoDay(new Date())){
    const name=trim(client),orderIds=activeOrderIds(state);
    const all=list(state).filter(item=>trim(item.client)===name);
    const kind=item=>stageOf(state,item).kind;
    const won=all.filter(item=>kind(item)==='won'),lost=all.filter(item=>kind(item)==='lost');
    const active=sortCards(all.filter(item=>kind(item)==='open'&&item.archived!==true).map(item=>({...card(state,item,today,orderIds),createdAt:trim(item.createdAt),note:trim(item.note),stages:flowOfItem(state,item).stages})),'createdAt-desc');
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
      stage:flowOf(state,'default').stages[0].id,note:'',owner:cleanName(state?.laiSettings?.defaultOwner||state?.orderSettings?.defaultOwner),collaborators:[],tags:[],products:[],lostReason:'',lostNote:''};
  }
  // 由赢单商机生成订单时预填的内容（交给现有的订单表单，由用户确认保存）。
  function orderDraft(item,today=isoDay(new Date())){
    return {client:trim(item.client),amount:amountOf(item),currency:currencyOf(item),owner:cleanName(item.owner),stage:'quote',paidAmount:0,createdAt:today,orderMonth:today.slice(0,7),
      note:`由商机「${trim(item.name)}」生成`,productType:(Array.isArray(item.products)?item.products:[]).map(product=>product.name).join('、')};
  }
  // ---- 销售流程设置：新建／改名／删除流程，添加／改名／排序／删除阶段。每个动作各自保存。 ----
  function labelOf(value,what){
    // 去掉看不见的零宽字符；长度按「字」数（一个表情算一个字，不按内部编码长度）。
    const text=cleanName(String(value??'').replace(/[\u200B-\u200D\u2060\uFEFF]/g,''));
    if(!text)throw new Error(`请填写${what}名称`);
    if([...new Intl.Segmenter().segment(text)].length>MAX_LABEL)throw new Error(`${what}名称不能超过 ${MAX_LABEL} 个字`);
    return text;
  }
  const newId=(prefix,taken)=>{let id;do{id=prefix+Date.now().toString(36)+Math.random().toString(36).slice(2,6);}while(taken.has(id));return id;};
  function requireFlow(state,id){
    const flow=flowsOf(state).find(entry=>entry.id===id);
    if(!flow)throw new Error('销售流程不存在，可能已被删除');
    return flow;
  }
  // 写回一个流程：覆盖已保存的同 ID 条目（保留条目和阶段上不认识的字段），没有就新增。
  function saveFlow(state,flow){
    const entries=rawFlows(state),index=entries.findIndex(entry=>readFlow(entry)?.id===flow.id);
    const previous=index>=0?entries[index]:null;
    const saved=Array.isArray(previous?.stages)?previous.stages:[],used=previous?readFlow(previous).used:new Map();
    // 被采用的阶段按新的内容写回（带上原条目里不认识的字段）；读不懂或重复的条目原样接在后面，不丢。
    const leftovers=saved.filter((stage,position)=>![...used.values()].includes(position));
    const entry={...(previous||{}),id:flow.id,label:flow.label,stages:[...flow.stages.map(stage=>({...(used.has(stage.id)?saved[used.get(stage.id)]:{}),id:stage.id,label:stage.label,kind:stage.kind})),...leftovers]};
    return {...state,laiOpportunityFlows:index>=0?entries.map((item,position)=>position===index?entry:item):flow.id==='default'?[entry,...entries]:[...entries,entry]};
  }
  const sameLabel=(a,b)=>cleanName(a).toLowerCase()===cleanName(b).toLowerCase();
  function addFlow(state,input={},options={}){
    requireFlows(state);
    const flows=flowsOf(state);
    if(flows.length>=MAX_FLOWS)throw new Error(`最多保留 ${MAX_FLOWS} 个销售流程`);
    const label=labelOf(input.label,'销售流程');
    if(flows.some(flow=>sameLabel(flow.label,label)))throw new Error('已经有同名的销售流程');
    const taken=new Set(flows.map(flow=>flow.id)),id=trim(options.id)||newId('f',taken);
    if(taken.has(id))throw new Error('销售流程 ID 重复');
    // 新流程从所选流程复制一份阶段（默认复制默认流程），之后各改各的。
    return saveFlow(state,{id,label,stages:flowOf(state,input.copyFrom).stages.map(stage=>({...stage}))});
  }
  function renameFlow(state,id,value){
    requireFlows(state);
    const flow=requireFlow(state,id),label=labelOf(value,'销售流程');
    if(flowsOf(state).some(entry=>entry.id!==id&&sameLabel(entry.label,label)))throw new Error('已经有同名的销售流程');
    return saveFlow(state,{...flow,label});
  }
  const itemsIn=(state,flowId)=>list(state).filter(item=>flowOfItem(state,item).id===flowId);
  function removeFlow(state,id){
    requireFlows(state);
    const flow=requireFlow(state,id);
    if(id==='default')throw new Error('默认销售流程不能删除');
    const count=itemsIn(state,id).length;
    if(count)throw new Error(`「${flow.label}」里还有 ${count} 个商机，先把它们改到别的流程或删除后再删流程`);
    return {...state,laiOpportunityFlows:rawFlows(state).filter(entry=>readFlow(entry)?.id!==id)};
  }
  function addFlowStage(state,flowId,input={},options={}){
    requireFlows(state);
    const flow=requireFlow(state,flowId),label=labelOf(input.label,'阶段'),kind=trim(input.kind);
    if(kind!=='open'&&kind!=='won')throw new Error('请选择阶段类型：进行中或赢单（每个流程固定只有一个输单阶段）');
    if(flow.stages.length>=MAX_STAGES)throw new Error(`一个流程最多 ${MAX_STAGES} 个阶段`);
    if(flow.stages.some(stage=>sameLabel(stage.label,label)))throw new Error('这个流程里已经有同名的阶段');
    const taken=new Set(flow.stages.map(stage=>stage.id)),id=trim(options.id)||newId('s',taken);
    if(taken.has(id)||id==='lost')throw new Error('阶段 ID 重复');
    const stages=[...flow.stages];
    // 放在同类阶段的最后。
    stages.splice(stages.findLastIndex(stage=>stage.kind===kind)+1,0,{id,label,kind});
    return saveFlow(state,{...flow,stages});
  }
  function requireStage(flow,stageId){
    const stage=flow.stages.find(entry=>entry.id===stageId);
    if(!stage)throw new Error('阶段不存在，可能已被删除');
    return stage;
  }
  function renameFlowStage(state,flowId,stageId,value){
    requireFlows(state);
    const flow=requireFlow(state,flowId);
    requireStage(flow,stageId);
    const label=labelOf(value,'阶段');
    if(flow.stages.some(stage=>stage.id!==stageId&&sameLabel(stage.label,label)))throw new Error('这个流程里已经有同名的阶段');
    return saveFlow(state,{...flow,stages:flow.stages.map(stage=>stage.id===stageId?{...stage,label}:stage)});
  }
  // direction：-1 前移，1 后移；只能在同一类（进行中／赢单）里调整顺序。
  function moveFlowStage(state,flowId,stageId,direction){
    requireFlows(state);
    const flow=requireFlow(state,flowId),stage=requireStage(flow,stageId);
    const index=flow.stages.indexOf(stage),other=flow.stages[index+(direction<0?-1:1)];
    if(!other||other.kind!==stage.kind)throw new Error(direction<0?'已经是这一类里的第一个阶段':'已经是这一类里的最后一个阶段');
    const stages=[...flow.stages];
    stages[index]=other;stages[index+(direction<0?-1:1)]=stage;
    return saveFlow(state,{...flow,stages});
  }
  // 删除阶段：阶段里还有商机时，必须先选好把它们移到哪个阶段（不能移到输单，输单需要逐个填原因）。
  function removeFlowStage(state,flowId,stageId,options={}){
    requireFlows(state);requireList(state);
    const flow=requireFlow(state,flowId),stage=requireStage(flow,stageId),now=options.now||new Date().toISOString();
    if(stage.kind==='lost')throw new Error('输单阶段不能删除');
    if(flow.stages.filter(entry=>entry.kind===stage.kind).length<2)throw new Error(`至少保留一个${KIND_LABELS[stage.kind]}阶段`);
    const affected=new Set(itemsIn(state,flowId).filter(item=>stageOf(state,item).id===stageId));
    let next=state;
    if(affected.size){
      const target=flow.stages.find(entry=>entry.id===trim(options.moveTo)&&entry.id!==stageId&&entry.kind!=='lost');
      if(!target)throw new Error(`「${stage.label}」里还有 ${affected.size} 个商机，请先选择把它们移到哪个阶段`);
      next={...state,laiOpportunities:raw(state).map(item=>{
        if(!affected.has(item))return item;
        const moved={...item,stage:target.id,updatedAt:now,stageHistory:[...(Array.isArray(item.stageHistory)?item.stageHistory:[]),{stage:target.id,at:now}]};
        delete moved.sortRank;
        if(target.kind==='open')delete moved.closedAt;
        else if(stage.kind!==target.kind||!item.closedAt)moved.closedAt=now;
        return moved;
      })};
    }
    return saveFlow(next,{...flow,stages:flow.stages.filter(entry=>entry.id!==stageId)});
  }
  // 设置页用：每个流程、每个阶段当前有多少商机（含已归档）。
  function flowSummary(state){
    return flowsOf(state).map(flow=>{
      const items=itemsIn(state,flow.id);
      return {...flow,count:items.length,stages:flow.stages.map(stage=>({...stage,count:items.filter(item=>stageOf(state,item).id===stage.id).length}))};
    });
  }

  // ---------- 附件 ----------
  // 文件本身存在应用的附件目录（备份会一并复制）；商机里只记名称、大小、类型和文件地址。
  const ATTACHMENT_LIMITS=Object.freeze({maxBytes:20*1024*1024,maxCount:30,maxName:120,urlPrefix:'/attachments/opportunities/'});
  // 能直接运行或安装的文件类型不收；后端有同一份清单（tests 里核对两边一致）。
  const BLOCKED_EXTENSIONS=Object.freeze(['app','bat','bin','cmd','com','command','csh','deb','dll','dmg','exe','jar','ksh','lnk','msi','pif','pkg','ps1','rpm','run','scr','sh','terminal','tool','vbs','workflow','zsh']);
  function attachmentName(value){
    const name=String(value??'').normalize('NFC').replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g,'').replace(/[\\/]+/g,'_').replace(/\s+/g,' ').trim().replace(/^\.+/,'').trim();
    if(!name)return '';
    const dot=name.lastIndexOf('.'),extension=dot>0&&name.length-dot<=12?name.slice(dot):'';
    const chars=[...name];
    return chars.length<=ATTACHMENT_LIMITS.maxName?name:[...name.slice(0,name.length-extension.length)].slice(0,ATTACHMENT_LIMITS.maxName-[...extension].length).join('')+extension;
  }
  const extensionOf=name=>{const match=/\.([A-Za-z0-9]{1,12})\s*$/.exec(String(name||''));return match?match[1].toLowerCase():'';};
  const mb=bytes=>`${Math.round(bytes/1024/1024)} MB`;
  // 上传前后都用它检查一个文件；通过时返回整理后的名称。
  function checkFile(file){
    const name=attachmentName(file?.name);
    if(!name)throw new Error('文件名不能为空');
    if(BLOCKED_EXTENSIONS.includes(extensionOf(name)))throw new Error(`「${name}」是可执行或安装类文件，出于安全不能作为附件`);
    const size=Number(file?.size);
    if(!Number.isFinite(size)||size<0||!Number.isInteger(size))throw new Error(`「${name}」的大小无效`);
    if(size===0)throw new Error(`「${name}」是空文件`);
    if(size>ATTACHMENT_LIMITS.maxBytes)throw new Error(`「${name}」超过 ${mb(ATTACHMENT_LIMITS.maxBytes)}，请压缩后再传`);
    return name;
  }
  // 地址必须是 /attachments/opportunities/<文件夹>/<文件>：恰好两段，每段解码后不是空、「.」或「..」，也不含斜杠和空字节（文件名里的「..」如 a..b.pdf 是允许的）。
  function validFileUrl(url){
    if(!url.startsWith(ATTACHMENT_LIMITS.urlPrefix)||/[?#]/.test(url))return false;
    let parts;
    try{parts=url.slice(ATTACHMENT_LIMITS.urlPrefix.length).split('/').map(decodeURIComponent);}catch{return false;}
    return parts.length===2&&parts.every(part=>part&&part!=='.'&&part!=='..'&&!/[\\/\u0000]/.test(part));
  }
  const rawAttachments=item=>Array.isArray(item?.attachments)?item.attachments:[];
  const validAttachment=entry=>entry&&typeof entry==='object'&&typeof entry.id==='string'&&entry.id&&typeof entry.fileUrl==='string'&&entry.fileUrl;
  // 读得懂的附件（界面用）；读不懂的条目在写入时原样保留。
  function attachmentsOf(item){
    return rawAttachments(item).filter(validAttachment).map(entry=>({...entry,name:trim(entry.name)||'（未命名文件）',size:Number.isFinite(Number(entry.size))&&Number(entry.size)>=0?Number(entry.size):0,type:trim(entry.type),uploadedAt:trim(entry.uploadedAt)}));
  }
  const replaceAttachments=(state,id,previous,attachments,now)=>({...state,laiOpportunities:replaceFirst(state,id,{...previous,attachments,updatedAt:now})});
  const newAttachmentId=()=>`att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
  // files：[{name,size,type,fileUrl,id?}]，文件已经传到本机存好之后才调用。
  function addAttachments(state,id,files,options={}){
    requireList(state);
    const previous=requireItem(state,id),now=options.now||new Date().toISOString();
    if(!Array.isArray(files)||!files.length)throw new Error('没有要添加的文件');
    const current=rawAttachments(previous);
    if(current.length+files.length>ATTACHMENT_LIMITS.maxCount)throw new Error(`一个商机最多 ${ATTACHMENT_LIMITS.maxCount} 个附件，现在已有 ${current.length} 个`);
    const added=files.map(file=>{
      const name=checkFile(file),fileUrl=trim(file.fileUrl);
      if(!validFileUrl(fileUrl))throw new Error(`「${name}」的存放位置无效`);
      return {id:trim(file.id)||newAttachmentId(),name,size:Number(file.size),type:trim(file.type),fileUrl,uploadedAt:now};
    });
    const taken=new Set(current.map(entry=>entry?.id));
    if(added.some(entry=>taken.has(entry.id))||new Set(added.map(entry=>entry.id)).size!==added.length)throw new Error('附件编号重复');
    return replaceAttachments(state,id,previous,[...current,...added],now);
  }
  function requireAttachment(item,attachmentId){
    const entry=rawAttachments(item).find(candidate=>validAttachment(candidate)&&candidate.id===attachmentId);
    if(!entry)throw new Error('附件不存在，可能已被删除');
    return entry;
  }
  function renameAttachment(state,id,attachmentId,value,options={}){
    requireList(state);
    const previous=requireItem(state,id);
    const entry=requireAttachment(previous,attachmentId),name=checkFile({name:value,size:Math.max(1,Number(entry.size)||1)});
    // 文件本身不会变，所以不能改扩展名（否则「预览」「类型」会和实际内容对不上）。
    if(extensionOf(name)!==extensionOf(entry.name))throw new Error('改名时不能修改文件的扩展名');
    return replaceAttachments(state,id,previous,rawAttachments(previous).map(candidate=>candidate===entry?{...candidate,name}:candidate),options.now||new Date().toISOString());
  }
  function removeAttachment(state,id,attachmentId,options={}){
    requireList(state);
    const previous=requireItem(state,id),entry=requireAttachment(previous,attachmentId);
    return replaceAttachments(state,id,previous,rawAttachments(previous).filter(candidate=>candidate!==entry),options.now||new Date().toISOString());
  }
  // 删除商机之前取出它所有附件的文件地址，保存成功后再让本机服务删文件。
  function filesOf(state,id){
    const item=list(state).find(entry=>entry.id===id);
    return rawAttachments(item).map(entry=>trim(entry?.fileUrl)).filter(url=>url.startsWith(ATTACHMENT_LIMITS.urlPrefix));
  }
  const PREVIEW_TYPES=Object.freeze({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',bmp:'image/bmp'});
  const previewKind=name=>PREVIEW_TYPES[extensionOf(name)]?'image':'';

  // ---------- 详情与手动排序 ----------
  function detailOf(state,id,today=isoDay(new Date())){
    const item=list(state).find(entry=>entry.id===id);
    if(!item)return null;
    const base=cardOf(state,id,today),flow=flowOfItem(state,item);
    const label=stageId=>flow.stages.find(stage=>stage.id===stageId);
    return {...base,flowLabel:flow.label,contact:trim(item.contact),note:trim(item.note),collaborators:Array.isArray(item.collaborators)?item.collaborators:[],
      products:Array.isArray(item.products)?item.products.filter(row=>row&&typeof row==='object'&&trim(row.name)):[],exchangeRate:item.exchangeRate,
      createdAt:trim(item.createdAt),updatedAt:trim(item.updatedAt),closedAt:trim(item.closedAt),lostNote:trim(item.lostNote),
      history:(Array.isArray(item.stageHistory)?item.stageHistory:[]).filter(entry=>entry&&typeof entry==='object').map(entry=>({stage:trim(entry.stage),label:label(trim(entry.stage))?.label||trim(entry.stage),kind:label(trim(entry.stage))?.kind||'open',at:trim(entry.at)})),
      attachments:attachmentsOf(item)};
  }
  // 把商机放到某个阶段的某张卡片之前（before 为空表示放到最后）；阶段不同时同时换阶段。
  // 只改动这一列里 sortRank 需要变的商机；其他商机的更新时间不变。
  function reorder(state,id,options={}){
    requireList(state);
    if(trim(options.before)===id)return state;
    const previous=requireItem(state,id),flow=flowOfItem(state,previous),stageId=trim(options.stage)||stageOf(state,previous).id;
    if(!flow.stages.some(stage=>stage.id===stageId))throw new Error('所选销售流程里没有这个阶段');
    let next=state;
    if(stageOf(state,previous).id!==stageId)next=moveStage(next,id,stageId,options);
    const column=list(next).filter(item=>flowOfItem(next,item).id===flow.id&&stageOf(next,item).id===stageId&&item.id!==id).map(item=>({id:item.id,sortRank:rankOf(item),createdAt:trim(item.createdAt),name:trim(item.name)}));
    const ordered=manualOrder(column).map(item=>item.id),at=options.before?ordered.indexOf(trim(options.before)):-1;
    ordered.splice(at<0?ordered.length:at,0,id);
    const rank=new Map(ordered.map((itemId,index)=>[itemId,index+1]));
    let done=new Set();
    return {...next,laiOpportunities:raw(next).map(item=>{
      if(!item||done.has(item.id)||!rank.has(item.id))return item;
      done.add(item.id);
      return item.sortRank===rank.get(item.id)?item:{...item,sortRank:rank.get(item.id)};
    })};
  }
  const api={ATTACHMENT_LIMITS,BLOCKED_EXTENSIONS,PREVIEW_TYPES,attachmentName,checkFile,attachmentsOf,addAttachments,renameAttachment,removeAttachment,filesOf,previewKind,detailOf,reorder,KIND_LABELS,currencyOf,flowsOf,flowOf,stageOf,flowSummary,addFlow,renameFlow,removeFlow,addFlowStage,renameFlowStage,moveFlowStage,removeFlowStage,STAGES,FLOWS,LOST_REASONS,SORTS,list,cardOf,customerStats,upsert,moveStage,setArchived,remove,linkOrder,board,analysis,defaults,orderDraft,customerNames,contactsOf,ownerNames,autoName,parseProducts,productsText,addDays,localDay,validDate};
  if(node)module.exports=api;else root.LaiOpportunityModel=api;
})(typeof window!=='undefined'?window:globalThis);
