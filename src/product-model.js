(function(root){
  'use strict';
  // 产品库和产品设置（分组、字段、规格）。纯函数：输入 state，返回新的 state，不碰界面，也不自己保存。
  // 产品存在 state.laiProducts（数组）；设置存在 state.laiSettings.productSettings。
  const trim=value=>String(value??'').trim();
  const norm=value=>trim(value).toLowerCase();
  const SEP=' / ';
  const LIMITS=Object.freeze({products:5000,groups:100,children:30,specs:50,values:100,name:20,text:500,description:2000});
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
  function readSettings(raw){
    const stored=raw&&typeof raw==='object'?raw:{};
    const fields={};
    for(const key of FIELD_KEYS){
      const one=stored.fields&&stored.fields[key]||{};
      const fixed=FIXED.includes(key);
      const visible=fixed||one.visible!==false;
      fields[key]={visible,required:fixed||(visible&&one.required===true)};
    }
    return {groups:normalizeGroups(stored.groups),specs:normalizeSpecs(stored.specs),fields};
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
    const next={...(previous||{}),id:id||newId(),updatedAt:at};
    if(!previous)next.createdAt=at;
    for(const [key,label,,type] of FIELDS){
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
    if(trim(next.code)&&raw(state).some(p=>p.id!==next.id&&norm(p.code)===norm(next.code)))throw new Error('产品编号已经有了，请换一个');
    next.specs=Object.hasOwn(input,'specs')?cleanSpecs(state,input.specs):(previous&&Array.isArray(previous.specs)?previous.specs:[]);
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
    const search=norm(filters.search),group=trim(filters.group);
    return raw(state).filter(p=>{
      if(group&&!(trim(p.group)===group||trim(p.group).startsWith(group+SEP)))return false;
      if(!search)return true;
      return [p.name,p.nameCn,p.code,p.model,p.remark].some(v=>norm(v).includes(search));
    }).sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||''))||trim(a.name).localeCompare(trim(b.name),'zh'));
  }
  const find=(state,id)=>raw(state).find(p=>p.id===id)||null;
  // 订单、报价里选产品时用：产品名称（有中文名就带上）。
  const names=state=>[...new Set(raw(state).map(p=>trim(p.name)).filter(Boolean))];

  const api={LIMITS,SEP,SECTIONS,FIELDS,FIXED,labelOf,typeOf,settings,setField,addGroup,renameGroup,moveGroup,deleteGroup,groupChoices,groupUse,
    addSpec,renameSpec,deleteSpec,addSpecValue,removeSpecValue,specUse,visibleFields,emptyValues,upsert,remove,list,find,names};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.LaiProductModel=api;
})(typeof window!=='undefined'?window:globalThis);
