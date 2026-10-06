import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

// Exercise existing analysis with disposable orders and SQLite only.
const app=path.resolve(process.env.LAI_ACCEPTANCE_APP || 'dist/来财Lai.app');
const resources=path.join(app,'Contents/Resources');
const evidence=path.resolve(process.env.LAI_FOCUS_DRAFT_EVIDENCE || 'evidence/ui-1.4.30/focus-drafts');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-focus-drafts-'));
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
    env:{...process.env,LAI_DATA_DIR:path.join(temporary,'database'),LAI_APP_PORT:String(port),LAI_API_TOKEN:token,LAI_INSTANCE_NONCE:'focus-drafts-test',LAI_APP_NO_OPEN:'1'},stdio:'ignore'});
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
 await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
 await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
 const point=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
 await cdp.call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
 await cdp.call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
}




async function route(name){await evaluate(`document.querySelector('[data-lai-route="${name}"]').click()`);await until(()=>evaluate(`location.hash==='#${name}'`),'route '+name);}
async function settingsDraft(value){await evaluate(`(()=>{const i=document.querySelector('#biz-settings-form').elements.companyName;i.value=${JSON.stringify(value)};i.dispatchEvent(new Event('input',{bubbles:true}))})()`);}
async function companyName(){return evaluate(`document.querySelector('#biz-settings-form').elements.companyName.value`);}
async function focus(){await evaluate(`(async()=>{window.dispatchEvent(new Event('focus'));await window.__focusProbe.promise;})()`);}
async function discard(){await evaluate(`document.querySelector('[data-biz-action="discard-settings"]').click()`);}
async function externalCompany(value){const current=await snapshot();current.data.laiSettings.companyName=value;const res=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:current,baseRevision:current.revision})});assert.equal(res.status,200);return snapshot();}
try{
 fs.mkdirSync(evidence,{recursive:true});backend=await startBackend();const initial=await snapshot();
 initial.data.customers={'Focus Customer':{country:'US',unknown:{kept:true}}};initial.data.orders=[{id:'focus-order',num:'FOCUS-001',client:'Focus Customer',currency:'USD',amount:100,paidAmount:0,stage:'quote',createdAt:'2026-09-14',orderMonth:'2026-09'}];initial.data.laiTasks=[];initial.data.laiSettings={companyName:'Saved Company',orderPrefix:'F',defaultCurrency:'USD',defaultOwner:'Synthetic Owner',unknown:{kept:true}};
 const seed=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:initial,baseRevision:initial.revision})});assert.equal(seed.status,200);
 const port=await freePort();const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps',`--user-data-dir=${path.join(temporary,'chrome')}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});children.push(browser);
 let target;await until(async()=>{try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'browser');cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1728,height:958,deviceScaleFactor:1,mobile:false});
 // Emulate only the native bridge availability and the focus event boundary.
 // The actual shipped focus listener, data service and settings form run unchanged.
 await cdp.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.webkit={messageHandlers:{windowDragRegions:{postMessage(){}}}};window.__focusProbe={reads:0,hold:false,waiting:false,promise:Promise.resolve()};const originalAdd=window.addEventListener.bind(window);window.addEventListener=function(type,fn,...options){if(type==='focus')return originalAdd(type,function(event){window.__focusProbe.promise=Promise.resolve(fn.call(this,event));},...options);return originalAdd(type,fn,...options);};const originalFetch=window.fetch.bind(window);window.fetch=async function(input,init){if(input==='/api/data'&&(!init?.method||init.method==='GET')){const probe=window.__focusProbe;probe.reads++;const response=await originalFetch(input,init);if(probe.hold){probe.waiting=true;await new Promise(resolve=>probe.release=resolve);probe.waiting=false;}return response;}return originalFetch(input,init);};`});
 await navigate();
 await pointerClick('[data-action="profile-menu"]');
 assert.equal(await evaluate(`document.querySelectorAll('.popover [data-lai-route="settings"]').length`),1);
 await pointerClick('.popover [data-lai-route="settings"]');
 await until(()=>evaluate(`location.hash==='#settings'&&!!document.querySelector('#biz-settings-form')`),'profile route to settings');
 const profileRouteObservation=await evaluate(`({route:location.hash,menus:[...document.querySelectorAll('.popover')].map(m=>({text:m.textContent,anchorConnected:m._trigger?.isConnected})),settingsVisible:!!document.querySelector('#biz-settings-form')})`);
 fs.writeFileSync(path.join(evidence,'profile-route-observation.json'),JSON.stringify(profileRouteObservation,null,2));await frame('profile-route-to-settings');
 assert.equal(profileRouteObservation.menus.length,0,'After changing page the old profile menu must disappear');
 checks.profileMenuClosesOnSettingsRoute=true;
 await route('dashboard');await route('settings');const baseline=await snapshot();
 const settingsIdentity=await evaluate(`Array.from(document.querySelectorAll('.settings-layout h3'),h=>h.textContent)`);assert.ok(settingsIdentity.includes('来财Lai'));assert.ok(!settingsIdentity.some(t=>/^来财Lai\\s+\\d/.test(t)));checks.settingsIdentityHasNoObsoleteVersion=true;await frame('settings-current-copy');
 await settingsDraft('Local unsaved company');const external=await externalCompany('External company one');await evaluate(`window.__focusProbe.reads=0`);await focus();const first={value:await companyName(),guard:await evaluate(`window.flushPendingSave().then(ok=>!ok)`),reads:await evaluate(`window.__focusProbe.reads`)};fs.writeFileSync(path.join(evidence,'existing-draft-observation.json'),JSON.stringify(first,null,2));assert.equal(first.value,'Local unsaved company','Focus refresh must not replace unsaved settings');assert.equal(first.guard,true);assert.equal(first.reads,0);assert.deepEqual(await snapshot(),external);checks.existingSettingsDraftSurvivesFocusAndKeepsGuard=true;await frame('existing-draft-retained');await pointerClick('[data-action="profile-menu"]');await pointerClick('.popover [data-lai-route="settings"]');assert.equal(await companyName(),'Local unsaved company');assert.equal(await evaluate(`window.flushPendingSave()`),false);assert.equal(await evaluate(`document.querySelectorAll('.popover').length`),1);assert.deepEqual(await snapshot(),external);checks.draftBlockedNavigationPreservesInputAndMenu=true;await pointerClick('#biz-settings-form [name="companyName"]');
 await discard();assert.equal(await companyName(),'Saved Company');await focus();assert.equal(await companyName(),'External company one');assert.equal(await evaluate(`window.flushPendingSave()`),true);checks.discardThenFocusLoadsNewRevision=true;
 await pointerClick('[data-action="profile-menu"]');await focus();
 assert.equal(await evaluate(`document.querySelectorAll('.popover').length`),1,'No revision change should not remount the page or dismiss an active menu');
 await externalCompany('External company refreshed menu');await focus();
 assert.equal(await companyName(),'External company refreshed menu');
 assert.equal(await evaluate(`document.querySelectorAll('.popover').length`),0,'A refreshed page must release a menu anchored to its old DOM');
 checks.focusRefreshReleasesStaleMenuOnlyWhenRemounted=true;
 const secondExternal=await externalCompany('External company two');await evaluate(`window.__focusProbe.hold=true;window.dispatchEvent(new Event('focus'))`);await until(()=>evaluate(`window.__focusProbe.waiting`),'held data response');await settingsDraft('Draft started during read');await evaluate(`(async()=>{window.__focusProbe.hold=false;window.__focusProbe.release();await window.__focusProbe.promise;})()`);assert.equal(await companyName(),'Draft started during read');assert.equal(await evaluate(`window.flushPendingSave()`),false);assert.deepEqual(await snapshot(),secondExternal);checks.settingsDraftStartedDuringDataReadRetained=true;
 await evaluate(`document.querySelector('#biz-settings-form').requestSubmit()`);await until(()=>evaluate(`!!document.querySelector('#biz-settings-error').textContent`),'settings revision conflict');assert.equal(await companyName(),'Draft started during read');assert.equal(await evaluate(`document.querySelector('#biz-settings-form [type="submit"]').disabled`),false);assert.deepEqual(await snapshot(),secondExternal);checks.staleSettingsSaveShowsConflictAndKeepsDraft=true;await frame('conflict-retains-settings');
 await discard();await focus();assert.equal(await companyName(),'External company two');await settingsDraft('Saved after refresh');await evaluate(`document.querySelector('#biz-settings-form').requestSubmit()`);await until(async()=>(await snapshot()).data.laiSettings.companyName==='Saved after refresh','fresh settings saved');assert.equal(await evaluate(`window.flushPendingSave()`),true);const saved=await snapshot();assert.deepEqual(saved.data.customers,baseline.data.customers);assert.deepEqual(saved.data.orders,baseline.data.orders);assert.deepEqual(saved.data.laiSettings.unknown,{kept:true});checks.explicitSaveAfterRefreshPreservesCustomersOrdersAndUnknownSettings=true;
 await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:720,deviceScaleFactor:1,mobile:false});await frame('settings-1100');await settingsDraft('Cancel at small size');await focus();assert.equal(await companyName(),'Cancel at small size');await discard();assert.equal(await companyName(),'Saved after refresh');assert.deepEqual(await snapshot(),saved);checks.smallWindowFocusCancelDoesNotWrite=true;
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({testedAt:new Date().toISOString(),result:'pass',app,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),checks,profileRouteObservation,nativeBridge:'availability emulated; focus callback from shipped app; exact native focus timing not measured',realDataWrites:false,scope:'Existing settings draft and focus refresh only; disposable SQLite/Chrome; no new fields or real settings mutation'},null,2));console.log('PASS: '+Object.keys(checks).length+' focus/settings draft checks');
}catch(error){console.error(error.stack);fs.writeFileSync(path.join(evidence,'progress.json'),JSON.stringify({checks,error:error.message,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex')},null,2));if(cdp)await frame('failure').catch(()=>{});throw error;}
finally{cdp?.close();for(const child of children)await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
