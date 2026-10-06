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
const evidence=path.resolve(process.env.LAI_SAVE_WAIT_EVIDENCE || 'evidence/ui-1.4.41/save-wait');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-save-wait-'));
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
    env:{...process.env,LAI_DATA_DIR:path.join(temporary,'database'),LAI_APP_PORT:String(port),LAI_API_TOKEN:token,LAI_INSTANCE_NONCE:'save-wait-test',LAI_APP_NO_OPEN:'1'},stdio:'ignore'});
  children.push(child);
  const base=`http://127.0.0.1:${port}`;
  await until(async()=>{if(child.exitCode!==null)throw Error('Isolated service exited');try{return (await fetch(base+'/api/health')).ok;}catch{return false;}},'isolated backend');
  return {child,base,token};
}
async function snapshot(){return (await fetch(backend.base+'/api/data',{headers:{'x-trade-token':backend.token}})).json();}
async function connect(url){
  const socket=new WebSocket(url);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let sequence=0;const pending=new Map();const paused=[];
  socket.addEventListener('message',event=>{const message=JSON.parse(String(event.data));if(message.method==='Fetch.requestPaused'){paused.push(message.params);return;}const request=pending.get(message.id);if(!request)return;pending.delete(message.id);clearTimeout(request.timer);if(message.error)request.reject(Error(message.error.message));else request.resolve(message.result);});
  return {paused,call(method,params={}){const id=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('Isolated browser command timed out: '+method))},5000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});},close(){socket.close();}};
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
 const point=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
 await cdp.call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
 await cdp.call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
}

async function route(name){await evaluate(`document.querySelector('.rail [data-lai-route="${name}"]').click()`);await until(()=>evaluate(`document.querySelector('.business-title')?.textContent`),'business route');}
async function action(name){await evaluate(`document.querySelector('[data-biz-action="${name}"]').click()`);}
async function cancel(){await action('close-editor');await until(()=>evaluate(`!document.querySelector('#biz-order-form')`),'editor cancelled');}
async function fill(values){await evaluate(`(()=>{const f=document.querySelector('#biz-order-form');for(const [key,value]of Object.entries(${JSON.stringify(values)})){const e=f.elements[key];if(e.type==='checkbox')e.checked=value;else e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));}})()`);}
async function submit(){await evaluate(`document.querySelector('#biz-order-form').requestSubmit(document.querySelector('[form="biz-order-form"][type="submit"]'))`);}
async function open(id){await evaluate(`document.querySelector('[data-biz-order="${id}"]').click()`);await until(()=>evaluate(`!!document.querySelector('#biz-order-form')`),'order editor');}

