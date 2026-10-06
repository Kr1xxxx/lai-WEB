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
const evidence=path.resolve(process.env.LAI_SEGMENT_NUMBER_EVIDENCE || 'evidence/ui-1.4.96/segment-numbers');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-segment-number-'));
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
 const point=await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:"nearest",inline:"nearest"});const r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);if(!r.width||!r.height||!(el.contains(hit)||hit?.contains(el)))throw Error('Pointer target is hidden or covered: '+${JSON.stringify(selector)}+' '+JSON.stringify({x,y,rect:r.toJSON(),hit:hit?.className,overlay:el.closest('.overlay')?.className,animations:document.getAnimations().map(a=>({state:a.playState,time:a.currentTime,target:a.effect.target.className}))}));return {x,y}})()`);
 await cdp.call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
 await cdp.call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
}

async function settle(){await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);await until(()=>evaluate(`!document.getAnimations().some(a=>a.playState==='running'&&a.effect.getTiming().iterations!==Infinity)`),'drawer settled');}
async function fill(selector,value){await pointerClick(selector);await evaluate(`document.querySelector(${JSON.stringify(selector)}).select()`);await cdp.call('Input.insertText',{text:value});}
async function manage(){await navigate();await pointerClick('.group-settings[data-action="manage-segments"]');await until(()=>evaluate(`!!document.querySelector('.segment-management')`),'management');await settle();}
async function openNew(kind='rules'){await manage();await pointerClick('.drawer-footer [data-action="'+(kind==='manual'?'new-manual':'new-segment')+'"]');await until(()=>evaluate(`!!document.querySelector('#segment-form')`),'segment editor');await settle();}
async function edit(id){await manage();await pointerClick('[data-edit-segment="'+id+'"]');await until(()=>evaluate(`!!document.querySelector('#segment-form')`),'edit');await settle();}
async function decision(){await until(()=>evaluate(`!!document.querySelector('.segment-editor-unsaved')||!document.querySelector('#segment-form')`),'close decision');assert.equal(await evaluate(`!!document.querySelector('.segment-editor-unsaved')`),true,'Segment draft must be retained behind close/continue decision');assert.ok(await evaluate(`!!document.querySelector('#segment-form')`));}
async function discard(){await pointerClick('[data-action="discard-segment-editor"]');await until(()=>evaluate(`!document.querySelector('.overlay')`),'discard');}
async function keep(){await pointerClick('[data-action="continue-segment-editor"]');assert.equal(await evaluate(`!!document.querySelector('.segment-editor-unsaved')`),false);}
async function cancel(){await pointerClick('.drawer-footer [data-action="close-modal"]');}
async function closed(){await until(()=>evaluate(`!document.querySelector('.overlay')`),'closed without false warning');}
async function select(selector,value){await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}));})()`);await settle();}
async function save(){await pointerClick('[form="segment-form"]');}
const name='#segment-form [name="name"]',value='#segment-form [data-rule="0"] [data-rule-prop="value"]';
async function inputValue(text){await evaluate(`(()=>{const el=document.querySelector('#segment-form [data-rule="0"] [data-rule-prop="value"]');el.value=${JSON.stringify(text)};el.dispatchEvent(new Event('input',{bubbles:true}));})()`);}
async function escape(){await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});}
async function cleanClose(){await until(()=>evaluate(`!!document.querySelector('.segment-editor-unsaved')||!document.querySelector('#segment-form')`),'untouched close outcome');assert.equal(await evaluate(`!!document.querySelector('.segment-editor-unsaved')`),false,'Model-accepted date must not produce an untouched close warning');await closed();}

