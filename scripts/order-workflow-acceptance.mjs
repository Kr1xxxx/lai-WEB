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
const evidence=path.resolve(process.env.LAI_ORDER_FLOW_EVIDENCE || 'evidence/ui-1.4.18/order-workflow');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-order-workflow-'));
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
    env:{...process.env,LAI_DATA_DIR:path.join(temporary,'database'),LAI_APP_PORT:String(port),LAI_API_TOKEN:token,LAI_INSTANCE_NONCE:'order-workflow-test',LAI_APP_NO_OPEN:'1'},stdio:'ignore'});
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
 await cdp.call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
 await cdp.call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
}

async function route(name){await evaluate(`document.querySelector('.rail [data-lai-route="${name}"]').click()`);await until(()=>evaluate(`document.querySelector('.business-title')?.textContent`),'business route');}
async function action(name){await evaluate(`document.querySelector('[data-biz-action="${name}"]').click()`);}
async function cancel(){await action('close-editor');await until(()=>evaluate(`!document.querySelector('#biz-order-form')`),'editor cancelled');}
async function fill(values){await evaluate(`(()=>{const f=document.querySelector('#biz-order-form');for(const [key,value]of Object.entries(${JSON.stringify(values)})){const e=f.elements[key];if(e.type==='checkbox')e.checked=value;else e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));}})()`);}
async function submit(){await evaluate(`document.querySelector('#biz-order-form').requestSubmit(document.querySelector('[form="biz-order-form"][type="submit"]'))`);}
async function open(id){await evaluate(`document.querySelector('[data-biz-order="${id}"]').click()`);await until(()=>evaluate(`!!document.querySelector('#biz-order-form')`),'order editor');}
try{
 fs.mkdirSync(evidence,{recursive:true});backend=await startBackend();const initial=await snapshot();
 const original={id:'order-base',num:'FLOW-001',client:'Existing Customer',country:'US',currency:'USD',amount:100,paidAmount:20,stage:'production',createdAt:'2026-09-01',orderMonth:'2026-09',owner:'Team',productType:'Example',attachments:[{id:'doc-keep'}],logs:[{text:'keep history'}],unknown:{keep:1}};
 initial.data.customers={'Existing Customer':{country:'US',owner:'Team',email:'existing@example.test',extra:'keep-profile'}};initial.data.orders=[original];initial.data.trashOrders=[];initial.data.deletedOrders=[];initial.data.previewSegments=[];
 const seeded=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:initial,baseRevision:initial.revision})});assert.equal(seeded.status,200);
 const port=await freePort();const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps',`--user-data-dir=${path.join(temporary,'chrome')}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});children.push(browser);
 let target;await until(async()=>{try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'browser');cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:1022,deviceScaleFactor:1,mobile:false});await navigate();await route('order-list');const baseline=await snapshot();
 await action('new-order');assert.deepEqual(await evaluate(`[...document.querySelector('#biz-customer-names').options].map(o=>o.value)`),['Existing Customer']);await fill({num:'CANCELLED',client:'Existing Customer',amount:45,note:'cancelled draft'});await cancel();assert.deepEqual(await snapshot(),baseline);checks.cancelNoWritesAndCustomerSuggestions=true;
 await action('new-order');await fill({num:'FLOW-002',client:'Existing Customer',amount:45,currency:'EUR',createdAt:'2026-09-03',note:'New isolated order'});await submit();await until(()=>evaluate(`!document.querySelector('#biz-order-form')`),'new order saved');const afterNew=await snapshot();const added=afterNew.data.orders.find(o=>o.num==='FLOW-002');assert.ok(added);assert.equal(added.client,'Existing Customer');assert.equal(added.currency,'EUR');assert.equal(added.amount,45);assert.deepEqual(afterNew.data.customers,baseline.data.customers);checks.createExistingCustomerAndCurrency=true;
 await action('new-order');await fill({num:' flow-001 ',client:'Existing Customer',amount:55,note:'keep duplicate draft'});await submit();await until(()=>evaluate(`document.querySelector('#biz-order-error')?.textContent.includes('订单号已存在')`),'duplicate rejected');assert.equal(await evaluate(`document.querySelector('#biz-order-form').elements.note.value`),'keep duplicate draft');assert.deepEqual(await snapshot(),afterNew);await frame('duplicate-retains-draft');await cancel();checks.duplicateCaseWhitespaceRejectedDraftRetained=true;
 await open('order-base');await fill({note:'Edited isolated note'});await submit();await until(()=>evaluate(`!document.querySelector('#biz-order-form')`),'edited saved');const editedState=await snapshot();const edited=editedState.data.orders.find(o=>o.id==='order-base');for(const key of ['attachments','logs','unknown'])assert.deepEqual(edited[key],original[key]);assert.equal(edited.note,'Edited isolated note');assert.deepEqual(editedState.data.customers,baseline.data.customers);checks.editPreservesMetadataAndCustomer=true;
 await open('order-base');await fill({note:'Unsaved archive draft',isDraft:true});await action('archive-order');await action('cancel-archive');assert.equal(await evaluate(`document.querySelector('#biz-order-form').elements.note.value`),'Unsaved archive draft');assert.equal(await evaluate(`document.querySelector('#biz-order-form').elements.isDraft.checked`),true);assert.deepEqual(await snapshot(),editedState);await cancel();checks.archiveCancelRetainsUnsavedFields=true;
 await open('order-base');await action('archive-order');await action('confirm-archive');await until(async()=>!(await snapshot()).data.orders.some(o=>o.id==='order-base'),'archived in SQLite');await until(()=>evaluate(`!document.querySelector('#biz-order-form')`),'archive editor closed');const archivedState=await snapshot();const archived=archivedState.data.trashOrders.find(o=>o.id==='order-base');for(const key of ['attachments','logs','unknown','note'])assert.deepEqual(archived[key],edited[key]);assert.deepEqual(archivedState.data.customers,baseline.data.customers);
 await stop(backend.child);assert.notEqual(backend.child.exitCode,null,'Old disposable service must exit before restart');
 backend=await startBackend();assert.deepEqual(await snapshot(),archivedState);
 await navigate();await route('order-list');
 assert.equal(await evaluate(`!!document.querySelector('[data-biz-order="order-base"]')`),false);
 checks.archivedOrderAndCustomerMetadataSurviveServiceRestart=true;
 await action('order-trash');await until(()=>evaluate(`!!document.querySelector('[data-biz-action="restore-order"]')`),'trash restore visible');await action('restore-order');await until(async()=>(await snapshot()).data.orders.some(o=>o.id==='order-base'),'restored in SQLite');const restoredState=await snapshot();assert.deepEqual(restoredState.data.orders.find(o=>o.id==='order-base'),edited);assert.equal(restoredState.data.trashOrders.length,0);checks.archiveRestorePreservesOrderAndCustomer=true;
 await action('orders');await open('order-base');await fill({note:'Local stale edit'});const external=await snapshot();external.data.orders.find(o=>o.id==='order-base').note='Other session edit';const externalSave=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:external,baseRevision:external.revision})});assert.equal(externalSave.status,200);const otherSessionState=await snapshot();await submit();await until(()=>evaluate(`!!document.querySelector('#biz-order-error')?.textContent`),'conflict error');assert.equal(await evaluate(`document.querySelector('#biz-order-form').elements.note.value`),'Local stale edit');assert.deepEqual(await snapshot(),otherSessionState);assert.equal(await evaluate(`document.querySelector('[form="biz-order-form"]').disabled`),false);await frame('conflict-retains-draft');await cancel();checks.conflictRetainsDraftAndDoesNotOverwrite=true;
 await navigate();await route('order-list');await open('order-base');assert.equal(await evaluate(`document.querySelector('#biz-order-form').elements.note.value`),'Other session edit');await cancel();await frame('order-list');checks.reloadReadsPersistedExternalRevision=true;
 // Block only this disposable browser's save request; SQLite remains live and inspectable.
 const beforeTransportFailure=await snapshot();
 await open('order-base');await fill({note:'Retry after temporary connection failure'});
 await cdp.call('Network.enable');await cdp.call('Network.setBlockedURLs',{urls:[backend.base+'/api/save']});
 await submit();await until(()=>evaluate(`!!document.querySelector('#biz-order-error')?.textContent`),'transport failure visible');
 assert.equal(await evaluate(`document.querySelector('#biz-order-form').elements.note.value`),'Retry after temporary connection failure');
 assert.equal(await evaluate(`document.querySelector('[form="biz-order-form"][type="submit"]').disabled`),false);
 assert.equal(await evaluate(`document.querySelector('[data-biz-action="close-editor"]').disabled`),false);
 assert.deepEqual(await snapshot(),beforeTransportFailure);
 await frame('transport-failure-retains-order');
 checks.transportFailureRetainsOrderDraftAndReleasesControls=true;
 await cdp.call('Network.setBlockedURLs',{urls:[]});await submit();
 await until(()=>evaluate(`!document.querySelector('#biz-order-form')`),'transport retry saved');
 const afterTransportRetry=await snapshot();
 assert.equal(afterTransportRetry.revision,beforeTransportFailure.revision+1);
 assert.equal(afterTransportRetry.data.orders.find(o=>o.id==='order-base').note,'Retry after temporary connection failure');
 assert.equal(afterTransportRetry.data.orders.length,beforeTransportFailure.data.orders.length);
 assert.deepEqual(afterTransportRetry.data.customers,beforeTransportFailure.data.customers);
 await navigate();await route('order-list');await open('order-base');
 assert.equal(await evaluate(`document.querySelector('#biz-order-form').elements.note.value`),'Retry after temporary connection failure');await cancel();
 checks.transportRecoveryRetriesSameOrderExactlyOnceAndPersists=true;
 // A multi-page fixture verifies the rendered list and controls, independently of its filter implementation.
 const listSeed=await snapshot();
 const listOrders=Array.from({length:43},(_,i)=>({id:`list-${i}`,num:`LIST-${String(i+1).padStart(3,'0')}`,client:'Existing Customer',country:'US',currency:i%2?'EUR':'USD',amount:10+i,paidAmount:0,stage:i%3?'production':'quote',createdAt:`2026-09-${String(i%28+1).padStart(2,'0')}`,orderMonth:'2026-09',productType:'Synthetic',trackingNumber:`TRACK-${i}`,isDraft:false}));
 listOrders[0].num='中文<&"订单'; listOrders[0].trackingNumber='查找中文物流';
 listSeed.data.orders=listOrders;
 assert.equal((await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:listSeed,baseRevision:listSeed.revision})})).status,200);
 const listBaseline=await snapshot();await navigate();await route('order-list');
 const visibleIds=()=>evaluate(`Array.from(document.querySelectorAll('.unified-orders tbody tr'),tr=>tr.querySelector('[data-biz-order]').dataset.bizOrder)`);
 const listControls=()=>evaluate(`({page:document.querySelector('.pagination .pages span').textContent,total:document.querySelector('.pagination>span').textContent,prev:document.querySelector('[data-biz-action="prev"]').disabled,next:document.querySelector('[data-biz-action="next"]').disabled})`);
 const allIds=[];const pageOne=await listControls();assert.equal(pageOne.page,'1 / 3');assert.equal(pageOne.prev,true);assert.equal(pageOne.next,false);
 for(let i=0;i<3;i++){const ids=await visibleIds();assert.equal(ids.length,i===2?3:20);allIds.push(...ids);if(i<2)await pointerClick('[data-biz-action="next"]');}
 const pageThree=await listControls();assert.equal(pageThree.next,true);assert.equal(new Set(allIds).size,43);assert.deepEqual(allIds.slice().sort(),listOrders.map(o=>o.id).sort());
 checks.paginationHasEveryOrderExactlyOnce=true;
 const selectFilter=(id,value)=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify('#')}+${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await selectFilter('biz-stage','quote');await selectFilter('biz-currency','EUR');
 assert.equal((await listControls()).page,'1 / 1');
 assert.deepEqual((await visibleIds()).sort(),['list-3','list-9','list-15','list-21','list-27','list-33','list-39'].sort());
 await frame('order-filter-intersection');
 checks.stageAndCurrencyIntersectAndResetPagination=true;
 await pointerClick('[data-biz-action="clear-filters"]');
 await pointerClick('#biz-search');await cdp.call('Input.insertText',{text:'中文<&"订单'});
 await until(async()=>JSON.stringify(await visibleIds())===JSON.stringify(['list-0']),'literal customer order search');
 const literalSearch=await evaluate(`({value:document.querySelector('#biz-search').value,focused:document.activeElement===document.querySelector('#biz-search'),injectedElements:document.querySelectorAll('.unified-orders tbody script').length})`);
 assert.equal(literalSearch.value,'中文<&"订单');assert.equal(literalSearch.focused,true);assert.equal(literalSearch.injectedElements,0);
 await pointerClick('[data-biz-action="clear-filters"]');await pointerClick('#biz-search');await cdp.call('Input.insertText',{text:'查找中文物流'});
 await until(async()=>JSON.stringify(await visibleIds())===JSON.stringify(['list-0']),'tracking search');await frame('order-search-literal');
 checks.literalChineseAndTrackingSearchRetainFocus=true;
 await pointerClick('[data-biz-action="clear-filters"]');await pointerClick('#biz-search');await cdp.call('Input.insertText',{text:'NO-SUCH-ORDER'});
 assert.deepEqual(await visibleIds(),[]);const noMatches=await listControls();assert.equal(noMatches.page,'1 / 1');assert.equal(noMatches.prev,true);assert.equal(noMatches.next,true);
 await pointerClick('[data-biz-action="clear-filters"]');assert.equal((await visibleIds()).length,20);assert.equal(await evaluate(`document.querySelector('#biz-search').value`),'');assert.deepEqual(await snapshot(),listBaseline);
 checks.emptySearchClearRestoresListWithoutWrites=true;
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({testedAt:new Date().toISOString(),result:'pass',app,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),checks,scope:'Existing order workflows only; disposable SQLite and isolated Chrome; no new business fields/rules or production data writes'},null,2));console.log('PASS: '+Object.keys(checks).length+' existing order workflow checks');
}catch(error){console.error(error.message);if(cdp)await frame('failure').catch(()=>{});throw error;}
finally{cdp?.close();for(const child of children)await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
