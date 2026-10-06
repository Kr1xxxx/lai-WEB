import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

// Catch extra timeline-group fade/translation and verify existing query/group state using real input and synthetic SQLite only.
const app=path.resolve(process.env.LAI_ACCEPTANCE_APP || 'dist/来财Lai.app');
const resources=path.join(app,'Contents/Resources');
const evidence=path.resolve(process.env.LAI_TIME_GROUP_EVIDENCE || 'evidence/m19-time-groups');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-time-group-'));
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




const observations=[];
const group=id=>`[data-timeline-group="${id}"]`;
const button=id=>group(id)+' [data-action="toggle-activity-group"]';
async function settle(){await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);await until(()=>evaluate(`!document.getAnimations().some(a=>a.playState==='running'&&a.effect.getTiming().iterations!==Infinity)`),'finite motion settled');}
async function key(key,code,n){await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:n,...(key==='Enter'?{text:'\r'}:key===' '?{text:' '}:{})});await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:n});}
async function wheel(deltaY){const p=await evaluate(`(()=>{const r=document.querySelector('.customer-main').getBoundingClientRect();return{x:r.left+r.width-16,y:r.top+r.height/2}})()`);await cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',...p});await cdp.call('Input.dispatchMouseEvent',{type:'mouseWheel',...p,deltaX:0,deltaY});await pause(60);}
async function reveal(selector){for(let i=0;i<30;i++){const p=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),b=document.querySelector('.customer-main').getBoundingClientRect();return{visible:r.top>=b.top&&r.bottom<=b.bottom,delta:r.top<b.top?-240:240}})()`);if(p.visible)return;await wheel(p.delta);}throw Error('Cannot reveal '+selector);}
async function state(){return evaluate(`(()=>({groups:[...document.querySelectorAll('#activity-results [data-timeline-group]')].map(g=>({id:g.dataset.timelineGroup,expanded:g.querySelector('button').getAttribute('aria-expanded'),hidden:g.querySelector('.lcd-time-group-body').hidden,items:[...g.querySelectorAll('.lcd-activity-record')].map(r=>r.querySelector('.lcd-event-body').firstChild.textContent)})),query:document.querySelector('#activity-search-input')?.value,draft:document.querySelector('#followup-text')?.value,focusedGroup:document.activeElement?.dataset.groupId}))()`);}
async function capture(id,label,action){
 await reveal(button(id));await evaluate(`(()=>{const g=document.querySelector(${JSON.stringify(group(id))});window.__m19Probe={samples:[],done:false};const sample=kind=>{const b=g.querySelector('.lcd-time-group-body'),s=getComputedStyle(b),h=g.querySelector('button');window.__m19Probe.samples.push({kind,time:performance.now(),hidden:b.hidden,expanded:h.getAttribute('aria-expanded'),display:s.display,opacity:s.opacity,transform:s.transform,animation:s.animationName,height:b.getBoundingClientRect().height,visibleRecords:[...b.querySelectorAll('.lcd-activity-record')].filter(r=>r.checkVisibility()).length,focus:document.activeElement===h})};const o=new MutationObserver(()=>{o.disconnect();sample('mutation');queueMicrotask(()=>sample('microtask'));let n=0;const frame=()=>{sample('raf');if(++n<28)requestAnimationFrame(frame);else window.__m19Probe.done=true};requestAnimationFrame(frame)});o.observe(g,{attributes:true,childList:true,subtree:true});})()`);
 await action();await until(()=>evaluate(`window.__m19Probe.done`),'sample capture');const samples=await evaluate(`window.__m19Probe.samples`);observations.push({label,id,samples});assert.ok(samples.length>=30);
 for(const s of samples){assert.equal(s.expanded,s.hidden?'false':'true');if(!s.hidden){assert.equal(s.animation,'none',label+' group content must switch immediately');assert.equal(s.opacity,'1',label+' no content fade');assert.equal(s.transform,'none',label+' no content translation');assert.ok(s.height>0);assert.ok(s.visibleRecords>0);}else{assert.equal(s.display,'none');assert.equal(s.height,0);assert.equal(s.visibleRecords,0);}}
 assert.equal(samples.at(-1).focus,true,label+' keeps group focus');
 return samples;
}
async function toggle(id,label){return capture(id,label,()=>pointerClick(button(id),false));}
async function input(selector,text){await reveal(selector);await pointerClick(selector);await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:4});await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:4});await cdp.call('Input.insertText',{text});}
try{
 fs.mkdirSync(evidence,{recursive:true});assert.equal(fs.existsSync(path.join(resources,'trade-order-data.json')),false);backend=await startBackend();const initial=await snapshot();assert.equal(Object.keys(initial.data.customers).length,0);assert.equal(initial.data.orders.length,0);
 initial.data.customers={'Group Fixture':{country:'US',source:'Referral',customMetadata:{preserve:'unchanged'},history:[
 {type:'followup',time:new Date().toISOString(),text:'Recent fixture',owner:'Fixture'},
 {type:'followup',time:'2025-02-03T10:00:00Z',text:'Historic matched fixture',owner:'Fixture'},
 {type:'followup',time:'2025-01-01T10:00:00Z',text:'Long historic '+('Detail fixture '.repeat(40)),owner:'Fixture'},
 {type:'created',time:'2024-03-01T10:00:00Z',text:'Original profile fixture',owner:'Fixture'}]}};initial.data.orders=[];
 assert.equal((await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:initial,baseRevision:initial.revision})})).status,200);
 const port=await freePort();const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps',`--user-data-dir=${path.join(temporary,'chrome')}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});children.push(browser);let target;await until(async()=>{try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'private browser');cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');
 const baseline=await snapshot();
 for(const [width,height] of [[1756,1022],[1100,720]]){
  await cdp.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await navigate();await pointerClick('.company-link');await until(()=>evaluate(`!!document.querySelector('.lcd-tabs [data-tab="activity"]')`),'detail');await pointerClick('.lcd-tabs [data-tab="activity"]');await settle();const started=await state();assert.deepEqual(started.groups.map(g=>[g.id,g.expanded]),[['recent','true'],['year:2025','false'],['year:2024','false']]);checks['existingThreeGroupsAndDefaults'+width]=true;
  await input('#followup-text','Pending M19 draft');assert.equal((await state()).draft,'Pending M19 draft');
  await toggle('year:2025','pointer historical open '+width);checks['immediatePointerOpen'+width]=true;
  await toggle('year:2025','pointer historical close '+width);checks['immediatePointerClose'+width]=true;
  await toggle('recent','pointer recent close '+width);await toggle('recent','pointer recent open '+width);checks['recentGroupImmediateAndRecordsKept'+width]=true;
  await reveal(button('year:2025'));await pointerClick(button('year:2025'));await pointerClick(button('year:2025'),false);await pointerClick(button('year:2025'),false);await settle();assert.equal((await state()).groups.find(g=>g.id==='year:2025').expanded,'true');checks['rapidAlternationFinalState'+width]=true;
  await capture('year:2025','keyboard Enter close '+width,()=>key('Enter','Enter',13));await capture('year:2025','keyboard Space open '+width,()=>key(' ','Space',32));assert.equal((await state()).focusedGroup,'year:2025');checks['keyboardImmediateAndFocus'+width]=true;
  await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await toggle('year:2025','reduce close '+width);await toggle('year:2025','reduce open '+width);await cdp.call('Emulation.setEmulatedMedia',{features:[]});checks['reducedMotionImmediate'+width]=true;
  const beforeQuery=await state();await reveal('[data-action="activity-search"]');await pointerClick('[data-action="activity-search"]');await input('#activity-search-input','Historic matched');await key('Enter','Enter',13);await settle();const matched=await state();assert.equal(matched.groups.length,0);assert.ok(await evaluate(`document.querySelector('#activity-results').textContent.includes('Historic matched fixture')`));assert.ok(await evaluate(`!document.querySelector('#activity-results').textContent.includes('Recent fixture')`));checks['queryMatchAndFlatExistingBehavior'+width]=true;
  await pointerClick('[data-action="clear-activity-search"]');await settle();assert.deepEqual((await state()).groups,beforeQuery.groups);checks['clearRestoresExpandedGroupsAndRecords'+width]=true;
  await reveal('[data-activity-filter="followup"]');await pointerClick('[data-activity-filter="followup"]');await settle();assert.equal((await state()).groups.length,0);assert.ok(await evaluate(`document.querySelector('#activity-results').textContent.includes('Long historic')`));await pointerClick('[data-activity-filter="all"]');await settle();assert.deepEqual((await state()).groups,beforeQuery.groups);checks['categoryRoundTripKeepsGroups'+width]=true;
  await reveal('[data-action="activity-sort"]');await pointerClick('[data-action="activity-sort"]');await pointerClick('[data-activity-sort="oldest"]');await settle();assert.deepEqual((await state()).groups.map(g=>g.id),['year:2024','year:2025','recent']);await pointerClick('[data-action="activity-sort"]');await pointerClick('[data-activity-sort="newest"]');await settle();assert.deepEqual((await state()).groups,beforeQuery.groups);checks['sortRoundTripKeepsGroups'+width]=true;
  assert.equal((await state()).draft,'Pending M19 draft');assert.deepEqual(await snapshot(),baseline);checks['draftAndDatabaseUnchanged'+width]=true;await reveal(button('year:2025'));await frame('time-groups-'+width);
 }
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({result:'pass',testedAt:new Date().toISOString(),checks,observations,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),scope:'Real browser pointer/key input with MutationObserver/microtask/RAF style samples; synthetic database; not source continuous raster or native acceptance'},null,2));console.log('PASS: '+Object.keys(checks).length+' time-group/query checks');
}catch(error){fs.writeFileSync(path.join(evidence,'failure.json'),JSON.stringify({error:error.message,checks,observations},null,2));if(cdp)await frame('failure').catch(()=>{});throw error;}
finally{cdp?.close();for(const child of [...children].reverse())await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});fs.writeFileSync(path.join(evidence,'cleanup.json'),JSON.stringify({temporaryRemoved:!fs.existsSync(temporary),children:children.map(child=>({pid:child.pid,exitCode:child.exitCode,signalCode:child.signalCode}))},null,2));assert.ok(children.every(child=>child.exitCode===0));}
