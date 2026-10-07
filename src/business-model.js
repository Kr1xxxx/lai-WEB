(function(root){
  'use strict';
  const stages=[['quote','报价'],['deposit','定金'],['production','生产中'],['balance','尾款'],['shipment','已发货'],['done','已完成']].map(([id,label])=>Object.freeze({id,label}));
  const buckets=['orders','trashOrders','deletedOrders'];
  const normalized=value=>String(value??'').trim().toLowerCase();
  const trim=value=>String(value??'').trim();
  // Monetary values use cents; missing or malformed legacy data is not evidence of a payment.
  function moneyValue(value){
    if(!['number','string'].includes(typeof value)||!String(value).trim())return null;
    const n=Number(value);
    if(!Number.isFinite(n)||n<0||n>Number.MAX_SAFE_INTEGER/100)return null;
    const [mantissa,exponent='0']=String(n).split('e');
    return Math.round(Number(`${mantissa}e${Number(exponent)+2}`))/100;
  }
  const addMoney=(a,b)=>Math.round(a*100+b*100)/100;
  const formal=order=>order&&typeof order==='object'&&!order.isDraft&&!order.trashedAt&&!order.deletedAt&&order.archived!==true;
  function statisticalMonth(order){const explicit=trim(order?.orderMonth);return validMonth(explicit)?explicit:datePart(order?.createdAt).slice(0,7);}
  function orderPayment(order={}){
    const totalValue=moneyValue(order.amount),paidValue=moneyValue(order.paidAmount);
    const total=totalValue??0,paid=paidValue??0;
    return {total,paid,due:Math.max(0,Math.round(total*100-paid*100)/100),paidRecorded:paidValue!==null,amountRecorded:totalValue!==null,overpaid:totalValue!==null&&paid>total};
  }
  const localDate=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  function validMonth(value){return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value||''));}
  function datePart(value){
    const source=trim(value),match=source.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/);
    if(!match)return '';
    const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
    const parsed=new Date(0);parsed.setUTCFullYear(year,month-1,day);parsed.setUTCHours(0,0,0,0);
    if(year<1||parsed.getUTCFullYear()!==year||parsed.getUTCMonth()!==month-1||parsed.getUTCDate()!==day)return '';
    if(source.length>10&&!Number.isFinite(Date.parse(source.replace(' ','T'))))return '';
    return match[0].slice(0,10);
  }
  const ruleObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  function orderNumberRuleDraft(state={}){
    const settings=state.laiSettings||{},saved=settings.orderNumberRule;
    if(Object.hasOwn(settings,'orderNumberRule')&&!ruleObject(saved))return saved;
    return {prefix:settings.orderPrefix||state.orderSettings?.orderPrefix||'L',dateFormat:'YYYYMMDD',sequenceDigits:3,...saved};
  }
  function validateOrderNumberRule(rule){
    if(!ruleObject(rule))throw new Error('已保存的订单编号规则格式无效，请在设置中核对并保存规则');
    if(typeof rule.prefix!=='string'||!/^[A-Za-z0-9-]{1,12}$/.test(rule.prefix.trim()))throw new Error('编号前缀须为 1–12 位英文字母、数字或连字符');
    if(!['YYYYMMDD','YYYYMM','YYYY','none'].includes(rule.dateFormat))throw new Error('请选择有效的编号日期格式');
    if(![3,4,5,6,'3','4','5','6'].includes(rule.sequenceDigits))throw new Error('流水号最少位数须为 3、4、5 或 6');
    return {prefix:rule.prefix.trim(),dateFormat:rule.dateFormat,sequenceDigits:Number(rule.sequenceDigits)};
  }
  function orderNumberRule(state={}){return validateOrderNumberRule(orderNumberRuleDraft(state));}
  function orderNumberPrefix(rule,day){
    if(typeof day!=='string'||day.length!==10||datePart(day)!==day)throw new Error('编号生成日期无效');
    const date=rule.dateFormat==='none'?'':day.replaceAll('-','').slice(0,rule.dateFormat.length);
    return rule.prefix+date+'-';
  }
  function orderNumberPreview(rule,day=localDate(),sequence=1){
    const valid=validateOrderNumberRule(rule),prefix=orderNumberPrefix(valid,day);
    if(!Number.isSafeInteger(sequence)||sequence<1)throw new Error('编号序号超出安全范围，请核对');
    return prefix+String(sequence).padStart(valid.sequenceDigits,'0');
  }
  function nextOrderNumber(state={},day=localDate()){
    const rule=orderNumberRule(state),prefix=orderNumberPrefix(rule,day),matchPrefix=normalized(prefix);
    let maximum=0;
    for(const bucket of buckets)for(const order of Array.isArray(state[bucket])?state[bucket]:[]){
      const number=normalized(order?.num);
      if(!number.startsWith(matchPrefix))continue;
      const suffix=number.slice(matchPrefix.length);
      if(!/^\d+$/.test(suffix))continue;
      const sequence=Number(suffix);
      if(!Number.isSafeInteger(sequence))throw new Error('已有编号序号超出安全范围，请先核对');
      maximum=Math.max(maximum,sequence);
    }
    return orderNumberPreview(rule,day,maximum+1);
  }
  function setOrderNumberRule(state,input){
    const rule=validateOrderNumberRule(input),settings=state.laiSettings||{},previous=settings.orderNumberRule;
    return {...state,laiSettings:{...settings,orderNumberRule:{...(ruleObject(previous)?previous:{}),...rule}}};
  }
  function requireId(id){if(typeof id!=='string'||!id.trim())throw new Error('记录 ID 无效');}
  function numericInput(value,label){
    if(value===null||value===undefined||typeof value==='boolean'||!String(value).trim()||!Number.isFinite(Number(value))||Number(value)<0)throw new Error(`${label}必须为不小于 0 的有效数字`);
    const rounded=moneyValue(value);if(rounded===null)throw new Error(`${label}超出可精确保存的金额范围`);return rounded;
  }
  const currencyOf=order=>trim(order?.currency||'USD').toUpperCase()||'USD';
  function orderMetrics(orders=[]){
    const grouped=new Map();let count=0,activeCount=0,unknownPaidCount=0,unknownAmountCount=0,overpaidCount=0;
    for(const order of orders){
      if(!formal(order))continue;
      count++;if(order.stage!=='done')activeCount++;
      const currency=currencyOf(order),p=orderPayment(order);
      const metric=grouped.get(currency)||{currency,total:0,paid:0,due:0,count:0,unknownPaidCount:0,unknownAmountCount:0,overpaidCount:0};
      for(const field of ['total','paid','due'])metric[field]=addMoney(metric[field],p[field]);
      metric.count++;
      if(!p.paidRecorded){metric.unknownPaidCount++;unknownPaidCount++;}
      if(!p.amountRecorded){metric.unknownAmountCount++;unknownAmountCount++;}
      if(p.overpaid){metric.overpaidCount++;overpaidCount++;}
      grouped.set(currency,metric);
    }
    return {byCurrency:[...grouped.values()],count,activeCount,unknownPaidCount,unknownAmountCount,overpaidCount};
  }
  // Statistical month is explicit when present; no historical month is silently migrated.
  function monthlyAnalysis(orders=[],month,filters={}){
    const dimensions=['client','country','owner','stage','currency','productType'];
    const selected=validMonth(month)?orders.filter(order=>formal(order)&&statisticalMonth(order)===month&&dimensions.every(field=>!filters[field]||(field==='currency'?currencyOf(order):trim(order[field])||'未填写')===filters[field])):[];
    const stageRows=stages.map(stage=>{const count=selected.filter(order=>order.stage===stage.id).length;return {id:stage.id,label:stage.label,count,percent:Math.round(count/Math.max(1,selected.length)*100)};});
    const groupBy=field=>{
      const grouped=new Map();
      for(const order of selected){const value=trim(order[field])||'未填写',currency=currencyOf(order),key=currency+'\0'+value;
        const row=grouped.get(key)||{label:value,[field]:value,currency,amount:0,paid:0,due:0,count:0,unknownPaidCount:0,unknownAmountCount:0,overpaidCount:0};
        const p=orderPayment(order);row.amount=addMoney(row.amount,p.total);row.paid=addMoney(row.paid,p.paid);row.due=addMoney(row.due,p.due);row.count++;if(!p.paidRecorded)row.unknownPaidCount++;if(!p.amountRecorded)row.unknownAmountCount++;if(p.overpaid)row.overpaidCount++;
        grouped.set(key,row);
      }
      return [...grouped.values()].sort((a,b)=>a.currency.localeCompare(b.currency)||b.amount-a.amount);
    };
    return {month,orders:selected,stages:stageRows,contributions:groupBy('client'),countries:groupBy('country'),owners:groupBy('owner'),products:groupBy('productType'),metrics:orderMetrics(selected)};
  }
  function assertUnique(state,id,num,excludeBucket){
    for(const bucket of buckets){
      for(const order of state[bucket]||[]){
        if(bucket===excludeBucket&&order.id===id)continue;
        if(order.id===id)throw new Error('订单 ID 已存在于其他记录中');
        if(normalized(order.num)===normalized(num))throw new Error('订单号已存在（包含垃圾箱或已删除订单），请使用其他订单号');
      }
    }
  }
  // Keep both directions of an existing relationship on the same customer. The
  // override is the opportunity being edited or linked, not a data migration.
  function assertOrderCustomer(state,order,opportunityOverride){
    const firstById=new Map();
    for(const item of Array.isArray(state.laiOpportunities)?state.laiOpportunities:[])
      if(item&&typeof item.id==='string'&&item.id&&!firstById.has(item.id))firstById.set(item.id,item);
    if(opportunityOverride)firstById.set(opportunityOverride.id,opportunityOverride);
    const source=trim(order.sourceOpportunityId);
    const linked=[...firstById.values()].filter(item=>item.id===source||item.orderId===order.id||item===opportunityOverride);
    if(!linked.length)return;
    if(linked.length>1||source&&linked.some(item=>item.id!==source))throw new Error('订单商机关联不一致，请先核对关联，未保存');
    const model=root.PreviewModel||(typeof require==='function'?require('./model.js'):null),key=model.customerNameKey;
    if(!trim(order.client)||linked.some(item=>!trim(item.client)||key(item.client)!==key(order.client)))
      throw new Error('订单与关联商机的客户不一致，请先核对或解除关联，不能单独更改客户');
    if(Object.keys(state.customers||{}).filter(name=>key(name)===key(order.client)).length>1)
      throw new Error('存在多个等价客户名称，请先核对关联客户，未保存');
  }
  function upsertOrder(state,id,input){
    requireId(id);
    const orders=state.orders||[],previous=orders.find(order=>order.id===id);
    const next={...(previous||{}),id};
    const textFields=['num','client','country','currency','stage','createdAt','orderMonth','productType','owner','trackingNumber','carrier','note','next','contact','source','sourceOpportunityId'];
    for(const field of textFields)if(Object.hasOwn(input,field))next[field]=trim(input[field]);
    if(!next.num)throw new Error('请输入订单号');
    if(!next.client)throw new Error('请输入客户名称');
    if(next.client==='__proto__')throw new Error('该客户名称为系统保留名称');
    next.amount=numericInput(Object.hasOwn(input,'amount')?input.amount:next.amount,'订单金额');
    const paidInput=Object.hasOwn(input,'paidAmount')?input.paidAmount:next.paidAmount;
    next.paidAmount=paidInput===undefined||paidInput===null||(typeof paidInput==='string'&&!paidInput.trim())?null:numericInput(paidInput,'已收款');
    if(Object.hasOwn(input,'products')){
      const O=root.LaiOpportunityModel||(typeof require==='function'?require('./opportunity-model.js'):null);
      next.products=previous&&(input.products===previous.products||(typeof input.products==='string'&&input.products.trim()===O.productsText(previous.products)))?previous.products:O.parseProducts(input.products);
    }
    if(Object.hasOwn(input,'stage'))delete next.orderStageNeedsConfirmation;
    if(next.paidAmount>next.amount)throw new Error('已收款不能超过订单金额');
    next.currency=trim(next.currency||'USD').toUpperCase();
    if(!/^[A-Z]{3}$/.test(next.currency))throw new Error('请填写三位币种代码');
    next.stage=next.stage||'quote';
    if(!stages.some(stage=>stage.id===next.stage))throw new Error('请选择有效订单阶段');
    if(Object.hasOwn(input,'isDraft')&&typeof input.isDraft!=='boolean')throw new Error('草稿状态无效');
    next.isDraft=Object.hasOwn(input,'isDraft')?input.isDraft:previous?.isDraft===true;
    if(!Object.hasOwn(input,'createdAt')&&!next.createdAt)next.createdAt=localDate();
    if(!datePart(next.createdAt))throw new Error('订单日期无效');
    if(!Object.hasOwn(input,'orderMonth')&&!next.orderMonth)next.orderMonth=datePart(next.createdAt).slice(0,7);
    if(!validMonth(next.orderMonth))throw new Error('订单月份无效');
    assertUnique(state,id,next.num,previous?'orders':undefined);
    const customers={...(state.customers||{})};
    const key=root.PreviewModel?.customerNameKey || (typeof require==='function' ? require('./model.js').customerNameKey : null);
    const known=[...new Set([...Object.keys(customers),...buckets.flatMap(bucket=>(state[bucket]||[]).map(order=>order.client).filter(Boolean))])];
    const matches=known.filter(name=>key(name)===key(next.client));
    if(matches.length>1)throw new Error('存在多个等价客户名称，请先核对客户资料，订单未保存');
    if(matches.length===1)next.client=matches[0];
    if(previous?.sourceOpportunityId&&previous.sourceOpportunityId!==next.sourceOpportunityId)
      assertOrderCustomer(state,{...next,sourceOpportunityId:previous.sourceOpportunityId});
    assertOrderCustomer(state,next);
    if(!Object.hasOwn(customers,next.client))customers[next.client]={client:next.client,country:next.country||'',owner:next.owner||''};
    const before=previous?orderPayment(previous):null,after=orderPayment(next);
    if(!previous||previous.stage!==next.stage||before.paid!==after.paid||before.paidRecorded!==after.paidRecorded||previous.currency!==next.currency){
      const receipt=(p,currency=next.currency)=>p.paidRecorded?`${p.paid} ${currency}`:'未记录';
      const changes=!previous?`新建订单 ${next.num}，阶段：${stages.find(s=>s.id===next.stage)?.label}，实收：${receipt(after)}`:
        `订单 ${next.num}：${previous.stage!==next.stage?`阶段 ${stages.find(s=>s.id===previous.stage)?.label||previous.stage} → ${stages.find(s=>s.id===next.stage)?.label}；`:''}${before.paid!==after.paid||before.paidRecorded!==after.paidRecorded||previous.currency!==next.currency?`实收 ${receipt(before,previous.currency||'USD')} → ${receipt(after)}`:''}`;
      const profile=customers[next.client];
      customers[next.client]={...profile,history:[{type:'order',time:new Date().toISOString(),text:changes,orderId:id},...(Array.isArray(profile.history)?profile.history:[])]};
    }
    return {...state,customers,orders:previous?orders.map(order=>order.id===id?next:order):[next,...orders]};
  }
  function archiveOrder(state,id,now=new Date().toISOString()){
    const order=(state.orders||[]).find(item=>item.id===id);
    if(!order)throw new Error('订单不存在');
    if(!datePart(now))throw new Error('归档日期无效');
    assertUnique(state,id,order.num,'orders');
    return {...state,orders:state.orders.filter(item=>item.id!==id),trashOrders:[{...order,trashedAt:now},...(state.trashOrders||[])]};
  }
  function restoreOrder(state,id){
    const order=(state.trashOrders||[]).find(item=>item.id===id);
    if(!order)throw new Error('垃圾箱订单不存在');
    assertUnique(state,id,order.num,'trashOrders');
    const opportunities=Array.isArray(state.laiOpportunities)?state.laiOpportunities:[];
    const sources=new Set([order.sourceOpportunityId,...opportunities.filter(item=>item?.orderId===id).map(item=>item.id)].filter(Boolean));
    if(sources.size>1)throw new Error('订单商机关联不一致，请先核对，暂不能恢复');
    const source=[...sources][0];
    const linkedIds=new Set(opportunities.filter(item=>source&&item?.id===source).map(item=>item.orderId).filter(Boolean));
    const conflict=source&&(state.orders||[]).find(item=>item.sourceOpportunityId===source||linkedIds.has(item.id));
    if(conflict)throw new Error(`同一商机已有有效订单「${conflict.num||conflict.id}」，请先核对并将不保留的订单移入回收站，再恢复此订单`);
    const restored={...order};delete restored.trashedAt;
    if(source)restored.sourceOpportunityId=source;
    assertOrderCustomer(state,restored);
    const next={...state,orders:[restored,...(state.orders||[])],trashOrders:state.trashOrders.filter(item=>item.id!==id)};
    if(source&&Array.isArray(state.laiOpportunities)){
      let linked=false;
      next.laiOpportunities=opportunities.map(item=>{
        if(!linked&&item?.id===source){linked=true;return {...item,orderId:id};}
        return item;
      });
    }
    return next;
  }
  function archivedCustomer(state,name,profile){
    if(profile.laiBucket==='trash'||profile.trashedAt||profile.deletedAt||profile.archived===true)return true;
    for(const bucket of ['trashCustomers','deletedCustomers']){
      const value=state[bucket];
      if(Array.isArray(value)&&value.some(item=>typeof item==='string'?item===name:item?.name===name||item?.client===name))return true;
      if(value&&!Array.isArray(value)&&typeof value==='object'&&Object.hasOwn(value,name))return true;
    }
    return false;
  }
  function calendarEvents(state,month){
    if(!validMonth(month))throw new Error('请选择有效月份');
    const events=[];
    const add=(value,event)=>{const date=datePart(value);if(date&&date.startsWith(`${month}-`))events.push({date,...event});};
    for(const order of state.orders||[])add(order.createdAt,{title:`订单 ${order.num||''}`,kind:'order',id:order.id,customer:order.client||''});
    for(const [name,profile]of Object.entries(state.customers||{})){
      if(!profile||archivedCustomer(state,name,profile))continue;
      add(profile.nextFollow,{title:`跟进 ${name}`,kind:'followup',id:name,customer:name});
    }
    for(const task of state.laiTasks||[])add(task.date,{title:task.title||'',kind:'task',id:task.id,customer:task.customer||''});
    return events.sort((a,b)=>a.date.localeCompare(b.date)||a.kind.localeCompare(b.kind)||String(a.id).localeCompare(String(b.id)));
  }
  function setTask(state,id,input){
    requireId(id);
    const previous=(state.laiTasks||[]).find(task=>task.id===id);
    const next={...(previous||{}),id};
    if(Object.hasOwn(input,'title'))next.title=trim(input.title);
    if(!next.title)throw new Error('请输入任务名称');
    if(Object.hasOwn(input,'date'))next.date=trim(input.date);
    if(!datePart(next.date)||next.date.length!==10)throw new Error('请选择有效任务日期');
    if(Object.hasOwn(input,'done'))next.done=input.done;
    else if(!previous)next.done=false;
    if(typeof next.done!=='boolean')throw new Error('任务完成状态无效');
    return {...state,laiTasks:previous?state.laiTasks.map(task=>task.id===id?next:task):[next,...(state.laiTasks||[])]};
  }
  const api={stages,localDate,orderNumberRuleDraft,orderNumberRule,orderNumberPreview,nextOrderNumber,setOrderNumberRule,assertOrderCustomer,orderPayment,statisticalMonth,orderMetrics,monthlyAnalysis,upsertOrder,archiveOrder,restoreOrder,calendarEvents,setTask};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LaiBusinessModel=api;
})(typeof window!=='undefined'?window:globalThis);
