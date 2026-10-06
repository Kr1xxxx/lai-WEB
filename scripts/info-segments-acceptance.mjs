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
const evidence=path.resolve(process.env.LAI_INFO_SEGMENTS_EVIDENCE || 'evidence/ui-1.4.6/info-segments');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-info-segments-'));
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
  socket.addEventListener('message',event=>{const message=JSON.parse(String(event.data));const request=pending.get(message.id);if(!request)return;pending.delete(message.id);if(message.error)request.reject(Error(message.error.message));else request.resolve(message.result);});
  return {call(method,params={}){const id=++sequence;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});},close(){socket.close();}};
}
async function evaluate(expression){const result=await cdp.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;}
async function navigate(){await cdp.call('Page.navigate',{url:backend.base+'/trade-order-system.html?token='+encodeURIComponent(backend.token)+'#customers'});await until(()=>evaluate(`!!document.querySelector('.company-link')`),'customer list');}
async function openEditor(name){
  await evaluate(`(()=>{const link=[...document.querySelectorAll('.company-link')].find(link=>link.dataset.customer===${JSON.stringify(name)}||link.textContent.trim().endsWith(${JSON.stringify(name)}));if(!link)throw Error('Test customer missing');link.click();})()`);
  await until(()=>evaluate(`!!document.querySelector('.lcd-pagebar [data-action="edit"]')`),'detail');
  await evaluate(`document.querySelector('.lcd-pagebar [data-action="edit"]').click()`);
  await until(()=>evaluate(`!!document.querySelector('#customer-form')`),'editor');
}
async function submit(){await evaluate(`document.querySelector('#customer-form').requestSubmit(document.querySelector('[form="customer-form"][value="save"]'))`);await until(()=>evaluate(`!document.querySelector('#customer-form')`),'editor saved');}
async function frame(name){
 await until(()=>evaluate(`!document.querySelector('#toast')?.classList.contains('show')`),'toast finished');
 await evaluate(`Promise.all(document.getAnimations().map(animation=>animation.finished.catch(()=>{})))`);
 await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
 const result=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(evidence,name+'.png'),Buffer.from(result.data,'base64'));}

