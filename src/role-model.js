(function(root){
  'use strict';
  // 角色权限和测试账号。纯函数：输入 state，返回新的 state，不碰界面，也不自己保存。
  // 设置存在 state.laiSettings.roles：{roles:[{id,name,scope,perms:{key:true},fields:{模块:{字段:'read'|'hidden'}},layouts:{product:{form,detail}},v}],
  //   departments:[{id,name,parentId}], members:[{id,name,roleId,deptId}], current:memberId}。
  // 来财现在没有服务器和登录，账号只是“测试账号”：在本机切换，用来预览不同角色看到什么、能做什么。不是安全措施。
  const trim=value=>String(value??'').trim();
  const norm=value=>trim(value).toLowerCase();
  const LIMITS=Object.freeze({roles:20,members:100,name:20,departments:50,depth:5,fields:300});
  // 可见范围：本人＝只看自己做跟进人/负责人的客户、线索、商机、订单；本部门＝自己和本部门（含下级部门）成员的；全公司＝都能看。
  const SCOPES=Object.freeze([['self','本人'],['dept','本部门'],['all','全公司']].map(item=>Object.freeze(item)));
  // 权限清单：[模块, [[key, 名称], ...]]。只列来财真有的功能。
  const GROUPS=Object.freeze([
    ['线索',[['lead.view','查看'],['lead.create','创建'],['lead.edit','编辑'],['lead.delete','删除'],['lead.purge','彻底删除（回收站）'],['lead.reassign','重新分配'],['lead.convert','转为客户'],['lead.export','导出线索']]],
    ['商机',[['opp.view','查看'],['opp.create','创建'],['opp.edit','编辑'],['opp.delete','删除'],['opp.transfer','转移负责人'],['opp.archive','商机归档'],['opp.fileDownload','下载文件'],['opp.fileDelete','删除文件'],['opp.export','导出商机']]],
    ['客户',[['customer.view','查看'],['customer.create','创建'],['customer.edit','编辑'],['customer.reassign','重新分配'],['customer.removeOwner','移除跟进人'],['customer.unfollow','取消关注'],['customer.toPool','移入公海'],['customer.merge','合并客户'],['customer.batchFollow','批量写跟进'],['customer.duplicates','客户查重页面-查看'],['customer.trash','移入回收站'],['customer.import','导入客户'],['customer.export','导出客户']]],
    ['公海客户',[['pool.view','查看'],['pool.claim','移入私海（领取）'],['pool.assign','分配客户'],['pool.edit','编辑'],['pool.delete','删除']]],
    ['订单',[['order.view','查看'],['order.create','创建'],['order.edit','编辑'],['order.delete','删除'],['order.export','导出订单']]],
    ['产品',[['product.view','查看'],['product.create','创建'],['product.edit','编辑'],['product.delete','删除'],['product.sync','同步'],['product.codeNew','编辑产品编号（新建产品）'],['product.codeEdit','编辑产品编号（编辑产品）']]],
    ['单据',[['doc.create','生成并保存单据'],['doc.void','作废单据']]],
    ['目标与团队数据',[['team.view','查看团队数据'],['team.wall','查看团队墙'],['team.goalEdit','编辑目标值'],['team.targets','目标管理'],['team.export','导出成员排行']]],
    ['跟进动态',[['activity.view','查看']]],
    ['邮件',[['mail.view','查看'],['mail.send','写信和回复']]],
    ['沟通',[['chat.view','查看聊天记录'],['chat.send','打开 WhatsApp 聊天和记聊天'],['chat.import','导入和撤销聊天记录'],['chat.template','管理聊天模板']]],
    ['设置管理',[['settings.customer','客户设置'],['settings.dedupe','判重设置'],['settings.source','来源设置'],['settings.opportunity','商机设置'],['settings.product','产品设置'],['settings.docTemplate','单据模板设置'],['settings.general','设置（默认录入、数据备份）'],['settings.roles','角色权限和成员管理'],['settings.lead','线索设置'],['settings.rate','汇率设置'],['settings.task','任务设置'],['settings.switch','功能开关']]],
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
    'activity.view',
    'mail.view','mail.send',
    'chat.view','chat.send','chat.import',
    'settings.source']);
  const DEPT_ADMIN='deptAdmin';
  // 部门管理员：照业务的权限，再加看团队数据、编辑目标值、重新分配客户；看本部门。小满有这个内置角色，具体勾选可以改。
  const DEPT_ADMIN_DEFAULT=Object.freeze([...SALES_DEFAULT,'team.view','team.goalEdit','team.export','customer.reassign','lead.delete','pool.assign']);
  const BUILTIN=Object.freeze({
    [ADMIN]:Object.freeze({id:ADMIN,name:'系统管理员',scope:'all',builtin:true,locked:true}),
    [SALES]:Object.freeze({id:SALES,name:'业务',scope:'self',builtin:true,locked:false,defaults:SALES_DEFAULT}),
    [DEPT_ADMIN]:Object.freeze({id:DEPT_ADMIN,name:'部门管理员',scope:'dept',builtin:true,locked:false,defaults:DEPT_ADMIN_DEFAULT}),
  });
  // 权限清单的版本。旧版本存下的角色没有后来拆出来的权限，按“原来能不能做”补上，免得升级后突然少了能做的事。
  const VERSION=2;
  function upgrade(perms,v){
    if(v>=2)return perms;
    const out={...perms};
    out['activity.view']=true;                       // 以前跟进动态谁都能看
    if(out['team.targets'])out['team.goalEdit']=true; // 以前“目标管理”也管编辑目标值
    if(out['team.view'])out['team.export']=true;     // 以前能看团队数据就能导出
    if(out['lead.delete'])out['lead.purge']=true;    // 以前删除线索也包括彻底删除
    if(out['product.create'])out['product.codeNew']=true;
    if(out['product.edit'])out['product.codeEdit']=true;
    return out;
  }
  // 存下来的角色带着“存的时候权限清单里有哪些”（known）。之后新加的权限，内置角色（业务、部门管理员）按默认值补上，
  // 不然老账号永远拿不到新功能；已经知道的权限（不管勾没勾）不动。没带 known 的旧数据，按下面这份当时的清单算。
  const LEGACY_KNOWN=Object.freeze(['lead.view','lead.create','lead.edit','lead.delete','lead.purge','lead.reassign','lead.convert','opp.view','opp.create','opp.edit','opp.delete','opp.transfer','opp.archive','opp.fileDownload','opp.fileDelete','customer.view','customer.create','customer.edit','customer.reassign','customer.removeOwner','customer.unfollow','customer.toPool','customer.merge','customer.batchFollow','customer.duplicates','customer.trash','customer.import','pool.view','pool.claim','pool.assign','pool.edit','pool.delete','order.view','order.create','order.edit','order.delete','product.view','product.create','product.edit','product.delete','product.sync','product.codeNew','product.codeEdit','doc.create','doc.void','team.view','team.wall','team.goalEdit','team.targets','team.export','activity.view','mail.view','mail.send','settings.customer','settings.dedupe','settings.source','settings.opportunity','settings.product','settings.docTemplate','settings.general','settings.roles']);
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
  // 字段权限：哪些模块能按字段设。字段本身由各模块提供（role-ui.js 读），这里只认“模块 + 字段名 → 只读/隐藏”。没写的字段都是可编辑。
  const FIELD_MODULES=Object.freeze([['lead','线索'],['opp','商机'],['customer','客户'],['pool','公海客户'],['product','产品']].map(item=>Object.freeze(item)));
  const FIELD_LEVELS=Object.freeze([['edit','可编辑'],['read','只读'],['hidden','隐藏']].map(item=>Object.freeze(item)));
  function cleanFields(raw){
    const out={};
    if(!raw||typeof raw!=='object')return out;
    for(const [module] of FIELD_MODULES){
      const src=raw[module];
      if(!src||typeof src!=='object')continue;
      const entries=Object.entries(src).filter(([key,level])=>trim(key)&&key.length<=80&&(level==='read'||level==='hidden')).slice(0,LIMITS.fields);
      if(entries.length)out[module]=Object.fromEntries(entries);
    }
    return out;
  }
  // 角色用哪个产品布局：''＝跟着“产品 → 布局”里的默认分配。布局是否存在由产品模块判断。
  function cleanLayouts(raw){
    const product=raw&&raw.product&&typeof raw.product==='object'?raw.product:{};
    const form=trim(product.form).slice(0,80),detail=trim(product.detail).slice(0,80);
    return form||detail?{product:{form,detail}}:{};
  }
  function readRole(r,base){
    let perms=r?upgrade(cleanPerms(r.perms),Number(r.v)||1):Object.fromEntries(base.defaults.map(key=>[key,true]));
    if(r&&base.defaults.length){
      const known=new Set(Array.isArray(r.known)?r.known:LEGACY_KNOWN);
      perms={...perms};
      for(const key of base.defaults)if(!known.has(key))perms[key]=true;
    }
    return {...base,perms:cleanPerms(perms),fields:cleanFields(r?.fields),layouts:cleanLayouts(r?.layouts)};
  }

  // ---------- 读取 ----------
  // 没存过时：系统管理员 + 业务 + 部门管理员三个角色；成员取“默认跟进人”做管理员，其他出现过的跟进人做业务。
  function ownersOf(state){
    const seen=new Map();
    const add=value=>{const name=trim(value);if(name&&!seen.has(norm(name)))seen.set(norm(name),name);};
    add(state?.laiSettings?.defaultOwner);add(state?.orderSettings?.defaultOwner);
    for(const profile of Object.values(state?.customers||{}))add(profile?.owner);
    for(const order of Array.isArray(state?.orders)?state.orders:[])add(order?.owner);
    return [...seen.values()];
  }
  // 部门：一棵树，parentId 为空＝直接挂在“我的企业”下面。上级不存在或绕成圈的，挂回最上层。
  function readDepartments(list){
    const out=[],ids=new Set(),names=new Set();
    for(const d of Array.isArray(list)?list:[]){
      const name=trim(d&&d.name),id=trim(d&&d.id);
      if(!name||!id||ids.has(id)||out.length>=LIMITS.departments)continue;
      const key=`${trim(d.parentId)}|${norm(name)}`;
      if(names.has(key))continue;
      ids.add(id);names.add(key);
      out.push({id,name,parentId:trim(d.parentId)});
    }
    const byId=new Map(out.map(d=>[d.id,d]));
    for(const d of out){
      let p=d.parentId,steps=0;
      while(p&&byId.has(p)&&p!==d.id&&steps<LIMITS.depth+1){p=byId.get(p).parentId;steps++;}
      if(d.parentId&&(!byId.has(d.parentId)||p===d.id||steps>LIMITS.depth))d.parentId='';
    }
    return out;
  }
  function readSettings(raw,state){
    const stored=raw&&typeof raw==='object'?raw:null;
    const roles=[{...BUILTIN[ADMIN],perms:all(),fields:{},layouts:{}}];
    const storedRoles=Array.isArray(stored?.roles)?stored.roles:[];
    for(const id of [SALES,DEPT_ADMIN]){
      const r=storedRoles.find(x=>x&&x.id===id);
      roles.push({...readRole(r,BUILTIN[id]),name:trim(r?.name)||BUILTIN[id].name,scope:cleanScope(r?.scope??BUILTIN[id].scope)});
    }
    for(const r of roles)delete r.defaults;
    const names=new Set(roles.map(r=>norm(r.name)));
    // 存着的自建角色名字先占住，改名时不和它们撞。
    const reserved=new Set(storedRoles.filter(r=>r&&!BUILTIN[r.id]).map(r=>norm(trim(r.name))));
    for(const r of storedRoles){
      if(!r||BUILTIN[r.id]||roles.length>=LIMITS.roles)continue;
      let name=trim(r.name);
      if(!name)continue;
      // 和内置角色（比如后来加的“部门管理员”）或别的角色重名：不丢掉这个角色，改个名字留着，成员也还在这个角色里。
      if(names.has(norm(name))){
        const base=`${[...name].slice(0,LIMITS.name-6).join("")}（自建）`;
        let n=1;name=base;
        while(names.has(norm(name))||reserved.has(norm(name)))name=`${base}${++n}`;
      }
      names.add(norm(name));
      roles.push({...readRole(r,{defaults:[]}),id:trim(r.id)||newId('r'),name,scope:cleanScope(r.scope),builtin:false,locked:false});
      delete roles[roles.length-1].defaults;
    }
    const departments=readDepartments(stored?.departments);
    const deptIds=new Set(departments.map(d=>d.id));
    let members=[];
    if(stored&&Array.isArray(stored.members)){
      const seen=new Set();
      for(const m of stored.members){
        const name=trim(m&&m.name);
        if(!name||seen.has(norm(name))||members.length>=LIMITS.members)continue;
        seen.add(norm(name));
        members.push({id:trim(m.id)||newId('m'),name,roleId:roles.some(r=>r.id===m.roleId)?m.roleId:SALES,deptId:deptIds.has(trim(m.deptId))?trim(m.deptId):''});
      }
    }
    if(!members.length){
      // 管理员是“默认跟进人”；没填默认跟进人时叫“管理员”，不拿某个业务的名字顶上。
      const me=trim(state?.laiSettings?.defaultOwner)||trim(state?.orderSettings?.defaultOwner)||'管理员';
      const owners=ownersOf(state).filter(name=>norm(name)!==norm(me));
      members=[me,...owners].map((name,i)=>({id:`m-${i}`,name,roleId:i===0?ADMIN:SALES,deptId:''}));
      // 第一次打开时备一个“业务”测试账号，切过去就能看业务看到什么。
      if(!members.some(m=>m.roleId===SALES)&&!members.some(m=>norm(m.name)===norm(TEST_SALES)))members.push({id:'m-test-sales',name:TEST_SALES,roleId:SALES,deptId:''});
    }
    // 至少要有一个系统管理员，不然没人能改权限。
    if(!members.some(m=>m.roleId===ADMIN))members[0]={...members[0],roleId:ADMIN};
    const wanted=trim(stored?.current);
    const current=members.some(m=>m.id===wanted)?wanted:members[0].id;
    return {roles,departments,members,current};
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
  // “默认跟进人”（laiSettings.defaultOwner）是用户在设置里自己填的值，这里不改它：换账号、改名都不碰。
  // 给当前账号改名时，如果默认跟进人正好是这个账号的旧名字，由 renameOwnerEverywhere 一起改成新名字。
  // 新建客户、线索、商机、订单时实际用谁，见 defaultOwner()：只能看本人或本部门的账号，默认是它自己。
  function put(state,next){
    const roles=next.roles.filter(r=>r.id!==ADMIN).map(r=>{
      const row={id:r.id,name:r.name,scope:r.scope,perms:cleanPerms(r.perms),v:VERSION,known:[...KEYS]};
      const fields=cleanFields(r.fields),layouts=cleanLayouts(r.layouts);
      if(Object.keys(fields).length)row.fields=fields;
      if(Object.keys(layouts).length)row.layouts=layouts;
      return row;
    });
    const departments=next.departments.map(d=>({id:d.id,name:d.name,parentId:d.parentId||''}));
    const members=next.members.map(m=>m.deptId?{id:m.id,name:m.name,roleId:m.roleId,deptId:m.deptId}:{id:m.id,name:m.name,roleId:m.roleId});
    const laiSettings={...(state.laiSettings||{}),roles:{roles,departments,members,current:next.current}};
    return {...state,laiSettings};
  }
  const copy=state=>{const s=settings(state);return {
    roles:s.roles.map(r=>({...r,perms:{...r.perms},fields:JSON.parse(JSON.stringify(r.fields||{})),layouts:JSON.parse(JSON.stringify(r.layouts||{}))})),
    departments:s.departments.map(d=>({...d})),members:s.members.map(m=>({...m})),current:s.current};};

  // ---------- 当前账号和权限判断 ----------
  function currentMember(state){const s=settings(state);return s.members.find(m=>m.id===s.current)||s.members[0];}
  function roleOf(state,member=currentMember(state)){const s=settings(state);return s.roles.find(r=>r.id===member?.roleId)||s.roles.find(r=>r.id===SALES);}
  // ---------- 功能开关：权限、页面属于哪个模块 ----------
  // 开关存在 state.laiSettings.featureSwitch.off（模块 id 列表）；这里直接读它，不依赖功能开关模型先装载。
  // 可以关的模块：lead 线索、opp 商机、product 产品、doc 单据、mail 邮件、chat 沟通、team 团队数据（名单在 feature-switch-model.js）。
  const KEY_MODULE=Object.freeze({lead:'lead',opp:'opp',product:'product',doc:'doc',mail:'mail',chat:'chat',team:'team'});
  const SETTINGS_MODULE=Object.freeze({'settings.lead':'lead','settings.opportunity':'opp','settings.product':'product','settings.docTemplate':'doc'});
  const ROUTE_MODULE=Object.freeze({
    leads:'lead','lead-trash':'lead','lead-settings':'lead',
    opportunities:'opp','opp-analysis':'opp','opp-flows':'opp',
    products:'product','doc-templates':'doc',mail:'mail',
    chats:'chat','chat-templates':'chat',
    'team-goals':'team','team-targets':'team','team-wall':'team',analysis:'team','team-assets':'team','team-followups':'team','team-tasks':'team','team-orders':'team'});
  // 权限 key → 模块：lead.*、opp.*、product.*、doc.*、mail.*、chat.*、team.* 和对应的设置项；其它（客户、订单、设置……）返回 ''。
  function moduleOfKey(key){
    const text=String(key||'');
    if(Object.hasOwn(SETTINGS_MODULE,text))return SETTINGS_MODULE[text];
    const head=text.split('.')[0];
    return text.includes('.')&&Object.hasOwn(KEY_MODULE,head)?KEY_MODULE[head]:'';
  }
  const moduleOfRoute=route=>Object.hasOwn(ROUTE_MODULE,route)?ROUTE_MODULE[route]:'';
  // 菜单行（kind 同 rail-menu.js）：邮件文件夹属于邮件，业务页面按路由；客户页面不受影响。
  function moduleOfEntry(kind,target){return kind==='mail'?'mail':kind==='route'?moduleOfRoute(target):'';}
  // 这个模块开着吗？没写（或不是可以关的模块）就是开着。
  function moduleOnFor(state,module){
    if(!module)return true;
    const raw=state&&state.laiSettings&&state.laiSettings.featureSwitch;
    return !(raw&&typeof raw==='object'&&!Array.isArray(raw)&&Array.isArray(raw.off)&&raw.off.includes(module));
  }
  // can(state,'customer.edit')：当前账号有没有这个权限。系统管理员什么都能做。
  // 功能开关（设置 → 功能开关）：模块关了，对所有账号（包括系统管理员）都算没有这个权限；角色里存的权限不变，模块打开就恢复。
  function can(state,key){
    if(!moduleOnFor(state,moduleOfKey(key)))return false;
    const role=roleOf(state);
    if(!role)return false;
    if(role.id===ADMIN)return true;
    return role.perms[key]===true;
  }
  const isAdmin=state=>roleOf(state)?.id===ADMIN;
  const scopeOf=state=>roleOf(state)?.scope||'self';
  const meName=state=>currentMember(state)?.name||'';
  // 新建客户、线索、商机、订单时默认的跟进人。可看全公司的账号用设置里填的“默认跟进人”；
  // 只能看本人或本部门的账号，新建的资料默认归它自己（不然建完自己都看不到）。
  function defaultOwner(state){
    if(scopeOf(state)!=='all'&&meName(state))return meName(state);
    return trim(state?.laiSettings?.defaultOwner)||trim(state?.orderSettings?.defaultOwner);
  }
  // 可见范围：全公司都能看；本人只看跟进人/负责人是自己的（不分大小写）。没有跟进人的也看不到，公海客户另由 pool.view 决定。
  // 部门 id 加上它所有下级部门的 id。
  function deptAndBelow(state,deptId){
    const out=new Set();
    if(!deptId)return out;
    const list=settings(state).departments;
    const walk=id=>{if(out.has(id))return;out.add(id);for(const d of list)if(d.parentId===id)walk(d.id);};
    walk(deptId);
    return out;
  }
  // 本部门能看哪些人的记录：自己 + 本部门和下级部门的成员（按名字，不分大小写）。自己没有部门时只看自己。
  const teamCache=new WeakMap();
  function teamNames(state){
    const s=settings(state);
    const hit=teamCache.get(s);
    const me=currentMember(state);
    if(hit&&hit.me===me.id)return hit.names;
    const depts=deptAndBelow(state,me.deptId);
    const names=new Set([norm(me.name),...s.members.filter(m=>m.deptId&&depts.has(m.deptId)).map(m=>norm(m.name))]);
    teamCache.set(s,{me:me.id,names});
    return names;
  }
  function canSee(state,owner){
    const scope=scopeOf(state);
    if(scope==='all')return true;
    if(!trim(owner))return false;
    if(scope==='dept')return teamNames(state).has(norm(owner));
    return norm(owner)===norm(meName(state));
  }
  // ---------- 字段权限 ----------
  // fieldLevel(state,'customer','email')：'edit'｜'read'｜'hidden'。系统管理员全部可编辑。
  function fieldLevel(state,module,key){
    const role=roleOf(state);
    if(!role||role.id===ADMIN)return 'edit';
    const levels=role.fields?.[module];
    const level=levels&&typeof levels==='object'&&Object.hasOwn(levels,key)?levels[key]:'';
    return level==='read'||level==='hidden'?level:'edit';
  }
  const fieldVisible=(state,module,key)=>fieldLevel(state,module,key)!=='hidden';
  const fieldEditable=(state,module,key)=>fieldLevel(state,module,key)==='edit';
  // 当前账号在这个模块里不能改的字段（只读和隐藏）。
  function lockedFields(state,module){
    const role=roleOf(state);
    if(!role||role.id===ADMIN)return [];
    return Object.keys(role.fields?.[module]||{});
  }
  // 保存前用：不能改的字段一律用原来的值（原来没有就去掉），表单里漏掉或被改的都不会写进去。
  // 新建（before 为空）时：不能改的字段不许填，去掉；默认值由各模块自己在之后补。
  function keepLocked(state,module,before,after,keys=lockedFields(state,module)){
    if(!after||typeof after!=='object'||!keys.length)return after;
    const out={...after};
    for(const key of keys){
      if(before&&Object.hasOwn(before,key))out[key]=before[key];
      else delete out[key];
    }
    return out;
  }
  // 角色用的产品布局：{form,detail}，''＝跟默认分配。
  function productLayoutOf(state){
    const role=roleOf(state);
    return {form:role?.layouts?.product?.form||'',detail:role?.layouts?.product?.detail||''};
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
    next.roles.push({id:newId('r'),name:value,scope:base.scope,builtin:false,locked:false,perms:{...base.perms},fields:JSON.parse(JSON.stringify(base.fields||{})),layouts:JSON.parse(JSON.stringify(base.layouts||{}))});
    return put(state,next);
  }
  function updateRole(state,id,{name,scope,perms,fields,layouts}={}){
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
    if(fields!==undefined)role.fields=cleanFields(fields);
    if(layouts!==undefined)role.layouts=cleanLayouts(layouts);
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
  function addMember(state,{name,roleId=SALES,deptId=''}={}){
    guard(state);
    const next=copy(state);
    const value=cleanName(name,'成员名字');
    if(next.members.some(m=>norm(m.name)===norm(value)))throw new Error('已有同名成员');
    if(next.members.length>=LIMITS.members)throw new Error(`成员最多 ${LIMITS.members} 位`);
    requireRole(next,roleId);
    const dept=trim(deptId);
    if(dept)requireDept(next,dept);
    next.members.push({id:newId('m'),name:value,roleId,deptId:dept});
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
  // 成员改名后，他负责的记录跟着改名（记录里存的是名字，不是成员编号）。不分大小写匹配，纯函数，不碰没变的记录。
  // 改的地方：客户的负责人、线索、订单（含订单回收站）、商机的负责人和协同跟进人、任务、目标里的成员，以及默认跟进人。
  function renameOwnerEverywhere(state,oldName,newName){
    const from=norm(oldName),to=trim(newName);
    if(!from||!to||!state||typeof state!=='object')return state;
    const hit=value=>typeof value==='string'&&norm(value)===from&&value!==to;
    let changed=false;
    const mark=item=>{changed=true;return item;};
    const field=(item,key)=>item&&typeof item==='object'&&hit(item[key])?mark({...item,[key]:to}):item;
    const rows=(list,keys)=>{
      if(!Array.isArray(list))return list;
      let touched=false;
      const out=list.map(item=>{let cur=item;for(const key of keys)cur=field(cur,key);if(cur!==item)touched=true;return cur;});
      return touched?out:list;
    };
    const next={...state};
    if(state.customers&&typeof state.customers==='object'&&!Array.isArray(state.customers)){
      let touched=false;
      const customers={};
      for(const [name,profile] of Object.entries(state.customers)){const cur=field(profile,'owner');if(cur!==profile)touched=true;customers[name]=cur;}
      if(touched)next.customers=customers;
    }
    for(const key of ['laiLeads','orders','trashOrders','laiTasks','laiTargets']){
      const out=rows(state[key],['owner']);
      if(out!==state[key])next[key]=out;
    }
    if(Array.isArray(state.laiOpportunities)){
      let touched=false;
      const out=state.laiOpportunities.map(item=>{
        let cur=field(item,'owner');
        if(cur&&Array.isArray(cur.collaborators)&&cur.collaborators.some(hit)){
          cur={...cur,collaborators:cur.collaborators.map(name=>hit(name)?to:name)};
        }
        if(cur!==item)touched=true;
        return cur;
      });
      if(touched)next.laiOpportunities=out;
    }
    for(const key of ['laiSettings','orderSettings']){
      const cur=field(state[key],'defaultOwner');
      if(cur!==state[key])next[key]=cur;
    }
    return changed?next:state;
  }
  function renameMember(state,id,name){
    guard(state);
    const next=copy(state);
    const member=next.members.find(m=>m.id===id);
    if(!member)throw new Error('没有找到这位成员');
    const value=cleanName(name,'成员名字');
    if(next.members.some(m=>m.id!==id&&norm(m.name)===norm(value)))throw new Error('已有同名成员');
    const before=member.name;
    member.name=value;
    // 名字只是大小写或空格不同的话，记录也照样改成新写法。
    return renameOwnerEverywhere(put(state,next),before,value);
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
  // 切换测试账号：任何人都能切（只是预览）。不改“默认跟进人”。
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
      settings:'settings.general',roles:'settings.roles',members:'settings.roles',
      chats:'chat.view','chat-templates':'chat.template','lead-settings':'settings.lead',rates:'settings.rate','task-settings':'settings.task','feature-switch':'settings.switch'}),
    screen:Object.freeze({active:'customer.view',pool:'pool.view',duplicates:'customer.duplicates','customer-settings':'settings.customer'}),
    mail:'mail.view',
  });
  function pagePerm(kind,target){
    const table=PAGE_PERMS[kind];
    if(typeof table==='string')return table;
    return table&&Object.hasOwn(table,target)?table[target]:null;
  }
  // canOpen(state,'route','leads')：当前账号能不能打开这个页面。
  function canOpen(state,kind,target){if(!moduleOnFor(state,moduleOfEntry(kind,target)))return false;const key=pagePerm(kind,target);return !key||can(state,key);}
  // ---------- 修改：部门 ----------
  function requireDept(next,id){const dept=next.departments.find(d=>d.id===id);if(!dept)throw new Error('没有找到这个部门');return dept;}
  function depthOf(next,id){let n=0,p=id;while(p){const d=next.departments.find(x=>x.id===p);if(!d)break;p=d.parentId;n++;}return n;}
  function addDepartment(state,{name,parentId=''}={}){
    guard(state);
    const next=copy(state);
    const value=cleanName(name,'部门名称');
    const parent=trim(parentId);
    if(parent)requireDept(next,parent);
    if(next.departments.length>=LIMITS.departments)throw new Error(`部门最多 ${LIMITS.departments} 个`);
    if(depthOf(next,parent)>=LIMITS.depth)throw new Error(`部门最多 ${LIMITS.depth} 层`);
    if(next.departments.some(d=>d.parentId===parent&&norm(d.name)===norm(value)))throw new Error('同一个上级下面已有同名部门');
    next.departments.push({id:newId('d'),name:value,parentId:parent});
    return put(state,next);
  }
  function renameDepartment(state,id,name){
    guard(state);
    const next=copy(state);
    const dept=requireDept(next,id);
    const value=cleanName(name,'部门名称');
    if(next.departments.some(d=>d.id!==id&&d.parentId===dept.parentId&&norm(d.name)===norm(value)))throw new Error('同一个上级下面已有同名部门');
    dept.name=value;
    return put(state,next);
  }
  function deleteDepartment(state,id){
    guard(state);
    const next=copy(state);
    const dept=requireDept(next,id);
    if(next.departments.some(d=>d.parentId===id))throw new Error('先删掉或移走下级部门');
    const used=next.members.filter(m=>m.deptId===id).length;
    if(used)throw new Error(`还有 ${used} 位成员在这个部门，先把他们移到别的部门`);
    next.departments=next.departments.filter(d=>d.id!==dept.id);
    return put(state,next);
  }
  function setMemberDept(state,memberId,deptId){
    guard(state);
    const next=copy(state);
    const member=next.members.find(m=>m.id===memberId);
    if(!member)throw new Error('没有找到这位成员');
    const value=trim(deptId);
    if(value)requireDept(next,value);
    member.deptId=value;
    return put(state,next);
  }
  // 部门列表，按树的顺序排好，带层级（给下拉框和左边的树用）。
  function deptTree(state){
    const list=settings(state).departments,out=[];
    const walk=(parent,level)=>{for(const d of list.filter(x=>x.parentId===parent)){out.push({...d,level});walk(d.id,level+1);}};
    walk('',0);
    return out;
  }
  function deptCount(state,deptId){return settings(state).members.filter(m=>m.deptId===deptId).length;}
  function memberCount(state,roleId){return settings(state).members.filter(m=>m.roleId===roleId).length;}

  const api={LIMITS,SCOPES,GROUPS,KEYS,ADMIN,SALES,DEPT_ADMIN,TEST_SALES,SALES_DEFAULT,DEPT_ADMIN_DEFAULT,PAGE_PERMS,FIELD_MODULES,FIELD_LEVELS,
    pagePerm,canOpen,moduleOfKey,moduleOfRoute,moduleOfEntry,moduleOnFor,ROUTE_MODULE,labelOf,settings,currentMember,roleOf,can,isAdmin,scopeOf,meName,defaultOwner,canSee,denied,assert,
    fieldLevel,fieldVisible,fieldEditable,lockedFields,keepLocked,productLayoutOf,
    addRole,updateRole,deleteRole,addMember,setMemberRole,renameMember,renameOwnerEverywhere,removeMember,switchTo,memberCount,
    addDepartment,renameDepartment,deleteDepartment,setMemberDept,deptTree,deptAndBelow,deptCount};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LaiRoleModel=api;
})(typeof window!=='undefined'?window:globalThis);
