(function(root){
  'use strict';
  // 商机页面的纯标记生成：看板、列表、表单、操作菜单、输单表单、分析。不读写数据。
  const PAGE=30;
  const CURRENCIES=['USD','EUR','CNY','GBP','JPY','HKD','TWD','AUD','CAD'];
  const number=value=>Number(value||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  function create(E,model){
    const money=(value,currency)=>`${E(currency)} ${number(value)}`;
    const option=(value,label,current)=>`<option value="${E(value)}"${String(value)===String(current)?' selected':''}>${E(label)}</option>`;
    // 结束日期：今年的只显示月-日，其他年份显示完整日期（与参考界面一致）。
    const shortDate=(day,today)=>day&&String(day).slice(0,4)===String(today).slice(0,4)?String(day).slice(5):String(day||'—');
    const stageLabel=id=>model.STAGES.find(stage=>stage.id===id)?.label||id;

    function cardMarkup(card,today){
      return `<article class="opp-card${card.archived?' is-archived':''}" draggable="true" data-opp-id="${E(card.id)}">`
        +`<div class="opp-card-head">${card.overdue?'<span class="opp-overdue" title="已过结束日期" aria-label="已过结束日期">ⓘ</span>':''}<button type="button" class="company-link opp-card-name" data-opp-action="edit" data-id="${E(card.id)}">${E(card.name)}</button><button type="button" class="text-button opp-card-menu" data-opp-action="menu" data-id="${E(card.id)}" aria-label="更多操作：${E(card.name)}">⋮</button></div>`
        +`<div class="opp-card-line">${E(card.currency)}：${number(card.amount)}</div>`
        +`<div class="opp-card-line"><button type="button" class="company-link" data-biz-customer="${E(card.client)}">${E(card.client)}</button></div>`
        +`<div class="opp-card-line muted">负责人：${E(card.owner||'—')}</div>`
        +`<div class="opp-card-line muted">结束日期：${E(shortDate(card.endDate,today))}</div>`
        +(card.lostReason?`<div class="opp-card-line muted">输单原因：${E(card.lostReason)}</div>`:'')
        +(card.orderId?`<div class="opp-card-line"><button type="button" class="company-link" data-biz-order="${E(card.orderId)}">查看关联订单</button></div>`:'')
        +`</article>`;
    }
    function toolbar(board,view,context){
      const f=board.filters;
      return `<div class="opp-toolbar"><span class="opp-count">共 <b>${board.count}</b> 个商机</span>`
        +`<input type="search" id="opp-search" value="${E(f.search)}" placeholder="搜索名称、客户、联系人、标签" aria-label="搜索商机">`
        +`<select id="opp-sort" aria-label="排序">${model.SORTS.map(([id,label])=>option(id,label,f.sort)).join('')}</select>`
        +`<select id="opp-flow" aria-label="销售流程">${model.FLOWS.map(flow=>option(flow.id,flow.label,'default')).join('')}</select>`
        +`<span class="opp-range"><select id="opp-date-field" aria-label="日期类型">${option('createdAt','创建时间',f.dateField)}${option('endDate','结束日期',f.dateField)}</select><input type="date" id="opp-from" value="${E(f.from)}" aria-label="开始日期"><span aria-hidden="true">→</span><input type="date" id="opp-to" value="${E(f.to)}" aria-label="结束日期"></span>`
        +`<select id="opp-archived" aria-label="归档状态">${option('active','未归档',f.archived)}${option('archived','已归档',f.archived)}${option('all','全部',f.archived)}</select>`
        +`<span class="team-segment opp-view" role="group" aria-label="视图"><button type="button" data-opp-view="board" aria-pressed="${view.mode!=='list'}">看板</button><button type="button" data-opp-view="list" aria-pressed="${view.mode==='list'}">列表</button></span></div>`;
    }
    function totals(board){
      return `<div class="opp-totals"><select id="opp-currency" aria-label="币种">${(board.currencies.length?board.currencies:[board.currency]).map(code=>option(code,code,board.currency)).join('')}</select>`
        +`<span>总销售金额：<b>${money(board.totals.total,board.currency)}</b></span><span class="opp-totals-rule" aria-hidden="true"></span>`
        +`<span>进行中金额：<b class="opp-open">${money(board.totals.open,board.currency)}</b></span><span>赢单金额：<b class="opp-won">${money(board.totals.won,board.currency)}</b></span>`
        +(board.otherCurrencyCount?`<span class="muted tiny">另有 ${board.otherCurrencyCount} 个其他币种的商机，切换左侧币种查看；不同币种不折算。</span>`:'')+`</div>`;
    }
    function columns(board,view,today){
      return `<div class="opp-board">${board.columns.map(column=>{
        const limit=Math.max(PAGE,Number(view.limits?.[column.id])||PAGE);
        const shown=column.cards.slice(0,limit),rest=column.cards.length-shown.length;
        return `<section class="opp-column opp-kind-${column.kind}" data-opp-drop="${column.id}" aria-label="${E(column.label)}，${column.count} 个">`
          +`<header class="opp-stage"><span>${E(column.label)}(${column.count})</span></header><div class="opp-stage-amount">${money(column.amount,board.currency)}</div>`
          +`<div class="opp-cards">${shown.map(card=>cardMarkup(card,today)).join('')||'<p class="opp-empty muted tiny">暂无商机</p>'}${rest>0?`<button type="button" class="opp-more" data-opp-action="more" data-stage="${column.id}">再显示 ${Math.min(PAGE,rest)} 个（还有 ${rest} 个）</button>`:''}</div></section>`;
      }).join('')}</div>`;
    }
    function table(board,view,today){
      const limit=Math.max(PAGE,Number(view.limits?.list)||PAGE);
      const shown=board.cards.slice(0,limit),rest=board.cards.length-shown.length;
      return `<section class="business-section"><div class="team-table-scroll"><table class="order-table team-table"><thead><tr><th>商机名称</th><th>客户</th><th>销售金额</th><th>销售阶段</th><th>负责人</th><th>结束日期</th><th>创建日期</th><th>操作</th></tr></thead><tbody>${shown.map(card=>`<tr><td>${card.overdue?'<span class="opp-overdue" title="已过结束日期" aria-label="已过结束日期">ⓘ</span> ':''}<button type="button" class="company-link" data-opp-action="edit" data-id="${E(card.id)}">${E(card.name)}</button></td><td><button type="button" class="company-link" data-biz-customer="${E(card.client)}">${E(card.client)}</button></td><td>${money(card.amount,card.currency)}</td><td>${E(stageLabel(card.stage))}</td><td>${E(card.owner||'—')}</td><td>${E(card.endDate||'—')}</td><td>${E(card.createdDay||'—')}</td><td><button type="button" class="text-button" data-opp-action="menu" data-id="${E(card.id)}" aria-label="更多操作：${E(card.name)}">⋮</button></td></tr>`).join('')||'<tr><td colspan="8">暂无商机</td></tr>'}</tbody></table></div>${rest>0?`<button type="button" class="opp-more" data-opp-action="more" data-stage="list">再显示 ${Math.min(PAGE,rest)} 个（还有 ${rest} 个）</button>`:''}</section>`;
    }
    const boardMarkup=(board,view={},context={})=>`<div class="business-scroll opp-page">${toolbar(board,view,context)}${totals(board)}${view.mode==='list'?table(board,view,context.today):columns(board,view,context.today)}</div>`;
    const headerActions=(board,context={})=>`<select id="opp-owner" aria-label="负责人"><option value="">全部负责人</option>${(context.owners||[]).map(name=>option(name,name,board.filters.owner&&name.toLowerCase()===board.filters.owner.toLowerCase()?name:'')).join('')}</select><button type="button" class="primary" data-opp-action="new">新建商机</button>`;

    // 表单：values 是当前填写内容（重新绘制时保留），context 提供可选的客户、联系人、负责人。
    function formMarkup(values,context={}){
      const v=values||{},isLost=v.stage==='lost',custom=v.nameMode==='custom',usd=String(v.currency||'USD').toUpperCase()==='USD';
      const contacts=context.contacts||[];
      const list=value=>Array.isArray(value)?value.join('，'):String(value??'');
      const products=Array.isArray(v.products)?model.productsText(v.products):String(v.products??'');
      let subtotal='';
      try{const rows=model.parseProducts(products);if(rows.length)subtotal=`共 ${rows.length} 项，合计 ${number(rows.reduce((sum,row)=>sum+row.quantity*row.unitPrice,0))}（仅供参考，不会改动销售金额）`;}catch{subtotal='';}
      return `<form class="drawer-body opp-form" id="opp-form"><div class="error" id="opp-error" role="alert"></div><div class="form-section">基本信息</div><div class="form-grid">`
        +`<fieldset class="field opp-name"><legend>商机名称 <span class="opp-required" aria-hidden="true">*</span></legend><label><input type="radio" name="nameMode" value="auto"${custom?'':' checked'}> 自动生成</label><label><input type="radio" name="nameMode" value="custom"${custom?' checked':''}> 自定义</label>${custom?`<input name="name" value="${E(v.name||'')}" placeholder="请输入商机名称" aria-label="商机名称" required>`:`<span class="muted tiny">${context.isNew?'保存时按「日期＋当天序号-负责人」生成，例如 26100601-Amy':E(v.name||'')}</span>`}</fieldset>`
        +`<label class="field">客户 <span class="opp-required" aria-hidden="true">*</span><input name="client" id="opp-client" value="${E(v.client||'')}" list="opp-client-list" placeholder="输入或选择客户" autocomplete="off" required><datalist id="opp-client-list">${(context.customers||[]).map(name=>`<option value="${E(name)}"></option>`).join('')}</datalist></label>`
        +`<label class="field">关联联系人${contacts.length?' <span class="opp-required" aria-hidden="true">*</span>':''}<select name="contact"${contacts.length?' required':''}>${contacts.length?`<option value="">请选择</option>${contacts.map(name=>option(name,name,v.contact)).join('')}`:`<option value="">${v.client?'该客户没有联系人，可留空':'请先选择客户'}</option>`}</select></label>`
        +`<label class="field">销售金额 <span class="opp-required" aria-hidden="true">*</span><input name="amount" value="${E(v.amount??'')}" inputmode="decimal" autocomplete="off" required></label>`
        +`<label class="field">结束日期 <span class="opp-required" aria-hidden="true">*</span><input name="endDate" type="date" value="${E(v.endDate||'')}" required></label>`
        +`<label class="field">销售流程 <span class="opp-required" aria-hidden="true">*</span><select name="flow">${model.FLOWS.map(flow=>option(flow.id,flow.label,v.flow||'default')).join('')}</select></label>`
        +`<label class="field">汇率 <span class="opp-required" aria-hidden="true">*</span><input name="exchangeRate" value="${E(usd?100:v.exchangeRate??100)}" inputmode="decimal"${usd?' readonly':''} aria-describedby="opp-rate-note"><span class="muted tiny" id="opp-rate-note">每 100 外币折合多少美元，仅作记录；美元固定为 100</span></label>`
        +`<label class="field">币种 <span class="opp-required" aria-hidden="true">*</span><input name="currency" id="opp-form-currency" value="${E(v.currency||'USD')}" list="opp-currency-list" maxlength="3" autocomplete="off" required><datalist id="opp-currency-list">${CURRENCIES.map(code=>`<option value="${code}"></option>`).join('')}</datalist></label>`
        +`<label class="field">销售阶段 <span class="opp-required" aria-hidden="true">*</span><select name="stage" id="opp-form-stage">${model.STAGES.map(stage=>option(stage.id,stage.label,v.stage||'open')).join('')}</select></label>`
        +`<label class="field">负责人 <span class="opp-required" aria-hidden="true">*</span><input name="owner" value="${E(v.owner||'')}" list="opp-owner-list" autocomplete="off" required><datalist id="opp-owner-list">${(context.owners||[]).map(name=>`<option value="${E(name)}"></option>`).join('')}</datalist></label>`
        +(isLost?`<label class="field">输单原因 <span class="opp-required" aria-hidden="true">*</span><select name="lostReason" required><option value="">请选择</option>${model.LOST_REASONS.map(reason=>option(reason,reason,v.lostReason)).join('')}</select></label><label class="field">输单说明<input name="lostNote" value="${E(v.lostNote||'')}"></label>`:'')
        +`<label class="field">协同跟进人<input name="collaborators" value="${E(list(v.collaborators))}" placeholder="多人用逗号分隔"></label>`
        +`<label class="field">商机标签<input name="tags" value="${E(list(v.tags))}" placeholder="多个标签用逗号分隔"></label>`
        +`<label class="field wide">备注<textarea name="note" rows="3">${E(v.note||'')}</textarea></label></div>`
        +`<div class="form-section">关联产品</div><label class="field wide">每行一个产品：名称, 数量, 单价<textarea name="products" rows="4" placeholder="例如：假睫毛 A, 10, 2.5">${E(products)}</textarea>${subtotal?`<span class="muted tiny">${subtotal}</span>`:''}</label></form>`;
    }
    function menuMarkup(card,armed=false){
      const stage=model.STAGES.find(item=>item.id===card.stage);
      const moves=model.STAGES.filter(item=>item.id!==card.stage).map(item=>`<button type="button" data-opp-action="move" data-id="${E(card.id)}" data-stage="${item.id}">移到「${E(item.label)}」</button>`).join('');
      return `<div class="drawer-body opp-menu"><p class="muted tiny">${E(card.client)} · ${money(card.amount,card.currency)} · 当前阶段：${E(stage?.label||card.stage)}</p>`
        +`<div class="opp-menu-group"><button type="button" class="primary" data-opp-action="edit" data-id="${E(card.id)}">编辑商机</button>${stage?.kind==='won'&&!card.orderId?`<button type="button" data-opp-action="order" data-id="${E(card.id)}">生成订单</button>`:''}${card.orderId?`<button type="button" data-biz-order="${E(card.orderId)}">查看关联订单</button>`:''}</div>`
        +`<h3>调整销售阶段</h3><div class="opp-menu-group">${moves}</div><h3>其他</h3><div class="opp-menu-group"><button type="button" data-opp-action="archive" data-id="${E(card.id)}" data-archived="${card.archived?'0':'1'}">${card.archived?'取消归档':'归档'}</button><button type="button" class="${armed?'team-danger':''}" data-opp-action="delete" data-id="${E(card.id)}">${armed?'再点一次确认删除（不可恢复）':'删除商机'}</button></div><div class="error" id="opp-menu-error" role="alert"></div></div>`;
    }
    const lostMarkup=card=>`<form class="drawer-body" id="opp-lost-form" data-id="${E(card.id)}"><div class="error" id="opp-lost-error" role="alert"></div><p>把「${E(card.name)}」移到输单，需要记录原因，方便之后分析。</p><div class="form-grid"><label class="field">输单原因 <span class="opp-required" aria-hidden="true">*</span><select name="lostReason" required><option value="">请选择</option>${model.LOST_REASONS.map(reason=>option(reason,reason,'')).join('')}</select></label><label class="field">输单说明<input name="lostNote" placeholder="可选"></label></div></form>`;

    function analysisMarkup(report,view={}){
      const s=report.summary,c=report.currency;
      const tile=(label,value,note='')=>`<div class="team-tile"><span>${label}</span><strong>${value}</strong>${note?`<span class="muted tiny">${note}</span>`:''}</div>`;
      const percent=value=>value===null?'—':`${value}%`;
      const max=Math.max(1,...report.stages.map(stage=>stage.count));
      return `<div class="business-scroll opp-page"><div class="opp-totals"><select id="opp-analysis-currency" aria-label="币种">${(report.currencies.length?report.currencies:[c]).map(code=>option(code,code,c)).join('')}</select>${report.otherCurrencyCount?`<span class="muted tiny">另有 ${report.otherCurrencyCount} 个其他币种的商机未计入本页；不同币种不折算。</span>`:''}</div>`
        +`<div class="team-tiles">${tile('新建商机数',s.created)}${tile('进行中',s.open,money(s.openAmount,c))}${tile('赢单',s.won,money(s.wonAmount,c))}${tile('输单',s.lost,money(s.lostAmount,c))}${tile('赢单率',percent(s.winRate),'赢单 ÷（赢单＋输单）')}${tile('平均成交周期',s.averageDays===null?'—':`${s.averageDays} 天`,'创建到首次赢单')}</div>`
        +`<div class="business-columns"><section class="business-section"><div class="section-head"><h3>销售阶段分布</h3><span class="muted tiny">按商机数量</span></div><div class="stage-bars">${report.stages.map(stage=>`<div><span>${E(stage.label)}</span><div><i style="width:${Math.round(stage.count/max*100)}%"></i></div><b>${stage.count}（${stage.percent}%）</b></div>`).join('')}</div><table class="order-table team-table"><thead><tr><th>阶段</th><th>数量</th><th>金额</th></tr></thead><tbody>${report.stages.map(stage=>`<tr><td>${E(stage.label)}</td><td>${stage.count}</td><td>${money(stage.amount,c)}</td></tr>`).join('')}</tbody></table></section>`
        +`<section class="business-section"><div class="section-head"><h3>输单原因</h3></div><table class="order-table team-table"><thead><tr><th>原因</th><th>数量</th><th>金额</th></tr></thead><tbody>${report.lostReasons.map(row=>`<tr><td>${E(row.reason)}</td><td>${row.count}</td><td>${money(row.amount,c)}</td></tr>`).join('')||'<tr><td colspan="3">所选范围内没有输单</td></tr>'}</tbody></table></section></div>`
        +`<section class="business-section"><div class="section-head"><h3>按负责人</h3><span class="muted tiny">按商机上填写的负责人名称汇总，只差大小写的算同一个人</span></div><div class="team-table-scroll"><table class="order-table team-table"><thead><tr><th>负责人</th><th>新建</th><th>进行中</th><th>赢单</th><th>输单</th><th>赢单金额</th><th>赢单率</th><th>平均成交周期</th></tr></thead><tbody>${report.owners.map(row=>`<tr><td>${E(row.owner)}</td><td>${row.created}</td><td>${row.open}</td><td>${row.won}</td><td>${row.lost}</td><td>${money(row.wonAmount,c)}</td><td>${percent(row.winRate)}</td><td>${row.averageDays===null?'—':row.averageDays+' 天'}</td></tr>`).join('')||'<tr><td colspan="8">所选范围内没有商机</td></tr>'}</tbody></table></div></section></div>`;
    }
    return {boardMarkup,headerActions,cardMarkup,formMarkup,menuMarkup,lostMarkup,analysisMarkup,shortDate};
  }
  const api={create,PAGE};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LaiOpportunityUI=api;
})(typeof window!=='undefined'?window:globalThis);
