import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

// Exercise actual activity refresh UI under delayed/failed local responses; catch silent activation, stale rendering and draft loss.
const app=path.resolve(process.env.LAI_ACCEPTANCE_APP || 'dist/来财Lai.app');
const resources=path.join(app,'Contents/Resources');
const evidence=path.resolve(process.env.LAI_TAB_VISIBILITY_EVIDENCE || 'evidence/detail-tab-visibility-2026-10-05/baseline123');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-tab-visibility-'));
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
    env:{...process.env,LAI_DATA_DIR:path.join(temporary,'database'),LAI_APP_PORT:String(port),LAI_API_TOKEN:token,LAI_INSTANCE_NONCE:'activity-refresh-test',LAI_APP_NO_OPEN:'1'},stdio:'ignore'});
  children.push(child);
  const base=`http://127.0.0.1:${port}`;
  await until(async()=>{if(child.exitCode!==null)throw Error('Isolated service exited');try{return (await fetch(base+'/api/health')).ok;}catch{return false;}},'isolated backend');
  return {child,base,token};
}
async function snapshot(){return (await fetch(backend.base+'/api/data',{headers:{'x-trade-token':backend.token}})).json();}
async function connect(url){
  const socket=new WebSocket(url);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let sequence=0;const pending=new Map();const paused=[];const completed=new Set();const exceptions=[];const uiSaves=[];
  socket.addEventListener('message',event=>{const message=JSON.parse(String(event.data));if(message.method==='Network.requestWillBeSent'&&message.params.request.url===backend.base+'/api/save'){uiSaves.push({method:message.params.request.method});return;}if(message.method==='Fetch.requestPaused'){paused.push({requestId:message.params.requestId,networkId:message.params.networkId,method:message.params.request.method});return;}if(message.method==='Network.loadingFinished'||message.method==='Network.loadingFailed'){completed.add(message.params.requestId);return;}if(message.method==='Runtime.exceptionThrown'){exceptions.push({text:message.params.exceptionDetails.text,description:message.params.exceptionDetails.exception?.description?.split('\n')[0]});return;}const request=pending.get(message.id);if(!request)return;pending.delete(message.id);clearTimeout(request.timer);if(message.error)request.reject(Error(message.error.message));else request.resolve(message.result);});
  return {paused,completed,exceptions,uiSaves,call(method,params={}){const id=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('Isolated browser command timed out: '+method))},5000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});},close(){socket.close();}};
}
async function evaluate(expression){const result=await cdp.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description?.split('\n')[0]||result.exceptionDetails.text);return result.result.value;}
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






