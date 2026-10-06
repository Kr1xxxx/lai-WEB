const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Same small DOM-boundary approach as business-ui.test.cjs. No browser or added dependency.
class Element extends EventTarget {
  constructor(tag, doc) { super(); this.tagName=tag.toUpperCase(); this.ownerDocument=doc; this.children=[]; this.attrs={}; this.style={}; this.value=''; this.textContent=''; this.rect={left:20,top:100,bottom:132,width:240}; }
  setAttribute(k,v){this.attrs[k]=String(v);}
  getAttribute(k){return this.attrs[k]??null;}
  removeAttribute(k){delete this.attrs[k];}
  hasAttribute(k){return Object.hasOwn(this.attrs,k);}
  get id(){return this.getAttribute('id')||'';} set id(v){this.setAttribute('id',v);}
  appendChild(el){el.parentNode=this;this.children.push(el);return el;}
  append(...nodes){nodes.forEach(n=>this.appendChild(n));}
  replaceChildren(...nodes){this.children.forEach(n=>n.parentNode=null);this.children=[];this.append(...nodes);}
  remove(){if(this.parentNode){this.parentNode.children=this.parentNode.children.filter(n=>n!==this);this.parentNode=null;}}
  contains(el){return el===this||this.children.some(c=>c.contains(el));}
  matches(selector){return selector.split(',').some(s=>{if(s.trim().startsWith('.'))return String(this.className||'').split(/\s+/).includes(s.trim().slice(1));const m=s.trim().match(/^(\w+)?(?:\[([^\]]+)\])?$/);return m&&(!m[1]||this.tagName===m[1].toUpperCase())&&(!m[2]||this.hasAttribute(m[2]));});}
  querySelectorAll(selector){return this.children.flatMap(c=>[...(c.matches(selector)?[c]:[]),...c.querySelectorAll(selector)]);}
  closest(selector){for(let node=this;node;node=node.parentNode)if(node.matches(selector))return node;return null;}
  get options(){return this.querySelectorAll('option');}
  getBoundingClientRect(){
    if(this.getAttribute('role')==='listbox') {
      // Supply layout measurements for the virtual DOM. Real geometry is covered by browser tests.
      const optionCount=this.children.filter(child=>child.getAttribute('role')==='option').length;
      const height=Math.min(optionCount?optionCount*36+10:64,Number.parseFloat(this.style.maxHeight)||268);
      return {...this.rect,height};
    }
    return this.rect;
  }
  scrollIntoView(){}
  focus(){this.ownerDocument.activeElement=this;this.dispatchEvent(new Event('focus'));}
  set innerHTML(_){throw new Error('Suggestion content must not be parsed as HTML');}
}
function fixture(options=['China','Canada','France'], value='') {
  const doc=new EventTarget();doc.createElement=tag=>new Element(tag,doc);doc.body=doc.createElement('body');doc.documentElement={clientWidth:900,clientHeight:700};
  doc.querySelectorAll=s=>doc.body.querySelectorAll(s);doc.getElementById=id=>doc.body.querySelectorAll('input,datalist,div,button').find(x=>x.id===id)||null;
  const list=doc.createElement('datalist');list.id='countries';options.forEach(value=>{const option=doc.createElement('option');option.value=value;list.append(option);});
  const input=doc.createElement('input');input.setAttribute('list','countries');input.setAttribute('name','country');input.setAttribute('required','');input.value=value;
  doc.body.append(input,list); const window=Object.assign(new EventTarget(),{document:doc,innerWidth:900,innerHeight:700,Event});doc.defaultView=window;
  const context=vm.createContext({window,document:doc,Event,WeakMap,WeakSet,Set});
  const source=path.join(__dirname,'../src/customer-suggestions.js'); if(fs.existsSync(source))vm.runInContext(fs.readFileSync(source,'utf8'),context);
  const api=window.LaiCustomerSuggestions;assert.equal(typeof api?.enhance,'function','Suggestion enhancement API exists');
  const emit=(target,type,extra={})=>{const event=new Event(type,{bubbles:true,cancelable:true});Object.entries(extra).forEach(([k,v])=>Object.defineProperty(event,k,{value:v}));target.dispatchEvent(event);return event;};
  const menu=()=>doc.body.children.find(n=>n.getAttribute('role')==='listbox');
  const items=()=>menu()?.children.filter(n=>n.getAttribute('role')==='option')||[];
  return {doc,input,list,api,emit,menu,items};
}
test('enhancement preserves field semantics, opens locally, and can run repeatedly',()=>{
 const h=fixture();h.api.enhance(h.doc);h.api.enhance(h.doc);assert.equal(h.input.getAttribute('list'),null);assert.equal(h.input.getAttribute('data-lai-suggestions-list'),'countries');assert.equal(h.input.getAttribute('name'),'country');assert(h.input.hasAttribute('required'));h.input.focus();assert.deepEqual(h.items().map(n=>n.textContent),['China','Canada','France']);assert.equal(h.menu().style.minWidth,'240px');assert.equal(h.doc.body.children.filter(n=>n.getAttribute('role')==='listbox').length,1);
});
test('typing filters case-insensitively and unmatched text remains a legal free value',()=>{
 const h=fixture();h.api.enhance(h.doc);h.input.value='cAN';h.emit(h.input,'input');assert.deepEqual(h.items().map(n=>n.textContent),['Canada']);h.input.value='Custom country';h.emit(h.input,'input');assert.equal(h.items().length,0);assert(h.menu().children.some(n=>n.textContent.includes('可以输入')));h.emit(h.input,'keydown',{key:'Enter'});assert.equal(h.input.value,'Custom country');
});
test('keyboard selection emits exactly one input and change without reopening',()=>{
 const h=fixture();let inputs=0,changes=0;h.input.addEventListener('input',()=>inputs++);h.input.addEventListener('change',()=>changes++);h.api.enhance(h.doc);h.api.enhance(h.doc);h.emit(h.input,'keydown',{key:'ArrowDown'});h.emit(h.input,'keydown',{key:'ArrowDown'});h.emit(h.input,'keydown',{key:'Enter'});assert.equal(h.input.value,'Canada');assert.equal(inputs,1);assert.equal(changes,1);assert.equal(h.menu(),undefined);assert.equal(h.input.getAttribute('aria-expanded'),'false');
});
test('mouse selection and literal malicious option content do not create markup',()=>{
 const h=fixture(['<img src=x onerror=alert(1)>']);let changes=0;h.input.addEventListener('change',()=>changes++);h.api.enhance(h.doc);h.input.focus();assert.equal(h.items()[0].textContent,'<img src=x onerror=alert(1)>');const item=h.items()[0];assert(h.emit(item,'pointerdown').defaultPrevented);h.emit(item,'click');assert.equal(h.input.value,'<img src=x onerror=alert(1)>');assert.equal(changes,1);assert.equal(h.menu(),undefined);
});
test('Escape, Tab, outside pointer, and explicit close dismiss without modifying the value',()=>{
 const h=fixture(['China'],'China');h.api.enhance(h.doc);for(const key of ['Escape','Tab']){h.input.focus();h.emit(h.input,'keydown',{key});assert.equal(h.menu(),undefined);assert.equal(h.input.value,'China');}h.input.focus();h.emit(h.doc,'pointerdown',{target:h.doc.body});assert.equal(h.menu(),undefined);h.input.focus();h.api.close();assert.equal(h.menu(),undefined);
});
test('enhance supports a newly inserted input and only one open menu',()=>{
 const h=fixture();h.api.enhance(h.doc);h.input.focus();const added=h.doc.createElement('input');added.setAttribute('list','countries');h.doc.body.append(added);h.api.enhance(added);added.focus();assert.equal(h.input.getAttribute('aria-expanded'),'false');assert.equal(added.getAttribute('aria-expanded'),'true');assert.equal(h.doc.body.children.filter(n=>n.getAttribute('role')==='listbox').length,1);
});
test('an empty source still opens an explanatory free-input menu',()=>{
 const h=fixture([]);h.api.enhance(h.doc);h.input.focus();assert.equal(h.items().length,0);assert(h.menu().children[0].textContent.includes('暂无可选项'));assert(h.menu().children[0].textContent.includes('可以输入'));
});
test('IME composition does not accidentally commit an option',()=>{
 const h=fixture();h.api.enhance(h.doc);h.emit(h.input,'keydown',{key:'ArrowDown'});h.emit(h.input,'keydown',{key:'Enter',isComposing:true});assert.equal(h.input.value,'');assert(h.menu());
});
test('menu opens above a low field and stays aligned to the input width',()=>{
 const h=fixture();h.input.rect={left:650,top:660,bottom:692,width:220};h.api.enhance(h.doc);h.input.focus();assert.equal(h.menu().style.minWidth,'220px');assert.equal(h.menu().style.left,'650px');assert(Number.parseFloat(h.menu().style.top)<660);assert(Number.parseFloat(h.menu().style.maxHeight)<=268);
});
test('reopening reads current datalist values while excluding duplicates and disabled entries',()=>{
 const h=fixture(['China','China']);h.api.enhance(h.doc);h.input.focus();assert.equal(h.items().length,1);h.api.close();const option=h.doc.createElement('option');option.value='Canada';h.list.append(option);h.list.options[0].disabled=true;h.list.options[1].disabled=true;h.input.focus();assert.deepEqual(h.items().map(n=>n.textContent),['Canada']);
});
test('open suggestions follow their input when the editor scrolls or the viewport resizes',()=>{
 const h=fixture();h.api.enhance(h.doc);h.input.focus();assert.equal(h.menu().style.top,'136px');
 h.input.rect={left:20,top:40,bottom:72,width:240};h.emit(h.doc,'scroll');assert.equal(h.menu().style.top,'76px');
 h.doc.defaultView.innerHeight=110;h.doc.defaultView.dispatchEvent(new Event('resize'));assert.equal(h.menu().style.top,'8px');assert.equal(h.menu().style.maxHeight,'28px');
});
test('suggestions close when the input scrolls completely out of view',()=>{
 const h=fixture();h.api.enhance(h.doc);h.input.focus();assert(h.menu());
 h.input.rect={left:20,top:720,bottom:752,width:240};h.emit(h.doc,'scroll');
 assert.equal(h.menu(),undefined);assert.equal(h.input.getAttribute('aria-expanded'),'false');assert.equal(h.input.value,'');
 h.input.rect={left:20,top:100,bottom:132,width:240};h.input.focus();assert(h.menu());
 h.input.rect={left:20,top:-40,bottom:-8,width:240};h.emit(h.doc,'scroll');
 assert.equal(h.menu(),undefined);assert.equal(h.input.getAttribute('aria-expanded'),'false');
});

