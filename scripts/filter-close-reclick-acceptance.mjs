import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

// Observe real pointer interception during exit; do not programmatically click a covered trigger.
const app=path.resolve(process.env.LAI_ACCEPTANCE_APP || 'dist/来财Lai.app');
const resources=path.join(app,'Contents/Resources');
const evidence=path.resolve(process.env.LAI_FILTER_RECLICK_EVIDENCE || 'evidence/filter-close-reclick');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-filter-reclick-'));
const children=[];
const checks={};
let cdp, backend;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const freePort=()=>new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
async function until(check,label){for(let i=0;i<160;i++){if(await check())return;await pause(50);}throw Error('Timed out: '+label);}
async function stop(child){if(!child||child.exitCode!==null||child.signalCode!==null)return;child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),pause(6000)]);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await new Promise(resolve=>child.once('exit',resolve));}}
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

async function pointerClick(selector,waitForFrames=true){
 if(waitForFrames)await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
 const point=await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)}),r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);if(!r.width||!r.height||!(el.contains(hit)||hit?.contains(el)))throw Error('Pointer target is hidden or covered: '+${JSON.stringify(selector)}+' '+JSON.stringify({x,y,rect:r.toJSON(),hit:hit?.className,overlay:el.closest('.overlay')?.className,animations:document.getAnimations().map(a=>({state:a.playState,time:a.currentTime,target:a.effect.target.className}))}));return {x,y}})()`);
 await cdp.call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
 await cdp.call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
}

async function settle(){await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);await until(()=>evaluate(`!document.getAnimations().some(a=>a.playState==='running'&&a.effect.getTiming().iterations!==Infinity)`),'drawer settled');}
async function fill(selector,value){await pointerClick(selector);await evaluate(`document.querySelector(${JSON.stringify(selector)}).select()`);await cdp.call('Input.insertText',{text:value});}

const entry='[data-action="filter"]';
const close='.drawer.filter [data-action="close-modal"]';
const observations=[];
async function key(key,code,keyCode){
 await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:keyCode});
 await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:keyCode});
}
async function openFilter(){await pointerClick(entry);await until(()=>evaluate(`!!document.querySelector('#filter-form')`),'filter form');await settle();}
async function names(){return evaluate(`[...document.querySelectorAll('.company-link')].map(el=>el.dataset.open).sort()`);}
async function exitAndReclick(delay){
 const point=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(entry)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
 await evaluate(`(()=>{
  const old=document.querySelector('.overlay'),trigger=document.querySelector(${JSON.stringify(entry)}),button=document.querySelector(${JSON.stringify(close)});
  const out=window.filterExitObservation={samples:[],clicks:[],done:false};
  const read=()=>{const overlay=document.querySelector('.overlay'),drawer=overlay?.querySelector('.drawer.filter'),css=drawer&&getComputedStyle(drawer);return {
   ms:performance.now()-out.started,count:document.querySelectorAll('.overlay').length,old:overlay===old,closing:overlay?.classList.contains('modal-closing')||false,
   open:overlay?.classList.contains('modal-open')||false,left:drawer?.getBoundingClientRect().left,translateX:css?new DOMMatrixReadOnly(css.transform).m41:null,
   opacity:overlay?Number(getComputedStyle(overlay).opacity):null,inert:drawer?.inert,hidden:drawer?.getAttribute('aria-hidden'),focusTrigger:document.activeElement===trigger
  }};
  document.addEventListener('click',function capture(event){
   if(button.contains(event.target)&&!out.started){out.started=performance.now();const sample=()=>{out.samples.push(read());if(performance.now()-out.started<480)requestAnimationFrame(sample);else{out.done=true;document.removeEventListener('click',capture)}};queueMicrotask(sample);}
   else if(out.started)out.clicks.push({...read(),target:event.target.className,atTrigger:trigger.contains(event.target)});
  });
 })()`);
 await pointerClick(close);
 await evaluate(`new Promise(resolve=>setTimeout(resolve,Math.max(0,${delay}-(performance.now()-window.filterExitObservation.started))))`);
 // The entry coordinate is deliberately covered. Dispatch to the screen, preserving hit testing.
 const hit=await evaluate(`(()=>{const el=document.elementFromPoint(${point.x},${point.y});return {closing:!!el?.closest('.modal-closing'),overlay:!!el?.closest('.overlay'),trigger:!!el?.closest(${JSON.stringify(entry)}),className:el?.className,ms:performance.now()-window.filterExitObservation.started}})()`);
 await cdp.call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
 await cdp.call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
 await until(()=>evaluate(`window.filterExitObservation.done`),'exit samples');
 const result={delay,hit,...await evaluate(`window.filterExitObservation`)};observations.push(result);
 assert.equal(hit.closing,true,'Requested reclick must actually occur while exiting');
 assert.equal(hit.overlay,true);assert.equal(hit.trigger,false);
 assert.ok(result.clicks.length>=1,'Actual reclick must reach the document');
 assert.ok(result.clicks.every(click=>click.closing&&!click.atTrigger),'Actual clicks must occur during exit and miss the covered trigger');
 assert.ok(result.samples.every(sample=>sample.count<=1&&(!sample.count||sample.old)),'No second or replacement overlay during exit');
 const closing=result.samples.filter(sample=>sample.closing);
 assert.ok(closing.length>=3,'Multiple actual closing frames captured');
 assert.ok(closing.every(sample=>sample.inert===true&&sample.hidden==='true'),'Closing dialog cannot receive stale form input');
 assert.ok(closing.slice(1).every((sample,i)=>sample.translateX>=closing[i].translateX-.2&&sample.opacity<=closing[i].opacity+.002),'Reclick must not reverse exit or raise mask opacity');
 assert.equal(result.samples.at(-1).count,0);assert.equal(result.samples.at(-1).focusTrigger,true);
 return result;
}
try{
 fs.mkdirSync(evidence,{recursive:true});assert.equal(fs.existsSync(path.join(resources,'trade-order-data.json')),false,'No production seed');
 backend=await startBackend();const empty=await snapshot();assert.equal(Object.keys(empty.data.customers).length,0);assert.equal(empty.data.orders.length,0);
 empty.data.customers=Object.fromEntries(['Alpha Filter Fixture','Beta Filter Fixture','Gamma Filter Fixture'].map(name=>[name,{country:'US',source:'Synthetic',contact:'Synthetic',email:'fixture@example.test'}]));
 const seeded=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:empty,baseRevision:empty.revision})});assert.equal(seeded.status,200);
 const port=await freePort();const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps',`--user-data-dir=${path.join(temporary,'chrome')}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});children.push(browser);
 let target;await until(async()=>{try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'private browser');cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');
 const baseline=await snapshot();
 for(const [width,height] of [[1756,1022],[1100,720],[900,480]]){
  await cdp.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await navigate();await settle();
  for(const delay of [35,90,170]){
   await openFilter();await fill('#filter-form [name="name"]','Not Applied');
   const result=await exitAndReclick(delay);result.viewport={width,height};checks[`${width}x${height}_exit_${delay}_interceptsAndFinishes`]=true;
   assert.deepEqual(await names(),['Alpha Filter Fixture','Beta Filter Fixture','Gamma Filter Fixture']);
   await openFilter();assert.equal(await evaluate(`document.querySelector('#filter-form [name="name"]').value`),'');
   assert.equal(await evaluate(`document.querySelectorAll('.overlay').length`),1);await pause(100);
   assert.equal(await evaluate(`document.querySelectorAll('.overlay').length`),1,'Settled reopen must remain a single drawer');
   checks[`${width}x${height}_exit_${delay}_draftDiscardAndFreshReopen`]=true;
   if(delay===170)await frame(`filter-reopened-${width}`);
   await key('Escape','Escape',27);await until(()=>evaluate(`!document.querySelector('.overlay')`),'keyboard close');
  }
 }
 await openFilter();await fill('#filter-form [name="name"]','Alpha');await pointerClick('[form="filter-form"][type="submit"]');await until(()=>evaluate(`!document.querySelector('.overlay')`),'applied filter');assert.deepEqual(await names(),['Alpha Filter Fixture']);checks.applyFiltersListWithoutSave=true;
 await openFilter();await fill('#filter-form [name="name"]','Beta');await exitAndReclick(90);assert.deepEqual(await names(),['Alpha Filter Fixture']);await openFilter();assert.equal(await evaluate(`document.querySelector('#filter-form [name="name"]').value`),'Alpha');checks.cancelDraftKeepsAppliedFilter=true;
 await key('Escape','Escape',27);await openFilter();await pointerClick('[data-filter-mode="advanced"]');await settle();await key('Escape','Escape',27);await openFilter();assert.equal(await evaluate(`document.querySelector('[data-filter-mode="normal"]').classList.contains('active')`),true);checks.unappliedAdvancedModeDoesNotSurviveClose=true;
 await key('Escape','Escape',27);
 await openFilter();
 await evaluate(`(()=>{window.filterDetachTiming={durationMs:parseFloat(getComputedStyle(document.querySelector('.drawer.filter')).transitionDuration)*1000};const button=document.querySelector(${JSON.stringify(close)});button.addEventListener('click',()=>window.filterDetachTiming.closedAt=performance.now(),{once:true});document.querySelector(${JSON.stringify(entry)}).addEventListener('click',()=>window.filterDetachTiming.reopenedAt=performance.now(),{once:true});const observer=new MutationObserver(()=>{if(!document.querySelector('.overlay')){window.filterDetachTiming.detachedAt=performance.now();observer.disconnect()}});observer.observe(document.querySelector('#overlay-root'),{childList:true});})()`);
 await pointerClick(close);for(let i=0;i<120;i++){if(await evaluate(`!document.querySelector('.overlay')`))break;await pause(5);}
 await pointerClick(entry,false);
 const reopenTiming=await evaluate(`({...window.filterDetachTiming,overlayCount:document.querySelectorAll('.overlay').length})`);
 observations.push({type:'earliestDetachReopen',...reopenTiming});assert.equal(reopenTiming.overlayCount,1);assert.ok(reopenTiming.reopenedAt<reopenTiming.closedAt+reopenTiming.durationMs+50,'Actual entry click must precede the old exit fallback timeout');
 await pause(450);assert.equal(await evaluate(`document.querySelectorAll('.overlay').length`),1);assert.equal(await evaluate(`document.activeElement===document.querySelector('.drawer.filter')`),true);checks.promptReopenSurvivesOldCleanupAndKeepsFocus=true;await key('Escape','Escape',27);
 // Escape during entrance must invalidate the delayed RAF/50ms opener and 30ms focus callback.
 await pointerClick(entry);const opening=await evaluate(`(()=>{const el=document.querySelector('.overlay'),drawer=el.querySelector('.drawer');return {opacity:Number(getComputedStyle(el).opacity),x:new DOMMatrixReadOnly(getComputedStyle(drawer).transform).m41}})()`);observations.push({type:'escapeEntranceBeforeKey',...opening});assert.ok(opening.x>0,'Escape case must start before the pointer entrance finishes');await key('Escape','Escape',27);await pause(400);assert.equal(await evaluate(`document.querySelectorAll('.overlay').length`),0);assert.equal(await evaluate(`document.activeElement===document.querySelector(${JSON.stringify(entry)})`),true);checks.escapeDuringEntranceDoesNotResurrectDrawer=true;
 await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await openFilter();await pointerClick(close);await until(()=>evaluate(`!document.querySelector('.overlay')`),'reduced motion close');assert.equal(await evaluate(`document.activeElement===document.querySelector(${JSON.stringify(entry)})`),true);checks.reducedMotionCloseReturnsFocus=true;
 assert.deepEqual(await snapshot(),baseline);checks.filterInteractionsDoNotWriteDatabase=true;
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({result:'pass',testedAt:new Date().toISOString(),htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),checks,observations,limits:['Source supports one ordinary-filter pointer reclick; wider candidate matrix is robustness verification','Computed style samples are not GPU frames or full pixel/native acceptance','Covered entry cannot legitimately reopen during exit; no programmatic click substitution']},null,2));console.log('PASS: '+Object.keys(checks).length+' filter exit and draft checks');
}catch(error){fs.writeFileSync(path.join(evidence,'failure.json'),JSON.stringify({error:error.message,checks,observations},null,2));throw error;}
finally{cdp?.close();for(const child of [...children].reverse())await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});fs.writeFileSync(path.join(evidence,'cleanup.json'),JSON.stringify({temporaryRemoved:!fs.existsSync(temporary),children:children.map(child=>({pid:child.pid,exitCode:child.exitCode,signalCode:child.signalCode}))},null,2));assert.ok(children.every(child=>child.exitCode===0),'Private browser must stop before the service so its open requests do not exhaust the service shutdown deadline');}
