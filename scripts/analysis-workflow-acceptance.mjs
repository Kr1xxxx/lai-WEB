import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

// Exercise existing analysis with disposable orders and SQLite only.
const app=path.resolve(process.env.LAI_ACCEPTANCE_APP || 'dist/来财Lai.app');
const resources=path.join(app,'Contents/Resources');
const evidence=path.resolve(process.env.LAI_ANALYSIS_EVIDENCE || 'evidence/ui-1.4.24/analysis');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-analysis-'));
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
    env:{...process.env,LAI_DATA_DIR:path.join(temporary,'database'),LAI_APP_PORT:String(port),LAI_API_TOKEN:token,LAI_INSTANCE_NONCE:'analysis-test',LAI_APP_NO_OPEN:'1'},stdio:'ignore'});
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
async function month(value){await evaluate(`(()=>{const m=document.querySelector('#biz-month');m.value=${JSON.stringify(value)};m.dispatchEvent(new Event('change',{bubbles:true}));})()`);}
async function bars(){return evaluate(`[...document.querySelectorAll('.stage-bars > div')].map(r=>({label:r.querySelector('span').textContent,count:Number(r.querySelector('b').textContent),percent:r.querySelector('i').style.width}))`);}
async function moneyRows(){return evaluate(`[...document.querySelectorAll('.money-summary tbody tr')].map(r=>[...r.children].map(c=>c.textContent.trim()))`);}
try {
 fs.mkdirSync(evidence,{recursive:true});backend=await startBackend();const initial=await snapshot();
 const order=(id,client,amount,currency,stage,extra={})=>({id,num:'STAT-'+id,client,amount,currency,stage,paidAmount:0,createdAt:'2026-09-01',orderMonth:'2026-09',...extra});
 initial.data.customers={Alpha:{country:'US'},Beta:{country:'DE'}};
 initial.data.orders=[order('q1','Alpha',100,'USD','quote',{paidAmount:20}),order('q2','Alpha',50,'USD','quote',{paidAmount:10}),order('p','Beta',25,'USD','production',{createdAt:'2026-08-01'}),order('d','Alpha',60,'EUR','done'),order('s','Beta',20,'EUR','shipment'),order('draft','Alpha',9999,'USD','quote',{isDraft:true}),order('old','Alpha',10,'USD','deposit',{orderMonth:'2026-08',createdAt:'2026-09-01'}),order('fallback','Beta',12,'GBP','quote',{orderMonth:'',createdAt:'2026-10-03'}),order('only-draft','Alpha',1000,'USD','quote',{orderMonth:'2026-11',isDraft:true})];
 initial.data.trashOrders=[order('trash','Alpha',8888,'USD','quote')];initial.data.deletedOrders=[order('deleted','Beta',7777,'EUR','done')];initial.data.laiTasks=[];
 const seeded=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:initial,baseRevision:initial.revision})});assert.equal(seeded.status,200);
 const port=await freePort();const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps',`--user-data-dir=${path.join(temporary,'chrome')}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});children.push(browser);let target;await until(async()=>{try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'browser');cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1728,height:958,deviceScaleFactor:1,mobile:false});await navigate();await route('analysis');await month('2026-09');const baseline=await snapshot();
 const beforeClear=await moneyRows();await month('');
 await frame('analysis-month-cleared');
 assert.equal(await evaluate(`document.querySelector('#biz-month').value`),'2026-09','Visible month must identify the totals still on screen');
 assert.deepEqual(await moneyRows(),beforeClear);assert.deepEqual(await snapshot(),baseline);checks.clearingAnalysisMonthRetainsVisiblePeriodAndTotalsWithoutWrites=true;
 const stageBars=await bars();assert.deepEqual(stageBars,[{label:'报价',count:2,percent:'40%'},{label:'定金',count:0,percent:'0%'},{label:'生产中',count:1,percent:'20%'},{label:'尾款',count:0,percent:'0%'},{label:'已发货',count:1,percent:'20%'},{label:'已完成',count:1,percent:'20%'}]);checks.draftExcludedFromStageCountsAndProportions=true;await frame('analysis-mixed-currencies');
 assert.deepEqual(await moneyRows(),[['USD','3','175.00 USD','30.00 USD','145.00 USD'],['EUR','2','80.00 EUR','80.00 EUR','0.00 EUR']]);checks.moneyGroupsRemainSeparateAndExcludeDraftTrashDeleted=true;
 const contributions=await evaluate(`[...document.querySelectorAll('.business-columns .order-table tbody tr')].map(r=>[...r.children].map(c=>c.textContent.trim()))`);assert.deepEqual(contributions,[['Alpha','1','60.00 EUR'],['Beta','1','20.00 EUR'],['Alpha','2','150.00 USD'],['Beta','1','25.00 USD']]);checks.customerContributionsGroupByCurrencyAndSortAmount=true;
 await month('2026-08');assert.deepEqual(await moneyRows(),[['USD','1','10.00 USD','0.00 USD','10.00 USD']]);await month('2026-10');assert.deepEqual(await moneyRows(),[['GBP','1','12.00 GBP','0.00 GBP','12.00 GBP']]);checks.monthUsesExistingOrderMonthThenCreatedAtFallback=true;
 await month('2026-11');assert.deepEqual((await bars()).map(r=>[r.count,r.percent]),[[0,'0%'],[0,'0%'],[0,'0%'],[0,'0%'],[0,'0%'],[0,'0%']]);assert.deepEqual(await moneyRows(),[['暂无订单金额']]);assert.match(await evaluate(`document.querySelector('.business-columns').textContent`),/本月暂无订单/);checks.draftsOnlyMonthHasZeroBarsAndEmptyMoney=true;
 await month('2026-12');assert.deepEqual(await moneyRows(),[['暂无订单金额']]);await frame('analysis-empty');checks.emptyMonthRendersWithoutInvalidPercentages=true;
 await month('2026-09');await pointerClick('.business-columns [data-biz-customer="Alpha"]');await until(()=>evaluate(`!!document.querySelector('.lcd-root')`),'customer contribution detail');assert.match(await evaluate(`document.querySelector('.lcd-root').textContent`),/Alpha/);await evaluate(`document.querySelector('[data-action="list"]').click()`);await route('analysis');await month('2026-09');assert.deepEqual(await snapshot(),baseline);checks.customerContributionLinkOpensActualCustomerWithoutWriting=true;
 await route('dashboard');assert.deepEqual(await evaluate(`[...document.querySelectorAll('.business-kpis strong')].map(e=>Number(e.textContent))`),[7,6,0,0]);await pointerClick('[data-biz-order="q1"]');await until(()=>evaluate(`!!document.querySelector('#biz-order-form')`),'order editor');assert.equal(await evaluate(`document.querySelector('#biz-order-form').elements.num.value`),'STAT-q1');await evaluate(`document.querySelector('[data-biz-action="close-editor"]').click()`);await until(()=>evaluate(`!document.querySelector('#biz-order-form')`),'order cancel');assert.deepEqual(await snapshot(),baseline);checks.dashboardAndOrderReadonlyCancelRemainConsistent=true;
 await route('analysis');await month('2026-09');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:720,deviceScaleFactor:1,mobile:false});await frame('analysis-1100');const bounds=await evaluate(`(()=>{const r=document.querySelector('#biz-month').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}})()`);assert.ok(bounds.left>=0&&bounds.right<=1100&&bounds.bottom<=720);assert.deepEqual(await snapshot(),baseline);checks.shortWindowMonthControlVisibleAndAllReadsLeaveDatabaseUnchanged=true;
 await route('calendar');await month('2026-09');await pointerClick('[data-biz-day="2026-09-01"]');const agendaBeforeClear=await evaluate(`document.querySelector('.calendar-agenda').textContent`);
 await month('');assert.equal(await evaluate(`document.querySelector('#biz-month').value`),'2026-09');assert.equal(await evaluate(`document.querySelector('.calendar-day.selected').dataset.bizDay`),'2026-09-01');assert.equal(await evaluate(`document.querySelectorAll('.calendar-day').length`),30);assert.equal(await evaluate(`document.querySelector('.calendar-agenda').textContent`),agendaBeforeClear);assert.deepEqual(await snapshot(),baseline);await frame('calendar-month-cleared');checks.clearingCalendarMonthRetainsVisiblePeriodDayAndAgendaWithoutWrites=true;
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({testedAt:new Date().toISOString(),result:'pass',app,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),checks,stageBars,contributions,bounds,scope:'Existing analysis/dashboard/calendar rules; disposable Chrome and SQLite only; source statistics UI and new indicators not implemented'},null,2));console.log('PASS: '+Object.keys(checks).length+' existing analysis workflow checks');
}catch(error){console.error(error.stack);fs.writeFileSync(path.join(evidence,'progress.json'),JSON.stringify({checks,error:error.message},null,2));if(cdp)await frame('failure').catch(()=>{});throw error;}
finally{cdp?.close();for(const child of children)await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