function drawerFixture(inputRect){
 const h=fixture();const body=h.doc.createElement('div');body.className='drawer-body';body.rect={left:0,top:56,bottom:638,width:900,height:582};h.input.remove();body.append(h.input);h.doc.body.append(body);h.input.rect=inputRect;h.api.enhance(h.doc);return h;
}
test('a field fully clipped above the scrolling drawer body dismisses its suggestions',()=>{
 const h=drawerFixture({left:20,top:100,bottom:132,width:240});h.input.focus();assert(h.menu());h.input.rect={left:20,top:22,bottom:54,width:240};h.emit(h.doc,'scroll');assert.equal(h.menu(),undefined);assert.equal(h.input.getAttribute('aria-expanded'),'false');assert.equal(h.input.getAttribute('aria-controls'),null);
});
test('a field below the drawer body dismisses suggestions even inside the window',()=>{
 const h=drawerFixture({left:20,top:100,bottom:132,width:240});h.input.focus();h.input.rect={left:20,top:640,bottom:672,width:240};h.emit(h.doc,'scroll');assert.equal(h.menu(),undefined);assert.equal(h.input.getAttribute('aria-expanded'),'false');
});
test('programmatic focus on a clipped field does not create a floating menu',()=>{
 const h=drawerFixture({left:20,top:22,bottom:54,width:240});h.input.focus();assert.equal(h.menu(),undefined);assert.equal(h.input.getAttribute('aria-expanded'),'false');
});
test('partial drawer visibility keeps suggestions available and later reopening still works',()=>{
 const h=drawerFixture({left:20,top:40,bottom:72,width:240});h.input.focus();assert(h.menu());h.input.rect={left:20,top:22,bottom:54,width:240};h.emit(h.doc,'scroll');assert.equal(h.menu(),undefined);h.input.rect={left:20,top:100,bottom:132,width:240};h.input.focus();assert(h.menu());assert.equal(h.input.getAttribute('aria-expanded'),'true');
});
