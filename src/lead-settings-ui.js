(function(root){
  'use strict';
  // 线索设置页（线索 → 设置，路由 lead-settings）：无效原因、线索字段，以及去客户设置的两条提示。
  // 通过 root.LaiExtraPages 登记（见 business-ui.js）；数据逻辑都在 lead-settings-model.js。
  const S=()=>root.LaiLeadSettings;
  const KEY='settings.lead';
  let armed='',cfArmed='',problem='';

  const FM=()=>typeof module!=='undefined'&&module.exports?require('./field-model.js'):root.LaiFieldModel;
  // 自定义字段区：添加、改名、必填、排序、删除、选项。类型建好后不能改。
  function customMarkup(c,model,state){
    const fm=FM();
    if(!fm)return '';
    const E=c.escape,rows=model.customRows(state);
    const lockText=lock=>lock?`角色「${E(lock.role)}」把这个字段设为${lock.level==='hidden'?'隐藏':'只读'}，不能必填`:'';
    const list=rows.map((f,index)=>{
      const lock=f.locked[0],sure=cfArmed===f.id,choice=f.type==='select'||f.type==='multi';
      const options=choice?`<div class="cf-options"><ul class="cs-list">${f.options.map((o,i)=>`<li class="cs-row cs-child"><strong>${E(o)}</strong><span class="cs-row-actions">`
        +`<button type="button" data-ls-cf="opt-up" data-id="${E(f.id)}" data-option="${E(o)}" aria-label="上移选项：${E(o)}"${i===0?' disabled':''}>↑</button>`
        +`<button type="button" data-ls-cf="opt-down" data-id="${E(f.id)}" data-option="${E(o)}" aria-label="下移选项：${E(o)}"${i===f.options.length-1?' disabled':''}>↓</button>`
        +`<button type="button" data-ls-cf="opt-remove" data-id="${E(f.id)}" data-option="${E(o)}" aria-label="删除选项：${E(o)}">删除</button></span></li>`).join('')}</ul>`
        +`<form class="cs-add" data-ls-cf-form="option" data-id="${E(f.id)}" novalidate data-form-check><input name="option" placeholder="“${E(f.name)}”的新选项" maxlength="${fm.LIMITS.optionLen}" aria-label="“${E(f.name)}”的新选项" autocomplete="off"><button type="submit">添加选项</button></form></div>`:'';
      return `<li class="cs-group cf-field" data-ls-cf-field="${E(f.id)}"><div class="cs-row"><input class="cf-name" data-ls-cf-rename="${E(f.id)}" value="${E(f.name)}" maxlength="${fm.LIMITS.nameLen}" aria-label="字段名称：${E(f.name)}" autocomplete="off">`
        +`<span class="cs-use">${E(f.typeLabel)} · ${f.usage?`${f.usage} 条线索已填`:'还没有线索填'}</span><span class="cs-row-actions">`
        +`<label class="ls-check"><input type="checkbox" data-ls-cf-required="${E(f.id)}"${f.required?' checked':''}${lock&&!f.required?' disabled':''} aria-label="${E(f.name)}：必填"><span>必填</span></label>`
        +`<button type="button" data-ls-cf="up" data-id="${E(f.id)}" aria-label="上移：${E(f.name)}"${index===0?' disabled':''}>↑</button>`
        +`<button type="button" data-ls-cf="down" data-id="${E(f.id)}" aria-label="下移：${E(f.name)}"${index===rows.length-1?' disabled':''}>↓</button>`
        +`<button type="button" class="${sure?'team-danger':''}" data-ls-cf="delete" data-id="${E(f.id)}" aria-label="${sure?'再点一次确认删除':'删除'}：${E(f.name)}">${sure?'再点一次确认删除':'删除'}</button></span></div>`
        +`${lock?`<small class="cs-hint cf-lock">${lockText(lock)}</small>`:''}${options}</li>`;
    }).join('');
    const types=fm.TYPES.map(([id,label])=>`<option value="${id}">${E(label)}</option>`).join('');
    const add=`<form class="cs-add cf-add" data-ls-cf-form="add" novalidate data-form-check><input name="name" placeholder="新字段名称" maxlength="${fm.LIMITS.nameLen}" aria-label="新字段名称" autocomplete="off" required>`
      +`<select name="type" aria-label="字段类型">${types}</select>`
      +`<input name="options" placeholder="选项（单选、多选用），用逗号分开" aria-label="字段选项" autocomplete="off">`
      +`<label class="ls-check"><input type="checkbox" name="required"><span>必填</span></label><button type="submit" class="primary">添加字段</button></form>`;
    return `<section class="business-section ls-section" data-ls-section="custom"><h2>自定义字段（${rows.length}/${fm.LIMIT}）</h2><p class="cs-note">给线索加自己需要的字段。添加后，新建和编辑线索时会多出这些字段，线索详情和导出里也能看到。</p>${add}`
      +`${rows.length?`<ul class="cs-list cs-tree">${list}</ul>`:'<p class="cs-hint">还没有自定义字段。</p>'}`
      +`<p class="cs-hint">最多 ${fm.LIMIT} 个。类型建好后不能改。选项可以添加、排序、删除，不能改名。删除字段或选项后，线索里已填的内容仍然保留，只是不再显示。转为客户时，会带到客户设置里同名同类型的字段。名称改完按回车或点别处即保存。</p></section>`;
  }

  function render(c){
    const E=c.escape,state=c.state(),model=S();
    if(!c.can(KEY))return '';
    const rows=model.reasonRows(state);
    const reasons=rows.map((item,index)=>{
      const sure=armed===item.name;
      return `<li><div class="cs-row"><input class="opp-set-name" data-ls-rename="${E(item.name)}" value="${E(item.name)}" maxlength="${model.LIMITS.name}" aria-label="无效原因：${E(item.name)}" autocomplete="off">`
        +`<span class="cs-use">${item.count?`${item.count} 条线索在用`:'没有线索在用'}</span><span class="cs-row-actions">`
        +`<button type="button" data-ls-action="up" data-name="${E(item.name)}" aria-label="上移：${E(item.name)}"${index===0?' disabled':''}>↑</button>`
        +`<button type="button" data-ls-action="down" data-name="${E(item.name)}" aria-label="下移：${E(item.name)}"${index===rows.length-1?' disabled':''}>↓</button>`
        +`<button type="button" class="${sure?'team-danger':''}" data-ls-action="remove" data-name="${E(item.name)}" aria-label="${sure?'再点一次确认删除':'删除'}：${E(item.name)}">${sure?'再点一次确认删除':'删除'}</button></span></div></li>`;
    }).join('');
    const fields=model.fieldRows(state).map(item=>{
      const lock=item.locked[0];
      const lockText=lock?`角色「${lock.role}」把这个字段设为${lock.level==='hidden'?'隐藏':'只读'}，不能必填`:'';
      return `<tr><th scope="row">${E(item.label)}</th>`
        +`<td><label class="ls-check"><input type="checkbox" data-ls-field="${E(item.id)}" data-ls-kind="show"${item.show?' checked':''} aria-label="${E(item.label)}：显示"><span>显示</span></label></td>`
        +`<td><label class="ls-check"><input type="checkbox" data-ls-field="${E(item.id)}" data-ls-kind="required"${item.required?' checked':''}${item.show&&!lock?'':' disabled'} aria-label="${E(item.label)}：必填"><span>必填</span></label>${lockText?`<small class="ls-lock">${E(lockText)}</small>`:''}</td></tr>`;
    }).join('');
    const shownProblem=problem;
    problem='';
    return `<div class="pagebar"><div class="business-title"><h1>线索设置</h1><span>设置标记无效的原因、新建线索时每个字段显不显示、必不必填，以及自己加的字段</span></div><div class="page-actions"></div></div>`
      +`<div class="business-scroll opp-page ls-page"><div class="error ls-error${shownProblem?' visible':''}" id="ls-error" role="alert">${E(shownProblem)}</div>`
      +`<section class="business-section ls-section" data-ls-section="reasons"><h2>无效原因</h2><p class="cs-note">把线索标记为无效时，要从这里选一个原因。已有线索在用的原因不能删除，可以先改名（用了它的线索会一起改名）。</p>`
      +`<form class="cs-add" id="ls-reason-add" novalidate data-form-check><input name="text" maxlength="${model.LIMITS.name}" placeholder="新的无效原因" aria-label="新的无效原因" autocomplete="off" required><button type="submit" class="primary">添加</button></form>`
      +`<ul class="cs-list">${reasons}</ul><p class="cs-hint">最多 ${model.LIMITS.reasons} 个，每个不超过 ${model.LIMITS.name} 个字，不能重名。名称改完按回车或点别处即保存。</p></section>`
      +`<section class="business-section ls-section" data-ls-section="fields"><h2>线索字段</h2><p class="cs-note">「线索名称」一直显示并且必填。不显示的字段，新建和编辑线索时看不到，已经填过的内容会保留。</p>`
      +`<table class="order-table ls-table"><thead><tr><th>字段</th><th>显示</th><th>必填</th></tr></thead><tbody>${fields}</tbody></table>`
      +`<p class="cs-hint">必填只在新建和编辑线索时检查；账号被角色设为只读或隐藏的字段不检查。转为客户有自己的必填项，不受这里影响。</p></section>`
      +customMarkup(c,model,state)
      +`<section class="business-section ls-section" data-ls-section="links"><h2>其他设置在哪里</h2><ul class="ls-links">`
      +`<li>来源请到 <button type="button" class="company-link" data-lai-screen="customer-settings">客户设置 → 来源设置</button></li>`
      +`<li>判重请到 <button type="button" class="company-link" data-lai-screen="customer-settings">客户设置 → 判重设置</button></li></ul></section></div>`;
  }

  // 保存一次修改；失败时把原因写在页面上方并重画（输入框、勾选恢复成已保存的样子）。
  async function apply(c,make){
    if(!c.need(KEY))return;
    try{
      await c.save(make(c.state()));
      problem='';
      c.toast('已保存到来财');
    }catch(error){
      problem=error.message;
    }
    c.refresh();
  }
  // 自定义字段的修改：和 apply 一样，改完先收起“再点一次确认删除”。
  function applyField(c,make){cfArmed='';return apply(c,make);}

  function clickField(c,button){
    const model=S(),{lsCf:action,id,option}=button.dataset;
    if(action==='delete'){
      if(cfArmed!==id){cfArmed=id;armed='';problem='';c.refresh();return true;}
      applyField(c,state=>model.deleteCustomField(state,id));
      return true;
    }
    armed='';
    if(action==='up'||action==='down')applyField(c,state=>model.moveCustomField(state,id,action==='up'?-1:1));
    else if(action==='opt-up'||action==='opt-down')applyField(c,state=>model.moveFieldOption(state,id,option,action==='opt-up'?-1:1));
    else if(action==='opt-remove')applyField(c,state=>model.removeFieldOption(state,id,option));
    else return false;
    return true;
  }
  function click(c,e){
    const field=e.target.closest?.('[data-ls-cf]');
    if(field?.dataset?.lsCf&&!field.disabled)return clickField(c,field);
    const button=e.target.closest?.('[data-ls-action]');
    if(!button)return false;
    cfArmed='';
    const name=button.dataset.name,action=button.dataset.lsAction,model=S();
    if(action==='remove'){
      if(armed!==name){armed=name;problem='';c.refresh();return true;}
      armed='';
      apply(c,state=>model.removeReason(state,name));
      return true;
    }
    armed='';
    apply(c,state=>model.moveReason(state,name,action==='up'?-1:1));
    return true;
  }
  function submit(c,e){
    const kind=e.target?.dataset?.lsCfForm;
    if(kind){
      e.preventDefault();
      const data=new FormData(e.target),model=S();
      if(kind==='add')applyField(c,state=>model.addCustomField(state,{name:String(data.get('name')||''),type:String(data.get('type')||''),options:String(data.get('options')||''),required:data.has('required')}));
      else if(kind==='option'){const id=e.target.dataset.id;applyField(c,state=>model.addFieldOption(state,id,String(data.get('option')||'')));}
      else return false;
      return true;
    }
    if(e.target?.id!=='ls-reason-add')return false;
    e.preventDefault();
    const text=e.target.querySelector('input[name="text"]')?.value;
    apply(c,state=>S().addReason(state,text));
    return true;
  }
  function change(c,e){
    const target=e.target;
    if(target?.dataset?.lsRename!==undefined){
      apply(c,state=>S().renameReason(state,target.dataset.lsRename,target.value));
      return true;
    }
    const d=target?.dataset||{};
    if(d.lsCfRequired){
      applyField(c,state=>S().setCustomRequired(state,d.lsCfRequired,target.checked));
      return true;
    }
    if(d.lsCfRename){
      if(target.value.trim()===target.defaultValue.trim())return true;
      applyField(c,state=>S().renameCustomField(state,d.lsCfRename,target.value));
      return true;
    }
    if(target?.dataset?.lsField){
      const id=target.dataset.lsField,kind=target.dataset.lsKind;
      apply(c,state=>S().setField(state,id,{[kind==='show'?'show':'required']:target.checked}));
      return true;
    }
    return false;
  }
  root.LaiExtraPages=root.LaiExtraPages||{};
  root.LaiExtraPages['lead-settings']={title:'线索设置',render,click,submit,change};
  if(typeof module!=='undefined'&&module.exports)module.exports={render,click,submit,change};
})(typeof window!=='undefined'?window:globalThis);
