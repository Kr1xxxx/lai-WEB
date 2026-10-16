(function(root){
  'use strict';
  // 角色权限和成员管理页面的标记（企业管理 → 角色权限／成员管理）。只拼 HTML，不改数据；控制在 business-ui.js。
  // create(E, M)：E 是转义函数，M 是 LaiRoleModel。每个函数都返回字符串。
  function create(E,M){
    const option=(value,title,current)=>`<option value="${E(value)}"${String(value)===String(current)?' selected':''}>${E(title)}</option>`;
    const scopeName=id=>(M.SCOPES.find(([key])=>key===id)||[])[1]||'';
    const SCOPE_HINT='本人＝只看自己负责的客户、线索、商机和订单；全公司＝能看到所有人的。';

    // 没有“角色权限”权限时，两个页面都只显示这句话。
    const deniedMarkup=()=>`<div class="business-scroll"><section class="business-section role-denied" role="status"><p>${E(M.denied('settings.roles'))}</p></section></div>`;

    // ---------- 角色权限：列表 ----------
    function rolesMarkup(state,view={}){
      const s=M.settings(state);
      const rows=s.roles.map(role=>{
        const count=M.memberCount(state,role.id);
        const name=`<b>${E(role.name)}</b>${role.builtin?' <span class="tag">内置</span>':''}`;
        const actions=role.locked
          ?`<button type="button" class="company-link" data-role-action="edit" data-id="${E(role.id)}" title="不可编辑，仅查看">查看</button>`
          :`<button type="button" class="company-link" data-role-action="edit" data-id="${E(role.id)}">编辑</button>`
            +`<button type="button" class="company-link" data-role-action="members" data-id="${E(role.id)}">成员</button>`
            +(role.builtin?'':`<button type="button" class="company-link role-danger" data-role-action="delete" data-id="${E(role.id)}">${view.armed===role.id?'确定删除':'删除'}</button>`);
        return `<tr data-role-row="${E(role.id)}"><td>${name}</td><td>${E(scopeName(role.scope))}</td><td class="num">${count}</td><td class="role-actions">${actions}</td></tr>`;
      }).join('');
      return `<div class="business-scroll"><section class="business-section"><table class="order-table role-table"><thead><tr><th>角色名称</th><th>可见范围</th><th class="num">成员数</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table>`
        +`<div class="error" id="role-list-error" role="alert"></div>`
        +`<p class="role-hint">系统管理员什么都能做，不能改。新增角色会先照着“业务”的权限来，再按需要增减。</p></section></div>`;
    }

    // ---------- 角色权限：编辑角色 ----------
    const check=(attrs,label,on,disabled)=>`<label class="role-check"><input type="checkbox" ${attrs}${on?' checked':''}${disabled?' disabled':''}> <span>${E(label)}</span></label>`;
    function editMarkup(state,roleId){
      const role=M.settings(state).roles.find(r=>r.id===roleId);
      if(!role)return `<div class="business-scroll"><section class="business-section"><p class="role-hint">没有找到这个角色，可能已被删除。</p><button type="button" data-role-action="back">返回角色列表</button></section></div>`;
      const locked=!!role.locked;
      const groups=M.GROUPS.map(([group,items])=>{
        const allOn=items.every(([key])=>locked||role.perms[key]===true);
        const boxes=items.map(([key,label])=>check(`name="perm" value="${E(key)}" data-role-perm`,label,locked||role.perms[key]===true,locked)).join('');
        return `<fieldset class="role-group" data-role-group><legend><span class="role-group-name">${E(group)}</span>${check('data-role-all','全选',allOn,locked)}</legend><div class="role-perms">${boxes}</div></fieldset>`;
      }).join('');
      const scope=`<select name="scope" id="role-scope"${locked?' disabled':''}>${M.SCOPES.map(([id,name])=>option(id,name,role.scope)).join('')}</select>`;
      const note=locked?'<p class="role-lock-note">系统管理员不可编辑，仅查看。</p>':'';
      const buttons=locked
        ?'<button type="button" data-role-action="back">返回角色列表</button>'
        :'<button type="button" data-role-action="back">取消</button><button type="submit" class="primary">保存</button>';
      return `<div class="business-scroll"><form id="role-edit-form" class="business-section role-edit" data-role-form="edit" data-id="${E(role.id)}" novalidate>${note}`
        +`<div class="role-basic"><label class="field">角色名称<input name="name" value="${E(role.name)}" maxlength="${M.LIMITS.name}" autocomplete="off"${locked?' disabled':''}></label>`
        +`<label class="field">角色可见范围${scope}<small class="role-hint">${E(SCOPE_HINT)}</small></label></div>`
        +`<div class="section-head"><h3>权限配置</h3></div><div class="role-groups">${groups}</div>`
        +`<div class="error" id="role-error" role="alert"></div><div class="role-buttons">${buttons}</div></form></div>`;
    }

    // ---------- 新增角色 ----------
    function addRoleMarkup(state){
      const roles=M.settings(state).roles.filter(r=>r.id!==M.ADMIN);
      return `<form id="role-add-form" class="drawer-body" data-role-form="add" novalidate><label class="field">角色名称<input name="name" maxlength="${M.LIMITS.name}" autocomplete="off" required></label>`
        +`<label class="field">复制权限自<select name="copyFrom">${roles.map(r=>option(r.id,r.name,M.SALES)).join('')}</select></label>`
        +`<p class="role-hint">新角色先带上所选角色的权限和可见范围，创建后可以再改。</p><div class="error" id="role-add-error" role="alert"></div></form>`;
    }

    // ---------- 成员管理 ----------
    function membersMarkup(state,view={}){
      const s=M.settings(state);
      const filter=s.roles.find(r=>r.id===view.filter);
      const list=filter?s.members.filter(m=>m.roleId===filter.id):s.members;
      const rows=list.map(member=>{
        const current=member.id===s.current;
        const select=`<select data-role-member-role data-id="${E(member.id)}" aria-label="${E(member.name)}的角色">${s.roles.map(r=>option(r.id,r.name,member.roleId)).join('')}</select>`;
        const actions=(current?'':`<button type="button" class="company-link" data-role-action="switch" data-id="${E(member.id)}">切换到此账号</button>`)
          +`<button type="button" class="company-link" data-role-action="rename" data-id="${E(member.id)}">改名</button>`
          +(current?'':`<button type="button" class="company-link role-danger" data-role-action="member-delete" data-id="${E(member.id)}">${view.armed===member.id?'确定删除':'删除'}</button>`);
        return `<tr data-member-row="${E(member.id)}"><td><b>${E(member.name)}</b></td><td>${select}</td><td>${current?'<span class="tag green">当前使用</span>':''}</td><td class="role-actions">${actions}</td></tr>`;
      }).join('');
      const bar=filter?`<div class="role-filter">只看角色：<b>${E(filter.name)}</b><button type="button" class="company-link" data-role-action="members-all">查看全部成员</button></div>`:'';
      return `<div class="business-scroll"><section class="business-section"><p class="role-note">来财还没有登录，这里的成员是本机测试账号，用来预览不同角色看到什么，不是安全措施。</p>${bar}`
        +`<table class="order-table role-table"><thead><tr><th>名字</th><th>角色</th><th>状态</th><th>操作</th></tr></thead><tbody>${rows||'<tr><td colspan="4">这个角色还没有成员</td></tr>'}</tbody></table>`
        +`<div class="error" id="member-list-error" role="alert"></div></section></div>`;
    }
    function addMemberMarkup(state){
      const roles=M.settings(state).roles;
      return `<form id="member-add-form" class="drawer-body" data-role-form="member-add" novalidate><label class="field">名字<input name="name" maxlength="${M.LIMITS.name}" autocomplete="off" required></label>`
        +`<label class="field">角色<select name="roleId">${roles.map(r=>option(r.id,r.name,M.SALES)).join('')}</select></label>`
        +`<div class="error" id="member-add-error" role="alert"></div></form>`;
    }
    function renameMarkup(member){
      return `<form id="member-rename-form" class="drawer-body" data-role-form="member-rename" data-id="${E(member.id)}" novalidate><label class="field">名字<input name="name" value="${E(member.name)}" maxlength="${M.LIMITS.name}" autocomplete="off" required></label>`
        +`<div class="error" id="member-rename-error" role="alert"></div></form>`;
    }
    return {deniedMarkup,rolesMarkup,editMarkup,addRoleMarkup,membersMarkup,addMemberMarkup,renameMarkup,scopeName,SCOPE_HINT};
  }
  const api={create};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LaiRoleUI=api;
})(typeof window!=='undefined'?window:globalThis);