const observations=[],failures=[];
async function settle(){await until(()=>evaluate(`!document.getAnimations().some(a=>a.playState==='running'&&a.effect.getTiming().iterations!==Infinity)`),'motion');await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');}
async function key(key,code,n,modifiers=0){for(const type of ['keyDown','keyUp'])await cdp.call('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:n,modifiers,...(type==='keyDown'&&key==='Enter'?{text:'\r'}:{})});}
async function read(label){const value=await evaluate(`(()=>{const n=document.querySelector('.lcd-tabs'),a=n.querySelector('[aria-selected=true]'),f=document.activeElement,nr=n.getBoundingClientRect(),r=a.getBoundingClientRect();return{selected:a.dataset.tab,focusedTab:f.dataset?.tab||null,focusedAction:f.dataset?.action||null,focusedId:f.id,focusedTag:f.tagName,focusedRect:{left:f.getBoundingClientRect().left,right:f.getBoundingClientRect().right},focusedVisible:!n.contains(f)||(f.getBoundingClientRect().left>=nr.left-.5&&f.getBoundingClientRect().right<=nr.right+.5),focusInside:n.contains(f),nav:{left:nr.left,right:nr.right},selectedRect:{left:r.left,right:r.right},selectedVisible:r.left>=nr.left-.5&&r.right<=nr.right+.5,scrollLeft:n.scrollLeft,documentScroll:{x:scrollX,y:scrollY}}})()`);observations.push({label,...value});return value;}
async function record(name,fn){try{await fn();checks[name]=true}catch(e){if(e.code!=='ERR_ASSERTION')throw e;checks[name]=false;failures.push({name,message:e.message})}}
let expectedDatabase;
try{
 fs.mkdirSync(evidence,{recursive:true});assert.equal(fs.readdirSync(resources).includes('trade-order-data.json'),false);backend=await startBackend();const state=await snapshot();assert.deepEqual(state.data.customers,{});assert.equal(state.data.orders.length,0);state.data.customers={'Tab Fixture':{country:'US',source:'Synthetic',contacts:['Fixture Person'],emails:['fixture@example.test']}};const save=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state,baseRevision:state.revision})});assert.equal(save.status,200);expectedDatabase=await snapshot();
 const port=await freePort(),browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps','--user-data-dir='+path.join(temporary,'chrome'),'--remote-debugging-port='+port,'about:blank'],{stdio:'ignore'});children.push(browser);let target;await until(async()=>{try{target=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(t=>t.type==='page');return!!target?.webSocketDebuggerUrl}catch{return false}},'private browser');cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Network.enable');
 for(const width of [1100,900]){
  await cdp.call('Emulation.setDeviceMetricsOverride',{width,height:1022,deviceScaleFactor:2,mobile:false});await navigate();await pointerClick('[data-open="Tab Fixture"]');await until(()=>evaluate('!!document.querySelector(".lcd-tabs")'),'detail');await settle();await pointerClick('.lcd-tabs [data-tab="activity"]');await settle();const initial=await read('initial '+width);await record('initial selected visible '+width,()=>assert.equal(initial.selectedVisible,true));
  let last=initial,steps=0;
  do{await key('Tab','Tab',9);await settle();last=await read('Tab '+width+' '+(++steps));if(last.focusInside)await record('focused label visible '+width+' '+steps,()=>assert.equal(last.focusedVisible,true));}while(last.focusInside&&steps<20);
  await record('Tab exited nav '+width,()=>assert.equal(last.focusInside,false));await record('active unchanged '+width,()=>assert.equal(last.selected,'activity'));await record('focus remains on more '+width,()=>assert.equal(last.focusedAction,'detail-tabs-more'));await record('selected visible after Tab exit '+width,()=>assert.equal(last.selectedVisible,true));await frame('after-tab-exit-'+width);
  // Reverse through the tab buttons, with actual Shift+Tab; the selected view must stay unchanged.
  let reverse=last;
  for(let i=0;i<20;i++){await key('Tab','Tab',9,8);await settle();reverse=await read('ShiftTab '+width+' '+i);if(!reverse.focusInside&&i>0)break;}
  await record('selected visible after reverse exit '+width,()=>assert.equal(reverse.selectedVisible,true));await record('reverse active unchanged '+width,()=>assert.equal(reverse.selected,'activity'));
  // Choose a clipped tab through the existing overflow menu, then traverse until leaving the tab bar.
  await pointerClick('[data-action="detail-tabs-more"]');await until(()=>evaluate('!document.querySelector(".lcd-tabs-overflow-menu").hidden'),'overflow');await pointerClick('[data-overflow-tab="history"]');await settle();let chosen=await read('history pointer '+width);await record('overflow selected history visible '+width,()=>{assert.equal(chosen.selected,'history');assert.equal(chosen.selectedVisible,true)});
  steps=0;do{await key('Tab','Tab',9);await settle();chosen=await read('history Tab '+width+' '+(++steps));}while(chosen.focusInside&&steps<20);await record('history remains visible after Tab exit '+width,()=>assert.equal(chosen.selectedVisible,true));await frame('history-tab-exit-'+width);
  let historyReverse=chosen;steps=0;await key('Tab','Tab',9,8);await settle();historyReverse=await read('history reverse enters '+width);assert.equal(historyReverse.focusedTab,'history');
  do{await key('Tab','Tab',9,8);await settle();historyReverse=await read('history ShiftTab '+width+' '+(++steps));if(historyReverse.focusInside)await record('reverse focused label visible '+width+' '+steps,()=>assert.equal(historyReverse.focusedVisible,true));}while(historyReverse.focusInside&&steps<20);
  await record('history visible after reverse exit '+width,()=>assert.equal(historyReverse.selectedVisible,true));await record('history selected after reverse exit '+width,()=>assert.equal(historyReverse.selected,'history'));await record('reverse focus remains external '+width,()=>assert.equal(historyReverse.focusedAction,'schedule-edit'));await frame('history-reverse-exit-'+width);
  assert.deepEqual(await snapshot(),expectedDatabase);
 }
 checks.noUiSave=cdp.uiSaves.length===0;checks.noRuntimeException=cdp.exceptions.length===0;assert.equal(checks.noUiSave,true);assert.equal(checks.noRuntimeException,true);
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({result:failures.length?'reproduced':'pass',checks,failures,observations,uiSaveRequests:cdp.uiSaves.length,syntheticFixtureApiSaves:1,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),probeSha256:crypto.createHash('sha256').update(fs.readFileSync(new URL(import.meta.url))).digest('hex'),scope:'Focused actual keyboard tab-navigation; seedless synthetic database. No native/GPU/full pixels claim.'},null,2));console.log(JSON.stringify({checks:Object.keys(checks).length,failures:failures.length}));if(failures.length)process.exitCode=1;
}catch(error){fs.writeFileSync(path.join(evidence,'failure.json'),JSON.stringify({error:error.message,checks,observations},null,2));if(cdp)await frame('failure').catch(()=>{});throw error;}
finally{if(cdp)await cdp.call('Page.navigate',{url:'about:blank'}).catch(()=>{});cdp?.close();for(const child of [...children].reverse())await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});fs.writeFileSync(path.join(evidence,'cleanup.json'),JSON.stringify({temporaryRemoved:!fs.existsSync(temporary),children:children.map(child=>({pid:child.pid,exitCode:child.exitCode,signalCode:child.signalCode}))},null,2));assert.ok(children.every(child=>child.exitCode===0));}
