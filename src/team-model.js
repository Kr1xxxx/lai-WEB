(function(root){
  'use strict';
  // 团队数据：只用来财现有的客户、跟进、任务、订单数据，沿用现有统计口径，按「跟进人」名称汇总。
  // 跟进人只是文字，不是真实员工账号；没填的归入「未分配」。回收站客户不计入客户、跟进统计。
  const node=typeof module!=='undefined'&&module.exports;
  const PM=node?require('./model.js'):root.PreviewModel;
  const LM=node?require('./modules.js'):root.LaiModules;
  const BM=node?require('./business-model.js'):root.LaiBusinessModel;
  const trim=value=>String(value??'').trim();
  const validMonth=value=>/^\d{4}-(0[1-9]|1[0-2])$/.test(String(value||''));
  const TREND_MONTHS=6;
  // 日期按本地日历月归属：只有日期的字符串直接取月份，带时间的先转成本地时间（与客户详情、客群一致）。
  function monthOf(value){
    const source=trim(value);
    if(!/^\d{4}-\d{2}-\d{2}/.test(source))return '';
    if(/^\d{4}-\d{2}-\d{2}$/.test(source))return validMonth(source.slice(0,7))?source.slice(0,7):'';
    const parsed=new Date(source.replace(' ','T'));
    if(!Number.isFinite(parsed.getTime()))return '';
    return `${parsed.getFullYear()}-${String(parsed.getMonth()+1).padStart(2,'0')}`;
  }
  function monthsEnding(month,count=TREND_MONTHS){
    let year=Number(month.slice(0,4)),number=Number(month.slice(5,7))-(count-1);
    const months=[];
    while(number<1){number+=12;year--;}
    for(let i=0;i<count;i++){
      months.push(`${String(year).padStart(4,'0')}-${String(number).padStart(2,'0')}`);
      if(++number>12){number=1;year++;}
    }
    return months;
  }
  // 统计周期：月份 YYYY-MM，或自然季度 YYYY-Qn（1–3 月为 Q1，以此类推）。
  const validQuarter=value=>/^\d{4}-Q[1-4]$/.test(String(value||''));
  const validPeriod=value=>validMonth(value)||validQuarter(value);
  function periodMonths(period){
    if(validMonth(period))return [period];
    if(!validQuarter(period))throw new Error('请选择有效月份');
    const first=(Number(period.slice(6))-1)*3+1;
    return [0,1,2].map(offset=>`${period.slice(0,4)}-${String(first+offset).padStart(2,'0')}`);
  }
  const quarterOf=month=>`${month.slice(0,4)}-Q${Math.ceil(Number(month.slice(5,7))/3)}`;
  const periodLabel=period=>validQuarter(period)?`${period.slice(0,4)} 年第 ${period.slice(6)} 季度`:`${period.slice(0,4)} 年 ${Number(period.slice(5,7))} 月`;
  const day=value=>trim(value).slice(0,10);
  const snippet=value=>{const text=trim(value).replace(/\s+/g,' ');return text.length>60?text.slice(0,60)+'…':text;};

  function customerRows(state){
    return PM.buildCustomers(state).map(row=>({
      name:row.name,owner:trim(row.owner),bucket:LM.bucket(state.customers?.[row.name]),
      createdAt:row.createdAt,source:trim(row.source),history:Array.isArray(row.history)?row.history:[]
    }));
  }
  const customerItem=(row,meta='')=>({kind:'customer',title:row.name,meta,customer:row.name});
  const byLabel=(a,b)=>a.label.localeCompare(b.label,'zh');

  // entries: {col, owner, item, distinct?}；distinct 相同的只算一次（按行、按合计分别去重）。
  function tabulate(columns,entries,knownOwners=[]){
    const rows=new Map();
    const rowFor=owner=>{
      if(!rows.has(owner))rows.set(owner,{owner,label:owner||'未分配',cells:{}});
      return rows.get(owner);
    };
    const add=(cells,entry)=>{
      const cell=cells[entry.col]||(cells[entry.col]={value:0,items:[],seen:new Set()});
      if(entry.distinct!==undefined){if(cell.seen.has(entry.distinct))return;cell.seen.add(entry.distinct);}
      cell.value++;cell.items.push(entry.item);
    };
    for(const owner of knownOwners)rowFor(owner);
    const totalCells={};
    for(const entry of entries){add(rowFor(entry.owner).cells,entry);add(totalCells,entry);}
    const finish=cells=>{
      const out={};
      for(const column of columns){
        if(column.rate){
          const num=cells[column.rate.num]?.value||0,den=cells[column.rate.den]?.value||0;
          out[column.id]={value:den?Math.round(num/den*100):null,items:cells[column.rate.den]?.items||[]};
        }else{
          const cell=cells[column.id];
          out[column.id]={value:cell?cell.value:0,items:cell?cell.items:[]};
        }
      }
      return out;
    };
    const first=columns[0].id;
    const list=[...rows.values()].map(row=>({owner:row.owner,label:row.label,cells:finish(row.cells)}))
      .sort((a,b)=>(a.owner===''?1:0)-(b.owner===''?1:0)||b.cells[first].value-a.cells[first].value||byLabel(a,b));
    return {rows:list,total:finish(totalCells)};
  }
  const knownOwners=rows=>[...new Set(rows.filter(row=>row.bucket!=='trash'&&row.owner).map(row=>row.owner))];
  const tile=(id,label,cell,format='count')=>({id,label,value:cell.value,format,items:cell.items});
  function trendOf(months,series,valueFor){
    return {months:months.map(month=>({month,values:Object.fromEntries(series.map(item=>[item.id,valueFor(month,item.id)]))})),series};
  }
  function requireMonth(period){if(!validPeriod(period))throw new Error('请选择有效月份');}

  function assets(state,month){
    requireMonth(month);
    const rows=customerRows(state),selected=new Set(periodMonths(month)),months=monthsEnding(periodMonths(month).at(-1));
    const live=rows.filter(row=>row.bucket!=='trash');
    const entries=[];
    for(const row of rows.filter(item=>item.bucket==='active'))entries.push({col:'customers',owner:row.owner,item:customerItem(row,row.source||'来源未填写')});
    for(const row of live)if(selected.has(monthOf(row.createdAt)))entries.push({col:'added',owner:row.owner,item:customerItem(row,`创建于 ${day(row.createdAt)}`)});
    const columns=[{id:'customers',label:'在库客户',format:'count'},{id:'added',label:'本月新增',format:'count'}];
    const table=tabulate(columns,entries,knownOwners(rows));
    const sources=new Map();
    for(const row of rows.filter(item=>item.bucket==='active')){
      const key=row.source||'未填写';
      if(!sources.has(key))sources.set(key,[]);
      sources.get(key).push(customerItem(row));
    }
    const live_total=table.total.customers.value;
    const sourceRows=[...sources.entries()].map(([label,items])=>({label,count:items.length,percent:Math.round(items.length/Math.max(1,live_total)*100),items}))
      .sort((a,b)=>b.count-a.count||byLabel(a,b));
    const unknown=live.filter(row=>!monthOf(row.createdAt)).length;
    return {
      kind:'assets',title:'客户资产',month,
      scope:'在库客户＝客户列表中的客户（不含公海和回收站）；新增按创建时间，回收站客户不计入。',
      tiles:[tile('customers','在库客户',table.total.customers),tile('added','本月新增',table.total.added)],
      columns,rows:table.rows,total:table.total,totals:null,
      extra:[{id:'sources',title:'客户来源分布（在库客户）',columnLabel:'客户来源',rows:sourceRows}],
      notes:unknown?[`有 ${unknown} 位客户没有创建时间，未计入任何月份的新增。`]:[],
      trend:trendOf(months,[{id:'added',label:'新增客户',format:'count'}],(m)=>live.filter(row=>monthOf(row.createdAt)===m).length)
    };
  }

  function followups(state,month){
    requireMonth(month);
    const rows=customerRows(state),selected=new Set(periodMonths(month)),months=monthsEnding(periodMonths(month).at(-1));
    const live=rows.filter(row=>row.bucket!=='trash');
    const records=[];
    for(const row of live)for(const entry of row.history){
      if(entry?.type!=='followup')continue;
      const at=entry.time||entry.date;
      const m=monthOf(at);
      if(m)records.push({row,entry,at,month:m});
    }
    const entries=[];
    for(const record of records.filter(item=>selected.has(item.month))){
      entries.push({col:'records',owner:record.row.owner,item:{kind:'followup',title:record.row.name,meta:day(record.at),text:snippet(record.entry.text||record.entry.content||record.entry.note),customer:record.row.name}});
      entries.push({col:'customers',owner:record.row.owner,distinct:record.row.name,item:customerItem(record.row)});
    }
    const columns=[{id:'records',label:'跟进记录数',format:'count'},{id:'customers',label:'涉及客户数',format:'count'}];
    const table=tabulate(columns,entries,knownOwners(rows));
    return {
      kind:'followups',title:'跟进情况',month,
      scope:'跟进记录＝客户动态里类型为「跟进」的记录，按记录时间归月，归到客户当前的跟进人；回收站客户不计入。',
      tiles:[tile('records','跟进记录数',table.total.records),tile('customers','涉及客户数',table.total.customers)],
      columns,rows:table.rows,total:table.total,totals:null,extra:[],notes:[],
      trend:trendOf(months,[{id:'records',label:'跟进记录数',format:'count'}],(m)=>records.filter(item=>item.month===m).length)
    };
  }

  function tasks(state,month){
    requireMonth(month);
    const rows=customerRows(state),selected=new Set(periodMonths(month)),months=monthsEnding(periodMonths(month).at(-1));
    const ownerOf=new Map(rows.map(row=>[row.name,row.owner]));
    const all=(Array.isArray(state.laiTasks)?state.laiTasks:[]).filter(task=>task&&typeof task==='object').map(task=>({task,month:monthOf(task.date),owner:ownerOf.get(trim(task.customer))||''})).filter(item=>item.month);
    const itemOf=({task})=>({kind:'task',title:trim(task.title)||'（未命名任务）',meta:`${day(task.date)} · ${task.done===true?'已完成':'未完成'}`,customer:trim(task.customer)});
    const entries=[];
    for(const record of all.filter(item=>selected.has(item.month))){
      entries.push({col:'total',owner:record.owner,item:itemOf(record)});
      if(record.task.done===true)entries.push({col:'done',owner:record.owner,item:itemOf(record)});
    }
    const columns=[{id:'total',label:'任务数',format:'count'},{id:'done',label:'已完成',format:'count'},{id:'rate',label:'完成率',format:'percent',rate:{num:'done',den:'total'}}];
    const table=tabulate(columns,entries,knownOwners(rows));
    return {
      kind:'tasks',title:'任务完成',month,
      scope:'任务按任务日期归月，归到任务所关联客户当前的跟进人；没有关联客户或客户不存在的归入「未分配」。完成率＝已完成÷任务数。',
      tiles:[tile('total','任务数',table.total.total),tile('done','已完成',table.total.done),tile('rate','完成率',table.total.rate,'percent')],
      columns,rows:table.rows,total:table.total,totals:null,extra:[],notes:[],
      trend:trendOf(months,[{id:'total',label:'任务数',format:'count'},{id:'done',label:'已完成',format:'count'}],
        (m,id)=>all.filter(item=>item.month===m&&(id==='total'||item.task.done===true)).length)
    };
  }

  function orders(state,month){
    requireMonth(month);
    const months=monthsEnding(periodMonths(month).at(-1));
    const picked=periodMonths(month).flatMap(m=>BM.monthlyAnalysis(state.orders||[],m).orders);
    const analysis={orders:picked,metrics:BM.orderMetrics(picked)};
    const itemOf=order=>({kind:'order',title:trim(order.num)||'（未编号）',meta:`${trim(order.client)} · ${(trim(order.currency||'USD').toUpperCase()||'USD')} ${Number(order.amount)||0}`,customer:trim(order.client),orderId:order.id});
    const currencyOf=order=>trim(order.currency||'USD').toUpperCase()||'USD';
    const groups=new Map();
    for(const order of analysis.orders){
      const owner=trim(order.owner),key=owner+'\0'+currencyOf(order);
      if(!groups.has(key))groups.set(key,{owner,currency:currencyOf(order),orders:[]});
      groups.get(key).orders.push(order);
    }
    const cellsFor=list=>{
      const metric=BM.orderMetrics(list).byCurrency[0];
      const items=list.map(itemOf);
      return {count:{value:metric.count,items},total:{value:metric.total,items},paid:{value:metric.paid,items},due:{value:metric.due,items}};
    };
    const rows=[...groups.values()].map(group=>({owner:group.owner,label:group.owner||'未分配',currency:group.currency,cells:cellsFor(group.orders)}))
      .sort((a,b)=>a.currency.localeCompare(b.currency)||(a.owner===''?1:0)-(b.owner===''?1:0)||b.cells.total.value-a.cells.total.value||byLabel(a,b));
    const totals=analysis.metrics.byCurrency.map(metric=>({currency:metric.currency,cells:cellsFor(analysis.orders.filter(order=>currencyOf(order)===metric.currency))}))
      .sort((a,b)=>a.currency.localeCompare(b.currency));
    const monthly=months.map(m=>({month:m,metrics:BM.monthlyAnalysis(state.orders||[],m).metrics}));
    const currencies=[...new Set(monthly.flatMap(item=>item.metrics.byCurrency.map(c=>c.currency)))].sort();
    const series=[{id:'count',label:'订单数',format:'count'},...currencies.map(code=>({id:'amount:'+code,label:`订单金额（${code}）`,format:'money',currency:code}))];
    return {
      kind:'orders',title:'订单业绩',month,
      scope:'订单按订单月份归月，不含草稿；按订单上填写的跟进人汇总，没填的归入「未分配」；不同币种分开统计、不折算。',
      tiles:[{id:'count',label:'订单数',value:analysis.metrics.count,format:'count',items:analysis.orders.map(itemOf)},
        ...totals.map(total=>({id:'amount:'+total.currency,label:`订单金额（${total.currency}）`,value:total.cells.total.value,format:'money',currency:total.currency,items:total.cells.total.items}))],
      columns:[{id:'count',label:'订单数',format:'count'},{id:'total',label:'订单金额',format:'money'},{id:'paid',label:'已收款',format:'money'},{id:'due',label:'待收款',format:'money'}],
      rows,total:null,totals,extra:[],notes:[],
      trend:trendOf(months,series,(m,id)=>{
        const metrics=monthly.find(item=>item.month===m).metrics;
        if(id==='count')return metrics.count;
        return metrics.byCurrency.find(c=>c.currency===id.slice(7))?.total||0;
      })
    };
  }

  // 目标完成情况、团队墙共用的成员汇总：把四类报表按跟进人合并，不引入新的统计规则。
  const RULES=Object.freeze({
    amount:'统计本月订单月份内的非草稿订单金额，不同币种分开统计、不折算；排名以本月金额最大的币种为准。',
    added:'统计本月创建的客户数量，回收站客户不计入。',
    orders:'统计本月订单月份内的非草稿订单数量。',
    records:'统计客户动态中类型为「跟进」的记录数量，归到客户当前的跟进人；回收站客户不计入。',
    customers:'统计本月至少有一条跟进记录的客户数量。',
    tasksDone:'统计任务日期在本月且已完成的任务数量；完成率＝已完成÷任务数。'
  });
  // ---- 目标：按周期（月／季度）、对象（企业／成员）、指标保存一个目标值；金额目标按币种分别设置。 ----
  const TARGET_METRICS=Object.freeze(['amount','added','orders','records','tasksDone']);
  function normalizeTarget(input){
    const metric=trim(input?.metric);
    if(!TARGET_METRICS.includes(metric))throw new Error('请选择可设置目标的指标');
    const period=trim(input?.period);
    if(!validPeriod(period))throw new Error('请选择有效的目标周期');
    const scope=trim(input?.scope);
    let owner=null;
    if(scope==='member'){owner=trim(input?.owner);if(!owner)throw new Error('请选择成员');}
    else if(scope!=='company')throw new Error('请选择目标对象');
    let currency='';
    if(metric==='amount'){currency=trim(input?.currency).toUpperCase();if(!/^[A-Z]{3}$/.test(currency))throw new Error('请填写三位币种代码');}
    const raw=input?.value;
    if(raw===null||raw===undefined||typeof raw==='boolean'||!trim(raw)||!Number.isFinite(Number(raw))||Number(raw)<=0)throw new Error('请输入大于 0 的目标值');
    const value=Number(raw);
    if(metric!=='amount'&&!Number.isInteger(value))throw new Error('数量类目标请填写整数');
    return {metric,period,owner,currency,value};
  }
  const targetKey=target=>[target.metric,target.period,target.owner===null?'#':'@'+target.owner,target.currency].join('|');
  // 读取已保存的目标：格式不对的条目跳过不用，但保存时原样保留，不擅自删除。
  function readTarget(raw){
    try{
      if(!raw||typeof raw!=='object')return null;
      const target=normalizeTarget({...raw,scope:raw.owner===null||raw.owner===undefined?'company':'member'});
      return {...target,key:targetKey(target)};
    }catch{return null;}
  }
  const rawTargets=state=>Array.isArray(state?.laiTargets)?state.laiTargets:[];
  function listTargets(state){
    const seen=new Map();
    for(const raw of rawTargets(state)){const target=readTarget(raw);if(target)seen.set(target.key,target);}
    return [...seen.values()].sort((a,b)=>b.period.localeCompare(a.period)||TARGET_METRICS.indexOf(a.metric)-TARGET_METRICS.indexOf(b.metric)
      ||(a.owner===null?0:1)-(b.owner===null?0:1)||String(a.owner||'').localeCompare(String(b.owner||''),'zh')||a.currency.localeCompare(b.currency));
  }
  function setTarget(state,input){
    const target=normalizeTarget(input),key=targetKey(target);
    return {...state,laiTargets:[...rawTargets(state).filter(raw=>readTarget(raw)?.key!==key),target]};
  }
  function removeTarget(state,key){
    const list=rawTargets(state);
    if(!list.some(raw=>readTarget(raw)?.key===key))throw new Error('目标不存在或已删除');
    return {...state,laiTargets:list.filter(raw=>readTarget(raw)?.key!==key)};
  }
  function overview(state,month){
    requireMonth(month);
    state=state||{};
    const a=assets(state,month),f=followups(state,month),t=tasks(state,month),o=orders(state,month);
    const members=new Map();
    const member=owner=>{
      if(!members.has(owner))members.set(owner,{owner,label:owner||'未分配',added:0,orders:0,amounts:[],amount:0,records:0,customers:0,tasksTotal:0,tasksDone:0,taskRate:null});
      return members.get(owner);
    };
    for(const row of a.rows)member(row.owner).added=row.cells.added.value;
    for(const row of f.rows){const m=member(row.owner);m.records=row.cells.records.value;m.customers=row.cells.customers.value;}
    for(const row of t.rows){const m=member(row.owner);m.tasksTotal=row.cells.total.value;m.tasksDone=row.cells.done.value;m.taskRate=row.cells.rate.value;}
    for(const row of o.rows){const m=member(row.owner);m.orders+=row.cells.count.value;m.amounts.push({currency:row.currency,total:row.cells.total.value});}
    const targets=listTargets(state).filter(target=>target.period===month);
    for(const target of targets)if(target.owner!==null)member(target.owner);
    const amounts=o.totals.map(total=>({currency:total.currency,total:total.cells.total.value}));
    // 主币种：本月金额最大的币种，金额相同按代码排序；没有订单时为空。
    const primaryCurrency=[...amounts].sort((x,y)=>y.total-x.total||x.currency.localeCompare(y.currency))[0]?.currency||'';
    for(const m of members.values()){
      m.amounts.sort((x,y)=>x.currency.localeCompare(y.currency));
      m.amount=m.amounts.find(item=>item.currency===primaryCurrency)?.total||0;
    }
    const list=[...members.values()].sort((x,y)=>(x.owner===''?1:0)-(y.owner===''?1:0)||byLabel(x,y));
    const pick=(report,id)=>report.trend.months.map(entry=>entry.values[id]);
    const trend={months:a.trend.months.map(entry=>entry.month),series:[
      ...o.trend.series.filter(item=>item.id!=='count').map(item=>({id:item.id,label:`成交订单金额（${item.currency}）`,format:'money',currency:item.currency,values:pick(o,item.id)})),
      {id:'added',label:'新建客户数',format:'count',values:pick(a,'added')},
      {id:'orders',label:'新建销售订单数',format:'count',values:pick(o,'count')},
      {id:'records',label:'跟进记录数',format:'count',values:pick(f,'records')},
      {id:'tasksDone',label:'任务完成数',format:'count',values:pick(t,'done')}
    ]};
    const total={added:a.total.added.value,orders:o.tiles[0].value,amounts,records:f.total.records.value,customers:f.total.customers.value,
      tasksTotal:t.total.total.value,tasksDone:t.total.done.value,taskRate:t.total.rate.value};
    // 完成率＝完成值÷目标值，四舍五入到整数百分比，可以超过 100%。
    const goalsFor=(owner,source)=>{
      const out={};
      for(const target of targets.filter(item=>item.owner===owner)){
        const actual=target.metric==='amount'?(source.amounts.find(item=>item.currency===target.currency)?.total||0):source[target.metric];
        (out[target.metric]||(out[target.metric]=[])).push({key:target.key,currency:target.currency,value:target.value,actual,rate:Math.round(actual/target.value*100)});
      }
      return out;
    };
    for(const m of list)m.goals=goalsFor(m.owner,m);
    const months=periodMonths(month);
    return {
      month:months.at(-1),period:month,periodType:months.length>1?'quarter':'month',periodLabel:periodLabel(month),months,
      members:list,primaryCurrency,rules:RULES,trend,goals:goalsFor(null,total),targetMetrics:TARGET_METRICS,
      total};
  }
  const reports={assets,followups,tasks,orders};
  const kinds=Object.freeze(Object.keys(reports));
  function report(kind,state,month){
    if(!Object.hasOwn(reports,kind))throw new Error('不支持的团队数据报表');
    return reports[kind](state||{},month);
  }
  const api={kinds,report,overview,monthOf,monthsEnding,periodMonths,quarterOf,periodLabel,validPeriod,targetMetrics:TARGET_METRICS,listTargets,setTarget,removeTarget};
  if(node)module.exports=api;else root.LaiTeamModel=api;
})(typeof window!=='undefined'?window:globalThis);
