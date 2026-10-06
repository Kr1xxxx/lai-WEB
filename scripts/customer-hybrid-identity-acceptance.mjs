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
const evidence=path.resolve(process.env.LAI_R02B_EVIDENCE || 'evidence/ui-1.4.90/r02b');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-hybrid-identity-'));
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
 const point=await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)}),r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);if(!r.width||!r.height||!(el.contains(hit)||hit?.contains(el)))throw Error('Pointer target is hidden or covered: '+${JSON.stringify(selector)}+' '+JSON.stringify({x,y,rect:r.toJSON(),hit:hit?.className,overlay:el.closest('.overlay')?.className,animations:document.getAnimations().map(a=>({state:a.playState,time:a.currentTime,target:a.effect.target.className}))}));return {x,y}})()`);
 await cdp.call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
 await cdp.call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
}

async function settle(){await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);await until(()=>evaluate(`!document.getAnimations().some(a=>a.playState==='running'&&a.effect.getTiming().iterations!==Infinity)`),'drawer settled');}
async function fill(selector,value){await pointerClick(selector);await evaluate(`document.querySelector(${JSON.stringify(selector)}).select()`);await cdp.call('Input.insertText',{text:value});}
async function openNew(){await pointerClick('[data-action="new"]');await until(()=>evaluate(`!!document.querySelector('#customer-form')`),'new editor');await settle();}
async function prompt(){await until(()=>evaluate(`!!document.querySelector('.customer-editor-unsaved')||!document.querySelector('#customer-form')`),'close decision');assert.equal(await evaluate(`!!document.querySelector('.customer-editor-unsaved')`),true,'Unsaved customer input must show a close decision rather than disappear');assert.ok(await evaluate(`!!document.querySelector('#customer-form')`));}
async function discard(){await pointerClick('[data-action="discard-customer-editor"]');await until(()=>evaluate(`!document.querySelector('.overlay')`),'explicitly discarded editor');}
async function continueEditing(){await pointerClick('[data-action="continue-customer-editor"]');assert.equal(await evaluate(`!!document.querySelector('.customer-editor-unsaved')`),false);}
async function openEditor(name){await navigate();await pointerClick('[data-open="'+name+'"]');await until(()=>evaluate(`!!document.querySelector('.lcd-pagebar [data-action="edit"]')`),'detail');await pointerClick('.lcd-pagebar [data-action="edit"]');await until(()=>evaluate(`!!document.querySelector('#customer-form')`),'editor');await settle();}
async function save(){await pointerClick('[form="customer-form"][value="save"]');await until(()=>evaluate(`!document.querySelector('#customer-form')`),'saved');}
try{
 fs.mkdirSync(evidence,{recursive:true});backend=await startBackend();const initial=await snapshot();
 initial.data.customers={};
 for(const key of ['contacts','emails','phones','addresses'])initial.data.customers['Hybrid '+key]={country:'US',source:'Referral',contact:'Main',email:'main@example.test',phone:'100',[key]:[key==='contacts'?'Main':'',key==='contacts'?'Structured':'',key==='contacts'?'Array Only':key==='emails'?'array@example.test':key==='phones'?'300':'Array Street'],extraContacts:[{id:'legacy-2',contact:'Structured',email:'structured@example.test',phone:'200',contactTitle:'Buyer',historicalReference:{keep:'STRUCTURED-ONLY'}}]};
 initial.data.orders=[];const seeded=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:initial,baseRevision:initial.revision})});assert.equal(seeded.status,200);
 const port=await freePort();const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps',`--user-data-dir=${path.join(temporary,'chrome')}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});children.push(browser);
 let target;await until(async()=>{try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item=>item.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'browser');cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:1022,deviceScaleFactor:1,mobile:false});
 for(const key of ['contacts','emails','phones','addresses']){
  const name='Hybrid '+key,before=await snapshot();await openEditor(name);await fill('#customer-form [name="name"]','Unsaved Hybrid');await pointerClick('.ce-footer [data-action="close-modal"]');await prompt();await discard();assert.deepEqual(await snapshot(),before);checks[key+'CancelKeepsOriginalDataAndIds']=true;
  await openEditor(name);const ids=await evaluate(`[...document.querySelectorAll('#customer-form [name="contactIdExtra"]')].map(el=>el.value)`);assert.equal(ids.length,2);assert.equal(new Set(ids).size,2,key+' array tail must not share the structured identity');checks[key+'UniqueDraftIds']=true;
  await evaluate(`(()=>{const el=document.querySelector('#customer-form [name="note"]');el.value='Only company note changed';el.dispatchEvent(new Event('input',{bubbles:true}));})()`);await save();const after=(await snapshot()).data.customers[name];assert.deepEqual(after.extraContacts[0].historicalReference,{keep:'STRUCTURED-ONLY'});assert.equal(after.extraContacts[0].contactTitle,'Buyer');assert.equal(Object.hasOwn(after.extraContacts[1],'historicalReference'),false);assert.equal(Object.hasOwn(after.extraContacts[1],'contactTitle'),false);checks[key+'FirstSavePreservesCorrectOwnership']=true;
  await openEditor(name);assert.deepEqual(await evaluate(`[...document.querySelectorAll('#customer-form [name="contactIdExtra"]')].map(el=>el.value)`),ids);await save();const twice=(await snapshot()).data.customers[name];assert.equal(twice.extraContacts[1].historicalReference,undefined);assert.equal(twice.extraContacts[1].contactTitle,undefined);checks[key+'SecondEditKeepsIdsAndOwnership']=true;
  await openEditor(name);await evaluate(`document.querySelector('#customer-form [data-contact-card="1"] [data-editor-action="remove-contact"]').click()`);await settle();await save();const remaining=(await snapshot()).data.customers[name].extraContacts;assert.equal(remaining.length,1);assert.equal(remaining[0].id,ids[1]);assert.equal(remaining[0].historicalReference,undefined);assert.equal(remaining[0].contactTitle,undefined);assert.equal(remaining[0][key==='contacts'?'contact':key==='emails'?'email':key==='phones'?'phone':'address'],initial.data.customers[name][key][2]);checks[key+'DeleteStructuredDoesNotMoveMetadata']=true;
 }
 await frame('hybrid-after-saves');const beforeRestart=await snapshot();await stop(backend.child);backend=await startBackend();assert.deepEqual(await snapshot(),beforeRestart);checks.allHybridResultsSurviveIsolatedRestart=true;
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({testedAt:new Date().toISOString(),app,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),result:'pass',checks},null,2));console.log('PASS: '+Object.keys(checks).length+' R02b isolated browser checks');
}catch(error){if(cdp)await frame('failure').catch(()=>{});fs.writeFileSync(path.join(evidence,'failure.json'),JSON.stringify({result:'fail',error:error.message,passedChecks:checks},null,2));throw error;}
finally{cdp?.close();for(const child of children)await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
