import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

// Exercise company display self-drop and saved field correspondence through hit-tested input and disposable SQLite only.
const app=path.resolve(process.env.LAI_ACCEPTANCE_APP || 'dist/来财Lai.app');
const resources=path.join(app,'Contents/Resources');
const evidence=path.resolve(process.env.LAI_COMPANY_DROP_EVIDENCE || 'evidence/m16-self-drop');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-company-drop-'));
const children=[];
const checks={};
let cdp, backend, interceptedDrag;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const freePort=()=>new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
async function until(check,label){for(let i=0;i<160;i++){if(await check())return;await pause(50);}throw Error('Timed out: '+label);}
async function stop(child){if(!child||child.exitCode!==null||child.signalCode!==null)return;child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),pause(6000)]);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await new Promise(resolve=>child.once('exit',resolve));}}
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
  socket.addEventListener('message',event=>{const message=JSON.parse(String(event.data));if(message.method==='Input.dragIntercepted'){interceptedDrag=message.params.data;return;}const request=pending.get(message.id);if(!request)return;pending.delete(message.id);clearTimeout(request.timer);if(message.error)request.reject(Error(message.error.message));else request.resolve(message.result);});
  return {call(method,params={}){const id=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('Isolated browser command timed out: '+method))},5000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});},close(){socket.close();}};
}
async function evaluate(expression){const result=await cdp.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;}
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



