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
const evidence=path.resolve(process.env.LAI_EDITOR_UNSAVED_EVIDENCE || 'evidence/ui-1.4.88/editor-unsaved');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-editor-unsaved-'));
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
async function openNew(){await pointerClick('[data-action="new"]');await until(()=>evaluate(`!!document.querySelector('#customer-form')`),'new editor');await settle();}
async function prompt(){await until(()=>evaluate(`!!document.querySelector('.customer-editor-unsaved')||!document.querySelector('#customer-form')`),'close decision');assert.equal(await evaluate(`!!document.querySelector('.customer-editor-unsaved')`),true,'Unsaved customer input must show a close decision rather than disappear');assert.ok(await evaluate(`!!document.querySelector('#customer-form')`));}
async function discard(){await pointerClick('[data-action="discard-customer-editor"]');await until(()=>evaluate(`!document.querySelector('.overlay')`),'explicitly discarded editor');}
async function continueEditing(){await pointerClick('[data-action="continue-customer-editor"]');assert.equal(await evaluate(`!!document.querySelector('.customer-editor-unsaved')`),false);}
try{
 fs.mkdirSync(evidence,{recursive:true});backend=await startBackend();const initial=await snapshot();
 initial.data.customers={'Draft Customer':{country:'US',source:'Referral',contact:'Main',email:'main@example.test',phone:'5550101'},'Other Customer':{country:'US',source:'Referral'}};initial.data.orders=[];
 const seeded=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:initial,baseRevision:initial.revision})});assert.equal(seeded.status,200);
 const port=await freePort();const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps',`--user-data-dir=${path.join(temporary,'chrome')}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});children.push(browser);
 let target;await until(async()=>{if(browser.exitCode!==null)throw Error('Disposable browser exited before testing');try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item=>item.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'browser');
 cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1728,height:958,deviceScaleFactor:1,mobile:false});await navigate();const baseline=await snapshot();
 await openNew();await fill('#customer-form [name="name"]','LaiCancelProbe');
 await cdp.call('Input.dispatchMouseEvent',{type:'mousePressed',x:840,y:450,button:'left',clickCount:1});await cdp.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:840,y:450,button:'left',clickCount:1});assert.equal(await evaluate(`document.querySelector('#customer-form [name="name"]').value`),'LaiCancelProbe');assert.equal(await evaluate(`!!document.querySelector('.customer-editor-unsaved')`),false);checks.maskClickKeepsDraftWithoutDecision=true;
 await pointerClick('.ce-footer [data-action="close-modal"]');await prompt();
 assert.equal(await evaluate(`document.querySelector('#customer-form [name="name"]').value`),'LaiCancelProbe');assert.deepEqual(await snapshot(),baseline);checks.newDraftCancelShowsDecisionWithoutWrite=true;
 await frame('new-footer-warning');
 const footerGeometry=await evaluate(`(()=>{const r=document.querySelector('.customer-editor-unsaved').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()`);
 assert.ok(footerGeometry.width>=268&&footerGeometry.width<=269);assert.equal(footerGeometry.height,98);
 await continueEditing();assert.equal(await evaluate(`document.querySelector('#customer-form [name="name"]').value`),'LaiCancelProbe');checks.continueKeepsTypedName=true;
 await pointerClick('.drawer-head [data-action="close-modal"]');await prompt();await frame('new-header-warning');
 const headerGeometry=await evaluate(`(()=>{const r=document.querySelector('.customer-editor-unsaved').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()`);
 assert.equal(headerGeometry.y,12);assert.ok(headerGeometry.x+headerGeometry.width<=1728);checks.headerAndFooterWarningsFitSourceAnchors=true;
 await discard();assert.deepEqual(await snapshot(),baseline);checks.explicitDiscardNeverWrites=true;
 await openNew();assert.equal(await evaluate(`document.querySelector('#customer-form [name="name"]').value`),'');await pointerClick('.ce-footer [data-action="close-modal"]');await until(()=>evaluate(`!document.querySelector('.overlay')`),'unchanged new editor closes');checks.unchangedNewClosesWithoutWarning=true;
 await openNew();await fill('#customer-form [name="name"]','Reverted');await fill('#customer-form [name="name"]','');await pointerClick('.ce-footer [data-action="close-modal"]');await prompt();await discard();checks.revertedInputStillWarnsLikeSource=true;
 await openNew();await fill('#customer-form [name="name"]','Escape Draft');await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await prompt();await continueEditing();assert.equal(await evaluate(`document.activeElement===document.querySelector('.ce-footer [data-action="close-modal"]')`),true);await pointerClick('.ce-footer [data-action="close-modal"]');await prompt();await discard();checks.escapeProtectsDraftAndContinueRestoresFocus=true;
 await openNew();await pointerClick('.customer-editor [data-action="editor-follow"]');await pointerClick('.ce-footer [data-action="close-modal"]');await prompt();await discard();checks.followChangeIsProtected=true;
 await openNew();await pointerClick('.customer-editor [data-editor-action="add-method"][data-method-type="social"]');await settle();await fill('#customer-form [data-method-value]','draft_account');await pointerClick('.ce-footer [data-action="close-modal"]');await prompt();assert.equal(await evaluate(`document.querySelector('#customer-form [data-method-value]').value`),'draft_account');await discard();assert.deepEqual(await snapshot(),baseline);checks.additionalMethodDraftIsProtected=true;
 await openNew();await pointerClick('.ce-footer [name="rebuildHistory"]');await until(()=>evaluate(`document.querySelector('#customer-form').dataset.hasChanges==='true'&&!document.querySelector('.ce-footer [name="rebuildHistory"]').checked`),'actual footer switch change');await pointerClick('.ce-footer [data-action="close-modal"]');await prompt();await discard();checks.footerSwitchChangeIsProtected=true;
 await openNew();await pointerClick('.customer-editor [data-editor-action="add-contact"]');await until(()=>evaluate(`document.querySelectorAll('#customer-form [data-contact-card]').length===2&&document.querySelector('#customer-form').dataset.hasChanges==='true'`),'contact was added to draft');await settle();await pointerClick('.ce-footer [data-action="close-modal"]');await prompt();await discard();checks.addedContactDraftIsProtected=true;
 await evaluate(`document.querySelector('[data-open="Draft Customer"]').click()`);await until(()=>evaluate(`!!document.querySelector('.lcd-pagebar [data-action="edit"]')`),'detail');await pointerClick('.lcd-pagebar [data-action="edit"]');await settle();
 await fill('#customer-form [name="name"]','Other Customer');await pointerClick('[form="customer-form"][value="save"]');await until(()=>evaluate(`!!document.querySelector('#form-error.visible')`),'duplicate name rejected');
 await pointerClick('.ce-footer [data-action="close-modal"]');await prompt();assert.equal(await evaluate(`document.querySelector('#customer-form [name="name"]').value`),'Other Customer');assert.deepEqual(await snapshot(),baseline);checks.failedSaveRetainsGuardAndDraft=true;
 await continueEditing();await fill('#customer-form [name="name"]','Saved Customer');await pointerClick('[form="customer-form"][value="save"]');await until(()=>evaluate(`!document.querySelector('#customer-form')`),'successful save closes without another decision');assert.equal(await evaluate(`!!document.querySelector('.customer-editor-unsaved')`),false);assert.ok((await snapshot()).data.customers['Saved Customer']);checks.successfulSaveClosesWithoutFalseWarning=true;
 const saved=await snapshot();await pointerClick('.lcd-pagebar [data-action="edit"]');await settle();
 await pointerClick('.customer-editor [data-action="company-display-settings"]');await until(()=>evaluate(`!!document.querySelector('.company-display')`),'display settings');await settle();await pointerClick('.company-display [data-action="close-modal"]');await until(()=>evaluate(`!!document.querySelector('#customer-form')`),'original editor returned');await settle();
 await pointerClick('.ce-footer [data-action="close-modal"]');await until(()=>evaluate(`!document.querySelector('.overlay')`),'unchanged editor after display settings');assert.deepEqual(await snapshot(),saved);checks.openingDisplaySettingsDoesNotCreateFalseChanges=true;
 await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:720,deviceScaleFactor:1,mobile:false});await pointerClick('.lcd-pagebar [data-action="edit"]');await settle();await fill('#customer-form [name="name"]','Compact Draft');await pointerClick('.ce-footer [data-action="close-modal"]');await prompt();await frame('compact-footer-warning');
 const compact=await evaluate(`(()=>{const r=document.querySelector('.customer-editor-unsaved').getBoundingClientRect();return{left:r.left,top:r.top,right:r.right,bottom:r.bottom}})()`);assert.ok(compact.left>=8&&compact.top>=8&&compact.right<=1092&&compact.bottom<=712);checks.compactWarningStaysVisible=true;
 await continueEditing();await pointerClick('.customer-editor [data-action="company-display-settings"]');await until(()=>evaluate(`!!document.querySelector('.company-display')`),'display with dirty customer');await settle();await pointerClick('.company-display [data-action="close-modal"]');await until(()=>evaluate(`!!document.querySelector('#customer-form')`),'dirty editor returned');await settle();await pointerClick('.ce-footer [data-action="close-modal"]');await prompt();assert.equal(await evaluate(`document.querySelector('#customer-form [name="name"]').value`),'Compact Draft');await discard();assert.deepEqual(await snapshot(),saved);checks.displayReturnPreservesCustomerDraftProtection=true;
 await cdp.call('Emulation.setDeviceMetricsOverride',{width:1728,height:958,deviceScaleFactor:1,mobile:false});await openNew();
 for(const [name,value] of Object.entries({name:'Continue Customer',country:'US',source:'Referral',contact:'Continue Main',email:'continue@example.test',phone:'5550102'}))await fill('#customer-form [name="'+name+'"]',value);
 await pointerClick('[form="customer-form"][value="continue"]');await until(()=>evaluate(`!!document.querySelector('#customer-form')&&document.querySelector('#customer-form [name="name"]').value===''`),'saved then continued with a clean new draft');await settle();assert.ok((await snapshot()).data.customers['Continue Customer']);assert.equal(await evaluate(`!!document.querySelector('.customer-editor-unsaved')`),false);await pointerClick('.ce-footer [data-action="close-modal"]');await until(()=>evaluate(`!document.querySelector('.overlay')`),'continued blank draft closes normally');checks.saveAndContinueResetsDraftGuard=true;
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({testedAt:new Date().toISOString(),app,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),result:'pass',checks,footerGeometry,headerGeometry,compact},null,2));console.log('PASS: '+Object.keys(checks).length+' customer editor unsaved-draft checks');
}catch(error){console.error('Acceptance failure: '+error.message);if(cdp)await frame('failure').catch(()=>{});fs.writeFileSync(path.join(evidence,'failure.json'),JSON.stringify({result:'fail',error:error.message,passedChecks:checks},null,2));throw error;}
finally{cdp?.close();for(const child of children)await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
