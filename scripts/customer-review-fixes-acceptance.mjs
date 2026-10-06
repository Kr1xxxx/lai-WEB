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
const evidence=path.resolve(process.env.LAI_REVIEW_FIX_EVIDENCE || 'evidence/ui-1.4.89/review-r01-r03');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-review-fixes-'));
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
 const person=(id,extra={})=>({id,contact:id,email:id+'@example.test',phone:'5550101',...extra});
 const profile=extras=>({country:'US',source:'Referral',contact:'Main',email:'main@example.test',phone:'5550101',extraContacts:extras});
 initial.data.customers={
  'Review Forward':profile([person('first'),person('second',{contactTitle:'Buyer',contactGender:'Female'})]),
  'Review Reverse':profile([person('first',{contactTitle:'Buyer',contactGender:'Female'}),person('second')]),
  'Review Cross':profile([person('first',{contactTitle:'Buyer'}),person('second',{contactGender:'Female'})]),
  'Review Legacy':profile([person(undefined,{contact:'Legacy First',historicalReference:'first'}),person(undefined,{contact:'Legacy Second',historicalReference:'second',additionalPhones:[{phone:'111',historicalReference:'old-removed'},{phone:'222',historicalReference:'old-kept'}],additionalSocialAccounts:[{socialPlatform:'Instagram',socialAccount:'@legacy',historicalReference:'social-kept'}]})]),
  'Review Collision':profile([person(undefined,{contact:'No ID',historicalReference:'no-id',additionalPhones:[{phone:'111',historicalReference:'no-id-method'},{id:'method-0',phone:'222',historicalReference:'id-method'}]}),person('legacy-1',{historicalReference:'has-id'})]),
  'Review Legacy Plain':{...profile([person(undefined,{contact:'Plain Legacy',historicalReference:'plain-contact',additionalPhones:[{phone:'777',historicalReference:'plain-method'}]})]),additionalPhones:[{phone:'888',historicalReference:'plain-primary-method'}]},
  'Review Old Empty':{contact:'Old',email:'old@example.test',phone:'5550101'}
 };
 initial.data.orders=[];const seeded=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:initial,baseRevision:initial.revision})});assert.equal(seeded.status,200);
 const port=await freePort();const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps',`--user-data-dir=${path.join(temporary,'chrome')}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});children.push(browser);
 let target;await until(async()=>{try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item=>item.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'browser');cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:1022,deviceScaleFactor:1,mobile:false});
 for(const name of ['Review Forward','Review Reverse','Review Cross']){
  const before=(await snapshot()).data.customers[name];await openEditor(name);await evaluate(`(()=>{const input=document.querySelector('#customer-form [name="note"]');input.value='Only company note changed';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await save();
  const after=(await snapshot()).data.customers[name];for(let i=0;i<2;i++)for(const key of ['contactTitle','contactGender'])assert.equal(after.extraContacts[i][key],before.extraContacts[i][key],name+' '+key+' remains with its contact');checks[name+'-optional-fields-preserved']=true;
 }
 await openEditor('Review Forward');await evaluate(`(()=>{const f=document.querySelector('#customer-form');const field=f.querySelector('[name="contactTitleExtra"]');field.value='';field.dispatchEvent(new Event('input',{bubbles:true}));})()`);await save();assert.equal((await snapshot()).data.customers['Review Forward'].extraContacts[1].contactTitle,'');checks.explicitClearIsPreserved=true;
 const beforeCancel=await snapshot();await openEditor('Review Legacy');await fill('#customer-form [name="name"]','Unsaved Legacy');await pointerClick('.ce-footer [data-action="close-modal"]');await prompt();await discard();assert.deepEqual(await snapshot(),beforeCancel);checks.legacyCancelDoesNotPersistIdsOrDraft=true;
 await openEditor('Review Legacy Plain');await save();const plain=(await snapshot()).data.customers['Review Legacy Plain'];assert.equal(plain.extraContacts[0].historicalReference,'plain-contact');assert.equal(plain.extraContacts[0].additionalPhones[0].historicalReference,'plain-method');assert.equal(plain.additionalPhones[0].historicalReference,'plain-primary-method');checks.ordinaryLegacyEditPreservesContactAndPrimaryMethods=true;
 await openEditor('Review Collision');const collisionIds=await evaluate(`[...document.querySelectorAll('#customer-form [name="contactIdExtra"]')].map(x=>x.value)`);assert.equal(new Set(collisionIds).size,2);const methodIds=await evaluate(`[...document.querySelectorAll('#customer-form [data-contact-card="1"] [data-method-row="phone"]')].map(x=>x.dataset.methodId)`);assert.equal(new Set(methodIds).size,2);await save();const collision=(await snapshot()).data.customers['Review Collision'].extraContacts;assert.equal(collision[0].historicalReference,'no-id');assert.equal(collision[1].historicalReference,'has-id');assert.deepEqual(collision[0].additionalPhones.map(p=>p.historicalReference),['no-id-method','id-method']);checks.legacyGeneratedIdsDoNotCollideWithExistingIds=true;
 await openEditor('Review Legacy');await evaluate(`document.querySelector('#customer-form [data-contact-card="1"] [data-editor-action="remove-contact"]').click()`);await evaluate(`document.querySelector('#customer-form [data-contact-card="1"] [data-method-row="phone"] [data-editor-action="remove-method"]').click()`);await evaluate(`document.querySelector('#customer-form [data-contact-card="1"] [data-method-type="phone"]').click()`);await evaluate(`document.querySelector('#customer-form [data-contact-card="1"] [data-method-row="phone"]:last-child [data-method-value]').value='333'`);
 await evaluate(`document.querySelector('#customer-form [data-editor-action="add-contact"]').click()`);await settle();await evaluate(`(()=>{const card=[...document.querySelectorAll('#customer-form [data-contact-card]')].at(-1);for(const [key,value] of Object.entries({contact:'New Added',email:'new@example.test',phone:'5550102'}))card.querySelector('[name="'+key+'Extra"]').value=value;})()`);await save();
 const legacy=(await snapshot()).data.customers['Review Legacy'].extraContacts;assert.equal(legacy[0].contact,'Legacy Second');assert.equal(legacy[0].historicalReference,'second');assert.equal(legacy[0].additionalPhones[0].historicalReference,'old-kept');assert.equal(Object.hasOwn(legacy[0].additionalPhones[1],'historicalReference'),false);assert.equal(legacy[0].additionalSocialAccounts[0].historicalReference,'social-kept');assert.equal(Object.hasOwn(legacy[1],'historicalReference'),false);checks.legacyDeleteAndAddPreservesOnlySurvivingMetadata=true;await frame('legacy-after-save');
 for(const [i,value] of ['','   ','　　'].entries())for(const key of ['country','source']){
  await navigate();await openNew();await evaluate(`(()=>{const f=document.querySelector('#customer-form');for(const [key,value] of Object.entries(${JSON.stringify({name:'Whitespace '+i+' '+key,country:'US',source:'Referral',contact:'Blank Test',email:'blank@example.test',phone:'5550103',[key]:value})})){f.elements[key].value=value;f.elements[key].dispatchEvent(new Event('input',{bubbles:true}));}})()`);const before=await snapshot();await pointerClick('[form="customer-form"][value="save"]');
  if(value)await until(()=>evaluate(`!!document.querySelector('#form-error.visible')`),'trimmed required value rejected');else assert.equal(await evaluate(`document.querySelector('#customer-form').checkValidity()`),false);
  assert.equal(await evaluate(`document.querySelector('#customer-form').elements[${JSON.stringify(key)}].value`),value);assert.deepEqual(await snapshot(),before);assert.equal(await evaluate(`document.querySelector('[form="customer-form"][value="save"]').disabled`),false);await pointerClick('.ce-footer [data-action="close-modal"]');await prompt();await discard();checks['required-'+key+'-'+i]=true;
 }
 await openEditor('Review Old Empty');await evaluate(`document.querySelector('#customer-form [name="note"]').value='Allowed old incomplete edit'`);await save();assert.equal((await snapshot()).data.customers['Review Old Empty'].note,'Allowed old incomplete edit');checks.oldIncompleteProfileCanStillEdit=true;
 await navigate();await openNew();for(const [name,value] of Object.entries({name:'Valid New',country:' US ',source:' Referral ',contact:'Valid',email:'valid@example.test',phone:'5550104'}))await fill('#customer-form [name="'+name+'"]',value);await save();const valid=(await snapshot()).data.customers['Valid New'];assert.equal(valid.country,'US');assert.equal(valid.source,'Referral');checks.validNewCompanySavesTrimmedValues=true;
 const beforeRestart=await snapshot();await stop(backend.child);backend=await startBackend();assert.deepEqual(await snapshot(),beforeRestart);checks.savedResultsSurviveIsolatedServiceRestart=true;
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({testedAt:new Date().toISOString(),app,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),result:'pass',checks},null,2));console.log('PASS: '+Object.keys(checks).length+' R01-R03 isolated browser checks');
}catch(error){if(cdp)await frame('failure').catch(()=>{});fs.writeFileSync(path.join(evidence,'failure.json'),JSON.stringify({result:'fail',error:error.message,passedChecks:checks},null,2));throw error;}
finally{cdp?.close();for(const child of children)await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
