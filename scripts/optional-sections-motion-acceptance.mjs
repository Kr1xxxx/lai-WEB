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
const evidence=path.resolve(process.env.LAI_OPTIONAL_MOTION_EVIDENCE || 'evidence/optional-sections-motion');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-optional-motion-'));
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
async function fill(selector,value){await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);await settle();await pointerClick(selector);await evaluate(`document.querySelector(${JSON.stringify(selector)}).select()`);await cdp.call('Input.insertText',{text:value});}
async function prompt(){await until(()=>evaluate(`!!document.querySelector('.customer-editor-unsaved')||!document.querySelector('#customer-form')`),'close decision');assert.equal(await evaluate(`!!document.querySelector('.customer-editor-unsaved')`),true,'Unsaved customer input must show a close decision rather than disappear');assert.ok(await evaluate(`!!document.querySelector('#customer-form')`));}
async function discard(){await pointerClick('[data-action="discard-customer-editor"]');await until(()=>evaluate(`!document.querySelector('.overlay')`),'explicitly discarded editor');}
async function openEditor(name){await navigate();await pointerClick('[data-open="'+name+'"]');await until(()=>evaluate(`!!document.querySelector('.lcd-pagebar [data-action="edit"]')`),'detail');await pointerClick('.lcd-pagebar [data-action="edit"]');await until(()=>evaluate(`!!document.querySelector('#customer-form')`),'editor');await settle();}
async function save(){await pointerClick('[form="customer-form"][value="save"]');await until(()=>evaluate(`!document.querySelector('#customer-form')`),'saved');}

