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
if (!process.env.LAI_ORDER_NAV_EVIDENCE) throw Error('LAI_ORDER_NAV_EVIDENCE is required to preserve historical evidence');
const evidence=path.resolve(process.env.LAI_ORDER_NAV_EVIDENCE);
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-order-workflow-'));
const children=[];
const checks={};
let cdp, backend;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const freePort=()=>new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
async function until(check,label){for(let i=0;i<160;i++){if(await check())return;await pause(50);}throw Error('Timed out: '+label);}
async function stop(child){if(!child||child.exitCode!==null||child.signalCode!==null)return;const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await Promise.race([exited,pause(5500)]);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}}
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

async function listPosition(){return evaluate(`(()=>{const t=document.querySelector('.business-table-scroll');return {top:t.scrollTop,left:t.scrollLeft,page:document.querySelector('.pagination .pages span').textContent,stage:document.querySelector('#biz-stage').value,currency:document.querySelector('#biz-currency').value,search:document.querySelector('#biz-search').value,ids:[...document.querySelectorAll('.unified-orders tbody tr')].map(r=>r.querySelector('[data-biz-order]').dataset.bizOrder)}})()`);}
async function setFilter(id,value){await evaluate(`(()=>{const e=document.getElementById(${JSON.stringify(id)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);}

try {
 fs.mkdirSync(evidence,{recursive:true});backend=await startBackend();const initial=await snapshot();
 const orders=Array.from({length:61},(_,i)=>({id:'nav-'+i,num:'NAV-'+String(i+1).padStart(3,'0'),client:'Navigation Fixture',country:'US',currency:'USD',amount:i+10,paidAmount:0,stage:'production',createdAt:'2026-09-01',orderMonth:'2026-09',note:'Original note',isDraft:false}));
 initial.data={customers:{'Navigation Fixture':{country:'US'}},orders,trashOrders:[],deletedOrders:[],laiTasks:[]};
 assert.equal((await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:initial,baseRevision:initial.revision})})).status,200);
 const port=await freePort();const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps',`--user-data-dir=${path.join(temporary,'chrome')}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});children.push(browser);
 let target;await until(async()=>{try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'browser');cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:720,deviceScaleFactor:1,mobile:false});await navigate();await route('order-list');
 await setFilter('biz-stage','production');await setFilter('biz-currency','USD');await evaluate(`(()=>{const e=document.querySelector('#biz-search');e.value='NAV';e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await action('next');
 await evaluate(`(()=>{const t=document.querySelector('.business-table-scroll');t.scrollTop=400;t.scrollLeft=200;})()`);
 const before=await listPosition();assert.equal(before.page,'2 / 4');assert.equal(before.stage,'production');assert.equal(before.currency,'USD');assert.equal(before.search,'NAV');assert.ok(before.top>0&&before.left>0,'Fixture must really scroll on both axes');assert.equal(before.ids.length,20);await frame('list-before-edit');
 const savedBefore=await snapshot();await open('nav-30');await fill({note:'Cancelled note'});await cancel();assert.deepEqual(await listPosition(),before);assert.deepEqual(await snapshot(),savedBefore);checks.cancelPreservesBothScrollAxesFiltersPageAndDatabase=true;
 await open('nav-30');await fill({note:'Saved navigation note'});await submit();await until(()=>evaluate(`!document.querySelector('#biz-order-form')`),'saved editor closed');
 const after=await listPosition();fs.writeFileSync(path.join(evidence,'position-comparison.json'),JSON.stringify({before,after},null,2));await frame('list-after-save');
 assert.deepEqual(after,before,'Editing a note must retain list position and current filters/page');
 const savedAfter=await snapshot();assert.equal(savedAfter.revision,savedBefore.revision+1);assert.equal(savedAfter.data.orders.find(o=>o.id==='nav-30').note,'Saved navigation note');assert.deepEqual(savedAfter.data.customers,savedBefore.data.customers);assert.equal(savedAfter.data.orders.length,61);checks.noteSavePreservesBothScrollAxesFiltersPageAndPersistsOnce=true;
 await open('nav-30');await fill({stage:'done'});await submit();await until(()=>evaluate(`!document.querySelector('#biz-order-form')`),'stage change editor closed');const excluded=await listPosition();assert.equal(excluded.page,'2 / 3');assert.equal(excluded.stage,'production');assert.equal(excluded.currency,'USD');assert.equal(excluded.search,'NAV');assert.equal(excluded.ids.includes('nav-30'),false);assert.equal(excluded.top,before.top);assert.equal(excluded.left,before.left);assert.equal((await snapshot()).revision,savedAfter.revision+1);checks.filterExclusionAfterSaveRetainsValidPageAndScroll=true;
 await action('clear-filters');const cleared=await listPosition();assert.equal(cleared.page,'1 / 4');assert.equal(cleared.stage,'');assert.equal(cleared.currency,'');assert.equal(cleared.search,'');assert.equal(cleared.top,0);assert.equal(cleared.left,0);checks.explicitClearStillResetsFiltersPageAndScroll=true;
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({testedAt:new Date().toISOString(),result:'pass',app,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),checks,before,after,excluded,scope:'Order save/cancel list position only; disposable 61-order SQLite fixture and isolated Chrome, no formal data writes or new business rules'},null,2));console.log('PASS: '+Object.keys(checks).length+' focused order navigation checks');
} catch(error) {
 fs.writeFileSync(path.join(evidence,'progress.json'),JSON.stringify({checks,error:error.message},null,2));if(cdp)await frame('failure').catch(()=>{});console.error(error.message);throw error;
} finally {cdp?.close();for(const child of children)await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
