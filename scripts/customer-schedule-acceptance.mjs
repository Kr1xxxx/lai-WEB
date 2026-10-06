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
const evidence=path.resolve(process.env.LAI_CUSTOMER_SCHEDULE_EVIDENCE || 'evidence/ui-1.4.22/customer-schedule');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-customer-schedule-'));
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
    env:{...process.env,LAI_DATA_DIR:path.join(temporary,'database'),LAI_APP_PORT:String(port),LAI_API_TOKEN:token,LAI_INSTANCE_NONCE:'customer-schedule-test',LAI_APP_NO_OPEN:'1'},stdio:'ignore'});
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

async function click(selector){await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);}
async function openCustomer(name){await click(`[data-open="${name}"]`);await until(()=>evaluate(`!!document.querySelector('.lcd-root')`),'customer detail');}
async function openSchedule(){await click('[data-action="schedule-edit"]');await until(()=>evaluate(`!!document.querySelector('#customer-schedule-form')`),'schedule form');}
async function closeForm(form){await click('#overlay-root [data-action="close-modal"]');await until(()=>evaluate(`!document.querySelector(${JSON.stringify(form)})`),'cancel form');}
async function submit(form,date){await evaluate(`(()=>{const f=document.querySelector(${JSON.stringify(form)});if(${JSON.stringify(date)}!==null)f.elements.date.value=${JSON.stringify(date)};f.requestSubmit()})()`);}
async function list(){await click('[data-action="list"]');await until(()=>evaluate(`!!document.querySelector('.customer-table')`),'list');}
async function group(id){await click(`[data-group="${id}"]`);}
async function route(name){await click(`.rail [data-lai-route="${name}"]`);await until(()=>evaluate(`location.hash==='#${name}'`),'route');}
async function month(value){await evaluate(`(()=>{const m=document.querySelector('#biz-month');m.value=${JSON.stringify(value)};m.dispatchEvent(new Event('change',{bubbles:true}));})()`);}
async function rowDate(name){return evaluate(`(()=>{const headers=[...document.querySelectorAll('.customer-table th')];const i=headers.findIndex(e=>e.querySelector('[data-sort-field="nextFollow"]'));return document.querySelector('[data-open="${name}"]').closest('tr').children[i].textContent.trim()})()`);}
async function batch(names){for(const name of names)await click(`[data-select="${name}"]`);await click('[data-action="batch-schedule"]');}
async function externalSave(change){const value=await snapshot();change(value.data);const response=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:value,baseRevision:value.revision})});assert.equal(response.status,200);return snapshot();}
const A='Schedule Alpha',B='Schedule Beta',C='Schedule Gamma';
try{
 fs.mkdirSync(evidence,{recursive:true});backend=await startBackend();const initial=await snapshot();
 initial.data.customers={
  [A]:{country:'US',source:'Test',nextFollow:'2040-10-01',lastFollowup:'2026-09-01T00:00:00Z',history:[{type:'followup',text:'Existing followup',time:'2026-09-01T00:00:00Z'}],unknown:{keep:1}},
  [B]:{country:'US',source:'Test',nextFollow:'',unknown:{keep:2}},
  [C]:{country:'US',source:'Test',nextFollow:'2040-12-15',history:[],unknown:{keep:3}},
 };
 initial.data.orders=[];initial.data.trashOrders=[];initial.data.deletedOrders=[];initial.data.laiTasks=[];
 initial.data.previewSegments=[{id:'schedule-manual',name:'Schedule group',kind:'manual',members:[A,B],archived:false}];
 initial.data.previewTable={order:['name','nextFollow'],frozen:['name']};
 const seeded=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:initial,baseRevision:initial.revision})});assert.equal(seeded.status,200);
 const port=await freePort();const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps',`--user-data-dir=${path.join(temporary,'chrome')}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});children.push(browser);
 let target;await until(async()=>{try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'browser');cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:1022,deviceScaleFactor:1,mobile:false});await navigate();const baseline=await snapshot();

 await openCustomer(A);await openSchedule();assert.equal(await evaluate(`document.querySelector('#customer-schedule-date').value`),'2040-10-01');await evaluate(`document.querySelector('#customer-schedule-date').value='2040-11-05'`);await closeForm('#customer-schedule-form');assert.deepEqual(await snapshot(),baseline);checks.cancelRetainsPersistedDateWithoutWrites=true;
 await openSchedule();await submit('#customer-schedule-form',null);await until(()=>evaluate(`document.querySelector('#workspace-error')?.textContent==='跟进日程无需更新'`),'unchanged error');assert.deepEqual(await snapshot(),baseline);assert.equal(await evaluate(`document.querySelector('[form="customer-schedule-form"]').disabled`),false);checks.unchangedDateRejectedWithoutWrite=true;
 await submit('#customer-schedule-form','2040-11-05');await until(()=>evaluate(`!document.querySelector('#customer-schedule-form')&&document.querySelector('.lcd-schedule-entry')?.textContent.includes('2040-11-05')`),'single date saved');const saved=await snapshot();assert.equal(saved.data.customers[A].nextFollow,'2040-11-05');assert.equal(saved.data.customers[A].lastFollowup,baseline.data.customers[A].lastFollowup);assert.deepEqual(saved.data.customers[A].history.slice(1),baseline.data.customers[A].history);assert.equal(saved.data.customers[A].history[0].type,'operation');assert.deepEqual(saved.data.customers[A].unknown,{keep:1});assert.deepEqual(saved.data.orders,baseline.data.orders);assert.deepEqual(saved.data.previewSegments,baseline.data.previewSegments);checks.singleDatePreservesFollowupOrdersGroupsAndMetadata=true;
 await click('[data-action="schedule-view"]');await until(()=>evaluate(`document.querySelector('#biz-month')?.value==='2040-11'`),'calendar month');assert.equal(await evaluate(`!!document.querySelector('[data-biz-day="2040-11-05"].selected')`),true);assert.equal(await evaluate(`document.querySelectorAll('.calendar-agenda [data-biz-customer="${A}"]').length`),1);await frame('calendar-selected-schedule');await click(`.calendar-agenda [data-biz-customer="${A}"]`);await until(()=>evaluate(`!!document.querySelector('.lcd-root')`),'calendar return detail');await openSchedule();assert.equal(await evaluate(`document.querySelector('#customer-schedule-date').value`),'2040-11-05');await closeForm('#customer-schedule-form');checks.calendarJumpSelectsDateAndReopensSameCustomer=true;
 await list();assert.equal(await rowDate(A),'2040-11-05');await group('followup');assert.equal(await evaluate(`document.querySelector('[data-group="followup"] small').textContent`),'0');assert.deepEqual(await evaluate(`[...document.querySelectorAll('.company-link')].map(e=>e.dataset.open).sort()`),[]);await frame('list-followup-column');await group('all');await route('dashboard');assert.equal(await evaluate(`[...document.querySelectorAll('.business-kpis>div')].find(e=>e.textContent.includes('待跟进客户')).querySelector('strong').textContent`),'0');checks.listGroupAndDashboardUseExistingDueDateScope=true;
 await route('customers');await openCustomer(A);await openSchedule();await click('#clear-customer-schedule');await until(()=>evaluate(`!document.querySelector('#customer-schedule-form')&&!document.querySelector('.lcd-schedule-entry')`),'date cleared');const cleared=await snapshot();assert.equal(cleared.data.customers[A].nextFollow,'');assert.equal(cleared.data.customers[A].lastFollowup,baseline.data.customers[A].lastFollowup);assert.equal(cleared.data.customers[A].history[0].text,'取消客户跟进日程');await list();assert.equal(await rowDate(A),'—');assert.equal(await evaluate(`document.querySelector('[data-group="followup"] small').textContent`),'0');await route('calendar');await month('2040-11');assert.equal(await evaluate(`document.querySelectorAll('.calendar-agenda [data-biz-customer="${A}"]').length`),0);checks.clearRemovesDetailListGroupAndCalendarDate=true;
 await route('customers');await batch([B,C]);await submit('#batch-schedule-form','');assert.equal(await evaluate(`document.querySelector('#batch-schedule-date').validity.valueMissing`),true);assert.deepEqual(await snapshot(),cleared);await closeForm('#batch-schedule-form');assert.equal(await evaluate(`document.querySelector('.replica-batch b').textContent`),'2');assert.deepEqual(await snapshot(),cleared);checks.batchRequiredDateAndCancelPreserveSelectionAndData=true;
 await click('[data-action="batch-schedule"]');await submit('#batch-schedule-form','2040-12-15');await until(()=>evaluate(`!document.querySelector('#batch-schedule-form')&&!document.querySelector('.replica-batch')`),'batch saved');const batchSaved=await snapshot();assert.deepEqual(batchSaved.data.customers[C],cleared.data.customers[C]);assert.equal(batchSaved.data.customers[B].nextFollow,'2040-12-15');assert.equal(batchSaved.data.customers[B].history[0].type,'operation');assert.deepEqual(batchSaved.data.customers[A],cleared.data.customers[A]);assert.deepEqual(batchSaved.data.previewSegments,baseline.data.previewSegments);assert.equal(await rowDate(B),'2040-12-15');assert.equal(await evaluate(`document.querySelector('[data-group="followup"] small').textContent`),'0');checks.batchChangesOnlyDifferentDatesAndClearsSelection=true;
 await batch([B,C]);await submit('#batch-schedule-form','2040-12-15');await until(()=>evaluate(`document.querySelector('#workspace-error')?.textContent==='所选客户的跟进日程无需更新'`),'batch noop');assert.deepEqual(await snapshot(),batchSaved);assert.equal(await evaluate(`document.querySelector('.replica-batch b').textContent`),'2');await closeForm('#batch-schedule-form');await click('[data-select="'+B+'"]');await click('[data-select="'+C+'"]');checks.batchNoopPreservesSelectionWithoutWrite=true;
 await openCustomer(B);await openSchedule();const external=await externalSave(data=>{data.customers[B].nextFollow='2041-01-01';data.customers[B].note='External note';});await submit('#customer-schedule-form','2042-02-02');await until(()=>evaluate(`document.querySelector('#workspace-error')?.textContent.includes('数据已发生变化')`),'single conflict');assert.equal(await evaluate(`document.querySelector('#customer-schedule-date').value`),'2042-02-02');assert.equal(await evaluate(`document.querySelector('[form="customer-schedule-form"]').disabled`),false);assert.deepEqual(await snapshot(),external);await frame('single-conflict-retains-date');await closeForm('#customer-schedule-form');await navigate();await openCustomer(B);await openSchedule();assert.equal(await evaluate(`document.querySelector('#customer-schedule-date').value`),'2041-01-01');await closeForm('#customer-schedule-form');await list();assert.equal(await rowDate(B),'2041-01-01');checks.singleConflictRetainsDraftAndReloadReadsExternalRevision=true;
 await batch([B,C]);const newer=await externalSave(data=>{data.customers[C].nextFollow='2043-03-03';});await submit('#batch-schedule-form','2044-04-04');await until(()=>evaluate(`document.querySelector('#workspace-error')?.textContent.includes('数据已发生变化')`),'batch conflict');assert.equal(await evaluate(`document.querySelector('#batch-schedule-date').value`),'2044-04-04');assert.equal(await evaluate(`document.querySelector('[form="batch-schedule-form"]').disabled`),false);assert.equal(await evaluate(`document.querySelector('.replica-batch b').textContent`),'2');assert.deepEqual(await snapshot(),newer);await frame('batch-conflict-retains-selection');await closeForm('#batch-schedule-form');checks.batchConflictRetainsDraftAndSelectionWithoutPartialWrite=true;
 await navigate();await openCustomer(A);await pointerClick('[data-action="schedule-edit"]');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:720,deviceScaleFactor:1,mobile:false});await until(()=>evaluate(`!document.getAnimations().some(a=>a.playState==='running'&&a.effect.getTiming().iterations!==Infinity)`),'drawer settles');const bounds=await evaluate(`(()=>{const r=document.querySelector('[form="customer-schedule-form"]').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}})()`);assert.ok(bounds.left>=0&&bounds.right<=1100&&bounds.top>=0&&bounds.bottom<=720);await frame('schedule-editor-1100');await closeForm('#customer-schedule-form');assert.deepEqual(await snapshot(),newer);checks.minimumWindowFooterVisibleAndCancelNoWrite=true;
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({testedAt:new Date().toISOString(),result:'pass',app,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),checks,bounds,scope:'Existing customer date/clear/batch/conflict flows; disposable SQLite and Chrome; no new fields/rules or production writes'},null,2));console.log('PASS: '+Object.keys(checks).length+' existing customer schedule workflow checks');
}catch(error){console.error(error.stack);fs.writeFileSync(path.join(evidence,'progress.json'),JSON.stringify({checks,error:error.message},null,2));if(cdp)await frame('failure').catch(()=>{});throw error;}
finally{cdp?.close();for(const child of children)await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});}

