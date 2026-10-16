(function(root){
  'use strict';
  // 产品库和产品设置（分组、字段、规格）。纯函数：输入 state，返回新的 state，不碰界面，也不自己保存。
  // 产品存在 state.laiProducts（数组）；设置存在 state.laiSettings.productSettings。
  const trim=value=>String(value??'').trim();
  const norm=value=>trim(value).toLowerCase();
  const SEP=' / ';
  const LIMITS=Object.freeze({products:5000,groups:100,children:30,specs:50,values:100,name:20,text:500,description:2000,layouts:20,sections:10,syncRows:2000,syncTasks:50});
  // [key, 标签, 信息区, 类型]。类型 text 单行，area 多行，number 数字。产品名称固定显示且必填。
  const SECTIONS=Object.freeze(['基本信息','价格信息','尺寸信息','包装信息','外箱信息']);
  const FIELDS=Object.freeze([
    ['code','产品编号','基本信息','text'],['name','产品名称','基本信息','text'],['nameCn','中文产品名称','基本信息','text'],
    ['model','产品型号','基本信息','text'],['group','产品分组','基本信息','group'],['unit','计量单位','基本信息','text'],
    ['remark','产品备注','基本信息','area'],['link','产品链接','基本信息','text'],['description','产品描述','基本信息','area'],
    ['fob','离岸价','价格信息','number'],
    ['size','产品尺寸(长*宽*高cm)','尺寸信息','text'],['volume','产品体积','尺寸信息','number'],['netWeight','产品净重','尺寸信息','number'],
    ['packSize','包装尺寸','包装信息','text'],['packWeight','包装毛重','包装信息','number'],['packQty','每包装产品数','包装信息','number'],['packNote','包装说明','包装信息','area'],
    ['boxSize','单箱尺寸(长*宽*高cm)','外箱信息','text'],['boxWeight','单箱毛重','外箱信息','number'],['boxQty','每箱产品数','外箱信息','number'],['boxMethod','包装方式','外箱信息','text'],
  ].map(item=>Object.freeze(item)));
  const FIXED=Object.freeze(['name']);
  const FIELD_KEYS=FIELDS.map(([key])=>key);
  const labelOf=key=>(FIELDS.find(item=>item[0]===key)||[key,key])[1];
  const typeOf=key=>(FIELDS.find(item=>item[0]===key)||[])[3]||'text';
  let counter=0;
  const newId=()=>`p${Date.now().toString(36)}${(counter++).toString(36)}`;

  function cleanName(value,label,max=LIMITS.name){
    const name=trim(value).replace(/\s+/g,' ');
    if(!name)throw new Error(`请填写${label}`);
    if(name.length>max)throw new Error(`${label}最长 ${max} 个字`);
    if(name.includes('/'))throw new Error(`${label}里不能有“/”`);
    return name;
  }
  // ---------- 设置 ----------
  function normalizeGroups(list){
    const out=[],seen=new Set();
    for(const raw of Array.isArray(list)?list:[]){
      const name=trim(raw&&raw.name);
      if(!name||name.includes('/')||seen.has(norm(name))||out.length>=LIMITS.groups)continue;
      seen.add(norm(name));
      const childSeen=new Set(),children=[];
      for(const child of Array.isArray(raw.children)?raw.children:[]){
        const childName=trim(child&&child.name);
        if(!childName||childName.includes('/')||childSeen.has(norm(childName))||children.length>=LIMITS.children)continue;
        childSeen.add(norm(childName));
        children.push({id:trim(child.id)||newId(),name:childName});
      }
      out.push({id:trim(raw.id)||newId(),name,children});
    }
    return out;
  }
  function normalizeSpecs(list){
    const out=[],seen=new Set();
    for(const raw of Array.isArray(list)?list:[]){
      const name=trim(raw&&raw.name);
      if(!name||seen.has(norm(name))||out.length>=LIMITS.specs)continue;
      seen.add(norm(name));
      const valueSeen=new Set(),values=[];
      for(const value of Array.isArray(raw.values)?raw.values:[]){
        const text=trim(value);
        if(!text||valueSeen.has(norm(text))||values.length>=LIMITS.values)continue;
        valueSeen.add(norm(text));
        values.push(text);
      }
      out.push({id:trim(raw.id)||newId(),name,values});
    }
    return out;
  }
  // 布局：内置的「默认布局」不存，只存自己建的；每个布局是若干信息区，信息区里是字段 key（不在里面的字段就是在这个布局里隐藏了）。
  const DEFAULT_LAYOUT='default';
  const PLACES=Object.freeze([['form','新建/编辑产品'],['detail','产品详情']]);
  function normalizeLayouts(list){
    const out=[],names=new Set([norm('默认布局')]),ids=new Set([DEFAULT_LAYOUT]);
    for(const item of Array.isArray(list)?list:[]){
      const name=trim(item&&item.name).replace(/\s+/g,' ');
      const id=trim(item&&item.id)||newId();
      if(!name||name.length>LIMITS.name||names.has(norm(name))||ids.has(id)||out.length>=LIMITS.layouts)continue;
      const used=new Set(),secNames=new Set(),sections=[];
      for(const sec of Array.isArray(item.sections)?item.sections:[]){
        const secName=trim(sec&&sec.name).replace(/\s+/g,' ');
        if(!secName||secName.length>LIMITS.name||secNames.has(norm(secName))||sections.length>=LIMITS.sections)continue;
        secNames.add(norm(secName));
        const fields=[];
        for(const key of Array.isArray(sec.fields)?sec.fields:[])if(FIELD_KEYS.includes(key)&&!used.has(key)){used.add(key);fields.push(key);}
        sections.push({name:secName,fields});
      }
      if(!sections.length)continue;
      if(!used.has('name'))sections[0].fields.unshift('name');
      names.add(norm(name));ids.add(id);
      out.push({id,name,sections});
    }
    return out;
  }
  function readSettings(raw){
    const stored=raw&&typeof raw==='object'?raw:{};
    const fields={};
    for(const key of FIELD_KEYS){
      const one=stored.fields&&stored.fields[key]||{};
      const fixed=FIXED.includes(key);
      const visible=fixed||one.visible!==false;
      fields[key]={visible,required:fixed||(visible&&one.required===true)};
    }
    const layouts=normalizeLayouts(stored.layouts);
    const known=new Set([DEFAULT_LAYOUT,...layouts.map(l=>l.id)]);
    const use={};
    for(const [place] of PLACES){const id=trim(stored.layoutUse&&stored.layoutUse[place]);use[place]=known.has(id)?id:DEFAULT_LAYOUT;}
    return {groups:normalizeGroups(stored.groups),specs:normalizeSpecs(stored.specs),fields,layouts,layoutUse:use};
  }
  const cache=new WeakMap(),MISSING={};
  function settings(state){
    const stored=state&&state.laiSettings&&state.laiSettings.productSettings;
    const key=stored&&typeof stored==='object'?stored:MISSING;
    let hit=cache.get(key);
    if(!hit){hit=readSettings(key===MISSING?{}:key);cache.set(key,hit);}
    return hit;
  }
  const put=(state,patch)=>({...state,laiSettings:{...(state.laiSettings||{}),productSettings:{...settings(state),...patch}}});
  const groupPath=(top,child)=>child?`${top.name}${SEP}${child.name}`:top.name;
  const raw=state=>Array.isArray(state&&state.laiProducts)?state.laiProducts:[];
  function assertReadable(state){
    if(state&&state.laiProducts!==undefined&&state.laiProducts!==null&&!Array.isArray(state.laiProducts))throw new Error('已保存的产品数据格式异常，为避免覆盖，未做任何修改');
  }

  // ---------- 字段设置 ----------
  function setField(state,key,{visible,required}={}){
    if(!FIELD_KEYS.includes(key))throw new Error('没有这个字段');
    if(FIXED.includes(key))throw new Error(`“${labelOf(key)}”一定显示、一定必填，不能改`);
    const current=settings(state).fields;
    const show=visible===undefined?current[key].visible:!!visible;
    const need=show&&(required===undefined?current[key].required:!!required);
    if(need&&!current[key].required){
      for(const id of formLayoutIds(state)){
        const form=layoutById(state,id);
        if(form&&!form.sections.some(sec=>sec.fields.includes(key)))throw new Error(`“${labelOf(key)}”被新建/编辑用的布局隐藏了，先在布局里把它显示出来`);
      }
    }
    return put(state,{fields:{...current,[key]:{visible:show,required:need}}});
  }
  // ---------- 分组 ----------
  const copyGroups=state=>settings(state).groups.map(g=>({...g,children:g.children.map(c=>({...c}))}));
  function findGroup(list,id){
    for(const top of list){
      if(top.id===id)return {top,child:null};
      const child=top.children.find(c=>c.id===id);
      if(child)return {top,child};
    }
    return null;
  }
  function groupUse(state,path){
    return raw(state).filter(p=>{const v=trim(p.group);return v===path||v.startsWith(path+SEP);}).length;
  }
  function addGroup(state,{name,parentId=''}={}){
    const value=cleanName(name,'分组名称');
    const list=copyGroups(state);
    if(parentId){
      const parent=list.find(g=>g.id===parentId);
      if(!parent)throw new Error('没有找到上级分组');
      if(parent.children.some(c=>norm(c.name)===norm(value)))throw new Error('同一个上级下已有同名分组');
      if(parent.children.length>=LIMITS.children)throw new Error(`一个分组下最多 ${LIMITS.children} 个子分组`);
      parent.children.push({id:newId(),name:value});
    }else{
      if(list.some(g=>norm(g.name)===norm(value)))throw new Error('已有同名分组');
      if(list.length>=LIMITS.groups)throw new Error(`一级分组最多 ${LIMITS.groups} 个`);
      list.push({id:newId(),name:value,children:[]});
    }
    return put(state,{groups:list});
  }
  function renameGroup(state,id,name){
    assertReadable(state);
    const value=cleanName(name,'分组名称');
    const list=copyGroups(state);
    const hit=findGroup(list,id);
    if(!hit)throw new Error('没有找到这个分组');
    const siblings=hit.child?hit.top.children.filter(c=>c.id!==id):list.filter(g=>g.id!==id);
    if(siblings.some(x=>norm(x.name)===norm(value)))throw new Error(hit.child?'同一个上级下已有同名分组':'已有同名分组');
    const from=hit.child?groupPath(hit.top,hit.child):hit.top.name;
    (hit.child||hit.top).name=value;
    const to=hit.child?groupPath(hit.top,hit.child):hit.top.name;
    let next=put(state,{groups:list});
    if(from!==to){
      const swap=v=>trim(v)===from?to:trim(v).startsWith(from+SEP)?to+trim(v).slice(from.length):null;
      next={...next,laiProducts:raw(next).map(p=>{const v=swap(p.group);return v===null?p:{...p,group:v};})};
    }
    return next;
  }
  function moveGroup(state,id,delta){
    const list=copyGroups(state);
    const hit=findGroup(list,id);
    if(!hit)throw new Error('没有找到这个分组');
    const arr=hit.child?hit.top.children:list;
    const from=arr.findIndex(x=>x.id===id),to=from+(delta<0?-1:1);
    if(to<0||to>=arr.length)return state;
    [arr[from],arr[to]]=[arr[to],arr[from]];
    return put(state,{groups:list});
  }
  function deleteGroup(state,id){
    const list=copyGroups(state);
    const hit=findGroup(list,id);
    if(!hit)throw new Error('没有找到这个分组');
    const path=hit.child?groupPath(hit.top,hit.child):hit.top.name;
    const used=groupUse(state,path);
    if(used)throw new Error(`还有 ${used} 个产品在“${path}”里，先把它们移到别的分组`);
    if(hit.child){hit.top.children=hit.top.children.filter(c=>c.id!==id);return put(state,{groups:list});}
    return put(state,{groups:list.filter(g=>g.id!==id)});
  }
  function groupChoices(state){
    return settings(state).groups.flatMap(g=>[g.name,...g.children.map(c=>groupPath(g,c))]);
  }
  // ---------- 规格 ----------
  const copySpecs=state=>settings(state).specs.map(s=>({...s,values:s.values.slice()}));
  function specUse(state,type,value){
    return raw(state).filter(p=>(Array.isArray(p.specs)?p.specs:[]).some(s=>s.type===type&&(value===undefined||s.value===value))).length;
  }
  function addSpec(state,name){
    const value=cleanName(name,'规格类型');
    const list=copySpecs(state);
    if(list.some(s=>norm(s.name)===norm(value)))throw new Error('已有同名规格类型');
    if(list.length>=LIMITS.specs)throw new Error(`规格类型最多 ${LIMITS.specs} 个`);
    list.push({id:newId(),name:value,values:[]});
    return put(state,{specs:list});
  }
  function renameSpec(state,id,name){
    assertReadable(state);
    const value=cleanName(name,'规格类型');
    const list=copySpecs(state);
    const spec=list.find(s=>s.id===id);
    if(!spec)throw new Error('没有找到这个规格类型');
    if(list.some(s=>s.id!==id&&norm(s.name)===norm(value)))throw new Error('已有同名规格类型');
    const from=spec.name;
    spec.name=value;
    let next=put(state,{specs:list});
    if(from!==value)next={...next,laiProducts:raw(next).map(p=>Array.isArray(p.specs)&&p.specs.some(s=>s.type===from)?{...p,specs:p.specs.map(s=>s.type===from?{...s,type:value}:s)}:p)};
    return next;
  }
  function deleteSpec(state,id){
    const list=copySpecs(state);
    const spec=list.find(s=>s.id===id);
    if(!spec)throw new Error('没有找到这个规格类型');
    const used=specUse(state,spec.name);
    if(used)throw new Error(`还有 ${used} 个产品在用“${spec.name}”，先改掉它们的规格`);
    return put(state,{specs:list.filter(s=>s.id!==id)});
  }
  function addSpecValue(state,id,text){
    const value=cleanName(text,'规格值',LIMITS.name*2);
    const list=copySpecs(state);
    const spec=list.find(s=>s.id===id);
    if(!spec)throw new Error('没有找到这个规格类型');
    if(spec.values.some(v=>norm(v)===norm(value)))throw new Error('这个规格值已经有了');
    if(spec.values.length>=LIMITS.values)throw new Error(`一个规格类型下最多 ${LIMITS.values} 个规格值`);
    spec.values.push(value);
    return put(state,{specs:list});
  }
  function removeSpecValue(state,id,value){
    const list=copySpecs(state);
    const spec=list.find(s=>s.id===id);
    if(!spec||!spec.values.includes(value))throw new Error('没有找到这个规格值');
    const used=specUse(state,spec.name,value);
    if(used)throw new Error(`还有 ${used} 个产品在用“${spec.name}：${value}”，先改掉它们的规格`);
    spec.values=spec.values.filter(v=>v!==value);
    return put(state,{specs:list});
  }
  // ---------- 产品 ----------
  const visibleFields=state=>FIELDS.filter(([key])=>settings(state).fields[key].visible);
  // ---------- 角色：字段权限和产品编号权限（要有 role-model.js；没有就当没有限制）----------
  const RM=()=>root.LaiRoleModel||null;
  // 产品字段权限里能设的字段：当前显示着的、不是必填的，不含产品名称和产品编号（编号由“编辑产品编号”两项权限管）。
  // key 就是产品上存的名字；规格存在 specs 里，有规格类型时也能设。
  function roleFieldList(state){
    const config=settings(state).fields;
    const rows=FIELDS.filter(([key])=>!FIXED.includes(key)&&key!=='code'&&config[key].visible&&!config[key].required).map(([key,label,group])=>({key,label,group}));
    if(settings(state).specs.length)rows.push({key:'specs',label:'规格',group:'规格'});
    return rows;
  }
  // 当前账号不能改的产品字段（只读和隐藏）。existing：是改已有的产品，还是新建；产品编号看 product.codeEdit / product.codeNew。
  function lockedKeys(state,existing=true){
    const role=RM();
    if(!role)return new Set();
    const out=new Set(role.lockedFields(state,'product'));
    if(!role.can(state,existing?'product.codeEdit':'product.codeNew'))out.add('code');
    return out;
  }
  // 当前账号看不到的产品字段。
  function hiddenKeys(state){
    const role=RM();
    return new Set(role?role.lockedFields(state,'product').filter(key=>!role.fieldVisible(state,'product',key)):[]);
  }
  // 给订单明细等“拿产品字段用”的地方：看不到的字段清空，免得绕过字段权限。
  function forRole(state,product){
    if(!product)return product;
    const hidden=hiddenKeys(state);
    if(!hidden.size)return product;
    const out={...product};
    for(const key of hidden)if(Object.hasOwn(out,key))out[key]=key==='specs'?[]:'';
    return out;
  }
  function emptyValues(state){
    const values={specs:[]};
    for(const key of FIELD_KEYS)values[key]='';
    return values;
  }
  function cleanSpecs(state,list){
    const known=settings(state).specs;
    const out=[],seen=new Set();
    for(const item of Array.isArray(list)?list:[]){
      const type=trim(item&&item.type),value=trim(item&&item.value);
      if(!type&&!value)continue;
      if(!type||!value)throw new Error('规格要同时选好规格类型和规格值');
      const spec=known.find(s=>s.name===type);
      if(!spec)throw new Error(`规格类型“${type}”不在规格管理里`);
      if(!spec.values.includes(value))throw new Error(`“${type}”里没有规格值“${value}”`);
      const key=type+'\u0001'+value;
      if(seen.has(key))continue;
      seen.add(key);
      out.push({type,value});
    }
    return out;
  }
  function upsert(state,id,input,at=new Date().toISOString()){
    assertReadable(state);
    const config=settings(state).fields;
    const previous=raw(state).find(p=>p.id===id);
    // 角色不能改的字段：保留原来的值（新建就留空），也不检查必填，免得挡住保存。
    const locked=lockedKeys(state,!!previous);
    const next={...(previous||{}),id:id||newId(),updatedAt:at};
    if(!previous)next.createdAt=at;
    for(const [key,label,,type] of FIELDS){
      if(locked.has(key)){next[key]=previous?previous[key]??'':'';continue;}
      if(!config[key].visible){next[key]=previous?trim(previous[key]):'';continue;}
      let value=trim(input[key]);
      if(config[key].required&&!value)throw new Error(`请填写${label}`);
      if(type==='number'&&value){
        if(!/^\d{1,9}(\.\d{1,4})?$/.test(value))throw new Error(`${label}要填数字（不能是负数）`);
      }
      if(type==='group'&&value&&!groupChoices(state).includes(value)&&!(previous&&trim(previous.group)===value))throw new Error(`产品分组“${value}”不在分组名单里`);
      const max=type==='area'?LIMITS.description:LIMITS.text;
      if(value.length>max)throw new Error(`${label}最长 ${max} 个字`);
      next[key]=value;
    }
    if(!trim(next.name))throw new Error('请填写产品名称');
    if(!locked.has('code')&&trim(next.code)&&raw(state).some(p=>p.id!==next.id&&norm(p.code)===norm(next.code)))throw new Error('产品编号已经有了，请换一个');
    next.specs=Object.hasOwn(input,'specs')&&!locked.has('specs')?cleanSpecs(state,input.specs):(previous&&Array.isArray(previous.specs)?previous.specs:[]);
    if(!previous&&raw(state).length>=LIMITS.products)throw new Error(`产品最多 ${LIMITS.products} 个`);
    const list=raw(state);
    return {...state,laiProducts:previous?list.map(p=>p.id===next.id?next:p):[next,...list]};
  }
  function remove(state,id){
    assertReadable(state);
    if(!raw(state).some(p=>p.id===id))throw new Error('产品不存在，可能已被删除，请刷新后重试');
    return {...state,laiProducts:raw(state).filter(p=>p.id!==id)};
  }
  function list(state,filters={}){
    const search=norm(filters.search),group=trim(filters.group),hidden=hiddenKeys(state);
    return raw(state).filter(p=>{
      if(group&&!hidden.has('group')&&!(trim(p.group)===group||trim(p.group).startsWith(group+SEP)))return false;
      if(!search)return true;
      // 看不到的字段不参与搜索，免得搜出它的内容。
      return [['name',p.name],['nameCn',p.nameCn],['code',p.code],['model',p.model],['remark',p.remark]].some(([key,v])=>!hidden.has(key)&&norm(v).includes(search));
    }).sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||''))||trim(a.name).localeCompare(trim(b.name),'zh'));
  }
  const find=(state,id)=>raw(state).find(p=>p.id===id)||null;
  // 订单、报价里选产品时用：产品名称（有中文名就带上）。
  const names=state=>[...new Set(raw(state).map(p=>trim(p.name)).filter(Boolean))];

  // ---------- 布局 ----------
  const defaultLayout=()=>({id:DEFAULT_LAYOUT,name:'默认布局',builtin:true,sections:SECTIONS.map(name=>({name,fields:FIELDS.filter(item=>item[2]===name).map(item=>item[0])}))});
  const layoutList=state=>[defaultLayout(),...settings(state).layouts];
  function layoutById(state,id){return layoutList(state).find(l=>l.id===id)||null;}
  // 角色选了哪个布局：[{roleId,roleName,form,detail}]，只算布局还在的；没有角色模块就是空。
  function roleLayouts(state){
    const role=RM();
    if(!role)return [];
    return role.settings(state).roles.map(r=>({roleId:r.id,roleName:r.name,form:r.layouts?.product?.form||'',detail:r.layouts?.product?.detail||''}))
      .filter(r=>r.form||r.detail);
  }
  // 哪些角色在用这个布局：[{roleId,roleName,places:['新建/编辑产品',…]}]
  function rolesUsing(state,id){
    return roleLayouts(state).map(r=>({roleId:r.roleId,roleName:r.roleName,places:PLACES.filter(([place])=>r[place]===id).map(item=>item[1])})).filter(r=>r.places.length);
  }
  // 新建/编辑实际会用到的布局：默认分配的，加上有角色选了的。
  function formLayoutIds(state){
    return [...new Set([settings(state).layoutUse.form,...roleLayouts(state).map(r=>r.form).filter(Boolean)])];
  }
  // 当前账号在这个位置用的布局：角色选了并且布局还在就用它，不然用“产品 → 布局”里的默认分配。
  function layoutForPlace(state,place){
    const role=RM();
    const mine=role&&role.productLayoutOf?role.productLayoutOf(state)[place]:'';
    return (mine&&layoutById(state,mine))||layoutById(state,settings(state).layoutUse[place])||defaultLayout();
  }
  const placeLabel=place=>(PLACES.find(item=>item[0]===place)||[place,place])[1];
  const placesOf=(state,id)=>PLACES.filter(([place])=>settings(state).layoutUse[place]===id).map(item=>item[1]);
  function cleanLabel(value,label){
    const name=trim(value).replace(/\s+/g,' ');
    if(!name)throw new Error(`请填写${label}`);
    if(name.length>LIMITS.name)throw new Error(`${label}最长 ${LIMITS.name} 个字`);
    return name;
  }
  // 新建/编辑用的布局不能藏起必填字段，不然保存时填不了。
  function assertFormLayout(state,layout){
    const config=settings(state).fields;
    for(const [key,label] of FIELDS)
      if(config[key].required&&!layout.sections.some(sec=>sec.fields.includes(key)))throw new Error(`“${label}”是必填字段，新建/编辑用的布局里不能隐藏`);
  }
  function editLayout(state,id,change){
    const s=settings(state);
    const layout=s.layouts.find(l=>l.id===id);
    if(!layout)throw new Error(id===DEFAULT_LAYOUT?'默认布局不能改，请先复制为新布局':'没有找到这个布局');
    const copy={...layout,sections:layout.sections.map(sec=>({...sec,fields:sec.fields.slice()}))};
    change(copy);
    if(formLayoutIds(state).includes(id))assertFormLayout(state,copy);
    return put(state,{layouts:s.layouts.map(l=>l.id===id?copy:l)});
  }
  // 从已有布局（默认是「默认布局」）复制出一个新的可编辑布局。
  function addLayout(state,{name,fromId=DEFAULT_LAYOUT,id}={}){
    const s=settings(state);
    const value=cleanLabel(name,'布局名称');
    const from=layoutById(state,fromId);
    if(!from)throw new Error('没有找到要复制的布局');
    if(layoutList(state).some(l=>norm(l.name)===norm(value)))throw new Error('已有同名布局');
    if(s.layouts.length>=LIMITS.layouts)throw new Error(`布局最多 ${LIMITS.layouts} 个`);
    const layout={id:trim(id)||newId(),name:value,sections:from.sections.map(sec=>({name:sec.name,fields:sec.fields.slice()}))};
    return put(state,{layouts:[...s.layouts,layout]});
  }
  function suggestLayoutName(state,base){
    const names=new Set(layoutList(state).map(l=>norm(l.name)));
    const stem=trim(base).slice(0,LIMITS.name-4);
    for(let i=1;i<100;i++){const name=`${stem} 副本${i>1?i:''}`;if(!names.has(norm(name)))return name;}
    return `${stem} 副本`;
  }
  function renameLayout(state,id,name){
    if(id===DEFAULT_LAYOUT)throw new Error('默认布局不能改名');
    const value=cleanLabel(name,'布局名称');
    if(layoutList(state).some(l=>l.id!==id&&norm(l.name)===norm(value)))throw new Error('已有同名布局');
    return editLayout(state,id,l=>{l.name=value;});
  }
  function deleteLayout(state,id){
    if(id===DEFAULT_LAYOUT)throw new Error('默认布局不能删除');
    const layout=settings(state).layouts.find(l=>l.id===id);
    if(!layout)throw new Error('没有找到这个布局');
    const places=placesOf(state,id);
    if(places.length)throw new Error(`“${layout.name}”正在用于${places.join('、')}，先把用到它的地方换成别的布局`);
    const roles=rolesUsing(state,id);
    if(roles.length)throw new Error(`角色“${roles.map(r=>r.roleName).join('”“')}”正在用这个布局，先到角色里换成别的布局`);
    return put(state,{layouts:settings(state).layouts.filter(l=>l.id!==id)});
  }
  function setLayoutUse(state,place,layoutId){
    if(!PLACES.some(item=>item[0]===place))throw new Error('没有这个位置');
    const layout=layoutById(state,layoutId);
    if(!layout)throw new Error('没有找到这个布局');
    if(place==='form')assertFormLayout(state,layout);
    return put(state,{layoutUse:{...settings(state).layoutUse,[place]:layoutId}});
  }
  // 给角色选产品布局前检查：布局要还在；新建/编辑用的布局不能藏起必填字段。出错时抛出提示。
  function checkRoleLayout(state,place,layoutId){
    if(!PLACES.some(item=>item[0]===place))throw new Error('没有这个位置');
    if(!layoutId)return true;
    const layout=layoutById(state,layoutId);
    if(!layout)throw new Error('没有找到这个布局');
    if(place==='form')assertFormLayout(state,layout);
    return true;
  }
  const secAt=(layout,index)=>{
    const sec=layout.sections[index];
    if(!sec)throw new Error('没有找到这个信息区');
    return sec;
  };
  function renameSection(state,layoutId,index,name){
    const value=cleanLabel(name,'信息区名称');
    return editLayout(state,layoutId,l=>{
      secAt(l,index);
      if(l.sections.some((sec,i)=>i!==index&&norm(sec.name)===norm(value)))throw new Error('这个布局里已有同名信息区');
      l.sections[index].name=value;
    });
  }
  function moveSection(state,layoutId,index,delta){
    return editLayout(state,layoutId,l=>{
      secAt(l,index);
      const to=index+(delta<0?-1:1);
      if(to<0||to>=l.sections.length)return;
      [l.sections[index],l.sections[to]]=[l.sections[to],l.sections[index]];
    });
  }
  const where=(layout,key)=>{
    for(const [i,sec] of layout.sections.entries()){const j=sec.fields.indexOf(key);if(j>=0)return {i,j};}
    return null;
  };
  function moveLayoutField(state,layoutId,key,delta){
    return editLayout(state,layoutId,l=>{
      const at=where(l,key);
      if(!at)throw new Error('这个字段在布局里是隐藏的');
      const arr=l.sections[at.i].fields,to=at.j+(delta<0?-1:1);
      if(to<0||to>=arr.length)return;
      [arr[at.j],arr[to]]=[arr[to],arr[at.j]];
    });
  }
  function moveFieldToSection(state,layoutId,key,sectionIndex){
    return editLayout(state,layoutId,l=>{
      const at=where(l,key);
      if(!at)throw new Error('这个字段在布局里是隐藏的');
      const target=secAt(l,sectionIndex);
      if(at.i===sectionIndex)return;
      l.sections[at.i].fields.splice(at.j,1);
      target.fields.push(key);
    });
  }
  function hideLayoutField(state,layoutId,key){
    if(!FIELD_KEYS.includes(key))throw new Error('没有这个字段');
    if(FIXED.includes(key))throw new Error(`“${labelOf(key)}”一定显示，不能隐藏`);
    return editLayout(state,layoutId,l=>{
      const at=where(l,key);
      if(at)l.sections[at.i].fields.splice(at.j,1);
    });
  }
  function showLayoutField(state,layoutId,key,sectionIndex=0){
    if(!FIELD_KEYS.includes(key))throw new Error('没有这个字段');
    return editLayout(state,layoutId,l=>{
      const target=secAt(l,sectionIndex);
      if(!where(l,key))target.fields.push(key);
    });
  }
  // 按布局排好的信息区；产品字段里整体隐藏的字段不出现；空的信息区不出现。
  function sectionsFor(state,place){
    const s=settings(state);
    const layout=layoutForPlace(state,place);
    const hidden=hiddenKeys(state);
    const field=key=>FIELDS.find(item=>item[0]===key);
    const out=layout.sections.map(sec=>({name:sec.name,fields:sec.fields.filter(key=>s.fields[key].visible&&!hidden.has(key)).map(field)})).filter(sec=>sec.fields.length);
    if(place==='form'){
      const shown=new Set(out.flatMap(sec=>sec.fields.map(item=>item[0])));
      const missing=FIELD_KEYS.filter(key=>s.fields[key].visible&&s.fields[key].required&&!hidden.has(key)&&!shown.has(key)).map(field);
      if(missing.length)out.push({name:'其他',fields:missing});
    }
    return out;
  }
  const formSections=state=>sectionsFor(state,'form');
  const detailSections=state=>sectionsFor(state,'detail');

  // ---------- 从表格同步 ----------
  const SYNC_MODES=Object.freeze([['code','按产品编号匹配：有就更新，没有就新建'],['new','全部新建']]);
  const SYNC_SOURCE='表格文件';
  const NUMBER=/^\d{1,9}(\.\d{1,4})?$/;
  const bare=text=>norm(text).replace(/[（(].*?[）)]/g,'').trim();
  const taskId=()=>`s${newId()}`;
  const syncTasks=state=>Array.isArray(state&&state.laiProductSyncTasks)?state.laiProductSyncTasks:[];
  const undoableTask=state=>syncTasks(state).find(t=>t.status!=='已撤销')||null;
  function assertSyncReadable(state){
    assertReadable(state);
    if(state&&state.laiProductSyncTasks!==undefined&&state.laiProductSyncTasks!==null&&!Array.isArray(state.laiProductSyncTasks))throw new Error('已保存的导入记录格式异常，为避免覆盖，未做任何修改');
  }
  // 模板的表头：所有显示着的产品字段。
  // 角色不能改的字段（编号除外，同步要靠它对上）不在模板里。
  const templateHeaders=state=>{
    const locked=lockedKeys(state,false);
    const hidden=hiddenKeys(state);
    return visibleFields(state).filter(([key])=>!hidden.has(key)&&(key==='code'||!locked.has(key))).map(item=>item[1]);
  };
  // 把表格（表头 + 每行的格子）按字段名称对上产品字段。隐藏的字段、认不得的列都不用。
  function readTable(state,headers,rows,lineNumbers){
    const config=settings(state).fields;
    const roleHidden=hiddenKeys(state);
    const lookup=new Map();
    for(const [key,label] of FIELDS){lookup.set(norm(label),key);if(!lookup.has(bare(label)))lookup.set(bare(label),key);lookup.set(norm(key),key);}
    const cols=[],ignored=[],hidden=[],seen=new Set();
    (headers||[]).forEach((head,index)=>{
      const text=trim(head);
      if(!text)return;
      const key=lookup.get(norm(text))||lookup.get(bare(text));
      if(!key||roleHidden.has(key)){ignored.push(text);return;}
      if(!config[key].visible){hidden.push(labelOf(key));return;}
      if(seen.has(key)){ignored.push(text);return;}
      seen.add(key);cols.push([key,index]);
    });
    if(!cols.length)throw new Error('表头里没有认得的产品字段，请下载模板，按模板的表头填');
    const records=[];
    (rows||[]).forEach((row,index)=>{
      const values={};
      for(const [key,at] of cols)values[key]=trim(row[at]);
      if(!Object.values(values).some(Boolean))return;
      records.push({line:(lineNumbers&&lineNumbers[index])||index+2,values});
    });
    if(records.length>LIMITS.syncRows)throw new Error(`一次最多导入 ${LIMITS.syncRows} 行，这个文件有 ${records.length} 行`);
    if(!records.length)throw new Error('文件里没有产品数据');
    return {records,columns:cols.map(c=>c[0]),ignored,hidden};
  }
  const asRecord=(row,index)=>row&&row.values&&typeof row.values==='object'?{line:row.line||index+2,values:row.values}:{line:index+2,values:row||{}};
  // 先算一遍每行会怎样（预览和真正同步用同一份计算）：new 新建、update 更新、skip 跳过。
  function planSync(state,records,{mode='code'}={}){
    assertSyncReadable(state);
    const list=(Array.isArray(records)?records:[]).map(asRecord);
    if(list.length>LIMITS.syncRows)throw new Error(`一次最多导入 ${LIMITS.syncRows} 行，这个文件有 ${list.length} 行`);
    const byMode=mode==='new'?'new':'code';
    const config=settings(state).fields,groups=groupChoices(state);
    // 角色不能改的字段：新建的产品不能填，更新时不改；编号只在新建时看“编辑产品编号（新建产品）”，更新从来不改编号。
    const lockedNew=lockedKeys(state,false),lockedOld=lockedKeys(state,true);
    const existing=raw(state);
    const byCode=new Map();
    for(const p of existing)if(trim(p.code)&&!byCode.has(norm(p.code)))byCode.set(norm(p.code),p);
    const fileCodes=new Map();
    let room=LIMITS.products-existing.length;
    const rows=[];
    for(const rec of list){
      const values={},warnings=[];
      let reason='';
      const skip=why=>{reason=reason||why;};
      for(const [key,label,,type] of FIELDS){
        if(!config[key].visible)continue;
        let v=trim(rec.values[key]);
        if(!v)continue;
        if(type==='number'){
          v=v.replace(/,/g,'');
          if(!NUMBER.test(v)){skip(`${label}的数字格式不对`);continue;}
        }else if(type==='group'){
          v=v.replace(/\s*[/／]\s*/g,SEP);
          if(!groups.includes(v)){warnings.push(`分组“${v}”不在名单里，已留空`);continue;}
        }
        if(v.length>(type==='area'?LIMITS.description:LIMITS.text)){skip(`${label}太长`);continue;}
        values[key]=v;
      }
      const code=trim(values.code),codeKey=norm(code);
      let target=null;
      if(!reason&&code){
        if(fileCodes.has(codeKey))skip(`产品编号和第 ${fileCodes.get(codeKey)} 行重复`);
        else if(byCode.has(codeKey)){
          if(byMode==='code')target=byCode.get(codeKey);else skip('产品编号已经有了');
        }
      }
      const drop=target?lockedOld:lockedNew;
      const dropped=Object.keys(values).filter(key=>drop.has(key)&&!(target&&key==='code'));
      for(const key of dropped)delete values[key];
      if(dropped.length)warnings.push(`${dropped.map(labelOf).map(name=>`“${name}”`).join('')}你没有权限修改，已忽略`);
      const merged={...(target||{}),...values};
      let changes=Object.keys(values);
      if(!reason)for(const [key,label] of FIELDS){
        if(config[key].required&&!trim(merged[key])&&!drop.has(key)){skip(key==='name'?'缺产品名称':`缺少“${label}”`);break;}
      }
      if(!reason&&target){
        changes=changes.filter(key=>key!=='code'&&values[key]!==trim(target[key]));
        if(!changes.length)skip('内容没变');
      }
      if(!reason&&!target&&room<=0)skip(`产品最多 ${LIMITS.products} 个`);
      const status=reason?'skip':target?'update':'new';
      if(status==='new')room--;
      if(status!=='skip'&&code)fileCodes.set(codeKey,rec.line);
      const notes=status==='update'?warnings.map(w=>w.replace('已留空','没有改分组')):warnings;
      rows.push({line:rec.line,status,reason,warnings:notes,values,changes,id:target?target.id:'',name:trim(merged.name),code:trim(merged.code)});
    }
    const count=status=>rows.filter(r=>r.status===status).length;
    return {rows,counts:{total:rows.length,new:count('new'),update:count('update'),skip:count('skip')}};
  }
  // 真正同步：返回新的 state 和这次的任务记录（记着新建了哪些、更新前的样子，用来撤销）。
  function syncProducts(state,rows,{mode='code',fileName='',at=new Date().toISOString()}={}){
    const plan=planSync(state,rows,{mode});
    if(!plan.counts.new&&!plan.counts.update)throw new Error('没有能导入的产品，看看预览里每行为什么被跳过');
    const list=raw(state).slice();
    const index=new Map(list.map((p,i)=>[p.id,i]));
    const before={},createdIds=[],fresh=[];
    for(const row of plan.rows){
      if(row.status==='new'){
        const product={id:newId(),createdAt:at,updatedAt:at,specs:[]};
        for(const key of FIELD_KEYS)product[key]='';
        Object.assign(product,row.values);
        fresh.push(product);createdIds.push(product.id);
      }else if(row.status==='update'){
        const pos=index.get(row.id),prev=list[pos];
        before[row.id]=JSON.parse(JSON.stringify(prev));
        const next={...prev,updatedAt:at};
        for(const key of row.changes)next[key]=row.values[key];
        list[pos]=next;
      }
    }
    const task={id:taskId(),name:trim(fileName).slice(0,100)||SYNC_SOURCE,at,status:'已完成',total:plan.counts.total,created:plan.counts.new,updated:plan.counts.update,skipped:plan.counts.skip,source:SYNC_SOURCE,createdIds,before};
    return {state:{...state,laiProducts:[...fresh,...list],laiProductSyncTasks:[task,...syncTasks(state)].slice(0,LIMITS.syncTasks)},task,plan};
  }
  // 撤销最近一次同步：新建的删掉，更新的还原；同步之后又改过的产品不动，只报个数。
  function undoSync(state,id,at=new Date().toISOString()){
    assertSyncReadable(state);
    const tasks=syncTasks(state);
    const task=tasks.find(t=>t.id===id);
    if(!task)throw new Error('没有找到这次导入');
    if(task.status==='已撤销')throw new Error('这次导入已经撤销过了');
    if(undoableTask(state).id!==task.id)throw new Error('只能撤销最近一次导入，请先撤销它后面的导入');
    const created=new Set(task.createdIds||[]),before=task.before||{};
    let removed=0,restored=0,kept=0;
    const list=[];
    for(const p of raw(state)){
      if(created.has(p.id)){if(p.updatedAt===task.at){removed++;continue;}kept++;list.push(p);continue;}
      if(Object.hasOwn(before,p.id)){if(p.updatedAt===task.at){restored++;list.push(before[p.id]);continue;}kept++;}
      list.push(p);
    }
    const done={...task,status:'已撤销',undoneAt:at,createdIds:[],before:{},result:{removed,restored,kept}};
    return {state:{...state,laiProducts:list,laiProductSyncTasks:tasks.map(t=>t.id===task.id?done:t)},task:done,result:done.result};
  }

  const api={LIMITS,SEP,SECTIONS,FIELDS,FIXED,roleFieldList,lockedKeys,hiddenKeys,forRole,roleLayouts,rolesUsing,layoutForPlace,checkRoleLayout,labelOf,typeOf,settings,setField,addGroup,renameGroup,moveGroup,deleteGroup,groupChoices,groupUse,
    addSpec,renameSpec,deleteSpec,addSpecValue,removeSpecValue,specUse,visibleFields,emptyValues,upsert,remove,list,find,names,
    PLACES,DEFAULT_LAYOUT,layoutList,layoutById,placeLabel,placesOf,addLayout,suggestLayoutName,renameLayout,deleteLayout,setLayoutUse,renameSection,moveSection,moveLayoutField,moveFieldToSection,hideLayoutField,showLayoutField,formSections,detailSections,
    SYNC_MODES,SYNC_SOURCE,syncTasks,undoableTask,templateHeaders,readTable,planSync,syncProducts,undoSync};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LaiProductModel=api;
})(typeof window!=='undefined'?window:globalThis);
