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
const evidence=path.resolve(process.env.LAI_SEGMENT_DEFAULT_EVIDENCE || 'evidence/ui-1.4.100/segment-default');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-segment-default-'));
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
    env:{...process.env,LAI_DATA_DIR:path.join(temporary,'database'),LAI_APP_PORT:String(port),LAI_API_TOKEN:token,LAI_INSTANCE_NONCE:'save-wait-test',LAI_APP_NO_OPEN:'1'},stdio:'ignore'});
  children.push(child);
  const base=`http://127.0.0.1:${port}`;
  await until(async()=>{if(child.exitCode!==null)throw Error('Isolated service exited');try{return (await fetch(base+'/api/health')).ok;}catch{return false;}},'isolated backend');
  return {child,base,token};
}
async function snapshot(){return (await fetch(backend.base+'/api/data',{headers:{'x-trade-token':backend.token}})).json();}
async function connect(url){
  const socket=new WebSocket(url);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let sequence=0;const pending=new Map();const paused=[];
  socket.addEventListener('message',event=>{const message=JSON.parse(String(event.data));if(message.method==='Fetch.requestPaused'){paused.push(message.params);return;}const request=pending.get(message.id);if(!request)return;pending.delete(message.id);clearTimeout(request.timer);if(message.error)request.reject(Error(message.error.message));else request.resolve(message.result);});
  return {paused,call(method,params={}){const id=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('Isolated browser command timed out: '+method))},5000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});},close(){socket.close();}};
}
async function evaluate(expression){const result=await cdp.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;}
async function navigate(){await cdp.call('Page.navigate',{url:backend.base+'/trade-order-system.html?token='+encodeURIComponent(backend.token)+'#customers'});await until(()=>evaluate(`!!document.querySelector('.company-link')`),'customer list');}

const readiness=[];
const geometry=[];
const dotFrames=[];
async function settle(){await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await until(()=>evaluate(`!document.getAnimations().some(a=>a.playState==='running'&&a.effect.getTiming().iterations!==Infinity)`),'finite motion');}
async function tap(selector){let point;await settle();await until(async()=>{const s=await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)return {ready:false};const r=n.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,ready:r.width>0&&r.height>0&&x>=0&&x<innerWidth&&y>=0&&y<innerHeight&&n.contains(document.elementFromPoint(x,y))&&!n.disabled}})()`);readiness.push({selector,...s});point={x:s.x,y:s.y};return s.ready;},'pointer target');for(const type of ['mousePressed','mouseReleased'])await cdp.call('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});}
async function manage(){await navigate();await tap('.group-settings[data-action="manage-segments"]');await until(()=>evaluate(`!!document.querySelector('.segment-management')`),'manager');}
async function edit(id){await manage();await tap('[data-edit-segment="'+id+'"]');await until(()=>evaluate(`!!document.querySelector('#segment-form')`),'editor');await settle();}
async function openNew(){await manage();await tap('.drawer-footer [data-action="new-segment"]');await until(()=>evaluate(`!!document.querySelector('#segment-form')`),'new editor');await settle();}
async function closed(){await until(()=>evaluate(`!document.querySelector('.overlay')`),'closed');}
async function cancel(){await tap('.drawer-footer [data-action="close-modal"]');}
async function discard(){await until(()=>evaluate(`!!document.querySelector('.segment-editor-unsaved')`),'draft warning');await tap('[data-action="discard-segment-editor"]');await closed();}
async function select(selector,value){await evaluate(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.value=${JSON.stringify(value)};n.dispatchEvent(new Event('change',{bubbles:true}));})()`);await settle();}
async function selected(){return evaluate(`document.querySelector('#segment-form').elements.match.value`);}
async function count(){return evaluate(`Number(document.querySelector('#match-preview').textContent.match(/[0-9]+/)[0])`);}
async function save(){await tap('[form="segment-form"]');await closed();}
async function key(key,code){for(const type of ['keyDown','keyUp'])await cdp.call('Input.dispatchKeyEvent',{type,key,code:key,windowsVirtualKeyCode:code});}
async function recordFrame(name){await settle();await until(()=>evaluate(`!document.querySelector('#toast')?.classList.contains('show')`),'toast');const picture=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(evidence,name+'.png'),Buffer.from(picture.data,'base64'));geometry.push(await evaluate(`(()=>{const g=document.querySelector('.segment-match'),r=g.getBoundingClientRect(),s=getComputedStyle(g.querySelector('.segment-match-options'));return {group:{x:r.x,y:r.y,width:r.width,height:r.height},gap:s.gap,options:[...g.querySelectorAll('label')].map(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return {text:n.textContent,x:r.x,y:r.y,width:r.width,height:r.height,fontSize:s.fontSize,lineHeight:s.lineHeight}}),formScroll:document.querySelector('#segment-form').scrollTop};})()`));}

