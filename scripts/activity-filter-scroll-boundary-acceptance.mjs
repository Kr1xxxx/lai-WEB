import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

// Existing advanced filter: actual keyboard and delayed preference-save lifecycle in a seedless synthetic service.
const app=path.resolve(process.env.LAI_ACCEPTANCE_APP || 'dist/来财Lai.app');
const resources=path.join(app,'Contents/Resources');
const evidence=path.resolve(process.env.LAI_ACTIVITY_FILTER_SAVE_EVIDENCE || 'evidence/activity-filter-close-2026-10-05/red124');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-filter-scroll-'));
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






const trigger='[data-action="activity-advanced-filter"]';
const observations=[],failures=[];
let fixtureSaves=0,expectedDatabase;
async function key(key,code,n,modifiers=0){for(const type of ['keyDown','keyUp'])await cdp.call('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:n,modifiers,...(type==='keyDown'&&key==='Enter'?{text:'\r'}:{})});}
async function settle(){await until(()=>evaluate(`!document.getAnimations().some(a=>a.playState==='running'&&a.effect.getTiming().iterations!==Infinity)`),'finite motion');await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');}
async function tabTo(selector){await settle();for(let i=0;i<160;i++){if(await evaluate('document.activeElement?.matches('+JSON.stringify(selector)+')'))return;await key('Tab','Tab',9);}throw Error('Actual Tab cannot reach '+selector);}
async function tap(selector){await settle();await pointerClick(selector);}
async function wheel(selector,dx,dy){const point=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),x=Math.min(innerWidth-8,r.x+r.width/2),y=Math.max(60,Math.min(innerHeight-8,r.y+Math.min(15,r.height/2))),h=document.elementFromPoint(x,y);if(!e.contains(h))throw Error('Real wheel target covered '+${JSON.stringify(selector)});return {x,y};})()`);await cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await cdp.call('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:dx,deltaY:dy});}
async function check(name,fn){try{await fn();checks[name]=true;}catch(e){if(e.code!=='ERR_ASSERTION')throw e;checks[name]=false;failures.push({name,message:e.message});}}
async function read(label){const x=await evaluate(`(()=>{const b=document.querySelector('.activity-filter-popover'),t=document.querySelector(${JSON.stringify(trigger)}),r=t.getBoundingClientRect(),tabs=document.querySelector('.lcd-tabs');return{menu:!!b,same:!!b&&b===window.__menu,types:b?[...b.querySelectorAll('[name=activityType]:checked')].map(e=>e.value):[],focus:document.activeElement?.name||document.activeElement?.dataset.action||document.activeElement?.id,draft:document.querySelector('#followup-text')?.value,anchor:{left:r.left,top:r.top,width:r.width,height:r.height},tabsLeft:tabs.scrollLeft,tabsMax:tabs.scrollWidth-tabs.clientWidth,mainLeft:document.querySelector('.customer-main').scrollLeft}})()`);observations.push({label,...x});return x;}
async function open(mode){if(mode==='keyboard'){await tabTo(trigger);await key('Enter','Enter',13);}else await tap(trigger);await until(()=>evaluate('!!document.querySelector("#activity-advanced-form")'),'filter opened');await settle();await evaluate('window.__menu=document.querySelector(".activity-filter-popover")');}
async function close(){if(await evaluate('!!document.querySelector(".activity-filter-popover")')){await key('Escape','Escape',27);await until(()=>evaluate('!document.querySelector(".activity-filter-popover")'),'Escape close');}}
async function draftType(){await tabTo('#activity-advanced-form [name=activityType][value=followup]');await key(' ','Space',32);assert.equal(await evaluate('document.querySelector("#activity-advanced-form [value=followup]").checked'),true);}
async function newDetail(width){await close();await cdp.call('Emulation.setDeviceMetricsOverride',{width,height:1022,deviceScaleFactor:1,mobile:false});await navigate();await tap('[data-open="Scroll Fixture"]');await until(()=>evaluate('!!document.querySelector(".lcd-tabs")'),'detail');await tap('.lcd-tabs [data-tab=activity]');await tap('#followup-text');await cdp.call('Input.insertText',{text:'UNSENT FILTER FOLLOWUP'});await settle();}
async function trace(){await evaluate(`(()=>{window.__trace=[];const log=(kind,extra={})=>{const b=document.querySelector('.activity-filter-popover'),t=document.querySelector(${JSON.stringify(trigger)}),r=t?.getBoundingClientRect();window.__trace.push({kind,time:performance.now(),menu:!!b,focus:document.activeElement?.name||document.activeElement?.dataset.action,anchor:r?{left:r.left,top:r.top,width:r.width,height:r.height}:null,...extra})};for(const kind of ['scroll','focusin','focusout','keydown','keyup'])document.addEventListener(kind,e=>log(kind,{target:e.target.className||e.target.name||e.target.nodeName,key:e.key,trusted:e.isTrusted,left:e.target.scrollLeft,top:e.target.scrollTop}),true);const remove=Element.prototype.remove;Element.prototype.remove=function(...args){if(this.matches('.activity-filter-popover'))log('remove',{stack:new Error().stack.split('\\n').map(line=>line.replace(/http[^ )]+/g,'[isolated page]'))});return remove.apply(this,args)};new MutationObserver(records=>{for(const record of records)for(const n of record.addedNodes)if(n.nodeType===1&&n.matches?.('.activity-filter-popover'))log('menu-added')}).observe(document.body,{childList:true});window.__traceLog=log;})()`);}
try{
 fs.mkdirSync(evidence,{recursive:true});assert.equal(fs.readdirSync(resources).includes('trade-order-data.json'),false);backend=await startBackend();const empty=await snapshot();assert.deepEqual(empty.data.customers,{});assert.equal(empty.data.orders.length,0);empty.data.customers={'Scroll Fixture':{country:'US',source:'Synthetic',contacts:['Person'],history:Array.from({length:12},(_,i)=>({type:'followup',text:'FILTER HISTORY '+i,time:'2026-09-01T12:00:00Z'}))}};const seed=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:empty,baseRevision:empty.revision})});assert.equal(seed.status,200);fixtureSaves++;expectedDatabase=await snapshot();
 const port=await freePort(),browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps','--user-data-dir='+path.join(temporary,'chrome'),'--remote-debugging-port='+port,'about:blank'],{stdio:'ignore'});children.push(browser);let target;await until(async()=>{try{target=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(t=>t.type==='page');return !!target?.webSocketDebuggerUrl}catch{return false}},'private browser');cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Network.enable');
 for(const width of [1100,900]){
  await newDetail(width);await trace();
  // Real wheel immediately followed by Enter: no synthetic scroll event or product/DOM mutation.
  await tabTo(trigger);const pre=await read('before rapid open '+width);assert.ok(pre.tabsMax>0);await evaluate('window.__traceLog("rapid-wheel-before")');await wheel('.lcd-tabs',pre.tabsLeft<pre.tabsMax?90:-90,0);await key('Enter','Enter',13);await settle();const rapid=await read('rapid wheel and Enter '+width);await check('rapid opening survives queued unrelated scroll '+width,()=>{assert.equal(rapid.menu,true);assert.deepEqual(rapid.anchor,pre.anchor)});await close();
  for(const mode of ['keyboard','pointer']){
   await open(mode);await draftType();const before=await read('before unrelated '+width+' '+mode);await wheel('.lcd-tabs',before.tabsLeft<before.tabsMax?90:-90,0);await settle();const after=await read('after unrelated '+width+' '+mode);assert.notEqual(after.tabsLeft,before.tabsLeft,'Actual tabs wheel must move');assert.deepEqual(after.anchor,before.anchor,'Unrelated scroll does not move trigger');await check('unrelated tabs scroll preserves menu and draft '+width+' '+mode,()=>{assert.equal(after.menu&&after.same,true);assert.ok(after.types.includes('followup'));assert.equal(after.draft,'UNSENT FILTER FOLLOWUP')});await frame('unrelated-'+width+'-'+mode);await close();
  }
  await open('keyboard');await draftType();const beforeInside=await read('before internal '+width);await wheel('.activity-filter-scroll',0,120);await settle();const inside=await read('after internal '+width);await check('internal scroll preserves menu and draft '+width,()=>{assert.equal(inside.menu&&inside.same,true);assert.ok(inside.types.includes('followup'));assert.deepEqual(inside.anchor,beforeInside.anchor)});await close();await check('Escape restores trigger focus '+width,async()=>assert.equal(await evaluate('document.activeElement.matches('+JSON.stringify(trigger)+')'),true));
  await open('pointer');await tap('.app-version');await until(()=>evaluate('!document.querySelector(".activity-filter-popover")'),'outside click closes');checks['outside click closes '+width]=true;
  await open('pointer');const beforeMain=await read('before moving main '+width);await wheel('.customer-main',0,220);await settle();const moving=await read('after moving main '+width);assert.notDeepEqual(moving.anchor,beforeMain.anchor,'Real ancestor scroll must move anchor');await check('real anchor movement still closes '+width,()=>assert.equal(moving.menu,false));
  fs.writeFileSync(path.join(evidence,'trace-boundaries-'+width+'.json'),JSON.stringify(await evaluate('window.__trace'),null,2));
  // Reset through actual list navigation so anchor is visible again.
  await newDetail(width);await trace();await open('keyboard');await cdp.call('Emulation.setDeviceMetricsOverride',{width:width+16,height:1022,deviceScaleFactor:1,mobile:false});await until(()=>evaluate('!document.querySelector(".activity-filter-popover")'),'resize closes');checks['resize still closes '+width]=true;
  fs.writeFileSync(path.join(evidence,'trace-'+width+'.json'),JSON.stringify(await evaluate('window.__trace'),null,2));await check('followup and DB unchanged '+width,async()=>{assert.equal(await evaluate('document.querySelector("#followup-text").value'),'UNSENT FILTER FOLLOWUP');assert.deepEqual(await snapshot(),expectedDatabase);assert.equal(cdp.uiSaves.length,0)});
 }
 await check('no uncaught browser exceptions',()=>assert.deepEqual(cdp.exceptions,[]));const report={result:failures.length?'fail':'pass',checks,failures,observations,uiSaveRequests:cdp.uiSaves.length,fixtureSaves,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),probeSha256:crypto.createHash('sha256').update(fs.readFileSync(new URL(import.meta.url))).digest('hex'),scope:'Real input for queued/unrelated tab scroll and advanced-filter close boundaries; synthetic DB only. Not proof of exact old121 event timing.'};fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify(report,null,2));if(failures.length)throw Error(failures.map(x=>x.name).join('; '));console.log('PASS filter scroll boundaries '+Object.keys(checks).length);
}catch(error){fs.writeFileSync(path.join(evidence,'failure.json'),JSON.stringify({error:error.message,checks,failures,observations},null,2));if(cdp){fs.writeFileSync(path.join(evidence,'last-trace.json'),JSON.stringify(await evaluate('window.__trace'),null,2));await frame('failure').catch(()=>{});}throw error;}
finally{if(cdp)await cdp.call('Page.navigate',{url:'about:blank'}).catch(()=>{});cdp?.close();for(const child of [...children].reverse())await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});fs.writeFileSync(path.join(evidence,'cleanup.json'),JSON.stringify({temporaryRemoved:!fs.existsSync(temporary),children:children.map(child=>({pid:child.pid,exitCode:child.exitCode,signalCode:child.signalCode}))},null,2));}