async function escape(){for(const type of ['keyDown','keyUp'])await cdp.call('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape'});}
async function pauseSave(){const n=cdp.paused.length;await submit();await until(()=>cdp.paused.length>n,'actual save request paused');return cdp.paused[n].requestId;}
try{
 fs.mkdirSync(evidence,{recursive:true});backend=await startBackend();const initial=await snapshot();
 const original={id:'order-base',num:'WAIT-001',client:'Existing Customer',country:'US',currency:'USD',amount:100,paidAmount:20,stage:'production',createdAt:'2026-09-01',orderMonth:'2026-09',attachments:[{id:'keep'}],unknown:{keep:true},note:'Original'};
 initial.data.customers={'Existing Customer':{country:'US',source:'Referral'}};initial.data.orders=[original];initial.data.laiTasks=[{id:'task-base',title:'Original task',date:'2026-09-12',done:false,unknown:'keep'}];
 const seeded=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:initial,baseRevision:initial.revision})});assert.equal(seeded.status,200);
 const port=await freePort();const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps',`--user-data-dir=${path.join(temporary,'chrome')}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});children.push(browser);
 let target;await until(async()=>{try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'browser');cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1728,height:958,deviceScaleFactor:1,mobile:false});await navigate();await route('order-list');const baseline=await snapshot();
 await open('order-base');await fill({note:'Unsaved close guard order'});
 assert.equal(await evaluate(`window.flushPendingSave()`),false);
 assert.equal(await evaluate(`document.querySelector('#biz-order-form').elements.note.value`),'Unsaved close guard order');
 await cancel();assert.equal(await evaluate(`window.flushPendingSave()`),true);assert.deepEqual(await snapshot(),baseline);
 checks.unsavedOrderBlocksCloseUntilExplicitCancellation=true;
 await navigate();await pointerClick('.company-link');await until(()=>evaluate(`!!document.querySelector('[data-tab="activity"]')`),'customer detail');
 await pointerClick('[data-tab="activity"]');
 await pointerClick('#followup-text');
 await evaluate(`(()=>{const d=document.querySelector('#followup-text');d.value='Unsaved close guard followup';d.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 assert.equal(await evaluate(`window.flushPendingSave()`),false);
 assert.equal(await evaluate(`document.querySelector('#followup-text').value`),'Unsaved close guard followup');
 await evaluate(`document.querySelector('#followup-text').blur()`);
 assert.equal(await evaluate(`document.querySelector('[data-action="cancel-followup"]').checkVisibility()`),true,'Draft actions must remain visible after input loses focus');
 checks.followupDraftActionsSurviveBlur=true;
 await evaluate(`document.querySelector('[data-action="cancel-followup"]').scrollIntoView({block:'center',behavior:'instant'})`);
 assert.equal(await evaluate(`(()=>{const b=document.querySelector('[data-action="cancel-followup"]'),r=b.getBoundingClientRect();return b.checkVisibility()&&document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('[data-action="cancel-followup"]')===b})()`),true,'Draft cancellation must be physically visible and hit-testable');
 await pointerClick('[data-action="cancel-followup"]');assert.equal(await evaluate(`window.flushPendingSave()`),true);assert.deepEqual(await snapshot(),baseline);
 checks.unsavedFollowupBlocksCloseUntilExplicitCancellation=true;
 await navigate();await route('order-list');
 await cdp.call('Fetch.enable',{patterns:[{urlPattern:backend.base+'/api/save',requestStage:'Request'}]});
 await open('order-base');await fill({note:'Retain this delayed failure'});let request=await pauseSave();
 await evaluate(`(()=>{window.__closeGuardResult='waiting';void window.flushPendingSave().then(value=>{window.__closeGuardResult=value;});})()`);
 assert.equal(await evaluate(`window.__closeGuardResult`),'waiting');
 await escape();assert.equal(await evaluate(`!!document.querySelector('#biz-order-form')`),true,'Escape must not dismiss an actual in-flight save');assert.equal(await evaluate(`document.querySelector('#biz-order-form').elements.note.value`),'Retain this delayed failure');assert.equal(await evaluate(`document.querySelector('[form="biz-order-form"][type="submit"]').disabled`),true);assert.deepEqual(await snapshot(),baseline);checks.inFlightOrderEscapeRetainsEditorAndNoPrematureWrite=true;
 await cdp.call('Fetch.failRequest',{requestId:request,errorReason:'ConnectionFailed'});await until(()=>evaluate(`!!document.querySelector('#biz-order-error')?.textContent`),'delayed failure');assert.equal(await evaluate(`document.querySelector('#biz-order-form').elements.note.value`),'Retain this delayed failure');assert.equal(await evaluate(`document.querySelector('[form="biz-order-form"][type="submit"]').disabled`),false);assert.deepEqual(await snapshot(),baseline);const failureText=await evaluate(`document.querySelector('#biz-order-error').textContent`);fs.writeFileSync(path.join(evidence,'failure-text.json'),JSON.stringify({actual:failureText},null,2));assert.ok(failureText.includes('本地数据服务')&&failureText.includes('尚未保存')&&failureText.includes('重试'),'Connection failure must explain in Chinese that content remains unsaved and retry is possible');await frame('order-failure-retains-input');await escape();assert.equal(await evaluate(`!!document.querySelector('#biz-order-form')`),false);assert.equal(await evaluate(`window.flushPendingSave()`),true);assert.deepEqual(await snapshot(),baseline);checks.delayedFailureKeepsInputAndEscapeCancelWritesNothing=true;
 assert.equal(await evaluate(`window.__closeGuardResult`),false);checks.closeGuardWaitsForPendingSaveAndRejectsFailure=true;
 await open('order-base');await fill({note:'Saved once after real delay'});request=await pauseSave();await escape();assert.equal(await evaluate(`!!document.querySelector('#biz-order-form')`),true);await cdp.call('Fetch.continueRequest',{requestId:request});await until(()=>evaluate(`!document.querySelector('#biz-order-form')`),'delayed success closes');const saved=await snapshot();assert.equal(saved.revision,baseline.revision+1);assert.equal(saved.data.orders.length,1);assert.equal(saved.data.orders[0].note,'Saved once after real delay');assert.deepEqual(saved.data.orders[0].attachments,[{id:'keep'}]);assert.deepEqual(saved.data.orders[0].unknown,{keep:true});assert.deepEqual(saved.data.customers,baseline.data.customers);assert.equal(await evaluate(`window.flushPendingSave()`),true);checks.delayedSuccessPersistsOnceAndKeepsMetadata=true;
 await route('calendar');await action('new-task');await evaluate(`(()=>{const f=document.querySelector('#biz-task-form');f.elements.title.value='Retain delayed task';f.elements.date.value='2026-09-12';})()`);const n=cdp.paused.length;await evaluate(`document.querySelector('#biz-task-form').requestSubmit(document.querySelector('[form="biz-task-form"][type="submit"]'))`);await until(()=>cdp.paused.length>n,'task save request paused');request=cdp.paused[n].requestId;await escape();assert.equal(await evaluate(`!!document.querySelector('#biz-task-form')`),true);assert.equal(await evaluate(`document.querySelector('#biz-task-form').elements.title.value`),'Retain delayed task');assert.deepEqual(await snapshot(),saved);await cdp.call('Fetch.failRequest',{requestId:request,errorReason:'ConnectionFailed'});await until(()=>evaluate(`!!document.querySelector('#biz-task-error')?.textContent`),'task delayed failure');assert.equal(await evaluate(`document.querySelector('#biz-task-form').elements.title.value`),'Retain delayed task');assert.equal(await evaluate(`document.querySelector('[form="biz-task-form"][type="submit"]').disabled`),false);await frame('task-failure-retains-input');await escape();assert.equal(await evaluate(`!!document.querySelector('#biz-task-form')`),false);assert.equal(await evaluate(`window.flushPendingSave()`),true);assert.deepEqual(await snapshot(),saved);checks.delayedTaskFailureRetainsInputAndCancelWritesNothing=true;
 await cdp.call('Fetch.disable');await navigate();await route('order-list');await open('order-base');assert.equal(await evaluate(`document.querySelector('#biz-order-form').elements.note.value`),'Saved once after real delay');await cancel();assert.deepEqual(await snapshot(),saved);checks.reloadReadsOnlySuccessfulDelayedWrite=true;
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({testedAt:new Date().toISOString(),result:'pass',app,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),checks,scope:'Disposable SQLite, real save requests paused at network boundary; no new fields/rules or formal/native save interruption'},null,2));console.log('PASS: '+Object.keys(checks).length+' save wait checks');
}catch(error){fs.writeFileSync(path.join(evidence,'progress.json'),JSON.stringify({checks,error:error.message},null,2));throw error;}
finally{if(cdp)await cdp.call('Fetch.disable').catch(()=>{});cdp?.close();for(const child of children)await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
