(function(root){
  'use strict';
  // 线索页面的纯标记生成：列表、回收站、新建／编辑表单、详情（含写跟进）、转客户、标记无效。不读写数据。
  const PAGE=50;
  function create(E,model){
    const option=(value,label,current)=>`<option value="${E(value)}"${String(value)===String(current)?' selected':''}>${E(label)}</option>`;
    const shortDate=(day,today)=>day?(String(day).slice(0,4)===String(today).slice(0,4)?String(day).slice(5):String(day)):'—';
    const chip=row=>`<span class="opp-chip lead-status lead-status-${E(row.status)}">${E(row.statusLabel)}</span>`;
    const customerLink=row=>row.convertedTo?(row.convertedExists?`<button type="button" class="company-link" data-biz-customer="${E(row.convertedTo)}">${E(row.convertedTo)}</button>`:`<span title="该客户已改名或已删除">${E(row.convertedTo)}</span>`):'';
    function duplicateNote(row){
      const parts=[];
      if(row.duplicate.customer)parts.push(`与客户「${row.duplicate.customer}」的名称或邮箱相同`);
      if(row.duplicate.leads.length)parts.push(`与另外 ${row.duplicate.leads.length} 条线索的名称或邮箱相同`);
      return parts.join('；');
    }
    function nextFollowCell(row,today){
      if(!row.nextFollow)return '<span class="lead-muted">—</span>';
      if(row.overdue)return `<span class="opp-due is-overdue">逾期 ${E(shortDate(row.nextFollow,today))}</span>`;
      if(row.dueToday)return '<span class="opp-due lead-today">今天</span>';
      return E(shortDate(row.nextFollow,today));
    }

    // 状态页签：数字是当前搜索和筛选条件下各状态的数量。
    function tabs(page){
      const tab=(id,label)=>`<button type="button" role="tab" data-lead-status="${id}" aria-selected="${page.filters.status===id}">${E(label)}<b>${page.counts[id]}</b></button>`;
      return `<div class="lead-tabs" role="tablist" aria-label="线索状态">${tab('all','全部')}${model.STATUSES.map(status=>tab(status.id,status.label)).join('')}</div>`;
    }
    function toolbar(page){
      const f=page.filters;
      const owners=page.owners.map(name=>option(name,name,f.owner&&name.toLowerCase()===f.owner.toLowerCase()?name:'')).join('')+(page.hasUnassigned?option('未分配','未分配',f.owner):'');
      const sources=page.sources.map(name=>option(name,name,f.source&&name.toLowerCase()===f.source.toLowerCase()?name:'')).join('');
      return `<div class="opp-toolbar lead-toolbar"><input type="search" id="lead-search" value="${E(f.search)}" placeholder="搜索名称、联系人、邮箱、电话、产品" aria-label="搜索线索">`
        +`<select id="lead-owner" aria-label="跟进人"><option value="">全部跟进人</option>${owners}</select>`
        +`<select id="lead-source" aria-label="线索来源"><option value="">全部来源</option>${sources}</select>`
        +`<button type="button" class="lead-due-toggle" data-lead-action="due" aria-pressed="${f.due}">该跟进的<b>${page.dueCount}</b></button>`
        +`<select id="lead-sort" class="opp-sort" aria-label="排序">${model.SORTS.map(([id,label])=>option(id,label,f.sort)).join('')}</select></div>`;
    }
    function rowActions(row){
      if(row.status==='converted')return `<button type="button" data-lead-action="open" data-id="${E(row.id)}">查看</button>`;
      if(row.status==='invalid')return `<button type="button" data-lead-action="reopen" data-id="${E(row.id)}">重新跟进</button>`;
      return `<button type="button" data-lead-action="follow" data-id="${E(row.id)}">写跟进</button><button type="button" class="lead-convert" data-lead-action="convert" data-id="${E(row.id)}">转为客户</button>`;
    }
    function table(page,view,today){
      const limit=Math.max(PAGE,Number(view.limit)||PAGE);
      const shown=page.rows.slice(0,limit),rest=page.rows.length-shown.length;
      if(!page.total)return `<section class="business-section lead-empty"><strong>还没有线索</strong><p>线索是还没成为客户的潜在买家：展会上拿到的名片、官网的询盘、别人介绍的联系人。先记在这里跟进，谈成了再一键转为客户。</p><button type="button" class="primary" data-lead-action="new">新建线索</button></section>`;
      if(!page.rows.length)return '<section class="business-section lead-empty"><strong>没有符合条件的线索</strong><p>换一个状态，或清空搜索和筛选条件再看。</p></section>';
      const body=shown.map(row=>{
        const dup=duplicateNote(row);
        return `<tr${row.overdue?' class="lead-row-overdue"':''}><td><button type="button" class="company-link" data-lead-action="open" data-id="${E(row.id)}">${E(row.name)}</button>${dup?`<span class="opp-chip lead-dup" title="${E(dup)}">可能重复</span>`:''}${row.product?`<small class="lead-sub">${E(row.product)}</small>`:''}</td>`
          +`<td>${E(row.contact||'—')}${row.email?`<small class="lead-sub">${E(row.email)}</small>`:row.phone?`<small class="lead-sub">${E(row.phone)}</small>`:''}</td>`
          +`<td class="lead-nowrap">${E(row.country||'—')}</td><td class="lead-nowrap">${E(row.source||'—')}</td><td class="lead-nowrap">${E(row.owner||'未分配')}</td>`
          +`<td>${chip(row)}${row.status==='converted'?`<small class="lead-sub">${customerLink(row)}</small>`:row.status==='invalid'&&row.invalidReason?`<small class="lead-sub">${E(row.invalidReason)}</small>`:''}</td>`
          +`<td>${row.lastFollowDay?`<span class="lead-nowrap">${E(shortDate(row.lastFollowDay,today))}</span><small class="lead-sub lead-clip" title="${E(row.lastFollowText)}">${E(row.lastFollowText)}</small>`:'<span class="lead-muted">未跟进</span>'}</td>`
          +`<td class="lead-nowrap">${nextFollowCell(row,today)}</td><td class="lead-nowrap">${E(shortDate(row.createdDay,today))}</td><td class="lead-actions">${rowActions(row)}</td></tr>`;
      }).join('');
      return `<section class="business-section opp-list lead-list"><div class="team-table-scroll"><table class="order-table team-table lead-table"><thead><tr><th>线索名称</th><th>联系人</th><th>国家地区</th><th>来源</th><th>跟进人</th><th>状态</th><th>最近跟进</th><th>下次跟进</th><th>创建</th><th>操作</th></tr></thead><tbody>${body}</tbody></table></div>`
        +(rest>0?`<button type="button" class="opp-more" data-lead-action="more">再显示 ${Math.min(PAGE,rest)} 条（还有 ${rest} 条）</button>`:'')+'</section>';
    }
    const pageMarkup=(page,view={},today='')=>`<div class="business-scroll opp-page lead-page">${tabs(page)}${toolbar(page)}${table(page,view,today)}</div>`;
    const headerActions=page=>`<button type="button" data-lead-action="trash-page">回收站${page.trashCount?`（${page.trashCount}）`:''}</button><button type="button" class="primary" data-lead-action="new">新建线索</button>`;

    function trashMarkup(rows,armed='',today=''){
      if(!rows.length)return '<div class="business-scroll opp-page lead-page"><section class="business-section lead-empty"><strong>回收站是空的</strong><p>移入回收站的线索会放在这里，可以恢复，也可以彻底删除。</p></section></div>';
      return `<div class="business-scroll opp-page lead-page"><div class="error" id="lead-trash-error" role="alert"></div><section class="business-section opp-list lead-list"><div class="team-table-scroll"><table class="order-table team-table lead-table"><thead><tr><th>线索名称</th><th>联系人</th><th>来源</th><th>跟进人</th><th>状态</th><th>移入时间</th><th>操作</th></tr></thead><tbody>${rows.map(row=>
        `<tr><td>${E(row.name)}</td><td>${E(row.contact||'—')}${row.email?`<small class="lead-sub">${E(row.email)}</small>`:''}</td><td>${E(row.source||'—')}</td><td>${E(row.owner||'未分配')}</td><td>${chip(row)}</td><td>${E(shortDate(row.trashedDay,today))}</td>`
        +`<td class="lead-actions"><button type="button" data-lead-action="restore" data-id="${E(row.id)}">恢复</button><button type="button" class="lead-danger" data-lead-action="delete" data-id="${E(row.id)}">${armed===row.id?'再点一次，彻底删除':'彻底删除'}</button></td></tr>`).join('')}</tbody></table></div></section></div>`;
    }

    const req='<i class="opp-req" aria-hidden="true">*</i>';
    const field=(label,control,{required=false,wide=false,hint=''}={})=>`<label class="opp-field${wide?' is-wide':''}"><span class="opp-field-label">${label}${required?req:''}</span>${control}${hint?`<span class="opp-field-hint">${hint}</span>`:''}</label>`;
    const datalist=(id,values)=>`<datalist id="${id}">${(values||[]).map(value=>`<option value="${E(value)}"></option>`).join('')}</datalist>`;
    function formMarkup(values,context={}){
      const v=values||{};
      return `<form class="drawer-body opp-form lead-form" id="lead-form"><div class="error" id="lead-error" role="alert"></div>`
        +`<div class="form-section">基本信息</div><div class="opp-grid">`
        +field('线索名称',`<input name="name" value="${E(v.name||'')}" placeholder="公司名称；个人买家填姓名" maxlength="120" autocomplete="off" required>`,{required:true,wide:true})
        +field('联系人',`<input name="contact" value="${E(v.contact||'')}" maxlength="80" autocomplete="off">`)
        +field('邮箱',`<input name="email" type="email" value="${E(v.email||'')}" maxlength="120" autocomplete="off">`)
        +field('电话',`<input name="phone" value="${E(v.phone||'')}" maxlength="40" autocomplete="off" placeholder="含国家区号">`)
        +field('国家地区',`<input name="country" value="${E(v.country||'')}" maxlength="60" autocomplete="off">`,{hint:'转为客户时必填，现在可以先空着'})
        +field('网址',`<input name="website" value="${E(v.website||'')}" maxlength="200" autocomplete="off">`,{wide:true})
        +`</div><div class="form-section">跟进安排</div><div class="opp-grid">`
        +field('线索来源',`<input name="source" value="${E(v.source||'')}" list="lead-source-list" maxlength="40" autocomplete="off" placeholder="输入或选择">${datalist('lead-source-list',context.sources)}`)
        +field('跟进人',`<input name="owner" value="${E(v.owner||'')}" list="lead-owner-list" maxlength="40" autocomplete="off" placeholder="留空表示未分配">${datalist('lead-owner-list',context.owners)}`)
        +field('下次跟进日期',`<input name="nextFollow" type="date" value="${E(v.nextFollow||'')}">`)
        +field('意向产品',`<input name="product" value="${E(v.product||'')}" maxlength="200" autocomplete="off">`)
        +field('备注',`<textarea name="note" rows="4" maxlength="2000">${E(v.note||'')}</textarea>`,{wide:true})
        +`</div></form>`;
    }

    // 详情：上面是资料和可做的操作，中间是写跟进，下面是全部记录（新的在前）。
    function detailMarkup(row,today=''){
      const open=['new','following'].includes(row.status);
      const info=(label,value)=>`<div class="lead-info"><dt>${label}</dt><dd>${value||'<span class="lead-muted">—</span>'}</dd></div>`;
      const dup=duplicateNote(row);
      const actions=row.trashed?`<button type="button" data-lead-action="restore" data-id="${E(row.id)}">从回收站恢复</button>`
        :`<button type="button" data-lead-action="edit" data-id="${E(row.id)}">编辑资料</button>`
          +(open?`<button type="button" class="primary" data-lead-action="convert" data-id="${E(row.id)}">转为客户</button><button type="button" data-lead-action="invalid" data-id="${E(row.id)}">标记无效</button>`:'')
          +(row.status==='invalid'?`<button type="button" class="primary" data-lead-action="reopen" data-id="${E(row.id)}">重新跟进</button>`:'')
          +`<button type="button" class="lead-danger" data-lead-action="trash" data-id="${E(row.id)}">移入回收站</button>`;
      const banner=row.status==='converted'?`<p class="lead-banner is-converted">已于 ${E(row.convertedDay||'—')} 转为客户 ${customerLink(row)}。之后的跟进请写在客户资料里。</p>`
        :row.status==='invalid'?`<p class="lead-banner is-invalid">已标记为无效：${E(row.invalidReason||'未填原因')}${row.invalidNote?`（${E(row.invalidNote)}）`:''}</p>`:'';
      const follow=open&&!row.trashed?`<form class="lead-follow" id="lead-follow-form" data-id="${E(row.id)}"><div class="error" id="lead-follow-error" role="alert"></div>`
        +`<label class="opp-field is-wide"><span class="opp-field-label">写跟进</span><textarea name="text" rows="3" maxlength="2000" placeholder="这次联系了什么、对方怎么说、下一步做什么" required></textarea></label>`
        +`<div class="lead-follow-row"><label class="opp-field"><span class="opp-field-label">下次跟进日期</span><input name="nextFollow" type="date" value="${E(row.nextFollow||'')}"></label><button class="primary" type="submit">保存跟进</button></div></form>`:'';
      const timeline=row.history.length?`<ol class="lead-timeline">${row.history.map(entry=>`<li class="is-${entry.type}"><time>${E(entry.day||'—')}</time><span class="lead-entry-kind">${entry.type==='followup'?'跟进':'操作'}</span><p>${E(entry.text)}</p></li>`).join('')}</ol>`:'<p class="lead-muted lead-no-history">还没有记录</p>';
      return `<div class="drawer-body opp-form lead-detail"><div class="error" id="lead-detail-error" role="alert"></div>`
        +`<div class="lead-detail-head">${chip(row)}${row.overdue?`<span class="opp-due is-overdue">跟进逾期 ${E(shortDate(row.nextFollow,today))}</span>`:row.dueToday?'<span class="opp-due lead-today">今天该跟进</span>':''}${dup?`<span class="opp-chip lead-dup">可能重复</span>`:''}</div>`
        +(dup?`<p class="lead-banner is-dup">${E(dup)}。转为客户时可以选择关联到已有客户。</p>`:'')+banner
        +`<dl class="lead-infos">${info('联系人',E(row.contact))}${info('邮箱',E(row.email))}${info('电话',E(row.phone))}${info('国家地区',E(row.country))}${info('线索来源',E(row.source))}${info('跟进人',E(row.owner||'未分配'))}${info('意向产品',E(row.product))}${info('网址',E(row.website))}${info('下次跟进',row.nextFollow?E(row.nextFollow):'')}${info('创建时间',E(row.createdDay))}</dl>`
        +(row.note?`<p class="lead-note">${E(row.note)}</p>`:'')
        +`<div class="lead-detail-actions">${actions}</div>${follow}<div class="form-section">记录</div>${timeline}</div>`;
    }

    // 转为客户：新建客户档案（名称、国家地区、客户来源必填），或关联到已有客户。
    function convertMarkup(row,values,context={}){
      const v=values||{},existing=v.mode==='existing';
      return `<form class="drawer-body opp-form lead-form" id="lead-convert-form" data-id="${E(row.id)}"><div class="error" id="lead-convert-error" role="alert"></div>`
        +`<p class="lead-banner">把线索「${E(row.name)}」转为客户。线索会保留在列表里并标记为已转客户，之后的跟进写在客户资料里。</p>`
        +`<fieldset class="opp-field is-wide"><legend class="opp-field-label">转入方式</legend><span class="opp-seg"><label><input type="radio" name="mode" value="new"${existing?'':' checked'}><span>新建客户</span></label><label><input type="radio" name="mode" value="existing"${existing?' checked':''}><span>关联已有客户</span></label></span></fieldset>`
        +`<div class="opp-grid" id="lead-convert-new"${existing?' hidden':''}>`
        +field('客户名称',`<input name="name" value="${E(v.name||'')}" maxlength="120" autocomplete="off"${existing?' disabled':' required'}>`,{required:true,wide:true})
        +field('国家地区',`<input name="country" value="${E(v.country||'')}" maxlength="60" autocomplete="off"${existing?' disabled':' required'}>`,{required:true})
        +field('客户来源',`<input name="source" value="${E(v.source||'')}" list="lead-convert-source-list" maxlength="40" autocomplete="off"${existing?' disabled':' required'}>${datalist('lead-convert-source-list',context.sources)}`,{required:true})
        +field('跟进人',`<input name="owner" value="${E(v.owner||'')}" list="lead-convert-owner-list" maxlength="40" autocomplete="off"${existing?' disabled':''}>${datalist('lead-convert-owner-list',context.owners)}`,{wide:true,hint:'联系人、邮箱、电话、网址、意向产品、备注会一起带到客户资料里'})
        +`</div><div class="opp-grid" id="lead-convert-existing"${existing?'':' hidden'}>`
        +field('已有客户',`<input name="existing" value="${E(v.existing||'')}" list="lead-convert-customer-list" autocomplete="off" placeholder="输入或选择客户"${existing?' required':' disabled'}>${datalist('lead-convert-customer-list',context.customers)}`,{required:true,wide:true,hint:'只做关联，不会改动这个客户的资料'})
        +`</div></form>`;
    }
    function invalidMarkup(row){
      return `<form class="drawer-body opp-form lead-form" id="lead-invalid-form" data-id="${E(row.id)}"><div class="error" id="lead-invalid-error" role="alert"></div>`
        +`<p class="lead-banner">把线索「${E(row.name)}」标记为无效。以后想再跟进，可以点「重新跟进」。</p><div class="opp-grid">`
        +field('无效原因',`<select name="reason" required><option value="">请选择</option>${model.INVALID_REASONS.map(reason=>option(reason,reason,'')).join('')}</select>`,{required:true,wide:true})
        +field('补充说明',`<input name="note" maxlength="200" autocomplete="off">`,{wide:true})
        +`</div></form>`;
    }
    return {pageMarkup,headerActions,trashMarkup,formMarkup,detailMarkup,convertMarkup,invalidMarkup};
  }
  const api={create,PAGE};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LaiLeadUI=api;
})(typeof window!=='undefined'?window:globalThis);