async function manage(){
 await evaluate(`document.querySelector('[data-action="manage-segments"]').click()`);
 await until(()=>evaluate(`!!document.querySelector('.segment-management')`),'segment management');
}
async function dismiss(){await evaluate(`document.querySelector('.drawer-head [data-action="close-modal"]').click()`);await until(()=>evaluate(`!document.querySelector('.drawer')`),'drawer closed');}
async function editSegment(id){await evaluate(`document.querySelector('[data-edit-segment="${id}"]').click()`);await until(()=>evaluate(`!!document.querySelector('#segment-form')`),'segment editor');}
async function saveSegment(){await evaluate(`document.querySelector('#segment-form').requestSubmit()`);await until(()=>evaluate(`!document.querySelector('#segment-form')`),'segment saved');}
try{
 fs.mkdirSync(evidence,{recursive:true});backend=await startBackend();const initial=await snapshot();
 initial.data.customers={
  'Info Main':{contact:'Main',country:'US',source:'Referral',phoneCountryCode:'+1',phone:'5550101',email:'main@example.test',alternateEmail:'',alternativeEmail:'stale@example.test',backupEmail:'old@example.test',unknown:{keep:true},additionalPhones:[{phoneCountryCode:'+44',phone:'+44 7700 900123'}],extraContacts:[{id:'second',contact:'Second',phoneCountryCode:'+33',phone:'612345678',email:'second@example.test'}]},
  'Info Legacy':{contact:'Legacy',country:'FR',source:'Referral',alternativeEmail:'legacy@example.test',phone:'0033 612345678',phoneCountryCode:'+33'},
 };
 initial.data.orders=[];
 initial.data.previewSegments=[
  {id:'zero',name:'无订单客户',kind:'rules',rules:[{field:'orderCount',op:'eq',value:0}],match:'all',members:[],archived:false},
  {id:'active',name:'Elodie',kind:'manual',members:[],rules:[],match:'all',archived:false},
  {id:'old',name:' Élodie ',kind:'manual',members:['Info Main'],rules:[],match:'all',archived:true,unknown:{keep:true}},
  ...Array.from({length:20},(_,i)=>({id:'long-'+i,name:String(i)+' '+ 'LongCustomerSegment'.repeat(4),kind:'manual',members:i===0?['Info Main']:[],rules:[],match:'all',archived:false})),
 ];
 initial.data.previewTable={order:['name','alternativeEmail'],frozen:['name'],compact:false};
 const seed=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:initial,baseRevision:initial.revision})});assert.equal(seed.status,200);
 const port=await freePort();const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps',`--user-data-dir=${path.join(temporary,'chrome')}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});children.push(browser);
 let target;await until(async()=>{try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item=>item.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'browser');
 cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');
 await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:1022,deviceScaleFactor:1,mobile:false});await navigate();await manage();await editSegment('zero');
 assert.equal(await evaluate(`document.querySelector('[data-rule-prop="value"]').value`),'0','A saved numeric zero must remain visible when editing');
 assert.match(await evaluate(`document.querySelector('#match-preview').textContent`),/2 个客户/);checks.zeroConditionVisibleAndMatches=true;
 await frame('condition-editor');const beforeCancel=await snapshot();
 await evaluate(`document.querySelector('#segment-form').elements.name.value='Unsaved name';document.querySelector('[data-rule-prop="value"]').value='9';document.querySelector('[data-rule-prop="value"]').dispatchEvent(new Event('input',{bubbles:true}))`);await evaluate(`document.querySelector('.drawer-head [data-action="close-modal"]').click()`);await until(()=>evaluate(`!!document.querySelector('.segment-editor-unsaved')`),'segment close decision');await evaluate(`document.querySelector('[data-action="discard-segment-editor"]').click()`);await until(()=>evaluate(`!document.querySelector('.drawer')`),'explicitly discarded segment');
 assert.deepEqual(await snapshot(),beforeCancel);checks.cancelDoesNotSaveSegmentDraft=true;
 await manage();await editSegment('zero');await saveSegment();
 assert.equal((await snapshot()).data.previewSegments.find(s=>s.id==='zero').rules[0].value,'0');checks.zeroConditionSaves=true;
 await manage();const beforeRejected=await snapshot();await evaluate(`document.querySelector('[data-restore-segment="old"]').click()`);
 await until(()=>evaluate(`document.querySelector('#workspace-error')?.classList.contains('visible')`),'duplicate restore error');
 assert.match(await evaluate(`document.querySelector('#workspace-error').textContent`),/同名客群已存在/);assert.deepEqual(await snapshot(),beforeRejected);
 assert.equal(await evaluate(`document.querySelector('[data-restore-segment="old"]').disabled`),false);checks.restoreDuplicateRejectedWithRetry=true;
 await editSegment('active');await evaluate(`document.querySelector('#segment-form').elements.name.value='Other'`);await saveSegment();
 await manage();await evaluate(`document.querySelector('[data-restore-segment="old"]').click()`);
 await until(async()=>!(await snapshot()).data.previewSegments.find(s=>s.id==='old').archived,'restored');
 await until(()=>evaluate(`!!document.querySelector('[data-archive-segment="old"]')`),'management stays open after restore');
 assert.deepEqual((await snapshot()).data.previewSegments.find(s=>s.id==='old').members,['Info Main']);checks.restorePreservesMembersAndKeepsManagementOpen=true;
 await evaluate(`document.querySelector('[data-archive-segment="old"]').click()`);
 await until(()=>evaluate(`!!document.querySelector('[data-restore-segment="old"]')`),'management stays open after archive');
 const archived=await snapshot();assert.deepEqual(archived.data.customers,initial.data.customers);assert.deepEqual(archived.data.orders,[]);checks.archiveDoesNotDeleteCustomers=true;
 await frame('segment-management');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:720,deviceScaleFactor:1,mobile:false});
 const layout=await evaluate(`(()=>{const body=document.querySelector('.drawer-body');body.scrollTop=body.scrollHeight;const rect=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom}};return {bodyScrollable:body.scrollHeight>body.clientHeight,horizontalOverflow:body.scrollWidth>body.clientWidth,buttons:[...document.querySelectorAll('.drawer-footer button')].map(rect),lastAction:rect(document.querySelector('[data-edit-segment="long-19"]'))}})()`);
 assert.equal(layout.bodyScrollable,true);assert.equal(layout.horizontalOverflow,false);assert.ok(layout.buttons.every(r=>r.left>=0&&r.right<=1100&&r.bottom<=720));assert.ok(layout.lastAction.right<=1100);checks.longNamesAndCompactActionsFit=true;await frame('segment-management-compact');await dismiss();
 await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:1022,deviceScaleFactor:1,mobile:false});await navigate();
 const list=await evaluate(`(()=>{const row=[...document.querySelectorAll('.company-link')].find(el=>el.textContent.includes('Info Main')).closest('tr');return row.lastElementChild.previousElementSibling.textContent.trim()})()`);
 assert.equal(list,'—');checks.clearedBackupEmailEmptyInList=true;
 await openEditor('Info Main');assert.equal(await evaluate(`document.querySelector('#customer-form').elements.alternateEmail.value`),'');
 await evaluate(`document.querySelector('#customer-form').elements.note.value='Information page check'`);await submit();
 assert.deepEqual((await snapshot()).data.previewSegments,archived.data.previewSegments,'Editing a note must preserve all segment memberships');checks.noteEditPreservesGroupMemberships=true;
 const detail=await evaluate(`[...document.querySelectorAll('.lcd-contact')].map(el=>el.textContent).join(' ')`);assert.match(detail,/\+1 5550101/);assert.match(detail,/\+33 612345678/);assert.doesNotMatch(detail,/stale@example|old@example|\+44 \+44/);checks.detailPhoneAndClearedEmailConsistent=true;await frame('customer-information');
 await evaluate(`document.querySelector('.lcd-contact').scrollIntoView({block:'center'})`);await frame('customer-contacts');
 await navigate();await openEditor('Info Legacy');assert.equal(await evaluate(`document.querySelector('#customer-form').elements.alternateEmail.value`),'legacy@example.test');
 await evaluate(`document.querySelector('#customer-form').elements.alternateEmail.value=''`);await submit();assert.doesNotMatch(await evaluate(`[...document.querySelectorAll('.lcd-contact')].map(el=>el.textContent).join(' ')`),/legacy@example.test/);checks.legacyBackupEmailCanBeCleared=true;
 const beforeRestart=await snapshot();await stop(backend.child);backend=await startBackend();assert.deepEqual((await snapshot()).data,beforeRestart.data);checks.sqliteRestartPersistence=true;
 await navigate();await manage();await editSegment('zero');assert.equal(await evaluate(`document.querySelector('[data-rule-prop="value"]').value`),'0');await dismiss();
 await navigate();await openEditor('Info Legacy');assert.equal(await evaluate(`document.querySelector('#customer-form').elements.alternateEmail.value`),'');await dismiss();checks.clearedEmailAndZeroStayCorrectAfterRestart=true;
 await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:720,deviceScaleFactor:1,mobile:false});const compactInfo=await evaluate(`(()=>{const root=document.querySelector('.lcd-root');const area=document.querySelector('.customer-main');const rect=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom}};return {root:rect(root),area:rect(area),actions:[...document.querySelectorAll('.lcd-pagebar button')].map(rect),fields:[...document.querySelectorAll('.lcd-info-fields .lcd-field')].map(rect)}})()`);
 assert.ok(compactInfo.root.right<=1100,'Customer information must fit the minimum supported window');
 assert.ok(compactInfo.actions.every(r=>r.left>=0&&r.right<=1100&&r.bottom<=720),'Detail actions must remain visible');
 assert.ok(compactInfo.fields.every(r=>r.right<=1100));checks.compactCustomerInfoAndActionsFit=true;await frame('customer-information-compact');
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({testedAt:new Date().toISOString(),result:'pass',app,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),scope:'Existing customer info and segment settings; disposable SQLite only',checks,layout,compactInfo},null,2));
 console.log('PASS: '+Object.keys(checks).length+' customer-info and segment-settings checks');
}catch(error){if(cdp)await frame('failure').catch(()=>{});throw error;}
finally{cdp?.close();for(const child of children)await stop(child);fs.rmSync(temporary,{recursive:true,force:true});}
