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
    // 卡片自带所在流程的阶段名称和类别；旧调用没带时按默认流程查。
    const kindOf=card=>card.kind||model.STAGES.find(stage=>stage.id===card.stage)?.kind||'open';
    const stageLabel=card=>card.stageLabel||model.STAGES.find(stage=>stage.id===card.stage)?.label||card.stage;
    const flowSelect=(id,flows,current)=>flows&&flows.length>1?`<select id="${id}" aria-label="销售流程">${flows.map(flow=>option(flow.id,`${flow.label}（${flow.count}）`,current)).join('')}</select>`:'';

    // 卡片：名称、金额、客户是主信息；负责人和结束日期放在底部一行；逾期、输单原因、关联订单用小标签。
    function cardMarkup(card,today){
      // 进行中的商机才谈得上“截止”；已赢单、已输单的只显示日期。
      const closed=kindOf(card)!=='open';
      const due=card.endDate?(card.overdue?`<span class="opp-due is-overdue">逾期 ${E(shortDate(card.endDate,today))}</span>`:`<span class="opp-due">${E(shortDate(card.endDate,today))}${closed?'':' 截止'}</span>`):'';
      return `<article class="opp-card${card.archived?' is-archived':''}" draggable="true" data-opp-id="${E(card.id)}">`
        +`<div class="opp-card-head"><button type="button" class="opp-card-name" data-opp-action="edit" data-id="${E(card.id)}">${E(card.name)}</button><button type="button" class="opp-card-menu" data-opp-action="menu" data-id="${E(card.id)}" aria-label="更多操作：${E(card.name)}">⋮</button></div>`
        +`<div class="opp-card-amount"><small>${E(card.currency)}</small>${number(card.amount)}</div>`
        +`<button type="button" class="opp-card-client" data-biz-customer="${E(card.client)}">${E(card.client)}</button>`
        +(card.lostReason||card.orderId||card.archived?`<div class="opp-card-tags">${card.lostReason?`<span class="opp-chip">输单原因：${E(card.lostReason)}</span>`:''}${card.archived?'<span class="opp-chip">已归档</span>':''}${card.orderId?`<button type="button" class="opp-chip is-link" data-biz-order="${E(card.orderId)}">查看关联订单</button>`:''}</div>`:'')
        +`<div class="opp-card-foot"><span class="opp-owner"><i class="opp-avatar" aria-hidden="true">${E((card.owner||'—').slice(0,1).toUpperCase())}</i><span class="opp-owner-name">${E(card.owner||'未填负责人')}</span></span>${due}</div>`
        +`</article>`;
    }
    // 筛选条：左边是「找哪些商机」，右边是「怎么排」。
    function toolbar(board,view,context){
      const f=board.filters;
      const owners=(context.owners||[]).map(name=>option(name,name,f.owner&&name.toLowerCase()===f.owner.toLowerCase()?name:'')).join('');
      return `<div class="opp-toolbar">${viewSwitch(view,' opp-view-in')}${flowSelect('opp-flow',board.flows,board.flow)}<span class="opp-count">共 <b>${board.count}</b> 个商机</span>`
        +`<input type="search" id="opp-search" value="${E(f.search)}" placeholder="搜索名称、客户、联系人、标签" aria-label="搜索商机">`
        +`<select id="opp-owner" aria-label="负责人"><option value="">全部负责人</option>${owners}</select>`
        +`<select id="opp-archived" aria-label="归档状态">${option('active','未归档',f.archived)}${option('archived','已归档',f.archived)}${option('all','全部',f.archived)}</select>`
        +`<span class="opp-range"><select id="opp-date-field" aria-label="日期类型">${option('createdAt','创建时间',f.dateField)}${option('endDate','结束日期',f.dateField)}</select><input type="date" id="opp-from" value="${E(f.from)}" aria-label="开始日期"><span aria-hidden="true">至</span><input type="date" id="opp-to" value="${E(f.to)}" aria-label="结束日期"></span>`
        +`<select id="opp-sort" class="opp-sort" aria-label="排序">${model.SORTS.map(([id,label])=>option(id,label,f.sort)).join('')}</select></div>`;
    }
    // 金额汇总：一种币种的三个数字并排，输单单独放在最后、颜色放轻。
    function totals(board){
      const stat=(label,value,cls='')=>`<div class="opp-stat${cls?' '+cls:''}"><span>${label}</span><b>${money(value,board.currency)}</b></div>`;
      return `<div class="opp-summary"><label class="opp-currency"><span>币种</span><select id="opp-currency" aria-label="币种">${(board.currencies.length?board.currencies:[board.currency]).map(code=>option(code,code,board.currency)).join('')}</select></label>`
        +stat('总销售金额',board.totals.total,'is-total')+stat('进行中',board.totals.open,'is-open')+stat('赢单',board.totals.won,'is-won')+stat('输单',board.totals.lost,'is-lost')
        +(board.otherCurrencyCount?`<p class="opp-summary-note">另有 ${board.otherCurrencyCount} 个其他币种的商机，切换币种查看；不同币种不折算。</p>`:'')
        +(board.otherFlowCount?`<p class="opp-summary-note">另有 ${board.otherFlowCount} 个符合当前筛选的商机在其他销售流程里（${(board.flows||[]).filter(flow=>flow.id!==board.flow&&flow.count).map(flow=>`${E(flow.label)} ${flow.count} 个`).join('、')}），在左上角切换流程查看。</p>`:'')+`</div>`;
    }
    function columns(board,view,today){
      return `<div class="opp-board">${board.columns.map(column=>{
        const limit=Math.max(PAGE,Number(view.limits?.[column.id])||PAGE);
        const shown=column.cards.slice(0,limit),rest=column.cards.length-shown.length;
        return `<section class="opp-column opp-kind-${column.kind}" data-opp-drop="${E(column.id)}" aria-label="${E(column.label)}，${column.count} 个">`
          +`<header class="opp-stage"><span class="opp-stage-name">${E(column.label)}</span><span class="opp-stage-count">${column.count}</span><span class="opp-stage-amount">${money(column.amount,board.currency)}</span></header>`
          +`<div class="opp-cards">${shown.map(card=>cardMarkup(card,today)).join('')||'<p class="opp-empty">暂无商机</p>'}${rest>0?`<button type="button" class="opp-more" data-opp-action="more" data-stage="${E(column.id)}">再显示 ${Math.min(PAGE,rest)} 个（还有 ${rest} 个）</button>`:''}</div></section>`;
      }).join('')}</div>`;
    }
    function table(board,view,today){
      const limit=Math.max(PAGE,Number(view.limits?.list)||PAGE);
      const shown=board.cards.slice(0,limit),rest=board.cards.length-shown.length;
      return `<section class="business-section opp-list"><div class="team-table-scroll"><table class="order-table team-table"><thead><tr><th>商机名称</th><th>客户</th><th>销售金额</th><th>销售阶段</th><th>负责人</th><th>结束日期</th><th>创建日期</th><th>操作</th></tr></thead><tbody>${shown.map(card=>`<tr><td><button type="button" class="company-link" data-opp-action="edit" data-id="${E(card.id)}">${E(card.name)}</button></td><td><button type="button" class="company-link" data-biz-customer="${E(card.client)}">${E(card.client)}</button></td><td class="opp-num">${money(card.amount,card.currency)}</td><td><span class="opp-chip opp-stage-chip opp-kind-${kindOf(card)}">${E(stageLabel(card))}</span></td><td>${E(card.owner||'—')}</td><td>${card.overdue?`<span class="opp-due is-overdue">逾期 ${E(card.endDate)}</span>`:E(card.endDate||'—')}</td><td>${E(card.createdDay||'—')}</td><td><button type="button" class="text-button" data-opp-action="menu" data-id="${E(card.id)}" aria-label="更多操作：${E(card.name)}">⋮</button></td></tr>`).join('')||'<tr><td colspan="8">暂无商机</td></tr>'}</tbody></table></div>${rest>0?`<button type="button" class="opp-more" data-opp-action="more" data-stage="list">再显示 ${Math.min(PAGE,rest)} 个（还有 ${rest} 个）</button>`:''}</section>`;
    }
    const boardMarkup=(board,view={},context={})=>`<div class="business-scroll opp-page">${toolbar(board,view,context)}${totals(board)}${view.mode==='list'?table(board,view,context.today):columns(board,view,context.today)}</div>`;
    // 看板／列表切换：旧版式放在页头；新界面（粉色、橙色）放进筛选卡片里，两处只显示一处（见 skin-glass.css）。
    const viewSwitch=(view={},extra='')=>`<span class="team-segment opp-view${extra}" role="group" aria-label="视图"><button type="button" data-opp-view="board" aria-pressed="${view.mode!=='list'}">看板</button><button type="button" data-opp-view="list" aria-pressed="${view.mode==='list'}">列表</button></span>`;
    const headerActions=(board,context={},view={})=>`${viewSwitch(view)}<button type="button" class="opp-analysis-link" data-lai-route="opp-analysis">商机分析</button><button type="button" class="primary" data-opp-action="new">新建商机</button>`;

    // 联系人下拉的选项。原来选的联系人如果已不在客户的联系人里，仍然保留为一个选项，避免编辑别的内容时被悄悄清掉。
    function contactOptions(contacts,value,client){
      const stale=value&&!contacts.includes(value)?`<option value="${E(value)}" selected>${E(value)}（已不在该客户的联系人中）</option>`:'';
      if(!contacts.length)return stale+`<option value=""${stale?'':' selected'}>${client?'该客户没有联系人，可留空':'请先选择客户'}</option>`;
      return `<option value="">请选择</option>${contacts.map(name=>option(name,name,value)).join('')}${stale}`;
    }
    // 阶段下拉的选项；原来的阶段如果已不在流程里，仍保留为一个选项。
    const stageOptions=(stages,value)=>stages.map(stage=>option(stage.id,stage.label,value||stages[0]?.id)).join('')+(value&&!stages.some(stage=>stage.id===value)?`<option value="${E(value)}" selected>原阶段：${E(value)}</option>`:'');
    // 表单：values 是要显示的内容，context 提供可选的客户、联系人、负责人。会随填写变化的部分（名称输入、联系人、汇率、输单原因）都带 id，由页面就地更新，不重画整个表单。
    function formMarkup(values,context={}){
      const v=values||{},isLost=v.stage==='lost',custom=v.nameMode==='custom',usd=String(v.currency||'USD').toUpperCase()==='USD';
      const contacts=context.contacts||[];
      const list=value=>Array.isArray(value)?value.join('，'):String(value??'');
      const products=Array.isArray(v.products)?model.productsText(v.products):String(v.products??'');
      let subtotal='';
      try{const rows=model.parseProducts(products);if(rows.length)subtotal=`共 ${rows.length} 项，合计 ${number(rows.reduce((sum,row)=>sum+row.quantity*row.unitPrice,0))}（仅供参考，不会改动销售金额）`;}catch{subtotal='';}
      const req='<i class="opp-req" aria-hidden="true">*</i>';
      // 每个字段：标签一行（必填星号紧跟文字），控件一行，可选的说明一行。
      const field=(label,control,{required=false,wide=false,hidden=false,hint=''}={})=>`<label class="opp-field${wide?' is-wide':''}"${hidden?' hidden':''}><span class="opp-field-label">${label}${required?req:''}</span>${control}${hint?`<span class="opp-field-hint">${hint}</span>`:''}</label>`;
      // 阶段跟着销售流程走；只有一个流程时不显示流程选择。
      const flows=context.flows||[],stages=context.stages||model.STAGES;
      const flow=flows.length>1?field('销售流程',`<select name="flow" id="opp-form-flow">${flows.map(item=>option(item.id,item.label,v.flow||'default')).join('')}</select>`,{required:true}):`<input type="hidden" name="flow" value="${E(v.flow||'default')}">`;
      return `<form class="drawer-body opp-form" id="opp-form"><div class="error" id="opp-error" role="alert"></div>`
        +`<div class="form-section">基本信息</div><div class="opp-grid">`
        +`<fieldset class="opp-field is-wide opp-name"><legend class="opp-field-label">商机名称${req}</legend><div class="opp-name-row"><span class="opp-seg"><label><input type="radio" name="nameMode" value="auto"${custom?'':' checked'}><span>自动生成</span></label><label><input type="radio" name="nameMode" value="custom"${custom?' checked':''}><span>自定义</span></label></span><input name="name" value="${E(custom?v.name||'':'')}" placeholder="请输入商机名称" aria-label="商机名称"${custom?' required':' hidden disabled'}><span class="opp-field-hint" id="opp-name-note"${custom?' hidden':''}>${context.isNew||v.nameMode==='custom'||!v.name?'保存时按「日期＋当天序号-负责人」生成，例如 26100601-Amy':E(v.name)}</span></div></fieldset>`
        +field('客户',`<input name="client" id="opp-client" value="${E(v.client||'')}" list="opp-client-list" placeholder="输入或选择客户" autocomplete="off" required><datalist id="opp-client-list">${(context.customers||[]).map(name=>`<option value="${E(name)}"></option>`).join('')}</datalist>`,{required:true})
        +field('关联联系人',`<select name="contact"${contacts.length?' required':''}>${contactOptions(contacts,String(v.contact||''),v.client)}</select>`)
        +field('负责人',`<input name="owner" value="${E(v.owner||'')}" list="opp-owner-list" autocomplete="off" required><datalist id="opp-owner-list">${(context.owners||[]).map(name=>`<option value="${E(name)}"></option>`).join('')}</datalist>`,{required:true})
        +field('协同跟进人',`<input name="collaborators" value="${E(list(v.collaborators))}" placeholder="多人用逗号分隔">`)
        +`</div><div class="form-section">金额与进度</div><div class="opp-grid">`
        +`<div class="opp-field"><span class="opp-field-label" id="opp-amount-label">销售金额${req}</span><span class="opp-group"><input name="currency" id="opp-form-currency" class="opp-group-currency" value="${E(v.currency||'USD')}" list="opp-currency-list" maxlength="3" autocomplete="off" aria-label="币种" required><datalist id="opp-currency-list">${CURRENCIES.map(code=>`<option value="${code}"></option>`).join('')}</datalist><input name="amount" value="${E(v.amount??'')}" inputmode="decimal" autocomplete="off" aria-labelledby="opp-amount-label" placeholder="0.00" required></span></div>`
        +(flows.length>1?flow:'')
        +field('销售阶段',`<select name="stage" id="opp-form-stage">${stageOptions(stages,v.stage)}</select>`,{required:true})
        +field('结束日期',`<input name="endDate" type="date" value="${E(v.endDate||'')}" required>`,{required:true})
        +field('汇率',`<input name="exchangeRate" value="${E(usd?100:v.exchangeRate??100)}" data-rate="${E(v.exchangeRate??100)}" inputmode="decimal"${usd?' readonly':''} aria-describedby="opp-rate-note">`,{required:true,hidden:usd,hint:'<span id="opp-rate-note">每 100 外币折合多少美元，仅作记录</span>'})
        +field('输单原因',`<select name="lostReason"${isLost?' required':' disabled'}><option value="">请选择</option>${model.LOST_REASONS.map(reason=>option(reason,reason,v.lostReason)).join('')}${v.lostReason&&!model.LOST_REASONS.includes(v.lostReason)?`<option value="${E(v.lostReason)}" selected>${E(v.lostReason)}</option>`:''}</select>`,{required:true,hidden:!isLost})
        +field('输单说明',`<input name="lostNote" value="${E(v.lostNote||'')}"${isLost?'':' disabled'}>`,{hidden:!isLost})
        +(flows.length>1?'':flow)
        +`</div><div class="form-section">补充信息</div><div class="opp-grid">`
        +field('商机标签',`<input name="tags" value="${E(list(v.tags))}" placeholder="多个标签用逗号分隔">`,{wide:true})
        +field('备注',`<textarea name="note" rows="3">${E(v.note||'')}</textarea>`,{wide:true})
        +field('关联产品',`<textarea name="products" rows="4" placeholder="每行一个产品：名称, 数量, 单价&#10;例如：假睫毛 A, 10, 2.5">${E(products)}</textarea>`,{wide:true,hint:subtotal})
        +`</div></form>`;
    }
    function menuMarkup(card,armed=false){
      const stages=card.stages||model.STAGES;
      const stage=stages.find(item=>item.id===card.stage);
      const moves=stages.filter(item=>item.id!==card.stage).map(item=>`<button type="button" class="opp-move opp-kind-${item.kind}" data-opp-action="move" data-id="${E(card.id)}" data-stage="${E(item.id)}">移到「${E(item.label)}」</button>`).join('');
      return `<div class="drawer-body opp-menu"><div class="opp-menu-summary"><b>${money(card.amount,card.currency)}</b><span>${E(card.client)}</span><span class="opp-chip opp-stage-chip opp-kind-${stage?.kind||'open'}">${E(stage?.label||card.stage)}</span></div>`
        +`<div class="opp-menu-group"><button type="button" class="primary" data-opp-action="edit" data-id="${E(card.id)}">编辑商机</button>${stage?.kind==='won'&&!card.orderId?`<button type="button" data-opp-action="order" data-id="${E(card.id)}">生成订单</button>`:''}${card.orderId?`<button type="button" data-biz-order="${E(card.orderId)}">查看关联订单</button>`:''}</div>`
        +`<h3>调整销售阶段</h3><div class="opp-menu-group">${moves}</div><h3>其他</h3><div class="opp-menu-group"><button type="button" data-opp-action="archive" data-id="${E(card.id)}" data-archived="${card.archived?'0':'1'}">${card.archived?'取消归档':'归档'}</button><button type="button" class="${armed?'team-danger':''}" data-opp-action="delete" data-id="${E(card.id)}">${armed?'再点一次确认删除（不可恢复）':'删除商机'}</button></div><div class="error" id="opp-menu-error" role="alert"></div></div>`;
    }
    const lostMarkup=card=>`<form class="drawer-body opp-form" id="opp-lost-form" data-id="${E(card.id)}"><div class="error" id="opp-lost-error" role="alert"></div><p class="opp-lead">把「${E(card.name)}」移到输单，需要记录原因，方便之后分析。</p><div class="opp-grid"><label class="opp-field"><span class="opp-field-label">输单原因<i class="opp-req" aria-hidden="true">*</i></span><select name="lostReason" required><option value="">请选择</option>${model.LOST_REASONS.map(reason=>option(reason,reason,'')).join('')}</select></label><label class="opp-field"><span class="opp-field-label">输单说明</span><input name="lostNote" placeholder="可选"></label></div></form>`;

    function analysisMarkup(report,view={}){
      const s=report.summary,c=report.currency;
      const tile=(label,value,note='')=>`<div class="team-tile"><span>${label}</span><strong>${value}</strong>${note?`<span class="muted tiny">${note}</span>`:''}</div>`;
      const percent=value=>value===null?'—':`${value}%`;
      const max=Math.max(1,...report.stages.map(stage=>stage.count));
      return `<div class="business-scroll opp-page"><div class="opp-summary is-compact"><label class="opp-currency"><span>币种</span><select id="opp-analysis-currency" aria-label="币种">${(report.currencies.length?report.currencies:[c]).map(code=>option(code,code,c)).join('')}</select></label>${report.flows&&report.flows.length>1?`<label class="opp-currency"><span>销售流程</span>${flowSelect('opp-analysis-flow',report.flows,report.flow)}</label>`:''}${report.otherCurrencyCount?`<p class="opp-summary-note">另有 ${report.otherCurrencyCount} 个其他币种的商机未计入本页；不同币种不折算。</p>`:''}</div>`
        +`<div class="team-tiles">${tile('新建商机数',s.created)}${tile('进行中',s.open,money(s.openAmount,c))}${tile('赢单',s.won,money(s.wonAmount,c))}${tile('输单',s.lost,money(s.lostAmount,c))}${tile('赢单率',percent(s.winRate),'赢单 ÷（赢单＋输单）')}${tile('平均成交周期',s.averageDays===null?'—':`${s.averageDays} 天`,'创建到首次赢单')}</div>`
        +`<div class="business-columns"><section class="business-section"><div class="section-head"><h3>销售阶段分布</h3><span class="muted tiny">按商机数量</span></div><div class="opp-bars">${report.stages.map(stage=>`<div class="opp-bar opp-kind-${stage.kind||'open'}"><span class="opp-bar-label">${E(stage.label)}</span><span class="opp-bar-track"><i style="width:${Math.round(stage.count/max*100)}%"></i></span><b class="opp-bar-count">${stage.count} 个 · ${stage.percent}%</b><span class="opp-bar-amount">${money(stage.amount,c)}</span></div>`).join('')}</div></section>`
        +`<section class="business-section"><div class="section-head"><h3>输单原因</h3></div><table class="order-table team-table"><thead><tr><th>原因</th><th>数量</th><th>金额</th></tr></thead><tbody>${report.lostReasons.map(row=>`<tr><td>${E(row.reason)}</td><td>${row.count}</td><td>${money(row.amount,c)}</td></tr>`).join('')||'<tr><td colspan="3">所选范围内没有输单</td></tr>'}</tbody></table></section></div>`
        +`<section class="business-section"><div class="section-head"><h3>按负责人</h3><span class="muted tiny">按商机上填写的负责人名称汇总，只差大小写的算同一个人；已归档的商机也计入本页</span></div><div class="team-table-scroll"><table class="order-table team-table"><thead><tr><th>负责人</th><th>新建</th><th>进行中</th><th>赢单</th><th>输单</th><th>赢单金额</th><th>赢单率</th><th>平均成交周期</th></tr></thead><tbody>${report.owners.map(row=>`<tr><td>${E(row.owner)}</td><td>${row.created}</td><td>${row.open}</td><td>${row.won}</td><td>${row.lost}</td><td>${money(row.wonAmount,c)}</td><td>${percent(row.winRate)}</td><td>${row.averageDays===null?'—':row.averageDays+' 天'}</td></tr>`).join('')||'<tr><td colspan="8">所选范围内没有商机</td></tr>'}</tbody></table></div></section></div>`;
    }

    // ---------- 销售流程设置 ----------
    // summary：model.flowSummary 的结果；view：{flow 当前流程, armed 等待再次确认删除的那一项}。
    const KIND_NOTES={open:'金额计入「进行中」；过了结束日期会提示逾期。',won:'金额计入「赢单」；可以生成订单；进入时记下赢单时间。',lost:'金额计入「输单」；移入时必须填写输单原因。每个流程固定一个，不能删除。'};
    function flowsMarkup(summary,view={}){
      const flow=summary.find(item=>item.id===view.flow)||summary[0];
      const kinds=model.KIND_LABELS||{open:'进行中',won:'赢单',lost:'输单'};
      const list=summary.map(item=>`<button type="button" class="opp-flow-item${item.id===flow.id?' is-active':''}" data-flow-select="${E(item.id)}" aria-pressed="${item.id===flow.id}"><span>${E(item.label)}</span><small>${item.stages.length} 个阶段 · ${item.count} 个商机</small></button>`).join('');
      const group=kind=>{
        const stages=flow.stages.filter(stage=>stage.kind===kind);
        const rows=stages.map((stage,index)=>{
          const armed=view.armed==='stage:'+stage.id;
          const tools=kind==='lost'?'<span class="opp-stage-fixed">固定阶段</span>'
            :`<button type="button" class="opp-icon-button" data-flow-action="stage-up" data-flow="${E(flow.id)}" data-stage="${E(stage.id)}" aria-label="前移：${E(stage.label)}"${index===0?' disabled':''}>↑</button>`
            +`<button type="button" class="opp-icon-button" data-flow-action="stage-down" data-flow="${E(flow.id)}" data-stage="${E(stage.id)}" aria-label="后移：${E(stage.label)}"${index===stages.length-1?' disabled':''}>↓</button>`
            +`<button type="button" class="text-button${armed?' team-danger':''}" data-flow-action="stage-remove" data-flow="${E(flow.id)}" data-stage="${E(stage.id)}"${stages.length<2?` disabled title="至少保留一个${kinds[kind]}阶段"`:''} aria-label="${armed?'再点一次确认删除':'删除阶段'}：${E(stage.label)}">${armed?'再点一次确认删除':'删除'}</button>`;
          return `<li class="opp-stage-row"><span class="opp-stage-dot opp-kind-${kind}" aria-hidden="true"></span><input data-stage-rename="${E(stage.id)}" data-flow="${E(flow.id)}" value="${E(stage.label)}" maxlength="20" aria-label="阶段名称：${E(stage.label)}"><span class="opp-stage-usage">${stage.count} 个商机</span><span class="opp-stage-tools">${tools}</span></li>`;
        }).join('');
        const add=kind==='lost'?'':`<form class="opp-stage-add" id="opp-stage-add-${kind}" data-flow="${E(flow.id)}" data-kind="${kind}"><input name="label" maxlength="20" placeholder="新的${kinds[kind]}阶段名称" aria-label="新的${kinds[kind]}阶段名称" required><button type="submit">添加阶段</button></form>`;
        return `<div class="opp-stage-group"><div class="opp-stage-group-head"><h4>${kinds[kind]}阶段</h4><span class="muted tiny">${KIND_NOTES[kind]}</span></div><ul class="opp-stage-list">${rows}</ul>${add}</div>`;
      };
      const armedFlow=view.armed==='flow:'+flow.id;
      const remove=flow.id==='default'?'<span class="muted tiny">默认流程不能删除</span>'
        :`<button type="button" class="${armedFlow?'team-danger':''}" data-flow-action="flow-remove" data-flow="${E(flow.id)}"${flow.count?` disabled title="还有 ${flow.count} 个商机在用这个流程"`:''}>${armedFlow?'再点一次确认删除':'删除这个流程'}</button>${flow.count?`<span class="muted tiny">还有 ${flow.count} 个商机在用，不能删除</span>`:''}`;
      return `<div class="business-scroll opp-page opp-flows"><div class="opp-flow-layout">`
        +`<aside class="business-section opp-flow-side"><h3>销售流程</h3><div class="opp-flow-items">${list}</div>`
        +`<form class="opp-flow-add" id="opp-flow-add"><h4>新建流程</h4><input name="label" maxlength="20" placeholder="流程名称，例如：样品单流程" aria-label="新流程名称" required><label class="opp-flow-copy"><span>阶段复制自</span><select name="copyFrom" aria-label="阶段复制自">${summary.map(item=>option(item.id,item.label,flow.id)).join('')}</select></label><button type="submit" class="primary">新建流程</button></form></aside>`
        +`<section class="business-section opp-flow-detail"><div class="error" id="opp-flow-error" role="alert"></div>`
        +`<div class="opp-flow-head"><label class="opp-flow-name"><span>流程名称</span><input data-flow-rename="${E(flow.id)}" value="${E(flow.label)}" maxlength="20" aria-label="流程名称"></label><div class="opp-flow-remove">${remove}</div></div>`
        +`<p class="muted tiny opp-flow-note">阶段从左到右就是看板上的列。名称改完按回车或点别处即保存；阶段的类型（进行中／赢单）建好后不能改，需要时新建一个再把商机移过去。</p>`
        +group('open')+group('won')+group('lost')+`</section></div></div>`;
    }
    // 删除一个还有商机的阶段：先选把商机移到哪里。
    function stageRemoveMarkup(flow,stage){
      const targets=flow.stages.filter(item=>item.id!==stage.id&&item.kind!=='lost');
      return `<form class="drawer-body opp-form" id="opp-stage-remove-form" data-flow="${E(flow.id)}" data-stage="${E(stage.id)}"><div class="error" id="opp-stage-remove-error" role="alert"></div><p class="opp-lead">「${E(stage.label)}」里还有 ${stage.count} 个商机。删除这个阶段前，先选好把它们移到哪个阶段。</p><div class="opp-grid"><label class="opp-field is-wide"><span class="opp-field-label">移到<i class="opp-req" aria-hidden="true">*</i></span><select name="moveTo" required><option value="">请选择</option>${targets.map(item=>option(item.id,`${item.label}（${(model.KIND_LABELS||{})[item.kind]||item.kind}）`,'')).join('')}</select><span class="opp-field-hint">不能直接移到输单：输单需要逐个填写原因。移到另一类阶段时，赢单时间会按现在重新记录或清除。</span></label></div></form>`;
    }
    return {flowsMarkup,stageRemoveMarkup,stageOptions,boardMarkup,headerActions,cardMarkup,contactOptions,formMarkup,menuMarkup,lostMarkup,analysisMarkup,shortDate};
  }
  const api={create,PAGE};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LaiOpportunityUI=api;
})(typeof window!=='undefined'?window:globalThis);
