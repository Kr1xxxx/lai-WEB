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
const evidence=path.resolve(process.env.LAI_PRODUCT_CLEAR_EVIDENCE || 'evidence/ui-1.4.51/product-clear');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-known-motion-'));
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
 const point=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
 await cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
 await cdp.call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
 await cdp.call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
}
const trigger='#ce-productType + .lai-select-trigger';
async function key(key){const codes={Escape:27,Enter:13,ArrowDown:40,Home:36,End:35,Tab:9};await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:codes[key],...(key==='Enter'?{text:'\r',unmodifiedText:'\r'}:{})});await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode:codes[key]});}
async function editor(pointer=false){if(pointer)await pointerClick('.lcd-pagebar [data-action="edit"]');else await evaluate(`document.querySelector('.lcd-pagebar [data-action="edit"]').click()`);await until(()=>evaluate(`!!document.querySelector(${JSON.stringify(trigger)})`),'product trigger');await evaluate(`document.querySelector(${JSON.stringify(trigger)}).scrollIntoView({block:'center',behavior:'instant'})`);await until(()=>evaluate(`!document.getAnimations().some(a=>a.playState==='running'&&a.effect.getTiming().iterations!==Infinity)`),'drawer settled');}

const clear='#ce-productType ~ .lai-select-clear';
async function hoverProduct(){const point=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(trigger)}).getBoundingClientRect();return{x:r.left+20,y:r.top+16}})()`);await cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});}
async function observeEvents(){await evaluate(`(()=>{const s=document.querySelector('#ce-productType');s.dataset.inputs='0';s.dataset.changes='0';s.addEventListener('input',()=>s.dataset.inputs=String(+s.dataset.inputs+1));s.addEventListener('change',()=>s.dataset.changes=String(+s.dataset.changes+1))})()`);}
async function draftState(){return evaluate(`(()=>{const s=document.querySelector('#ce-productType'),b=document.querySelector(${JSON.stringify(trigger)}),c=document.querySelector(${JSON.stringify(clear)});return{value:s.value,label:b.textContent,inputs:+s.dataset.inputs,changes:+s.dataset.changes,expanded:b.getAttribute('aria-expanded'),clearHidden:c?.hidden,focused:document.activeElement===b,searchCount:document.querySelectorAll('.ce-select > .lai-select-search').length}})()`);}
async function cancel(){await pointerClick('.customer-editor [data-action="close-modal"]');await until(()=>evaluate(`!document.querySelector('#customer-form')`),'cancelled editor');}
try{
 fs.mkdirSync(evidence,{recursive:true});backend=await startBackend();const initial=await snapshot();
 const first={country:'US',source:'Referral',productType:'Existing Product',contact:'Main',email:'main@example.test',phone:'5550101',companyProducts:'Separate optional product',unknown:{kept:true}};
 const other={country:'DE',source:'Referral',productType:'Second Product'};
 initial.data.customers={'Motion Customer':first,'Other Customer':other};initial.data.orders=[];initial.data.previewSegments=[];initial.data.previewTable={order:['name','productType','companyProducts'],frozen:['name'],compact:false};
 const seeded=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:initial,baseRevision:initial.revision})});assert.equal(seeded.status,200);
 const port=await freePort();const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps',`--user-data-dir=${path.join(temporary,'chrome')}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});children.push(browser);
 let target;await until(async()=>{try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item=>item.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'browser');
 cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1728,height:958,deviceScaleFactor:1,mobile:false});await navigate();
 const baseline=await snapshot();await evaluate(`document.querySelector('[data-open="Motion Customer"]').click()`);await until(()=>evaluate(`!!document.querySelector('.lcd-pagebar [data-action="edit"]')`),'detail');await editor();
 assert.equal(await evaluate(`!!document.querySelector(${JSON.stringify(clear)})`),true,'Existing selected product must have a clear action');checks.clearActionExists=true;
 await cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:10,y:90});await evaluate(`document.activeElement.blur()`);await until(()=>evaluate(`Number(getComputedStyle(document.querySelector(${JSON.stringify(clear)})).opacity)===0`),'resting clear hidden');
 await hoverProduct();await until(()=>evaluate(`Number(getComputedStyle(document.querySelector(${JSON.stringify(clear)})).opacity)===1`),'hover clear visible');
 const geometry=await evaluate(`(()=>{const c=document.querySelector(${JSON.stringify(clear)}),b=document.querySelector(${JSON.stringify(trigger)}),r=c.getBoundingClientRect(),a=b.getBoundingClientRect(),s=getComputedStyle(c);return{width:r.width,height:r.height,top:r.top-a.top,right:a.right-r.right,transition:s.transitionDuration,aria:c.getAttribute('aria-label'),type:c.type}})()`);
 assert.equal(geometry.width,12);assert.equal(geometry.height,12);assert.equal(geometry.top,10);assert.equal(geometry.right,11);assert.equal(geometry.transition,'0.3s, 0.15s');assert.equal(geometry.type,'button');assert.match(geometry.aria,/清除.*主营产品/);await frame('hover-clear');checks.sourceGeometryAndHover=true;
 await observeEvents();await pointerClick(clear);let state=await draftState();assert.equal(state.value,'');assert.equal(state.label,'请选择');assert.equal(state.expanded,'false');assert.equal(state.focused,true);assert.equal(state.inputs,1);assert.equal(state.changes,1);assert.equal(state.clearHidden,true);assert.deepEqual(await snapshot(),baseline);await frame('closed-cleared-draft');checks.closedClearChangesDraftExactlyOnce=true;
 await cancel();assert.deepEqual(await snapshot(),baseline);await editor();assert.equal((await draftState()).value,'Existing Product');checks.cancelRestoresOriginal=true;
 await pointerClick(trigger);await evaluate(`(()=>{const s=document.querySelector('.ce-select > .lai-select-search');s.value='cond';s.dispatchEvent(new Event('input',{bubbles:true}))})()`);assert.equal(await evaluate(`document.querySelector('.lai-select-options').textContent`),'Second Product');await observeEvents();await pointerClick(clear);
 state=await draftState();assert.equal(state.value,'');assert.equal(state.searchCount,0);assert.equal(state.focused,true);assert.equal(state.expanded,'false');assert.equal(state.inputs,1);assert.equal(state.changes,1);
 const closing=await evaluate(`(()=>{const m=document.querySelector('.is-customer-product');return m?{inert:m.inert,hidden:m.getAttribute('aria-hidden'),closing:m.classList.contains('is-closing'),duration:getComputedStyle(m).animationDuration}:null})()`);
 assert.equal(closing?.inert,true);assert.equal(closing.hidden,'true');assert.equal(closing.closing,true);assert.equal(closing.duration,'0.2s');await until(()=>evaluate(`!document.querySelector('.is-customer-product')`),'clear exit finished');assert.deepEqual(await snapshot(),baseline);checks.openQueryClearClosesInertMenuWithoutSaving=true;
 await pointerClick(trigger);assert.equal(await evaluate(`document.querySelector('.ce-select > .lai-select-search').value`),'');assert.equal(await evaluate(`document.querySelector('#ce-productType').value`),'');await key('Escape');await cancel();await editor();assert.equal((await draftState()).value,'Existing Product');checks.reopenClearStartsFreshAndCancelRetainsProduct=true;
 await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:720,deviceScaleFactor:1,mobile:false});await evaluate(`document.querySelector(${JSON.stringify(trigger)}).scrollIntoView({block:'center',behavior:'instant'});document.querySelector(${JSON.stringify(trigger)}).focus()`);await key('Tab');await until(()=>evaluate(`Number(getComputedStyle(document.querySelector(${JSON.stringify(clear)})).opacity)===1`),'keyboard clear visible');assert.equal(await evaluate(`document.activeElement===document.querySelector(${JSON.stringify(clear)})`),true,'Tab reaches the clear button');await frame('keyboard-clear-compact');await key('Enter');assert.equal((await draftState()).value,'');assert.equal((await draftState()).focused,true);assert.deepEqual(await snapshot(),baseline);checks.keyboardClearAtMinimumMainWindow=true;
 await cancel();await editor();await evaluate(`document.querySelector('#ce-productType').disabled=true`);assert.equal((await draftState()).clearHidden,true);await evaluate(`document.querySelector('#ce-productType').disabled=false;document.querySelector('#ce-productType').required=true`);assert.equal((await draftState()).clearHidden,true);await evaluate(`document.querySelector('#ce-productType').required=false`);assert.equal((await draftState()).clearHidden,false);checks.disabledAndRequiredDoNotExposeClear=true;
 await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});const reducedClearDuration=await evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(clear)})).transitionDuration`);assert.ok(reducedClearDuration.split(',').every(s=>parseFloat(s)<=0.001),'Reduced-motion transitions must finish within 1ms');await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});checks.reducedMotionClearDoesNotAnimate=true;
 await observeEvents();await pointerClick(clear);await evaluate(`document.querySelector('#customer-form').requestSubmit()`);await until(async()=>(await snapshot()).revision===baseline.revision+1,'empty product saved once');const saved=await snapshot();assert.equal(saved.data.customers['Motion Customer'].productType||'','');assert.equal(saved.revision,baseline.revision+1);assert.equal(saved.data.customers['Motion Customer'].companyProducts,first.companyProducts);assert.deepEqual(saved.data.customers['Motion Customer'].unknown,first.unknown);assert.deepEqual(saved.data.customers['Other Customer'],other);checks.saveEmptyProductPreservesIndependentAndUnknownFields=true;
 await navigate();assert.match(await evaluate(`document.querySelector('[data-open="Motion Customer"]').closest('tr').innerText`),/Separate optional product/);await evaluate(`document.querySelector('[data-open="Motion Customer"]').click()`);await until(()=>evaluate(`!!document.querySelector('.lcd-pagebar [data-action="edit"]')`),'saved detail reopened');await editor();assert.equal((await draftState()).value,'');assert.equal((await draftState()).clearHidden,true);await pointerClick(trigger);assert.equal(await evaluate(`document.querySelector('.ce-select > .lai-select-search').value`),'');await key('Escape');await cancel();await frame('saved-blank-reopened');checks.savedBlankReopensAndClearStaysHidden=true;

 await stop(backend.child);backend=await startBackend();const restarted=await snapshot();assert.deepEqual(restarted,saved,'Service restart must retain the exact cleared customer state and revision');checks.serviceRestartRetainsClearedValueAndRevision=true;
 await navigate();const listAfterRestart=await evaluate(`(()=>{const table=document.querySelector('.customer-table'),row=document.querySelector('[data-open="Motion Customer"]').closest('tr');const cell=id=>{const index=table.querySelector('[data-sort-field="'+id+'"]').closest('th').cellIndex;return{text:row.cells[index].textContent.trim(),title:row.cells[index].getAttribute('title')}};return{productType:cell('productType'),companyProducts:cell('companyProducts')}})()`);assert.deepEqual(listAfterRestart.productType,{text:'—',title:''});assert.deepEqual(listAfterRestart.companyProducts,{text:first.companyProducts,title:first.companyProducts});checks.restartedListUsesDistinctProductFields=true;
 await evaluate(`document.querySelector('[data-open="Motion Customer"]').click()`);await until(()=>evaluate(`!!document.querySelector('[data-tab="info"]')`),'restart detail');await evaluate(`document.querySelector('[data-tab="info"]').click()`);
 await until(()=>evaluate(`!!document.querySelector('#lcd-info-company-common')`),'restarted info fields rendered');const infoAfterRestart=await evaluate(`Object.fromEntries([...document.querySelectorAll('.lcd-info-fields .lcd-field')].map(e=>[e.querySelector('dt').textContent,e.querySelector('dd').textContent]))`);assert.equal(infoAfterRestart['主营产品.'],'—');assert.equal(infoAfterRestart['主营产品'],first.companyProducts);checks.restartedDetailUsesDistinctProductFields=true;
 await editor();assert.equal((await draftState()).value,'');assert.equal((await draftState()).clearHidden,true);await cancel();await frame('restarted-blank-product');assert.deepEqual(await snapshot(),saved);checks.restartedEditorAndCancelDoNotResurrectProduct=true;
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({testedAt:new Date().toISOString(),result:'pass',app,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),checks,geometry,closing,reducedClearDuration,listAfterRestart,infoAfterRestart,restartedRevision:restarted.revision,baselineRevision:baseline.revision,savedRevision:saved.revision,scope:'Selected-value clear only; disposable SQLite/browser; source saved business operation, query-only clear, actual source hover and continuous native trajectory unverified'},null,2));console.log('PASS: '+Object.keys(checks).length+' product clear checks');
}catch(error){fs.writeFileSync(path.join(evidence,'progress.json'),JSON.stringify({checks,error:error.message,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex')},null,2));if(cdp)await frame('failure').catch(()=>{});throw error;}
finally{cdp?.close();for(const child of children)await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
