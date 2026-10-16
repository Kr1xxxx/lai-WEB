(function(root){
  'use strict';
  // 产品页的页面文字（HTML）：产品列表、分组、同步、字段、规格、布局六个页签，以及新建／编辑表单、产品详情、同步对话框。只生成字符串，不读写数据。
  const TABS=Object.freeze([['list','产品列表'],['groups','产品分组'],['sync','同步'],['fields','产品字段'],['specs','规格管理'],['layouts','布局']]);
  // can(key)：当前账号有没有这个权限（角色预览用）；没传时什么都显示。
  function create(E,M,can=()=>true){
    const option=(value,label,current)=>`<option value="${E(value)}"${String(value)===String(current)?' selected':''}>${E(label)}</option>`;
    const empty=text=>`<div class="cs-empty">${text}</div>`;
    const section=(title,note,content)=>`<section class="cs-section"><h3>${E(title)}</h3>${note?`<p class="cs-hint">${note}</p>`:''}${content}</section>`;
    const day=value=>String(value||'').slice(0,10)||'—';
    const pad=n=>String(n).padStart(2,'0');
    // 同步时间按本机时间显示到分钟。
    const stamp=value=>{const d=new Date(value);return Number.isNaN(d.getTime())?'—':`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;};

    // 产品列表看产品权限；“同步”看 product.sync；分组、字段、规格、布局是产品设置，看 settings.product。
    const tabAllowed=id=>id==='list'||(id==='sync'?can('product.sync'):can('settings.product'));
    function nav(view){
      return `<nav class="cs-nav" aria-label="产品">${TABS.filter(([id])=>tabAllowed(id)).map(([id,label])=>`<button type="button" data-prod-tab="${id}" class="${id===view.tab?'active':''}"${id===view.tab?' aria-current="page"':''}>${E(label)}</button>`).join('')}</nav>`;
    }
    // ---- 产品列表 ----
    function listTab(state,view){
      const rows=M.list(state,{search:view.search,group:view.group});
      const total=M.list(state).length;
      const groups=M.groupChoices(state);
      // 角色看不到的字段：列、搜索提示、分组筛选都不出现。
      const hidden=M.hiddenKeys?M.hiddenKeys(state):new Set();
      const shows=key=>!hidden.has(key);
      const hint=[['name','名称'],['code','编号'],['model','型号'],['remark','备注']].filter(([key])=>shows(key)).map(item=>item[1]).join('、');
      const toolbar=`<div class="opp-toolbar lead-toolbar"><input type="search" id="prod-search" value="${E(view.search||'')}" placeholder="搜索${hint}" aria-label="搜索产品">`
        +(shows('group')?`<select id="prod-group" aria-label="产品分组"><option value="">全部分组</option>${groups.map(g=>option(g,g,view.group)).join('')}</select>`:'')
        +`${can('product.create')?'<button type="button" class="primary" data-prod-action="new">新建产品</button>':''}</div>`;
      if(!total)return toolbar+empty(can('product.create')?'还没有产品。点“新建产品”添加；字段、分组、规格可以先在其他页签里设置。':'还没有产品。');
      if(!rows.length)return toolbar+empty('没有符合条件的产品，换个关键词或分组再看。');
      const body=rows.map(p=>{
        const armed=view.armed===p.id;
        return `<tr><td><button type="button" class="company-link" data-prod-action="view" data-id="${E(p.id)}">${E(p.name)}</button>${p.nameCn&&shows('nameCn')?`<div class="cs-use">${E(p.nameCn)}</div>`:''}</td><td>${E(p.code||'—')}</td>${shows('model')?`<td>${E(p.model||'—')}</td>`:''}${shows('group')?`<td>${E(p.group||'未分组')}</td>`:''}${shows('fob')?`<td>${p.fob?E(p.fob):'—'}</td>`:''}${shows('unit')?`<td>${E(p.unit||'—')}</td>`:''}<td>${E(day(p.updatedAt))}</td>`
          +`<td><span class="cs-row-actions">${can('product.edit')?`<button type="button" data-prod-action="edit" data-id="${E(p.id)}">编辑</button>`:''}${can('product.delete')?`<button type="button" data-prod-action="delete" data-id="${E(p.id)}">${armed?'确定删除':'删除'}</button>`:''}</span></td></tr>`;
      }).join('');
      return toolbar+`<table class="cs-table cs-prod"><thead><tr><th>产品名称</th><th>产品编号</th>${shows('model')?'<th>产品型号</th>':''}${shows('group')?'<th>产品分组</th>':''}${shows('fob')?'<th>离岸价</th>':''}${shows('unit')?'<th>计量单位</th>':''}<th>更新</th><th>操作</th></tr></thead><tbody>${body}</tbody></table>`
        +`<p class="cs-hint">共 ${rows.length} 个产品${rows.length!==total?`（全部 ${total} 个）`:''}。${can('product.delete')?'删除后不能恢复。':''}</p>`;
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
    // ---- 同步 ----
    function syncTab(state,view){
      const tasks=M.syncTasks(state);
      const latest=M.undoableTask(state);
      const toolbar=`<div class="opp-toolbar lead-toolbar"><button type="button" class="primary" data-prod-action="sync-open">从表格同步产品</button></div>`;
      if(!tasks.length)return toolbar+empty('还没有同步过。点“从表格同步产品”，选一个 Excel 或 CSV 文件，先看预览，确认后才会写入。');
      const body=tasks.map(t=>{
        const r=t.result;
        const note=t.status==='已撤销'&&r?`<div class="cs-use">删除新建 ${r.removed} 个，还原更新 ${r.restored} 个${r.kept?`；${r.kept} 个产品同步后又改过，没有撤销`:''}</div>`:'';
        const armed=view.armed===`undo:${t.id}`;
        const action=latest&&latest.id===t.id?`<button type="button" data-prod-action="sync-undo" data-id="${E(t.id)}">${armed?'确定撤销':'撤销'}</button>`:'—';
        return `<tr><td>${E(t.name)}</td><td>${E(stamp(t.at))}</td><td>${E(t.status)}${note}</td><td class="num">${t.total}</td><td class="num">${t.created}</td><td class="num">${t.updated}</td><td class="num">${t.skipped}</td><td>${E(t.source)}</td><td><span class="cs-row-actions">${action}</span></td></tr>`;
      }).join('');
      return toolbar+`<table class="cs-table cs-sync"><thead><tr><th>任务名称</th><th>同步时间</th><th>状态</th><th>产品数</th><th>新建数</th><th>更新数</th><th>跳过数</th><th>来源</th><th>操作</th></tr></thead><tbody>${body}</tbody></table>`
        +`<p class="cs-hint">只能撤销最近一次同步：新建的产品会删除，更新的产品会还原；同步之后又改过的产品不动。</p>`;
    }
    // ---- 布局 ----
    function layoutsTab(state,view){
      const s=M.settings(state);
      const list=M.layoutList(state);
      const edit=view.editing;
      const assign=section('布局分配','决定新建/编辑产品和产品详情各用哪个布局。',`<div class="pl-assign">${M.PLACES.map(([place,label])=>`<label class="cs-field"><span>${E(label)}</span><select data-prod-sel="use" data-place="${place}" aria-label="${E(label)}用的布局">${list.map(l=>option(l.id,l.name,s.layoutUse[place])).join('')}</select></label>`).join('')}</div>`);
      const rows=list.map(l=>{
        const places=M.placesOf(state,l.id);
        const roles=M.rolesUsing?M.rolesUsing(state,l.id):[];
        const roleText=roles.map(r=>`${r.roleName}（${r.places.join('、')}）`).join('；');
        const renaming=edit&&edit.kind==='layout'&&edit.key===l.id;
        const head=renaming
          ?`<form class="cs-inline" data-prod-form="layout-rename" data-id="${E(l.id)}"><input name="name" value="${E(l.name)}" maxlength="20" aria-label="布局名称" autocomplete="off"><button type="submit" class="primary">保存</button><button type="button" data-prod-cancel>取消</button></form>`
          :`<strong>${E(l.name)}</strong>${l.builtin?'<span class="cs-chip">内置</span>':''}<span class="cs-use">${places.length?`用于：${E(places.join('、'))}`:(roles.length?'':'没有地方在用')}${roles.length?`${places.length?'；':''}<span data-prod-layout-roles="${E(l.id)}">角色：${E(roleText)}</span>`:''}</span><span class="cs-row-actions"><button type="button" data-prod-lay="open" data-layout="${E(l.id)}">${l.builtin?'查看':'编辑'}</button><button type="button" data-prod-lay="copy" data-layout="${E(l.id)}">${l.builtin?'复制为新布局':'复制'}</button>${l.builtin?'':`<button type="button" data-prod-edit="layout" data-key="${E(l.id)}">改名</button><button type="button" data-prod-lay="delete" data-layout="${E(l.id)}">删除</button>`}</span>`;
        return `<li class="cs-group"><div class="cs-row${view.layoutEdit===l.id?' pl-open':''}">${head}</div></li>`;
      }).join('');
      const listing=section('布局列表',`最多 ${M.LIMITS.layouts} 个自己建的布局。默认布局不能改，要改先复制。`,`<form class="cs-add" data-prod-form="layout-add"><input name="name" placeholder="新布局名称（从默认布局开始）" maxlength="20" aria-label="新布局名称" autocomplete="off"><button type="submit" class="primary">新建布局</button></form><ul class="cs-list cs-tree">${rows}</ul>`);
      const open=list.find(l=>l.id===view.layoutEdit);
      return assign+listing+(open?layoutEditor(state,open,view):'');
    }
    function layoutEditor(state,layout,view){
      const config=M.settings(state).fields;
      const locked=!!layout.builtin;
      const edit=view.editing;
      const lay=E(layout.id);
      const btn=(kind,attrs,text,label,off)=>`<button type="button" data-prod-lay="${kind}" data-layout="${lay}" ${attrs} aria-label="${E(label)}"${off?' disabled':''}>${text}</button>`;
      const hiddenKeys=M.FIELDS.map(item=>item[0]).filter(key=>!layout.sections.some(sec=>sec.fields.includes(key)));
      const sections=layout.sections.map((sec,i)=>{
        const fields=sec.fields.map((key,j)=>{
          const label=M.labelOf(key);
          const moveTo=layout.sections.length>1?`<select data-prod-sel="move" data-layout="${lay}" data-key="${key}" aria-label="把${E(label)}移到其他信息区"><option value="">移到…</option>${layout.sections.map((other,k)=>k===i?'':option(k,other.name,'')).join('')}</select>`:'';
          const controls=locked?'':`<span class="cs-row-actions">${btn('field-move',`data-key="${key}" data-delta="-1"`,'↑',`${label}上移`,j===0)}${btn('field-move',`data-key="${key}" data-delta="1"`,'↓',`${label}下移`,j===sec.fields.length-1)}${moveTo}${M.FIXED.includes(key)?'':btn('field-hide',`data-key="${key}"`,'隐藏',`隐藏${label}`)}</span>`;
          return `<li class="cs-row pl-field"><span>${E(label)}${config[key].required?' <span class="ce-required" aria-hidden="true">*</span>':''}</span><span class="cs-use">${config[key].visible?'':'（在“产品字段”里已隐藏，不会显示）'}</span>${controls}</li>`;
        }).join('');
        const renaming=!locked&&edit&&edit.kind==='section'&&edit.key===`${layout.id}:${i}`;
        const head=renaming
          ?`<form class="cs-inline" data-prod-form="section-rename" data-layout="${lay}" data-index="${i}"><input name="name" value="${E(sec.name)}" maxlength="20" aria-label="信息区名称" autocomplete="off"><button type="submit" class="primary">保存</button><button type="button" data-prod-cancel>取消</button></form>`
          :`<strong>${E(sec.name)}</strong><span class="cs-use">${sec.fields.length} 个字段</span>${locked?'':`<span class="cs-row-actions">${btn('section-move',`data-index="${i}" data-delta="-1"`,'↑',`${sec.name}上移`,i===0)}${btn('section-move',`data-index="${i}" data-delta="1"`,'↓',`${sec.name}下移`,i===layout.sections.length-1)}<button type="button" data-prod-edit="section" data-key="${E(layout.id)}:${i}">改名</button></span>`}`;
        return `<div class="pl-section" data-prod-section="${i}"><div class="cs-row pl-head">${head}</div><ul class="cs-list">${fields||'<li class="cs-row"><span class="cs-use">这个信息区里没有字段</span></li>'}</ul></div>`;
      }).join('');
      const hidden=!locked&&hiddenKeys.length
        ?`<div class="pl-hidden"><h4>这个布局里隐藏的字段</h4><ul class="cs-list">${hiddenKeys.map(key=>`<li class="cs-row"><span>${E(M.labelOf(key))}</span><span class="cs-use"></span><span class="cs-row-actions"><select data-prod-sel="show" data-layout="${lay}" data-key="${key}" aria-label="把${E(M.labelOf(key))}显示出来"><option value="">显示到…</option>${layout.sections.map((sec,k)=>option(k,sec.name,'')).join('')}</select></span></li>`).join('')}</ul></div>`:'';
      const hint=locked?'默认布局不能改。想调整顺序，先点“复制为新布局”。':'用上移、下移排顺序；“移到…”换信息区；隐藏后，这个布局里就不显示该字段。';
      return `<section class="cs-section pl-editor" data-prod-layout-editor="${lay}"><h3>${locked?'查看':'编辑'}布局：${E(layout.name)}</h3><p class="cs-hint">${hint}</p><div class="pl-sections">${sections}</div>${hidden}</section>`;
    }
    function pageMarkup(state,view){
      const tabs={groups:groupsTab,sync:syncTab,fields:fieldsTab,specs:specsTab,layouts:layoutsTab};
      // 没有权限的页签回到产品列表。
      if(!tabAllowed(view.tab))view={...view,tab:'list'};
      const body=(tabs[view.tab]||listTab)(state,view);
      const notes={list:'管理你卖的产品。',groups:'最多两级。新建产品时可以选分组；有产品在用的分组不能删除。',sync:'用 Excel 或 CSV 文件批量新建、更新产品。先预览，确认后才写入，每次同步都可以撤销。',fields:'决定新建和编辑产品时有哪些字段、哪些必填。',specs:'规格类型和它的规格值，如 颜色：黑、棕。产品可以选用。',layouts:'决定新建/编辑产品和产品详情里，字段按什么顺序、分在哪个信息区。'};
      return `<section class="cs-page">${nav(view)}<div class="cs-panel" data-prod-panel="${E(view.tab)}"><h2>${E((TABS.find(t=>t[0]===view.tab)||TABS[0])[1])}</h2><p class="cs-note">${E(notes[view.tab]||notes.list)}</p><div class="cs-error error" id="prod-error" role="alert"></div>${body}</div></section>`;
    }
    // ---- 新建／编辑产品 ----
    function formMarkup(state,values,isNew){
      const config=M.settings(state).fields;
      // 角色不能改的字段（只读）：输入框不能动；保存时产品模块会把原来的值留着，所以不在表单里也不会丢。
      const locked=M.lockedKeys?M.lockedKeys(state,!isNew):new Set();
      const one=([key,label,,type])=>{
        const star=config[key].required?'<span class="ce-required" aria-hidden="true">*</span>':'';
        const v=values[key]??'';
        const off=locked.has(key)?' disabled title="你的角色不能修改这一项"':'';
        let input;
        if(type==='area')input=`<textarea name="${key}" rows="3" maxlength="${M.LIMITS.description}"${config[key].required?' required':''}${off}>${E(v)}</textarea>`;
        else if(type==='group'){
          const choices=M.groupChoices(state);
          if(v&&!choices.includes(v))choices.push(v);
          input=`<select name="group"${config[key].required?' required':''}${off}><option value="">未分组</option>${choices.map(g=>option(g,g,v)).join('')}</select>`;
        }else input=`<input name="${key}" value="${E(v)}"${type==='number'?' inputmode="decimal"':''} maxlength="${M.LIMITS.text}" autocomplete="off"${config[key].required?' required':''}${off}>`;
        return `<label class="cs-field"><span>${star}${E(label)}${locked.has(key)?' <span class="cs-use">（只读）</span>':''}</span>${input}</label>`;
      };
      const blocks=M.formSections(state).map(sec=>`<fieldset class="cs-field"><legend>${E(sec.name)}</legend>${sec.fields.map(one).join('')}</fieldset>`).join('');
      const specs=M.settings(state).specs;
      const chosen=Array.isArray(values.specs)?values.specs:[];
      const specsHidden=M.hiddenKeys&&M.hiddenKeys(state).has('specs');
      const specOff=locked.has('specs')?' disabled title="你的角色不能修改这一项"':'';
      const specBlock=specs.length&&!specsHidden?`<fieldset class="cs-field"><legend>规格</legend>${specs.map(s=>{
        const current=(chosen.find(c=>c.type===s.name)||{}).value||'';
        return `<label class="cs-field"><span>${E(s.name)}${specOff?' <span class="cs-use">（只读）</span>':''}</span><select name="spec:${E(s.name)}"${specOff}><option value="">不选</option>${s.values.map(v=>option(v,v,current)).join('')}</select></label>`;
      }).join('')}</fieldset>`:'';
      return `<form id="product-form" class="drawer-body cs-group-form"><div class="error" id="product-error" role="alert"></div>${blocks}${specBlock}</form>`;
    }
    // ---- 产品详情（只读，按“产品详情”用的布局排；空字段不显示，产品名称一定显示）----
    function detailMarkup(state,product){
      const sections=M.detailSections(state).map(sec=>{
        const items=sec.fields.filter(([key])=>key==='name'||String(product[key]??'').trim());
        if(!items.length)return '';
        return `<section class="pd-section"><h3>${E(sec.name)}</h3><dl class="pd-list">${items.map(([key,label,,type])=>`<div class="pd-item${type==='area'?' pd-wide':''}"><dt>${E(label)}</dt><dd>${E(product[key]??'')}</dd></div>`).join('')}</dl></section>`;
      }).join('');
      const specs=M.hiddenKeys&&M.hiddenKeys(state).has('specs')?[]:(Array.isArray(product.specs)?product.specs:[]);
      const specBlock=specs.length?`<section class="pd-section"><h3>规格</h3><dl class="pd-list">${specs.map(s=>`<div class="pd-item"><dt>${E(s.type)}</dt><dd>${E(s.value)}</dd></div>`).join('')}</dl></section>`:'';
      return `<div class="drawer-body pd-body" data-prod-detail="${E(product.id)}">${sections}${specBlock}<p class="cs-hint">更新于 ${E(day(product.updatedAt))}</p></div>`;
    }
    // ---- 从表格同步的对话框 ----
    function syncMarkup(state,draft){
      const plan=draft.plan;
      const radios=M.SYNC_MODES.map(([id,label])=>`<label class="check-row"><input type="radio" name="prod-sync-mode" value="${id}"${id===draft.mode?' checked':''}> ${E(label)}</label>`).join('');
      let preview='';
      if(plan){
        const c=plan.counts;
        const shown=plan.rows.slice(0,200);
        const tag={new:'新建',update:'更新',skip:'跳过'};
        const rows=shown.map(r=>`<tr class="ps-${r.status}"><td class="num">${r.line}</td><td>${tag[r.status]}</td><td>${E(r.name||'—')}</td><td>${E(r.code||'—')}</td><td>${r.reason?E(r.reason):''}${r.warnings.length?`<div class="cs-use">${E(r.warnings.join('；'))}</div>`:''}</td></tr>`).join('');
        const notes=[draft.ignored.length?`这些列没有用到：${draft.ignored.join('、')}`:'',draft.hidden.length?`这些字段在“产品字段”里被隐藏，已忽略：${draft.hidden.join('、')}`:''].filter(Boolean);
        preview=`<div class="ps-summary" role="status">共 ${c.total} 行：<strong>新建 ${c.new}</strong>、<strong>更新 ${c.update}</strong>、跳过 ${c.skip}</div>`
          +notes.map(n=>`<p class="cs-hint">${E(n)}</p>`).join('')
          +`<div class="ps-table"><table class="cs-table"><thead><tr><th>行</th><th>处理</th><th>产品名称</th><th>产品编号</th><th>说明</th></tr></thead><tbody>${rows}</tbody></table></div>`
          +(plan.rows.length>shown.length?`<p class="cs-hint">只显示前 ${shown.length} 行，其余按同样规则处理。</p>`:'')
          +`<p class="cs-hint">点“确认同步”才会写入。更新时只改文件里有的列，空格子不会清空原来的内容。</p>`;
      }
      return `<div class="drawer-body prod-sync"><div class="error${draft.error?' visible':''}" id="prod-sync-error" role="alert">${E(draft.error||'')}</div>`
        +`<label class="cs-field"><span>选择文件</span><input type="file" id="prod-sync-file" accept=".xls,.xlsx,.csv" aria-label="选择要同步的表格文件"></label>`
        +(draft.fileName?`<p class="cs-hint">已选：${E(draft.fileName)}</p>`:'')
        +`<fieldset class="cs-field"><legend>匹配方式</legend>${radios}</fieldset>`
        +`<p class="cs-hint">支持 XLS、XLSX、UTF-8 CSV，不超过 5 MB、${M.LIMITS.syncRows} 行。表头用字段名称，比如“产品名称”“产品编号”“离岸价”。 <button type="button" class="text-button" data-prod-action="sync-template">下载模板</button></p>`
        +preview+`</div>`;
    }
    function syncFooter(draft){
      const c=draft.plan&&draft.plan.counts;
      const ready=!!c&&(c.new+c.update)>0;
      return `<button type="button" data-action="close-modal">取消</button><button class="primary" type="button" data-prod-action="sync-commit"${ready?'':' disabled'}>${ready?`确认同步（新建 ${c.new}、更新 ${c.update}）`:'确认同步'}</button>`;
    }
    return {pageMarkup,formMarkup,detailMarkup,syncMarkup,syncFooter};
  }
  const api={TABS,create};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LaiProductUI=api;
})(typeof window!=='undefined'?window:globalThis);
