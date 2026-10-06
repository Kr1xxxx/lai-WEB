import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

// Existing search: draft blur must not discard a previously committed query.
const app=path.resolve(process.env.LAI_ACCEPTANCE_APP || 'dist/来财Lai.app');
const resources=path.join(app,'Contents/Resources');
const evidence=path.resolve(process.env.LAI_NOTICE_EVIDENCE || 'evidence/notice-backdrop-2026-10-04/red122');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-activity-refresh-'));
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






const failures=[],observations=[];
async function check(name,fn){try{await fn();checks[name]=true;}catch(error){if(error.code!=='ERR_ASSERTION')throw error;checks[name]=false;failures.push({name,error:error.message});}}
async function settle(){await until(()=>evaluate(`!document.getAnimations().some(a=>a.playState==='running'&&a.effect.getTiming().iterations!==Infinity)`),'finite motion');await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);}
async function shade(){const p=await evaluate(`(()=>{const e=document.querySelector('#overlay-root .overlay'),r=e.getBoundingClientRect(),x=r.left+8,y=r.top+r.height/2;if(document.elementFromPoint(x,y)!==e)throw Error('Shade target is not overlay');return{x,y}})()`);for(const type of ['mousePressed','mouseReleased'])await cdp.call('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});await settle();}
async function read(label){const s=await evaluate(`(()=>({open:!!document.querySelector('.feature-dialog'),overlay:!!document.querySelector('#overlay-root .overlay'),form:!!document.querySelector('#customer-form'),active:document.activeElement?.dataset.feature,prompt:!!document.querySelector('.customer-editor-unsaved')}))()`);observations.push({label,...s});return s;}
try{
 fs.mkdirSync(evidence,{recursive:true});backend=await startBackend();const seed=await snapshot();seed.data.customers={'Notice Fixture':{contact:'Primary',country:'US',source:'Referral',unknown:{keep:true}}};seed.data.orders=[];seed.data.previewSegments=[];const saved=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:seed,baseRevision:seed.revision})});assert.equal(saved.status,200);const baseline=await snapshot();
 const port=await freePort(),browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps','--user-data-dir='+path.join(temporary,'chrome'),'--remote-debugging-port='+port,'about:blank'],{stdio:'ignore'});children.push(browser);let target;await until(async()=>{try{target=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(t=>t.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'private browser');cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Network.enable');
 for(const [width,name]of [[1756,'沟通'],[1756,'AI 助手'],[1100,'沟通'],[900,'沟通']]){
  const label=width+' '+name;await cdp.call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await navigate();await pointerClick('[data-feature="'+name+'"]');await until(()=>evaluate('!!document.querySelector(".feature-dialog")'),'notice');await settle();
  await pointerClick('.feature-dialog .feature-state');const inside=await read('inside '+label);await check('inside click keeps notice '+label,()=>assert.equal(inside.open,true));await frame('notice-'+width+'-'+(name==='沟通'?'chat':'ai'));
  await shade();const outside=await read('outside '+label);await check('outside click closes notice '+label,()=>assert.equal(outside.overlay,false));await check('outside dismissal returns focus '+label,()=>assert.equal(outside.active,name));
  if(outside.overlay){await pointerClick('.feature-dialog .drawer-head [data-action="close-modal"]');await until(()=>evaluate('!document.querySelector("#overlay-root .overlay")'),'baseline cleanup X');}
  await check('notice clicks do not save '+label,async()=>{assert.deepEqual(await snapshot(),baseline);assert.equal(cdp.uiSaves.length,0);});
 }
 await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:900,deviceScaleFactor:1,mobile:false});await navigate();await pointerClick('[data-action="new"]');await until(()=>evaluate('!!document.querySelector("#customer-form")'),'customer form');await settle();await pointerClick('#customer-form [name="name"]');await cdp.call('Input.insertText',{text:'UNSAVED FORM PROTECTION'});await shade();const protectedUI=await read('form shade');await check('customer form unaffected by notice-only backdrop change',()=>{assert.equal(protectedUI.form,true);assert.equal(protectedUI.prompt,false);});await pointerClick('.drawer [data-action="close-modal"]');await until(()=>evaluate('!!document.querySelector(".customer-editor-unsaved")'),'dirty prompt');await pointerClick('[data-action="discard-customer-editor"]');await until(()=>evaluate('!document.querySelector("#overlay-root .overlay")'),'discard isolated draft');
 await check('dirty customer draft protected and discard does not save',async()=>{assert.deepEqual(await snapshot(),baseline);assert.equal(cdp.uiSaves.length,0);});assert.deepEqual(cdp.exceptions,[]);checks.noUncaughtErrors=true;await frame('closed-list');
 const report={result:failures.length?'fail':'pass',checks,failures,observations,uiSaveRequests:cdp.uiSaves.length,syntheticFixtureApiSaves:1,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),probeSha256:crypto.createHash('sha256').update(fs.readFileSync(new URL(import.meta.url))).digest('hex'),scope:'Feature notice backdrop only, internal clicks stay open, dirty forms unaffected; actual CDP mouse and isolated SQLite. Native and source full pixels not validated.'};fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({result:report.result,checks:Object.keys(checks).length,failed:failures.length}));if(failures.length)throw Error('Notice backdrop failures: '+failures.length);
}catch(error){fs.writeFileSync(path.join(evidence,'failure.json'),JSON.stringify({error:error.message,checks,failures,observations},null,2));if(cdp)await frame('failure').catch(()=>{});throw error;}
finally{if(cdp)await cdp.call('Page.navigate',{url:'about:blank'}).catch(()=>{});cdp?.close();for(const child of [...children].reverse())await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});fs.writeFileSync(path.join(evidence,'cleanup.json'),JSON.stringify({temporaryRemoved:!fs.existsSync(temporary),children:children.map(child=>({pid:child.pid,exitCode:child.exitCode,signalCode:child.signalCode}))},null,2));assert.ok(children.every(child=>child.exitCode===0&&child.signalCode===null));}