const company='#customer-form .ce-company-extra';
const contact=i=>`#customer-form [data-contact-card="${i}"] .ce-contact-extra`;
const observations=[];
async function action(section,open,keyboard=false){
 const selector=section+(open?' > summary':' .ce-collapse');
 await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);await settle();
 const previous=await evaluate(`[...document.querySelectorAll('#customer-form .ce-extra')].map(e=>e.open)`);
 await evaluate(`(()=>{const trigger=document.querySelector(${JSON.stringify(selector)});window.optionalObservation={samples:[],done:false};const out=window.optionalObservation;
 document.addEventListener('click',function collect(e){if(!trigger.contains(e.target))return;document.removeEventListener('click',collect);const start=performance.now();
 const sample=()=>{const sections=[...document.querySelectorAll('#customer-form .ce-extra')].map(section=>{const content=section.querySelector('.ce-extra-content'),style=getComputedStyle(content);return {open:section.open,focusSummary:document.activeElement===section.querySelector('summary'),focusCollapse:document.activeElement===section.querySelector('.ce-collapse'),opacity:Number(style.opacity),transform:style.transform,animation:style.animationName,animations:content.getAnimations().filter(a=>a.playState==='running').length}});out.samples.push({ms:performance.now()-start,sections});if(performance.now()-start<220)requestAnimationFrame(sample);else out.done=true;};queueMicrotask(sample);
 });})()`);
 if(keyboard){await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});}else await pointerClick(selector);
 await until(()=>evaluate('window.optionalObservation.done'),'optional action sampled');const result=await evaluate('window.optionalObservation');observations.push({section,open,keyboard,...result});
 const index=section===company?0:Number(section.match(/data-contact-card="(\d+)"/)[1])+1;
 assert.ok(result.samples.length>=5);
 assert.ok(result.samples.every(s=>s.sections[index].open===open),'Section must immediately reach requested state');
 assert.ok(result.samples.every(s=>s.sections.every((r,i)=>i===index||r.open===previous[i])),'Other optional sections must retain their independent state');
 assert.ok(result.samples.every(s=>s.sections.filter(r=>r.open).every(r=>r.opacity===1&&r.transform==='none'&&r.animation==='none'&&r.animations===0)),'No artificial optional-content entrance');
 assert.ok(result.samples.every(s=>open?s.sections[index].focusCollapse:s.sections[index].focusSummary),'Focus must remain on the visible action in this optional section');
 return result;
}
const fixture={country:'US',source:'Synthetic',contact:'Primary',email:'primary@example.test',phone:'555',address:'primary-address',contactNote:'primary-note',unknownCustomer:{keep:true},extraContacts:[{id:'optional-second-id',contact:'Second',email:'second@example.test',phone:'222',address:'second-address',contactNote:'second-note',unknownExtra:'keep'}]};
try{
 fs.mkdirSync(evidence,{recursive:true});assert.equal(fs.existsSync(path.join(resources,'trade-order-data.json')),false,'No production seed');backend=await startBackend();const empty=await snapshot();assert.equal(Object.keys(empty.data.customers).length,0);assert.equal(empty.data.orders.length,0);
 empty.data.customers={'Optional Fixture':fixture};assert.equal((await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:empty,baseRevision:empty.revision})})).status,200);
 const port=await freePort();const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps',`--user-data-dir=${path.join(temporary,'chrome')}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});children.push(browser);let target;await until(async()=>{try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'browser');cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:1022,deviceScaleFactor:1,mobile:false});
 const baseline=await snapshot();await openEditor('Optional Fixture');
 const initialValues=await evaluate(`[...document.querySelectorAll('#customer-form input,#customer-form textarea,#customer-form select')].map(e=>({name:e.name,value:e.value}))`);
 for(const keyboard of [false,true]){
  for(const section of [company,contact(0),contact(1)]){await action(section,true,keyboard);checks[(keyboard?'keyboard':'pointer')+section+'Open']=true;}
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('#customer-form .ce-extra')].map(e=>e.open)`),[true,true,true]);checks[(keyboard?'keyboard':'pointer')+'AllThreeIndependentOpen']=true;
  for(const section of [contact(0),company,contact(1)]){await action(section,false,keyboard);checks[(keyboard?'keyboard':'pointer')+section+'Close']=true;}
 }
 await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await action(company,true);await action(company,false);checks.reducedMotionImmediateAndFocused=true;await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 for(let i=0;i<4;i++){
  const selector=company+(i%2?' .ce-collapse':' > summary');
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
  await pointerClick(selector);
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(company)}).open`),i%2===0);
 }
 assert.deepEqual(await evaluate(`[...document.querySelectorAll('#customer-form .ce-extra')].map(e=>e.open)`),[false,false,false]);checks.successivePointerReversalsKeepIndependentFinalState=true;
 assert.deepEqual(await evaluate(`[...document.querySelectorAll('#customer-form input,#customer-form textarea,#customer-form select')].map(e=>({name:e.name,value:e.value}))`),initialValues);checks.allExistingValuesSurviveToggleOnly=true;
 await pointerClick('.ce-footer [data-action="close-modal"]');await until(()=>evaluate(`!document.querySelector('.overlay')`),'unchanged optional draft closes');assert.deepEqual(await snapshot(),baseline);checks.openCloseOnlyDoesNotDirtyOrWrite=true;
 await openEditor('Optional Fixture');await action(company,true);await action(contact(0),true);await action(contact(1),true);
 await fill(`${contact(0)} [name="address"]`,'primary-draft');await fill(`${contact(1)} [name="addressExtra"]`,'second-draft');
 await action(contact(0),false);await action(company,false);await action(contact(1),false);
 assert.equal(await evaluate(`document.querySelector('#customer-form [name="address"]').value`),'primary-draft');assert.equal(await evaluate(`document.querySelector('#customer-form [name="addressExtra"]').value`),'second-draft');checks.collapsingKeepsPerContactUnsavedValues=true;
 await pointerClick('.ce-footer [data-action="close-modal"]');await prompt();await pointerClick('[data-action="continue-customer-editor"]');await action(contact(0),true);await action(contact(1),true);
 assert.equal(await evaluate(`document.querySelector('#customer-form [name="address"]').value`),'primary-draft');assert.equal(await evaluate(`document.querySelector('#customer-form [name="addressExtra"]').value`),'second-draft');checks.continueEditingKeepsBothDrafts=true;
 await pointerClick('.ce-footer [data-action="close-modal"]');await prompt();await discard();assert.deepEqual(await snapshot(),baseline);checks.discardOptionalDraftsDoesNotWrite=true;
 await openEditor('Optional Fixture');assert.deepEqual(await evaluate(`[...document.querySelectorAll('#customer-form .ce-extra')].map(e=>e.open)`),[false,false,false]);assert.equal(await evaluate(`document.querySelector('#customer-form [name="address"]').value`),fixture.address);assert.equal(await evaluate(`document.querySelector('#customer-form [name="addressExtra"]').value`),fixture.extraContacts[0].address);checks.reopenRestoresSavedValuesAndCollapsedSections=true;
 await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:720,deviceScaleFactor:1,mobile:false});await settle();await action(company,true,true);await action(contact(1),true,true);
 assert.ok(await evaluate(`(()=>{const r=document.activeElement.getBoundingClientRect(),body=document.querySelector('.ce-body').getBoundingClientRect();return r.top>=body.top&&r.bottom<=body.bottom&&r.width>0;})()`),'Expanded action remains visible in compact scroll body');checks.compactKeyboardFocusInsideScrollBody=true;
 await frame('optional-sections-1100');await action(company,false,true);await action(contact(1),false,true);await pointerClick('.ce-footer [data-action="close-modal"]');await until(()=>evaluate(`!document.querySelector('.overlay')`),'compact draft closed');assert.deepEqual(await snapshot(),baseline);checks.compactToggleOnlyDoesNotWrite=true;
 await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:1022,deviceScaleFactor:1,mobile:false});await navigate();await pointerClick('.top-actions [data-action="new"]');await until(()=>evaluate(`!!document.querySelector('#customer-form')`),'new drawer');await settle();
 for(const section of [company,contact(0)]){await action(section,true);checks['new'+section+'OpenFocused']=true;}await frame('optional-sections-new-1756');for(const section of [company,contact(0)])await action(section,false);await pointerClick('.ce-footer [data-action="close-modal"]');await until(()=>evaluate(`!document.querySelector('.overlay')`),'blank new draft closed');assert.deepEqual(await snapshot(),baseline);checks.newBlankToggleOnlyDoesNotDirtyOrWrite=true;
 await openEditor('Optional Fixture');await action(contact(1),true);await fill(`${contact(1)} [name="addressExtra"]`,'second-saved-address');await action(contact(1),false);await save();const saved=await snapshot();assert.equal(saved.revision,baseline.revision+1);const profile=saved.data.customers['Optional Fixture'];assert.equal(profile.address,fixture.address);assert.equal(profile.contactNote,fixture.contactNote);assert.deepEqual(profile.unknownCustomer,fixture.unknownCustomer);assert.equal(profile.extraContacts[0].id,fixture.extraContacts[0].id);assert.equal(profile.extraContacts[0].unknownExtra,'keep');assert.equal(profile.extraContacts[0].contactNote,fixture.extraContacts[0].contactNote);assert.equal(profile.extraContacts[0].address,'second-saved-address');checks.saveCollapsedExtraOnlyKeepsIdentityOwnershipAndUnknownFields=true;
 await stop(backend.child);backend=await startBackend();assert.deepEqual(await snapshot(),saved);checks.restartPreservesWholeSavedState=true;
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({result:'pass',htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),checks,observations,nativePixelsUserAcceptance:'not completed'},null,2));console.log('PASS: '+Object.keys(checks).length+' optional checks');
}catch(error){fs.writeFileSync(path.join(evidence,'failure.json'),JSON.stringify({error:error.message,checks,observations},null,2));throw error;}
finally{cdp?.close();for(const child of children)await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
