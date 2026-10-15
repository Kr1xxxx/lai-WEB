(function(root){
  'use strict';
  // 产品页的页面文字（HTML）：产品列表、分组、字段、规格四个页签，以及新建／编辑产品的表单。只生成字符串，不读写数据。
  const TABS=Object.freeze([['list','产品列表'],['groups','产品分组'],['fields','产品字段'],['specs','规格管理']]);
  function create(E,M){
    const option=(value,label,current)=>`<option value="${E(value)}"${String(value)===String(current)?' selected':''}>${E(label)}</option>`;
    const empty=text=>`<div class="cs-empty">${text}</div>`;
    const section=(title,note,content)=>`<section class="cs-section"><h3>${E(title)}</h3>${note?`<p class="cs-hint">${note}</p>`:''}${content}</section>`;
    const day=value=>String(value||'').slice(0,10)||'—';

    function nav(view){
      return `<nav class="cs-nav" aria-label="产品">${TABS.map(([id,label])=>`<button type="button" data-prod-tab="${id}" class="${id===view.tab?'active':''}"${id===view.tab?' aria-current="page"':''}>${E(label)}</button>`).join('')}</nav>`;
    }
    // ---- 产品列表 ----
    function listTab(state,view){
      const rows=M.list(state,{search:view.search,group:view.group});
      const total=M.list(state).length;
      const groups=M.groupChoices(state);
      const toolbar=`<div class="opp-toolbar lead-toolbar"><input type="search" id="prod-search" value="${E(view.search||'')}" placeholder="搜索名称、编号、型号、备注" aria-label="搜索产品">`
        +`<select id="prod-group" aria-label="产品分组"><option value="">全部分组</option>${groups.map(g=>option(g,g,view.group)).join('')}</select>`
        +`<button type="button" class="primary" data-prod-action="new">新建产品</button></div>`;
      if(!total)return toolbar+empty('还没有产品。点“新建产品”添加；字段、分组、规格可以先在其他页签里设置。');
      if(!rows.length)return toolbar+empty('没有符合条件的产品，换个关键词或分组再看。');
      const body=rows.map(p=>{
        const armed=view.armed===p.id;
        return `<tr><td><button type="button" class="company-link" data-prod-action="edit" data-id="${E(p.id)}">${E(p.name)}</button>${p.nameCn?`<div class="cs-use">${E(p.nameCn)}</div>`:''}</td><td>${E(p.code||'—')}</td><td>${E(p.model||'—')}</td><td>${E(p.group||'未分组')}</td><td>${p.fob?E(p.fob):'—'}</td><td>${E(p.unit||'—')}</td><td>${E(day(p.updatedAt))}</td>`
          +`<td><span class="cs-row-actions"><button type="button" data-prod-action="edit" data-id="${E(p.id)}">编辑</button><button type="button" data-prod-action="delete" data-id="${E(p.id)}">${armed?'确定删除':'删除'}</button></span></td></tr>`;
      }).join('');
      return toolbar+`<table class="cs-table cs-prod"><thead><tr><th>产品名称</th><th>产品编号</th><th>产品型号</th><th>产品分组</th><th>离岸价</th><th>计量单位</th><th>更新</th><th>操作</th></tr></thead><tbody>${body}</tbody></table>`
        +`<p class="cs-hint">共 ${rows.length} 个产品${rows.length!==total?`（全部 ${total} 个）`:''}。删除后不能恢复。</p>`;
    }
    // ---- 产品分组 ----
    function groupsTab(state,view){
      const groups=M.settings(state).groups;
      const edit=view.editing;
      const rows=groups.map((g,index)=>{
        const used=M.groupUse(state,g.name);
        const renaming=edit&&edit.kind==='group'&&edit.key===g.id;
        const head=renaming
          ?`<form class="cs-inline" data-prod-form="group-rename" data-id="${E(g.id)}"><input name="name" value="${E(g.name)}" maxlength="20" aria-label="分组名称" autocomplete="off"><button type="submit" class="primary">保存</button><button type="button" data-prod-cancel>取消</button></form>`
          :`<strong>${E(g.name)}</strong><span class="cs-use">${used?`${used} 个产品在用`:'没有产品在用'}</span><span class="cs-row-actions"><button type="button" data-prod-move="${E(g.id)}" data-delta="-1" aria-label="上移"${index===0?' disabled':''}>↑</button><button type="button" data-prod-move="${E(g.id)}" data-delta="1" aria-label="下移"${index===groups.length-1?' disabled':''}>↓</button><button type="button" data-prod-sub="${E(g.id)}">添加子分组</button><button type="button" data-prod-edit="group" data-key="${E(g.id)}">改名</button><button type="button" data-prod-delete="group" data-key="${E(g.id)}">删除</button></span>`;
        const kids=g.children.map((c,j)=>{
          const path=`${g.name}${M.SEP}${c.name}`;
          const useKid=M.groupUse(state,path);
          const kidRenaming=edit&&edit.kind==='group'&&edit.key===c.id;
          const kidHead=kidRenaming
            ?`<form class="cs-inline" data-prod-form="group-rename" data-id="${E(c.id)}"><input name="name" value="${E(c.name)}" maxlength="20" aria-label="子分组名称" autocomplete="off"><button type="submit" class="primary">保存</button><button type="button" data-prod-cancel>取消</button></form>`
            :`<strong>${E(c.name)}</strong><span class="cs-use">${useKid?`${useKid} 个产品在用`:'没有产品在用'}</span><span class="cs-row-actions"><button type="button" data-prod-move="${E(c.id)}" data-delta="-1" aria-label="上移"${j===0?' disabled':''}>↑</button><button type="button" data-prod-move="${E(c.id)}" data-delta="1" aria-label="下移"${j===g.children.length-1?' disabled':''}>↓</button><button type="button" data-prod-edit="group" data-key="${E(c.id)}">改名</button><button type="button" data-prod-delete="group" data-key="${E(c.id)}">删除</button></span>`;
          return `<li class="cs-row cs-child">${kidHead}</li>`;
        }).join('');
        const sub=edit&&edit.kind==='groupsub'&&edit.key===g.id
          ?`<form class="cs-add" data-prod-form="group-add" data-parent="${E(g.id)}"><input name="name" placeholder="“${E(g.name)}”下的新子分组" maxlength="20" aria-label="新子分组名称" autocomplete="off"><button type="submit" class="primary">添加</button><button type="button" data-prod-cancel>取消</button></form>`:'';
        return `<li class="cs-group"><div class="cs-row">${head}</div>${sub}${kids?`<ul class="cs-list cs-children">${kids}</ul>`:''}</li>`;
      }).join('');
      return `<form class="cs-add" data-prod-form="group-add"><input name="name" placeholder="新一级分组名称" maxlength="20" aria-label="新分组名称" autocomplete="off"><button type="submit" class="primary">添加</button></form>`
        +(groups.length?`<ul class="cs-list cs-tree">${rows}</ul>`:empty('还没有分组。添加后，新建产品时可以选分组。'));
    }
    // ---- 产品字段 ----
    function fieldsTab(state){
      const config=M.settings(state).fields;
      const rows=M.SECTIONS.map(sec=>{
        const items=M.FIELDS.filter(item=>item[2]===sec).map(([key,label])=>{
          const fixed=M.FIXED.includes(key),c=config[key];
          return `<tr><td>${E(label)}</td><td><label class="check-row"><input type="checkbox" data-prod-field="${key}" data-prop="visible"${c.visible?' checked':''}${fixed?' disabled':''} aria-label="${E(label)}显示"> 显示</label></td><td><label class="check-row"><input type="checkbox" data-prod-field="${key}" data-prop="required"${c.required?' checked':''}${fixed||!c.visible?' disabled':''} aria-label="${E(label)}必填"> 必填</label></td></tr>`;
        }).join('');
        return `<tr class="cs-subhead"><th colspan="3">${E(sec)}</th></tr>${items}`;
      }).join('');
      return `<table class="cs-table cs-dedupe"><thead><tr><th>字段</th><th>显示</th><th>必填</th></tr></thead><tbody>${rows}</tbody></table><p class="cs-hint">勾选后马上生效。产品名称一定显示、一定必填。隐藏的字段不在新建和编辑表单里出现，已填的内容保留。</p>`;
    }
    // ---- 规格管理 ----
    function specsTab(state,view){
      const specs=M.settings(state).specs;
      const edit=view.editing;
      const rows=specs.map(s=>{
        const used=M.specUse(state,s.name);
        const renaming=edit&&edit.kind==='spec'&&edit.key===s.id;
        const head=renaming
          ?`<form class="cs-inline" data-prod-form="spec-rename" data-id="${E(s.id)}"><input name="name" value="${E(s.name)}" maxlength="20" aria-label="规格类型" autocomplete="off"><button type="submit" class="primary">保存</button><button type="button" data-prod-cancel>取消</button></form>`
          :`<strong>${E(s.name)}</strong><span class="cs-use">${used?`${used} 个产品在用`:'没有产品在用'}</span><span class="cs-row-actions"><button type="button" data-prod-edit="spec" data-key="${E(s.id)}">改名</button><button type="button" data-prod-delete="spec" data-key="${E(s.id)}">删除</button></span>`;
        const values=s.values.map(v=>`<span class="cs-chip">${E(v)}<button type="button" data-prod-value-remove="${E(s.id)}" data-value="${E(v)}" aria-label="删除规格值${E(v)}">×</button></span>`).join('');
        return `<li class="cs-group"><div class="cs-row">${head}</div><div class="cs-chips">${values||'<span class="cs-hint">还没有规格值</span>'}</div><form class="cs-add" data-prod-form="value-add" data-id="${E(s.id)}"><input name="value" placeholder="新规格值，如 黑色" maxlength="40" aria-label="新规格值" autocomplete="off"><button type="submit" class="primary">添加规格值</button></form></li>`;
      }).join('');
      return `<form class="cs-add" data-prod-form="spec-add"><input name="name" placeholder="新规格类型，如 颜色、尺码" maxlength="20" aria-label="新规格类型" autocomplete="off"><button type="submit" class="primary">添加</button></form>`
        +(specs.length?`<ul class="cs-list cs-tree">${rows}</ul>`:empty('还没有规格类型。添加后，新建产品时可以给产品选规格。'));
    }
    function pageMarkup(state,view){
      const body=view.tab==='groups'?groupsTab(state,view):view.tab==='fields'?fieldsTab(state):view.tab==='specs'?specsTab(state,view):listTab(state,view);
      const notes={list:'管理你卖的产品。',groups:'最多两级。新建产品时可以选分组；有产品在用的分组不能删除。',fields:'决定新建和编辑产品时有哪些字段、哪些必填。',specs:'规格类型和它的规格值，如 颜色：黑、棕。产品可以选用。'};
      return `<section class="cs-page">${nav(view)}<div class="cs-panel" data-prod-panel="${E(view.tab)}"><h2>${E((TABS.find(t=>t[0]===view.tab)||TABS[0])[1])}</h2><p class="cs-note">${E(notes[view.tab]||notes.list)}</p><div class="cs-error error" id="prod-error" role="alert"></div>${body}</div></section>`;
    }
    // ---- 新建／编辑产品 ----
    function formMarkup(state,values,isNew){
      const fields=M.visibleFields(state);
      const config=M.settings(state).fields;
      const one=([key,label,,type])=>{
        const star=config[key].required?'<span class="ce-required" aria-hidden="true">*</span>':'';
        const v=values[key]??'';
        let input;
        if(type==='area')input=`<textarea name="${key}" rows="3" maxlength="${M.LIMITS.description}"${config[key].required?' required':''}>${E(v)}</textarea>`;
        else if(type==='group'){
          const choices=M.groupChoices(state);
          if(v&&!choices.includes(v))choices.push(v);
          input=`<select name="group"${config[key].required?' required':''}><option value="">未分组</option>${choices.map(g=>option(g,g,v)).join('')}</select>`;
        }else input=`<input name="${key}" value="${E(v)}"${type==='number'?' inputmode="decimal"':''} maxlength="${M.LIMITS.text}" autocomplete="off"${config[key].required?' required':''}>`;
        return `<label class="cs-field"><span>${star}${E(label)}</span>${input}</label>`;
      };
      const blocks=M.SECTIONS.map(sec=>{
        const items=fields.filter(item=>item[2]===sec);
        return items.length?`<fieldset class="cs-field"><legend>${E(sec)}</legend>${items.map(one).join('')}</fieldset>`:'';
      }).join('');
      const specs=M.settings(state).specs;
      const chosen=Array.isArray(values.specs)?values.specs:[];
      const specBlock=specs.length?`<fieldset class="cs-field"><legend>规格</legend>${specs.map(s=>{
        const current=(chosen.find(c=>c.type===s.name)||{}).value||'';
        return `<label class="cs-field"><span>${E(s.name)}</span><select name="spec:${E(s.name)}"><option value="">不选</option>${s.values.map(v=>option(v,v,current)).join('')}</select></label>`;
      }).join('')}</fieldset>`:'';
      return `<form id="product-form" class="drawer-body cs-group-form"><div class="error" id="product-error" role="alert"></div>${blocks}${specBlock}</form>`;
    }
    return {pageMarkup,formMarkup};
  }
  const api={TABS,create};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LaiProductUI=api;
})(typeof window!=='undefined'?window:globalThis);
