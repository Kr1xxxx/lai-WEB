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
const evidence=path.resolve(process.env.LAI_SEGMENT_REDRAW_EVIDENCE || 'evidence/ui-1.4.95/segment-redraw');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-segment-redraw-'));
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
async function select(selector,value){await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}));})()`);await settle();}
async function save(){await pointerClick('[form="segment-form"]');}
const name='#segment-form [name="name"]',value='#segment-form [data-rule="0"] [data-rule-prop="value"]';
async function inputValue(text){await evaluate(`(()=>{const el=document.querySelector('#segment-form [data-rule="0"] [data-rule-prop="value"]');el.value=${JSON.stringify(text)};el.dispatchEvent(new Event('input',{bubbles:true}));})()`);}
async function escape(){await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});}
async function cleanClose(){await until(()=>evaluate(`!!document.querySelector('.segment-editor-unsaved')||!document.querySelector('#segment-form')`),'untouched close outcome');assert.equal(await evaluate(`!!document.querySelector('.segment-editor-unsaved')`),false,'Model-accepted date must not produce an untouched close warning');await closed();}
const redrawVariants=[['slash','lastFollowup','before','10/01/2026'],['day','createdAt','eq','2026-10-01'],['timestamp','createdAt','eq','2026-10-01T12:00:00Z'],['numeric','createdAt','eq',2026],['lf','createdAt','eq','2026-10-01\n'],['crlf','lastFollowup','before','\r\n10/01/2026\r\n']];
const observed=[];
async function changeOp(op){await select('#segment-form [data-rule="0"] [data-rule-prop="op"]',op);}
async function restore(original){await inputValue(String(original));const actual=await evaluate(`(()=>{const el=document.querySelector('#segment-form [data-rule="0"] [data-rule-prop="value"]');return {type:el.type,value:el.value}})()`);observed.push({original,restored:actual});assert.equal(actual.value,String(original).replace(/[\r\n]/g,''),'The original accepted date must remain expressible after a redraw');}
try{
 fs.mkdirSync(evidence,{recursive:true});backend=await startBackend();const initial=await snapshot();initial.data.customers={Alpha:{country:'US',source:'Referral'}};initial.data.orders=[];initial.data.previewSegments=redrawVariants.map(([id,field,op,value])=>({id,name:'Redraw '+id,kind:'rules',match:'all',rules:[{field,op,value,unknown:{keep:id}}],members:[],archived:false,unknown:{keep:id}}));
 const seeded=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:initial,baseRevision:initial.revision})});assert.equal(seeded.status,200);
 const port=await freePort();const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps',`--user-data-dir=${path.join(temporary,'chrome')}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});children.push(browser);let target;await until(async()=>{try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item=>item.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'browser');cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1728,height:902,deviceScaleFactor:1,mobile:false});
 for(const [id,field,op,original] of redrawVariants){
  const before=await snapshot();await edit(id);const initialType=await evaluate(`document.querySelector('#segment-form [data-rule="0"] [data-rule-prop="value"]').type`);assert.equal(initialType,id==='day'?'date':'text');await cancel();await cleanClose();assert.deepEqual(await snapshot(),before);checks[id+'InitialModeAndCleanClose']=true;
  await edit(id);await inputValue('2026-10-03');await pointerClick('[data-action="add-rule"]');await settle();await restore(original);if(id==='slash')await frame('legacy-restored-after-redraw');await pointerClick('[data-remove-rule="1"]');await settle();await cancel();await cleanClose();assert.deepEqual(await snapshot(),before);checks[id+'RestoreAfterAddThenDeleteKeepsData']=true;
  await edit(id);await inputValue('2026-10-03');await pointerClick('[data-action="add-rule"]');await settle();await pointerClick('[data-remove-rule="1"]');await settle();await restore(original);await fill(name,'Redraw Saved '+id);await save();await closed();let saved=(await snapshot()).data.previewSegments.find(s=>s.id===id);assert.deepEqual(saved.rules,initial.data.previewSegments.find(s=>s.id===id).rules);assert.deepEqual(saved.unknown,{keep:id});checks[id+'RestoreAfterDeleteThenNameSaveKeepsOriginal']=true;
  await edit(id);await inputValue('2026-10-04');await changeOp(op==='before'?'after':'before');await changeOp(op);await restore(original);await cancel();await cleanClose();assert.deepEqual((await snapshot()).data.previewSegments.find(s=>s.id===id),saved);checks[id+'OperatorRedrawCanRestoreWithoutWriting']=true;
  await edit(id);await inputValue('2026-10-04');await changeOp('olderDays');assert.equal(await evaluate(`document.querySelector('#segment-form [data-rule="0"] [data-rule-prop="value"]').type`),'number');await inputValue('15');await changeOp(op);await restore(original);assert.equal(await evaluate(`document.querySelector('#segment-form [data-rule="0"] [data-rule-prop="value"]').type`),initialType);if(id==='day')await frame('standard-calendar-after-operator-return');await fill(name,'Days Restored '+id);await save();await closed();saved=(await snapshot()).data.previewSegments.find(s=>s.id===id);assert.deepEqual(saved.rules,initial.data.previewSegments.find(s=>s.id===id).rules);checks[id+'NumericDaysAndOriginalModeRestorePreserveRule']=true;
  await edit(id);await inputValue('2026-10-05');await pointerClick('[data-action="add-rule"]');await settle();await pointerClick('[data-remove-rule="1"]');await settle();await save();await closed();const edited=(await snapshot()).data.previewSegments.find(s=>s.id===id);assert.equal(edited.rules[0].value,'2026-10-05');assert.equal(edited.rules[0].field,field);assert.equal(edited.rules[0].op,op);assert.deepEqual(edited.rules[0].unknown,{keep:id});checks[id+'IntentionalEditAfterRedrawPersists']=true;
 }
 await frame('saved-redraw-dates');const saved=await snapshot();await stop(backend.child);backend=await startBackend();assert.deepEqual(await snapshot(),saved);checks.redrawDatesSurviveRestart=true;
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({testedAt:new Date().toISOString(),app,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),result:'pass',variants:redrawVariants,checks,observed},null,2));console.log('PASS: '+Object.keys(checks).length+' date edit-mode redraw checks');
}catch(error){if(cdp)await frame('failure').catch(()=>{});fs.writeFileSync(path.join(evidence,'failure.json'),JSON.stringify({result:'fail',error:error.message,passedChecks:checks,observed},null,2));throw error;}
finally{cdp?.close();for(const child of children)await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
