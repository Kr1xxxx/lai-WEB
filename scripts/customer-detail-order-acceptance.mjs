import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

// Customer-detail order handoff using real CDP input and synthetic SQLite only.
const app=path.resolve(process.env.LAI_ACCEPTANCE_APP || 'dist/来财Lai.app');
const resources=path.join(app,'Contents/Resources');
const evidence=path.resolve(process.env.LAI_DETAIL_ORDER_EVIDENCE || 'evidence/customer-detail-order-2026-10-05/red123');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-customer-detail-order-'));
const derivedCustomer=process.env.LAI_ORDER_DERIVED === '1';
const children=[];
const checks={};
let cdp, backend;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const freePort=()=>new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
async function until(check,label){for(let i=0;i<160;i++){if(await check())return;await pause(50);}throw Error('Timed out: '+label);}
async function stop(child){if(!child||child.exitCode!==null||child.signalCode!==null)return;child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),pause(6000)]);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await new Promise(resolve=>child.once('exit',resolve));}}
async function startBackend(){
  const port=await freePort(),token=crypto.randomBytes(32).toString('hex');
  const child=spawn(path.join(resources,'node-runtime'),[path.join(resources,'server.js')],{
    env:{...process.env,LAI_DATA_DIR:path.join(temporary,'database'),LAI_APP_PORT:String(port),LAI_API_TOKEN:token,LAI_INSTANCE_NONCE:'customer-detail-order-test',LAI_APP_NO_OPEN:'1'},stdio:'ignore'});
  children.push(child);
  const base=`http://127.0.0.1:${port}`;
  await until(async()=>{if(child.exitCode!==null)throw Error('Isolated service exited');try{return (await fetch(base+'/api/health')).ok;}catch{return false;}},'isolated backend');
  return {child,base,token};
}
async function snapshot(){return (await fetch(backend.base+'/api/data',{headers:{'x-trade-token':backend.token}})).json();}
async function connect(url){
  const socket=new WebSocket(url);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let sequence=0;const pending=new Map();const paused=[];const completed=new Set();const exceptions=[];const uiSaves=[];
  socket.addEventListener('message',event=>{const message=JSON.parse(String(event.data));if(message.method==='Network.requestWillBeSent'&&message.params.request.url===backend.base+'/api/save'){uiSaves.push({method:message.params.request.method});return;}if(message.method==='Fetch.requestPaused'){paused.push({requestId:message.params.requestId,networkId:message.params.networkId,method:message.params.request.method});return;}if(message.method==='Network.loadingFinished'||message.method==='Network.loadingFailed'){completed.add(message.params.requestId);return;}if(message.method==='Runtime.exceptionThrown'){exceptions.push({text:message.params.exceptionDetails.text,description:message.params.exceptionDetails.exception?.description?.split('\n')[0]});return;}const request=pending.get(message.id);if(!request)return;pending.delete(message.id);clearTimeout(request.timer);if(message.error)request.reject(Error(message.error.message));else request.resolve(message.result);});
  return {paused,completed,exceptions,uiSaves,call(method,params={}){const id=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('Isolated browser command timed out: '+method))},5000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});},close(){socket.close();}};
}
async function evaluate(expression){const result=await cdp.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description?.split('\n')[0]||result.exceptionDetails.text);return result.result.value;}
async function navigate(){await cdp.call('Page.navigate',{url:backend.base+'/trade-order-system.html?token='+encodeURIComponent(backend.token)+'#customers'});await until(()=>evaluate(`!!document.querySelector('.company-link')`),'customer list');}
async function frame(name){
 await until(()=>evaluate(`!document.querySelector('#toast')?.classList.contains('show')`),'toast finished');
 await until(()=>evaluate(`!document.getAnimations().some(a=>a.playState==='running'&&a.effect.getTiming().iterations!==Infinity)`),'finite screenshot animations settled');
 await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
 const result=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(evidence,name+'.png'),Buffer.from(result.data,'base64'));}

