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
const evidence=path.resolve(process.env.LAI_TASK_FLOW_EVIDENCE || 'evidence/ui-1.4.21/task-workflow');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-task-workflow-'));
const children=[];
const checks={};
let cdp, backend;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const freePort=()=>new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
async function until(check,label){for(let i=0;i<160;i++){if(await check())return;await pause(50);}throw Error('Timed out: '+label);}
async function stop(child){
 if(!child||child.exitCode!==null||child.signalCode!==null)return;
 child.kill('SIGTERM');
 await Promise.race([new Promise(resolve=>child.once('exit',resolve)),pause(1500)]);
 if(child.exitCode===null&&child.signalCode===null){
  child.kill('SIGKILL');
  await until(()=>child.exitCode!==null||child.signalCode!==null,'disposable process exited');
 }
}
async function startBackend(){
  const port=await freePort(),token=crypto.randomBytes(32).toString('hex');
  const child=spawn(path.join(resources,'node-runtime'),[path.join(resources,'server.js')],{
    env:{...process.env,LAI_DATA_DIR:path.join(temporary,'database'),LAI_APP_PORT:String(port),LAI_API_TOKEN:token,LAI_INSTANCE_NONCE:'task-workflow-test',LAI_APP_NO_OPEN:'1'},stdio:'ignore'});
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


async function route(name){await evaluate(`document.querySelector('.rail [data-lai-route="${name}"]').click()`);await until(()=>evaluate(`location.hash==='#${name}'`),'route '+name);}
async function action(name){await evaluate(`document.querySelector('[data-biz-action="${name}"]').click()`);}
async function cancel(){await action('close-editor');await until(()=>evaluate(`!document.querySelector('#biz-task-form,#biz-order-form')`),'editor cancelled');}
async function fill(values){await evaluate(`(()=>{const f=document.querySelector('#biz-task-form');for(const [key,value]of Object.entries(${JSON.stringify(values)})){const e=f.elements[key];if(e.type==='checkbox')e.checked=value;else e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));}})()`);}
async function submit(){await evaluate(`document.querySelector('#biz-task-form').requestSubmit(document.querySelector('[form="biz-task-form"][type="submit"]'))`);}
async function month(value){await evaluate(`(()=>{const m=document.querySelector('#biz-month');m.value=${JSON.stringify(value)};m.dispatchEvent(new Event('change',{bubbles:true}));})()`);}
async function openTask(id){await evaluate(`document.querySelector('[data-biz-edit-task="${id}"]').click()`);await until(()=>evaluate(`!!document.querySelector('#biz-task-form')`),'task editor');}
try{
 fs.mkdirSync(evidence,{recursive:true});backend=await startBackend();const initial=await snapshot();
 initial.data.customers={'Active Due':{country:'US',nextFollow:'2026-09-14'},'Future Due':{nextFollow:'2026-10-14'},'Archived Due':{nextFollow:'2026-09-14',laiBucket:'trash'}};
 initial.data.orders=[{id:'task-order',num:'TASK-ORDER',client:'Active Due',currency:'USD',amount:100,paidAmount:0,stage:'quote',createdAt:'2026-09-14',orderMonth:'2026-09'}];initial.data.trashOrders=[{id:'trash-order',num:'TRASH-ORDER',createdAt:'2026-09-14'}];initial.data.deletedOrders=[];
 initial.data.laiTasks=[{id:'task-base',title:'Existing task',date:'2026-09-14',done:false,unknown:{keep:1}},{id:'task-done',title:'Completed task',date:'2026-09-14',done:true}];
 const seeded=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:initial,baseRevision:initial.revision})});assert.equal(seeded.status,200);
 const port=await freePort();const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps',`--user-data-dir=${path.join(temporary,'chrome')}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});children.push(browser);
 let target;await until(async()=>{try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'browser');cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:1022,deviceScaleFactor:1,mobile:false});await navigate();await route('calendar');await month('2026-09');const baseline=await snapshot();
 const agenda=await evaluate(`[...document.querySelectorAll('.agenda-item')].map(e=>e.textContent)`);assert.equal(agenda.length,4);assert.ok(agenda.some(s=>s.includes('TASK-ORDER')));assert.ok(agenda.some(s=>s.includes('Active Due')));assert.ok(agenda.some(s=>s.includes('Existing task')));assert.ok(agenda.some(s=>s.includes('Completed task')));assert.ok(agenda.every(s=>!s.includes('Archived Due')&&!s.includes('TRASH-ORDER')));checks.calendarCombinesExistingEventsAndExcludesTrash=true;
 // Same-day overflow must count every event, not just the three cell previews.
 const dayPreview=await evaluate(`(()=>{const day=document.querySelector('[data-biz-day="2026-09-14"]');return {preview:day.querySelectorAll('.calendar-event').length,overflow:day.querySelector('small')?.textContent};})()`);
 assert.deepEqual(dayPreview,{preview:3,overflow:'+ 1 项'});
 await pointerClick('[data-biz-day="2026-09-14"]');assert.equal(await evaluate(`document.querySelectorAll('.agenda-item').length`),4);
 await frame('same-day-overflow');checks.sameDayOverflowRetainsAllAgendaEvents=true;
 await pointerClick('.agenda-item[data-biz-edit-task="task-done"]');assert.equal(await evaluate(`document.querySelector('#biz-task-form').elements.done.checked`),true);await cancel();
 assert.equal(await evaluate(`document.querySelector('.calendar-day.selected').dataset.bizDay`),'2026-09-14');assert.equal(await evaluate(`document.querySelectorAll('.agenda-item').length`),4);checks.agendaTaskCancelRetainsDayAndCompletedStatus=true;
 await pointerClick('.agenda-item[data-biz-customer="Active Due"]');await until(()=>evaluate(`!!document.querySelector('.lcd-identity-text h2')`),'agenda customer detail');assert.ok(await evaluate(`document.querySelector('.lcd-identity-text h2').textContent.includes('Active Due')`));
 await route('calendar');assert.equal(await evaluate(`document.querySelector('#biz-month').value`),'2026-09');assert.equal(await evaluate(`document.querySelector('.calendar-day.selected').dataset.bizDay`),'2026-09-14');assert.equal(await evaluate(`document.querySelectorAll('.agenda-item').length`),4);assert.deepEqual(await snapshot(),baseline);checks.customerAgendaRoundTripRetainsCalendarSelectionAndData=true;
 await action('all-days');

 await evaluate(`document.querySelector('[data-biz-day="2026-09-15"]').click()`);assert.equal(await evaluate(`document.querySelectorAll('.agenda-item').length`),0);await action('all-days');assert.equal(await evaluate(`document.querySelectorAll('.agenda-item').length`),4);await month('2026-12');await evaluate(`document.querySelector('[data-biz-day="2026-12-31"]').click()`);await action('month-next');assert.equal(await evaluate(`document.querySelector('#biz-month').value`),'2027-01');assert.equal(await evaluate(`document.querySelectorAll('.calendar-day.selected').length`),0);await action('month-prev');assert.equal(await evaluate(`document.querySelector('#biz-month').value`),'2026-12');await month('2026-09');assert.deepEqual(await snapshot(),baseline);checks.dayAndCrossYearMonthSelectionReadOnly=true;
 // Hand-checked calendar boundaries: February 2028 starts Tuesday and has 29 days.
 await month('2028-02');
 assert.equal(await evaluate(`document.querySelectorAll('.calendar-day').length`),29);
 assert.equal(await evaluate(`document.querySelectorAll('.calendar-blank').length`),1);
 assert.equal(await evaluate(`document.querySelectorAll('.agenda-item').length`),0);
 await evaluate(`document.querySelector('[data-biz-day="2028-02-29"]').click()`);
 await action('new-task');
 assert.equal(await evaluate(`document.querySelector('#biz-task-form').elements.date.value`),'2028-02-29');
 await fill({title:'Cancelled leap-day task'});await cancel();assert.deepEqual(await snapshot(),baseline);
 await month('2027-02');assert.equal(await evaluate(`document.querySelectorAll('.calendar-day').length`),28);
 assert.equal(await evaluate(`document.querySelectorAll('.calendar-blank').length`),0);
 assert.equal(await evaluate(`document.querySelectorAll('.calendar-day.selected').length`),0);
 await frame('empty-calendar-february');await month('2026-09');
 checks.leapDayAndEmptyMonthNavigationPreserveData=true;
 await evaluate(`document.querySelector('[data-biz-day="2026-09-16"]').click()`);await action('new-task');assert.equal(await evaluate(`document.querySelector('#biz-task-form').elements.date.value`),'2026-09-16');await fill({title:'Cancelled task'});await cancel();assert.deepEqual(await snapshot(),baseline);checks.selectedDayDefaultsAndCancelNoWrites=true;
 await action('new-task');await fill({title:' New isolated task ',date:'2026-09-16',done:false});await submit();await until(()=>evaluate(`!document.querySelector('#biz-task-form')`),'new task saved');const addedState=await snapshot();const added=addedState.data.laiTasks.find(t=>t.title==='New isolated task');assert.ok(added);assert.equal(added.date,'2026-09-16');assert.equal(added.done,false);assert.deepEqual(addedState.data.orders,baseline.data.orders);assert.deepEqual(addedState.data.customers,baseline.data.customers);await navigate();await route('calendar');await month('2026-09');assert.ok(await evaluate(`!!document.querySelector('[data-biz-edit-task="${added.id}"]')`));checks.createTrimmedTaskPersistsAndDoesNotChangeOtherRecords=true;
 await openTask('task-base');await fill({title:'Changed task',date:'2026-09-17',done:true});await submit();await until(()=>evaluate(`!document.querySelector('#biz-task-form')`),'task edited');const editedState=await snapshot();const edited=editedState.data.laiTasks.find(t=>t.id==='task-base');assert.equal(edited.title,'Changed task');assert.equal(edited.done,true);assert.deepEqual(edited.unknown,{keep:1});await route('dashboard');const pending=await evaluate(`[...document.querySelectorAll('[data-biz-task]')].map(e=>e.dataset.bizTask)`);assert.deepEqual(pending,[added.id]);checks.editPreservesMetadataAndCompletedTasksLeaveDashboard=true;
 await pointerClick(`[data-biz-task="${added.id}"]`);await until(async()=>(await snapshot()).data.laiTasks.find(t=>t.id===added.id).done===true,'dashboard completion saved');await until(()=>evaluate(`!document.querySelector('[data-biz-task="${added.id}"]')`),'completed task removed');await route('calendar');await month('2026-09');await openTask(added.id);assert.equal(await evaluate(`document.querySelector('#biz-task-form').elements.done.checked`),true);await fill({done:false});await submit();await until(()=>evaluate(`!document.querySelector('#biz-task-form')`),'task reopened');await route('dashboard');assert.ok(await evaluate(`!!document.querySelector('[data-biz-task="${added.id}"]')`));checks.dashboardToggleAndCalendarReopenPersist=true;
 await route('calendar');await month('2026-09');await openTask('task-base');await fill({title:'Local stale title',date:'2026-09-18'});const external=await snapshot();external.data.laiTasks.find(t=>t.id==='task-base').title='External newer title';const externalSave=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:external,baseRevision:external.revision})});assert.equal(externalSave.status,200);const externalState=await snapshot();await submit();await until(()=>evaluate(`!!document.querySelector('#biz-task-error')?.textContent`),'task conflict shown');assert.equal(await evaluate(`document.querySelector('#biz-task-form').elements.title.value`),'Local stale title');assert.equal(await evaluate(`document.querySelector('#biz-task-form').elements.date.value`),'2026-09-18');assert.equal(await evaluate(`document.querySelector('[form="biz-task-form"]').disabled`),false);assert.deepEqual(await snapshot(),externalState);await frame('conflict-retains-task-draft');await cancel();await navigate();await route('calendar');await month('2026-09');await openTask('task-base');assert.equal(await evaluate(`document.querySelector('#biz-task-form').elements.title.value`),'External newer title');await cancel();checks.conflictRetainsFormAndReloadSeesExternalRevision=true;
 const beforeTaskTransport=await snapshot();await openTask('task-base');
 await fill({title:'Task retry after connection failure',date:'2026-09-18'});
 await cdp.call('Network.enable');await cdp.call('Network.setBlockedURLs',{urls:[backend.base+'/api/save']});
 await submit();await until(()=>evaluate(`!!document.querySelector('#biz-task-error')?.textContent`),'task transport failure visible');
 assert.equal(await evaluate(`document.querySelector('#biz-task-form').elements.title.value`),'Task retry after connection failure');
 assert.equal(await evaluate(`document.querySelector('#biz-task-form').elements.date.value`),'2026-09-18');
 assert.equal(await evaluate(`document.querySelector('[form="biz-task-form"]').disabled`),false);
 assert.deepEqual(await snapshot(),beforeTaskTransport);await frame('transport-failure-retains-task');
 checks.transportFailureRetainsTaskDraftAndReleasesControls=true;
 await cdp.call('Network.setBlockedURLs',{urls:[]});await submit();
 await until(()=>evaluate(`!document.querySelector('#biz-task-form')`),'task retry saved');
 const afterTaskRetry=await snapshot();assert.equal(afterTaskRetry.revision,beforeTaskTransport.revision+1);
 assert.equal(afterTaskRetry.data.laiTasks.find(t=>t.id==='task-base').title,'Task retry after connection failure');
 assert.equal(afterTaskRetry.data.laiTasks.length,beforeTaskTransport.data.laiTasks.length);
 assert.deepEqual(afterTaskRetry.data.orders,beforeTaskTransport.data.orders);
 assert.deepEqual(afterTaskRetry.data.customers,beforeTaskTransport.data.customers);
 await navigate();await route('calendar');await month('2026-09');await openTask('task-base');
 assert.equal(await evaluate(`document.querySelector('#biz-task-form').elements.title.value`),'Task retry after connection failure');await cancel();
 checks.transportRecoveryRetriesSameTaskExactlyOnceAndPersists=true;
 await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:720,deviceScaleFactor:1,mobile:false});await frame('calendar-1100');await action('new-task');const bounds=await evaluate(`(()=>{const r=document.querySelector('[form="biz-task-form"]').getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom}})()`);assert.ok(bounds.left>=0&&bounds.right<=1100&&bounds.bottom<=720);await frame('task-editor-1100');await cancel();checks.minimumWindowTaskSaveVisible=true;
 await route('dashboard');const newest=await snapshot();newest.data.laiTasks.find(t=>t.id===added.id).title='External pending task';const advance=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:newest,baseRevision:newest.revision})});assert.equal(advance.status,200);const beforeConflictToggle=await snapshot();await pointerClick(`[data-biz-task="${added.id}"]`);await until(()=>evaluate(`document.querySelector('#toast')?.textContent.includes('数据已发生变化')`),'dashboard conflict toast');assert.deepEqual(await snapshot(),beforeConflictToggle);assert.equal(await evaluate(`document.querySelector('[data-biz-task="${added.id}"]').checked`),false,'Failed completion must restore persisted unchecked state');await frame('completion-conflict-restored');checks.failedCompletionRestoresCheckboxWithoutOverwrite=true;
 // A page reload alone does not prove SQLite survives a real service restart.
 const persistedBeforeRestart=await snapshot();
 await stop(backend.child);
 assert.ok(backend.child.exitCode!==null||backend.child.signalCode!==null,'Old disposable service must exit before restart');
 const restartExit={exitCode:backend.child.exitCode,signalCode:backend.child.signalCode};
 backend=await startBackend();
 assert.deepEqual(await snapshot(),persistedBeforeRestart,'Restart must preserve revision, tasks, customer links, orders and unknown metadata');
 checks.serviceRestartRetainsTasksAndRelatedRecords=true;
 await navigate();await route('calendar');await month('2026-09');
 assert.equal(await evaluate(`document.querySelectorAll('.agenda-item').length`),5);
 await openTask('task-base');
 assert.equal(await evaluate(`document.querySelector('#biz-task-form').elements.title.value`),'Task retry after connection failure');
 assert.equal(await evaluate(`document.querySelector('#biz-task-form').elements.date.value`),'2026-09-18');
 assert.equal(await evaluate(`document.querySelector('#biz-task-form').elements.done.checked`),true);
 await cancel();await route('dashboard');
 assert.deepEqual(await evaluate(`[...document.querySelectorAll('[data-biz-task]')].map(e=>e.dataset.bizTask)`),[added.id]);
 assert.equal(await evaluate(`document.querySelector('[data-biz-task="${added.id}"]').checked`),false);
 assert.deepEqual(await snapshot(),persistedBeforeRestart);
 await frame('dashboard-after-service-restart');
 checks.serviceRestartRebuildsCalendarAndDashboard=true;
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({testedAt:new Date().toISOString(),result:'pass',app,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),checks,bounds,restartExit,scope:'Existing dashboard/calendar/task workflows including actual service exit and restart; disposable SQLite and Chrome; no new fields/rules or production writes'},null,2));console.log('PASS: '+Object.keys(checks).length+' existing task workflow checks');
}catch(error){console.error(error.message);fs.writeFileSync(path.join(evidence,'progress.json'),JSON.stringify({checks,error:error.message},null,2));if(cdp)await frame('failure').catch(()=>{});throw error;}
finally{cdp?.close();for(const child of children)await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
