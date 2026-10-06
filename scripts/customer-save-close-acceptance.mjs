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
const evidence=path.resolve(process.env.LAI_CUSTOMER_SAVE_CLOSE_EVIDENCE || 'evidence/ui-1.4.98/customer-save-close');
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
const observations=[];
const pointerReadiness=[];
async function settle(){await until(()=>evaluate(`!document.getAnimations().some(a=>a.playState==='running'&&a.effect.getTiming().iterations!==Infinity)`),'finite UI motion settled');await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');}
async function tap(selector){
 // Entry motion can start after settle's first poll. Wait for the actual target.
 await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
 const started=Date.now();let point;
 await until(async()=>{
  const state=await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)return {ready:false,reason:'missing'};const r=n.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;const running=document.getAnimations().filter(a=>a.playState==='running'&&a.effect.getTiming().iterations!==Infinity).map(a=>({target:a.effect.target?.className,currentTime:a.currentTime,duration:a.effect.getTiming().duration}));const inViewport=r.width>0&&r.height>0&&x>=0&&x<innerWidth&&y>=0&&y<innerHeight;const hit=inViewport&&n.contains(document.elementFromPoint(x,y));return {ready:hit&&!n.disabled&&!running.length,x,y,inViewport,hit,disabled:!!n.disabled,running};})()`);
  pointerReadiness.push({selector,elapsedMs:Date.now()-started,...state});
  point={x:state.x,y:state.y};return state.ready;
 },'pointer target ready: '+selector);
 for(const type of ['mousePressed','mouseReleased'])await cdp.call('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
}
async function customerDetail(name='Close Customer'){await navigate();await tap('[data-open="'+name+'"]');await until(()=>evaluate(`!!document.querySelector('.lcd-pagebar [data-action="edit"]')`),'customer detail');await settle();}
async function customerEdit(){await tap('.lcd-pagebar [data-action="edit"]');await until(()=>evaluate(`!!document.querySelector('#customer-form')`),'customer editor');await settle();}
async function newCustomer(){await navigate();await tap('[data-action="new"]');await until(()=>evaluate(`!!document.querySelector('#customer-form')`),'new customer');await settle();}
async function fields(values){await evaluate(`(()=>{const f=document.querySelector('#customer-form');for(const[k,v]of Object.entries(${JSON.stringify(values)})){f.elements[k].value=v;f.elements[k].dispatchEvent(new Event('input',{bubbles:true}));}})()`);}
async function hold(selector='[form="customer-form"][value="save"]'){const index=cdp.paused.length;await tap(selector);await until(()=>cdp.paused.length>index,'real save held');return cdp.paused[index].requestId;}
async function beginGuards(count=1){await evaluate(`(()=>{window.__saveCloseResults=Array(${count}).fill('waiting');for(let i=0;i<${count};i++)void window.flushPendingSave().then(v=>window.__saveCloseResults[i]=v);})()`);assert.deepEqual(await evaluate('window.__saveCloseResults'),Array(count).fill('waiting'));}
async function results(){await until(()=>evaluate(`window.__saveCloseResults.every(v=>v!=='waiting')`),'waiting close guards settled');return evaluate('window.__saveCloseResults');}
async function draftFollowup(text){await tap('[data-tab="activity"]');await evaluate(`(()=>{const n=document.querySelector('#followup-text');n.value=${JSON.stringify(text)};n.dispatchEvent(new Event('input',{bubbles:true}));})()`);}
async function cancelFollowup(){await evaluate(`document.querySelector('[data-action="cancel-followup"]').scrollIntoView({block:'center',behavior:'instant'})`);await tap('[data-action="cancel-followup"]');}
try{
 fs.mkdirSync(evidence,{recursive:true});assert.ok(!fs.existsSync(path.join(resources,'trade-order-data.json')),'Only seedless review app');backend=await startBackend();const initial=await snapshot();assert.deepEqual(initial.data.customers,{});assert.equal(initial.data.orders.length,0);initial.data.customers={'Close Customer':{country:'US',source:'Synthetic',contact:'Main',email:'main@example.test',phone:'555',companyRemark:'Original',birthday:'1990/01/02',historicalReference:'KEEP'}};
 const seeded=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:initial,baseRevision:initial.revision})});assert.equal(seeded.status,200);
 const port=await freePort();const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps',`--user-data-dir=${path.join(temporary,'chrome')}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});children.push(browser);
 let target;await until(async()=>{try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'browser');cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:1022,deviceScaleFactor:2,mobile:false});await navigate();const baseline=await snapshot();
 await customerDetail();await customerEdit();await fields({companyRemark:'Unsubmitted'});assert.equal(await evaluate('window.flushPendingSave()'),false);checks.unsavedEditorStillRejectsClose=true;await escape();await tap('[data-action="discard-customer-editor"]');await until(()=>evaluate(`!document.querySelector('#customer-form')`),'discard closed');assert.deepEqual(await snapshot(),baseline);checks.discardWritesNothing=true;
 await customerEdit();await fields({companyRemark:'Retry this delayed save'});await cdp.call('Fetch.enable',{patterns:[{urlPattern:backend.base+'/api/save',requestStage:'Request'}]});let request=await hold();await beginGuards(2);await escape();assert.equal(await evaluate(`!!document.querySelector('#customer-form')`),true);assert.equal(await evaluate(`document.querySelector('[form="customer-form"][value="save"]').disabled`),true);assert.deepEqual(await snapshot(),baseline);checks.inFlightGuardWaitsAndEscapeRetainsEditor=true;await frame('customer-save-pending');
 await cdp.call('Fetch.failRequest',{requestId:request,errorReason:'ConnectionFailed'});assert.deepEqual(await results(),[false,false]);await until(()=>evaluate(`document.querySelector('#form-error')?.textContent&& !document.querySelector('[form="customer-form"][value="save"]').disabled`),'failed save UI restored');assert.equal(await evaluate(`document.querySelector('[name="companyRemark"]').value`),'Retry this delayed save');assert.deepEqual(await snapshot(),baseline);checks.delayedFailureRejectsBothCloseRequestsAndPreservesDraft=true;await frame('customer-save-failure');
 request=await hold();await beginGuards(2);await cdp.call('Fetch.continueRequest',{requestId:request});assert.deepEqual(await results(),[true,true]);assert.equal(await evaluate(`!!document.querySelector('#customer-form')`),false);checks.successfulRetryCompletesEditorBeforeBothGuards=true;let saved=await snapshot();assert.equal(saved.revision,baseline.revision+1);assert.equal(saved.data.customers['Close Customer'].companyRemark,'Retry this delayed save');assert.equal(saved.data.customers['Close Customer'].birthday,'1990/01/02');assert.equal(saved.data.customers['Close Customer'].historicalReference,'KEEP');checks.retryWritesOnceAndKeepsExistingData=true;observations.push({phase:'edit retry',guard:[true,true],revision:saved.revision});
 await newCustomer();await fields({name:'New Delayed',country:'US',source:'Synthetic',contact:'New',email:'new@example.test',phone:'5551'});request=await hold();await beginGuards();const beforeNew=saved;await cdp.call('Fetch.continueRequest',{requestId:request});assert.deepEqual(await results(),[true]);assert.equal(await evaluate(`!!document.querySelector('#customer-form')`),false);saved=await snapshot();assert.equal(saved.revision,beforeNew.revision+1);assert.equal(saved.data.customers['New Delayed'].email,'new@example.test');checks.newCustomerSuccessAllowsWaitingCloseAfterListReturn=true;
 await newCustomer();await fields({name:'Continue Delayed',country:'US',source:'Synthetic',contact:'Continue',email:'continue@example.test',phone:'5552'});request=await hold('[form="customer-form"][value="continue"]');await beginGuards();const beforeContinue=saved;await cdp.call('Fetch.continueRequest',{requestId:request});assert.deepEqual(await results(),[false]);assert.equal(await evaluate(`document.querySelector('#customer-form').dataset.oldName`),'');assert.equal(await evaluate(`document.querySelector('#customer-form').elements.name.value`),'');saved=await snapshot();assert.equal(saved.revision,beforeContinue.revision+1);assert.ok(saved.data.customers['Continue Delayed']);checks.saveContinueStillProtectsNewEditor=true;await escape();await until(()=>evaluate(`!document.querySelector('#customer-form')`),'blank continued editor closed');assert.equal(await evaluate('window.flushPendingSave()'),true);assert.deepEqual(await snapshot(),saved);checks.cancelBlankContinuedEditorAllowsCloseWithoutExtraWrite=true;
 await customerDetail();await draftFollowup('Delayed followup');await evaluate(`document.querySelector('#followup-form button[type="submit"]').scrollIntoView({block:'center',behavior:'instant'})`);request=await hold('#followup-form button[type="submit"]');await beginGuards();const beforeFollowup=saved;await cdp.call('Fetch.continueRequest',{requestId:request});assert.deepEqual(await results(),[true]);assert.equal(await evaluate(`document.querySelector('#followup-text').value`),'');saved=await snapshot();assert.equal(saved.revision,beforeFollowup.revision+1);assert.ok(saved.data.customers['Close Customer'].history.some(h=>h.text==='Delayed followup'));checks.followupSuccessClearsDraftBeforeGuard=true;
 await draftFollowup('Keep separate draft');await customerEdit();await fields({companyRemark:'Saved beside followup draft'});request=await hold();await beginGuards();const beforeOtherDraft=saved;await cdp.call('Fetch.continueRequest',{requestId:request});assert.deepEqual(await results(),[false]);assert.equal(await evaluate(`!!document.querySelector('#customer-form')`),false);assert.equal(await evaluate(`document.querySelector('#followup-text').value`),'Keep separate draft');saved=await snapshot();assert.equal(saved.revision,beforeOtherDraft.revision+1);assert.ok(!saved.data.customers['Close Customer'].history.some(h=>h.text==='Keep separate draft'));checks.otherUnsavedFollowupStillPreventsCloseAfterCustomerSuccess=true;await cancelFollowup();assert.equal(await evaluate('window.flushPendingSave()'),true);assert.deepEqual(await snapshot(),saved);checks.explicitlyCancelOtherDraftAllowsCloseWithoutWritingIt=true;
 await cdp.call('Fetch.disable');await stop(backend.child);backend=await startBackend();assert.deepEqual(await snapshot(),saved);checks.restartPreservesOnlySuccessfulWrites=true;
 const report={testedAt:new Date().toISOString(),status:'pass',version:await evaluate(`document.querySelector('.app-version').textContent.replace(/^v/,'')`),htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),checkCount:Object.keys(checks).length,checks,observations,scope:'Real isolated browser save lifecycle and public close guard; no actual native exit'};fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:'pass',version:report.version,checks:report.checkCount}));
}catch(error){fs.writeFileSync(path.join(evidence,'failure.json'),JSON.stringify({message:error.message,checks,observations},null,2));console.error(error.stack);throw error;}
finally{fs.writeFileSync(path.join(evidence,'readiness-diagnostics.json'),JSON.stringify(pointerReadiness,null,2));if(cdp)await cdp.call('Fetch.disable').catch(()=>{});cdp?.close();for(const child of children)await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
