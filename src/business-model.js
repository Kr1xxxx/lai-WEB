(function(root){
  'use strict';
  const stages=[['quote','报价'],['deposit','定金'],['production','生产中'],['balance','尾款'],['shipment','已发货'],['done','已完成']].map(([id,label])=>Object.freeze({id,label}));
  const buckets=['orders','trashOrders','deletedOrders'];
  const normalized=value=>String(value??'').trim().toLowerCase();
  const trim=value=>String(value??'').trim();
  const amount=value=>Number.isFinite(Number(value))?Math.max(0,Number(value)):0;
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
  function requireId(id){if(typeof id!=='string'||!id.trim())throw new Error('记录 ID 无效');}
  function numericInput(value,label){
    if(value===null||value===undefined||typeof value==='boolean'||!String(value).trim()||!Number.isFinite(Number(value))||Number(value)<0)throw new Error(`${label}必须为不小于 0 的有效数字`);
    return Number(value);
  }
  const currencyOf=order=>trim(order?.currency||'USD').toUpperCase()||'USD';
  function orderMetrics(orders=[]){
    const grouped=new Map();let count=0,activeCount=0;
    for(const order of orders){
      if(order.isDraft)continue;
      count++;if(order.stage!=='done')activeCount++;
      const currency=currencyOf(order);
      const metric=grouped.get(currency)||{currency,total:0,paid:0,due:0,count:0};
      const total=amount(order.amount),paid=['shipment','done'].includes(order.stage)?total:Math.min(total,amount(order.paidAmount));
      metric.total+=total;metric.paid+=paid;metric.due+=Math.max(0,total-paid);metric.count++;
      grouped.set(currency,metric);
    }
    return {byCurrency:[...grouped.values()],count,activeCount};
  }
  // Existing statistics rules only: drafts excluded, month = orderMonth or createdAt, currencies never converted.
  function monthlyAnalysis(orders=[],month){
    const selected=validMonth(month)?orders.filter(order=>order&&!order.isDraft&&String(order.orderMonth||order.createdAt||'').slice(0,7)===month):[];
    const stageRows=stages.map(stage=>{const count=selected.filter(order=>order.stage===stage.id).length;return {id:stage.id,label:stage.label,count,percent:Math.round(count/Math.max(1,selected.length)*100)};});
    const grouped=new Map();
    for(const order of selected){
      const currency=currencyOf(order),key=currency+'\0'+order.client;
      const row=grouped.get(key)||{client:order.client,currency,amount:0,count:0};
      row.amount+=amount(order.amount);row.count++;grouped.set(key,row);
    }
    const contributions=[...grouped.values()].sort((a,b)=>a.currency.localeCompare(b.currency)||b.amount-a.amount);
    return {month,orders:selected,stages:stageRows,contributions,metrics:orderMetrics(selected)};
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
  // 订单的产品明细：每行 {productId, code, name, model, unit, qty, price}。名称、数量、单价都要有；全空的行直接忽略。
  const LINE_LIMIT=200,money2=value=>Math.round(value*100)/100;
  function normalizeLines(list){
    if(!Array.isArray(list))throw new Error('产品明细格式不对');
    const out=[];
    list.forEach((raw,index)=>{
      const row=raw&&typeof raw==='object'?raw:{};
      const name=trim(row.name),qtyText=trim(row.qty),priceText=trim(row.price);
      if(!name&&!qtyText&&!priceText)return;
      const where=`第 ${index+1} 行`;
      if(!name)throw new Error(`${where}请填写产品名称`);
      const qty=qtyText===''?1:Number(qtyText),price=priceText===''?0:Number(priceText);
      if(!Number.isFinite(qty)||qty<=0)throw new Error(`${where}数量必须大于 0`);
      if(!Number.isFinite(price)||price<0)throw new Error(`${where}单价必须为不小于 0 的有效数字`);
      out.push({productId:trim(row.productId),code:trim(row.code),name,model:trim(row.model),unit:trim(row.unit),qty,price});
    });
    if(out.length>LINE_LIMIT)throw new Error(`产品明细最多 ${LINE_LIMIT} 行`);
    return out;
  }
  const linesTotal=lines=>money2((lines||[]).reduce((sum,line)=>sum+amount(line.qty)*amount(line.price),0));
  const linesSummary=lines=>{
    const names=lines.map(line=>line.name);
    return names.length<=2?names.join('、'):`${names.slice(0,2).join('、')} 等 ${names.length} 项`;
  };
  function upsertOrder(state,id,input){
    requireId(id);
    const orders=state.orders||[],previous=orders.find(order=>order.id===id);
    const next={...(previous||{}),id};
    const textFields=['num','client','country','currency','stage','createdAt','orderMonth','productType','owner','trackingNumber','carrier','note','next'];
    for(const field of textFields)if(Object.hasOwn(input,field))next[field]=trim(input[field]);
    if(!next.num)throw new Error('请输入订单号');
    if(!next.client)throw new Error('请输入客户名称');
    if(next.client==='__proto__')throw new Error('该客户名称为系统保留名称');
    if(Object.hasOwn(input,'lines'))next.lines=normalizeLines(input.lines);
    if(Array.isArray(next.lines)&&next.lines.length){
      // 有产品明细时，订单金额和产品文字由明细算出，不再手填。
      next.amount=linesTotal(next.lines);
      next.productType=linesSummary(next.lines);
    }else{
      delete next.lines;
      next.amount=numericInput(Object.hasOwn(input,'amount')?input.amount:next.amount,'订单金额');
    }
    next.paidAmount=numericInput(Object.hasOwn(input,'paidAmount')?input.paidAmount:(next.paidAmount??0),'已收款');
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
    if(!Object.hasOwn(customers,next.client))customers[next.client]={client:next.client,country:next.country||'',owner:next.owner||''};
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
    const restored={...order};delete restored.trashedAt;
    return {...state,orders:[restored,...(state.orders||[])],trashOrders:state.trashOrders.filter(item=>item.id!==id)};
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
  const api={stages,localDate,normalizeLines,linesTotal,linesSummary,orderMetrics,monthlyAnalysis,upsertOrder,archiveOrder,restoreOrder,calendarEvents,setTask};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LaiBusinessModel=api;
})(typeof window!=='undefined'?window:globalThis);
