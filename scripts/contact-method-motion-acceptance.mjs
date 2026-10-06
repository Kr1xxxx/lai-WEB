import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

// Exercise the shipped editor and SQLite service with disposable customers only.
const app=path.resolve(process.env.LAI_ACCEPTANCE_APP || 'dist/来财Lai.app');
const resources=path.join(app,'Contents/Resources');
const evidence=path.resolve(process.env.LAI_CONTACT_METHOD_EVIDENCE || 'evidence/contact-method-motion');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-method-motion-'));
const children=[];
const checks={};
let cdp, backend;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const freePort=()=>new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
async function until(check,label){for(let i=0;i<160;i++){if(await check())return;await pause(50);}throw Error('Timed out: '+label);}
async function stop(child){if(!child||child.exitCode!==null)return;child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),pause(1500)]);if(child.exitCode===null)child.kill('SIGKILL');}
async function startBackend(){
  const port=await freePort(),token=crypto.randomBytes(32).toString('hex');
  const child=spawn(path.join(resources,'node-runtime'),[path.join(resources,'server.js')],{
    env:{...process.env,LAI_DATA_DIR:path.join(temporary,'database'),LAI_APP_PORT:String(port),LAI_API_TOKEN:token,LAI_INSTANCE_NONCE:'company-fields-test',LAI_APP_NO_OPEN:'1'},stdio:'ignore'});
  children.push(child);
  const base=`http://127.0.0.1:${port}`;
  await until(async()=>{if(child.exitCode!==null)throw Error('Isolated service exited');try{return (await fetch(base+'/api/health')).ok;}catch{return false;}},'isolated backend');
  return {child,base,token};
}
async function snapshot(){return (await fetch(backend.base+'/api/data',{headers:{'x-trade-token':backend.token}})).json();}
async function connect(url){
  const socket=new WebSocket(url);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let sequence=0;const pending=new Map();
  socket.addEventListener('message',event=>{const message=JSON.parse(String(event.data));const request=pending.get(message.id);if(!request)return;pending.delete(message.id);clearTimeout(request.timer);if(message.error)request.reject(Error(message.error.message));else request.resolve(message.result);});
  return {call(method,params={}){const id=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('Isolated browser command timed out: '+method))},5000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});},close(){socket.close();}};
}
async function evaluate(expression){const result=await cdp.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;}
async function navigate(){await cdp.call('Page.navigate',{url:backend.base+'/trade-order-system.html?token='+encodeURIComponent(backend.token)+'#customers'});await until(()=>evaluate(`!!document.querySelector('.company-link')`),'customer list');}
async function frame(name){
 await until(()=>evaluate(`!document.querySelector('#toast')?.classList.contains('show')`),'toast finished');
 await until(()=>evaluate(`!document.getAnimations().some(a=>a.playState==='running'&&a.effect.getTiming().iterations!==Infinity)`),'finite screenshot animations settled');
 await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
 const result=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(evidence,name+'.png'),Buffer.from(result.data,'base64'));}

