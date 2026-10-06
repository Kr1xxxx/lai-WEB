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
const evidence=path.resolve(process.env.LAI_CUSTOMER_DATE_EVIDENCE || 'evidence/ui-1.4.97/customer-dates');
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

const fixtures=[
 {name:'Date Standard',type:'date',birthday:'1990-01-02',nextFollow:'2026-10-12',extra:'1991-02-03'},
 {name:'Date ISO',type:'text',birthday:'1990-01-02T00:00:00Z',nextFollow:'2026-10-12T12:00:00Z',extra:'1991-02-03T09:00:00+01:00'},
 {name:'Date Slash',type:'text',birthday:'1990/01/02',nextFollow:'2026/10/12',extra:'1991/02/03'},
 {name:'Date Lines',type:'text',birthday:'1990\n-01-02',nextFollow:'2026\r\n-10-12',extra:'1991\r-02-03'},
 {name:'Date Space',type:'text',birthday:' 1990-01-02 ',nextFollow:'\t2026-10-12\t',extra:' 1991-02-03 '},
 {name:'Date Invalid',type:'text',birthday:'1990-02-30',nextFollow:'2026-13-01',extra:'0000-02-03'},
];
const observations=[];
const profile=f=>({country:'US',source:'Synthetic',companyRemark:'Initial',contact:'Main',email:'main@example.test',phone:'555',birthday:f.birthday,nextFollow:f.nextFollow,
 extraContacts:[{contact:'First Extra',email:'first@example.test',birthday:f.extra,historicalReference:'FIRST-ONLY'},
 {id:'stable-second',contact:'Second Extra',birthday:'1992-03-04',contactTitle:'Buyer',historicalReference:'SECOND-ONLY'}]});
