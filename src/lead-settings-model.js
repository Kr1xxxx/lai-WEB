(function(root){
  'use strict';
  // 线索设置（线索 → 设置）：无效原因名单、线索表单里每个字段显不显示、必不必填。
  // 保存在 laiSettings.leadSettings = {reasons:[名称…], fields:{字段:{show,required}}}；没有这份设置时用默认值（六个无效原因、字段都显示、都不必填）。
  // 不做：线索公海／自动分配、改线索状态（见 VALIDATION.md）。
  const node=typeof module!=='undefined'&&module.exports;
  const trim=value=>String(value??'').trim();
  const norm=value=>trim(value).normalize('NFKC').replace(/\s+/g,' ').toLowerCase();
  const DEFAULT_REASONS=Object.freeze(['无法联系','没有需求','预算不符','重复线索','同行或广告','其他']);
  const LIMITS=Object.freeze({reasons:30,name:40});
  // 线索名称固定必填，不在清单里。键就是线索上保存的字段名。
  const FIELDS=Object.freeze([['contact','联系人'],['email','邮箱'],['phone','电话'],['country','国家地区'],['source','线索来源'],['website','网址'],['product','意向产品'],['note','备注'],['nextFollow','下次跟进']]
    .map(([id,label])=>Object.freeze({id,label})));
  const fieldDef=id=>FIELDS.find(field=>field.id===id);
  const RM=()=>node?require('./role-model.js'):root.LaiRoleModel;

  const stored=state=>{const value=state?.laiSettings?.leadSettings;return value&&typeof value==='object'&&!Array.isArray(value)?value:{};};
  function cleanReasons(list){
    const out=[],seen=new Set();
    for(const item of Array.isArray(list)?list:[]){
      const name=trim(item);
      if(!name||name.length>LIMITS.name||seen.has(norm(name)))continue;
      seen.add(norm(name));out.push(name);
      if(out.length>=LIMITS.reasons)break;
    }
    return out;
  }
  // 当前设置（已整理）。
  function get(state){
    const raw=stored(state);
    const reasons=cleanReasons(raw.reasons);
    const fields={};
    for(const {id} of FIELDS){
      const item=raw.fields&&typeof raw.fields==='object'?raw.fields[id]:null;
      const show=item?.show!==false;
      fields[id]={show,required:show&&item?.required===true};
    }
    return {reasons:reasons.length?reasons:[...DEFAULT_REASONS],fields};
  }
  const reasonsOf=state=>get(state).reasons;
  function write(state,next){
    const fields={};
    for(const {id} of FIELDS){const item=next.fields[id];if(!item.show||item.required)fields[id]={show:item.show,required:item.required};}
    return {...state,laiSettings:{...(state?.laiSettings||{}),leadSettings:{reasons:[...next.reasons],fields}}};
  }
  const leadsOf=state=>Array.isArray(state?.laiLeads)?state.laiLeads.filter(item=>item&&typeof item==='object'):[];
  // 有几条线索（含回收站里的）用了这个无效原因。
  const reasonUse=(state,name)=>leadsOf(state).filter(item=>item.invalidReason===name).length;
  const reasonRows=state=>reasonsOf(state).map(name=>({name,count:reasonUse(state,name)}));
  function checkName(value){
    const name=trim(value).normalize('NFKC').replace(/\s+/g,' ').trim();
    if(!name)throw new Error('请填写无效原因');
    if(name.length>LIMITS.name)throw new Error(`无效原因最多 ${LIMITS.name} 个字`);
    return name;
  }
  function addReason(state,value){
    const next=get(state),name=checkName(value);
    if(next.reasons.length>=LIMITS.reasons)throw new Error(`无效原因最多 ${LIMITS.reasons} 个`);
    if(next.reasons.some(item=>norm(item)===norm(name)))throw new Error('已有同名的无效原因');
    return write(state,{...next,reasons:[...next.reasons,name]});
  }
  // 改名：用了这个原因的线索一起改成新名字。
  function renameReason(state,from,value){
    const next=get(state),name=checkName(value);
    if(!next.reasons.includes(from))throw new Error('没有找到这个无效原因，请刷新后重试');
    if(name===from)return state;
    if(next.reasons.some(item=>item!==from&&norm(item)===norm(name)))throw new Error('已有同名的无效原因');
    const out=write(state,{...next,reasons:next.reasons.map(item=>item===from?name:item)});
    if(Array.isArray(state?.laiLeads))out.laiLeads=state.laiLeads.map(item=>item&&typeof item==='object'&&item.invalidReason===from?{...item,invalidReason:name}:item);
    return out;
  }
  function moveReason(state,name,direction){
    const next=get(state),at=next.reasons.indexOf(name),to=at+(Number(direction)<0?-1:1);
    if(at<0)throw new Error('没有找到这个无效原因，请刷新后重试');
    if(to<0||to>=next.reasons.length)return state;
    const reasons=[...next.reasons];
    [reasons[at],reasons[to]]=[reasons[to],reasons[at]];
    return write(state,{...next,reasons});
  }
  function removeReason(state,name){
    const next=get(state);
    if(!next.reasons.includes(name))throw new Error('没有找到这个无效原因，请刷新后重试');
    const used=reasonUse(state,name);
    if(used)throw new Error(`还有 ${used} 条线索用了这个原因，先改掉它们`);
    if(next.reasons.length<=1)throw new Error('至少要留一个无效原因');
    return write(state,{...next,reasons:next.reasons.filter(item=>item!==name)});
  }

  // ---- 线索字段 ----
  // 哪些角色把这个线索字段设成了只读或隐藏：[{role,level}]。
  function lockedBy(state,id){
    let roles=[];
    try{roles=RM()?.settings(state).roles||[];}catch{roles=[];}
    return roles.filter(role=>role.id!=='admin').map(role=>({role:role.name,level:role.fields?.lead?.[id]})).filter(item=>item.level==='read'||item.level==='hidden');
  }
  function fieldRows(state){
    const fields=get(state).fields;
    return FIELDS.map(({id,label})=>({id,label,...fields[id],locked:lockedBy(state,id)}));
  }
  // 改一个字段的「显示」「必填」。隐藏的字段不能必填；被某个角色设成只读或隐藏的字段不能必填。
  function setField(state,id,change){
    if(!fieldDef(id))throw new Error('这个字段不能在这里设置');
    const next=get(state),now=next.fields[id];
    let show=change?.show===undefined?now.show:!!change.show,required=change?.required===undefined?now.required:!!change.required;
    if(change?.required===true&&change?.show===undefined)show=true;
    if(!show)required=false;
    if(required){
      const lock=lockedBy(state,id)[0];
      if(lock)throw new Error(`角色「${lock.role}」把这个字段设为${lock.level==='hidden'?'隐藏':'只读'}，不能同时必填`);
    }
    return write(state,{...next,fields:{...next.fields,[id]:{show,required}}});
  }
  // 线索表单用：不显示的字段、必填的字段。
  function hiddenFields(state){const fields=get(state).fields;return FIELDS.filter(({id})=>!fields[id].show).map(field=>field.id);}
  function requiredFields(state){const fields=get(state).fields;return FIELDS.filter(({id})=>fields[id].required).map(field=>field.id);}

  const api={DEFAULT_REASONS,LIMITS,FIELDS,get,reasonsOf,reasonUse,reasonRows,addReason,renameReason,moveReason,removeReason,lockedBy,fieldRows,setField,hiddenFields,requiredFields};
  if(node)module.exports=api;else root.LaiLeadSettings=api;
})(typeof window!=='undefined'?window:globalThis);
