(function(root){
  'use strict';
  // 单据模板页的页面文字（HTML）：每种单据一个页签（左边改，右边预览），再加“公司信息”页签。只生成字符串，不读写数据。
  // can(key)：当前账号有没有这个权限（角色预览用）；没传时什么都显示。
  function create(E,M,can=()=>true){
    const TABS=[...M.TYPES.map(([id,label])=>[id,label]),['numbering','编号规则'],['records','单据记录'],['company','公司信息']];
    const typeLabel=type=>(M.TYPES.find(item=>item[0]===type)||[])[1]||'';
    const empty=text=>`<span class="dt-blank">${text}</span>`;
    const nav=view=>`<nav class="cs-nav" aria-label="单据模板">${TABS.map(([id,label])=>`<button type="button" data-doc-tab="${id}" class="${id===view.tab?'active':''}"${id===view.tab?' aria-current="page"':''}>${E(label)}</button>`).join('')}</nav>`;
    // 单据版面。预览和打印用同一份，打印时 CSS 另外内嵌（见 printHtml）。
    function documentMarkup(doc){
      const co=doc.company||{};
      const head=`<header class="dt-head"><div class="dt-co"><strong>${co.name?E(co.name):empty('（请在“公司信息”里填写公司名称）')}</strong>${[co.address,co.phone,co.email,co.website].filter(Boolean).map(v=>`<span>${E(v)}</span>`).join('')}</div><div class="dt-title"><h2>${E(doc.title)}</h2><span>${E(doc.subtitle||'')}</span></div></header>`;
      const meta=`<dl class="dt-meta"><div><dt>客户</dt><dd>${E(doc.client||'—')}</dd></div><div><dt>单号</dt><dd>${E(doc.number||doc.numberNote||'—')}</dd></div>${doc.reference?`<div><dt>${E(doc.reference.label)}</dt><dd>${E(doc.reference.value)}</dd></div>`:''}<div><dt>币种</dt><dd>${E(doc.currency)}</dd></div></dl>`;
      const numeric=['qty','price','amount'];
      const table=`<table class="dt-table"><thead><tr>${doc.columns.map(([key,label])=>`<th${numeric.includes(key)?' class="num"':''}>${E(label)}</th>`).join('')}</tr></thead><tbody>${doc.rows.map(row=>`<tr>${doc.columns.map(([key])=>{
        const raw=key==='price'||key==='amount'?M.money(row[key]):row[key];
        return `<td${numeric.includes(key)?' class="num"':''}>${E(raw===undefined||raw===''?'—':raw)}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table>`;
      const total=doc.columns.some(([key])=>key==='amount')?`<p class="dt-total">合计 <strong>${E(doc.currency)} ${E(doc.total)}</strong></p>`:'';
      const terms=doc.terms.length?`<section class="dt-block"><h3>条款</h3>${doc.terms.map(t=>`<p>${E(t)}</p>`).join('')}</section>`:'';
      const bank=doc.bank.length?`<section class="dt-block"><h3>收款银行</h3>${doc.bank.map(([label,value])=>`<p><span>${E(label)}</span> ${E(value)}</p>`).join('')}</section>`:'';
      const sign=doc.showSignature?'<div class="dt-sign"><span>公司盖章 / 签名</span></div>':'';
      return `<article class="dt-doc">${head}${meta}${table}${total}${terms}${bank}${doc.footer?`<p class="dt-footer">${E(doc.footer)}</p>`:''}${sign}</article>`;
    }
    const check=(name,label,on,disabled)=>`<label class="check-row"><input type="checkbox" name="${name}"${on?' checked':''}${disabled?' disabled':''}> ${E(label)}</label>`;
    function typeTab(state,view){
      const t=M.settings(state).templates[view.tab];
      const doc=M.preview(state,view.tab,{date:view.date});
      const form=`<form class="dt-form" data-doc-form="template" data-type="${E(view.tab)}">`
        +`<label class="cs-field"><span>单据标题</span><input name="title" value="${E(t.title)}" maxlength="${M.LIMITS.title}" autocomplete="off"></label>`
        +`<fieldset class="cs-field"><legend>要显示的列</legend><div class="dt-checks">${M.COLUMNS.map(([key,label])=>check('col:'+key,label,t.columns[key],M.FIXED_COLUMNS.includes(key))).join('')}</div></fieldset>`
        +`<label class="cs-field"><span>条款（一行一条）</span><textarea name="terms" rows="5" maxlength="${M.LIMITS.text}">${E(t.terms)}</textarea></label>`
        +`<label class="cs-field"><span>落款</span><input name="footer" value="${E(t.footer)}" maxlength="${M.LIMITS.line}" autocomplete="off"></label>`
        +`<div class="dt-checks">${check('showBank','显示收款银行',t.showBank)}${check('showSignature','显示盖章 / 签名处',t.showSignature)}</div>`
        +`<div class="cs-actions"><button type="submit" class="primary">保存模板</button><button type="button" data-doc-action="reset" data-type="${E(view.tab)}">${view.armed==='reset'?'确定恢复':'恢复默认'}</button></div></form>`;
      const side=`<div class="dt-side"><div class="dt-side-head"><strong>预览</strong><button type="button" data-doc-action="print" data-type="${E(view.tab)}">打印 / 存为 PDF</button></div><div class="dt-paper" data-doc-preview="${E(view.tab)}">${documentMarkup(doc)}</div><p class="cs-hint">预览里的明细是示例${(state.laiProducts||[]).length?'，取自你的前几个产品':''}。改完保存，预览马上更新。</p></div>`;
      return `<div class="dt-grid">${form}${side}</div>`;
    }

    // ---------- 编号规则 ----------
    const exampleMarkup=(text,error)=>error?`<span class="dt-example-error">${E(error)}</span>`:`下一张：<strong>${E(text)}</strong>`;
    function numberingTab(state,view){
      const rules=M.settings(state).numbering;
      const card=([type,name])=>{
        const rule=rules[type];
        const select=(field,label,options,current)=>`<label class="cs-field"><span>${label}</span><select name="${field}">${options.map(([value,text])=>`<option value="${E(value)}"${String(value)===String(current)?' selected':''}>${E(text)}</option>`).join('')}</select></label>`;
        const digits=[];
        for(let n=M.DIGITS.min;n<=M.DIGITS.max;n++)digits.push([n,`${n} 位`]);
        return `<form class="dt-num-card" data-doc-form="numbering" data-type="${E(type)}"><h3>${E(name)}</h3><div class="dt-num-fields"><label class="cs-field"><span>前缀</span><input name="prefix" value="${E(rule.prefix)}" maxlength="10" autocomplete="off"></label>${select('dateMode','日期部分',M.DATE_MODES,rule.dateMode)}${select('digits','序号位数',digits,rule.digits)}${select('reset','序号从 1 重新数',M.RESETS,rule.reset)}</div><p class="dt-example" data-doc-example="${E(type)}">${exampleMarkup(M.nextNumber(state,type,view.date).number)}</p><div class="cs-actions"><button type="submit" class="primary">保存</button></div></form>`;
      };
      return `<div class="dt-num-grid">${M.TYPES.map(card).join('')}</div><p class="cs-hint">改了规则只影响以后保存的单据，已经保存的编号不会变。作废的单据编号也不会再用。</p>`;
    }
    // ---------- 单据记录 ----------
    const sourceText=doc=>doc.source&&doc.source.id?`${doc.source.kind==='opportunity'?'商机':'订单'} ${doc.source.label||''}`.trim():'—';
    function recordsTab(state,view){
      const filter=view.rec||{},docs=M.listDocuments(state,{type:filter.type,query:filter.query});
      const bar=`<div class="dt-records-bar"><select data-doc-filter="type" aria-label="单据类型"><option value="">全部类型</option>${M.TYPES.map(([id,name])=>`<option value="${E(id)}"${id===filter.type?' selected':''}>${E(name)}</option>`).join('')}</select><input type="search" data-doc-filter="query" value="${E(filter.query||'')}" placeholder="搜索编号或客户" aria-label="搜索单据" autocomplete="off"></div>`;
      if(!docs.length)return `${bar}<p class="dt-empty">${filter.type||filter.query?'没有符合条件的单据。':'还没有保存过单据。在订单或商机里生成单据，点“保存单据”，就会出现在这里。'}</p>`;
      const rows=docs.map(doc=>{
        const voided=doc.status==='已作废',armed=view.armedVoid===doc.id;
        const source=doc.source&&doc.source.id?`<button type="button" class="company-link" data-doc-action="source" data-kind="${E(doc.source.kind)}" data-id="${E(doc.source.id)}">${E(sourceText(doc))}</button>`:'—';
        return `<tr class="${voided?'is-void':''}"><td><b>${E(doc.number)}</b>${voided?' <span class="dt-void-chip">已作废</span>':''}</td><td>${E(typeLabel(doc.type))}</td><td>${E(doc.client)}</td><td class="num">${E(doc.currency)} ${E(M.money(doc.total))}</td><td>${E(doc.date||'—')}</td><td>${source}</td><td class="dt-row-actions"><button type="button" data-doc-action="view" data-id="${E(doc.id)}">查看</button>${voided||!can('doc.void')?'':`<button type="button" class="${armed?'team-danger':''}" data-doc-action="void" data-id="${E(doc.id)}">${armed?'确定作废':'作废'}</button>`}</td></tr>`;
      }).join('');
      return `${bar}<table class="cs-table dt-records"><thead><tr><th>编号</th><th>类型</th><th>客户</th><th class="num">金额</th><th>日期</th><th>来源</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table><p class="cs-hint">共 ${docs.length} 张。作废后单据留在这里，编号不会再用。</p>`;
    }
    // 保存过的单据：纸张部分（作废的加灰色和说明）。
    const paperMarkup=doc=>{
      const voided=doc.status==='已作废';
      return `${voided?'<p class="dt-void-note">这张单据已作废，不能再打印。</p>':''}<div class="dt-paper${voided?' is-void':''}">${documentMarkup(doc.snapshot)}</div>`;
    };
    // 某张订单／某个商机已经保存的单据列表，每行一个“查看”。
    const savedListMarkup=docs=>docs.length?`<div class="dt-saved"><span class="muted tiny">已保存的单据</span><ul>${docs.map(doc=>`<li class="${doc.status==='已作废'?'is-void':''}"><b>${E(doc.number)}</b><span>${E(typeLabel(doc.type))}</span><span>${E(doc.date||'')}</span>${doc.status==='已作废'?'<span class="dt-void-chip">已作废</span>':''}<button type="button" class="text-button" data-biz-action="docrec-view" data-id="${E(doc.id)}">查看</button></li>`).join('')}</ul></div>`:'';
    function companyTab(state){
      const s=M.settings(state);
      const group=(kind,fields,values)=>fields.map(([key,label])=>`<label class="cs-field"><span>${E(label)}</span><input name="${kind}:${key}" value="${E(values[key])}" maxlength="${M.LIMITS.line}" autocomplete="off"></label>`).join('');
      return `<form class="dt-form dt-company" data-doc-form="company"><section class="dt-group"><h3>公司信息</h3>${group('company',M.COMPANY_FIELDS,s.company)}</section><section class="dt-group"><h3>收款银行</h3>${group('bank',M.BANK_FIELDS,s.bank)}</section><div class="cs-actions"><button type="submit" class="primary">保存</button></div><p class="cs-hint">所有单据共用这里的公司信息和收款银行。银行信息只保存在这台电脑，不会发给任何人。</p></form>`;
    }
    function pageMarkup(state,view){
      const tab=TABS.some(([id])=>id===view.tab)?view.tab:TABS[0][0];
      const v={...view,tab};
      const label=(TABS.find(([id])=>id===tab)||[])[1];
      const notes={company:'报价单、形式发票等都会用到的公司和银行信息。',numbering:'每种单据怎么编号。保存单据时自动按这里的规则生成编号。',records:'所有保存过的单据。想重新打印，点“查看”。'};
      const note=notes[tab]||'决定这种单据长什么样。右边是预览，可以直接打印或存成 PDF。';
      const body=tab==='company'?companyTab(state):tab==='numbering'?numberingTab(state,v):tab==='records'?recordsTab(state,v):typeTab(state,v);
      return `<section class="cs-page">${nav(v)}<div class="cs-panel${tab==='records'?' dt-wide':''}" data-doc-panel="${E(tab)}"><h2>${E(label)}</h2><p class="cs-note">${E(note)}</p><div class="cs-error error" id="doc-error" role="alert"></div>${body}</div></section>`;
    }
    const PRINT_CSS='body{font:13px/1.5 -apple-system,"PingFang SC","Helvetica Neue",Arial,sans-serif;color:#111;margin:24px}.dt-head{display:flex;justify-content:space-between;gap:24px;border-bottom:2px solid #111;padding-bottom:12px}.dt-co span{display:block}.dt-title{text-align:right}.dt-title h2{margin:0;font-size:22px}.dt-meta{display:flex;gap:32px;margin:12px 0}.dt-meta dt{color:#666}.dt-meta dd{margin:0;font-weight:600}.dt-table{width:100%;border-collapse:collapse;margin-top:8px}.dt-table th,.dt-table td{border-bottom:1px solid #ccc;padding:6px 8px;text-align:left}.dt-table .num{text-align:right}.dt-total{text-align:right;margin:10px 0}.dt-block h3{font-size:13px;margin:14px 0 4px}.dt-block p{margin:2px 0}.dt-footer{margin-top:20px}.dt-sign{margin-top:48px;border-top:1px solid #111;width:220px;padding-top:4px;color:#666}';
    // 打印用的完整网页：只有单据本身。
    const printHtml=doc=>`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${E(doc.title)}</title><style>${PRINT_CSS}</style></head><body>${documentMarkup(doc)}</body></html>`;
    return {TABS,pageMarkup,documentMarkup,printHtml,paperMarkup,savedListMarkup,exampleMarkup,typeLabel};
  }
  const api={create};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LaiDocTemplateUI=api;
})(typeof window!=='undefined'?window:globalThis);
