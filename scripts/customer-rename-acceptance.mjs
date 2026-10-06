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
const evidence=path.resolve(process.env.LAI_RENAME_EVIDENCE || 'evidence/ui-1.4.34/customer-rename');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-customer-rename-'));
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
    env:{...process.env,LAI_DATA_DIR:path.join(temporary,'database'),LAI_APP_PORT:String(port),LAI_API_TOKEN:token,LAI_INSTANCE_NONCE:'customer-rename-test',LAI_APP_NO_OPEN:'1'},stdio:'ignore'});
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
 await until(()=>evaluate(`!document.getAnimations().some(a=>a.playState==='running'&&a.effect.getTiming().iterations!==Infinity)`),'click target settled');
 await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
 await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
 const point=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
 await cdp.call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
 await cdp.call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
}


async function openEditor(name){
 await evaluate(`document.querySelector('.company-link[data-open='+CSS.escape(${JSON.stringify(name)})+']').click()`);
 await until(()=>evaluate(`!!document.querySelector('.lcd-pagebar [data-action="edit"]')`),'detail');
 await pointerClick('.lcd-pagebar [data-action="edit"]');
 await until(()=>evaluate(`!!document.querySelector('#customer-form')`),'company editor');
}
async function submit(){await evaluate(`document.querySelector('#customer-form').requestSubmit(document.querySelector('[form="customer-form"][value="save"]'))`);await until(()=>evaluate(`!document.querySelector('#customer-form')`),'company saved');}
async function route(name){await evaluate(`document.querySelector('.rail [data-lai-route='+CSS.escape(${JSON.stringify(name)})+']').click()`);await until(()=>evaluate(`!!document.querySelector('.business-title')`),'business route');}
try{
 fs.mkdirSync(evidence,{recursive:true});backend=await startBackend();const initial=await snapshot();
 const make=(id,client,amount)=>({id,num:id.toUpperCase(),client,amount,paidAmount:amount,currency:'USD',stage:'done',createdAt:'2026-09-01',orderMonth:'2026-09',note:'Old Company original note',attachments:[{id:'doc-'+id}],logs:[{text:'Old Company historical text'}],unknown:{keep:true}});
 initial.data.customers={'Old Company':{client:'Old Company',country:'US',source:'Referral',contact:'Alex',email:'alex@example.test',phone:'5550100',nextFollow:'2026-09-20',unknown:{keep:true}},'Other Company':{country:'DE'}};
 initial.data.orders=[make('active','Old Company',100)];initial.data.trashOrders=[{...make('archived','Old Company',200),trashedAt:'2026-09-02'},make('other','Other Company',50)];initial.data.deletedOrders=[{...make('deleted','Old Company',300),deletedAt:'2026-09-03'}];
 initial.data.previewSegments=[{id:'manual',kind:'manual',name:'Manual',members:['Old Company','Other Company']},{id:'archived-group',kind:'manual',name:'Archived Group',archived:true,members:['Old Company']}];initial.data.laiTasks=[];
 assert.equal((await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:initial,baseRevision:initial.revision})})).status,200);
 const port=await freePort();const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps',`--user-data-dir=${path.join(temporary,'chrome')}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});children.push(browser);
 let target;await until(async()=>{try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'browser');cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1728,height:958,deviceScaleFactor:1,mobile:false});await navigate();
 const before=await snapshot();await openEditor('Old Company');await evaluate(`document.querySelector('#customer-form').elements.name.value='Unsaved Name'`);await pointerClick('.ce-footer [data-action="close-modal"]');await until(()=>evaluate(`!document.querySelector('#customer-form')`),'cancel');assert.deepEqual(await snapshot(),before);checks.cancelRenameReadOnly=true;
 await navigate();await openEditor('Old Company');await evaluate(`document.querySelector('#customer-form').elements.name.value='  New Company  '`);await submit();
 const renamed=await snapshot();
 fs.writeFileSync(path.join(evidence,'rename-observation.json'),JSON.stringify({revisionDelta:renamed.revision-before.revision,customerNames:Object.keys(renamed.data.customers),links:Object.fromEntries(['orders','trashOrders','deletedOrders'].map(bucket=>[bucket,renamed.data[bucket].map(o=>({id:o.id,client:o.client}))]))},null,2));
 assert.equal(renamed.data.trashOrders[0].client,'New Company','The shipped company editor must relink archived orders');checks.archivedOrderRelinked=true;
 assert.equal(renamed.data.deletedOrders[0].client,'New Company');checks.deletedOrderRelinked=true;
 assert.equal(renamed.data.orders[0].client,'New Company');assert.equal(renamed.data.customers['Old Company'],undefined);assert.equal(renamed.revision,before.revision+1);checks.atomicRenameOneRevision=true;
 for(const bucket of ['orders','trashOrders','deletedOrders']){assert.equal(renamed.data[bucket].length,before.data[bucket].length);renamed.data[bucket].forEach((o,i)=>{const expected=structuredClone(before.data[bucket][i]);if(expected.client==='Old Company')expected.client='New Company';assert.deepEqual(o,expected);});}checks.orderMetadataAndUnrelatedRecordsPreserved=true;
 assert.deepEqual(renamed.data.previewSegments.map(s=>s.members),[['New Company','Other Company'],['New Company']]);checks.activeAndArchivedGroupMembershipRetained=true;
 await route('order-list');await pointerClick('[data-biz-action="order-trash"]');await until(()=>evaluate(`!!document.querySelector('[data-biz-action="restore-order"][data-id="archived"]')`),'restore button');await frame('renamed-order-trash');await pointerClick('[data-biz-action="restore-order"][data-id="archived"]');await until(async()=>(await snapshot()).data.orders.some(o=>o.id==='archived'),'restored');
 const restored=await snapshot();const expected={...before.data.trashOrders[0],client:'New Company'};delete expected.trashedAt;assert.deepEqual(restored.data.orders.find(o=>o.id==='archived'),expected);assert.equal(restored.data.trashOrders.length,1);assert.equal(restored.data.deletedOrders.length,1);assert.equal(restored.revision,renamed.revision+1);checks.realRestorePreservesMetadataAndBuckets=true;
 await navigate();assert.deepEqual(await evaluate(`[...document.querySelectorAll('.customer-table [data-select]')].map(e=>e.dataset.select).sort()`),['New Company','Other Company']);await frame('single-renamed-customer');checks.restoreDoesNotCreateOldCompany=true;
 await stop(backend.child);backend=await startBackend();await navigate();assert.deepEqual((await snapshot()).data,restored.data);assert.deepEqual(await evaluate(`[...document.querySelectorAll('.customer-table [data-select]')].map(e=>e.dataset.select).sort()`),['New Company','Other Company']);checks.serviceRestartReadsPersistedRename=true;
 await route('order-list');assert.deepEqual(await evaluate(`[...document.querySelectorAll('.unified-orders [data-biz-customer]')].map(e=>e.dataset.bizCustomer)`),['New Company','New Company']);checks.orderListUsesRenamedCompany=true;
 await route('analysis');await evaluate(`(()=>{const month=document.querySelector('#biz-month');month.value='2026-09';month.dispatchEvent(new Event('change',{bubbles:true}));})()`);await until(()=>evaluate(`!!document.querySelector('[data-biz-customer="New Company"]')`),'renamed contribution');assert.deepEqual(await evaluate(`[...document.querySelector('[data-biz-customer="New Company"]').closest('tr').cells].map(e=>e.textContent.trim())`),['New Company','2','300.00 USD']);assert.equal(await evaluate(`document.querySelectorAll('[data-biz-customer="Old Company"]').length`),0);await frame('analysis-single-contribution');checks.analysisConsolidatesRestoredCustomerContribution=true;
 await route('dashboard');assert.deepEqual(await evaluate(`[...document.querySelectorAll('.pipeline-card strong')].map(e=>e.textContent)`),['New Company','New Company']);assert.deepEqual(await evaluate(`[...document.querySelectorAll('.business-kpis strong')].map(e=>e.textContent)`),['2','0','1','0']);assert.equal(await evaluate(`document.querySelector('.business-line [data-biz-customer]').dataset.bizCustomer`),'New Company');checks.dashboardOrdersAndDueFollowupUseRenamedCompany=true;
 await route('calendar');await evaluate(`(()=>{const month=document.querySelector('#biz-month');month.value='2026-09';month.dispatchEvent(new Event('change',{bubbles:true}));})()`);await until(()=>evaluate(`!!document.querySelector('.agenda-item[data-biz-customer="New Company"]')`),'followup agenda');assert.equal(await evaluate(`!!document.querySelector('.agenda-item[data-biz-customer="Old Company"]')`),false);await frame('calendar-renamed-company');await pointerClick('.agenda-item[data-biz-customer="New Company"]');await until(()=>evaluate(`!!document.querySelector('.lcd-pagebar [data-action="edit"]')`),'followup opens company detail');assert.ok(await evaluate(`document.querySelector('.lcd-root').textContent.includes('New Company')`));checks.calendarFollowupOpensRenamedProfile=true;
 assert.deepEqual((await snapshot()).data,restored.data);checks.readOnlyNavigationDoesNotSave=true;
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({testedAt:new Date().toISOString(),result:'pass',app,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),checks,scope:'Approved C01 rename links, real shipped form and archive restore, disposable SQLite and Chrome only'},null,2));console.log('PASS: '+Object.keys(checks).length+' customer rename/restore checks');
}catch(error){console.error(error.message);fs.writeFileSync(path.join(evidence,'progress.json'),JSON.stringify({checks,error:error.message},null,2));if(cdp)await frame('failure').catch(()=>{});throw error;}
finally{cdp?.close();for(const child of children)await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