async function pointerClick(selector){
 await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
 const point=await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)}),r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);if(!r.width||!r.height||!(el.contains(hit)||hit?.contains(el)))throw Error('Pointer target is hidden or covered: '+${JSON.stringify(selector)}+' '+JSON.stringify({x,y,rect:r.toJSON(),hit:hit?.className,overlay:el.closest('.overlay')?.className,animations:document.getAnimations().map(a=>({state:a.playState,time:a.currentTime,target:a.effect.target.className}))}));return {x,y}})()`);
 await cdp.call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
 await cdp.call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
}

async function settle(){await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);await until(()=>evaluate(`!document.getAnimations().some(a=>a.playState==='running'&&a.effect.getTiming().iterations!==Infinity)`),'drawer settled');}
async function fill(selector,value){await pointerClick(selector);await evaluate(`document.querySelector(${JSON.stringify(selector)}).select()`);await cdp.call('Input.insertText',{text:value});}
async function prompt(){await until(()=>evaluate(`!!document.querySelector('.customer-editor-unsaved')||!document.querySelector('#customer-form')`),'close decision');assert.equal(await evaluate(`!!document.querySelector('.customer-editor-unsaved')`),true,'Unsaved customer input must show a close decision rather than disappear');assert.ok(await evaluate(`!!document.querySelector('#customer-form')`));}
async function discard(){await pointerClick('[data-action="discard-customer-editor"]');await until(()=>evaluate(`!document.querySelector('.overlay')`),'explicitly discarded editor');}
async function openEditor(name){await navigate();await pointerClick('[data-open="'+name+'"]');await until(()=>evaluate(`!!document.querySelector('.lcd-pagebar [data-action="edit"]')`),'detail');await pointerClick('.lcd-pagebar [data-action="edit"]');await until(()=>evaluate(`!!document.querySelector('#customer-form')`),'editor');await settle();}
async function save(){await pointerClick('[form="customer-form"][value="save"]');await until(()=>evaluate(`!document.querySelector('#customer-form')`),'saved');}

const observations=[];
const card=i=>`#customer-form [data-contact-card="${i}"]`;
const list=(i,kind)=>`${card(i)} [data-method-list="${kind}"]`;
const add=(i,kind)=>`${card(i)} [data-editor-action="add-method"][data-method-type="${kind}"]`;
async function clickVisible(selector){await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);await pointerClick(selector);}
async function recordAction(selector,listSelector,keyboard=false){
 await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);await settle();
 await evaluate(`(()=>{
  const selector=${JSON.stringify(selector)},listSelector=${JSON.stringify(listSelector)},trigger=document.querySelector(selector);
  window.methodObservation={samples:[],before:[],done:false};const out=window.methodObservation;
  const read=()=>[...document.querySelector(listSelector).children].map(row=>{
   const s=getComputedStyle(row),r=row.getBoundingClientRect();return {id:row.dataset.methodId,top:r.top,height:r.height,opacity:Number(s.opacity),transform:s.transform,animation:s.animationName,duration:s.animationDuration,value:row.querySelector('[data-method-value]').value};
  });out.before=read();
  document.addEventListener('click',function capture(event){
   if(!trigger.contains(event.target))return;document.removeEventListener('click',capture);
   out.detail=event.detail;const start=performance.now();
   const sample=()=>{out.samples.push({ms:performance.now()-start,rows:read(),focus:{drawer:document.activeElement.classList.contains('drawer'),methodValue:document.activeElement.hasAttribute('data-method-value'),methodAdd:document.activeElement.dataset.editorAction==='add-method'}});if(performance.now()-start<220)requestAnimationFrame(sample);else out.done=true;};
   queueMicrotask(sample);
  });
 })()`);
 if(keyboard){await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});}
 else await pointerClick(selector);
 await until(()=>evaluate(`window.methodObservation.done`),'method action RAF');const result=await evaluate(`window.methodObservation`);observations.push({selector,listSelector,keyboard,...result});
 return result;
}
function immediateRows(result){
 assert.ok(result.samples.length>=5,'Record the event microtask and multiple RAF samples');
 assert.ok(result.samples.every(s=>s.rows.every(r=>r.opacity===1&&r.transform==='none'&&r.animation==='none')),'Source sampled rows are immediately opaque and untransformed; candidate must not add a 140ms entrance');
 assert.ok(result.samples.every(s=>s.rows.every((r,i)=>r.height===32&&(!i||Math.abs(r.top-s.rows[i-1].top-52)<.1))),'Observed source additional rows are 32px tall with 20px gaps');
}
const fixture={country:'US',source:'Synthetic',contact:'Primary',email:'primary@example.test',phone:'555',
 additionalPhones:[{id:'phone-primary',phoneCountryCode:'+1',phone:'111',historicalReference:{keep:'primary-phone'}}],
 additionalSocialAccounts:[{id:'social-primary',socialPlatform:'LinkedIn',socialAccount:'primary-team',historicalReference:'primary-social'}],
 extraContacts:[{id:'extra-stable',contact:'Second',email:'second@example.test',phone:'222',historicalReference:'second-only',additionalPhones:[{id:'phone-second',phoneCountryCode:'+44',phone:'333',unknownMethod:'second-only'}]}],unknownCustomer:{keep:true}};
