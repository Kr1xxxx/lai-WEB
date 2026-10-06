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
const evidence=path.resolve(process.env.LAI_BRANCH_EVIDENCE || 'evidence/ui-1.4.33/customer-branch');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-customer-branch-'));
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
    env:{...process.env,LAI_DATA_DIR:path.join(temporary,'database'),LAI_APP_PORT:String(port),LAI_API_TOKEN:token,LAI_INSTANCE_NONCE:'customer-branch-test',LAI_APP_NO_OPEN:'1'},stdio:'ignore'});
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

async function titleSelector(){return evaluate(`document.querySelector('.won-tree-heading') ? '.won-tree-title span' : '[data-expand="won"] span'`);}
async function names(){return evaluate(`Array.from(document.querySelectorAll('.customer-table [data-select]'),e=>e.dataset.select).sort()`);}
async function branch(){return evaluate(`(()=>{const a=document.querySelector('[data-expand="won"]'),p=document.querySelector('#group-branch-won');return {open:a.getAttribute('aria-expanded'),hidden:p.getAttribute('aria-hidden'),inert:p.inert,title:document.querySelector('.list-heading strong').textContent,duration:getComputedStyle(p).transitionDuration};})()`);}
async function enter(selector){await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});}
try{
 fs.mkdirSync(evidence,{recursive:true});backend=await startBackend();const initial=await snapshot();
 initial.data.customers={'Won Alpha':{country:'US'},'Won Beta':{country:'DE'},'New Gamma':{country:'US'}};
 initial.data.orders=[{id:'a',num:'A',client:'Won Alpha',currency:'USD',amount:100,paidAmount:20,stage:'quote',createdAt:'2026-09-01',orderMonth:'2026-09'},{id:'b',num:'B',client:'Won Beta',currency:'USD',amount:100,paidAmount:100,stage:'done',createdAt:'2026-09-01',orderMonth:'2026-09'}];initial.data.previewSegments=[];initial.data.trashOrders=[];initial.data.deletedOrders=[];
 assert.equal((await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:initial,baseRevision:initial.revision})})).status,200);
 const port=await freePort();const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps',`--user-data-dir=${path.join(temporary,'chrome')}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});children.push(browser);
 let target;await until(async()=>{try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'browser');cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1728,height:958,deviceScaleFactor:1,mobile:false});await navigate();const baseline=await snapshot();
 assert.deepEqual(await names(),['New Gamma','Won Alpha','Won Beta']);
 await evaluate(`window.__branchTrace=[];window.__branchTraceDone=new Promise(resolve=>{const start=performance.now();function sample(){const p=document.querySelector('#group-branch-won');window.__branchTrace.push({t:performance.now()-start,open:document.querySelector('[data-expand="won"]').getAttribute('aria-expanded'),height:p.getBoundingClientRect().height,opacity:getComputedStyle(p).opacity});if(performance.now()-start<650)requestAnimationFrame(sample);else resolve(window.__branchTrace);}requestAnimationFrame(sample);});true;`);
 await pointerClick(await titleSelector());
 const titleMotion=await evaluate(`document.querySelector('#group-branch-won').getAnimations().map(a=>({property:a.transitionProperty,duration:a.effect.getTiming().duration,state:a.playState}))`);
 fs.writeFileSync(path.join(evidence,'title-motion.json'),JSON.stringify(titleMotion,null,2));
 assert.equal(titleMotion.length,0,'Source branch shows content immediately; local height/opacity tween must be absent');
 const immediate=await evaluate(`(()=>{const p=document.querySelector('#group-branch-won');return {height:p.getBoundingClientRect().height,opacity:getComputedStyle(p).opacity}})()`);
 assert.deepEqual(immediate,{height:92,opacity:'1'},'Two rows appear to content bottom immediately; trailing4px released after phase');
 await pause(180);assert.equal(await evaluate(`document.querySelector('#group-branch-won').getBoundingClientRect().height`),92);
 await until(()=>evaluate(`document.querySelector('#group-branch-won').getBoundingClientRect().height===96`),'trailing space released');
 checks.pointerContentImmediateThenReleasesTrailingSpace=true;
 const trace=await evaluate(`window.__branchTraceDone`);fs.writeFileSync(path.join(evidence,'pointer-entry-trace.json'),JSON.stringify(trace,null,2));
 const entered=trace.filter(s=>s.open==='true'),firstEntry=entered[0],released=entered.find(s=>s.height===96);
 assert.equal(firstEntry.height,92);assert.equal(firstEntry.opacity,'1');assert.ok(entered.every(s=>[92,96].includes(s.height)&&s.opacity==='1'),'No interpolated height or fade in pointer entry');
 assert.ok(released&&released.t-firstEntry.t>=275&&released.t-firstEntry.t<=350,'Trailing margin release near captured300ms phase, not a height tween');
 checks.pointerTraceMatchesCapturedImmediatePhaseAndRelease=true;
 await frame('title-selects-parent');
 const first=await branch();fs.writeFileSync(path.join(evidence,'title-observation.json'),JSON.stringify({state:first,names:await names()},null,2));
 assert.deepEqual(await names(),['Won Alpha','Won Beta'],'Clicking the heading title must select the existing won customer filter');assert.equal(first.open,'true');checks.titleSelectsParentAndOpens=true;
 await pointerClick('[data-group="all"]');assert.deepEqual(await names(),['New Gamma','Won Alpha','Won Beta']);
 await evaluate(`window.__branchNode=document.querySelector('#group-branch-won');window.__branchTable=document.querySelector('.customer-table')`);
 await pointerClick('[data-expand="won"]');const closed=await branch();assert.deepEqual(await evaluate(`(()=>{const p=document.querySelector('#group-branch-won');return {height:p.getBoundingClientRect().height,opacity:getComputedStyle(p).opacity,animations:p.getAnimations().length}})()`),{height:0,opacity:'0',animations:0});checks.closeImmediatelyHidesWithoutTween=true;assert.equal(closed.open,'false');assert.equal(closed.inert,true);assert.deepEqual(await names(),['New Gamma','Won Alpha','Won Beta']);assert.equal(await evaluate(`window.__branchNode===document.querySelector('#group-branch-won')`),true);assert.equal(await evaluate(`window.__branchTable===document.querySelector('.customer-table')`),true);checks.arrowOnlyClosesWithoutFilteringOrReplacingPanel=true;
 await pointerClick('[data-expand="won"]');assert.equal((await branch()).open,'true');assert.deepEqual(await names(),['New Gamma','Won Alpha','Won Beta']);checks.arrowOnlyOpensWithoutFiltering=true;
 await until(()=>evaluate(`!document.querySelector('#group-branch-won').classList.contains('branch-motion')`),'branch settled');
 const geometry=await evaluate(`(()=>{const h=document.querySelector('.won-tree-heading'),a=h.querySelector('[data-expand]'),t=h.querySelector('.won-tree-title'),rows=[...document.querySelectorAll('#group-branch-won .nested')],hr=h.getBoundingClientRect(),ar=a.getBoundingClientRect(),tr=t.getBoundingClientRect();return {headingHeight:hr.height,arrowWidth:ar.width,arrowHeight:ar.height,arrowOffset:ar.left-hr.left,titleOffset:tr.left-hr.left,color:getComputedStyle(t).color,rows:rows.map(e=>({height:e.getBoundingClientRect().height,top:e.getBoundingClientRect().top,padding:getComputedStyle(e).paddingLeft,radius:getComputedStyle(e).borderRadius})),labels:rows.map(e=>e.querySelector('span').textContent)};})()`);
 assert.equal(geometry.headingHeight,40);assert.equal(geometry.arrowWidth,20);assert.equal(geometry.arrowHeight,20);assert.equal(geometry.arrowOffset,4);assert.equal(geometry.titleOffset,28);assert.equal(geometry.rows[0].height,40);assert.equal(geometry.rows[1].top-geometry.rows[0].top,48);assert.equal(geometry.rows[0].padding,'44px');assert.equal(geometry.rows[0].radius,'4px');assert.deepEqual(geometry.labels,['成交客户','待收款客户']);checks.capturedGeometryAndExistingChildrenPreserved=true;
 await frame('arrow-open-all-customers');
 await pointerClick(await titleSelector());assert.deepEqual(await names(),['Won Alpha','Won Beta']);assert.equal((await branch()).open,'false');assert.equal(await evaluate(`getComputedStyle(document.querySelector('.won-tree-heading')).backgroundColor`),'rgb(240, 248, 255)');checks.openTitleSelectsParentAndClosesOnce=true;
 await pointerClick(await titleSelector());assert.equal((await branch()).open,'true');assert.deepEqual(await names(),['Won Alpha','Won Beta']);checks.repeatedTitleReopensSameFilter=true;
 await enter('.won-tree-title');assert.equal((await branch()).open,'false');assert.equal(await evaluate(`document.activeElement.matches('.won-tree-title')`),true);assert.equal((await branch()).duration,'0s');checks.keyboardTitleReturnsFocusAndTogglesOnce=true;
 await enter('[data-expand="won"]');assert.equal((await branch()).open,'true');assert.equal((await branch()).duration,'0s');assert.deepEqual(await names(),['Won Alpha','Won Beta']);checks.keyboardArrowImmediateAndKeepsFilter=true;
 await evaluate(`window.__branchNode=document.querySelector('#group-branch-won')`);await pointerClick('[data-expand="won"]');await pointerClick('[data-expand="won"]');assert.equal((await branch()).open,'true');assert.equal(await evaluate(`window.__branchNode===document.querySelector('#group-branch-won')`),true);await pause(350);assert.equal((await branch()).open,'true');assert.equal(await evaluate(`document.querySelector('#group-branch-won').getBoundingClientRect().height`),96);checks.rapidArrowReversalKeepsPanelAndLatestState=true;
 await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await pointerClick('[data-expand="won"]');assert.equal(await evaluate(`document.querySelector('#group-branch-won').getAnimations().length`),0);assert.equal((await branch()).inert,true);
 await pointerClick('[data-expand="won"]');assert.equal(await evaluate(`document.querySelector('#group-branch-won').getBoundingClientRect().height`),96);assert.equal(await evaluate(`document.querySelector('#group-branch-won').getAnimations().length`),0);
 checks.reducedMotionOpenImmediateFinalLayout=true;checks.reducedMotionAndHiddenChildrenInert=true;
 await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:720,deviceScaleFactor:1,mobile:false});await pointerClick(await titleSelector());await frame('branch-minimum-window');const bounds=await evaluate(`(()=>{const r=document.querySelector('.won-tree-heading').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};})()`);assert.ok(bounds.left>=0&&bounds.right<=1100&&bounds.top>=0&&bounds.bottom<=720);checks.minimumNativeWindowClickZonesVisible=true;
 await pointerClick('.customer-table [data-select="Won Alpha"]');
 assert.equal(await evaluate(`document.querySelector('.customer-table [data-select="Won Alpha"]').checked`),true);
 await pointerClick('[data-expand="won"]');await pointerClick('[data-expand="won"]');
 assert.equal(await evaluate(`document.querySelector('.customer-table [data-select="Won Alpha"]').checked`),true);
 assert.equal(await evaluate(`document.querySelector('.replica-batch b').textContent`),'1');
 checks.arrowRetainsSelectedCustomerAndBatchToolbar=true;
 assert.deepEqual(await snapshot(),baseline);checks.allBranchInteractionsReadOnly=true;
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({testedAt:new Date().toISOString(),result:'pass',app,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),checks,geometry,bounds,scope:'Existing won filter/title and arrow zones only; six grades remain pending; isolated browser/SQLite; source live pre-click samples show immediate height/opacity and trailing-space release; native continuous motion unproven'},null,2));console.log('PASS: '+Object.keys(checks).length+' existing customer branch checks');
}catch(error){console.error(error.message);fs.writeFileSync(path.join(evidence,'progress.json'),JSON.stringify({checks,error:error.message},null,2));if(cdp)await frame('failure').catch(()=>{});throw error;}
finally{cdp?.close();for(const child of children)await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
