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
  const customerKey=name=>trim(name).normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();
  function requireId(id){if(typeof id!=='string'||!id.trim())throw new Error('找不到这条记录');}
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
        if(order.id===id)throw new Error('这个订单已经存在');
        if(normalized(order.num)===normalized(num))throw new Error('订单号已存在（包含垃圾箱或已删除订单），请使用其他订单号');
      }
    }
  }
  // 订单产品明细 order.items：[{productId, code, name, model, unit, qty, price}]，从产品库选，存在订单里（产品改了不影响已有订单）。
  // 有明细时，订单金额＝明细合计，订单的“产品”一栏＝明细里的产品名称。
  const ITEM_LIMIT=200;
  const round2=value=>Math.round(value*100)/100;
  function cleanItems(list){
    if(!Array.isArray(list))throw new Error('产品明细格式无效');
    if(list.length>ITEM_LIMIT)throw new Error(`一笔订单最多 ${ITEM_LIMIT} 个产品`);
    return list.map((item,index)=>{
      const name=trim(item&&item.name);
      if(!name)throw new Error(`产品明细第 ${index+1} 行还没选产品`);
      const qty=numericInput(item.qty,`「${name}」的数量`);
      if(qty<=0)throw new Error(`「${name}」的数量要大于 0`);
      const price=numericInput(item.price,`「${name}」的单价`);
      return {productId:trim(item.productId),code:trim(item.code),name,model:trim(item.model),unit:trim(item.unit),qty,price};
    });
  }
  const itemsTotal=items=>round2((Array.isArray(items)?items:[]).reduce((sum,item)=>sum+amount(item&&item.qty)*amount(item&&item.price),0));
  const itemsSummary=items=>[...new Set((Array.isArray(items)?items:[]).map(item=>trim(item&&item.name)).filter(Boolean))].join('、');
  // 从产品库的一个产品得到一行明细：单价默认取离岸价。
  function itemFromProduct(product,qty=1){
    const fob=Number(String(product&&product.fob||'').replace(/,/g,''));
    return {productId:trim(product&&product.id),code:trim(product&&product.code),name:trim(product&&product.name),model:trim(product&&product.model),unit:trim(product&&product.unit),qty,price:Number.isFinite(fob)&&fob>0?fob:0};
  }
  // 名称和产品库里某个产品完全一样、又还没关联的明细，补上产品编号、型号和单位（例如由商机带过来的产品）。
  function linkItems(items,products){
    const list=Array.isArray(products)?products:[];
    return (Array.isArray(items)?items:[]).map(item=>{
      if(trim(item.productId))return item;
      const match=list.find(product=>trim(product.name)===trim(item.name));
      return match?{...itemFromProduct(match,item.qty),price:item.price}:item;
    });
  }
  // 生成报价单、形式发票等单据用的明细：有产品明细就逐行列出；没有就把整笔订单当一行（产品栏文字，数量 1，单价＝订单金额）。
  function docLines(order){
    const items=Array.isArray(order&&order.items)?order.items.filter(item=>trim(item&&item.name)):[];
    if(items.length)return items.map(item=>({code:trim(item.code),name:trim(item.name),model:trim(item.model),unit:trim(item.unit),qty:amount(item.qty),price:amount(item.price)}));
    return [{code:'',name:trim(order&&order.productType)||'订单货款',model:'',unit:'',qty:1,price:amount(order&&order.amount)}];
  }
  function upsertOrder(state,id,input){
    requireId(id);
    const orders=state.orders||[],previous=orders.find(order=>order.id===id);
    const next={...(previous||{}),id};
    const textFields=['num','client','country','currency','stage','createdAt','orderMonth','productType','owner','trackingNumber','carrier','note','next'];
    for(const field of textFields)if(Object.hasOwn(input,field))next[field]=trim(input[field]);
    if(!next.num)throw new Error('请输入订单号');
    if(!next.client)throw new Error('请输入客户名称');
    if(next.client==='__proto__')throw new Error('该客户名称为系统保留名称');
    if(Object.hasOwn(input,'items'))next.items=cleanItems(input.items);
    if(Array.isArray(next.items)&&next.items.length){
      next.amount=itemsTotal(next.items);
      next.productType=itemsSummary(next.items);
    }else next.amount=numericInput(Object.hasOwn(input,'amount')?input.amount:next.amount,'订单金额');
    next.paidAmount=numericInput(Object.hasOwn(input,'paidAmount')?input.paidAmount:(next.paidAmount??0),'已收款');
    if(next.paidAmount>next.amount)throw new Error('已收款不能超过订单金额');
    next.currency=trim(next.currency||'USD').toUpperCase();
    if(!/^[A-Z]{3}$/.test(next.currency))throw new Error('请填写三位币种代码');
    // 汇率快照：新订单或改了币种时，记下汇率设置里这个币种当时的汇率（每 100 外币折合美元）；以后改汇率不影响这笔订单。
    // 美元、或还没设置汇率的币种不记；改了币种又没有新汇率时，去掉旧币种的汇率。
    if(!previous||trim(previous.currency||'USD').toUpperCase()!==next.currency){
      const RT=root.LaiRateModel||(typeof module!=='undefined'&&module.exports?require('./rate-model.js'):null);
      const rate=next.currency==='USD'||!RT?null:RT.rateFor(state,next.currency);
      if(rate!==null)next.usdRate=rate;else delete next.usdRate;
    }
    next.stage=next.stage||'quote';
    if(!stages.some(stage=>stage.id===next.stage))throw new Error('请选择有效订单阶段');
    if(Object.hasOwn(input,'isDraft')&&typeof input.isDraft!=='boolean')throw new Error('草稿状态无效');
    next.isDraft=Object.hasOwn(input,'isDraft')?input.isDraft:previous?.isDraft===true;
    if(!Object.hasOwn(input,'createdAt')&&!next.createdAt)next.createdAt=localDate();
    if(!datePart(next.createdAt))throw new Error('订单日期无效');
    if(!Object.hasOwn(input,'orderMonth')){
      const oldMonth=previous?datePart(previous.createdAt).slice(0,7):'';
      // 订单月份原来跟着创建日期走（或没填）时，改创建日期就一起改月份；手动改过的月份不动。
      if(!next.orderMonth||(Object.hasOwn(input,'createdAt')&&(!previous?.orderMonth||previous.orderMonth===oldMonth)))next.orderMonth=datePart(next.createdAt).slice(0,7);
    }
    if(!validMonth(next.orderMonth))throw new Error('订单月份无效');
    assertUnique(state,id,next.num,previous?'orders':undefined);
    const customers={...(state.customers||{})};
    const clientKey=customerKey(next.client);
    // 回收站里的客户：只拦新订单和改到这个客户名下的订单，原有订单照常能改。
    const sameClient=Boolean(previous)&&customerKey(previous.client)===clientKey;
    const existing=Object.keys(customers).find(name=>customerKey(name)===clientKey);
    if(existing!==undefined){
      if(!sameClient&&customers[existing]&&customers[existing].laiBucket==='trash')throw new Error('客户在回收站里，请先恢复');
      next.client=existing;
    }else{
      // 只在订单里出现过的客户（没有客户档案）也算已有客户，沿用订单里的写法。
      const known=[...orders,...(state.trashOrders||[]),...(state.deletedOrders||[])].map(order=>order&&order.client).find(name=>typeof name==='string'&&name&&customerKey(name)===clientKey);
      if(known!==undefined)next.client=known;
      customers[next.client]={client:next.client,country:next.country||'',owner:next.owner||''};
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
    for(const task of state.laiTasks||[])add(task.date,{title:task.title||'',kind:'task',id:task.id,customer:task.customer||'',owner:taskOwner(state,task)});
    return events.sort((a,b)=>a.date.localeCompare(b.date)||a.kind.localeCompare(b.kind)||String(a.id).localeCompare(String(b.id)));
  }
  // 待办属于一个人（D-022）。负责人：任务自己的 owner；老任务没有 owner 时，跟着所关联客户的跟进人；都没有就是空（未分配）。
  function taskOwner(state,task){
    const own=trim(task&&task.owner);
    if(own)return own;
    const customers=(state&&state.customers)||{};
    const name=trim(task&&task.customer);
    return name&&Object.hasOwn(customers,name)?trim(customers[name]&&customers[name].owner):'';
  }
  // 当前账号看得到的待办。sees(owner)＝角色模型的 canSee：全公司看全部（含未分配），本人／本部门只看负责人在范围内的，未分配的不看。
  function visibleTasks(state,sees){
    const list=state&&state.laiTasks;
    if(!Array.isArray(list)||typeof sees!=='function')return list;
    return list.filter(task=>task&&typeof task==='object'&&sees(taskOwner(state,task)));
  }
  // 自己没有负责人的未完成待办（老数据）。管理员在日历上看到“有 N 条待办没有负责人”。
  function unassignedTasks(state){
    return (Array.isArray(state&&state.laiTasks)?state.laiTasks:[]).filter(task=>task&&typeof task==='object'&&!trim(task.owner)&&task.done!==true);
  }
  // opts（可选）：{me:当前账号名, canReassign:能不能改负责人, members:可选的成员名}。
  // 带 me 时：新待办的负责人默认是 me；只有 canReassign 才能指定别人或改负责人，其他人传来的 owner 一律忽略。
  // 不带 me 时（只改完成状态等）：不碰负责人。
  function setTask(state,id,input,opts={}){
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
    const me=trim(opts&&opts.me),wanted=trim(input&&input.owner);
    if(me&&!previous&&!(opts.canReassign&&wanted))next.owner=me;
    if(opts&&opts.canReassign&&wanted&&wanted.toLowerCase()!==trim(previous&&previous.owner).toLowerCase()){
      if(Array.isArray(opts.members)){
        const hit=opts.members.find(name=>trim(name).toLowerCase()===wanted.toLowerCase());
        if(!hit)throw new Error('请选择有效的负责人');
        next.owner=trim(hit);
      }else next.owner=wanted;
    }
    return {...state,laiTasks:previous?state.laiTasks.map(task=>task.id===id?next:task):[next,...(state.laiTasks||[])]};
  }
  // 建议的新订单号：前缀＋日期＋三位序号。序号取现有订单、回收站、已删除订单里同前缀同日期的最大序号加 1，并保证整个库里没人用过。
  function nextOrderNumber(state,prefix,date){
    const base=`${trim(prefix)||'L'}${trim(date||localDate()).replaceAll('-','')}-`,head=base.toLowerCase();
    const used=new Set();let max=0;
    for(const bucket of buckets)for(const order of (state&&state[bucket])||[]){
      const num=normalized(order&&order.num);
      if(!num)continue;
      used.add(num);
      if(num.startsWith(head)&&/^\d+$/.test(num.slice(head.length)))max=Math.max(max,Number(num.slice(head.length)));
    }
    let seq=max+1,next=base+String(seq).padStart(3,'0');
    while(used.has(next.toLowerCase())){seq++;next=base+String(seq).padStart(3,'0');}
    return next;
  }
  const api={stages,localDate,orderMetrics,monthlyAnalysis,ITEM_LIMIT,cleanItems,itemsTotal,itemsSummary,itemFromProduct,linkItems,docLines,upsertOrder,nextOrderNumber,archiveOrder,restoreOrder,calendarEvents,setTask,taskOwner,visibleTasks,unassignedTasks};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LaiBusinessModel=api;
})(typeof window!=='undefined'?window:globalThis);
