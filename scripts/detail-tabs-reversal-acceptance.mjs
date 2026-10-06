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
const evidence=path.resolve(process.env.LAI_DETAIL_REVERSAL_EVIDENCE || 'evidence/detail-tabs-reversal-1.4.97');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-summary-layout-'));
const children=[];
const checks={};
const uiSaves=[],uncaught=[];
const deviceScaleFactor=2;
assert.ok([1,2].includes(deviceScaleFactor));
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
  socket.addEventListener('message',event=>{const message=JSON.parse(String(event.data));if(message.method==='Network.requestWillBeSent'&&message.params.request.url===backend.base+'/api/save'){uiSaves.push({method:message.params.request.method});return;}if(message.method==='Runtime.exceptionThrown'){uncaught.push(message.params.exceptionDetails.text);return;}const request=pending.get(message.id);if(!request)return;pending.delete(message.id);clearTimeout(request.timer);if(message.error)request.reject(Error(message.error.message));else request.resolve(message.result);});
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
async function movePointer(selector){const point=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);await cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});}
async function metrics(){return evaluate(`(()=>{const nav=document.querySelector('.lcd-tabs'),indicator=document.querySelector('.lcd-active-indicator'),body=document.querySelector('.lcd-body'),rect=el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};return{selected:nav.querySelector('.active')?.dataset.tab,nav:{rect:rect(nav),scrollLeft:nav.scrollLeft},bodyAnimation:getComputedStyle(body).animationName,bodyTransition:getComputedStyle(body).transitionDuration,indicator:rect(indicator),buttons:[...nav.querySelectorAll('button')].map(el=>{const s=getComputedStyle(el);return{id:el.dataset.tab,selected:el.getAttribute('aria-selected'),color:s.color,transitionProperty:s.transitionProperty,transitionDuration:s.transitionDuration,transitionTiming:s.transitionTimingFunction,fontWeight:s.fontWeight,rect:rect(el)}})}})()`);}
function assertSourceInk(state,button,label){const expectedX=state.nav.rect.x+Math.round(button.rect.x-state.nav.rect.x+state.nav.scrollLeft)-state.nav.scrollLeft;assert.ok(Math.abs(state.indicator.x-expectedX)<.1,label+' rounded ink left');assert.ok(Math.abs(state.indicator.width-Math.round(button.rect.width))<.1,label+' rounded ink width');}
async function key(key,code,virtualKey,text){await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:virtualKey,...(text?{text}:{})});await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:virtualKey});}
async function rapidClick(selector){
 const point=await evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)}),r=node.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;if(!node.contains(document.elementFromPoint(x,y)))throw Error('Tab target not hit');return{x,y};})()`);
 await cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await cdp.call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});await cdp.call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
}
const scenarios=[];
async function listen(){await evaluate(`(()=>{
 const ids=new WeakMap();let next=1;
 function sample(){const node=document.querySelector('.lcd-active-indicator');if(!node)return null;if(!ids.has(node))ids.set(node,next++);const nav=document.querySelector('.lcd-tabs'),r=node.getBoundingClientRect(),s=getComputedStyle(node),body=document.querySelector('.lcd-body');return {time:performance.now(),node:ids.get(node),count:document.querySelectorAll('.lcd-active-indicator').length,x:r.x,width:r.width,transform:s.transform,transition:s.transitionDuration,ready:node.classList.contains('ready'),selected:nav.querySelector('.active')?.dataset.tab,selectedCount:nav.querySelectorAll('[aria-selected="true"]').length,content:!!body.querySelector('#activity-results')?'activity':!!body.querySelector('.lcd-info-section')?'info':'other',bodyAnimation:getComputedStyle(body).animationName,bodyTransition:getComputedStyle(body).transitionDuration};}
 window.__tabSample=sample;
 window.__tabEvents=[];window.__tabWeightEvents=[];
 document.addEventListener('click',e=>{const b=e.target.closest('.lcd-tabs button[data-tab]');if(!b)return;e.__tabRecord={target:b.dataset.tab,before:sample()};window.__tabEvents.push(e.__tabRecord);},true);
 document.addEventListener('click',e=>{if(e.__tabRecord)e.__tabRecord.after=sample();});
 document.addEventListener('transitionend',e=>{if(e.propertyName!=='font-weight'||!e.target.matches('.lcd-tabs button[data-tab]'))return;e.__tabWeight={target:e.target.dataset.tab,before:sample()};window.__tabWeightEvents.push(e.__tabWeight);},true);
 document.addEventListener('transitionend',e=>{if(e.__tabWeight)e.__tabWeight.after=sample();});
 window.__startTabTrace=()=>{window.__tabEvents=[];window.__tabWeightEvents=[];window.__tabFrames=[];window.__tabDone=false;const start=performance.now();function step(){window.__tabFrames.push(sample());if(performance.now()-start<1100)requestAnimationFrame(step);else window.__tabDone=true;}requestAnimationFrame(step);};
})()`);}
function endpoint(state){const b=state.buttons.find(b=>b.id===state.selected);return {x:state.nav.rect.x+Math.round(b.rect.x-state.nav.rect.x+state.nav.scrollLeft)-state.nav.scrollLeft,width:Math.round(b.rect.width)};}
try{
 fs.mkdirSync(evidence,{recursive:true});assert.ok(!fs.existsSync(path.join(resources,'trade-order-data.json')),'Only seedless review resources permitted');backend=await startBackend();const initial=await snapshot();assert.deepEqual(initial.data.customers,{});assert.equal(initial.data.orders.length,0);
 initial.data.orders=[];initial.data.customers={'Tab Reversal':{country:'US',source:'Synthetic'}};
 const seeded=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:initial,baseRevision:initial.revision})});assert.equal(seeded.status,200);
 const port=await freePort();const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps',`--user-data-dir=${path.join(temporary,'chrome')}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});children.push(browser);
 let target;await until(async()=>{try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'browser');cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Network.enable');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:1022,deviceScaleFactor:2,mobile:false});await navigate();const baseline=await snapshot();await openDetail('Tab Reversal');await listen();
 for(const [width,height] of [[1756,1022],[1100,720],[900,480]]){
  await cdp.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2,mobile:false});await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  for(const delay of [35,85,160]){
   const label=width+'-'+delay;await pointerClick('[data-tab="info"]');await pause(360);const starting=await metrics();await evaluate('window.__startTabTrace()');
   for(const tab of ['activity','info','activity','info']){await rapidClick('[data-tab="'+tab+'"]');await pause(delay);}
   await until(()=>evaluate('window.__tabDone'),'trace completed');const observed=await evaluate('({events:window.__tabEvents,weightEvents:window.__tabWeightEvents,frames:window.__tabFrames})');const final=await metrics();scenarios.push({label,width,height,requestedDelay:delay,starting,observed,final});fs.writeFileSync(path.join(evidence,'observations.json'),JSON.stringify(scenarios,null,2));
   assert.equal(observed.events.length,4);assert.deepEqual(observed.events.map(e=>e.target),['activity','info','activity','info']);for(const e of observed.events){assert.equal(e.after.selected,e.target);assert.equal(e.after.content,e.target);assert.equal(e.after.selectedCount,1);assert.equal(e.before.node,e.after.node);assert.ok(Math.abs(e.before.x-e.after.x)<0.15,'click x discontinuity '+label);assert.ok(Math.abs(e.before.width-e.after.width)<0.15,'click width discontinuity '+label);}checks[label+'-clickRetargetIsContinuousAndContentImmediate']=true;
   assert.ok(observed.frames.every(f=>f&&f.count===1&&f.node===observed.frames[0].node&&f.selectedCount===1));checks[label+'-singleIndicatorAndSelectedTabThroughout']=true;
   const targetX=endpoint({...starting,selected:'activity'}).x,initialX=starting.indicator.x,firstReverse=observed.events[1].before.x;assert.ok(firstReverse>Math.min(targetX,initialX)+0.1&&firstReverse<Math.max(targetX,initialX)-0.1,'First reverse must occur mid-motion');checks[label+'-firstReverseDuringActualMotion']=true;
   assert.ok(observed.frames.some(f=>Math.abs(f.x-starting.indicator.x)>1&&Math.abs(f.x-starting.buttons.find(b=>b.id==='activity').rect.x)>1));assert.ok(observed.frames.every(f=>f.bodyAnimation==='none'&&f.bodyTransition==='0s'));checks[label+'-realIntermediateMotionAndNoContentAnimation']=true;
   assert.equal(final.selected,'info');const end=endpoint(final);assert.ok(Math.abs(final.indicator.x-end.x)<0.15);assert.ok(Math.abs(final.indicator.width-end.width)<0.15);checks[label+'-finalRoundedInkAtCorrectTab']=true;
   for(const e of observed.weightEvents){assert.ok(Math.abs(e.before.x-e.after.x)<0.15,'font-weight completion x discontinuity '+label);assert.ok(Math.abs(e.before.width-e.after.width)<0.15,'font-weight completion width discontinuity '+label);}checks[label+'-fontWeightCompletionDoesNotSnapIndicator']=true;
  }
 }

 await pointerClick('[data-tab="info"]');await pause(360);await pointerClick('[data-tab="activity"]');await pause(50);const keyboardBefore=await evaluate('window.__tabSample()');await key('Tab','Tab',9);assert.equal(await evaluate('document.activeElement.dataset.tab'),'info');await key('Enter','Enter',13,'\r');const keyboardAfter=await metrics();const keyboardNode=await evaluate('window.__tabSample()');assert.equal(keyboardAfter.selected,'info');assert.equal(keyboardNode.content,'info');assert.equal(keyboardNode.node,keyboardBefore.node);assert.equal(await evaluate('document.activeElement.dataset.tab'),'info');assertSourceInk(keyboardAfter,keyboardAfter.buttons.find(b=>b.id==='info'),'Keyboard interruption');assert.equal(await evaluate(`document.querySelector('.lcd-active-indicator').getAnimations().filter(a=>a.playState==='running').length`),0);checks.keyboardInterruptLandsImmediatelyAndRetainsFocus=true;
 await pause(400);const keyboardSettled=await metrics();assertSourceInk(keyboardSettled,keyboardSettled.buttons.find(b=>b.id==='info'),'Keyboard settled');checks.keyboardNoLatePointerOverride=true;
 await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});const reduced=[];
 for(const id of ['activity','info']){await pointerClick('[data-tab="'+id+'"]');const sameTask=await metrics();const duration=await evaluate(`getComputedStyle(document.querySelector('.lcd-active-indicator')).transitionDuration`);assert.ok(Number.parseFloat(duration)<0.001);await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');const state=await metrics();assert.equal(state.selected,id);assertSourceInk(state,state.buttons.find(b=>b.id===id),'Reduced '+id);assert.equal(await evaluate(`document.querySelector('.lcd-active-indicator').getAnimations().filter(a=>a.playState==='running').length`),0);await pause(120);const end=await metrics();assertSourceInk(end,end.buttons.find(b=>b.id===id),'Reduced settled '+id);reduced.push({id,sameTask,duration,state,end});checks['reduced-'+id+'-withinTwoFramesAndNoLateMotion']=true;}
 await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});fs.writeFileSync(path.join(evidence,'keyboard-reduced.json'),JSON.stringify({keyboardBefore,keyboardAfter,keyboardNode,keyboardSettled,reduced},null,2));
 await frame('rapid-tabs-final');assert.deepEqual(await snapshot(),baseline);assert.equal(uiSaves.length,0);assert.deepEqual(uncaught,[]);checks.noDatabaseWrites=true;
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({status:'pass',version:'1.4.118',htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),checkCount:Object.keys(checks).length,checks,scenarios,uiSaveRequests:uiSaves.length,scope:'Browser computed-style continuity only; source reverse/native/physical/pixels unverified'},null,2));console.log(JSON.stringify({status:'pass',checks:Object.keys(checks).length}));
}catch(error){fs.writeFileSync(path.join(evidence,'failure.json'),JSON.stringify({message:error.message,checks,scenarios},null,2));console.error(error.stack);throw error;}
finally{if(cdp)await cdp.call('Page.navigate',{url:'about:blank'}).catch(()=>{});cdp?.close();for(const child of [...children].reverse())await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});fs.writeFileSync(path.join(evidence,'cleanup.json'),JSON.stringify({temporaryRemoved:!fs.existsSync(temporary),children:children.map(child=>({pid:child.pid,exitCode:child.exitCode,signalCode:child.signalCode}))},null,2));assert.ok(children.every(child=>child.exitCode===0));}
