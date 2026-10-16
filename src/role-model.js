(function(root){
  'use strict';
  // 角色权限和测试账号。纯函数：输入 state，返回新的 state，不碰界面，也不自己保存。
  // 设置存在 state.laiSettings.roles：{roles:[{id,name,scope,perms:{key:true}}], members:[{id,name,roleId}], current:memberId}。
  // 来财现在没有服务器和登录，账号只是“测试账号”：在本机切换，用来预览不同角色看到什么、能做什么。不是安全措施。
  const trim=value=>String(value??'').trim();
  const norm=value=>trim(value).toLowerCase();
  const LIMITS=Object.freeze({roles:20,members:100,name:20});
  // 可见范围：本人＝只看自己做跟进人/负责人的客户、线索、商机、订单；全公司＝都能看。
  const SCOPES=Object.freeze([['self','本人'],['all','全公司']].map(item=>Object.freeze(item)));
  // 权限清单：[模块, [[key, 名称], ...]]。只列来财真有的功能。
  const GROUPS=Object.freeze([
    ['线索',[['lead.view','查看'],['lead.create','创建'],['lead.edit','编辑'],['lead.delete','删除'],['lead.reassign','重新分配'],['lead.convert','转为客户']]],
    ['商机',[['opp.view','查看'],['opp.create','创建'],['opp.edit','编辑'],['opp.delete','删除'],['opp.transfer','转移负责人'],['opp.archive','商机归档'],['opp.fileDownload','下载文件'],['opp.fileDelete','删除文件']]],
    ['客户',[['customer.view','查看'],['customer.create','创建'],['customer.edit','编辑'],['customer.reassign','重新分配'],['customer.removeOwner','移除跟进人'],['customer.unfollow','取消关注'],['customer.toPool','移入公海'],['customer.merge','合并客户'],['customer.batchFollow','批量写跟进'],['customer.duplicates','客户查重页面-查看'],['customer.trash','移入回收站'],['customer.import','导入客户']]],
    ['公海客户',[['pool.view','查看'],['pool.claim','移入私海（领取）'],['pool.assign','分配客户'],['pool.edit','编辑'],['pool.delete','删除']]],
    ['订单',[['order.view','查看'],['order.create','创建'],['order.edit','编辑'],['order.delete','删除']]],
    ['产品',[['product.view','查看'],['product.create','创建'],['product.edit','编辑'],['product.delete','删除'],['product.sync','同步']]],
    ['单据',[['doc.create','生成并保存单据'],['doc.void','作废单据']]],
    ['目标与团队数据',[['team.view','查看团队数据'],['team.wall','查看团队墙'],['team.targets','目标管理']]],
    ['邮件',[['mail.view','查看'],['mail.send','写信和回复']]],
    ['设置管理',[['settings.customer','客户设置'],['settings.dedupe','判重设置'],['settings.source','来源设置'],['settings.opportunity','商机设置'],['settings.product','产品设置'],['settings.docTemplate','单据模版设置'],['settings.general','设置（默认录入、数据备份）'],['settings.roles','角色权限和成员管理']]],
  ].map(([name,items])=>Object.freeze([name,Object.freeze(items.map(item=>Object.freeze(item)))])));
  const KEYS=Object.freeze(GROUPS.flatMap(([,items])=>items.map(([key])=>key)));
  const labelOf=key=>{for(const [group,items] of GROUPS){const hit=items.find(item=>item[0]===key);if(hit)return `${group}·${hit[1]}`;}return key;};
  const ADMIN='admin',SALES='sales',TEST_SALES='测试业务';
  const all=()=>Object.fromEntries(KEYS.map(key=>[key,true]));
  // “业务”默认权限：照老板小满“普通用户”角色的勾选（字段与权限详细附录），只取来财有的项目。
  const SALES_DEFAULT=Object.freeze(['lead.view','lead.create','lead.edit','lead.reassign','lead.convert',
    'opp.view','opp.create','opp.edit','opp.transfer','opp.archive','opp.fileDownload','opp.fileDelete',
    'customer.view','customer.create','customer.edit','customer.unfollow','customer.toPool','customer.merge','customer.batchFollow','customer.duplicates',
    'pool.view','pool.claim','pool.edit',
    'order.view','order.create','order.edit',
    'product.view',
    'doc.create',
    'team.wall',
    'mail.view','mail.send',
    'settings.source']);
  const BUILTIN=Object.freeze({
    [ADMIN]:Object.freeze({id:ADMIN,name:'系统管理员',scope:'all',builtin:true,locked:true}),
    [SALES]:Object.freeze({id:SALES,name:'业务',scope:'self',builtin:true,locked:false}),
  });
  let counter=0;
  const newId=prefix=>`${prefix}${Date.now().toString(36)}${(counter++).toString(36)}`;
  function cleanName(value,label){
    const name=trim(value).replace(/\s+/g,' ');
    if(!name)throw new Error(`请填写${label}`);
    if(name.length>LIMITS.name)throw new Error(`${label}最长 ${LIMITS.name} 个字`);
    return name;
  }
  const cleanPerms=raw=>Object.fromEntries(KEYS.filter(key=>raw&&raw[key]===true).map(key=>[key,true]));
  const cleanScope=value=>SCOPES.some(([id])=>id===value)?value:'self';

  // ---------- 读取 ----------
  // 没存过时：系统管理员 + 业务两个角色；成员取“默认跟进人”做管理员，其他出现过的跟进人做业务。
  function ownersOf(state){
    const seen=new Map();
    const add=value=>{const name=trim(value);if(name&&!seen.has(norm(name)))seen.set(norm(name),name);};
    add(state?.laiSettings?.defaultOwner);add(state?.orderSettings?.defaultOwner);
    for(const profile of Object.values(state?.customerProfiles||{}))add(profile?.owner);
    for(const order of Array.isArray(state?.orders)?state.orders:[])add(order?.owner);
    return [...seen.values()];
  }
  function readSettings(raw,state){
    const stored=raw&&typeof raw==='object'?raw:null;
    const roles=[{...BUILTIN[ADMIN],perms:all()}];
    const storedRoles=Array.isArray(stored?.roles)?stored.roles:[];
    const sales=storedRoles.find(r=>r&&r.id===SALES);
    roles.push({...BUILTIN[SALES],name:trim(sales?.name)||BUILTIN[SALES].name,scope:cleanScope(sales?.scope??'self'),perms:sales?cleanPerms(sales.perms):Object.fromEntries(SALES_DEFAULT.map(key=>[key,true]))});
    const names=new Set(roles.map(r=>norm(r.name)));
    for(const r of storedRoles){
      if(!r||r.id===ADMIN||r.id===SALES||roles.length>=LIMITS.roles)continue;
      const name=trim(r.name);
      if(!name||names.has(norm(name)))continue;
      names.add(norm(name));
      roles.push({id:trim(r.id)||newId('r'),name,scope:cleanScope(r.scope),builtin:false,locked:false,perms:cleanPerms(r.perms)});
    }
    let members=[];
    if(stored&&Array.isArray(stored.members)){
      const seen=new Set();
      for(const m of stored.members){
        const name=trim(m&&m.name);
        if(!name||seen.has(norm(name))||members.length>=LIMITS.members)continue;
        seen.add(norm(name));
        members.push({id:trim(m.id)||newId('m'),name,roleId:roles.some(r=>r.id===m.roleId)?m.roleId:SALES});
      }
    }
    if(!members.length){
      const owners=ownersOf(state);
      members=(owners.length?owners:['管理员']).map((name,i)=>({id:`m-${i}`,name,roleId:i===0?ADMIN:SALES}));
      // 第一次打开时备一个“业务”测试账号，切过去就能看业务看到什么。
      if(!members.some(m=>m.roleId===SALES)&&!members.some(m=>norm(m.name)===norm(TEST_SALES)))members.push({id:'m-test-sales',name:TEST_SALES,roleId:SALES});
    }
    // 至少要有一个系统管理员，不然没人能改权限。
    if(!members.some(m=>m.roleId===ADMIN))members[0]={...members[0],roleId:ADMIN};
    const current=members.some(m=>m.id===stored?.current)?stored.current:members[0].id;
    return {roles,members,current};
  }
  const cache=new WeakMap();
  function settings(state){
    const stored=state&&state.laiSettings&&state.laiSettings.roles;
    const key=stored&&typeof stored==='object'?stored:state&&typeof state==='object'?state:{};
    let hit=cache.get(key);
    if(!hit){hit=readSettings(stored,state);cache.set(key,hit);}
    return hit;
  }
  // 只存可改的部分；系统管理员的权限固定，不存。
  function put(state,next){
    const roles=next.roles.filter(r=>r.id!==ADMIN).map(r=>({id:r.id,name:r.name,scope:r.scope,perms:cleanPerms(r.perms)}));
    const members=next.members.map(m=>({id:m.id,name:m.name,roleId:m.roleId}));
    return {...state,laiSettings:{...(state.laiSettings||{}),roles:{roles,members,current:next.current},defaultOwner:(next.members.find(m=>m.id===next.current)||{}).name||state.laiSettings?.defaultOwner}};
  }
  const copy=state=>{const s=settings(state);return {roles:s.roles.map(r=>({...r,perms:{...r.perms}})),members:s.members.map(m=>({...m})),current:s.current};};

  // ---------- 当前账号和权限判断 ----------
  function currentMember(state){const s=settings(state);return s.members.find(m=>m.id===s.current)||s.members[0];}
  function roleOf(state,member=currentMember(state)){const s=settings(state);return s.roles.find(r=>r.id===member?.roleId)||s.roles.find(r=>r.id===SALES);}
  // can(state,'customer.edit')：当前账号有没有这个权限。系统管理员什么都能做。
  function can(state,key){
    const role=roleOf(state);
    if(!role)return false;
    if(role.id===ADMIN)return true;
    return role.perms[key]===true;
  }
  const isAdmin=state=>roleOf(state)?.id===ADMIN;
  const scopeOf=state=>roleOf(state)?.scope||'self';
  const meName=state=>currentMember(state)?.name||'';
  // 可见范围：全公司都能看；本人只看跟进人/负责人是自己的（不分大小写）。没有跟进人的也看不到，公海客户另由 pool.view 决定。
  function canSee(state,owner){
    if(scopeOf(state)==='all')return true;
    return !!trim(owner)&&norm(owner)===norm(meName(state));
  }
  // 权限不够时给界面用的统一提示。
  const denied=key=>`你的角色没有“${labelOf(key)}”权限，请找系统管理员开通`;
  function assert(state,key){if(!can(state,key))throw new Error(denied(key));}

  // ---------- 修改：角色 ----------
  function requireRole(next,id){const role=next.roles.find(r=>r.id===id);if(!role)throw new Error('没有找到这个角色');return role;}
  function guard(state){if(!can(state,'settings.roles'))throw new Error(denied('settings.roles'));}
  function addRole(state,{name,copyFrom=SALES}={}){
    guard(state);
    const next=copy(state);
    const value=cleanName(name,'角色名称');
    if(next.roles.some(r=>norm(r.name)===norm(value)))throw new Error('已有同名角色');
    if(next.roles.length>=LIMITS.roles)throw new Error(`角色最多 ${LIMITS.roles} 个`);
    const base=next.roles.find(r=>r.id===copyFrom&&r.id!==ADMIN)||next.roles.find(r=>r.id===SALES);
    next.roles.push({id:newId('r'),name:value,scope:base.scope,builtin:false,locked:false,perms:{...base.perms}});
    return put(state,next);
  }
  function updateRole(state,id,{name,scope,perms}={}){
    guard(state);
    const next=copy(state);
    const role=requireRole(next,id);
    if(role.locked)throw new Error('系统管理员不可编辑，仅查看');
    if(name!==undefined){
      const value=cleanName(name,'角色名称');
      if(next.roles.some(r=>r.id!==id&&norm(r.name)===norm(value)))throw new Error('已有同名角色');
      role.name=value;
    }
    if(scope!==undefined){if(!SCOPES.some(([s])=>s===scope))throw new Error('请选择角色可见范围');role.scope=scope;}
    if(perms!==undefined)role.perms=cleanPerms(perms);
    // 自己这个角色不能把“角色权限”关掉，免得把自己锁在外面。
    if(currentMember(state).roleId===id&&!role.perms['settings.roles']&&roleOf(state).perms['settings.roles'])throw new Error('不能去掉自己角色的“角色权限和成员管理”，否则就改不回来了');
    return put(state,next);
  }
  function deleteRole(state,id){
    guard(state);
    const next=copy(state);
    const role=requireRole(next,id);
    if(role.builtin)throw new Error('内置角色不能删除');
    const used=next.members.filter(m=>m.roleId===id).length;
    if(used)throw new Error(`还有 ${used} 位成员是这个角色，先把他们换成别的角色`);
    next.roles=next.roles.filter(r=>r.id!==id);
    return put(state,next);
  }
  // ---------- 修改：成员（测试账号） ----------
  function addMember(state,{name,roleId=SALES}={}){
    guard(state);
    const next=copy(state);
    const value=cleanName(name,'成员名字');
    if(next.members.some(m=>norm(m.name)===norm(value)))throw new Error('已有同名成员');
    if(next.members.length>=LIMITS.members)throw new Error(`成员最多 ${LIMITS.members} 位`);
    requireRole(next,roleId);
    next.members.push({id:newId('m'),name:value,roleId});
    return put(state,next);
  }
  function setMemberRole(state,id,roleId){
    guard(state);
    const next=copy(state);
    const member=next.members.find(m=>m.id===id);
    if(!member)throw new Error('没有找到这位成员');
    requireRole(next,roleId);
    member.roleId=roleId;
    if(!next.members.some(m=>m.roleId===ADMIN))throw new Error('至少要留一位系统管理员');
    return put(state,next);
  }
  function renameMember(state,id,name){
    guard(state);
    const next=copy(state);
    const member=next.members.find(m=>m.id===id);
    if(!member)throw new Error('没有找到这位成员');
    const value=cleanName(name,'成员名字');
    if(next.members.some(m=>m.id!==id&&norm(m.name)===norm(value)))throw new Error('已有同名成员');
    member.name=value;
    return put(state,next);
  }
  function removeMember(state,id){
    guard(state);
    const next=copy(state);
    const member=next.members.find(m=>m.id===id);
    if(!member)throw new Error('没有找到这位成员');
    if(member.id===next.current)throw new Error('不能删除正在使用的账号，先切换到别的账号');
    next.members=next.members.filter(m=>m.id!==id);
    if(!next.members.some(m=>m.roleId===ADMIN))throw new Error('至少要留一位系统管理员');
    return put(state,next);
  }
  // 切换测试账号：任何人都能切（只是预览）。同时把“默认跟进人”换成这个账号，新建的客户、线索、商机默认算他的。
  function switchTo(state,id){
    const next=copy(state);
    if(!next.members.some(m=>m.id===id))throw new Error('没有找到这个账号');
    next.current=id;
    return put(state,next);
  }
  // 每个页面要什么权限才能打开。kind 同 rail-menu.js：route／screen／mail。没列的页面谁都能开（工作台、日历、设置中心）。
  const PAGE_PERMS=Object.freeze({
    route:Object.freeze({leads:'lead.view','lead-trash':'lead.view',opportunities:'opp.view','opp-analysis':'opp.view','opp-flows':'settings.opportunity',
      'order-list':'order.view','order-trash':'order.view',products:'product.view','doc-templates':'settings.docTemplate',
      'team-goals':'team.view','team-targets':'team.targets','team-wall':'team.wall',analysis:'team.view','team-assets':'team.view','team-followups':'team.view','team-tasks':'team.view','team-orders':'team.view',
      settings:'settings.general',roles:'settings.roles',members:'settings.roles'}),
    screen:Object.freeze({active:'customer.view',pool:'pool.view',duplicates:'customer.duplicates','customer-settings':'settings.customer'}),
    mail:'mail.view',
  });
  function pagePerm(kind,target){
    const table=PAGE_PERMS[kind];
    if(typeof table==='string')return table;
    return table&&Object.hasOwn(table,target)?table[target]:null;
  }
  // canOpen(state,'route','leads')：当前账号能不能打开这个页面。
  function canOpen(state,kind,target){const key=pagePerm(kind,target);return !key||can(state,key);}
  function memberCount(state,roleId){return settings(state).members.filter(m=>m.roleId===roleId).length;}

  const api={LIMITS,SCOPES,GROUPS,KEYS,ADMIN,SALES,TEST_SALES,SALES_DEFAULT,PAGE_PERMS,pagePerm,canOpen,labelOf,settings,currentMember,roleOf,can,isAdmin,scopeOf,meName,canSee,denied,assert,
    addRole,updateRole,deleteRole,addMember,setMemberRole,renameMember,removeMember,switchTo,memberCount};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LaiRoleModel=api;
})(typeof window!=='undefined'?window:globalThis);