async function pointerClick(selector,waitForFrames=true){
 if(waitForFrames)await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
 const point=await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)}),r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);if(!r.width||!r.height||!(el.contains(hit)||hit?.contains(el)))throw Error('Pointer target is hidden or covered: '+${JSON.stringify(selector)}+' '+JSON.stringify({x,y,rect:r.toJSON(),hit:hit?.className,overlay:el.closest('.overlay')?.className,animations:document.getAnimations().map(a=>({state:a.playState,time:a.currentTime,target:a.effect.target.className}))}));return {x,y}})()`);
 await cdp.call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
 await cdp.call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
}






const steps=[],observations=[];
let fixtureSaves=0,groupId;
async function key(key,code,n,modifiers=0){for(const type of ['keyDown','keyUp'])await cdp.call('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:n,modifiers,...(type==='keyDown'&&key==='Enter'?{text:'\r'}:{}),...(type==='keyDown'&&key==='a'&&modifiers===4?{commands:['selectAll']}:{})});}
async function settle(){await until(()=>evaluate(`!document.getAnimations().some(a=>a.playState==='running'&&a.effect.getTiming().iterations!==Infinity)`),'finite motion');await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);}
async function reach(selector){
 for(let i=0;i<32;i++){
  const s=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing actual target '+${JSON.stringify(selector)});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y);if(r.width&&r.height&&x>=0&&x<innerWidth&&y>=0&&y<innerHeight&&(e.contains(h)||h?.contains(e)))return {ready:true};const horizontal=x<0||x>=innerWidth;let p=e.parentElement;for(;p;p=p.parentElement){const css=getComputedStyle(p);if(horizontal?p.scrollWidth>p.clientWidth+1&&/auto|scroll/.test(css.overflowX):p.scrollHeight>p.clientHeight+1&&/auto|scroll/.test(css.overflowY))break;}p=p||document.querySelector('.customer-main');const b=p.getBoundingClientRect();return {ready:false,x:Math.max(5,Math.min(innerWidth-12,horizontal?b.x+b.width/2:b.right-15)),y:Math.max(120,Math.min(innerHeight-15,b.y+b.height/2)),deltaX:horizontal?(x<0?-320:320):0,deltaY:horizontal?0:(r.y<b.y?-320:320),rect:r.toJSON(),scroll:p.className,hit:h?.className}})()`);
  if(s.ready)return;
  await cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:s.x,y:s.y});
  await cdp.call('Input.dispatchMouseEvent',{type:'mouseWheel',x:s.x,y:s.y,deltaX:s.deltaX,deltaY:s.deltaY});await pause(50);
 }
 throw Error('Actual wheel cannot reach '+selector);
}
async function tap(selector){await settle();await reach(selector);await pointerClick(selector);}
async function fill(selector,text){await tap(selector);await key('a','KeyA',65,4);assert.equal(await evaluate('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');return document.activeElement===e&&(e.type==="number"||(e.selectionStart===0&&e.selectionEnd===e.value.length))})()'),true,'Actual select-all');await cdp.call('Input.insertText',{text});assert.equal(await evaluate('document.querySelector('+JSON.stringify(selector)+').value'),text);}
async function check(name,fn){await fn();checks[name]=true;steps.push(name);}
async function read(label){const s=await evaluate(`(()=>({heading:document.querySelector('.lcd-pagebar h1')?.textContent,detailName:document.querySelector('.lcd-left h2')?.textContent,form:!!document.querySelector('#biz-order-form'),segment:!!document.querySelector('#segment-form'),error:document.querySelector('#form-error')?.textContent,tab:document.querySelector('.lcd-tabs [aria-selected=true]')?.dataset.tab,list:[...document.querySelectorAll('.company-link')].map(e=>e.dataset.open),focus:document.activeElement?.id}))()`);observations.push({label,...s});return s;}
async function back(){await tap('.lcd-pagebar [data-action="list"]');await until(()=>evaluate('!!document.querySelector(".company-link")'),'return list');}
async function detail(name){await tap('[data-open="'+name+'"]');await until(()=>evaluate('!!document.querySelector(".lcd-pagebar [data-action=edit]")'),'detail '+name);}
async function openOrder(){await tap('[aria-label="新建销售订单"]');await settle();}
async function trade(){await tap('.lcd-tabs [data-tab="trade"]');await until(()=>evaluate('!!document.querySelector("[aria-label=新建销售订单]")'),'trade section');}
async function orderCancel(){await tap('[data-biz-action="close-editor"]');await until(()=>evaluate('!document.querySelector("#biz-order-form")'),'order cancelled');await settle();}
async function orderSubmit(){await tap('[form="biz-order-form"][type="submit"]');}
async function visibleSavedOrder(id){const selector='[data-lai-order="'+id+'"]';await settle();await reach(selector);await check('saved order link actually visible '+(await evaluate('innerWidth')),async()=>{assert.equal(await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y);return x>0&&x<innerWidth&&y>0&&y<innerHeight&&(e.contains(h)||h?.contains(e))})()`),true);});}
async function returned(label){await check(label,async()=>{assert.equal(await evaluate('document.querySelector(".lcd-left h2")?.textContent.trim()'),'Order Journey A');assert.equal(await evaluate('document.querySelector(".lcd-tabs [aria-selected=true]")?.dataset.tab'),'trade');assert.ok(await evaluate('!!document.querySelector("[aria-label=新建销售订单]")'));assert.equal(await evaluate('!!document.querySelector("#biz-order-form")'),false);});}
try{
 fs.mkdirSync(evidence,{recursive:true});backend=await startBackend();const seed=await snapshot();
 seed.data.customers={'Order Journey A':{contact:'Primary A',country:'US',source:'Referral',email:'a@example.test',unknown:{preserve:true},extraContacts:[{contact:'Legacy A',email:'legacy@example.test',address:'LEGACY ADDRESS',unknown:{legacy:true}}],history:[]},'Order Journey B':{contact:'Primary B',country:'CA',source:'Referral',unknown:{other:true},history:[]}};
 seed.data.orders=[{id:'order-keep',num:'KEEP-001',client:'Order Journey B',country:'CA',currency:'CAD',amount:42,paidAmount:0,stage:'quote',createdAt:'2026-09-01',orderMonth:'2026-09',attachments:[{id:'keep-doc'}],logs:[{text:'keep log'}],unknown:{preserve:true}}];seed.data.previewSegments=[];
 if(derivedCustomer){delete seed.data.customers['Order Journey A'];seed.data.orders[0].client='Order Journey A';}
 const fixture=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:seed,baseRevision:seed.revision})});assert.equal(fixture.status,200);fixtureSaves++;const initial=await snapshot();
 const port=await freePort(),browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps','--user-data-dir='+path.join(temporary,'chrome'),'--remote-debugging-port='+port,'about:blank'],{stdio:'ignore'});children.push(browser);let target;await until(async()=>{try{target=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(t=>t.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'private browser');cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Network.enable');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:1022,deviceScaleFactor:1,mobile:false});await navigate();await detail('Order Journey A');await trade();await openOrder();
 const opened=await evaluate('({form:!!document.querySelector("#biz-order-form"),placeholder:document.querySelector(".feature-dialog")?.textContent||""})');
 if(!opened.form){await frame('placeholder-baseline');assert.deepEqual(await snapshot(),initial);checks.placeholderDoesNotWrite=true;checks.actualOrderFormFromDetail=false;throw Error('PRODUCT_MISSING: customer-detail new sales order still opens placeholder instead of existing order form');}
 await check('detail entry opens existing order form prefilled with current customer only',async()=>{assert.equal(await evaluate('document.querySelector("#biz-order-form [name=client]").value'),'Order Journey A');assert.equal(await evaluate('document.querySelector("#biz-order-form [name=country]").value'),'');assert.deepEqual((await evaluate('[...document.querySelector("#biz-customer-names").options].map(o=>o.value)')).sort(),derivedCustomer?['Order Journey B']:['Order Journey A','Order Journey B']);assert.deepEqual(await snapshot(),initial);});
 await fill('#biz-order-form [name=client]','Order Journey B');await fill('#biz-order-form [name=amount]','55');await fill('#biz-order-form [name=note]','CANCELLED EDITABLE CUSTOMER');await frame('editable-customer-draft');await orderCancel();await returned('cancel returns original customer trade tab');
 await check('cancel editable customer draft writes nothing',async()=>{assert.deepEqual(await snapshot(),initial);assert.equal(cdp.uiSaves.length,0);});
 await openOrder();await check('reopen resets cancelled editable client to original customer',async()=>{assert.equal(await evaluate('document.querySelector("#biz-order-form [name=client]").value'),'Order Journey A');assert.equal(await evaluate('document.querySelector("#biz-order-form [name=note]").value'),'');});
 for(const [name,value] of [['num','DETAIL-001'],['amount','125.50'],['note','DETAIL SAVED NOTE']])await fill('#biz-order-form [name="'+name+'"]',value);
 await cdp.call('Network.setBlockedURLs',{urls:[backend.base+'/api/save']});await orderSubmit();await until(()=>evaluate('!!document.querySelector("#biz-order-error")?.textContent'),'transport failure');
 await check('save transport failure preserves inputs and retry controls',async()=>{assert.equal(await evaluate('document.querySelector("#biz-order-form [name=client]").value'),'Order Journey A');assert.equal(await evaluate('document.querySelector("#biz-order-form [name=num]").value'),'DETAIL-001');assert.equal(await evaluate('document.querySelector("#biz-order-form [name=amount]").value'),'125.50');assert.equal(await evaluate('document.querySelector("#biz-order-form [name=note]").value'),'DETAIL SAVED NOTE');assert.equal(await evaluate('document.querySelector("[form=biz-order-form][type=submit]").disabled'),false);assert.equal(await evaluate('document.querySelector("[data-biz-action=close-editor]").disabled'),false);assert.deepEqual(await snapshot(),initial);});await frame('save-failure-retains-input');
 await cdp.call('Network.setBlockedURLs',{urls:[]});await orderSubmit();await until(()=>evaluate('!document.querySelector("#biz-order-form")'),'retry complete');await settle();await returned('successful retry returns original customer trade tab');const saved=await snapshot(),added=saved.data.orders.find(o=>o.num==='DETAIL-001');
 await check('retry saves one associated order and preserves all other data',async()=>{assert.ok(added);assert.equal(added.client,'Order Journey A');assert.equal(added.amount,125.5);assert.equal(added.note,'DETAIL SAVED NOTE');assert.equal(saved.revision,initial.revision+1);assert.equal(saved.data.orders.length,2);assert.deepEqual(saved.data.orders.find(o=>o.id==='order-keep'),initial.data.orders[0]);assert.deepEqual(saved.data.customers,derivedCustomer?{...initial.data.customers,'Order Journey A':{client:'Order Journey A',country:'',owner:''}}:initial.data.customers);assert.deepEqual(saved.data.previewSegments,initial.data.previewSegments);assert.ok(await evaluate('document.querySelector(".lcd-root").textContent.includes("DETAIL-001")'));});await visibleSavedOrder(added.id);await frame('saved-order-trade-1756');
 await back();await detail('Order Journey A');await trade();await check('saved order visible after real list return and detail reopen',async()=>{assert.ok(await evaluate('document.querySelector(".lcd-root").textContent.includes("DETAIL-001")'));assert.deepEqual(await snapshot(),saved);});
 for(const width of [1100,900]){await cdp.call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await openOrder();await check('actual order form prefill visible width '+width,async()=>{assert.equal(await evaluate('document.querySelector("#biz-order-form [name=client]").value'),'Order Journey A');assert.deepEqual(await snapshot(),saved);});await frame('new-order-'+width);await orderCancel();await returned('narrow cancellation returns original trade '+width);await check('saved order stays visible width '+width,async()=>{assert.ok(await evaluate('document.querySelector(".lcd-root").textContent.includes("DETAIL-001")'));assert.deepEqual(await snapshot(),saved);});await visibleSavedOrder(added.id);await frame('saved-order-trade-'+width);}
 await stop(backend.child);backend=await startBackend();await check('entire saved snapshot survives isolated service restart',async()=>{assert.deepEqual(await snapshot(),saved);});await navigate();await detail('Order Journey A');await trade();await check('order visible after service restart and real UI reopen',async()=>{assert.ok(await evaluate('document.querySelector(".lcd-root").textContent.includes("DETAIL-001")'));assert.deepEqual(await snapshot(),saved);});await visibleSavedOrder(added.id);await frame('restart-order-trade-900');await check('no uncaught browser exception',async()=>assert.deepEqual(cdp.exceptions,[]));
 const report={result:'pass',derivedCustomer,checks,steps,observations,uiSaveRequests:cdp.uiSaves.length,syntheticFixtureApiSaves:fixtureSaves,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),probeSha256:crypto.createHash('sha256').update(fs.readFileSync(new URL(import.meta.url))).digest('hex'),scope:'Existing order form launched from synthetic customer detail, customer prefill/editability, cancel return, blocked save retains input then retry, saved linked order real reopen, 1100/900 display/cancel and isolated service restart. Formal native/GPU/original pixels/user acceptance excluded.'};fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({result:'pass',checks:Object.keys(checks).length,uiSaves:cdp.uiSaves.length}));
}catch(error){if(cdp)await read('failure').catch(()=>{});fs.writeFileSync(path.join(evidence,'failure.json'),JSON.stringify({error:error.message,checks,steps,observations,uiSaveRequests:cdp?.uiSaves.length,syntheticFixtureApiSaves:fixtureSaves,probeSha256:crypto.createHash('sha256').update(fs.readFileSync(new URL(import.meta.url))).digest('hex')},null,2));if(cdp)await frame('failure').catch(()=>{});throw error;}
finally{if(cdp)await cdp.call('Page.navigate',{url:'about:blank'}).catch(()=>{});cdp?.close();for(const child of [...children].reverse())await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});fs.writeFileSync(path.join(evidence,'cleanup.json'),JSON.stringify({temporaryRemoved:!fs.existsSync(temporary),children:children.map(child=>({pid:child.pid,exitCode:child.exitCode,signalCode:child.signalCode}))},null,2));assert.ok(children.every(child=>child.exitCode===0&&child.signalCode===null));}
