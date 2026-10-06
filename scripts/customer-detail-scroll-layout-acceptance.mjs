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
const evidence=path.resolve(process.env.LAI_DETAIL_SCROLL_EVIDENCE || 'evidence/ui-1.4.51/detail-scroll-layout');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-detail-scroll-'));
const children=[];
const checks={};
const deviceScaleFactor=Number(process.env.LAI_DETAIL_SCROLL_DPR||1);
assert.ok([1,2].includes(deviceScaleFactor));
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

async function openDetail(name){await pointerClick('[data-open="'+name+'"]');await until(()=>evaluate(`!!document.querySelector('.lcd-summary-fields')`),'summary detail');await until(()=>evaluate(`!document.getAnimations().some(a=>a.playState==='running'&&a.effect.getTiming().iterations!==Infinity)`),'detail entry stable');}
async function layout(){return evaluate(`(()=>{const main=document.querySelector('.customer-main'),rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};return{main:rect('.customer-main'),pagebar:rect('.lcd-pagebar'),left:rect('.lcd-left'),right:rect('.lcd-right'),tabs:rect('.lcd-tabs'),clientWidth:main.clientWidth,offsetWidth:main.offsetWidth,clientHeight:main.clientHeight,scrollHeight:main.scrollHeight,scrollWidth:main.scrollWidth,scrollTop:main.scrollTop,reserve:main.offsetWidth-main.clientWidth,overflowY:getComputedStyle(main).overflowY,contactCount:document.querySelectorAll('.lcd-contact').length}})()`);}
try{
 fs.mkdirSync(evidence,{recursive:true});backend=await startBackend();const initial=await snapshot();initial.data.orders=[];initial.data.customers={'Scroll Layout':{country:'US',source:'Referral',website:'https://layout.example.test',productType:'Layout Product',contact:'Scroll Primary',email:'primary@example.test',extraContacts:Array.from({length:6},(_,i)=>({contact:'Scroll Contact '+(i+1),email:'contact'+i+'@example.test',address:'Local fixture address '+('long address '.repeat(6))}))}};
 const seeded=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:initial,baseRevision:initial.revision})});assert.equal(seeded.status,200);
 const port=await freePort();const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps',`--user-data-dir=${path.join(temporary,'chrome')}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});children.push(browser);let target;await until(async()=>{try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item=>item.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'browser');
 cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:1022,deviceScaleFactor,mobile:false});await navigate();const baseline=await snapshot();await openDetail('Scroll Layout');const observed=await layout();fs.writeFileSync(path.join(evidence,'overflow-observed.json'),JSON.stringify(observed,null,2));await frame('overflow-detail');
 assert.ok(observed.scrollHeight>observed.clientHeight+100,'Real overflowing fixture');assert.equal(observed.contactCount,7,'Existing extra contacts render');checks.actualLongContentAndExistingContactsReadonly=true;
 assert.equal(observed.reserve,8,'Captured detail vertical scrollbar reserve');assert.deepEqual(observed.main,{x:232,y:56,width:1524,height:966});assert.deepEqual(observed.pagebar,{x:248,y:56,width:1484,height:60});assert.equal(observed.left.x,248);assert.equal(observed.left.width,480);assert.equal(observed.right.x,744);assert.equal(observed.right.width,988);checks.capturedOverflowingDetailMainAndColumnsAligned=true;
 const scrollbarStyle=await evaluate(`(()=>{const main=document.querySelector('.customer-main'),thumb=getComputedStyle(main,'::-webkit-scrollbar-thumb'),track=getComputedStyle(main,'::-webkit-scrollbar-track');return{thumb:thumb.backgroundColor,radius:thumb.borderRadius,track:track.backgroundColor,trackRadius:track.borderRadius}})()`);assert.deepEqual(scrollbarStyle,{thumb:'rgb(158, 161, 168)',radius:'12px',track:'rgb(235, 237, 240)',trackRadius:'3px'},'Match captured detail scrollbar appearance');const thumbPoint={x:observed.main.x+observed.main.width-observed.reserve/2,y:observed.main.y+44};await cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',...thumbPoint});await cdp.call('Input.dispatchMouseEvent',{type:'mousePressed',...thumbPoint,button:'left',clickCount:1});await cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:thumbPoint.x,y:thumbPoint.y+180,button:'left',buttons:1});await cdp.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:thumbPoint.x,y:thumbPoint.y+180,button:'left',clickCount:1});await pause(150);const dragged=await layout();fs.writeFileSync(path.join(evidence,'thumb-drag-observed.json'),JSON.stringify({scrollbarStyle,dragged},null,2));assert.ok(dragged.scrollTop>100,'Actual scrollbar thumb remains draggable');assert.equal(dragged.pagebar.y,56);assert.deepEqual(await snapshot(),baseline);checks.visibleScrollbarAndActualThumbDragRetainReadonlyContent=true;await frame('thumb-drag-detail');await evaluate(`document.querySelector('.customer-main').scrollTop=0`);
 const mainPoint=await evaluate(`(()=>{const r=document.querySelector('.customer-main').getBoundingClientRect();return{x:r.right-20,y:r.top+r.height/2}})()`);await cdp.call('Input.dispatchMouseEvent',{type:'mouseWheel',...mainPoint,deltaX:0,deltaY:520});await pause(200);const scrolled=await layout();assert.ok(scrolled.scrollTop>0);assert.equal(scrolled.pagebar.y,56,'Sticky pagebar remains visible');assert.equal(scrolled.pagebar.width,1484);assert.equal(scrolled.right.width,988);assert.equal(scrolled.scrollWidth,scrolled.clientWidth);assert.deepEqual(await snapshot(),baseline);fs.writeFileSync(path.join(evidence,'wheel-scrolled-observed.json'),JSON.stringify(scrolled,null,2));await frame('wheel-scrolled-detail');checks.actualWheelScrollKeepsStickyHeaderAndReadonlyWidths=true;
 await evaluate(`document.querySelector('.customer-main').scrollTop=0`);await pointerClick('[data-tab="activity"]');await pause(350);const activity=await layout();assert.ok(activity.scrollHeight>activity.clientHeight);assert.equal(activity.reserve,8);assert.equal(activity.pagebar.width,1484);assert.equal(activity.right.width,988);assert.equal(activity.contactCount,7);assert.deepEqual(await snapshot(),baseline);checks.activityTabRetainsOverflowReserveAndContacts=true;
 await evaluate(`document.querySelector('.customer-main').scrollTop=0`);await pointerClick('[data-action="list"]');await until(()=>evaluate(`!!document.querySelector('.replica-panel')`),'restored customer list');assert.equal(await evaluate(`document.querySelector('.customer-main').classList.contains('customer-main')`),true);assert.equal(await evaluate(`getComputedStyle(document.querySelector('.customer-main')).overflowY`),'hidden');assert.deepEqual(await snapshot(),baseline);checks.scopedDetailScrollbarLeavesListOverflowUnchanged=true;
 await openDetail('Scroll Layout');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:720,deviceScaleFactor,mobile:false});const compact=await layout();assert.equal(compact.reserve,8);assert.equal(compact.left.width,380);assert.equal(compact.right.x,644);assert.equal(compact.right.width,432);assert.equal(compact.pagebar.width,828);assert.equal(compact.scrollWidth,compact.clientWidth);assert.deepEqual(await snapshot(),baseline);await frame('compact-overflow-detail');checks.compactSourceColumnsRetainContentWithoutHorizontalOverflow=true;
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({at:new Date().toISOString(),result:'pass',htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),deviceScaleFactor,checks,observed,scrolled,activity,compact,scope:'Captured overflowing detail reserve/main/pagebar/two-column widths, source-backed 1100px columns and scrollbar colors/radii, and local wheel/tab/list/compact read-only behavior; full same-state pixels and native continuous motion remain unaccepted. Disposable SQLite only.'},null,2));console.log('PASS: '+Object.keys(checks).length+' detail scroll geometry checks');
}catch(error){console.error('Acceptance failure: '+error.message);if(cdp)await frame('failure').catch(()=>{});throw error;}
finally{cdp?.close();for(const child of children)await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
