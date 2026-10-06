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
const evidence=path.resolve(process.env.LAI_DATE_EVIDENCE || 'evidence/ui-1.4.22/business-date');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-business-date-'));
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
    env:{...process.env,LAI_DATA_DIR:path.join(temporary,'database'),LAI_APP_PORT:String(port),LAI_API_TOKEN:token,LAI_INSTANCE_NONCE:'business-date-test',LAI_APP_NO_OPEN:'1'},stdio:'ignore'});
  children.push(child);
  const base=`http://127.0.0.1:${port}`;
  await until(async()=>{if(child.exitCode!==null)throw Error('Isolated service exited');try{return (await fetch(base+'/api/health')).ok;}catch{return false;}},'isolated backend');
  return {child,base,token};
}
async function snapshot(){return (await fetch(backend.base+'/api/data',{headers:{'x-trade-token':backend.token}})).json();}
async function connect(url){
  const socket=new WebSocket(url);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let sequence=0;const pending=new Map();
  socket.addEventListener('message',event=>{const message=JSON.parse(String(event.data));const request=pending.get(message.id);if(!request)return;pending.delete(message.id);if(message.error)request.reject(Error(message.error.message));else request.resolve(message.result);});
  return {call(method,params={}){const id=++sequence;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});},close(){socket.close();}};
}
async function evaluate(expression){const result=await cdp.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;}
async function navigate(){await cdp.call('Page.navigate',{url:backend.base+'/trade-order-system.html?token='+encodeURIComponent(backend.token)+'#customers'});await until(()=>evaluate(`!!document.querySelector('.company-link')`),'customer list');}
async function frame(name){const result=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(evidence,name+'.png'),Buffer.from(result.data,'base64'));}

