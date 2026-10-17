(function(root){
  'use strict';
  // 团队数据页面的纯标记生成：不读写数据，数字上带 data-team-detail，由业务界面决定点击后的明细。
  // 外观用组件套件（src/ui-kit.css，D-028）：卡片 k-card、表格 k-table（数字列 k-num）、页签 k-tabs、按钮 k-btn、徽标 k-badge、空状态 k-empty；
  // 这一组页面自己的排版在 business.css「团队数据」一节。
  const DETAIL_LIMIT=200;
  const number=value=>Number(value||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  // can(key)：当前账号有没有这个权限（角色预览用）；没传时什么都显示。
  function create(E,can=()=>true){
    const text=(value,format,currency)=>{
      if(value===null||value===undefined)return '—';
      if(format==='percent')return `${value}%`;
      if(format==='money')return `${number(value)} ${E(currency||'')}`;
      return String(value);
    };
    // 有明细的数字做成按钮，0 或没有明细的只显示文字。
    const figure=(key,cell,format,currency)=>{
      const shown=text(cell.value,format,currency);
      return cell.items?.length?`<button type="button" class="team-number" data-team-detail="${E(key)}" aria-label="查看明细：${shown}">${shown}</button>`:shown;
    };
    // 只看本人／本部门的账号：页面顶上说明一句；企业整体的目标和「我的企业」字样不出现。
    const scopeNote=data=>data.scopeNote?`<p class="team-scope-note">${E(data.scopeNote)}</p>`:'';
    // 一张卡片：标题、标题旁的说明或右边的工具，下面是内容。
    const card=(title,head,body,cls='')=>`<section class="k-card team-card${cls?' '+cls:''}"><div class="k-card-head"><h3 class="k-card-title">${title}</h3>${head}</div><div class="k-card-body">${body}</div></section>`;
    const desc=value=>`<span class="k-card-desc">${value}</span>`;
    // 横条：主色条在浅灰轨道上，右边是数值。
    const bars=rows=>`<div class="team-bars">${rows.map(([label,width,value])=>`<div><span>${label}</span><div><i style="width:${width}%"></i></div><b>${value}</b></div>`).join('')}</div>`;
    const scroll=table=>`<div class="team-table-scroll">${table}</div>`;
    const owned=data=>data.scopeNote?'我的数据':'我的企业';
    const tiles=report=>`<div class="team-tiles">${report.tiles.map(tile=>`<div class="k-card team-tile"><span>${E(tile.label)}</span><strong>${figure('tile:'+tile.id,{value:tile.value,items:tile.items},tile.format,tile.currency)}</strong></div>`).join('')}</div>`;
    const currencyBadge=code=>`<span class="k-badge k-badge--neutral">${E(code)}</span>`;
    function table(report){
      const hasCurrency=report.kind==='orders';
      const head=`<tr><th>跟进人</th>${hasCurrency?'<th>币种</th>':''}${report.columns.map(column=>`<th class="k-num">${E(column.label)}</th>`).join('')}</tr>`;
      const cells=(row,key,currency)=>report.columns.map(column=>`<td class="k-num">${figure(`${key}:${column.id}`,row.cells[column.id],column.format,currency||row.currency)}</td>`).join('');
      const body=report.rows.map((row,index)=>`<tr><td>${E(row.label)}</td>${hasCurrency?`<td>${currencyBadge(row.currency)}</td>`:''}${cells(row,'r:'+index)}</tr>`);
      const foot=[];
      if(report.total)foot.push(`<tr class="team-total"><td>合计</td>${cells({cells:report.total},'t')}</tr>`);
      (report.totals||[]).forEach((total,index)=>foot.push(`<tr class="team-total"><td>合计</td><td>${currencyBadge(total.currency)}</td>${cells({cells:total.cells},'ot:'+index,total.currency)}</tr>`));
      const colspan=report.columns.length+1+(hasCurrency?1:0);
      return scroll(`<table class="k-table team-table"><thead>${head}</thead><tbody>${body.join('')||`<tr><td colspan="${colspan}" class="team-none">本月暂无数据</td></tr>`}${foot.join('')}</tbody></table>`);
    }
    const extra=report=>(report.extra||[]).map(block=>card(E(block.title),'',scroll(`<table class="k-table team-table"><thead><tr><th>${E(block.columnLabel)}</th><th class="k-num">数量</th><th class="k-num">占比</th></tr></thead><tbody>${block.rows.map((row,index)=>`<tr><td>${E(row.label)}</td><td class="k-num">${figure('x:'+block.id+':'+index,{value:row.count,items:row.items},'count')}</td><td class="k-num">${row.percent}%</td></tr>`).join('')||'<tr><td colspan="3" class="team-none">暂无数据</td></tr>'}</tbody></table>`))).join('');
    function trend(report){
      const {months,series}=report.trend;
      return card(`近 ${months.length} 个月趋势`,'',`<div class="team-trend">${series.map(item=>{
        const max=Math.max(1,...months.map(entry=>entry.values[item.id]));
        return `<div><h4 class="team-trend-title">${E(item.label)}</h4>${bars(months.map(entry=>[E(entry.month),Math.round(entry.values[item.id]/max*100),text(entry.values[item.id],item.format,item.currency)]))}</div>`;
      }).join('')}</div>`);
    }
    const markup=report=>`<div class="team-body">${scopeNote(report)}${tiles(report)}${card('按跟进人',desc(E(report.scope)),table(report)+report.notes.map(note=>`<p class="team-note">${E(note)}</p>`).join(''))}${extra(report)}${trend(report)}</div>`;

    // key 形如 tile:id / r:行号:列 / t:列 / ot:行号:列 / x:块:行号；解析失败返回 null。
    function itemsFor(report,key){
      const part=String(key).split(':');
      const pick=(cells,id)=>cells&&Object.hasOwn(cells,id)?cells[id]:null;
      let cell=null,label=report.title;
      if(part[0]==='tile'){const tile=report.tiles.find(item=>item.id===part.slice(1).join(':'));cell=tile?{items:tile.items}:null;label=tile?.label||label;}
      else if(part[0]==='r'){const row=report.rows[Number(part[1])];cell=pick(row?.cells,part[2]);label=`${row?.label||''} · ${report.columns.find(c=>c.id===part[2])?.label||''}`;}
      else if(part[0]==='t'){cell=pick(report.total,part[1]);label=`合计 · ${report.columns.find(c=>c.id===part[1])?.label||''}`;}
      else if(part[0]==='ot'){const total=(report.totals||[])[Number(part[1])];cell=pick(total?.cells,part[2]);label=`合计 ${total?.currency||''} · ${report.columns.find(c=>c.id===part[2])?.label||''}`;}
      else if(part[0]==='x'){const row=report.extra?.find(block=>block.id===part[1])?.rows[Number(part[2])];cell=row?{items:row.items}:null;label=row?.label||label;}
      return cell&&Array.isArray(cell.items)?{label,items:cell.items}:null;
    }
    function detailMarkup(items){
      const shown=items.slice(0,DETAIL_LIMIT);
      const link=item=>item.customer?`<button type="button" class="k-btn k-btn--ghost k-btn--sm" data-biz-customer="${E(item.customer)}">${item.kind==='customer'?'查看客户':'查看客户 '+E(item.customer)}</button>`:'';
      return `<div class="k-dialog-body team-detail"><p class="team-detail-count">共 ${items.length} 条${items.length>shown.length?`，仅显示前 ${DETAIL_LIMIT} 条`:''}</p><ul class="team-detail-list">${shown.map(item=>`<li><div><strong>${E(item.title)}</strong>${item.meta?` <span class="team-detail-meta">${E(item.meta)}</span>`:''}</div>${item.text?`<div class="team-detail-text">${E(item.text)}</div>`:''}${link(item)}</li>`).join('')||'<li>没有记录</li>'}</ul></div>`;
    }

    // ---------- 目标完成情况 / 团队墙（成员＝跟进人名称；没有目标的格子显示「—」「--%」） ----------
    const COLUMNS={
      amount:{label:'成交订单金额',value:member=>member.amount},
      repeat:{label:'复购客户数',value:member=>member.repeat},
      newDeal:{label:'成交新客户数',value:member=>member.newDeal},
      added:{label:'新建客户数',value:member=>member.added},
      orders:{label:'新建销售订单数',value:member=>member.orders},
      records:{label:'跟进记录数',value:member=>member.records},
      customers:{label:'涉及客户数',value:member=>member.customers},
      oppWonAmount:{label:'赢单金额',value:member=>member.oppWonAmount||0},
      oppWon:{label:'赢单商机数',value:member=>member.oppWon||0},
      oppNew:{label:'新建商机数',value:member=>member.oppNew||0}
    };
    const TABS={result:['amount','repeat','newDeal','added','orders'],process:['records','customers'],opportunity:['oppWonAmount','oppWon','oppNew']};
    const TAB_LABELS={result:'结果目标',process:'过程目标',opportunity:'商机目标'};
    const tabOf=view=>Object.hasOwn(TABS,view?.tab)?view.tab:'result';
    const TREND={result:id=>id.startsWith('amount:')||['repeat','newDeal','added','orders'].includes(id),process:id=>id==='records',opportunity:id=>id.startsWith('oppWonAmount:')||id==='oppWon'||id==='oppNew'};
    // 金额类指标（订单金额、赢单金额）：各币种分开，一行一个币种。
    const MONEY={amount:'amounts',oppWonAmount:'oppAmounts'};
    const isMoney=id=>Object.hasOwn(MONEY,id);
    const moneyOf=(id,source)=>Array.isArray(source?.[MONEY[id]])?source[MONEY[id]]:[];
    const rankCurrency=(overview,id)=>id==='oppWonAmount'?overview.oppCurrency||'':overview.primaryCurrency||'';
    const amountLines=amounts=>amounts.length?amounts.map(item=>`${number(item.total)} ${E(item.currency)}`):['0'];
    const shown=(overview,id,source)=>isMoney(id)?amountLines(moneyOf(id,source)).join('<br>'):String(source[id]??0);
    // 目标：没有目标时显示「—」「--%」；金额目标按币种各占一行。
    const goalList=(source,id)=>source?.goals&&Object.hasOwn(source.goals,id)?source.goals[id]:[];
    const targetShown=(id,list)=>list.length?list.map(goal=>isMoney(id)?`${number(goal.value)} ${E(goal.currency)}`:String(goal.value)).join('<br>'):'—';
    const rateShown=list=>list.length?list.map(goal=>`${goal.rate}%`).join('<br>'):'--%';
    const lowestRate=list=>list.length?Math.max(0,Math.min(100,...list.map(goal=>goal.rate))):0;
    const reached=list=>list.length>0&&list.every(goal=>goal.reached===true);
    const targetable=(overview,id)=>(overview.targetMetrics||['amount','repeat','newDeal','added','orders','records','oppWonAmount','oppWon','oppNew']).includes(id);
    const unit=overview=>overview.periodType==='quarter'?'本季度':'本月';
    // 名次：中性小徽标，第一名用提醒色；没有名次的只是一条短横。
    const badge=rank=>rank?`<span class="team-rank k-badge ${rank===1?'k-badge--warning':'k-badge--neutral'}" aria-label="第 ${rank} 名">${rank}</span>`:'<span class="team-rank team-rank-none" aria-label="不参与排名">—</span>';
    // 排名只针对填了名字的跟进人，按该列从高到低；「未分配」排在最后且不给名次。
    function ranked(overview,id){
      const value=COLUMNS[id].value;
      const named=overview.members.filter(member=>member.owner!=='').sort((a,b)=>value(b)-value(a)||a.label.localeCompare(b.label,'zh'));
      // 数值相同的并列同一名次（1、1、3），并列时按名称排列；数值为 0 的不给名次（没有成绩谈不上第几名）。
      const ranks=named.map((member,index)=>value(member)>0?named.findIndex(other=>value(other)===value(member))+1:null);
      return [...named.map((member,index)=>({member,rank:ranks[index]})),...overview.members.filter(member=>member.owner==='').map(member=>({member,rank:null}))];
    }
    function ordered(overview,sort,allowed){
      const id=allowed.includes(sort?.id)?sort.id:allowed[0],dir=sort?.dir==='asc'?'asc':'desc';
      const rows=ranked(overview,id);
      if(dir==='asc'){const named=rows.filter(row=>row.member.owner!=='').reverse();return {id,dir,rows:[...named,...rows.filter(row=>row.member.owner==='')]};}
      return {id,dir,rows};
    }
    const sortButton=(attr,id,active,label)=>`<button type="button" class="team-sort" ${attr}="${id}" aria-label="按${E(COLUMNS[id].label)}排序">${label}<span aria-hidden="true">${active?(active==='asc'?' ▲':' ▼'):' ⇅'}</span></button>`;
    const trendBlocks=(overview,keep)=>overview.trend.series.filter(item=>keep(item.id)).map(item=>{
      const max=Math.max(1,...item.values);
      return `<div><h4 class="team-trend-title">${E(item.label)}</h4>${bars(overview.trend.months.map((month,index)=>[E(month),Math.round(item.values[index]/max*100),text(item.values[index],item.format,item.currency)]))}</div>`;
    }).join('');

    function goalsMarkup(overview,view={}){
      const tab=tabOf(view),ids=TABS[tab];
      const showTarget=view.showTarget!==false,showRate=view.showRate!==false;
      const goal=id=>{
        const list=goalList(overview,id);
        const foot=!targetable(overview,id)
          ?'<span class="team-goal-note">该指标暂不支持设置目标</span>'
          :`<span class="team-goal-note">${list.length?list.map(item=>`目标 ${targetShown(id,[item])}，完成率 ${item.rate}%`).join('<br>'):'未设定目标值'}</span>${can('team.goalEdit')&&!overview.scopeNote?`<button type="button" class="team-link team-link-strong" data-team-target="${id}">${list.length?'修改目标值':'设置目标值'} »</button>`:''}`;
        return `<div class="k-card team-goal"><div class="team-goal-head"><span>${E(COLUMNS[id].label)}${reached(list)?' <em class="k-badge k-badge--success team-reached">已达标</em>':''}</span><button type="button" class="team-link" data-team-rule="${id}">规则 »</button></div><strong>${shown(overview,id,overview.total)}</strong>${id==='oppWon'?`<span class="team-goal-note">${overview.total.oppWinRate===null||overview.total.oppWinRate===undefined?`${unit(overview)}还没有赢单或输单的商机`:`赢单率 ${overview.total.oppWinRate}%（赢单 ${overview.total.oppWon} ／ 输单 ${overview.total.oppLost}）`}</span>`:''}<div class="team-goal-foot">${foot}</div><div class="team-goal-bar" aria-hidden="true"><i style="width:${lowestRate(list)}%"></i></div></div>`;
      };
      const {id:sortId,dir,rows}=ordered(overview,view.sort,ids);
      const span=1+(showTarget?1:0)+(showRate?1:0);
      const head=`<tr><th rowspan="2">排名</th><th rowspan="2">成员</th>${ids.map(id=>`<th colspan="${span}">${E(COLUMNS[id].label)}</th>`).join('')}</tr><tr>${ids.map(id=>`<th class="k-num"${id===sortId?` aria-sort="${dir==='asc'?'ascending':'descending'}"`:''}>${sortButton('data-team-sort',id,id===sortId?dir:'','完成值')}</th>${showTarget?'<th class="k-num">目标值</th>':''}${showRate?'<th class="k-num">完成率</th>':''}`).join('')}</tr>`;
      const body=rows.map(({member,rank})=>`<tr><td>${badge(rank)}</td><td>${E(member.label)}</td>${ids.map(id=>{const list=goalList(member,id);return `<td class="k-num">${shown(overview,id,member)}</td>${showTarget?`<td class="k-num${list.length?'':' team-unset'}">${targetShown(id,list)}</td>`:''}${showRate?`<td class="k-num${list.length?(reached(list)?' team-reached':''):' team-unset'}">${rateShown(list)}</td>`:''}`;}).join('')}</tr>`).join('');
      // 排行榜／趋势图的切换放在下面这张卡片的标题行右边。
      const modes=`<div class="k-tabs team-modes" role="group" aria-label="展示方式">${[['rank','排行榜'],['trend','趋势图']].map(([key,label])=>{const on=key==='trend'?view.mode==='trend':view.mode!=='trend';return `<button type="button" class="k-tab${on?' is-active':''}" data-team-mode="${key}" aria-pressed="${on}">${label}</button>`;}).join('')}</div>`;
      const tool=(attr,on,label)=>`<button type="button" class="k-btn k-btn--sm team-toggle" data-team-toggle="${attr}" aria-pressed="${on}">${label}</button>`;
      const board=view.mode==='trend'
        ?card(`近 ${overview.trend.months.length} 个月趋势`,`<div class="team-head-tools">${modes}</div>`,`<div class="team-trend">${trendBlocks(overview,TREND[tab])}</div>`)
        :card('成员排行榜',`<div class="team-head-tools">${modes}<span class="team-tools">${tool('target',showTarget,'目标值')}${tool('rate',showRate,'完成率')}${can('team.export')?'<button type="button" class="k-btn k-btn--sm" data-team-export="board">下载Excel</button>':''}</span></div>`,`${scroll(`<table class="k-table team-table team-board"><thead>${head}</thead><tbody>${body||`<tr><td colspan="${2+ids.length*span}" class="team-none">${unit(overview)}暂无数据</td></tr>`}</tbody></table>`)}<p class="team-note">成员按跟进人名称统计，不是员工账号${overview.scopeNote?'':'；「未分配」不参与排名'}。没有设置目标的格子显示「—」。</p>`);
      return `<div class="team-body team-goals">${scopeNote(overview)}<div class="k-tabs team-tabs" role="tablist">${Object.keys(TABS).map(key=>`<button type="button" class="k-tab" role="tab" data-team-tab="${key}" aria-selected="${tab===key}">${TAB_LABELS[key]}</button>`).join('')}</div><section class="team-block"><h3 class="team-block-title">${TAB_LABELS[tab].replace('目标','概览')}</h3><div class="team-goal-grid">${ids.map(goal).join('')}${can('team.goalEdit')&&!overview.scopeNote?'<button type="button" class="team-goal team-goal-new" data-team-target="new"><span aria-hidden="true">⊕</span>新建目标</button>':''}</div></section>${board}</div>`;
    }

    // 倒计时：只依赖所选周期（一个月或一个季度的月份列表）和今天的日期。
    function countdown(period,today){
      const list=Array.isArray(period)?period:[period],name=list.length>1?'本季度':'本月';
      const parts=value=>[Number(String(value).slice(0,4)),Number(String(value).slice(5,7)),Number(String(value).slice(8,10))||1];
      const [startYear,startMonth]=parts(list[0]),[endYear,endMonth]=parts(list.at(-1)),[year,month,dayOfMonth]=parts(today);
      const DAY=86400000,start=Date.UTC(startYear,startMonth-1,1),end=Date.UTC(endYear,endMonth,0),now=Date.UTC(year,month-1,dayOfMonth);
      const days=Math.round((end-start)/DAY)+1;
      const date=`${String(today).slice(5,10)} ${'周'+'日一二三四五六'[new Date(year,month-1,dayOfMonth).getDay()]}`;
      if(now<start)return {left:days,days,remaining:1,label:`${name}尚未开始`,date};
      if(now>end)return {left:0,days,remaining:0,label:`${name}已结束`,date};
      const left=Math.round((end-now)/DAY);
      return {left,days,remaining:left/days,label:`离${name}结束还剩`,date};
    }
    function wallMarkup(overview,view={},today){
      const clock=countdown(overview.months||overview.month,today),ring=2*Math.PI*54;
      const amountGoals=goalList(overview,'amount');
      const currency=overview.primaryCurrency;
      const others=overview.total.amounts.length>1;
      const list=(id,title,note='')=>{
        const rows=ranked(overview,id).filter(row=>row.rank).slice(0,10),value=COLUMNS[id].value;
        const max=Math.max(1,...rows.map(row=>value(row.member)));
        const currency=rankCurrency(overview,id);
        return `<section class="k-card team-wall-card${id==='amount'?' team-card-tall':''}"><h3 class="k-card-title">${title}</h3><ol class="team-rank-list">${rows.map(row=>`<li>${badge(row.rank)}<span class="team-rank-name">${E(row.member.label)}</span><span class="team-rank-value">${isMoney(id)?(currency?`${number(value(row.member))} ${E(currency)}`:'0'):value(row.member)}</span><span class="team-bar" aria-hidden="true"><i style="width:${Math.round(value(row.member)/max*100)}%"></i></span></li>`).join('')||`<li class="k-empty">${unit(overview)}暂无数据</li>`}</ol>${note?`<p class="team-note">${note}</p>`:''}</section>`;
      };
      const figure=(title,value,foot='完成值')=>`<section class="k-card team-wall-card team-card-number"><h3 class="k-card-title">${title}</h3><span class="k-card-desc">${owned(overview)}</span><strong>${value}</strong><span class="team-cap">${foot}</span></section>`;
      const winRate=overview.total.oppWinRate===null||overview.total.oppWinRate===undefined?`${unit(overview)}还没有赢单或输单的商机`:`赢单率 ${overview.total.oppWinRate}%（赢单 ${overview.total.oppWon} ／ 输单 ${overview.total.oppLost}）`;
      const pkIds=['added','records','customers','orders','amount','newDeal','repeat','oppWon','oppWonAmount'];
      const pk=ordered(overview,view.wallSort,pkIds);
      const first=pk.dir==='desc'?pk.rows.find(row=>row.rank===1&&COLUMNS[pk.id].value(row.member)>0):ranked(overview,pk.id).find(row=>row.rank===1&&COLUMNS[pk.id].value(row.member)>0);
      const pkLabel={newDeal:'成交新客户数',repeat:'复购客户数',added:'新建客户数',records:'跟进记录数',customers:'涉及客户数',orders:'新建订单数',amount:`成交订单金额${currency?`（${E(currency)}）`:''}`,oppWon:'赢单商机数',oppWonAmount:`赢单金额${overview.oppCurrency?`（${E(overview.oppCurrency)}）`:''}`};
      const pkCell=(member,id)=>isMoney(id)?number(COLUMNS[id].value(member)):COLUMNS[id].value(member);
      return `<div class="team-body">${scopeNote(overview)}<div class="team-wall">`
        +`<section class="k-card team-wall-card team-countdown"><h3 class="k-card-title">倒计时</h3><div class="team-ring"><svg viewBox="0 0 120 120" role="img" aria-label="${clock.label} ${clock.left} 天"><circle cx="60" cy="60" r="54" class="team-ring-track"/><circle cx="60" cy="60" r="54" class="team-ring-value" stroke-dasharray="${(ring*clock.remaining).toFixed(1)} ${ring.toFixed(1)}" transform="rotate(-90 60 60)"/></svg><div class="team-ring-text"><strong>${clock.left}<small>天</small></strong><span>${clock.label}</span></div></div><span class="team-countdown-date">${E(clock.date)}</span></section>`
        +`<section class="k-card team-wall-card"><h3 class="k-card-title">成交订单金额</h3><span class="k-card-desc">${owned(overview)}</span><div class="team-figures"><div><strong>${amountLines(overview.total.amounts).join('<br>')}</strong><span class="team-cap">完成值</span></div><div><b>${targetShown('amount',amountGoals)}</b><span class="team-cap">目标值</span></div><div><b>${rateShown(amountGoals)}</b><span class="team-cap">完成率</span></div></div><div class="team-segbar" aria-hidden="true"><i style="width:${lowestRate(amountGoals)}%"></i></div></section>`
        +list('amount','成交订单金额排行榜',others?`按 ${E(currency)} 排名；其他币种见「订单业绩」。`:'')
        +list('added','新建客户数排行榜')+list('records','跟进记录数排行榜')
        +figure('新建客户数',overview.total.added)+figure('新建销售订单数',overview.total.orders)+figure('成交新客户数',overview.total.newDeal)
        // 赢单金额排行榜比数字卡片高，旁边两列各叠两张数字卡片，三列底边对齐。
        +list('oppWonAmount','赢单金额排行榜',(overview.total.oppAmounts||[]).length>1?`按 ${E(overview.oppCurrency)} 排名；其他币种见「商机分析」。`:'')
        +`<div class="team-stack">${figure('新建商机数',overview.total.oppNew??0)}${figure('赢单商机数',overview.total.oppWon??0,winRate)}</div>`
        // 原来这里是「任务完成率」（随协同去掉，D-031）；换成涉及客户数，两张数字卡片叠在一起和左边对齐。
        +`<div class="team-stack">${figure('复购客户数',overview.total.repeat)}${figure('涉及客户数',overview.total.customers)}</div>`
        +card('员工PK榜',`<span class="team-first">第一名：${first?E(first.member.label):'—'}</span>`,`${scroll(`<table class="k-table team-table team-board"><thead><tr><th>排名</th><th>成员</th>${pkIds.map(id=>`<th class="k-num"${id===pk.id?` aria-sort="${pk.dir==='asc'?'ascending':'descending'}"`:''}>${sortButton('data-team-wall-sort',id,id===pk.id?pk.dir:'',pkLabel[id])}</th>`).join('')}</tr></thead><tbody>${pk.rows.map(({member,rank})=>`<tr><td>${badge(rank)}</td><td>${E(member.label)}</td>${pkIds.map(id=>`<td class="k-num">${pkCell(member,id)}</td>`).join('')}</tr>`).join('')||`<tr><td colspan="${2+pkIds.length}" class="team-none">${unit(overview)}暂无数据</td></tr>`}</tbody></table>`)}<p class="team-note">成员按跟进人名称统计，不是员工账号${overview.scopeNote?'':'；「未分配」不参与排名'}。</p>`,'team-card-wide')
        +`</div></div>`;
    }

    // 导出成员排行榜：返回二维数组（表头＋每行），内容与页面当前页签、排序一致；纯文本，不含标记。
    function boardRows(overview,view={}){
      const tab=tabOf(view),ids=TABS[tab];
      const plain=(id,source)=>isMoney(id)?(moneyOf(id,source).length?moneyOf(id,source).map(item=>`${number(item.total)} ${item.currency}`).join(' / '):0):source[id]??0;
      const target=(id,list)=>list.length?list.map(goal=>isMoney(id)?`${number(goal.value)} ${goal.currency}`:goal.value).join(' / '):'';
      const rate=list=>list.length?list.map(goal=>`${goal.rate}%`).join(' / '):'';
      const head=['排名','成员',...ids.flatMap(id=>[`${COLUMNS[id].label} 完成值`,`${COLUMNS[id].label} 目标值`,`${COLUMNS[id].label} 完成率`])];
      const rows=ordered(overview,view.sort,ids).rows.map(({member,rank})=>[rank??'',member.label,...ids.flatMap(id=>{const list=goalList(member,id);const value=target(id,list);return [plain(id,member),list.length===1&&!isMoney(id)?list[0].value:value,rate(list)];})]);
      const total=['','合计',...ids.flatMap(id=>{const list=goalList(overview,id);return [plain(id,overview.total),list.length===1&&!isMoney(id)?list[0].value:target(id,list),rate(list)];})];
      return [head,...rows,total];
    }

    // ---------- 目标设置表单与目标管理列表 ----------
    function targetFormMarkup(overview,options={}){
      const ids=(overview.targetMetrics||[]).filter(id=>Object.hasOwn(COLUMNS,id));
      const metric=ids.includes(options.metric)?options.metric:ids[0];
      const names=overview.members.filter(member=>member.owner!=='').map(member=>member.label);
      const choice=(value,label,current)=>`<option value="${E(value)}"${String(value)===String(current)?' selected':''}>${E(label)}</option>`;
      // 出错时的提示写在抽屉底栏保存按钮旁边（biz-target-error，见 business-ui.js 的 showTargetForm）。
      return `<form class="k-dialog-body team-target-form" id="biz-target-form" novalidate data-form-check><div class="form-grid">`
        +`<label class="field">指标<select name="metric">${ids.map(id=>choice(id,COLUMNS[id].label,metric)).join('')}</select></label>`
        +`<label class="field">周期<select name="period">${(options.periods||[]).map(item=>choice(item.key,item.label,options.period)).join('')}</select></label>`
        +`<label class="field">对象<select name="scope">${choice('company','企业整体','company')}${choice('member','成员（跟进人）','company')}</select></label>`
        +`<label class="field" hidden>成员<select name="owner" disabled><option value="">请选择成员</option>${names.map(name=>choice(name,name,'')).join('')}</select></label>`
        +`<label class="field"${isMoney(metric)?'':' hidden'}>币种<input name="currency" value="${E(options.currency||overview.primaryCurrency||'USD')}" maxlength="3" autocomplete="off" aria-describedby="biz-target-currency-note" class="k-input"${isMoney(metric)?'':' disabled'}><span class="team-hint" id="biz-target-currency-note">三位代码，例如 USD；不同币种的目标分开设置</span></label>`
        +`<label class="field">目标值<input name="value" value="${E(options.value??'')}" inputmode="decimal" autocomplete="off" class="k-input" required></label></div>`
        +`<p class="team-hint">同一周期、对象、指标（金额类再加币种）只保留一个目标，再次保存会覆盖。完成率＝完成值÷目标值。成员是跟进人名称，不是员工账号。</p></form>`;
    }
    // armedKey：已经点过一次「删除」、等待再次确认的那一条。
    function targetsMarkup(targets,periodLabel,armedKey=''){
      const value=target=>isMoney(target.metric)?`${number(target.value)} ${E(target.currency)}`:String(target.value);
      const who=target=>target.owner===null?'企业整体':E(target.owner);
      const actions=target=>{
        if(!can('team.targets'))return '';
        const armed=target.key===armedKey;
        return `<button type="button" class="k-btn k-btn--sm ${armed?'k-btn--danger team-danger':'k-btn--ghost'}" data-team-target-remove="${E(target.key)}" aria-label="${armed?'再点一次确认删除':'删除目标'}：${E(periodLabel(target.period))} ${who(target)} ${E(COLUMNS[target.metric]?.label||target.metric)}">${armed?'再点一次确认删除':'删除'}</button>${armed?'<button type="button" class="k-btn k-btn--ghost k-btn--sm" data-team-target-cancel="1">取消</button>':''}`;
      };
      const rows=targets.map(target=>`<tr><td>${E(periodLabel(target.period))}</td><td>${who(target)}</td><td>${E(COLUMNS[target.metric]?.label||target.metric)}</td><td class="k-num">${value(target)}</td><td class="team-acts">${actions(target)}</td></tr>`).join('');
      return `<div class="team-body">${card('已设置的目标',desc(`共 ${targets.length} 个`),rows
        ?scroll(`<table class="k-table team-table team-targets"><thead><tr><th>周期</th><th>对象</th><th>指标</th><th class="k-num">目标值</th><th class="team-acts">操作</th></tr></thead><tbody>${rows}</tbody></table>`)
        :'<div class="k-empty"><p class="k-empty-title">还没有设置任何目标</p><span>可在「目标完成情况」里点「设置目标值」或「新建目标」。</span></div>')}</div>`;
    }
    return {markup,itemsFor,detailMarkup,goalsMarkup,wallMarkup,countdown,ranked,boardRows,targetFormMarkup,targetsMarkup,columns:COLUMNS,tabs:TABS,tabLabels:TAB_LABELS,isMoney};
  }
  const api={create,DETAIL_LIMIT};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LaiTeamUI=api;
})(typeof window!=='undefined'?window:globalThis);
