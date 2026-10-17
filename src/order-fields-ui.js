(function(root){
  'use strict';
  // 订单自定义字段的页面部分：设置页里的「订单字段」一节、订单表单里的输入、订单详情里的取值。
  // 设置页是 business-ui.js 自带的页面（路由 settings），这一节的点击、输入、提交由它转给这里；数据逻辑都在 order-fields-model.js。
  const node=typeof module!=='undefined'&&module.exports;
  const OF=()=>node?require('./order-fields-model.js'):root.LaiOrderFields;
  const FM=()=>node?require('./field-model.js'):root.LaiFieldModel;
  const KEY='settings.general';
  let armed='',problem='';
  const cssEscape=value=>(root.CSS?.escape?root.CSS.escape(String(value)):String(value).replace(/["\\]/g,'\\$&'));

  // ---- 设置页：订单字段 ----
  function settingsMarkup(c){
    const fm=FM(),model=OF();
    if(!fm||!model||!c.can(KEY))return '';
    const E=c.escape,rows=model.customRows(c.state());
    const list=rows.map((f,index)=>{
      const sure=armed===f.id,choice=f.type==='select'||f.type==='multi';
      const options=choice?`<div class="cf-options"><ul class="cs-list">${f.options.map((o,i)=>`<li class="cs-row cs-child"><strong>${E(o)}</strong><span class="cs-row-actions">`
        +`<button type="button" data-of-cf="opt-up" data-id="${E(f.id)}" data-option="${E(o)}" aria-label="上移选项：${E(o)}"${i===0?' disabled':''}>↑</button>`
        +`<button type="button" data-of-cf="opt-down" data-id="${E(f.id)}" data-option="${E(o)}" aria-label="下移选项：${E(o)}"${i===f.options.length-1?' disabled':''}>↓</button>`
        +`<button type="button" data-of-cf="opt-remove" data-id="${E(f.id)}" data-option="${E(o)}" aria-label="删除选项：${E(o)}">删除</button></span></li>`).join('')}</ul>`
        +`<form class="cs-add" data-of-cf-form="option" data-id="${E(f.id)}" novalidate data-form-check><input name="option" placeholder="“${E(f.name)}”的新选项" maxlength="${fm.LIMITS.optionLen}" aria-label="“${E(f.name)}”的新选项" autocomplete="off"><button type="submit">添加选项</button></form></div>`:'';
      // 名称框按名称长短放宽（最长 30 个字），长名称不被截掉。
      return `<li class="cs-group cf-field" data-of-cf-field="${E(f.id)}"><div class="cs-row"><input class="cf-name" data-of-cf-rename="${E(f.id)}" value="${E(f.name)}" maxlength="${fm.LIMITS.nameLen}" aria-label="字段名称：${E(f.name)}" autocomplete="off" style="--of-name:${Math.min(fm.LIMITS.nameLen,[...f.name].length)}">`
        +`<span class="cs-use">${E(f.typeLabel)} · ${f.usage?`${f.usage} 笔订单已填`:'还没有订单填'}</span><span class="cs-row-actions">`
        +`<label class="ls-check"><input type="checkbox" data-of-cf-required="${E(f.id)}"${f.required?' checked':''} aria-label="${E(f.name)}：必填"><span>必填</span></label>`
        +`<button type="button" data-of-cf="up" data-id="${E(f.id)}" aria-label="上移：${E(f.name)}"${index===0?' disabled':''}>↑</button>`
        +`<button type="button" data-of-cf="down" data-id="${E(f.id)}" aria-label="下移：${E(f.name)}"${index===rows.length-1?' disabled':''}>↓</button>`
        +`<button type="button" class="${sure?'team-danger':''}" data-of-cf="delete" data-id="${E(f.id)}" aria-label="${sure?'再点一次确认删除':'删除'}：${E(f.name)}">${sure?'再点一次确认删除':'删除'}</button></span></div>${options}</li>`;
    }).join('');
    const types=fm.TYPES.map(([id,label])=>`<option value="${id}">${E(label)}</option>`).join('');
    const add=`<form class="cs-add cf-add" data-of-cf-form="add" novalidate data-form-check><input name="name" placeholder="新字段名称" maxlength="${fm.LIMITS.nameLen}" aria-label="新字段名称" autocomplete="off" required>`
      +`<select name="type" aria-label="字段类型">${types}</select>`
      +`<input name="options" placeholder="选项（单选、多选用），用逗号分开" aria-label="字段选项" autocomplete="off">`
      +`<label class="ls-check"><input type="checkbox" name="required"><span>必填</span></label><button type="submit" class="primary">添加字段</button></form>`;
    const shown=problem;
    problem='';
    return `<section class="business-section of-section" data-of-section="custom"><div class="section-head"><h3>订单字段（${rows.length}/${fm.LIMIT}）</h3></div>`
      +`<p class="cs-note">给订单加自己需要的字段。添加后，新建和编辑订单时会多出这些字段，订单详情和导出里也能看到。</p>`
      +`<div class="error of-error${shown?' visible':''}" id="of-error" role="alert">${E(shown)}</div>${add}`
      +`${rows.length?`<ul class="cs-list cs-tree">${list}</ul>`:'<p class="cs-hint">还没有订单字段。</p>'}`
      +`<p class="cs-hint">最多 ${fm.LIMIT} 个。类型建好后不能改。选项可以添加、排序、删除，不能改名。必填只在新建和编辑订单时检查，老订单里本来就空着、这次也没改的不拦。删除字段或选项后，订单里已填的内容仍然保留，只是不再显示。名称改完按回车或点别处即保存。</p></section>`;
  }

  // 只重画「订单字段」这一节：同页上面「默认录入」里还没保存的内容、页面滚动位置都不动。
  // 添加表单、选项表单里打了一半的字保留（刚保存成功的那个表单清空）；原来在这一节里的焦点放回同一个控件。
  // 没有页面（node 测试）时交给 c.refresh()；页面上找不到这一节（保存期间已经离开设置页）时什么都不画，免得盖掉别的页面。
  const formKey=form=>`${form.dataset.ofCfForm||''}:${form.dataset.id||''}`;
  const formSelector=key=>{const [kind,id]=key.split(':');return `form[data-of-cf-form="${cssEscape(kind)}"]${id?`[data-id="${cssEscape(id)}"]`:''}`;};
  function focusSelector(el){
    const d=el.dataset||{},form=el.form&&el.form.dataset?.ofCfForm?el.form:null;
    if(form&&el.name)return `${formSelector(formKey(form))} [name="${cssEscape(el.name)}"]`;
    if(form)return `${formSelector(formKey(form))} button[type="submit"]`;
    if(d.ofCfRename)return `[data-of-cf-rename="${cssEscape(d.ofCfRename)}"]`;
    if(d.ofCfRequired)return `[data-of-cf-required="${cssEscape(d.ofCfRequired)}"]`;
    if(d.ofCf)return `[data-of-cf="${cssEscape(d.ofCf)}"][data-id="${cssEscape(d.id||'')}"]${d.option!==undefined?`[data-option="${cssEscape(d.option)}"]`:''}`;
    return '';
  }
  function redraw(c,{done='',focus=''}={}){
    const doc=root.document;
    if(!doc?.querySelector)return c.refresh();
    const old=doc.querySelector('[data-of-section="custom"]');
    if(!old)return;
    const drafts=[...old.querySelectorAll('form[data-of-cf-form]')].map(form=>[formKey(form),[...form.elements].filter(el=>el.name).map(el=>[el.name,el.type==='checkbox'?el.checked:el.value])]);
    const active=doc.activeElement&&old.contains(doc.activeElement)?focusSelector(doc.activeElement):'';
    const holder=doc.createElement('div');
    holder.innerHTML=settingsMarkup(c);
    const next=holder.firstElementChild;
    if(!next){old.remove();return;}
    old.replaceWith(next);
    for(const [key,values] of drafts){
      if(key===done)continue;
      const form=next.querySelector(formSelector(key));
      if(!form)continue;
      for(const [name,value] of values){const el=form.elements.namedItem(name);if(!el||el instanceof root.RadioNodeList)continue;if(el.type==='checkbox')el.checked=value;else el.value=value;}
    }
    const target=(focus&&next.querySelector(focus))||(active&&next.querySelector(active));
    if(target&&!target.disabled)target.focus({preventScroll:true});
  }

  // 保存一次修改；失败时把原因写在这一节上面并重画（名称框、勾选恢复成已保存的样子，打了一半的字保留）。
  // form：从哪个表单提交的（成功后清空它、焦点放回它的第一个输入框，方便接着添加）。
  // 修改一个接一个保存：改完名称直接点别的按钮时，名称先存好，再按存好的设置做下一步，不会撞上“正在保存”。
  let queue=Promise.resolve();
  function apply(c,make,form=null){
    armed='';
    if(!c.need(KEY))return queue;
    const key=form?formKey(form):'';
    queue=queue.then(async()=>{
      let saved=false;
      try{
        await c.save(make(c.state()));
        problem='';
        saved=true;
        c.toast('已保存到来财');
      }catch(error){
        problem=error.message;
      }
      redraw(c,{done:saved?key:'',focus:key?`${formSelector(key)} input:not([type="checkbox"])`:''});
    });
    return queue;
  }

  function click(c,e){
    const button=e.target.closest?.('[data-of-cf]');
    if(!button||button.disabled)return false;
    const model=OF(),{ofCf:action,id,option}=button.dataset;
    if(action==='delete'){
      if(armed!==id){armed=id;problem='';redraw(c);return true;}
      apply(c,state=>model.deleteCustomField(state,id));
      return true;
    }
    if(action==='up'||action==='down')apply(c,state=>model.moveCustomField(state,id,action==='up'?-1:1));
    else if(action==='opt-up'||action==='opt-down')apply(c,state=>model.moveFieldOption(state,id,option,action==='opt-up'?-1:1));
    else if(action==='opt-remove')apply(c,state=>model.removeFieldOption(state,id,option));
    else return false;
    return true;
  }
  function submit(c,e){
    const form=e.target,kind=form?.dataset?.ofCfForm;
    if(!kind)return false;
    e.preventDefault();
    const data=new FormData(form),model=OF();
    if(kind==='add')apply(c,state=>model.addCustomField(state,{name:String(data.get('name')||''),type:String(data.get('type')||''),options:String(data.get('options')||''),required:data.has('required')}),form);
    else if(kind==='option'){const id=form.dataset.id;apply(c,state=>model.addFieldOption(state,id,String(data.get('option')||'')),form);}
    else return false;
    return true;
  }
  function change(c,e){
    const target=e.target,d=target?.dataset||{};
    if(d.ofCfRequired){
      apply(c,state=>OF().setCustomRequired(state,d.ofCfRequired,target.checked));
      return true;
    }
    if(d.ofCfRename){
      if(target.value.trim()===target.defaultValue.trim())return true;
      apply(c,state=>OF().renameCustomField(state,d.ofCfRename,target.value));
      return true;
    }
    return false;
  }

  // ---- 订单表单 ----
  // 一种类型一个输入（组件套件的 k-input／k-textarea／k-select-trigger；日期用统一日期控件）。新建时必填的字段带浏览器自己的 required；编辑旧订单时不带，旧订单里本来空着的必填字段不拦（见 order-fields-model.js）。
  function control(E,def,value,isNew){
    const name=`custom.${def.id}`,id=`order-custom-${def.id}`,must=def.required&&isNew&&def.type!=='multi'?' required':'';
    if(def.type==='textarea')return `<textarea id="${E(id)}" name="${E(name)}" rows="3" maxlength="${FM().LIMITS.textarea}" placeholder="请输入" class="k-textarea"${must}>${E(value??'')}</textarea>`;
    if(def.type==='number')return `<input id="${E(id)}" name="${E(name)}" type="text" inputmode="decimal" value="${E(value??'')}" placeholder="请输入数字" autocomplete="off" class="k-input"${must}>`;
    if(def.type==='date')return `<input id="${E(id)}" name="${E(name)}" type="date" value="${E(value??'')}"${must}>`;
    if(def.type==='select'){
      const current=typeof value==='string'?value:'';
      return `<select id="${E(id)}" name="${E(name)}" class="k-select-trigger"${must}><option value="">请选择</option>${[...new Set([...def.options,...(current?[current]:[])])].map(item=>`<option value="${E(item)}"${item===current?' selected':''}>${E(item)}</option>`).join('')}</select>`;
    }
    if(def.type==='multi'){
      const picked=Array.isArray(value)?value.map(String):[];
      return `<span class="order-multi" id="${E(id)}" role="group" aria-label="${E(def.name)}">${[...new Set([...def.options,...picked])].map(item=>`<label class="order-multi-option"><input type="checkbox" name="${E(name)}" value="${E(item)}"${picked.includes(item)?' checked':''}> ${E(item)}</label>`).join('')}</span>`;
    }
    return `<input id="${E(id)}" name="${E(name)}" type="text" value="${E(value??'')}" maxlength="${FM().LIMITS.text}" placeholder="请输入" autocomplete="off" class="k-input"${must}>`;
  }
  // defs：设置里的自定义字段；values：订单上的 custom；isNew：新建订单。
  function formMarkup(E,{defs,values,isNew}){
    const list=Array.isArray(defs)?defs:[];
    if(!list.length)return '';
    const saved=values&&typeof values==='object'&&!Array.isArray(values)?values:{};
    return `<div class="form-section order-custom-head">自定义字段</div><div class="form-grid" data-order-custom-fields>${list.map(def=>{
      const star=def.required?'<span class="required" aria-hidden="true"> *</span>':'',wide=def.type==='textarea'||def.type==='multi';
      return def.type==='multi'?`<div class="field wide" data-order-custom="${E(def.id)}" data-custom-type="multi"><span>${E(def.name)}${star}</span>${control(E,def,saved[def.id],isNew)}</div>`
        :`<label class="field${wide?' wide':''}" data-order-custom="${E(def.id)}" data-custom-type="${E(def.type)}"><span>${E(def.name)}${star}</span>${control(E,def,saved[def.id],isNew)}</label>`;
    }).join('')}</div>`;
  }
  // 只能看、不能改的订单（没有编辑权限）：只列有值的字段和必填的字段（必填但没填显示“—”）。entries 是 order-fields-model 的 customView。
  function detailMarkup(E,entries){
    const list=Array.isArray(entries)?entries:[];
    if(!list.length)return '';
    // 多行文本占整行、保留换行，别的两个一行。
    return `<div class="form-section order-custom-head">自定义字段</div><dl class="lead-infos order-custom-infos" data-order-custom-infos>${list.map(entry=>`<div class="lead-info${entry.type==='textarea'?' order-custom-wide':''}"><dt>${E(entry.name)}</dt><dd>${entry.text?E(entry.text):'<span class="lead-muted">—</span>'}</dd></div>`).join('')}</dl>`;
  }
  // 表单提交时收成 order.custom 的输入：名字是 custom.字段ID（多选有好几个）。只收账号能改、表单里确实有的字段，其余原样保留。
  function collect(form,defs,editable=()=>true){
    const sent=new FormData(form),out={};
    for(const def of Array.isArray(defs)?defs:[]){
      if(!editable(def.id)||!form.querySelector(`[data-order-custom="${cssEscape(def.id)}"]`))continue;
      const key=`custom.${def.id}`;
      out[def.id]=def.type==='multi'?sent.getAll(key):String(sent.get(key)??'');
    }
    return out;
  }

  const api={settingsMarkup,click,submit,change,formMarkup,detailMarkup,collect};
  if(node)module.exports=api;else root.LaiOrderFieldsUI=api;
})(typeof window!=='undefined'?window:globalThis);