try{
 fs.mkdirSync(evidence,{recursive:true});assert.equal(fs.existsSync(path.join(resources,'trade-order-data.json')),false,'No production seed in test app');
 backend=await startBackend();const empty=await snapshot();assert.equal(Object.keys(empty.data.customers).length,0);assert.equal(empty.data.orders.length,0);
 empty.data.customers={'Methods Fixture':fixture};const seeded=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:empty,baseRevision:empty.revision})});assert.equal(seeded.status,200);
 const port=await freePort();const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps',`--user-data-dir=${path.join(temporary,'chrome')}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});children.push(browser);
 let target;await until(async()=>{try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'browser');cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:1022,deviceScaleFactor:1,mobile:false});
 const baseline=await snapshot();await openEditor('Methods Fixture');
 const first=await recordAction(add(0,'phone'),list(0,'phone'));fs.writeFileSync(path.join(evidence,'pointer-phone-observation.json'),JSON.stringify(first,null,2));
 immediateRows(first);assert.equal(first.detail,1);assert.equal(first.samples[0].rows.length,2);assert.equal(first.samples[0].focus.drawer,true);checks.pointerPhoneImmediateAndDrawerFocused=true;
 assert.ok(first.samples.every(s=>s.rows[0].id===first.before[0].id&&s.rows[0].top===first.before[0].top&&s.rows[0].value==='111'));checks.previousRowDoesNotMoveOrLoseValue=true;
 const social=await recordAction(add(0,'social'),list(0,'social'));immediateRows(social);assert.equal(social.samples[0].rows.length,2);checks.pointerSocialImmediate=true;
 checks.sampledAdditionalRowsKeepSource32pxHeightAnd52pxPitch=true;
 const remove=await recordAction(`${list(0,'phone')} [data-method-row]:last-child [data-editor-action="remove-method"]`,list(0,'phone'));immediateRows(remove);assert.ok(remove.samples.every(s=>s.rows.length===1&&s.rows[0].value==='111'));assert.equal(remove.samples[0].focus.drawer,true);checks.pointerDeleteImmediateAndOtherRowRetained=true;
 const keyed=await recordAction(add(1,'phone'),list(1,'phone'),true);immediateRows(keyed);assert.equal(keyed.detail,0);assert.equal(keyed.samples[0].focus.methodValue,true);checks.keyboardAddImmediateAndInputFocused=true;
 const keyRemove=await recordAction(`${list(1,'phone')} [data-method-row]:last-child [data-editor-action="remove-method"]`,list(1,'phone'),true);immediateRows(keyRemove);assert.equal(keyRemove.samples[0].focus.methodAdd,true);checks.keyboardDeleteRestoresAddFocus=true;
 // Dispatch successive physical clicks without waiting for entrance completion.
 const rapidBefore=await evaluate(`[...document.querySelector(${JSON.stringify(list(1,'phone'))}).children].map(r=>({id:r.dataset.methodId,value:r.querySelector('[data-method-value]').value}))`);
 await evaluate(`document.querySelector(${JSON.stringify(add(1,'phone'))}).scrollIntoView({block:'center',behavior:'instant'})`);await settle();
 for(let i=0;i<2;i++){
  const point=await evaluate(`(()=>{const b=document.querySelector(${JSON.stringify(add(1,'phone'))}),r=b.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(!b.contains(document.elementFromPoint(x,y)))throw Error('Rapid add target covered');return{x,y};})()`);
  for(const type of ['mousePressed','mouseReleased'])await cdp.call('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
 }
 await clickVisible(`${list(1,'phone')} [data-method-row]:last-child [data-editor-action="remove-method"]`);
 const rapidAfter=await evaluate(`[...document.querySelector(${JSON.stringify(list(1,'phone'))}).children].map(r=>({id:r.dataset.methodId,value:r.querySelector('[data-method-value]').value,animation:getComputedStyle(r).animationName}))`);
 assert.equal(rapidAfter.length,rapidBefore.length+1);assert.equal(rapidAfter[0].id,rapidBefore[0].id);assert.equal(rapidAfter[0].value,rapidBefore[0].value);assert.ok(rapidAfter.every(r=>r.animation==='none'));checks.successivePointerAddsAndRemoveKeepIdentityAndSingleNewRow=true;
 await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});const reduced=await recordAction(add(1,'social'),list(1,'social'));immediateRows(reduced);checks.reducedMotionHasNoExtraEntrance=true;await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 await frame('method-rows-1756');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:720,deviceScaleFactor:1,mobile:false});await settle();await frame('method-rows-1100');
 await pointerClick('.ce-footer [data-action="close-modal"]');await prompt();await discard();assert.deepEqual(await snapshot(),baseline);checks.cancelAllMethodDraftsDoesNotWrite=true;
 await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:1022,deviceScaleFactor:1,mobile:false});await openEditor('Methods Fixture');
 await clickVisible(add(1,'social'));await fill(`${list(1,'social')} [data-method-row]:last-child [data-method-value]`,'second-team');await evaluate(`document.querySelector(${JSON.stringify(list(1,'social')+' [data-method-select]')}).value='LinkedIn';document.querySelector(${JSON.stringify(list(1,'social')+' [data-method-select]')}).dispatchEvent(new Event('change',{bubbles:true}));`);
 await save();const saved=await snapshot();assert.equal(saved.revision,baseline.revision+1);const profile=saved.data.customers['Methods Fixture'];assert.deepEqual(profile.additionalPhones,fixture.additionalPhones);assert.deepEqual(profile.additionalSocialAccounts,fixture.additionalSocialAccounts);assert.deepEqual(profile.unknownCustomer,fixture.unknownCustomer);assert.equal(profile.extraContacts[0].id,'extra-stable');assert.equal(profile.extraContacts[0].historicalReference,'second-only');assert.deepEqual(profile.extraContacts[0].additionalPhones,fixture.extraContacts[0].additionalPhones);assert.equal(profile.extraContacts[0].additionalSocialAccounts[0].socialAccount,'second-team');checks.singleSaveRetainsMethodIdentityUnknownFieldsAndContactOwnership=true;
 await stop(backend.child);backend=await startBackend();assert.deepEqual(await snapshot(),saved);checks.restartPreservesWholeSavedState=true;
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({result:'pass',testedAt:new Date().toISOString(),htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),checks,observations,sourceComparison:'235 discrete DOM samples; no exact source RAF/GPU claim',nativePixelsUserAcceptance:'not completed'},null,2));console.log('PASS: '+Object.keys(checks).length+' method motion and data checks');
}catch(error){fs.writeFileSync(path.join(evidence,'failure.json'),JSON.stringify({error:error.message,checks,observations},null,2));throw error;}
finally{cdp?.close();for(const child of children)await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
