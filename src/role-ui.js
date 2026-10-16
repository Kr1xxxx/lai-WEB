(function(root){
  'use strict';
  // 角色权限和成员管理页面的标记（企业管理 → 角色权限／成员管理）。只拼 HTML，不改数据；控制在 business-ui.js。
  // create(E, M, deps)：E 是转义函数，M 是 LaiRoleModel；deps.fields＝LaiRoleFields（字段清单），deps.layouts(state)＝产品布局清单。每个函数都返回字符串。
  function create(E,M,deps={}){
    const fieldRows=(state,module)=>{try{const rows=deps.fields&&deps.fields.list?deps.fields.list(state,module):[];return Array.isArray(rows)?rows:[];}catch(error){return [];}};
    const layoutRows=state=>{try{const rows=deps.layouts?deps.layouts(state):[];return Array.isArray(rows)?rows:[];}catch(error){return [];}};
    const MODULE_OF=Object.fromEntries(M.FIELD_MODULES.map(([id,name])=>[name,id]));
    const levelName=id=>(M.FIELD_LEVELS.find(([key])=>key===id)||[])[1]||'';
    const option=(value,title,current)=>`<option value="${E(value)}"${String(value)===String(current)?' selected':''}>${E(title)}</option>`;
    const scopeName=id=>(M.SCOPES.find(([key])=>key===id)||[])[1]||'';
    const SCOPE_HINTS={self:'本人＝只看自己负责的客户、线索、商机和订单。',dept:'本部门＝看自己和本部门（含下级部门）成员负责的客户、线索、商机和订单。',all:'全公司＝都能看到所有人的客户、线索、商机和订单。'};
    const scopeHint=id=>SCOPE_HINTS[id]||SCOPE_HINTS.self;
    const SCOPE_HINT=SCOPE_HINTS.self;
    // 部门下拉框：缩进表示层级。
    const indent=level=>'\u3000'.repeat(level);
    const deptOptions=(state,current,none='未分配')=>option('',none,current)+M.deptTree(state).map(d=>option(d.id,indent(d.level)+d.name,current)).join('');

    // 没有“角色权限”权限时，两个页面都只显示这句话。
    // 和 app.js 的 blockedPage 一个样子。
    const deniedMarkup=()=>`<section class="module-page"><div class="empty role-blocked" role="status"><strong>${E(M.denied('settings.roles'))}</strong><span>可以点右上角头像，切换到别的测试账号。</span></div></section>`;

    // ---------- 角色权限：列表 ----------
    // 成员头像：名字的第一个字，最多 4 个，再多写“共计N位”。
    const AVATARS=5,AVATAR_MAX=4;
    const firstChar=name=>Array.from(String(name||'').trim())[0]||'?';
    function membersCell(state,role){
      const list=M.settings(state).members.filter(m=>m.roleId===role.id);
      const link=`<button type="button" class="company-link" data-role-action="members" data-id="${E(role.id)}">编辑成员</button>`;
      if(!list.length)return `<div class="role-members"><span class="role-members-empty">暂无成员</span>${link}</div>`;
      const faces=list.slice(0,AVATAR_MAX).map((m,i)=>`<span class="role-avatar role-av-${i%AVATARS}" title="${E(m.name)}">${E(firstChar(m.name))}</span>`).join('');
      const more=list.length>AVATAR_MAX?`<span class="role-members-total">共计${list.length}位</span>`:'';
      return `<div class="role-members"><span class="role-avatars">${faces}</span>${more}${link}</div>`;
    }
    function rolesMarkup(state,view={}){
      const s=M.settings(state);
      const rows=s.roles.map(role=>{
        const name=`<b>${E(role.name)}</b>${role.builtin?' <span class="tag">内置</span>':''}`;
        const actions=role.locked
          ?`<button type="button" class="company-link" data-role-action="edit" data-id="${E(role.id)}" title="不可编辑，仅查看">查看</button>`
          :`<button type="button" class="company-link" data-role-action="edit" data-id="${E(role.id)}">编辑</button>`
            +(role.builtin?'':`<button type="button" class="company-link role-danger" data-role-action="delete" data-id="${E(role.id)}">${view.armed===role.id?'确定删除':'删除'}</button>`);
        return `<tr data-role-row="${E(role.id)}"><td>${name}</td><td>${E(scopeName(role.scope))}</td><td class="role-members-cell">${membersCell(state,role)}</td><td class="role-actions">${actions}</td></tr>`;
      }).join('');
      return `<div class="business-scroll"><section class="business-section"><table class="order-table role-table role-list-table"><thead><tr><th>角色</th><th>可见范围</th><th>成员</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table>`
        +`<div class="error" id="role-list-error" role="alert"></div>`
        +`<p class="role-hint">系统管理员什么都能做，不能改。新增角色会先照着“业务”的权限来，再按需要增减。</p></section></div>`;
    }

    // ---------- 角色权限：编辑角色 ----------
    const check=(attrs,label,on,disabled)=>`<label class="role-check"><input type="checkbox" ${attrs}${on?' checked':''}${disabled?' disabled':''}> <span>${E(label)}</span></label>`;
    // 这个模块里被限制（只读或隐藏）的字段个数，只数清单里还有的字段。
    function limitCount(state,module,fields){
      const rules=(fields&&fields[module])||{};
      return fieldRows(state,module).filter(row=>rules[row.key]==='read'||rules[row.key]==='hidden').length;
    }
    const limitText=count=>count?`已限制 ${count} 个`:'';
    const layoutSet=layouts=>!!(layouts&&layouts.product&&(layouts.product.form||layouts.product.detail));
    function groupLinks(state,group,fields,layouts){
      const module=MODULE_OF[group];
      if(!module)return '';
      const count=limitCount(state,module,fields);
      let html=`<button type="button" class="company-link role-field-link" data-role-action="fields" data-module="${E(module)}">设置字段权限</button><span class="role-limit-count" data-role-limit="${E(module)}"${count?'':' hidden'}>${E(limitText(count))}</span>`;
      if(module==='product')html+=`<button type="button" class="company-link role-field-link" data-role-action="layouts">设置布局权限</button><span class="role-limit-count" data-role-layout-tag${layoutSet(layouts)?'':' hidden'}>已指定布局</span>`;
      return html;
    }
    function editMarkup(state,roleId,draft={}){
      const role=M.settings(state).roles.find(r=>r.id===roleId);
      if(!role)return `<div class="business-scroll"><section class="business-section"><p class="role-hint">没有找到这个角色，可能已被删除。</p><button type="button" data-role-action="back">返回角色列表</button></section></div>`;
      const locked=!!role.locked;
      const fields=draft.fields||role.fields||{},layouts=draft.layouts||role.layouts||{};
      const groups=M.GROUPS.map(([group,items])=>{
        const allOn=items.every(([key])=>locked||role.perms[key]===true);
        const boxes=items.map(([key,label])=>check(`name="perm" value="${E(key)}" data-role-perm`,label,locked||role.perms[key]===true,locked)).join('');
        return `<fieldset class="role-group" data-role-group><legend><span class="role-group-name">${E(group)}</span>${check('data-role-all','全选',allOn,locked)}${groupLinks(state,group,fields,layouts)}</legend><div class="role-perms">${boxes}</div></fieldset>`;
      }).join('');
      const scope=`<select name="scope" id="role-scope"${locked?' disabled':''}>${M.SCOPES.map(([id,name])=>option(id,name,role.scope)).join('')}</select>`;
      const note=locked?'<p class="role-lock-note">系统管理员不可编辑，仅查看。</p>':'';
      const buttons=locked
        ?'<button type="button" data-role-action="back">返回角色列表</button>'
        :'<button type="button" data-role-action="back">取消</button><button type="submit" class="primary">保存</button>';
      return `<div class="business-scroll"><form id="role-edit-form" class="business-section role-edit" data-role-form="edit" data-id="${E(role.id)}" novalidate>${note}`
        +`<div class="role-basic"><label class="field">角色名称<input name="name" value="${E(role.name)}" maxlength="${M.LIMITS.name}" autocomplete="off"${locked?' disabled':''}></label>`
        +`<label class="field">角色可见范围${scope}<small class="role-hint" id="role-scope-hint">${E(scopeHint(role.scope))}</small></label></div>`
        +`<div class="section-head"><h3>权限配置</h3></div><div class="role-groups">${groups}</div>`
        +`<div class="error" id="role-error" role="alert"></div><div class="role-buttons">${buttons}</div></form></div>`;
    }

    // ---------- 字段权限、布局权限的窗口 ----------
    // levels：这个模块里已有的限制 {字段名:'read'|'hidden'}，没写的字段都是可编辑。
    function fieldsMarkup(state,module,levels={},{readOnly=false}={}){
      const rows=fieldRows(state,module);
      const moduleName=(M.FIELD_MODULES.find(([id])=>id===module)||[])[1]||'';
      if(!rows.length)return `<form id="role-fields-form" class="drawer-body role-fields" data-role-form="fields" data-module="${E(module)}" novalidate><p class="role-hint">这个模块还没有可以单独设置的字段。</p></form>`;
      let lastGroup=null;
      const body=rows.map((row,i)=>{
        const level=readOnly?'edit':(levels[row.key]==='read'||levels[row.key]==='hidden'?levels[row.key]:'edit');
        const group=row.group&&row.group!==lastGroup?`<div class="role-field-group">${E(row.group)}</div>`:'';
        if(row.group)lastGroup=row.group;
        const seg=M.FIELD_LEVELS.map(([id,name])=>`<label class="role-seg-item"><input type="radio" name="lvl-${i}" value="${E(id)}"${level===id?' checked':''}${readOnly?' disabled':''}><span>${E(name)}</span></label>`).join('');
        return `${group}<div class="role-field-row" data-field-row data-field-key="${E(row.key)}"><span class="role-field-name">${E(row.label)}</span><span class="role-seg" role="radiogroup" aria-label="${E(row.label)}">${seg}</span></div>`;
      }).join('');
      const quick=readOnly?'':'<div class="role-fields-quick"><button type="button" data-role-action="fields-all" data-level="edit">全部可编辑</button><button type="button" data-role-action="fields-all" data-level="read">全部只读</button></div>';
      const note=readOnly?'系统管理员不可编辑，所有字段都可以编辑。':`${levelName('edit')}＝能看能改；${levelName('read')}＝能看不能改；${levelName('hidden')}＝看不到。`;
      return `<form id="role-fields-form" class="drawer-body role-fields" data-role-form="fields" data-module="${E(module)}" aria-label="${E(moduleName)}字段权限" novalidate><p class="role-hint">${E(note)}</p>${quick}<div class="role-field-list">${body}</div></form>`;
    }
    // 产品布局：''＝跟着“产品 → 布局”里的默认分配。
    function layoutMarkup(state,product={},{readOnly=false}={}){
      const list=layoutRows(state).filter(l=>l&&l.id);
      const choose=(name,title,current)=>`<label class="field">${E(title)}<select name="${E(name)}"${readOnly?' disabled':''}>${option('','跟随默认分配',readOnly?'':current)}${list.map(l=>option(l.id,l.name||l.id,readOnly?'':current)).join('')}</select></label>`;
      const note=readOnly?'系统管理员不可编辑，一律跟随默认分配。':'选了布局，这个角色的成员新建、编辑和查看产品时就用它；不选就跟着“产品 → 布局”里的默认分配。';
      return `<form id="role-layout-form" class="drawer-body role-layouts" data-role-form="layouts" novalidate><p class="role-hint">${E(note)}</p>`
        +choose('form','新建/编辑产品用的布局',product.form||'')+choose('detail','产品详情用的布局',product.detail||'')+`<div class="error" id="role-layout-error" role="alert"></div></form>`;
    }

    // ---------- 新增角色 ----------
    function addRoleMarkup(state){
      const roles=M.settings(state).roles.filter(r=>r.id!==M.ADMIN);
      return `<form id="role-add-form" class="drawer-body" data-role-form="add" novalidate><label class="field">角色名称<input name="name" maxlength="${M.LIMITS.name}" autocomplete="off" required></label>`
        +`<label class="field">复制权限自<select name="copyFrom">${roles.map(r=>option(r.id,r.name,M.SALES)).join('')}</select></label>`
        +`<p class="role-hint">新角色先带上所选角色的权限和可见范围，创建后可以再改。</p><div class="error" id="role-add-error" role="alert"></div></form>`;
    }

    // ---------- 成员管理（左边组织架构，右边成员表） ----------
    const NONE='__none';
    // 一个部门（含下级部门）里的成员；''＝我的企业（所有人），NONE＝未分配。
    function deptMembers(state,node){
      const s=M.settings(state);
      if(!node)return s.members;
      if(node===NONE)return s.members.filter(m=>!m.deptId);
      const ids=M.deptAndBelow(state,node);
      return s.members.filter(m=>m.deptId&&ids.has(m.deptId));
    }
    function treeMarkup(state,selected){
      const node=(id,level,name)=>`<button type="button" class="role-dept-node${selected===id?' is-selected':''}" data-role-action="dept-pick" data-id="${E(id)}" data-dept-node="${E(id)}" style="--lv:${level}" aria-pressed="${selected===id}"><span class="role-dept-name">${E(name)}</span><span class="role-dept-count">${deptMembers(state,id).length}</span></button>`;
      return `<aside class="role-org" aria-label="组织架构"><div class="role-org-head"><b>组织架构</b><button type="button" class="company-link" data-role-action="dept-add">新建部门</button></div>`
        +`<div class="role-dept-tree">${node('',0,'我的企业')}${M.deptTree(state).map(d=>node(d.id,d.level+1,d.name)).join('')}${node(NONE,1,'未分配')}</div></aside>`;
    }
    function membersMarkup(state,view={}){
      const s=M.settings(state);
      const filter=s.roles.find(r=>r.id===view.filter);
      const tree=M.deptTree(state);
      const dept=view.dept===NONE||tree.some(d=>d.id===view.dept)?view.dept:'';
      let list=deptMembers(state,dept);
      if(filter)list=list.filter(m=>m.roleId===filter.id);
      const rows=list.map(member=>{
        const current=member.id===s.current;
        const select=`<select data-role-member-role data-id="${E(member.id)}" aria-label="${E(member.name)}的角色">${s.roles.map(r=>option(r.id,r.name,member.roleId)).join('')}</select>`;
        const deptSelect=`<select data-role-member-dept data-id="${E(member.id)}" aria-label="${E(member.name)}的部门">${deptOptions(state,member.deptId)}</select>`;
        const actions=(current?'':`<button type="button" class="company-link" data-role-action="switch" data-id="${E(member.id)}">切换到此账号</button>`)
          +`<button type="button" class="company-link" data-role-action="rename" data-id="${E(member.id)}">改名</button>`
          +(current?'':`<button type="button" class="company-link role-danger" data-role-action="member-delete" data-id="${E(member.id)}">${view.armed===member.id?'确定删除':'删除'}</button>`);
        return `<tr data-member-row="${E(member.id)}"><td><b>${E(member.name)}</b></td><td>${select}</td><td>${deptSelect}</td><td>${current?'<span class="tag green">当前使用</span>':''}</td><td class="role-actions">${actions}</td></tr>`;
      }).join('');
      const bar=filter?`<div class="role-filter">只看角色：<b>${E(filter.name)}</b><button type="button" class="company-link" data-role-action="members-all">查看全部成员</button></div>`:'';
      const picked=tree.find(d=>d.id===dept);
      const deptBar=picked?`<div class="role-dept-bar">当前部门：<b>${E(picked.name)}</b><button type="button" class="company-link" data-role-action="dept-rename" data-id="${E(picked.id)}">改名</button><button type="button" class="company-link role-danger" data-role-action="dept-delete" data-id="${E(picked.id)}">${view.armedDept===picked.id?'确定删除':'删除'}</button></div>`:'';
      const empty=filter?'这个角色还没有成员':(dept?'这个部门还没有成员':'还没有成员');
      return `<div class="business-scroll"><section class="business-section"><p class="role-note">来财还没有登录，这里的成员是本机测试账号，用来预览不同角色看到什么，不是安全措施。</p>${bar}`
        +`<div class="role-org-layout">${treeMarkup(state,dept)}<div class="role-org-main">${deptBar}`
        +`<table class="order-table role-table"><thead><tr><th>名字</th><th>角色</th><th>部门</th><th>状态</th><th>操作</th></tr></thead><tbody>${rows||`<tr><td colspan="5">${E(empty)}</td></tr>`}</tbody></table></div></div>`
        +`<div class="error" id="member-list-error" role="alert"></div></section></div>`;
    }
    function addMemberMarkup(state,view={}){
      const roles=M.settings(state).roles;
      const dept=M.deptTree(state).some(d=>d.id===view.deptId)?view.deptId:'';
      return `<form id="member-add-form" class="drawer-body" data-role-form="member-add" novalidate><label class="field">名字<input name="name" maxlength="${M.LIMITS.name}" autocomplete="off" required></label>`
        +`<label class="field">角色<select name="roleId">${roles.map(r=>option(r.id,r.name,M.SALES)).join('')}</select></label>`
        +`<label class="field">部门<select name="deptId">${deptOptions(state,dept)}</select></label>`
        +`<div class="error" id="member-add-error" role="alert"></div></form>`;
    }
    function renameMarkup(member){
      return `<form id="member-rename-form" class="drawer-body" data-role-form="member-rename" data-id="${E(member.id)}" novalidate><label class="field">名字<input name="name" value="${E(member.name)}" maxlength="${M.LIMITS.name}" autocomplete="off" required></label>`
        +`<p class="cs-hint" id="member-rename-warn">会把这个人负责的客户、线索、订单、商机一起改名。</p>`
        +`<div class="error" id="member-rename-error" role="alert"></div></form>`;
    }
    function deptAddMarkup(state,parentId=''){
      const parent=M.deptTree(state).some(d=>d.id===parentId)?parentId:'';
      return `<form id="dept-add-form" class="drawer-body" data-role-form="dept-add" novalidate><label class="field">部门名称<input name="name" maxlength="${M.LIMITS.name}" autocomplete="off" required></label>`
        +`<label class="field">上级部门<select name="parentId">${deptOptions(state,parent,'我的企业')}</select></label><div class="error" id="dept-add-error" role="alert"></div></form>`;
    }
    function deptRenameMarkup(dept){
      return `<form id="dept-rename-form" class="drawer-body" data-role-form="dept-rename" data-id="${E(dept.id)}" novalidate><label class="field">部门名称<input name="name" value="${E(dept.name)}" maxlength="${M.LIMITS.name}" autocomplete="off" required></label>`
        +`<div class="error" id="dept-rename-error" role="alert"></div></form>`;
    }
    return {deniedMarkup,rolesMarkup,editMarkup,fieldsMarkup,layoutMarkup,addRoleMarkup,membersMarkup,addMemberMarkup,renameMarkup,deptAddMarkup,deptRenameMarkup,
      scopeName,scopeHint,limitCount,limitText,layoutSet,deptMembers,SCOPE_HINT,NONE};
  }
  const api={create};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LaiRoleUI=api;
})(typeof window!=='undefined'?window:globalThis);
