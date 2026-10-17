(function(root){
  'use strict';
  // 订单自定义字段（设置 → 订单字段）。设置和规则见 field-model.js，设置存在 laiSettings.fieldSettings.order，
  // 值存在每笔订单的 custom[字段ID] 里（订单本来就是整笔存成 JSON，不改数据库结构）。
  // 必填只在新建、编辑订单表单保存时检查；删除字段只去掉设置，订单里已填的值原样留着，只是不再显示、不再导出。
  const node=typeof module!=='undefined'&&module.exports;
  const FM=()=>node?require('./field-model.js'):root.LaiFieldModel;
  const RMODEL=()=>node?require('./role-model.js'):root.LaiRoleModel;
  const ENTITY='order';
  const trim=value=>String(value??'').trim();
  const norm=value=>trim(value).normalize('NFKC').replace(/\s+/g,' ').toLowerCase();
  const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
  const sameValue=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  // 订单表单自带字段的名称：自定义字段不能和它们重名。
  const RESERVED_NAMES=Object.freeze(['订单编号','订单号','客户名称','客户','国家地区','国家','产品','产品明细','订单金额','金额','币种','已收款','待收款','订单阶段','阶段','创建日期','订单日期','订单月份','跟进人','物流单号','承运商','订单备注','备注','下一步','草稿','是否草稿','保存为草稿']);
  const customKey=id=>`custom.${id}`;
  const customFields=state=>FM().get(state,ENTITY).customFields;

  // ---- 设置 ----
  const ordersOf=state=>['orders','trashOrders'].flatMap(bucket=>Array.isArray(state?.[bucket])?state[bucket]:[]).filter(item=>item&&typeof item==='object');
  // 设置页的每一行：字段信息、类型名称、有几笔订单（含回收站里的）填了它。
  function customRows(state){
    const fm=FM(),orders=ordersOf(state);
    return customFields(state).map(field=>({...field,typeLabel:fm.typeLabel(field.type),usage:fm.usage(orders,field.id)}));
  }
  const addCustomField=(state,input)=>FM().addField(state,ENTITY,input,{reserved:RESERVED_NAMES});
  const renameCustomField=(state,id,name)=>FM().renameField(state,ENTITY,id,name,{reserved:RESERVED_NAMES});
  const moveCustomField=(state,id,delta)=>FM().moveField(state,ENTITY,id,Number(delta)<0?-1:1);
  const deleteCustomField=(state,id)=>FM().deleteField(state,ENTITY,id);
  const setCustomRequired=(state,id,on)=>FM().setRequired(state,ENTITY,id,on);
  // 选项：可以添加、排序、删除，不能改名。删掉的选项，订单身上已存的值仍保留。
  function optionsOf(state,id){
    const field=customFields(state).find(item=>item.id===id);
    if(!field)throw new Error('字段不存在，可能已被删除');
    if(field.type!=='select'&&field.type!=='multi')throw new Error('这个类型的字段没有选项');
    return field.options;
  }
  function addFieldOption(state,id,text){
    const value=trim(text);
    if(!value)throw new Error('请填写选项');
    const options=optionsOf(state,id);
    if(options.some(option=>norm(option)===norm(value)))throw new Error('已经有这个选项');
    return FM().setOptions(state,ENTITY,id,[...options,value]);
  }
  function moveFieldOption(state,id,option,delta){
    const options=[...optionsOf(state,id)],i=options.indexOf(option),j=i+(Number(delta)<0?-1:1);
    if(i<0)throw new Error('选项不存在，可能已被删除');
    if(j<0||j>=options.length)throw new Error(j<0?'已经是第一个了':'已经是最后一个了');
    [options[i],options[j]]=[options[j],options[i]];
    return FM().setOptions(state,ENTITY,id,options);
  }
  function removeFieldOption(state,id,option){
    const options=optionsOf(state,id);
    if(!options.includes(option))throw new Error('选项不存在，可能已被删除');
    if(options.length<=1)throw new Error('至少要留一个选项');
    return FM().setOptions(state,ENTITY,id,options.filter(item=>item!==option));
  }

  // ---- 值 ----
  // 整理订单表单传来的自定义字段值并检查必填，返回新的 custom 对象（没有任何值时返回 undefined）。
  // 只处理设置里还在的字段；input.custom 里没带的字段（账号不能改的）和已经删掉的字段，原来的值原样保留。
  // 必填：新建订单全部要填；编辑旧订单时，本来就是空的、这次也没动的字段不拦；账号不能改（只读、隐藏）的字段不检查。
  function applyCustom(state,previous,input){
    const fm=FM();
    if(!fm)return previous?.custom;
    const settings=fm.get(state,ENTITY),before=plain(previous?.custom),out={...before},sent=Object.hasOwn(input||{},'custom')?plain(input.custom):{},touched=new Set();
    for(const field of settings.customFields){
      if(!Object.hasOwn(sent,field.id))continue;
      const value=fm.cleanValue(field,sent[field.id],before[field.id]);
      if(value===undefined)delete out[field.id];else out[field.id]=value;
      if(!sameValue(value,before[field.id]))touched.add(field.id);
    }
    const levels=RMODEL();
    const missing=fm.missingRequired(settings,out,{editable:id=>!levels||levels.fieldLevel(state,ENTITY,customKey(id))==='edit',previous:previous?before:undefined,touched});
    if(missing.length)throw new Error(`请填写${missing.join('、')}`);
    return Object.keys(out).length||previous?.custom!==undefined?out:undefined;
  }
  // 详情用：设置里的自定义字段，只留下有值的和必填的。text 是已排好的文字（多选用“、”隔开）。
  function customView(state,order){
    const fm=FM();
    if(!fm)return [];
    const values=plain(order?.custom);
    return customFields(state).map(field=>({id:field.id,name:field.name,type:field.type,required:field.required,text:fm.formatValue(field,values[field.id])})).filter(entry=>entry.text||entry.required);
  }

  const api={ENTITY,RESERVED_NAMES,customFields,customRows,addCustomField,renameCustomField,moveCustomField,deleteCustomField,setCustomRequired,addFieldOption,moveFieldOption,removeFieldOption,applyCustom,customView};
  if(node)module.exports=api;else root.LaiOrderFields=api;
})(typeof window!=='undefined'?window:globalThis);