let clockScript;
async function clock(instant, zone){
 await cdp.call('Emulation.setTimezoneOverride',{timezoneId:zone});
 if(clockScript)await cdp.call('Page.removeScriptToEvaluateOnNewDocument',{identifier:clockScript});
 const script=await cdp.call('Page.addScriptToEvaluateOnNewDocument',{source:`{const NativeDate=Date;const epoch=NativeDate.parse(${JSON.stringify(instant)});window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[epoch]));}static now(){return epoch;}};}`});clockScript=script.identifier;
 await navigate();
}
async function route(name){await evaluate(`document.querySelector('.rail-item[data-lai-route="${name}"]').click()`);await until(()=>evaluate(`location.hash==='#${name}'`),'route '+name);}
async function cancel(){await evaluate(`document.querySelector('[data-biz-action="close-editor"]').click()`);await until(()=>evaluate(`!document.querySelector('#biz-order-form,#biz-task-form')`),'cancel editor');}
try{
 fs.mkdirSync(evidence,{recursive:true});backend=await startBackend();const initial=await snapshot();
 initial.data.customers={'Due Today':{nextFollow:'2026-10-01'},'Due Yesterday':{nextFollow:'2026-09-30'},'Due Tomorrow':{nextFollow:'2026-10-02'},'Archived Due':{nextFollow:'2026-10-01',laiBucket:'trash'}};
 initial.data.orders=[{id:'date-order',num:'DATE-1',client:'Due Today',createdAt:'2026-10-01',orderMonth:'2026-10',currency:'USD',stage:'quote',amount:10,paidAmount:0}];initial.data.laiTasks=[];
 const seeded=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:initial,baseRevision:initial.revision})});assert.equal(seeded.status,200);const before=await snapshot();
 const port=await freePort();const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps',`--user-data-dir=${path.join(temporary,'chrome')}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});children.push(browser);
 await until(async()=>{try{return(await fetch(`http://127.0.0.1:${port}/json`)).ok;}catch{return false;}},'disposable browser');const tabs=await(await fetch(`http://127.0.0.1:${port}/json`)).json();cdp=await connect(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:1022,deviceScaleFactor:1,mobile:false});
 await clock('2026-09-30T16:30:00Z','Asia/Shanghai');
 await evaluate(`document.querySelector('[data-group="followup"]').click()`);
 assert.equal(await evaluate(`document.querySelector('[data-group="followup"] small').textContent`),'2');
 assert.deepEqual(await evaluate(`[...document.querySelectorAll('.company-link')].map(e=>e.dataset.open).sort()`),['Due Today','Due Yesterday']);checks.customerListLocalTodayAndCount=true;await frame('customer-list-local-today');await route('dashboard');
 const due=await evaluate(`(()=>{const list=document.querySelector('.business-columns .business-section');return [...list.querySelectorAll('[data-biz-customer]')].map(x=>x.dataset.bizCustomer);})()`);assert.deepEqual(due,['Due Today','Due Yesterday']);checks.localDueFollowups=true;await frame('dashboard-local-day');
 await route('calendar');assert.equal(await evaluate(`document.querySelector('#biz-month').value`),'2026-10');assert.ok(await evaluate(`!!document.querySelector('[data-biz-day="2026-10-01"]')`));checks.localCalendarMonth=true;await frame('calendar-local-month');
 await route('analysis');assert.equal(await evaluate(`document.querySelector('#biz-month').value`),'2026-10');assert.match(await evaluate(`document.querySelector('.money-summary').textContent`),/10\.00 USD/);checks.localAnalysisMonth=true;
 await route('order-list');await evaluate(`document.querySelector('[data-biz-action="new-order"]').click()`);
 assert.deepEqual(await evaluate(`(()=>{const f=document.querySelector('#biz-order-form');return{date:f.elements.createdAt.value,num:f.elements.num.value};})()`),{date:'2026-10-01',num:'L20261001-002'});checks.localNewOrderDefaults=true;await frame('order-local-day');await cancel();
 await route('calendar');await evaluate(`document.querySelector('[data-biz-action="new-task"]').click()`);assert.equal(await evaluate(`document.querySelector('#biz-task-form').elements.date.value`),'2026-10-01');await cancel();checks.localTaskDefault=true;
 await evaluate(`document.querySelector('[data-biz-day="2026-10-09"]').click();document.querySelector('[data-biz-action="new-task"]').click()`);assert.equal(await evaluate(`document.querySelector('#biz-task-form').elements.date.value`),'2026-10-09');await cancel();checks.selectedTaskDatePreserved=true;
 await evaluate(`document.querySelector('[data-biz-action="month-next"]').click()`);assert.equal(await evaluate(`document.querySelector('#biz-month').value`),'2026-11');await evaluate(`document.querySelector('[data-biz-action="month-prev"]').click()`);assert.equal(await evaluate(`document.querySelector('#biz-month').value`),'2026-10');checks.monthNavigationPreserved=true;
 await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:720,deviceScaleFactor:1,mobile:false});await frame('calendar-compact');await route('order-list');await evaluate(`document.querySelector('[data-biz-action="new-order"]').click()`);const bounds=await evaluate(`(()=>{const r=document.querySelector('[form="biz-order-form"]').getBoundingClientRect();return{right:r.right,bottom:r.bottom};})()`);assert.ok(bounds.right<=1100&&bounds.bottom<=720);await frame('order-compact');await cancel();checks.compactSaveVisible=true;
 await clock('2026-10-01T00:30:00Z','America/Los_Angeles');
 await evaluate(`document.querySelector('[data-group="followup"]').click()`);
 assert.equal(await evaluate(`document.querySelector('[data-group="followup"] small').textContent`),'1');
 assert.deepEqual(await evaluate(`[...document.querySelectorAll('.company-link')].map(e=>e.dataset.open)`),['Due Yesterday']);checks.customerListNegativeOffsetExcludesLocalTomorrow=true;await route('calendar');assert.equal(await evaluate(`document.querySelector('#biz-month').value`),'2026-09');await route('order-list');await evaluate(`document.querySelector('[data-biz-action="new-order"]').click()`);assert.equal(await evaluate(`document.querySelector('#biz-order-form').elements.createdAt.value`),'2026-09-30');await cancel();checks.negativeOffsetLocalDay=true;
 assert.deepEqual(await snapshot(),before);checks.noReadonlyFlowWrites=true;
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({testedAt:new Date().toISOString(),result:'pass',app,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),checks,bounds,scope:'Disposable browser profile and SQLite; only clock/date behavior; no production DB or system timezone changes'},null,2));console.log('PASS: '+Object.keys(checks).length+' business date browser checks');
}catch(error){if(cdp)await frame('failure').catch(()=>{});throw error;}
finally{cdp?.close();for(const child of children)await stop(child);fs.rmSync(temporary,{recursive:true,force:true});}