const observations=[];
const ids=['website','name','country','source','productType','tags','previewGroup','customerStage','customerStars','customerCode','timezone','defaultPaymentPlan','customerAccountPeriod','companyProducts','cardStock','customBox'];
const initialLayout={common:ids,other:[]};
const row=id=>`[data-company-field-id="${id}"]`;
async function settle(){await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);await until(()=>evaluate(`!document.getAnimations().some(a=>a.playState==='running'&&a.effect.getTiming().iterations!==Infinity)`),'finite motion settled');}
async function layout(){return evaluate(`Object.fromEntries([...document.querySelectorAll('.company-display [data-company-list]')].map(l=>[l.dataset.companyList,[...l.children].map(r=>r.dataset.companyFieldId)]))`);}
async function metrics(){return evaluate(`(()=>{const b=document.querySelector('.company-display-body'),f=document.querySelector('.company-display .drawer-footer');return {body:b.getBoundingClientRect().toJSON(),footer:f.getBoundingClientRect().toJSON(),scrollTop:b.scrollTop,scrollHeight:b.scrollHeight,clientHeight:b.clientHeight,scrollWidth:b.scrollWidth,clientWidth:b.clientWidth,rows:[...b.querySelectorAll('[data-company-field-id]')].map(r=>({id:r.dataset.companyFieldId,rect:r.getBoundingClientRect().toJSON()}))}})()`);}
async function wheel(deltaY){const p=await evaluate(`(()=>{const r=document.querySelector('.company-display-body').getBoundingClientRect();return {x:r.left+8,y:r.top+r.height/2}})()`);await cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',...p});await cdp.call('Input.dispatchMouseEvent',{type:'mouseWheel',...p,deltaX:0,deltaY});await pause(60);}
async function reveal(selector){for(let i=0;i<25;i++){const p=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(),b=document.querySelector('.company-display-body').getBoundingClientRect();return {visible:r.top>=b.top&&r.bottom<=b.bottom,delta:r.top<b.top?-240:240}})()`);if(p.visible)return;await wheel(p.delta);}throw Error('Cannot reveal '+selector);}
async function openDetail(){await navigate();await pointerClick('.company-link');await until(()=>evaluate(`!!document.querySelector('.lcd-tabs [data-tab="info"]')`),'detail');await pointerClick('.lcd-tabs [data-tab="info"]');await until(()=>evaluate(`!!document.querySelector('.lcd-body [data-action="company-display-settings"]')`),'info settings');await settle();}
async function openDisplay(){await pointerClick('.lcd-body [data-action="company-display-settings"]');await until(()=>evaluate(`!!document.querySelector('.company-display')`),'display drawer');await settle();}
async function closeUnchanged(){await pointerClick('.company-display .drawer-footer [data-action="close-modal"]');await until(()=>evaluate(`!document.querySelector('.company-display')`),'unchanged close');}
async function drag(id,targetSelector,fraction=.2){
 await settle();await reveal(targetSelector);await reveal(row(id));
 const source=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(row(id))}),r=e.getBoundingClientRect(),x=r.left+80,y=r.top+r.height/2;return {x,y,hit:document.elementFromPoint(x,y)?.closest('[data-company-field-id]')?.dataset.companyFieldId}})()`);assert.equal(source.hit,id);
 interceptedDrag=null;await cdp.call('Input.setInterceptDrags',{enabled:true});
 await cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:source.x,y:source.y});
 await cdp.call('Input.dispatchMouseEvent',{type:'mousePressed',x:source.x,y:source.y,button:'left',buttons:1,clickCount:1});
 await cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:source.x+18,y:source.y,button:'left',buttons:1});
 await until(()=>!!interceptedDrag,'browser-produced drag data');
 assert.ok(interceptedDrag.items.some(i=>i.mimeType==='text/plain'&&i.data===id),'Browser must produce the actual field id from dragstart');
 const target=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(targetSelector)}),r=e.getBoundingClientRect(),b=document.querySelector('.company-display-body').getBoundingClientRect(),x=r.left+80,y=r.top+r.height*${fraction},hit=document.elementFromPoint(x,y);if(y<b.top||y>b.bottom||!e.contains(hit))throw Error('Drag target not visible/hit');return {x,y,hitId:hit.closest('[data-company-field-id]')?.dataset.companyFieldId||null,group:hit.closest('[data-company-list]')?.dataset.companyList||null}})()`);
 const before=await layout();
 await cdp.call('Input.dispatchDragEvent',{type:'dragEnter',x:target.x,y:target.y,data:interceptedDrag});
 await cdp.call('Input.dispatchDragEvent',{type:'dragOver',x:target.x,y:target.y,data:interceptedDrag});
 await cdp.call('Input.dispatchDragEvent',{type:'drop',x:target.x,y:target.y,data:interceptedDrag});
 await cdp.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:target.x,y:target.y,button:'left',buttons:0,clickCount:1});
 await cdp.call('Input.setInterceptDrags',{enabled:false});
 await until(()=>evaluate(`!document.querySelector('.company-display .is-dragging,.company-display .is-drop-target')`),'drag classes cleared');
 const after=await layout();observations.push({action:'browser-drag',id,targetSelector,fraction,source,target,before,after,browserProducedFieldId:true});await settle();return {before,after,target};
}
function assertDirectory(value){assert.equal(new Set([...value.common,...value.other]).size,16);assert.deepEqual([...value.common,...value.other].sort(),[...ids].sort());for(const id of ['name','country','source'])assert.ok(value.common.includes(id));}
function inserted(before,id,target,afterTarget=false,group='common'){const v=structuredClone(before);for(const k of ['common','other'])v[k]=v[k].filter(x=>x!==id);const index=target?v[group].indexOf(target)+(afterTarget?1:0):v[group].length;v[group].splice(index,0,id);return v;}
async function detailLabels(){return evaluate(`[...document.querySelectorAll('.lcd-body-info .lcd-info-section')].filter(s=>['company-common','company-other'].includes(s.dataset.infoSection)).map(s=>({id:s.dataset.infoSection,html:s.innerHTML}))`);}
async function editorState(){return evaluate(`(()=>{const f=document.querySelector('#customer-form');return {groups:Object.fromEntries(['common','other'].map(g=>[g,[...f.querySelector('[data-company-'+g+']').children].map(e=>e.dataset.companyField)])),values:Object.fromEntries([...f.querySelectorAll('[data-company-field]')].map(e=>{const id=e.dataset.companyField,n=id==='customerStars'?'customerStars':id;return [id,f.elements[n]?.value??null]}))}})()`);}
async function openEditor(){await pointerClick('.lcd-pagebar [data-action="edit"]');await until(()=>evaluate(`!!document.querySelector('#customer-form')`),'customer editor');await settle();}
async function closeEditor(){await pointerClick('.customer-editor .drawer-footer [data-action="close-modal"]');await until(()=>evaluate(`!document.querySelector('#customer-form')`),'customer editor close');}
try{
 fs.mkdirSync(evidence,{recursive:true});assert.equal(fs.existsSync(path.join(resources,'trade-order-data.json')),false);backend=await startBackend();const empty=await snapshot();assert.equal(Object.keys(empty.data.customers).length,0);assert.equal(empty.data.orders.length,0);
 empty.data.customers={'M16 Fixture':{country:'US',source:'Referral',website:'https://fixture.example.test',productType:'Dense Fixture',tags:'Label Fixture',customerCode:'M16-001',timezone:'UTC',defaultPaymentPlan:'Net 30',customerAccountPeriod:'14',companyProducts:'Product Fixture',cardStock:'Paper Fixture',customBox:'Box Fixture',contact:'Main Fixture',email:'main@example.test',phone:'5550101',customMetadata:{keep:'unchanged'}}};empty.data.orders=[{id:'m16-order',customer:'M16 Fixture',date:'2026-10-01',total:20}];empty.data.previewCompanyDisplayLayout=initialLayout;
 const seeded=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:empty,baseRevision:empty.revision})});assert.equal(seeded.status,200);
 const port=await freePort();const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps',`--user-data-dir=${path.join(temporary,'chrome')}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});children.push(browser);let target;await until(async()=>{try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'private browser');cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');
 let lastSaved;
 for(const [width,height] of [[1756,1022],[1100,720]]){
  // Reset only the isolated preference fixture before each viewport.
  const reset=await snapshot();reset.data.previewCompanyDisplayLayout=initialLayout;assert.equal((await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:reset,baseRevision:reset.revision})})).status,200);
  await cdp.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await openDetail();const baseline=await snapshot(),detailBefore=await detailLabels();await openEditor();const fieldsBefore=await editorState();assert.deepEqual(fieldsBefore.groups,initialLayout);await closeEditor();await openDisplay();assert.deepEqual(await layout(),initialLayout);
  const initialMetrics=await metrics();observations.push({action:'layout',width,...initialMetrics});if(width===1100)assert.ok(initialMetrics.scrollHeight>initialMetrics.clientHeight,'Narrow full catalog must exercise real body scrolling');assert.ok(initialMetrics.scrollWidth<=initialMetrics.clientWidth+1);assert.ok(initialMetrics.rows.every(r=>r.rect.height===28));checks['catalogAndScrollableBody'+width]=true;
  let d=await drag('tags',row('tags'),.2);assert.equal(d.target.hitId,'tags');assert.deepEqual(d.after,d.before,'Dropping before the same field must keep its original position');checks['selfUpperNoReorder'+width]=true;
  d=await drag('tags',row('tags'),.8);assert.deepEqual(d.after,d.before);checks['selfLowerNoReorder'+width]=true;
  d=await drag('tags',row('productType'),.2);assert.deepEqual(d.after,inserted(d.before,'tags','productType'));assertDirectory(d.after);checks['otherRowUpperBefore'+width]=true;
  d=await drag('tags',row('previewGroup'),.8);assert.deepEqual(d.after,inserted(d.before,'tags','previewGroup',true));assertDirectory(d.after);checks['otherRowLowerAfter'+width]=true;
  d=await drag('tags','[data-company-list="other"]',.5);assert.deepEqual(d.after,inserted(d.before,'tags',null,false,'other'));assertDirectory(d.after);checks['crossToEmptyOther'+width]=true;
  d=await drag('country','[data-company-list="other"]',.8);assert.deepEqual(d.after,d.before);checks['requiredStaysCommon'+width]=true;
  d=await drag('tags',row('productType'),.2);assert.deepEqual(d.after,inserted(d.before,'tags','productType'));assertDirectory(d.after);checks['crossBackBefore'+width]=true;
  await wheel(-2000);d=await drag('tags','.company-display-note',.5);assert.deepEqual(d.after,d.before);assert.deepEqual(await snapshot(),baseline);checks['outsideDropNoWrite'+width]=true;
  const drafted=await layout();await pointerClick('.company-display .drawer-footer [data-action="close-modal"]');await until(()=>evaluate(`!!document.querySelector('.company-display-unsaved')`),'display draft warning');await pointerClick('[data-action="continue-company-display"]');assert.deepEqual(await layout(),drafted);await pointerClick('.company-display .drawer-footer [data-action="close-modal"]');await pointerClick('[data-action="discard-company-display"]');await until(()=>evaluate(`!document.querySelector('.company-display')`),'draft discard');await openDisplay();assert.deepEqual(await layout(),drafted);await closeUnchanged();assert.deepEqual(await snapshot(),baseline);checks['continueAndPageDraftNoWrite'+width]=true;
  await openDetail();await openDisplay();assert.deepEqual(await layout(),initialLayout);checks['reloadClearsUnsavedOrder'+width]=true;
  await drag('tags','[data-company-list="other"]',.5);const expected=await layout();await reveal(row('customBox'));const tail=await metrics();assert.ok(tail.footer.top>=tail.body.bottom-1);observations.push({action:'tail-layout',width,...tail});await frame('display-tail-'+width);
  await pointerClick('[data-action="save-company-display"]');await until(()=>evaluate(`!document.querySelector('.company-display')`),'saved display drawer');const saved=await snapshot();assert.equal(saved.revision,baseline.revision+1);assert.deepEqual(saved.data.previewCompanyDisplayLayout,expected);assert.deepEqual(saved.data.customers,baseline.data.customers);assert.deepEqual(saved.data.orders,baseline.data.orders);const rest={...saved.data};delete rest.previewCompanyDisplayLayout;const oldRest={...baseline.data};delete oldRest.previewCompanyDisplayLayout;assert.deepEqual(rest,oldRest);checks['saveOnlyPreferencesOnce'+width]=true;
  assert.deepEqual(await detailLabels(),detailBefore,'Display preferences configure the editor; fixed detail field rendering stays unchanged');await openEditor();const fieldsAfter=await editorState();assert.deepEqual(fieldsAfter.groups,expected);assert.deepEqual(fieldsAfter.values,fieldsBefore.values);await closeEditor();checks['editorOrderValuesAndFixedDetail'+width]=true;
  await openDisplay();assert.deepEqual(await layout(),expected);await closeUnchanged();assert.deepEqual(await snapshot(),saved);await openDetail();await openDisplay();assert.deepEqual(await layout(),expected);await closeUnchanged();checks['savedReopenReload'+width]=true;lastSaved=saved;
 }
 await stop(browser);cdp.close();cdp=null;await stop(backend.child);assert.equal(backend.child.exitCode,0);backend=await startBackend();assert.deepEqual(await snapshot(),lastSaved);checks.restartKeepsPreferencesCustomersAndOrders=true;
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({result:'pass',testedAt:new Date().toISOString(),checks,observations,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),inputMethod:'Real mouse initiates native HTML drag; browser-generated DragData replayed by hit-tested CDP dragEnter/dragOver/drop; not hardware/native WKWebView',scope:'Existing display preferences and customer-field correspondence; not full source/pixel/native acceptance'},null,2));console.log('PASS: '+Object.keys(checks).length+' company display drag/correspondence checks');
}catch(error){fs.writeFileSync(path.join(evidence,'failure.json'),JSON.stringify({error:error.message,checks,observations},null,2));if(cdp)await frame('failure').catch(()=>{});throw error;}
finally{cdp?.close();for(const child of [...children].reverse())await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});fs.writeFileSync(path.join(evidence,'cleanup.json'),JSON.stringify({temporaryRemoved:!fs.existsSync(temporary),children:children.map(child=>({pid:child.pid,exitCode:child.exitCode,signalCode:child.signalCode}))},null,2));assert.ok(children.every(child=>child.exitCode===0));}
