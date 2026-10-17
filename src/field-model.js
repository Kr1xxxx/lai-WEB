(function(root){
  'use strict';
  // 通用的自定义字段（客户、订单共用；线索已去掉，存着的 fieldSettings.lead 写入时原样保留）。设置存在 state.laiSettings.fieldSettings[实体]：
  // {customFields:[{id,name,type,options,required}], required:{系统字段ID:true}}。值存在记录的 custom[字段ID] 里。
  // 每个函数返回新的 state，不自己保存；读到的坏数据安全丢弃，写入前格式异常则拒绝，避免覆盖。
  const node=typeof module!=='undefined'&&module.exports;
  const ENTITIES=Object.freeze(['customer','order']);
  const TYPES=Object.freeze([['text','文本'],['textarea','多行文本'],['number','数字'],['date','日期'],['select','单选'],['multi','多选']]);
  const LIMIT=30;
  const LIMITS=Object.freeze({fields:LIMIT,options:50,nameLen:30,optionLen:40,text:200,textarea:2000});
  const trim=value=>String(value??'').trim();
  const cleanName=value=>trim(value).normalize('NFKC').replace(/[​-‍⁠﻿]/g,'').replace(/\s+/g,' ').trim();
  const key=value=>cleanName(value).toLowerCase();
  const sameName=(a,b)=>key(a)===key(b);
  const textLength=text=>[...new Intl.Segmenter().segment(text)].length;
  const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  const typeLabel=type=>TYPES.find(item=>item[0]===type)?.[1]||type;
  const isChoice=type=>type==='select'||type==='multi';
  function entityOf(entity){if(!ENTITIES.includes(entity))throw new Error('字段所属对象无效');return entity;}

  // 去空、去重（不区分大小写）的名单。
  function cleanList(value){
    const seen=new Set(),out=[];
    for(const entry of Array.isArray(value)?value:[]){const text=typeof entry==='string'?cleanName(entry):'';if(text&&!seen.has(key(text))){seen.add(key(text));out.push(text);}}
    return out;
  }
  function readField(entry){
    if(!entry||typeof entry!=='object'||typeof entry.id!=='string'||!entry.id.trim())return null;
    const type=TYPES.find(item=>item[0]===entry.type)?.[0],name=cleanName(entry.name);
    if(!type||!name)return null;
    return {id:entry.id,name,type,options:isChoice(type)?cleanList(entry.options):[],required:entry.required===true};
  }
  const rawSettings=(state,entity)=>plain(plain(state?.laiSettings?.fieldSettings)[entity]);
  function get(state,entity){
    entityOf(entity);
    const raw=rawSettings(state,entity),seen=new Set(),customFields=[];
    for(const entry of Array.isArray(raw.customFields)?raw.customFields:[]){const field=readField(entry);if(field&&!seen.has(field.id)){seen.add(field.id);customFields.push(field);}}
    const required={};
    for(const [id,on] of Object.entries(plain(raw.required)))if(on===true)required[id]=true;
    return {customFields,required};
  }
  // 保存：读得懂的字段写回（保留原条目里不认识的内容），读不懂的条目原样接在后面。
  function put(state,entity,fields,required){
    const outer=state?.laiSettings,all=outer?.fieldSettings;
    if(outer!==undefined&&outer!==null&&(typeof outer!=='object'||Array.isArray(outer)))throw new Error('已保存的设置格式异常，为避免覆盖，未做任何修改');
    if(all!==undefined&&all!==null&&(typeof all!=='object'||Array.isArray(all)))throw new Error('已保存的字段设置格式异常，为避免覆盖，未做任何修改');
    const current=plain(all)[entity];
    if(current!==undefined&&current!==null&&(typeof current!=='object'||Array.isArray(current)))throw new Error('已保存的字段设置格式异常，为避免覆盖，未做任何修改');
    const raws=Array.isArray(plain(current).customFields)?current.customFields:[],byId=new Map(),used=new Set();
    for(const entry of raws)if(readField(entry)&&!byId.has(entry.id)){byId.set(entry.id,entry);used.add(entry);}
    const leftovers=raws.filter(entry=>!used.has(entry));
    const next={...plain(current),customFields:[...fields.map(f=>({...(byId.get(f.id)||{}),id:f.id,name:f.name,type:f.type,options:f.options,required:f.required})),...leftovers],required};
    return {...state,laiSettings:{...(outer||{}),fieldSettings:{...(all||{}),[entity]:next}}};
  }
  const save=(state,entity,patch)=>{const cur=get(state,entity);return put(state,entity,patch.customFields||cur.customFields,patch.required||cur.required);};

  function validName(settings,value,exceptId='',reserved=[]){
    const text=cleanName(value);
    if(!text)throw new Error('请填写字段名称');
    if(textLength(text)>LIMITS.nameLen)throw new Error(`字段名称不能超过 ${LIMITS.nameLen} 个字`);
    if(settings.customFields.some(f=>f.id!==exceptId&&sameName(f.name,text))||(Array.isArray(reserved)&&reserved.some(label=>sameName(label,text))))throw new Error('已经有同名的字段');
    return text;
  }
  function validOptions(value){
    const options=cleanList(Array.isArray(value)?value:String(value??'').split(/[\n,，、;；]/));
    if(!options.length)throw new Error('请至少填写一个选项');
    if(options.length>LIMITS.options)throw new Error(`一个字段最多 ${LIMITS.options} 个选项`);
    if(options.some(o=>textLength(o)>LIMITS.optionLen))throw new Error(`每个选项不能超过 ${LIMITS.optionLen} 个字`);
    return options;
  }
  const truthy=value=>value===true||value==='on'||value==='1'||value==='true';
  const newId=taken=>{let id;do{id='c'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);}while(taken.has(id));return id;};
  function requireField(settings,id){
    const field=settings.customFields.find(f=>f.id===id);
    if(!field)throw new Error('字段不存在，可能已被删除');
    return field;
  }

  // options.reserved：该对象自带字段的名称，自定义字段不能重名；options.id：指定字段ID（测试用）。
  function addField(state,entity,input={},options={}){
    const settings=get(state,entity);
    if(settings.customFields.length>=LIMIT)throw new Error(`最多添加 ${LIMIT} 个自定义字段`);
    const name=validName(settings,input.name,'',options.reserved);
    const type=TYPES.find(item=>item[0]===trim(input.type))?.[0];
    if(!type)throw new Error('请选择字段类型');
    const id=trim(options.id)||newId(new Set(settings.customFields.map(f=>f.id)));
    if(settings.customFields.some(f=>f.id===id))throw new Error('这个字段已经存在');
    const field={id,name,type,options:isChoice(type)?validOptions(input.options):[],required:truthy(input.required)};
    return save(state,entity,{customFields:[...settings.customFields,field]});
  }
  // 只能改名称；类型建好后不能改（见 changeType）。
  function renameField(state,entity,id,value,options={}){
    const settings=get(state,entity);requireField(settings,id);
    const name=validName(settings,value,id,options.reserved);
    return save(state,entity,{customFields:settings.customFields.map(f=>f.id===id?{...f,name}:f)});
  }
  // 类型建好后不能改：传不同的类型就拒绝，相同则原样返回。
  function changeType(state,entity,id,type){
    const field=requireField(get(state,entity),id);
    if(trim(type)!==field.type)throw new Error('字段类型建好后不能修改');
    return state;
  }
  function moveField(state,entity,id,direction){
    const fields=get(state,entity).customFields,index=fields.findIndex(f=>f.id===id),other=index+(direction<0?-1:1);
    if(index<0)throw new Error('字段不存在，可能已被删除');
    if(other<0||other>=fields.length)throw new Error(direction<0?'已经是第一个了':'已经是最后一个了');
    const next=[...fields];next[index]=fields[other];next[other]=fields[index];
    return save(state,entity,{customFields:next});
  }
  // 只从设置里去掉；记录里已填的值原样留着，只是不再显示。
  function deleteField(state,entity,id){
    const settings=get(state,entity);requireField(settings,id);
    return save(state,entity,{customFields:settings.customFields.filter(f=>f.id!==id)});
  }
  // 选项可加、排序、删除；不支持改名（已存的值仍按原文保留）。
  function setOptions(state,entity,id,value){
    const settings=get(state,entity),field=requireField(settings,id);
    if(!isChoice(field.type))throw new Error('这个类型的字段没有选项');
    const options=validOptions(value);
    return save(state,entity,{customFields:settings.customFields.map(f=>f.id===id?{...f,options}:f)});
  }
  function setRequired(state,entity,id,on){
    const settings=get(state,entity);requireField(settings,id);
    return save(state,entity,{customFields:settings.customFields.map(f=>f.id===id?{...f,required:truthy(on)}:f)});
  }
  // lockedBy：把这个字段设为只读或隐藏的角色名；有的话不能设为必填。取消必填永远允许。
  function setSystemRequired(state,entity,systemId,on,{lockedBy=[]}={}){
    const settings=get(state,entity),id=trim(systemId);
    if(!id)throw new Error('字段无效');
    const required={...settings.required};
    if(truthy(on)){
      const roles=(Array.isArray(lockedBy)?lockedBy:[]).map(trim).filter(Boolean);
      if(roles.length)throw new Error(`角色「${roles[0]}」把这个字段设为只读或隐藏，不能同时必填`);
      required[id]=true;
    }else delete required[id];
    return save(state,entity,{required});
  }

  // ---------- 值 ----------
  const hasValue=value=>Array.isArray(value)?value.length>0:value!==undefined&&value!==null&&trim(value)!=='';
  function validDate(value){
    const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(trim(value));
    if(!m)return false;
    const d=new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3])));
    return d.getUTCFullYear()===Number(m[1])&&d.getUTCMonth()===Number(m[2])-1&&d.getUTCDate()===Number(m[3]);
  }
  // 整理表单传来的值；空值返回 undefined。选项以外的值只有「本来就存着」才放行。
  function cleanValue(field,raw,previous){
    const label=`“${field.name}”`;
    if(field.type==='multi'){
      const picked=cleanList(Array.isArray(raw)?raw.map(String):String(raw??'').split(/[\n,，、;；]/)),before=Array.isArray(previous)?previous:[];
      for(const item of picked)if(!field.options.some(o=>sameName(o,item))&&!before.some(e=>sameName(e,item)))throw new Error(`${label}的选项“${item}”不在选项里`);
      const canon=picked.map(item=>field.options.find(o=>sameName(o,item))||item);
      return canon.length?canon:undefined;
    }
    const text=Array.isArray(raw)?'':trim(raw);
    if(!text)return undefined;
    if(field.type==='number'){
      // 存着的数字原样放行：很小或很大的数会显示成 1e-7 这类写法，再保存时不能因此被拦。
      if(typeof raw==='number'&&Number.isFinite(raw)&&Math.abs(raw)<=1e15)return raw;
      if(typeof previous==='number'&&Number.isFinite(previous)&&String(previous)===text)return previous;
      const t=text.replace(/^\+/,'');
      if(!/^-?\d+(\.\d+)?$/.test(t)||Math.abs(Number(t))>1e15)throw new Error(`${label}请填写数字（不要带逗号或符号）`);
      return Number(t);
    }
    if(field.type==='date'){if(!validDate(text))throw new Error(`${label}请选择有效的日期`);return text;}
    if(field.type==='select'){
      const hit=field.options.find(o=>sameName(o,text));
      if(!hit&&trim(previous)!==text)throw new Error(`${label}的选项“${text}”不在选项里`);
      return hit||text;
    }
    const max=field.type==='textarea'?LIMITS.textarea:LIMITS.text;
    if(textLength(text)>max)throw new Error(`${label}不能超过 ${max} 个字`);
    return text;
  }
  // 必填检查，返回缺少的字段名称。values：自定义字段值；systemValues：系统字段值；
  // editable(id)：这个账号能否改（只读或隐藏的不算）；systemLabels：系统字段ID到名称。
  // 编辑旧记录时传 previous / previousSystem（保存前的值）和 touched（本次改过的字段ID）：
  // 旧记录里本来就空、这次也没碰的字段不拦。新建时不传 previous，全部要填。
  function missingRequired(settings,values={},{systemValues={},editable=()=>true,previous,previousSystem,touched,systemLabels={}}={}){
    const hadBefore=previous!==undefined||previousSystem!==undefined,touchedSet=touched instanceof Set?touched:new Set(touched||[]);
    const skip=(id,old)=>hadBefore&&!hasValue(old)&&!touchedSet.has(id);
    const out=[];
    for(const field of settings?.customFields||[]){
      if(!field.required||!editable(field.id)||hasValue(plain(values)[field.id]))continue;
      if(skip(field.id,plain(previous)[field.id]))continue;
      out.push(field.name);
    }
    for(const id of Object.keys(plain(settings?.required))){
      if(!settings.required[id]||!editable(id)||hasValue(plain(systemValues)[id]))continue;
      if(skip(id,plain(previousSystem)[id]))continue;
      out.push(systemLabels[id]||id);
    }
    return out;
  }
  function formatValue(field,value){
    if(!hasValue(value))return '';
    if(Array.isArray(value))return value.map(String).join('、');
    return String(value);
  }
  // 有多少条记录在这个字段上填了值。records：数组或以名称为键的对象。
  const usage=(records,id)=>(Array.isArray(records)?records:Object.values(plain(records))).filter(r=>r&&typeof r==='object'&&hasValue(plain(r.custom)[id])).length;

  const api={ENTITIES,TYPES,LIMIT,LIMITS,typeLabel,sameName,get,addField,renameField,changeType,moveField,deleteField,setOptions,setRequired,setSystemRequired,cleanValue,missingRequired,formatValue,hasValue,usage};
  if(node)module.exports=api;else root.LaiFieldModel=api;
})(typeof window!=='undefined'?window:globalThis);