async function dates(){return evaluate(`(()=>{const f=document.querySelector('#customer-form'),cards=[...f.querySelectorAll('[data-contact-card]')];const read=e=>({type:e.type,value:e.value,attribute:e.getAttribute('value')});return{birthday:read(f.querySelector('[name="birthday"]')),nextFollow:read(f.querySelector('[name="nextFollow"]')),extras:cards.slice(1).map(c=>read(c.querySelector('[name="birthdayExtra"]')))}})()`);}
async function setValues(values){await evaluate(`(()=>{for(const [selector,value] of ${JSON.stringify(Object.entries(values))}){const el=document.querySelector(selector);if(!el)throw Error('Fixture control missing: '+selector);el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));}})()`);}
function checkOriginalDates(actual,f){assert.equal(actual.birthday,f.birthday);assert.equal(actual.nextFollow,f.nextFollow);assert.equal(actual.extraContacts[0].birthday,f.extra);assert.equal(actual.extraContacts[0].historicalReference,'FIRST-ONLY');assert.equal(actual.extraContacts[1].birthday,'1992-03-04');assert.equal(actual.extraContacts[1].historicalReference,'SECOND-ONLY');assert.equal(actual.extraContacts[1].contactTitle,'Buyer');}
async function cancelUntouched(){await pointerClick('.drawer-head [data-action="close-modal"]');await until(()=>evaluate(`!document.querySelector('.overlay')`),'untouched cancel');}
async function revealAndClick(selector){await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);await pointerClick(selector);}
try{
 fs.mkdirSync(evidence,{recursive:true});assert.equal(fs.existsSync(path.join(resources,'trade-order-data.json')),false,'No production seed in test app');
 backend=await startBackend();const initial=await snapshot();assert.equal(Object.keys(initial.data.customers||{}).length,0);
 initial.data.customers=Object.fromEntries(fixtures.map(f=>[f.name,profile(f)]));initial.data.orders=[];
 initial.data.customers['Date Mixed']={...profile(fixtures[1]),extraContacts:[
  {id:'removed',contact:'Removed',birthday:'1991/02/03',historicalReference:'REMOVED-ONLY'},
  {contact:'Retained',birthday:'1992-03-04T00:00:00Z',historicalReference:'RETAINED-ONLY'},
  {id:'stable-third',contact:'Stable',birthday:'1993-04-05',historicalReference:'STABLE-ONLY'}]};
 initial.data.customers['Date Failure']=profile(fixtures[3]);
 const seeded=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:initial,baseRevision:initial.revision})});assert.equal(seeded.status,200);
 const port=await freePort();const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps',`--user-data-dir=${path.join(temporary,'chrome')}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});children.push(browser);
 let target;await until(async()=>{try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item=>item.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'browser');cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:1022,deviceScaleFactor:2,mobile:false});
 for(const f of fixtures){
  const before=await snapshot();await openEditor(f.name);const displayed=await dates();
  assert.equal(displayed.birthday.type,f.type);assert.equal(displayed.nextFollow.type,f.type);assert.equal(displayed.extras[0].type,f.type);assert.equal(displayed.extras[1].type,'date');
  assert.equal(displayed.birthday.value,f.birthday.replace(/[\r\n]/g,''));assert.equal(displayed.nextFollow.value,f.nextFollow.replace(/[\r\n]/g,''));assert.equal(displayed.extras[0].value,f.extra.replace(/[\r\n]/g,''));checks[f.name+'-oldDatesRemainVisible']=true;
  await cancelUntouched();assert.deepEqual(await snapshot(),before);checks[f.name+'-cancelDoesNotPersistDateOrIdentity']=true;
  await openEditor(f.name);await setValues({'#customer-form [name="companyRemark"]':'Company only '+f.name});await save();checkOriginalDates((await snapshot()).data.customers[f.name],f);checks[f.name+'-companyOnlySavePreservesRawDatesAndMetadata']=true;
  await openEditor(f.name);const originals=await dates();await setValues({'#customer-form [name="birthday"]':'2001-04-05','#customer-form [name="nextFollow"]':'2027-01-08','[data-contact-card="1"] [name="birthdayExtra"]':'2002-05-06'});
  await setValues({'#customer-form [name="birthday"]':originals.birthday.value,'#customer-form [name="nextFollow"]':originals.nextFollow.value,'[data-contact-card="1"] [name="birthdayExtra"]':originals.extras[0].value,'#customer-form [name="companyRemark"]':'Restored dates '+f.name});await save();checkOriginalDates((await snapshot()).data.customers[f.name],f);checks[f.name+'-restoredDisplayPreservesOriginalRawValue']=true;
  await openEditor(f.name);await setValues({'#customer-form [name="birthday"]':'2001-04-05','#customer-form [name="nextFollow"]':'2027-01-08','[data-contact-card="1"] [name="birthdayExtra"]':'2002-05-06'});await save();
  const changed=(await snapshot()).data.customers[f.name];assert.equal(changed.birthday,'2001-04-05');assert.equal(changed.nextFollow,'2027-01-08');assert.equal(changed.extraContacts[0].birthday,'2002-05-06');assert.equal(changed.extraContacts[1].birthday,'1992-03-04');assert.equal(changed.extraContacts[0].historicalReference,'FIRST-ONLY');checks[f.name+'-intentionalDateChangesSave']=true;
  await openEditor(f.name);const standard=await dates();assert.equal(standard.birthday.type,'date');assert.equal(standard.nextFollow.type,'date');assert.equal(standard.extras[0].type,'date');
  await setValues({'#customer-form [name="birthday"]':'','#customer-form [name="nextFollow"]':'','[data-contact-card="1"] [name="birthdayExtra"]':''});await save();
  const cleared=(await snapshot()).data.customers[f.name];assert.equal(cleared.birthday,'');assert.equal(cleared.nextFollow,'');assert.equal(cleared.extraContacts[0].birthday,'');assert.equal(cleared.extraContacts[1].birthday,'1992-03-04');checks[f.name+'-reopenCalendarAndExplicitClearWork']=true;
  observations.push({name:f.name,initialDisplay:displayed,afterClear:cleared});
 }
 await openEditor('Date Mixed');await revealAndClick('[data-contact-card="1"] [data-editor-action="remove-contact"]');await revealAndClick('[data-editor-action="add-contact"]');
 await setValues({'[data-contact-card="3"] [name="contactExtra"]':'New Contact','[data-contact-card="3"] [name="emailExtra"]':'new@example.test','[data-contact-card="3"] [name="phoneExtra"]':'777','[data-contact-card="3"] [name="birthdayExtra"]':'2004-06-07'});await save();
 const mixed=(await snapshot()).data.customers['Date Mixed'];assert.equal(mixed.birthday,fixtures[1].birthday);assert.equal(mixed.nextFollow,fixtures[1].nextFollow);
 assert.deepEqual(mixed.extraContacts.map(c=>c.birthday),['1992-03-04T00:00:00Z','1993-04-05','2004-06-07']);assert.deepEqual(mixed.extraContacts.map(c=>c.historicalReference),['RETAINED-ONLY','STABLE-ONLY',undefined]);assert.equal(new Set(mixed.extraContacts.map(c=>c.id)).size,3);checks.deleteAndAddKeepsDatesWithTheCorrectContact=true;
 await openEditor('Date Failure');const failureBaseline=await snapshot();await setValues({'#customer-form [name="name"]':'Date Standard','#customer-form [name="birthday"]':'2005-07-08'});await pointerClick('[form="customer-form"][value="save"]');await until(()=>evaluate(`!!document.querySelector('#form-error')?.textContent.trim()`),'duplicate save rejected');
 assert.deepEqual(await snapshot(),failureBaseline);assert.equal((await dates()).birthday.value,'2005-07-08');checks.failedSaveKeepsDateDraftAndDatabase=true;
 await setValues({'#customer-form [name="name"]':'Date Failure'});await save();const retried=(await snapshot()).data.customers['Date Failure'];assert.equal(retried.birthday,'2005-07-08');assert.equal(retried.nextFollow,fixtures[3].nextFollow);assert.equal(retried.extraContacts[0].birthday,fixtures[3].extra);checks.retrySavesChangedDateAndPreservesUntouchedDates=true;
 const beforeDiscard=await snapshot();await openEditor('Date Failure');await setValues({'#customer-form [name="birthday"]':'2006-08-09'});await pointerClick('.drawer-head [data-action="close-modal"]');await prompt();await discard();assert.deepEqual(await snapshot(),beforeDiscard);checks.dateDraftDiscardDoesNotSave=true;
 await navigate();await openNew();assert.deepEqual(await evaluate(`([...document.querySelectorAll('#customer-form [name="birthday"],#customer-form [name="nextFollow"]')].map(el=>({type:el.type,value:el.value})))`),[{type:'date',value:''},{type:'date',value:''}]);
 await setValues({'#customer-form [name="name"]':'Date New','#customer-form [name="country"]':'US','#customer-form [name="source"]':'Synthetic','#customer-form [name="contact"]':'New Main','#customer-form [name="email"]':'newmain@example.test','#customer-form [name="phone"]':'888','#customer-form [name="birthday"]':'2000-02-29','#customer-form [name="nextFollow"]':'2027-07-08'});await save();const fresh=(await snapshot()).data.customers['Date New'];assert.equal(fresh.birthday,'2000-02-29');assert.equal(fresh.nextFollow,'2027-07-08');checks.newCustomerCalendarSubmissionUnchanged=true;
 await openEditor('Date Mixed');await evaluate(`(()=>{const d=document.querySelector('.ce-contact-extra');d.open=true;d.scrollIntoView({block:'center',behavior:'instant'});})()`);await frame('legacy-date-visible');await cancelUntouched();
 const beforeRestart=await snapshot();await stop(backend.child);backend=await startBackend();assert.deepEqual(await snapshot(),beforeRestart);checks.restartPreservesOnlyIntentionalDateChanges=true;
 const result={at:new Date().toISOString(),version:'1.4.97',status:'pass',htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),checkCount:Object.keys(checks).length,checks,observations,actualLaiAppLaunched:false,scope:'Existing editor dates and actual isolated persistence; not source/native/pixel acceptance'};
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({status:'pass',checks:result.checkCount,htmlSha256:result.htmlSha256}));
}catch(error){fs.writeFileSync(path.join(evidence,'failure.json'),JSON.stringify({message:error.message,checks,observations},null,2));console.error(error.message);process.exitCode=1;}
finally{cdp?.close();for(const child of children)await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
