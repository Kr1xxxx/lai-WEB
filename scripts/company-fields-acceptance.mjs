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
const evidence=path.resolve(process.env.LAI_FIELDS_EVIDENCE || 'evidence/ui-1.4.5/company-fields');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-company-'));
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
async function frame(name){const result=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(evidence,name+'.png'),Buffer.from(result.data,'base64'));}

try{
  fs.mkdirSync(evidence,{recursive:true});
  backend=await startBackend();
  const initial=await snapshot();
  initial.data.customers={
    'Fields Derived':{country:'US',source:'Referral',customerCode:'0007',tags:['VIP','VIP'],contact:'Main',email:'main@example.test',phone:'5550101',unknown:{keep:true}},
    'Fields Cleared':{country:'US',source:'Referral',customerStage:'',contact:'Main',email:'cleared@example.test',phone:'5550102'},
    'Fields Manual':{country:'US',source:'Referral',customerStage:'重点跟进',customerCode:'0007',contact:'Main',email:'manual@example.test',phone:'5550103'},
  };
  initial.data.orders=[
    {id:'fields-order',client:'Fields Derived',amount:100,currency:'USD',stage:'done',createdAt:'2026-09-01'},
    {id:'legacy-active-alias',num:'SO-ACTIVE-ALIAS',client:'FIELDS MANUAL',amount:20,currency:'USD',stage:'done',createdAt:'2026-08-01'},
  ];
  initial.data.trashOrders=[
    {id:'archived-only',num:'SO-ARCHIVED',client:'Fields Archived',amount:80,currency:'USD',stage:'done',createdAt:'2026-08-01',trashedAt:'2026-08-02'},
    {id:'legacy-case-alias',num:'SO-ALIAS',client:'FIELDS MANUAL',amount:20,currency:'USD',stage:'done',createdAt:'2026-07-01',trashedAt:'2026-07-02'},
  ];
  initial.data.previewSegments=[{id:'fields-group',name:'Test Group',kind:'manual',members:['Fields Derived'],rules:[],match:'all',archived:false}];
  initial.data.previewTable={order:['name','country','source','customerCode','stage','tags'],frozen:['name'],compact:false};
  const seed=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:initial,baseRevision:initial.revision})});
  assert.equal(seed.status,200);
  const port=await freePort();
  const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps',`--user-data-dir=${path.join(temporary,'chrome')}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});children.push(browser);
  let target;await until(async()=>{try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item=>item.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'headless browser');
  cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');
  await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:1022,deviceScaleFactor:1,mobile:false});
  await navigate();
  checks.importRemainsOff=await evaluate(`!document.querySelector('[data-action="import-customers"]')`);assert.equal(checks.importRemainsOff,true);
  await openEditor('Fields Derived');
  const beforeStage=await evaluate(`document.querySelector('#customer-form').elements.customerStage.value`);assert.equal(beforeStage,'已成交');
  await frame('editor-before-save');
  await evaluate(`document.querySelector('#customer-form').elements.note.value='Only this note changed'`);await submit();
  const afterNote=await snapshot();
  assert.equal(Object.hasOwn(afterNote.data.customers['Fields Derived'],'customerStage'),false,'Editing a note must not convert the derived stage into a manual stage');
  assert.equal(afterNote.data.customers['Fields Derived'].note,'Only this note changed');
  assert.equal(afterNote.data.customers['Fields Derived'].customerCode,'0007');
  assert.deepEqual(afterNote.data.customers['Fields Derived'].tags,['VIP','VIP']);
  assert.deepEqual(afterNote.data.customers['Fields Derived'].unknown,{keep:true});
  checks.unchangedDerivedStageRemainsDerived=true;
  await navigate();await openEditor('Fields Cleared');await evaluate(`document.querySelector('#customer-form').elements.note.value='Keep the explicit empty stage'`);await submit();
  assert.equal((await snapshot()).data.customers['Fields Cleared'].customerStage,'');checks.unchangedEmptyStageRemainsEmpty=true;
  await navigate();await openEditor('Fields Manual');await evaluate(`document.querySelector('#customer-form').elements.note.value='Keep the manual stage'`);await submit();
  const manualAfterNote=(await snapshot()).data.customers['Fields Manual'];
  assert.equal(manualAfterNote.customerStage,'重点跟进');assert.equal(manualAfterNote.note,'Keep the manual stage');
  assert.equal((await snapshot()).data.orders.find(order=>order.id==='legacy-active-alias').client,'FIELDS MANUAL');
  checks.unchangedManualStagePreserved=true;checks.legacyArchivedCaseAliasDoesNotBlockUnchangedEdit=true;checks.legacyActiveCaseAliasDoesNotBlockUnchangedEdit=true;
  await evaluate(`document.querySelector('.lcd-pagebar [data-action="edit"]').click()`);
  await evaluate(`(()=>{const form=document.querySelector('#customer-form');form.elements.customerStage.value='';form.elements.source.value='New local channel';form.elements.tags.value='VIP，VIP, Prospect';form.elements.customerCode.value='0009';})()`);await submit();
  const cleared=(await snapshot()).data.customers['Fields Manual'];
  assert.equal(cleared.customerStage,'');assert.equal(cleared.source,'New local channel');assert.deepEqual(cleared.tags,['VIP','VIP','Prospect']);assert.equal(cleared.customerCode,'0009');
  checks.explicitClearAndCurrentInputRules=true;
  await evaluate(`document.querySelector('.lcd-pagebar [data-action="edit"]').click()`);
  await evaluate(`document.querySelector('#customer-form').elements.customerStage.value='已完成'`);await submit();assert.equal((await snapshot()).data.customers['Fields Manual'].customerStage,'已完成');checks.changedManualStageSaved=true;
  await navigate();await openEditor('Fields Derived');
  await evaluate(`document.querySelector('#customer-form').elements.name.value='Fields Renamed'`);await submit();
  const renamed=(await snapshot()).data;assert.equal(renamed.customers['Fields Derived'],undefined);assert.equal(renamed.orders[0].client,'Fields Renamed');assert.deepEqual(renamed.previewSegments[0].members,['Fields Renamed']);assert.equal(Object.hasOwn(renamed.customers['Fields Renamed'],'customerStage'),false);checks.renameKeepsLinksAndDerivedStage=true;
  const beforeCancel=await snapshot();await evaluate(`document.querySelector('.lcd-pagebar [data-action="edit"]').click()`);await evaluate(`document.querySelector('#customer-form').elements.source.value='Unsaved channel';document.querySelector('.ce-footer [data-action="close-modal"]').click()`);
  await until(()=>evaluate(`!document.querySelector('#customer-form')`),'cancelled');assert.deepEqual(await snapshot(),beforeCancel);checks.cancelDoesNotSave=true;
  await navigate();await evaluate(`document.querySelector('[data-action="new"]').click()`);
  const required=await evaluate(`(()=>{const form=document.querySelector('#customer-form');return Object.fromEntries(['name','country','source','contact','email','phone'].map(key=>[key,form.elements[key].required]));})()`);
  assert.deepEqual(required,{name:true,country:true,source:true,contact:true,email:true,phone:true});
  const validation=await evaluate(`(()=>{const form=document.querySelector('#customer-form');form.elements.name.value='Fields New';form.elements.country.value='US';form.elements.contact.value='New';form.elements.email.value='new@example.test';form.elements.phone.value='5550104';return {valid:form.checkValidity(),missing:form.elements.source.validity.valueMissing};})()`);
  assert.deepEqual(validation,{valid:false,missing:true});
  const beforeInvalid=(await snapshot()).revision;await evaluate(`document.querySelector('#customer-form').requestSubmit(document.querySelector('[form="customer-form"][value="save"]'))`);assert.equal((await snapshot()).revision,beforeInvalid);checks.newRequiredFieldsPreserved=true;
  await evaluate(`(()=>{const form=document.querySelector('#customer-form');form.elements.source.value='New channel';form.elements.customerCode.value='0007';form.elements.tags.value='New，Local';})()`);await submit();
  const created=(await snapshot()).data.customers['Fields New'];assert.equal(created.customerCode,'0007');assert.equal(created.source,'New channel');assert.deepEqual(created.tags,['New','Local']);assert.equal(created.customerStage,'');checks.newCustomerCurrentRulesSaved=true;
  await openEditor('Fields New');
  const beforeDuplicate=await snapshot();
  await evaluate(`(()=>{const form=document.querySelector('#customer-form');form.elements.name.value=' fields manual ';form.elements.source.value='Keep this retry draft';form.requestSubmit(document.querySelector('[form="customer-form"][value="save"]'));})()`);
  await until(()=>evaluate(`document.querySelector('#form-error')?.classList.contains('visible')`),'duplicate-name error');
  assert.deepEqual(await snapshot(),beforeDuplicate,'Rejected duplicate must not write either customer');
  const rejectedDraft=await evaluate(`(()=>{const form=document.querySelector('#customer-form');return {error:form.querySelector('#form-error').textContent,name:form.elements.name.value,source:form.elements.source.value,saveEnabled:!document.querySelector('[form="customer-form"][value="save"]').disabled};})()`);
  assert.match(rejectedDraft.error,/已存在/);assert.equal(rejectedDraft.name,' fields manual ');assert.equal(rejectedDraft.source,'Keep this retry draft');assert.equal(rejectedDraft.saveEnabled,true);checks.duplicateNameKeepsDraftAndData=true;
  await evaluate(`document.querySelector('#customer-form').elements.name.value='Fields New'`);await submit();
  assert.equal((await snapshot()).data.customers['Fields New'].source,'Keep this retry draft');checks.duplicateErrorCanBeCorrected=true;
  await evaluate(`document.querySelector('.lcd-pagebar [data-action="edit"]').click()`);
  await until(()=>evaluate(`!!document.querySelector('#customer-form')`),'archived-name editor');
  const beforeArchivedCollision=await snapshot();
  await evaluate(`(()=>{const form=document.querySelector('#customer-form');form.elements.name.value='Fields Archived';form.elements.source.value='Keep archived-name retry draft';form.requestSubmit(document.querySelector('[form="customer-form"][value="save"]'));})()`);
  await until(()=>evaluate(`document.querySelector('#form-error')?.classList.contains('visible')`),'archived-name error');
  const archivedDraft=await evaluate(`(()=>{const form=document.querySelector('#customer-form');return {error:form.querySelector('#form-error').textContent,name:form.elements.name.value,source:form.elements.source.value};})()`);
  assert.match(archivedDraft.error,/已存在/);assert.equal(archivedDraft.name,'Fields Archived');assert.equal(archivedDraft.source,'Keep archived-name retry draft');
  assert.deepEqual(await snapshot(),beforeArchivedCollision,'Rejected archived-name collision must not write customer or order data');
  checks.archivedOrderNameRejectedWithoutWrite=true;
  await evaluate(`document.querySelector('.ce-footer [data-action="close-modal"]').click()`);
  await until(()=>evaluate(`!document.querySelector('#customer-form')`),'archived-name editor cancelled');
  await evaluate(`document.querySelector('.lcd-pagebar [data-action="edit"]').click()`);
  await evaluate(`(()=>{const form=document.querySelector('#customer-form');for(const key of ['country','source','customerCode','tags'])form.elements[key].value='';})()`);await submit();
  const emptyCompany=(await snapshot()).data.customers['Fields New'];
  assert.equal(emptyCompany.country,'');assert.equal(emptyCompany.source,'');assert.equal(emptyCompany.customerCode,'');assert.deepEqual(emptyCompany.tags,[]);checks.existingCompanyFieldsCanBeCleared=true;
  await navigate();
  const emptyList=await evaluate(`(()=>{const row=document.querySelector('.company-link[data-open="Fields New"]').closest('tr');return [...row.cells].slice(2,7).map(cell=>cell.textContent.trim());})()`);
  assert.deepEqual(emptyList,['—','—','—','未成交','—']);checks.listShowsClearedValues=true;
  await frame('company-list');
  const beforeRestart=await snapshot();await stop(backend.child);backend=await startBackend();assert.deepEqual((await snapshot()).data,beforeRestart.data);checks.sqliteRestartPersistence=true;
  await navigate();await openEditor('Fields New');
  const emptyAfterRestart=await evaluate(`(()=>{const form=document.querySelector('#customer-form');return Object.fromEntries(['country','source','customerCode','tags'].map(key=>[key,form.elements[key].value]));})()`);
  assert.deepEqual(emptyAfterRestart,{country:'',source:'',customerCode:'',tags:''});checks.clearedValuesStayEmptyInEditorAfterRestart=true;
  await navigate();await openEditor('Fields Renamed');assert.equal(await evaluate(`document.querySelector('#customer-form').elements.customerStage.value`),'已成交');
  await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:720,deviceScaleFactor:1,mobile:false});await frame('editor-compact');
  const layout=await evaluate(`(()=>{const drawer=document.querySelector('.drawer').getBoundingClientRect();const save=document.querySelector('[form="customer-form"][value="save"]').getBoundingClientRect();return {drawerWidth:drawer.width,saveRight:save.right,saveBottom:save.bottom};})()`);assert.ok(layout.saveRight<=1100&&layout.saveBottom<=720);checks.compactSaveVisible=true;
  fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({testedAt:new Date().toISOString(),result:'pass',app,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),scope:'Company fields only; disposable SQLite; no production data or system settings',checks,layout},null,2));
  console.log('PASS: '+Object.keys(checks).length+' company field checks, real editor submissions and SQLite restart');
}catch(error){if(cdp)await frame('failure').catch(()=>{});throw error;}
finally{cdp?.close();for(const child of children)await stop(child);fs.rmSync(temporary,{recursive:true,force:true});}
