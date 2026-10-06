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
const evidence=path.resolve(process.env.LAI_SEGMENT_UNSAVED_EVIDENCE || 'evidence/ui-1.4.91/segment-unsaved');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-segment-unsaved-'));
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
 const point=await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:"nearest",inline:"nearest"});const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);if(!r.width||!r.height||!(el.contains(hit)||hit?.contains(el)))throw Error('Pointer target is hidden or covered: '+${JSON.stringify(selector)}+' '+JSON.stringify({x,y,rect:r.toJSON(),hit:hit?.className,overlay:el.closest('.overlay')?.className,animations:document.getAnimations().map(a=>({state:a.playState,time:a.currentTime,target:a.effect.target.className}))}));return {x,y}})()`);
 await cdp.call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
 await cdp.call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
}

async function settle(){await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);await until(()=>evaluate(`!document.getAnimations().some(a=>a.playState==='running'&&a.effect.getTiming().iterations!==Infinity)`),'drawer settled');}
async function fill(selector,value){await pointerClick(selector);await evaluate(`document.querySelector(${JSON.stringify(selector)}).select()`);await cdp.call('Input.insertText',{text:value});}
async function manage(){await navigate();await pointerClick('.group-settings[data-action="manage-segments"]');await until(()=>evaluate(`!!document.querySelector('.segment-management')`),'management');await settle();}
async function openNew(kind='rules'){await manage();await pointerClick('.drawer-footer [data-action="'+(kind==='manual'?'new-manual':'new-segment')+'"]');await until(()=>evaluate(`!!document.querySelector('#segment-form')`),'segment editor');await settle();}
async function edit(id){await manage();await pointerClick('[data-edit-segment="'+id+'"]');await until(()=>evaluate(`!!document.querySelector('#segment-form')`),'edit');await settle();}
async function decision(){await until(()=>evaluate(`!!document.querySelector('.segment-editor-unsaved')||!document.querySelector('#segment-form')`),'close decision');assert.equal(await evaluate(`!!document.querySelector('.segment-editor-unsaved')`),true,'Segment draft must be retained behind close/continue decision');assert.ok(await evaluate(`!!document.querySelector('#segment-form')`));}
async function discard(){await pointerClick('[data-action="discard-segment-editor"]');await until(()=>evaluate(`!document.querySelector('.overlay')`),'discard');}
async function keep(){await pointerClick('[data-action="continue-segment-editor"]');assert.equal(await evaluate(`!!document.querySelector('.segment-editor-unsaved')`),false);}
async function cancel(){await pointerClick('.drawer-footer [data-action="close-modal"]');}
async function closed(){await until(()=>evaluate(`!document.querySelector('.overlay')`),'closed without false warning');}
async function select(selector,value){if(selector==='#segment-form [name="match"]'){await pointerClick('#segment-form [name="match"][value="'+value+'"]');return;}await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}));})()`);await settle();}
async function save(){await pointerClick('[form="segment-form"]');}
const name='#segment-form [name="name"]',value='#segment-form [data-rule="0"] [data-rule-prop="value"]';
try{
 fs.mkdirSync(evidence,{recursive:true});backend=await startBackend();const initial=await snapshot();
 initial.data.customers={'Alpha':{country:'US',source:'Referral'}};initial.data.orders=[];
 initial.data.previewSegments=[{id:'rules',name:'Zero',kind:'rules',match:'all',rules:[{field:'orderCount',op:'eq',value:0}],members:[],archived:false,unknown:{keep:true}},{id:'manual',name:'Manual',kind:'manual',match:'all',rules:[],members:['Alpha'],archived:false,unknown:{keep:true}}];
 const seeded=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:initial,baseRevision:initial.revision})});assert.equal(seeded.status,200);
 const port=await freePort();const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps',`--user-data-dir=${path.join(temporary,'chrome')}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});children.push(browser);
 let target;await until(async()=>{try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item=>item.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'browser');cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1728,height:902,deviceScaleFactor:1,mobile:false});const baseline=await snapshot();
 await openNew();await fill(name,'Unsaved Group');await cancel();await decision();checks.dirtyNameCancelProtectsDraft=true;
 const geometry=await evaluate(`(()=>{const r=document.querySelector('.segment-editor-unsaved').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);assert.ok(Math.abs(geometry.width-268.203125)<1&&Math.abs(geometry.height-98)<1);checks.warningMatchesSourceLocalSize=true;await frame('footer-warning');await keep();assert.equal(await evaluate(`document.querySelector(${JSON.stringify(name)}).value`),'Unsaved Group');assert.equal(await evaluate(`document.activeElement===document.querySelector('.drawer-footer [data-action="close-modal"]')`),true);checks.continueKeepsNameAndFocus=true;
 await pointerClick('.drawer-head [data-action="close-modal"]');await decision();await frame('header-warning');await keep();assert.equal(await evaluate(`document.activeElement===document.querySelector('.drawer-head [data-action="close-modal"]')`),true);checks.headerCloseProtectsAndRestoresFocus=true;
 await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await decision();await discard();assert.deepEqual(await snapshot(),baseline);checks.escapeAndDiscardDoNotWriteDatabase=true;
 await openNew();await fill(name,'Mask Draft');await cdp.call('Input.dispatchMouseEvent',{type:'mousePressed',x:100,y:450,button:'left',clickCount:1});await cdp.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:100,y:450,button:'left',clickCount:1});assert.equal(await evaluate(`document.querySelector(${JSON.stringify(name)}).value`),'Mask Draft');assert.equal(await evaluate(`!!document.querySelector('.segment-editor-unsaved')`),false);checks.maskKeepsDraft=true;await fill(name,'');await cancel();await closed();checks.restoredNewNameClosesWithoutWarning=true;
 await openNew();await select('#segment-form [name="match"]','any');await pointerClick('[data-action="add-rule"]');await settle();await cancel();await closed();checks.matchAndAddedBlankPlaceholderDoNotCreateFalseChanges=true;
 await openNew();await select('[data-rule="0"] [data-rule-prop="field"]','name');await cancel();await decision();await keep();await select('[data-rule="0"] [data-rule-prop="field"]','country');await select('[data-rule="0"] [data-rule-prop="op"]','contains');await cancel();await closed();checks.fieldSelectionProtectsAndFullRestoreCloses=true;
 await openNew();await select('[data-rule="0"] [data-rule-prop="op"]','notEmpty');await cancel();await decision();await discard();checks.valueLessRuleIsMeaningful=true;
 await openNew();await pointerClick('[data-remove-rule="0"]');await settle();await cancel();await decision();await discard();checks.removingAllRulesProtectsDraft=true;
 await openNew();await fill(value,'US');await pointerClick('[data-action="add-rule"]');await settle();await fill(name,'Many rules');for(let i=0;i<16;i++){await pointerClick('[data-action="add-rule"]');await settle();}await evaluate(`document.querySelector('#segment-form').scrollTop=250`);const scroll=await evaluate(`document.querySelector('#segment-form').scrollTop`);await cancel();await decision();await keep();assert.equal(await evaluate(`document.querySelector('#segment-form').scrollTop`),scroll);assert.equal(await evaluate(`document.querySelector(${JSON.stringify(value)}).value`),'US');assert.equal(await evaluate(`document.querySelectorAll('[data-rule]').length`),18);checks.ruleRedrawAndContinuePreserveValuesAndScroll=true;await cancel();await decision();await discard();assert.deepEqual(await snapshot(),baseline);checks.longRuleDiscardDoesNotWrite=true;
 await edit('rules');assert.equal(await evaluate(`document.querySelector(${JSON.stringify(value)}).value`),'0');await cancel();await closed();checks.savedNumericZeroIsNotFalseDirty=true;
 await edit('rules');await fill(name,'Changed');await fill(name,'Zero');await fill(value,'9');await fill(value,'0');await select('#segment-form [name="match"]','any');await select('#segment-form [name="match"]','all');await cancel();await closed();checks.existingCompleteRestoreCloses=true;
 await edit('rules');await fill(value,'7');await select('#segment-form [name="match"]','any');await cancel();await decision();await keep();assert.equal(await evaluate(`document.querySelector(${JSON.stringify(value)}).value`),'7');assert.equal(await evaluate(`document.querySelector('#segment-form').elements.match.value`),'any');checks.existingRuleAndMatchProtected=true;await save();await closed();const afterRuleSave=await snapshot();assert.equal(afterRuleSave.data.previewSegments.find(s=>s.id==='rules').rules[0].value,'7');assert.deepEqual(afterRuleSave.data.previewSegments.find(s=>s.id==='rules').unknown,{keep:true});checks.successfulRuleSaveClosesAndPreservesUnknown=true;
 await edit('manual');await fill(name,'Zero');await save();await until(()=>evaluate(`document.querySelector('#workspace-error')?.classList.contains('visible')`),'duplicate error');await cancel();await decision();await keep();assert.equal(await evaluate(`document.querySelector(${JSON.stringify(name)}).value`),'Zero');assert.deepEqual(await snapshot(),afterRuleSave);checks.failedValidationKeepsDraftAndCloseProtection=true;
 await fill(name,'Manual Saved');await evaluate(`(()=>{const realFetch=window.fetch;window.fetch=(url,...rest)=>{if(String(url).includes('/api/save')){window.fetch=realFetch;return Promise.reject(new Error('Isolated save failure'));}return realFetch(url,...rest)}})()`);await save();await until(()=>evaluate(`document.querySelector('#workspace-error')?.textContent.includes('Isolated save failure')`),'transport error');await cancel();await decision();await keep();assert.deepEqual(await snapshot(),afterRuleSave);await save();await closed();const saved=await snapshot();assert.deepEqual(saved.data.previewSegments.find(s=>s.id==='manual').members,['Alpha']);assert.deepEqual(saved.data.previewSegments.find(s=>s.id==='manual').unknown,{keep:true});checks.failedTransportRetryKeepsManualMembersAndUnknown=true;
 await edit('manual');await cancel();await closed();checks.savedManualReopensClean=true;
 await openNew('manual');await fill(name,'Compact Draft');await cancel();await decision();await cdp.call('Emulation.setDeviceMetricsOverride',{width:640,height:720,deviceScaleFactor:1,mobile:false});await settle();const compact=await evaluate(`(()=>{const r=document.querySelector('.segment-editor-unsaved').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}})()`);assert.ok(compact.left>=8&&compact.right<=632&&compact.top>=8&&compact.bottom<=712);await frame('compact-warning');await discard();assert.deepEqual(await snapshot(),saved);checks.resizeKeepsWarningVisibleAndDiscardSafe=true;
 await stop(backend.child);backend=await startBackend();assert.deepEqual(await snapshot(),saved);checks.savedResultsSurviveServiceRestart=true;
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({testedAt:new Date().toISOString(),app,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),result:'pass',checks,geometry,compact},null,2));console.log('PASS: '+Object.keys(checks).length+' segment unsaved-draft checks');
}catch(error){if(cdp)await frame('failure').catch(()=>{});fs.writeFileSync(path.join(evidence,'failure.json'),JSON.stringify({result:'fail',error:error.message,passedChecks:checks},null,2));throw error;}
finally{cdp?.close();for(const child of children)await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