async function rename(name){await evaluate(`(()=>{const n=document.querySelector('#segment-form [name="name"]');n.value=${JSON.stringify(name)};n.dispatchEvent(new Event('input',{bubbles:true}));})()`);}
const observations=[];
try{
 fs.mkdirSync(evidence,{recursive:true});assert.ok(!fs.existsSync(path.join(resources,'trade-order-data.json')),'Seedless resources only');backend=await startBackend();const initial=await snapshot();assert.deepEqual(initial.data.customers,{});
 initial.data.customers={A:{country:'US',source:'Referral'},B:{country:'GB',source:'Mail'},C:{country:'US',source:'Mail'}};
 const rules=[{field:'country',op:'eq',value:'US'},{field:'source',op:'eq',value:'Mail'}];
 const base={kind:'rules',rules,unknown:{keep:'ORIGINAL'}};
 initial.data.previewSegments=[{...base,id:'missing',name:'Default Legacy'},{...base,id:'draft',name:'Draft Legacy'},{...base,id:'all',name:'Explicit All',match:'all'},{...base,id:'any',name:'Explicit Any',match:'any'}];
 assert.equal((await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:initial,baseRevision:initial.revision})})).status,200);
 const port=await freePort();const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps',`--user-data-dir=${path.join(temporary,'chrome')}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});children.push(browser);let target;await until(async()=>{try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'browser');cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:1022,deviceScaleFactor:2,mobile:false});const baseline=await snapshot();
 assert.equal(Object.hasOwn(baseline.data.previewSegments.find(s=>s.id==='missing'),'match'),false);
 await edit('missing');observations.push(await evaluate(`({selected:document.querySelector('#segment-form').elements.match.value,checked:document.querySelectorAll('#segment-form [name="match"]:checked').length,preview:document.querySelector('#match-preview').textContent})`));await recordFrame('missing-default-initial');assert.equal(await selected(),'all','Existing omitted match must default to all');assert.equal(observations[0].checked,1);assert.equal(await count(),1);assert.deepEqual(await snapshot(),baseline);checks.omittedMatchOpensAllAndDoesNotWrite=true;
 await cancel();await closed();assert.deepEqual(await snapshot(),baseline);checks.untouchedDefaultCancelsWithoutWarningOrWrite=true;
 await edit('missing');await rename('Default Renamed');assert.equal(await selected(),'all');assert.equal(await count(),1);await save();let saved=await snapshot();assert.equal(saved.revision,baseline.revision+1);assert.deepEqual(saved.data.previewSegments.find(s=>s.id==='missing'),{...baseline.data.previewSegments.find(s=>s.id==='missing'),name:'Default Renamed',match:'all',members:[],archived:false});checks.renameOnlySavesDefaultOnceAndKeepsMetadata=true;
 await edit('missing');assert.equal(await selected(),'all');assert.equal(await count(),1);await cancel();await closed();assert.deepEqual(await snapshot(),saved);checks.reopenedSavedDefaultRemainsAll=true;
 await edit('draft');assert.equal(await selected(),'all');await tap('[data-action="add-rule"]');assert.equal(await selected(),'all');await tap('[data-remove-rule="2"]');assert.equal(await selected(),'all');assert.equal(await count(),1);await rename('Discarded Draft');await cancel();await until(()=>evaluate(`!!document.querySelector('.segment-editor-unsaved')`),'draft warning');await tap('[data-action="continue-segment-editor"]');assert.equal(await selected(),'all');assert.equal(await count(),1);assert.equal(await evaluate(`document.querySelector('#segment-form [name="name"]').value`),'Discarded Draft');await cancel();await discard();assert.deepEqual(await snapshot(),saved);assert.equal(Object.hasOwn(saved.data.previewSegments.find(s=>s.id==='draft'),'match'),false);checks.redrawContinueAndDiscardKeepDefaultWithoutMigration=true;
 for(const [id,match,expected]of [['any','any',3],['all','all',1]]){await edit(id);assert.equal(await selected(),match);assert.equal(await count(),expected);await rename('Renamed '+id);await save();const next=await snapshot();assert.equal(next.revision,saved.revision+1);assert.deepEqual(next.data.previewSegments.find(s=>s.id===id),{...saved.data.previewSegments.find(s=>s.id===id),name:'Renamed '+id,members:[],archived:false});saved=next;checks['explicit'+id+'OrdinaryEditKeepsRuleAndSingleWrite']=true;}

 await stop(backend.child);backend=await startBackend();assert.deepEqual(await snapshot(),saved);checks.savedModesAndUnmodifiedMissingMatchSurviveRestart=true;
 const report={status:'pass',testedAt:new Date().toISOString(),version:await evaluate(`document.querySelector('.app-version').textContent`),htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),checkCount:Object.keys(checks).length,checks,observations,geometry,scope:'M17-R01 omitted match old-group lifecycle; existing explicit all/any, isolated SQLite only'};fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,version:report.version,checks:report.checkCount}));
}catch(error){fs.writeFileSync(path.join(evidence,'failure.json'),JSON.stringify({message:error.message,checks,observations,geometry},null,2));console.error(error.stack);process.exitCode=1;}
finally{fs.writeFileSync(path.join(evidence,'readiness.json'),JSON.stringify(readiness,null,2));cdp?.close();for(const child of children)await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
