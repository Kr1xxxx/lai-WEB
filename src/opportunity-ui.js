(function(root){
  'use strict';
  // 商机页面的纯标记生成：看板、列表、表单、操作菜单、输单表单、分析。不读写数据。
  const PAGE=30;
  const CURRENCIES=['USD','EUR','CNY','GBP','JPY','HKD','TWD','AUD','CAD'];
  const number=value=>Number(value||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  // can(key)：当前账号有没有这个权限（角色预览用）；没传时什么都显示。
  // level(key)：字段权限，'edit'｜'read'｜'hidden'（商机的 contact、endDate 等字段名；自定义字段是 custom.字段ID）；没传时都可编辑。
  function create(E,model,can=()=>true,level=()=>'edit'){
    const vis=key=>level(key)!=='hidden';
    const dis=key=>level(key)==='read'?' disabled title="你的角色只能查看，不能修改"':'';
    const money=(value,currency)=>`${E(currency)} ${number(value)}`;
    const option=(value,label,current)=>`<option value="${E(value)}"${String(value)===String(current)?' selected':''}>${E(label)}</option>`;
    // 结束日期：今年的只显示月-日，其他年份显示完整日期（与参考界面一致）。
    const shortDate=(day,today)=>day&&String(day).slice(0,4)===String(today).slice(0,4)?String(day).slice(5):String(day||'—');
    // 卡片自带所在流程的阶段名称和类别；旧调用没带时按默认流程查。
    const kindOf=card=>card.kind||model.STAGES.find(stage=>stage.id===card.stage)?.kind||'open';
    const stageLabel=card=>card.stageLabel||model.STAGES.find(stage=>stage.id===card.stage)?.label||card.stage;
    const flowSelect=(id,flows,current)=>flows&&flows.length>1?`<select id="${id}" aria-label="销售流程">${flows.map(flow=>option(flow.id,`${flow.label}（${flow.count}）`,current)).join('')}</select>`:'';

    const CLIP='<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><path d="M10.5 4.5 5.4 9.6a1.5 1.5 0 0 0 2.1 2.1l5-5a3 3 0 0 0-4.2-4.2L3.2 7.6a4.5 4.5 0 0 0 6.4 6.4l3.4-3.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const clip=card=>card.attachmentCount>0?`<span class="opp-clip" title="${card.attachmentCount} 个附件" aria-label="${card.attachmentCount} 个附件">${CLIP}${card.attachmentCount}</span>`:'';
    // 卡片：名称、金额、客户是主信息；负责人和结束日期放在底部一行；逾期、输单原因、关联订单用小标签。
    function cardMarkup(card,today){
      // 进行中的商机才谈得上“截止”；已赢单、已输单的只显示日期。
      const closed=kindOf(card)!=='open';
      const due=card.endDate&&vis('endDate')?(card.overdue?`<span class="opp-due is-overdue">逾期 ${E(shortDate(card.endDate,today))}</span>`:`<span class="opp-due">${E(shortDate(card.endDate,today))}${closed?'':' 截止'}</span>`):'';
      return `<article class="opp-card${card.archived?' is-archived':''}" draggable="${can('opp.edit')?'true':'false'}" data-opp-id="${E(card.id)}">`
        +`<div class="opp-card-head"><button type="button" class="opp-card-name" data-opp-action="detail" data-id="${E(card.id)}">${E(card.name)}</button><button type="button" class="opp-card-menu" data-opp-action="menu" data-id="${E(card.id)}" aria-label="更多操作：${E(card.name)}">⋮</button></div>`
        +`<div class="opp-card-amount"><span><small>${E(card.currency)}</small>${number(card.amount)}</span>${clip(card)}</div>`
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
        +`<input type="search" id="opp-search" value="${E(f.search)}" placeholder="搜索${['名称','客户',...(vis('contact')?['联系人']:[]),...(vis('tags')?['标签']:[])].join('、')}" aria-label="搜索商机">`
        +`<select id="opp-owner" aria-label="负责人"><option value="">全部负责人</option>${owners}</select>`
        +`<select id="opp-archived" aria-label="归档状态">${option('active','未归档',f.archived)}${option('archived','已归档',f.archived)}${option('all','全部',f.archived)}</select>`
        +`<span class="opp-range"><select id="opp-date-field" aria-label="日期类型">${option('createdAt','创建时间',f.dateField)}${vis('endDate')?option('endDate','结束日期',f.dateField):''}</select><input type="date" id="opp-from" value="${E(f.from)}" aria-label="开始日期"><span aria-hidden="true">至</span><input type="date" id="opp-to" value="${E(f.to)}" aria-label="结束日期"></span>`
        +`<select id="opp-sort" class="opp-sort" aria-label="排序">${model.SORTS.filter(([id])=>vis('endDate')||!/^endDate-/.test(id)).map(([id,label])=>option(id,label,f.sort)).join('')}</select></div>`;
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
      return `<section class="business-section opp-list"><div class="team-table-scroll"><table class="order-table team-table"><thead><tr><th>商机编号</th><th>商机名称</th><th>客户</th><th>销售金额</th><th>销售阶段</th><th>负责人</th>${vis('endDate')?'<th>结束日期</th>':''}<th>创建日期</th><th>操作</th></tr></thead><tbody>${shown.map(card=>`<tr><td class="opp-num">${E(card.number||'—')}</td><td><button type="button" class="company-link" data-opp-action="detail" data-id="${E(card.id)}">${E(card.name)}</button></td><td><button type="button" class="company-link" data-biz-customer="${E(card.client)}">${E(card.client)}</button></td><td class="opp-num">${money(card.amount,card.currency)}</td><td><span class="opp-chip opp-stage-chip opp-kind-${kindOf(card)}">${E(stageLabel(card))}</span></td><td>${E(card.owner||'—')}</td>${vis('endDate')?`<td>${card.overdue?`<span class="opp-due is-overdue">逾期 ${E(card.endDate)}</span>`:E(card.endDate||'—')}</td>`:''}<td>${E(card.createdDay||'—')}</td><td><button type="button" class="text-button" data-opp-action="menu" data-id="${E(card.id)}" aria-label="更多操作：${E(card.name)}">⋮</button></td></tr>`).join('')||`<tr><td colspan="${vis('endDate')?9:8}">暂无商机</td></tr>`}</tbody></table></div>${rest>0?`<button type="button" class="opp-more" data-opp-action="more" data-stage="list">再显示 ${Math.min(PAGE,rest)} 个（还有 ${rest} 个）</button>`:''}</section>`;
    }
    const undoMarkup=undo=>undo?`<div class="opp-undo" id="opp-undo" role="status"><span>${E(undo.label)}</span><button type="button" data-opp-action="undo">撤销</button></div>`:'';
    const boardMarkup=(board,view={},context={})=>`<div class="business-scroll opp-page">${toolbar(board,view,context)}${totals(board)}${view.mode==='list'?table(board,view,context.today):columns(board,view,context.today)}${undoMarkup(view.undo)}</div>`;
    // 看板／列表切换：旧版式放在页头；新界面（粉色、橙色）放进筛选卡片里，两处只显示一处（见 skin-glass.css）。
    const viewSwitch=(view={},extra='')=>`<span class="team-segment opp-view${extra}" role="group" aria-label="视图"><button type="button" data-opp-view="board" aria-pressed="${view.mode!=='list'}">看板</button><button type="button" data-opp-view="list" aria-pressed="${view.mode==='list'}">列表</button></span>`;
    const headerActions=(board,context={},view={})=>`${viewSwitch(view)}<button type="button" class="opp-analysis-link" data-lai-route="opp-analysis">商机分析</button>${can('opp.create')?'<button type="button" class="primary" data-opp-action="new">新建商机</button>':''}`;


    // ---------- 商机详情与附件 ----------
    const pad=value=>String(value).padStart(2,'0');
    // 时间按本机时区显示成「2026-10-07 09:30」。
    function stamp(iso){
      const date=new Date(iso);
      return iso&&Number.isFinite(date.getTime())?`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`:'—';
    }
    function fileSize(bytes){
      const size=Number(bytes)||0;
      return size<1024?`${size} B`:size<1024*1024?`${(size/1024).toFixed(size<10240?1:0)} KB`:`${(size/1024/1024).toFixed(1)} MB`;
    }
    const extLabel=name=>{const match=/\.([A-Za-z0-9]{1,5})\s*$/.exec(String(name||''));return match?match[1].toUpperCase():'文件';};
    // view：{renaming 正在改名的附件, armed 等再点一次确认删除的附件, preview 正在预览的附件, busy 正在上传}
    function attachmentsInner(items,view={}){
      const limits=model.ATTACHMENT_LIMITS,full=items.length>=limits.maxCount;
      const previewing=items.find(entry=>entry.id===view.preview&&model.previewKind(entry.name));
      const rows=items.map(entry=>{
        const image=model.previewKind(entry.name)==='image',armed=view.armed===entry.id,renaming=view.renaming===entry.id;
        const main=renaming
          ?`<form class="opp-file-rename" id="opp-attach-rename" data-att="${E(entry.id)}"><input name="name" value="${E(entry.name)}" maxlength="${limits.maxName}" aria-label="新的文件名" required><button type="submit" class="primary">保存</button><button type="button" data-attach-action="rename-cancel">取消</button></form>`
          :(image||can('opp.fileDownload')?`<button type="button" class="opp-file-name" data-attach-action="${image?'preview':'save'}" data-att="${E(entry.id)}" title="${image?'点击预览':'保存到「下载」'}">${E(entry.name)}</button>`:`<span class="opp-file-name">${E(entry.name)}</span>`);
        const tools=renaming?'':`${image?`<button type="button" data-attach-action="${view.preview===entry.id?'preview-close':'preview'}" data-att="${E(entry.id)}">${view.preview===entry.id?'关闭预览':'预览'}</button>`:''}`
          +(can('opp.fileDownload')?`<button type="button" data-attach-action="save" data-att="${E(entry.id)}">保存到「下载」</button>`:'')+(can('opp.edit')?`<button type="button" data-attach-action="rename" data-att="${E(entry.id)}">重命名</button>`:'')
          +(can('opp.fileDelete')?`<button type="button" class="${armed?'team-danger':''}" data-attach-action="delete" data-att="${E(entry.id)}" aria-label="${armed?'再点一次确认删除':'删除'}：${E(entry.name)}">${armed?'再点一次确认删除':'删除'}</button>`:'');
        return `<li class="opp-file"><span class="opp-file-ext" aria-hidden="true">${E(extLabel(entry.name))}</span><span class="opp-file-main">${main}<small>${fileSize(entry.size)} · ${E(stamp(entry.uploadedAt))}</small></span><span class="opp-file-tools">${tools}</span></li>`;
      }).join('');
      return `<div class="form-section">附件<span class="opp-attach-count">${items.length} / ${limits.maxCount}</span></div>`
        +(!can('opp.edit')?'':`<label class="opp-dropzone${full?' is-full':''}" data-opp-dropzone><input type="file" id="opp-attach-input" multiple hidden${full||view.busy?' disabled':''}><span class="opp-dropzone-main">${full?`已达到 ${limits.maxCount} 个附件的上限，删除一些再添加`:'把文件拖到这里，或<u>点击选择文件</u>'}</span><small>单个文件不超过 ${Math.round(limits.maxBytes/1024/1024)} MB，每个商机最多 ${limits.maxCount} 个；不收可执行或安装类文件</small></label>`)
        +`<div class="opp-attach-status" id="opp-attach-status" role="status"></div><div class="error" id="opp-attach-error" role="alert"></div>`
        +(previewing?`<figure class="opp-preview"><img data-opp-fetch="${E(previewing.fileUrl)}" alt="${E(previewing.name)}"><figcaption>${E(previewing.name)}</figcaption></figure>`:'')
        +(rows?`<ul class="opp-files">${rows}</ul>`:'<p class="opp-empty">还没有附件。报价单、合同、样品图都可以放在这里。</p>');
    }
    // 商机详情里的“单据”：这个商机已经保存的报价单、形式发票（context.documents：[{id, number, typeName, date, voided}]）。
    function documentsBlock(documents){
      if(!Array.isArray(documents)||!documents.length)return '';
      return `<div class="form-section">单据</div><ul class="opp-docs">${documents.map(doc=>`<li${doc.voided?' class="is-void"':''}><b>${E(doc.number)}</b><span>${E(doc.typeName)}</span><span>${E(doc.date||'')}</span>${doc.voided?'<span class="opp-chip">已作废</span>':''}<button type="button" class="text-button" data-biz-action="docrec-view" data-id="${E(doc.id)}">查看</button></li>`).join('')}</ul>`;
    }
    // 商机详情：基本信息、阶段记录、附件。context：{today, multiFlow, documents, whatsapp}（whatsapp：{phone, contact}，联系人有能打开的号码且账号能开聊天时才传，详情里就多一个 WhatsApp 按钮）；view：附件区状态。
    function detailMarkup(detail,context={},view={}){
      const fact=(label,value,wide=false)=>label&&(value||value===0)?`<div${wide?' class="is-wide"':''}><dt>${label}</dt><dd>${value}</dd></div>`:'';
      const rate=detail.currency!=='USD'&&Number(detail.exchangeRate)?`每 100 ${E(detail.currency)} ＝ ${E(number(detail.exchangeRate))} USD`:'';
      const stageChip=`<span class="opp-chip opp-stage-chip opp-kind-${E(detail.kind)}">${E(detail.stageLabel)}</span>`;
      const products=detail.products.length&&vis('products')?`<div class="form-section">关联产品</div><table class="order-table opp-products"><thead><tr><th>产品</th><th>数量</th><th>单价</th><th>小计</th></tr></thead><tbody>${detail.products.map(row=>`<tr><td>${E(row.name)}</td><td>${E(row.quantity??1)}</td><td>${E(number(row.unitPrice))}</td><td>${E(number((Number(row.quantity)||0)*(Number(row.unitPrice)||0)))}</td></tr>`).join('')}</tbody></table>`:'';
      const history=detail.history.length?`<div class="form-section">阶段记录</div><ol class="opp-history">${detail.history.map((entry,index)=>`<li class="opp-kind-${E(entry.kind)}${index===detail.history.length-1?' is-current':''}"><i aria-hidden="true"></i><span>${E(entry.label)}</span><time>${E(stamp(entry.at))}</time></li>`).join('')}</ol>`:'';
      return `<div class="drawer-body opp-detail" data-id="${E(detail.id)}">`
        +`<div class="opp-detail-top"><div class="opp-detail-amount"><small>${E(detail.currency)}</small>${number(detail.amount)}</div><div class="opp-detail-chips">${stageChip}${detail.overdue?'<span class="opp-chip is-danger">已逾期</span>':''}${detail.archived?'<span class="opp-chip">已归档</span>':''}</div></div>`
        +`<div class="error" id="opp-detail-error" role="alert"></div>`
        +`<dl class="opp-facts">`
        +fact('客户',detail.client?`<button type="button" class="company-link" data-biz-customer="${E(detail.client)}">${E(detail.client)}</button>`:'')
        +(vis('contact')?fact('联系人',E(detail.contact)):'')+(context.whatsapp?fact('电话',`${E(context.whatsapp.phone)} <button type="button" class="text-button opp-wa" data-opp-action="wa" data-id="${E(detail.id)}" aria-label="用 WhatsApp 联系${E(context.whatsapp.contact||detail.client)}">WhatsApp</button>`):'')+fact('负责人',E(detail.owner))+(vis('collaborators')?fact('协同跟进人',E(detail.collaborators.join('、'))):'')
        +(vis('endDate')?fact('结束日期',E(detail.endDate)):'')+(context.multiFlow?fact('销售流程',E(detail.flowLabel)):'')
        +(vis('exchangeRate')?fact('汇率',E(rate)):'')+fact('创建时间',E(stamp(detail.createdAt)))
        +fact(detail.kind==='won'?'赢单时间':detail.kind==='lost'?'输单时间':'',detail.kind!=='open'&&detail.closedAt?E(stamp(detail.closedAt)):'')
        +fact('输单原因',detail.lostReason?E(detail.lostReason+(detail.lostNote?`（${detail.lostNote}）`:'')):'')
        +fact('商机编号',E(detail.number||'—'))+(vis('type')?fact('商机类型',E(detail.type)):'')
        +(vis('sources')?fact('商机来源',(detail.sources||[]).length?detail.sources.map(source=>`<span class="opp-chip">${E(source)}</span>`).join(' '):''):'')+(vis('leadId')?fact('来源线索',E(detail.leadName)):'')
        +(detail.custom||[]).filter(row=>vis(`custom.${row.id}`)).map(row=>fact(E(row.name),E(row.value).replace(/\n/g,'<br>'),row.type==='textarea')).join('')
        +(vis('tags')?fact('标签',detail.tags.length?detail.tags.map(tag=>`<span class="opp-chip">${E(tag)}</span>`).join(' '):''):'')
        +fact('关联订单',detail.orderId?`<button type="button" class="company-link" data-biz-order="${E(detail.orderId)}">查看关联订单</button>`:'')
        +(vis('note')?fact('备注',E(detail.note).replace(/\n/g,'<br>'),true):'')
        +`</dl>${products}${documentsBlock(context.documents)}${history}<section class="opp-attach" id="opp-attach" data-id="${E(detail.id)}">${attachmentsInner(detail.attachments,view)}</section></div>`;
    }


    // ---------- 拖动 ----------
    // rects：这一列里（不含被拖的那张）每张卡片的 {id, top, bottom}；返回应插在哪张卡片之前（空串表示放到最后）。
    function dropBefore(rects,y){
      if(!Number.isFinite(y))return '';
      const hit=(Array.isArray(rects)?rects:[]).find(rect=>y<(rect.top+rect.bottom)/2);
      return hit?hit.id:'';
    }
    // 拖到容器边缘时自动滚动：距离边缘 edge 像素以内开始，越近越快，最快 max；返回本次滚动的像素（负数向前）。
    function scrollStep(position,start,end,edge=72,max=28){
      if(![position,start,end].every(Number.isFinite)||end<=start)return 0;
      const limit=Math.min(edge,(end-start)/2);
      if(position<start+limit)return -Math.ceil(max*Math.min(1,(start+limit-position)/limit));
      if(position>end-limit)return Math.ceil(max*Math.min(1,(position-(end-limit))/limit));
      return 0;
    }

    // 联系人下拉的选项。原来选的联系人如果已不在客户的联系人里，仍然保留为一个选项，避免编辑别的内容时被悄悄清掉。
    function contactOptions(contacts,value,client){
      const stale=value&&!contacts.includes(value)?`<option value="${E(value)}" selected>${E(value)}（已不在该客户的联系人中）</option>`:'';
      if(!contacts.length)return stale+`<option value=""${stale?'':' selected'}>${client?'该客户没有联系人，可留空':'请先选择客户'}</option>`;
      return `<option value="">请选择</option>${contacts.map(name=>option(name,name,value)).join('')}${stale}`;
    }
    // 阶段下拉的选项；原来的阶段如果已不在流程里，仍保留为一个选项。
    const stageOptions=(stages,value)=>stages.map(stage=>option(stage.id,stage.label,value||stages[0]?.id)).join('')+(value&&!stages.some(stage=>stage.id===value)?`<option value="${E(value)}" selected>原阶段：${E(value)}</option>`:'');
    // 表单：values 是要显示的内容，context 提供可选的客户、联系人、负责人，以及 setup（商机设置：字段显示与必填、名单、自定义字段）。会随填写变化的部分（名称输入、联系人、汇率、输单原因）都带 id，由页面就地更新，不重画整个表单。
    function formMarkup(values,context={}){
      const v=values||{},isLost=v.stage==='lost',custom=v.nameMode==='custom',usd=String(v.currency||'USD').toUpperCase()==='USD';
      const setup=context.setup||model.formSetup({}),cfg=setup.fields;
      const contacts=context.contacts||[];
      const list=value=>Array.isArray(value)?value.join('，'):String(value??'');
      const products=Array.isArray(v.products)?model.productsText(v.products):String(v.products??'');
      let subtotal='';
      try{const rows=model.parseProducts(products);if(rows.length)subtotal=`共 ${rows.length} 项，合计 ${number(rows.reduce((sum,row)=>sum+row.quantity*row.unitPrice,0))}（仅供参考，不会改动销售金额）`;}catch{subtotal='';}
      const req='<i class="opp-req" aria-hidden="true">*</i>';
      // 每个字段：标签一行（必填星号紧跟文字），控件一行，可选的说明一行。
      const field=(label,control,{required=false,wide=false,hidden=false,hint=''}={})=>`<label class="opp-field${wide?' is-wide':''}"${hidden?' hidden':''}><span class="opp-field-label">${label}${required?req:''}</span>${control}${hint?`<span class="opp-field-hint">${hint}</span>`:''}</label>`;
      // 多选：一排勾选框，不带 name（提交时由页面按 data-multi 收集成列表）。名单里已经没有的旧选项仍显示出来，免得保存时被悄悄去掉。
      const multi=(key,label,options,chosen,{required=false,hint='',lock=''}={})=>{
        const stale=chosen.filter(item=>!options.includes(item));
        const boxes=[...options.map(item=>[item,item]),...stale.map(item=>[item,`${item}（已不在名单里）`])].map(([value,text])=>`<label class="opp-check"><input type="checkbox" value="${E(value)}"${chosen.includes(value)?' checked':''}><span>${E(text)}</span></label>`).join('');
        return `<fieldset class="opp-field is-wide opp-multi" data-multi="${E(key)}"${lock}><legend class="opp-field-label">${label}${required?req:''}</legend>${boxes?`<div class="opp-multi-list">${boxes}</div>`:''}${hint?`<span class="opp-field-hint">${hint}</span>`:''}</fieldset>`;
      };
      // 单选下拉：当前值已不在名单里时仍保留为一个选项。
      const choose=(name,options,current,blank)=>`<select name="${name}"${dis(name)}><option value="">${blank}</option>${options.map(item=>option(item,item,current)).join('')}${current&&!options.includes(current)?`<option value="${E(current)}" selected>${E(current)}（已不在名单里）</option>`:''}</select>`;
      // 阶段跟着销售流程走；只有一个流程时不显示流程选择。
      const flows=context.flows||[],stages=context.stages||model.STAGES;
      const flow=flows.length>1?field('销售流程',`<select name="flow" id="opp-form-flow">${flows.map(item=>option(item.id,item.label,v.flow||'default')).join('')}</select>`,{required:true}):`<input type="hidden" name="flow" value="${E(v.flow||'default')}">`;
      const chosenSources=Array.isArray(v.sources)?v.sources.map(String):[];
      const leadOptions=(setup.leads||[]).map(lead=>option(lead.id,lead.name,v.leadId)).join('')+(v.leadId&&!(setup.leads||[]).some(lead=>lead.id===v.leadId)?`<option value="${E(v.leadId)}" selected>（已删除的线索）</option>`:'');
      const sourceChoices=Array.isArray(setup.sources)?setup.sources:[];
      const customValue=def=>v.custom&&typeof v.custom==='object'?v.custom[def.id]:undefined;
      const customControl=def=>{
        const name=`custom:${def.id}`,value=customValue(def),text=Array.isArray(value)?'':String(value??''),label=E(def.name),must=(def.required?' required':'')+dis(`custom.${def.id}`);
        if(!vis(`custom.${def.id}`))return '';
        if(def.type==='multi')return multi(name,label,def.options,Array.isArray(value)?value.map(String):[],{required:def.required,lock:dis(`custom.${def.id}`)});
        if(def.type==='textarea')return field(label,`<textarea name="${E(name)}" rows="3" maxlength="${model.SET_LIMITS.textarea}"${must}>${E(text)}</textarea>`,{required:def.required,wide:true});
        if(def.type==='select')return field(label,`<select name="${E(name)}"${must}><option value="">请选择</option>${def.options.map(item=>option(item,item,text)).join('')}${text&&!def.options.includes(text)?`<option value="${E(text)}" selected>${E(text)}（已不在选项里）</option>`:''}</select>`,{required:def.required});
        if(def.type==='date')return field(label,`<input name="${E(name)}" type="date" value="${E(text)}"${must}>`,{required:def.required});
        if(def.type==='number')return field(label,`<input name="${E(name)}" value="${E(text)}" inputmode="decimal" autocomplete="off"${must}>`,{required:def.required});
        return field(label,`<input name="${E(name)}" value="${E(text)}" maxlength="${model.SET_LIMITS.text}"${must}>`,{required:def.required});
      };
      const section=(title,html)=>html?`<div class="form-section">${title}</div><div class="opp-grid">${html}</div>`:'';
      const classify=[
        `<div class="opp-field"><span class="opp-field-label">商机编号</span><span class="opp-static" id="opp-number">${E(v.number||(context.isNew?'保存后自动生成':'—'))}</span>${context.isNew?'<span class="opp-field-hint">格式：OPP-日期-当天序号</span>':''}</div>`,
        cfg.type.show&&vis('type')?field('商机类型',choose('type',setup.types||[],String(v.type||''),'请选择'),{required:cfg.type.required}):'',
        cfg.leadId.show&&vis('leadId')?field('来源线索',`<select name="leadId"${dis('leadId')}><option value="">不选</option>${leadOptions}</select>`,{required:cfg.leadId.required}):'',
        cfg.sources.show&&vis('sources')?multi('sources','商机来源',sourceChoices,chosenSources,{lock:dis('sources'),required:cfg.sources.required,hint:sourceChoices.length?'':'先在 客户设置 → 来源设置 里添加来源'}):''
      ].join('');
      const extra=[
        cfg.tags.show&&vis('tags')?field('商机标签',`<input name="tags" value="${E(list(v.tags))}" placeholder="多个标签用逗号分隔"${dis('tags')}>`,{wide:true,required:cfg.tags.required}):'',
        cfg.note.show&&vis('note')?field('备注',`<textarea name="note" rows="3"${dis('note')}>${E(v.note||'')}</textarea>`,{wide:true,required:cfg.note.required}):'',
        cfg.products.show&&vis('products')?field('关联产品',`<textarea name="products" rows="4"${dis('products')} placeholder="每行一个产品：名称, 数量, 单价&#10;例如：假睫毛 A, 10, 2.5">${E(products)}</textarea>`,{wide:true,hint:subtotal,required:cfg.products.required}):''
      ].join('');
      const reasons=setup.reasons||model.LOST_REASONS;
      return `<form class="drawer-body opp-form" id="opp-form"><div class="error" id="opp-error" role="alert"></div>`
        +`<div class="form-section">基本信息</div><div class="opp-grid">`
        +`<fieldset class="opp-field is-wide opp-name"><legend class="opp-field-label">商机名称${req}</legend><div class="opp-name-row"><span class="opp-seg"><label><input type="radio" name="nameMode" value="auto"${custom?'':' checked'}><span>自动生成</span></label><label><input type="radio" name="nameMode" value="custom"${custom?' checked':''}><span>自定义</span></label></span><input name="name" value="${E(custom?v.name||'':'')}" placeholder="请输入商机名称" aria-label="商机名称"${custom?' required':' hidden disabled'}><span class="opp-field-hint" id="opp-name-note"${custom?' hidden':''}>${context.isNew||v.nameMode==='custom'||!v.name?'保存时按「日期＋当天序号-负责人」生成，例如 26100601-Amy':E(v.name)}</span></div></fieldset>`
        +field('客户',`<input name="client" id="opp-client" value="${E(v.client||'')}" list="opp-client-list" placeholder="输入或选择客户" autocomplete="off" required><datalist id="opp-client-list">${(context.customers||[]).map(name=>`<option value="${E(name)}"></option>`).join('')}</datalist>`,{required:true})
        +(cfg.contact.show&&vis('contact')?field('关联联系人',`<select name="contact"${contacts.length&&cfg.contact.required?' required':''}${dis('contact')}>${contactOptions(contacts,String(v.contact||''),v.client)}</select>`,{required:cfg.contact.required&&contacts.length>0}):'')
        +field('负责人',`<input name="owner" value="${E(v.owner||'')}" list="opp-owner-list" autocomplete="off" required${can('opp.transfer')?'':' readonly'}><datalist id="opp-owner-list">${(context.owners||[]).map(name=>`<option value="${E(name)}"></option>`).join('')}</datalist>`,{required:true})
        +(cfg.collaborators.show&&vis('collaborators')?field('协同跟进人',`<input name="collaborators" value="${E(list(v.collaborators))}" placeholder="多人用逗号分隔"${dis('collaborators')}>`,{required:cfg.collaborators.required}):'')
        +`</div><div class="form-section">金额与进度</div><div class="opp-grid">`
        +`<div class="opp-field"><span class="opp-field-label" id="opp-amount-label">销售金额${req}</span><span class="opp-group"><input name="currency" id="opp-form-currency" class="opp-group-currency" value="${E(v.currency||'USD')}" list="opp-currency-list" maxlength="3" autocomplete="off" aria-label="币种" required><datalist id="opp-currency-list">${CURRENCIES.map(code=>`<option value="${code}"></option>`).join('')}</datalist><input name="amount" value="${E(v.amount??'')}" inputmode="decimal" autocomplete="off" aria-labelledby="opp-amount-label" placeholder="0.00" required></span></div>`
        +(flows.length>1?flow:'')
        +field('销售阶段',`<select name="stage" id="opp-form-stage">${stageOptions(stages,v.stage)}</select>`,{required:true})
        +(vis('endDate')?field('结束日期',`<input name="endDate" type="date" value="${E(v.endDate||'')}" required${dis('endDate')}>`,{required:true}):'')
        +(vis('exchangeRate')?field('汇率',`<input name="exchangeRate" value="${E(usd?100:v.exchangeRate??100)}" data-rate="${E(v.exchangeRate??100)}" inputmode="decimal"${usd?' readonly':''}${dis('exchangeRate')} aria-describedby="opp-rate-note">`,{required:cfg.exchangeRate.required,hidden:usd,hint:'<span id="opp-rate-note">每 100 外币折合多少美元，仅作记录</span>'}):'')
        +field('输单原因',`<select name="lostReason"${isLost?' required':' disabled'}><option value="">请选择</option>${reasons.map(reason=>option(reason,reason,v.lostReason)).join('')}${v.lostReason&&!reasons.includes(v.lostReason)?`<option value="${E(v.lostReason)}" selected>${E(v.lostReason)}</option>`:''}</select>`,{required:true,hidden:!isLost})
        +field('输单说明',`<input name="lostNote" value="${E(v.lostNote||'')}"${isLost?'':' disabled'}>`,{hidden:!isLost})
        +(flows.length>1?'':flow)
        +`</div>`+section('来源与分类',classify)+section('补充信息',extra)+section('自定义字段',(setup.customFields||[]).map(customControl).join(''))
        +`</form>`;
    }
    function menuMarkup(card,armed=false){
      const stages=card.stages||model.STAGES;
      const stage=stages.find(item=>item.id===card.stage);
      // 一组按钮；没有一个能用的按钮时整组（含小标题）不显示。
      const group=(title,buttons)=>buttons?`${title?`<h3>${title}</h3>`:''}<div class="opp-menu-group">${buttons}</div>`:'';
      const moves=stages.filter(item=>item.id!==card.stage).map(item=>`<button type="button" class="opp-move opp-kind-${item.kind}" data-opp-action="move" data-id="${E(card.id)}" data-stage="${E(item.id)}">移到「${E(item.label)}」</button>`).join('');
      return `<div class="drawer-body opp-menu"><div class="opp-menu-summary"><b>${money(card.amount,card.currency)}</b><span>${E(card.client)}</span><span class="opp-chip opp-stage-chip opp-kind-${stage?.kind||'open'}">${E(stage?.label||card.stage)}</span></div>`
        +group('',`${can('opp.edit')?`<button type="button" class="primary" data-opp-action="edit" data-id="${E(card.id)}">编辑商机</button>`:''}${stage?.kind==='won'&&!card.orderId&&can('order.create')?`<button type="button" data-opp-action="order" data-id="${E(card.id)}">生成订单</button>`:''}${card.orderId?`<button type="button" data-biz-order="${E(card.orderId)}">查看关联订单</button>`:''}`)
        +(can('doc.create')?group('生成单据',`<button type="button" data-opp-doc="quote" data-id="${E(card.id)}">报价单</button><button type="button" data-opp-doc="pi" data-id="${E(card.id)}">形式发票</button>`):'')
        +(can('opp.edit')?group('调整销售阶段',moves):'')
        +group('其他',`${can('opp.archive')?`<button type="button" data-opp-action="archive" data-id="${E(card.id)}" data-archived="${card.archived?'0':'1'}">${card.archived?'取消归档':'归档'}</button>`:''}${can('opp.delete')?`<button type="button" class="${armed?'team-danger':''}" data-opp-action="delete" data-id="${E(card.id)}">${armed?'再点一次确认删除（不可恢复）':'删除商机'}</button>`:''}`)
        +`<div class="error" id="opp-menu-error" role="alert"></div></div>`;
    }
    const lostMarkup=(card,reasons=model.LOST_REASONS)=>`<form class="drawer-body opp-form" id="opp-lost-form" data-id="${E(card.id)}"><div class="error" id="opp-lost-error" role="alert"></div><p class="opp-lead">把「${E(card.name)}」移到输单，需要记录原因，方便之后分析。</p><div class="opp-grid"><label class="opp-field"><span class="opp-field-label">输单原因<i class="opp-req" aria-hidden="true">*</i></span><select name="lostReason" required><option value="">请选择</option>${reasons.map(reason=>option(reason,reason,'')).join('')}</select></label><label class="opp-field"><span class="opp-field-label">输单说明</span><input name="lostNote" placeholder="可选"></label></div></form>`;

    function analysisMarkup(report,view={}){
      const s=report.summary,c=report.currency;
      const tile=(label,value,note='')=>`<div class="team-tile"><span>${label}</span><strong>${value}</strong>${note?`<span class="muted tiny">${note}</span>`:''}</div>`;
      const percent=value=>value===null?'—':`${value}%`;
      const max=Math.max(1,...report.stages.map(stage=>stage.count));
      return `<div class="business-scroll opp-page"><div class="opp-summary is-compact"><label class="opp-currency"><span>币种</span><select id="opp-analysis-currency" aria-label="币种">${(report.currencies.length?report.currencies:[c]).map(code=>option(code,code,c)).join('')}</select></label>${report.flows&&report.flows.length>1?`<label class="opp-currency"><span>销售流程</span>${flowSelect('opp-analysis-flow',report.flows,report.flow)}</label>`:''}${report.otherCurrencyCount?`<p class="opp-summary-note">另有 ${report.otherCurrencyCount} 个其他币种的商机未计入本页；不同币种不折算。</p>`:''}</div>`
        +`<div class="team-tiles">${tile('新建商机数',s.created)}${tile('进行中',s.open,money(s.openAmount,c))}${tile('赢单',s.won,money(s.wonAmount,c))}${tile('输单',s.lost,money(s.lostAmount,c))}${tile('赢单率',percent(s.winRate),'赢单 ÷（赢单＋输单）')}${tile('平均成交周期',s.averageDays===null?'—':`${s.averageDays} 天`,'创建到首次赢单')}</div>`
        +`<div class="business-columns"><section class="business-section"><div class="section-head"><h3>销售阶段分布</h3><span class="muted tiny">按商机数量</span></div><div class="opp-bars">${report.stages.map(stage=>`<div class="opp-bar opp-kind-${stage.kind||'open'}"><span class="opp-bar-label">${E(stage.label)}</span><span class="opp-bar-track"><i style="width:${Math.round(stage.count/max*100)}%"></i></span><b class="opp-bar-count">${stage.count} 个 · ${stage.percent}%</b><span class="opp-bar-amount">${money(stage.amount,c)}</span></div>`).join('')}</div></section>`
        +`<section class="business-section"><div class="section-head"><h3>输单原因</h3></div><table class="order-table team-table"><thead><tr><th>原因</th><th>数量</th><th>金额</th></tr></thead><tbody>${report.lostReasons.map(row=>`<tr><td>${E(row.reason)}</td><td>${row.count}</td><td>${money(row.amount,c)}</td></tr>`).join('')||'<tr><td colspan="3">所选范围内没有输单</td></tr>'}</tbody></table></section>`
        +(!vis('sources')?'':`<section class="business-section"><div class="section-head"><h3>商机来源</h3><span class="muted tiny">选了几个来源的商机，在每个来源下各算一次</span></div><table class="order-table team-table"><thead><tr><th>来源</th><th>数量</th><th>金额</th></tr></thead><tbody>${(report.sources||[]).map(row=>`<tr><td>${E(row.source)}</td><td>${row.count}</td><td>${money(row.amount,c)}</td></tr>`).join('')||'<tr><td colspan="3">所选范围内没有商机</td></tr>'}</tbody></table></section>`)+`</div>`
        +`<section class="business-section"><div class="section-head"><h3>按负责人</h3><span class="muted tiny">按商机上填写的负责人名称汇总，只差大小写的算同一个人；已归档的商机也计入本页</span></div><div class="team-table-scroll"><table class="order-table team-table"><thead><tr><th>负责人</th><th>新建</th><th>进行中</th><th>赢单</th><th>输单</th><th>赢单金额</th><th>赢单率</th><th>平均成交周期</th></tr></thead><tbody>${report.owners.map(row=>`<tr><td>${E(row.owner)}</td><td>${row.created}</td><td>${row.open}</td><td>${row.won}</td><td>${row.lost}</td><td>${money(row.wonAmount,c)}</td><td>${percent(row.winRate)}</td><td>${row.averageDays===null?'—':row.averageDays+' 天'}</td></tr>`).join('')||'<tr><td colspan="8">所选范围内没有商机</td></tr>'}</tbody></table></div></section></div>`;
    }

    // ---------- 销售流程设置 ----------
    // summary：model.flowSummary 的结果；view：{flow 当前流程, armed 等待再次确认删除的那一项}。
    const KIND_NOTES={open:'金额计入「进行中」；过了结束日期会提示逾期。',won:'金额计入「赢单」；可以生成订单；进入时记下赢单时间。',lost:'金额计入「输单」；移入时必须填写输单原因。每个流程固定一个，不能删除。'};
    function flowsLayout(summary,view={}){
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
      return `<div class="opp-flow-layout">`
        +`<aside class="business-section opp-flow-side"><h3>销售流程</h3><div class="opp-flow-items">${list}</div>`
        +`<form class="opp-flow-add" id="opp-flow-add"><h4>新建流程</h4><input name="label" maxlength="20" placeholder="流程名称，例如：样品单流程" aria-label="新流程名称" required><label class="opp-flow-copy"><span>阶段复制自</span><select name="copyFrom" aria-label="阶段复制自">${summary.map(item=>option(item.id,item.label,flow.id)).join('')}</select></label><button type="submit" class="primary">新建流程</button></form></aside>`
        +`<section class="business-section opp-flow-detail"><div class="error" id="opp-flow-error" role="alert"></div>`
        +`<div class="opp-flow-head"><label class="opp-flow-name"><span>流程名称</span><input data-flow-rename="${E(flow.id)}" value="${E(flow.label)}" maxlength="20" aria-label="流程名称"></label><div class="opp-flow-remove">${remove}</div></div>`
        +`<p class="muted tiny opp-flow-note">阶段从左到右就是看板上的列。名称改完按回车或点别处即保存；阶段的类型（进行中／赢单）建好后不能改，需要时新建一个再把商机移过去。</p>`
        +group('open')+group('won')+group('lost')+`</section></div>`;
    }
    const flowsMarkup=(summary,view={})=>`<div class="business-scroll opp-page opp-flows">${flowsLayout(summary,view)}</div>`;

    // ---------- 商机设置页：销售流程 | 输单原因 | 商机字段 ----------
    const SET_TABS=[['flows','销售流程'],['reasons','输单原因'],['fields','商机字段']];
    const SET_NOTES={
      flows:'每个流程有自己的一组阶段；看板的列、表单里的阶段都跟着这里走。',
      reasons:'商机移到输单时，要从这里选一个原因。',
      fields:'决定新建和编辑商机时有哪些字段、哪些必填，也可以加自己的字段。'
    };
    const useText=(count,done='个商机在用',none='没有商机在用')=>count?`${count} ${done}`:none;
    // 一份可增删改排的名单（输单原因、商机类型）。items：[{name,count}]；kind：reasons | types。
    function choiceBlock(kind,items,view,{label,limit,placeholder}){
      const rows=items.map((item,index)=>{
        const armed=view.armed===`${kind}:${item.name}`;
        return `<li><div class="cs-row"><input class="opp-set-name" data-set-rename="${kind}" data-key="${E(item.name)}" value="${E(item.name)}" maxlength="${model.SET_LIMITS.choiceLen}" aria-label="${label}：${E(item.name)}" autocomplete="off">`
          +`<span class="cs-use">${useText(item.count)}</span><span class="cs-row-actions">`
          +`<button type="button" data-set-action="up" data-list="${kind}" data-key="${E(item.name)}" aria-label="上移：${E(item.name)}"${index===0?' disabled':''}>↑</button>`
          +`<button type="button" data-set-action="down" data-list="${kind}" data-key="${E(item.name)}" aria-label="下移：${E(item.name)}"${index===items.length-1?' disabled':''}>↓</button>`
          +`<button type="button" class="${armed?'team-danger':''}" data-set-action="remove" data-list="${kind}" data-key="${E(item.name)}" aria-label="${armed?'再点一次确认删除':'删除'}：${E(item.name)}">${armed?'再点一次确认删除':'删除'}</button></span></div></li>`;
      }).join('');
      return `<form class="cs-add" id="opp-${kind}-add" data-list="${kind}"><input name="text" maxlength="${model.SET_LIMITS.choiceLen}" placeholder="${placeholder}" aria-label="${placeholder}" autocomplete="off" required><button type="submit" class="primary">添加</button></form>`
        +(items.length?`<ul class="cs-list">${rows}</ul>`:`<p class="cs-empty">还没有${label}。</p>`)
        +`<p class="cs-hint">最多 ${limit} 个，每个不超过 ${model.SET_LIMITS.choiceLen} 个字，不能重名。名称改完按回车或点别处即保存。</p>`;
    }
    function reasonsTab(data,view){
      return `<h2>输单原因</h2><p class="cs-note">${SET_NOTES.reasons}已有商机在用的原因不能删除，可以先改名。</p><div class="cs-error error" id="opp-set-error" role="alert"></div>`
        +choiceBlock('reasons',data.reasons,view,{label:'输单原因',limit:model.SET_LIMITS.reasons,placeholder:'新的输单原因'})
        +`<p class="cs-hint">至少保留一个原因。改名后，用了它的商机会跟着改。</p>`;
    }
    function fieldsTab(data,view){
      const fixedNote={lostReason:'输单时必填',number:'自动生成，只读',exchangeRate:'美元以外才出现',contact:'客户有联系人时才必填',flow:'有多个销售流程时才出现'};
      const sysRows=data.fields.map(row=>{
        const note=fixedNote[row.id]?`<small class="opp-set-note">${E(fixedNote[row.id])}</small>`:'';
        return `<tr><td>${E(row.label)}${note}</td><td>${E(row.type)}</td>`
          +`<td><label class="check-row"><input type="checkbox" data-set-field="${row.id}" data-prop="show"${row.show?' checked':''}${row.showLocked?' disabled':''} aria-label="${E(row.label)}显示"> 显示</label></td>`
          +`<td><label class="check-row"><input type="checkbox" data-set-field="${row.id}" data-prop="required"${row.required?' checked':''}${row.requiredLocked?' disabled':''} aria-label="${E(row.label)}必填"> 必填</label></td></tr>`;
      }).join('');
      const cfRows=data.customFields.map((field,index)=>{
        const armed=view.armed===`cf:${field.id}`,hasOptions=field.type==='select'||field.type==='multi';
        return `<li class="opp-cf"><div class="cs-row"><input class="opp-set-name" data-cf-rename="${E(field.id)}" value="${E(field.name)}" maxlength="${model.SET_LIMITS.choiceLen}" aria-label="字段名称：${E(field.name)}" autocomplete="off">`
          +`<span class="opp-cf-type">${E(model.customTypeLabel(field.type))}</span>`
          +`<label class="check-row"><input type="checkbox" data-cf-required="${E(field.id)}"${field.required?' checked':''} aria-label="${E(field.name)}必填"> 必填</label>`
          +`<span class="cs-use">${useText(field.count,'个商机已填','还没有商机填过')}</span><span class="cs-row-actions">`
          +`<button type="button" data-set-action="cf-up" data-key="${E(field.id)}" aria-label="上移：${E(field.name)}"${index===0?' disabled':''}>↑</button>`
          +`<button type="button" data-set-action="cf-down" data-key="${E(field.id)}" aria-label="下移：${E(field.name)}"${index===data.customFields.length-1?' disabled':''}>↓</button>`
          +`<button type="button" class="${armed?'team-danger':''}" data-set-action="cf-remove" data-key="${E(field.id)}" aria-label="${armed?'再点一次确认删除':'删除'}：${E(field.name)}">${armed?'再点一次确认删除':'删除'}</button></span></div>`
          +(hasOptions?`<label class="opp-cf-options"><span>选项（每行一个）</span><textarea data-cf-options="${E(field.id)}" rows="3" aria-label="${E(field.name)}的选项">${E(field.options.join('\n'))}</textarea></label>`:'')
          +(armed&&field.count?`<p class="opp-cf-warn">有 ${field.count} 个商机填过这个字段。删除后它们的内容不再显示，但数据还留着。</p>`:'')
          +`</li>`;
      }).join('');
      const full=data.customFields.length>=model.SET_LIMITS.customFields;
      return `<h2>商机字段</h2><p class="cs-note">${SET_NOTES.fields}</p><div class="cs-error error" id="opp-set-error" role="alert"></div>`
        +`<section class="cs-section"><h3>系统字段</h3><table class="cs-table"><thead><tr><th>字段</th><th>类型</th><th>显示</th><th>必填</th></tr></thead><tbody>${sysRows}</tbody></table><p class="cs-hint">勾选后马上生效。隐藏的字段不在新建和编辑表单里出现，已填的内容保留。</p></section>`
        +`<section class="cs-section"><h3>商机类型</h3><p class="cs-hint">表单里的「商机类型」从这里选。</p>${choiceBlock('types',data.types,view,{label:'商机类型',limit:model.SET_LIMITS.types,placeholder:'新的商机类型'})}</section>`
        +`<section class="cs-section"><h3>自定义字段</h3><p class="cs-hint">在表单的「自定义字段」里出现，也显示在商机详情里。最多 ${model.SET_LIMITS.customFields} 个。</p>`
        +(full?`<p class="cs-full">已经有 ${model.SET_LIMITS.customFields} 个自定义字段，删掉一些再添加。</p>`
          :`<form class="opp-cf-add" id="opp-cf-add"><input name="name" maxlength="${model.SET_LIMITS.choiceLen}" placeholder="字段名称，例如：付款方式" aria-label="新字段名称" autocomplete="off" required><select name="type" aria-label="字段类型">${model.CUSTOM_TYPES.map(([id,text])=>option(id,text,'text')).join('')}</select><label class="check-row"><input type="checkbox" name="required"> 必填</label><textarea name="options" rows="2" maxlength="2000" placeholder="单选、多选的选项，每行一个（最多 ${model.SET_LIMITS.options} 个）" aria-label="新字段的选项"></textarea><button type="submit" class="primary">添加字段</button></form>`)
        +(data.customFields.length?`<ul class="cs-list">${cfRows}</ul>`:'<p class="cs-empty">还没有自定义字段。</p>')
        +`<p class="cs-hint">类型建好后不能改，需要时新建一个。删除只是从表单里拿掉，已填的内容不会丢。</p></section>`;
    }
    // data：{summary 销售流程, reasons [{name,count}], types [{name,count}], fields 系统字段, customFields [{...字段,count}]}；view：{tab, flow, armed}。
    function settingsMarkup(data,view={}){
      const tab=SET_TABS.some(item=>item[0]===view.tab)?view.tab:'flows';
      const nav=`<nav class="cs-nav opp-set-tabs" aria-label="商机设置">${SET_TABS.map(([id,text])=>`<button type="button" data-opp-set-tab="${id}" class="${id===tab?'active':''}"${id===tab?' aria-current="page"':''}>${E(text)}</button>`).join('')}</nav>`;
      const body=tab==='flows'?`<div class="opp-flows opp-set-flows">${flowsLayout(data.summary,view)}</div>`
        :`<div class="cs-panel opp-set-panel" data-opp-set-panel="${tab}">${tab==='reasons'?reasonsTab(data,view):fieldsTab(data,view)}</div>`;
      return `<div class="business-scroll opp-page opp-set">${nav}${body}</div>`;
    }
    // 删除一个还有商机的阶段：先选把商机移到哪里。
    function stageRemoveMarkup(flow,stage){
      const targets=flow.stages.filter(item=>item.id!==stage.id&&item.kind!=='lost');
      return `<form class="drawer-body opp-form" id="opp-stage-remove-form" data-flow="${E(flow.id)}" data-stage="${E(stage.id)}"><div class="error" id="opp-stage-remove-error" role="alert"></div><p class="opp-lead">「${E(stage.label)}」里还有 ${stage.count} 个商机。删除这个阶段前，先选好把它们移到哪个阶段。</p><div class="opp-grid"><label class="opp-field is-wide"><span class="opp-field-label">移到<i class="opp-req" aria-hidden="true">*</i></span><select name="moveTo" required><option value="">请选择</option>${targets.map(item=>option(item.id,`${item.label}（${(model.KIND_LABELS||{})[item.kind]||item.kind}）`,'')).join('')}</select><span class="opp-field-hint">不能直接移到输单：输单需要逐个填写原因。移到另一类阶段时，赢单时间会按现在重新记录或清除。</span></label></div></form>`;
    }
    // 菜单贴着被点的那张卡片：优先放在卡片右边，右边放不下放左边，都不够就贴着窗口边；纵向与卡片顶对齐，不够高就上移。
    // anchor：卡片的 getBoundingClientRect；view：{width,height}；size：{width,height}（菜单自身，高度取实际量到的）。
    function menuPosition(anchor,view,size,gap=8,edge=8){
      const width=Math.min(size.width,view.width-edge*2);
      const height=Math.min(size.height,view.height-edge*2);
      let left=anchor.right+gap;
      if(left+width>view.width-edge) left=anchor.left-gap-width;
      left=Math.max(edge,Math.min(left,view.width-edge-width));
      const top=Math.max(edge,Math.min(anchor.top,view.height-edge-height));
      return {left:Math.round(left),top:Math.round(top),maxHeight:Math.round(view.height-edge*2)};
    }
    // 订单表单顶部的来源提示：这张订单是从哪个商机生成的、哪些内容是预填的。
    function sourceBannerMarkup(card){
      if(!card) return '';
      return `<div class="opp-source-banner" role="note"><strong>由商机生成</strong><span>「${E(card.name)}」· ${E(card.client)} · ${money(card.amount,card.currency)}。客户、金额等已按商机预填，保存订单后会自动关联到这个商机。</span></div>`;
    }
    return {dropBefore,scrollStep,detailMarkup,attachmentsInner,fileSize,stamp,sourceBannerMarkup,menuPosition,flowsMarkup,settingsMarkup,stageRemoveMarkup,stageOptions,boardMarkup,headerActions,cardMarkup,contactOptions,formMarkup,menuMarkup,lostMarkup,analysisMarkup,shortDate};
  }
  const api={create,PAGE};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LaiOpportunityUI=api;
})(typeof window!=='undefined'?window:globalThis);