const {createRequire}=await import('node:module');const S=createRequire(import.meta.url)('../src/segments.js');
const fixtures=[['days-quarter','lastFollowup','olderDays',0.25,1],['amount-fraction','total','gte',1.25,1.75],['average-fraction','average','gte',1.25,1.75],['days-integer','lastFollowup','olderDays',15,15.5],['amount-integer','total','gte',2,2.5]];
async function numericSave(){await save();await until(()=>evaluate(`!document.querySelector('#segment-form')||!!document.querySelector('#segment-form :invalid')`),'numeric save outcome');const invalid=await evaluate(`(()=>{const i=document.querySelector('#segment-form [data-rule-prop="value"]');return i?{value:i.value,stepMismatch:i.validity.stepMismatch}:null})()`);assert.equal(await evaluate(`!!document.querySelector('#segment-form')`),false,'Model-accepted number must save; current input='+JSON.stringify(invalid));await closed();}
async function rejected(){await save();await until(()=>evaluate(`!!document.querySelector('#workspace-error')?.textContent.trim()`),'model validation feedback');assert.ok(await evaluate(`!!document.querySelector('#segment-form')`));}
async function rule(id){return (await snapshot()).data.previewSegments.find(s=>s.id===id);}
try{
 fs.mkdirSync(evidence,{recursive:true});backend=await startBackend();const initial=await snapshot();const now=Date.now();initial.data.customers={Alpha:{country:'US',source:'Referral',lastFollowup:new Date(now-2*86400000).toISOString()},Beta:{country:'US',source:'Referral',lastFollowup:new Date(now-0.1*86400000).toISOString()}};initial.data.orders=[{id:'synthetic-alpha',client:'Alpha',amount:2.5,currency:'USD',stage:'done',createdAt:new Date(now).toISOString()},{id:'synthetic-beta',client:'Beta',amount:0.25,currency:'USD',stage:'done',createdAt:new Date(now).toISOString()}];initial.data.previewSegments=fixtures.map(([id,field,op,raw,edited])=>{S.upsertSegment({previewSegments:[]},id,{name:'Model',kind:'rules',rules:[{field,op,value:edited}]});return {id,name:'Numeric '+id,kind:'rules',match:'all',rules:[{field,op,value:raw,unknown:{keep:id}}],members:[],archived:false};});
 const seeded=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:initial,baseRevision:initial.revision})});assert.equal(seeded.status,200);
 const port=await freePort();const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps',`--user-data-dir=${path.join(temporary,'chrome')}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});children.push(browser);let target;await until(async()=>{try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item=>item.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'browser');cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1728,height:902,deviceScaleFactor:1,mobile:false});

 for(const [id,field,op,raw,edited] of fixtures){
  let before=await snapshot();await edit(id);await cancel();await cleanClose();assert.deepEqual(await snapshot(),before);checks[id+'UneditedCancelDoesNotWrite']=true;
  await edit(id);await fill(name,'Name Only '+id);await numericSave();let saved=await rule(id);assert.equal(Number(saved.rules[0].value),raw);assert.deepEqual(saved.rules[0].unknown,{keep:id});checks[id+'UneditedFractionNameOnlySaveControl']=true;
  await edit(id);await inputValue(String(edited));await numericSave();saved=await rule(id);assert.equal(Number(saved.rules[0].value),edited);assert.equal(saved.rules[0].field,field);assert.equal(saved.rules[0].op,op);assert.deepEqual(saved.rules[0].unknown,{keep:id});checks[id+'AcceptedIntegerOrFractionEditSaves']=true;
  await edit(id);await inputValue(String(raw));await pointerClick('[data-action="add-rule"]');await settle();await pointerClick('[data-remove-rule="1"]');await settle();await numericSave();saved=await rule(id);assert.equal(Number(saved.rules[0].value),raw);assert.deepEqual(saved.rules[0].unknown,{keep:id});checks[id+'FractionRestoreAfterRedrawSaves']=true;
  before=await snapshot();await edit(id);await inputValue('');await rejected();assert.deepEqual(await snapshot(),before);assert.equal(await evaluate(`document.querySelector('#segment-form [data-rule-prop="value"]').value`),'');checks[id+'EmptyRejectedAndDraftRetained']=true;
  await inputValue(String(edited));await numericSave();assert.equal(Number((await rule(id)).rules[0].value),edited);checks[id+'ValidRetryAfterEmptySaves']=true;
 }
 for(const [field,op] of [['total','gte'],['average','gte'],['lastFollowup','olderDays']]){
  await openNew();await fill(name,'New Fraction '+field);await select('#segment-form [data-rule="0"] [data-rule-prop="field"]',field);await select('#segment-form [data-rule="0"] [data-rule-prop="op"]',op);await inputValue('0.25');await numericSave();let saved=(await snapshot()).data.previewSegments.find(s=>s.name==='New Fraction '+field);assert.equal(saved.rules.length,1);assert.equal(Number(saved.rules[0].value),0.25);assert.equal(saved.rules[0].field,field);assert.equal(saved.rules[0].op,op);checks[field+'NewFractionRuleSaves']=true;
  await edit(saved.id);await inputValue('0.75');await pointerClick('[data-action="add-rule"]');await settle();await pointerClick('[data-remove-rule="1"]');await settle();await inputValue('0.25');await numericSave();saved=await rule(saved.id);assert.equal(Number(saved.rules[0].value),0.25);checks[field+'NewRuleFractionRestoreSaves']=true;
 }
 const days=(await snapshot()).data.previewSegments.find(s=>s.name==='New Fraction lastFollowup');const beforeNegative=await snapshot();await edit(days.id);await inputValue('-1');await rejected();assert.deepEqual(await snapshot(),beforeNegative);assert.equal(await evaluate(`document.querySelector('#segment-form [data-rule-prop="value"]').value`),'-1');checks.negativeDaysRejectedWithoutWriting=true;await inputValue('2.5');await numericSave();assert.equal(Number((await rule(days.id)).rules[0].value),2.5);checks.positiveDaysRetryAfterNegativeSaves=true;
 for(const [field,raw,expected] of [['total',1.75,['Alpha']],['average',1.75,['Alpha']],['lastFollowup',0.75,['Alpha']],['total',0.25,['Alpha','Beta']],['average',0.25,['Alpha','Beta']],['lastFollowup',0.25,['Alpha']]]){
  const before=await snapshot();await navigate();await pointerClick('[data-action="filter"]');await until(()=>evaluate(`!!document.querySelector('#filter-form')`),'filter');await settle();await pointerClick('[data-filter-mode="advanced"]');await settle();await select('#filter-form [data-advanced-rule="0"] [data-advanced-prop="field"]',field);await select('#filter-form [data-advanced-rule="0"] [data-advanced-prop="op"]',field==='lastFollowup'?'olderDays':'gte');await evaluate(`(()=>{const i=document.querySelector('#filter-form [data-advanced-prop="value"]');i.value=${JSON.stringify(String(raw))};i.dispatchEvent(new Event('input',{bubbles:true}));})()`);await pointerClick('[form="filter-form"]');await until(()=>evaluate(`!document.querySelector('#filter-form')||!!document.querySelector('#filter-form :invalid')`),'fraction filter applied');assert.equal(await evaluate(`!!document.querySelector('#filter-form')`),false,'Fractional advanced filter must apply');await closed();const actual=await evaluate(`Array.from(document.querySelectorAll('.company-link[data-open]')).map(b=>b.dataset.open).sort()`);assert.deepEqual(actual,expected);assert.deepEqual(await snapshot(),before);checks[field+'AdvancedFraction'+raw+'FiltersWithoutWriting']=true;
 }

 const filterBefore=await snapshot();await navigate();await pointerClick('[data-action="filter"]');await until(()=>evaluate(`!!document.querySelector('#filter-form')`),'operator filter');await settle();await pointerClick('[data-filter-mode="advanced"]');await settle();await select('#filter-form [data-advanced-prop="field"]','lastFollowup');
 await evaluate(`(()=>{const form=document.querySelector('#filter-form');window.__numberProbeValue=form.querySelector('[data-advanced-prop="value"]');window.__numberProbeScroll=form.scrollTop;window.__numberProbeValue.focus();})()`);await select('#filter-form [data-advanced-prop="op"]','olderDays');
 assert.deepEqual(await evaluate(`(()=>{const i=document.querySelector('#filter-form [data-advanced-prop="value"]');return {same:i===window.__numberProbeValue,connected:window.__numberProbeValue.isConnected,type:i.type,focused:document.activeElement===i,scrollSame:document.querySelector('#filter-form').scrollTop===window.__numberProbeScroll}})()`),{same:true,connected:true,type:'number',focused:true,scrollSame:true});checks.operatorSwitchUsesNumberWithoutRemountOrFocusJump=true;
 await select('#filter-form [data-advanced-prop="op"]','before');assert.equal(await evaluate(`document.querySelector('#filter-form [data-advanced-prop="value"]').type`),'date');assert.equal(await evaluate(`document.querySelector('#filter-form [data-advanced-prop="value"]').hasAttribute('step')`),false);checks.operatorReturnRestoresNativeDate=true;
 await select('#filter-form [data-advanced-prop="op"]','empty');assert.equal(await evaluate(`document.querySelector('#filter-form [data-advanced-prop="value"]').disabled`),true);await select('#filter-form [data-advanced-prop="op"]','notEmpty');assert.equal(await evaluate(`document.querySelector('#filter-form [data-advanced-prop="value"]').disabled`),true);await select('#filter-form [data-advanced-prop="op"]','olderDays');assert.equal(await evaluate(`document.querySelector('#filter-form [data-advanced-prop="value"]').disabled`),false);checks.emptyOperatorsDisableAndRestoreInput=true;
 await evaluate(`(()=>{const i=document.querySelector('#filter-form [data-advanced-prop="value"]');i.value='-1';i.dispatchEvent(new Event('input',{bubbles:true}));})()`);await pointerClick('[form="filter-form"]');await until(()=>evaluate(`!!document.querySelector('#filter-error')?.textContent.trim()`),'negative days filter error');assert.deepEqual(await snapshot(),filterBefore);assert.equal(await evaluate(`document.querySelector('#filter-form [data-advanced-prop="value"]').value`),'-1');checks.negativeAdvancedDaysRejectedAndDraftRetained=true;
 await evaluate(`(()=>{const i=document.querySelector('#filter-form [data-advanced-prop="value"]');i.value='0.75';i.dispatchEvent(new Event('input',{bubbles:true}));})()`);await pointerClick('[form="filter-form"]');await closed();assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll('.company-link[data-open]')).map(b=>b.dataset.open).sort()`),['Alpha']);assert.deepEqual(await snapshot(),filterBefore);checks.validAdvancedFractionRetryWorks=true;
 await frame('fractional-filter-results');const saved=await snapshot();await stop(backend.child);backend=await startBackend();assert.deepEqual(await snapshot(),saved);checks.numericRulesSurviveRestart=true;
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({testedAt:new Date().toISOString(),app,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),result:'pass',checks,fixtures},null,2));console.log('PASS: '+Object.keys(checks).length+' numeric segment/filter save and validation checks');
}catch(error){if(cdp)await frame('failure').catch(()=>{});fs.writeFileSync(path.join(evidence,'failure.json'),JSON.stringify({result:'fail',error:error.message,passedChecks:checks},null,2));throw error;}
finally{cdp?.close();for(const child of children)await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
