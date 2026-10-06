import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

// Exercise long condition lists through hit-tested input and disposable SQLite only.
const app=path.resolve(process.env.LAI_ACCEPTANCE_APP || 'dist/来财Lai.app');
const resources=path.join(app,'Contents/Resources');
const evidence=path.resolve(process.env.LAI_LONG_SEGMENT_EVIDENCE || 'evidence/long-segment');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-long-segment-'));
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

async function settle(){await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);await until(()=>evaluate(`!document.getAnimations().some(a=>a.playState==='running'&&a.effect.getTiming().iterations!==Infinity)`),'drawer settled');}
async function fill(selector,value){await pointerClick(selector);await evaluate(`document.querySelector(${JSON.stringify(selector)}).select()`);await cdp.call('Input.insertText',{text:value});}

const observations=[];
const rule=(i,prop='value')=>`#segment-form [data-rule="${i}"] [data-rule-prop="${prop}"]`;
const initialRules=[{field:'country',op:'eq',value:'US'},{field:'source',op:'eq',value:'Mail'},...Array.from({length:18},(_,i)=>({field:'name',op:'notContains',value:`Excluded-${String(i+2).padStart(2,'0')}`}))];
async function inputs(){return evaluate(`[...document.querySelectorAll('#segment-form [data-rule]')].map(row=>Object.fromEntries([...row.querySelectorAll('[data-rule-prop]')].map(el=>[el.dataset.ruleProp,el.value])))`);}
async function selected(){return evaluate(`document.querySelector('#segment-form').elements.match.value`);}
async function count(){return evaluate(`Number(document.querySelector('#match-preview').textContent.match(/[0-9]+/)[0])`);}
async function wheel(deltaY){const point=await evaluate(`(()=>{const r=document.querySelector('#segment-form').getBoundingClientRect();return {x:r.left+12,y:r.top+r.height/2}})()`);await cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await cdp.call('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY});await pause(60);}
async function reveal(selector){
 for(let i=0;i<25;i++){
  const position=await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)}),r=el.getBoundingClientRect(),b=document.querySelector('#segment-form').getBoundingClientRect();return {visible:r.top>=b.top&&r.bottom<=b.bottom,delta:r.top<b.top?-400:400}})()`);
  if(position.visible)return;await wheel(position.delta);
 }throw Error('Unable to reveal long-list control by wheel: '+selector);
}
async function edit(){await navigate();await pointerClick('.group-settings[data-action="manage-segments"]');await settle();await pointerClick('[data-edit-segment="long-fixture"]');await until(()=>evaluate(`!!document.querySelector('#segment-form')`),'long editor');await settle();}
async function cancel(){await pointerClick('.drawer-footer [data-action="close-modal"]');await until(()=>evaluate(`!!document.querySelector('.segment-editor-unsaved')||!document.querySelector('.overlay')`),'cancel decision');}
async function discard(){await pointerClick('[data-action="discard-segment-editor"]');await until(()=>evaluate(`!document.querySelector('.overlay')`),'discard');}
async function save(){await pointerClick('[form="segment-form"]');await until(()=>evaluate(`!document.querySelector('.overlay')`),'saved');}
async function layout(label){
 const result=await evaluate(`(()=>{const form=document.querySelector('#segment-form'),b=form.getBoundingClientRect(),footer=document.querySelector('.drawer-footer').getBoundingClientRect();return {width:innerWidth,height:innerHeight,body:b.toJSON(),footer:footer.toJSON(),scrollTop:form.scrollTop,scrollHeight:form.scrollHeight,clientHeight:form.clientHeight,scrollWidth:form.scrollWidth,clientWidth:form.clientWidth,rows:[...form.querySelectorAll('[data-rule]')].map(el=>({rect:el.getBoundingClientRect().toJSON(),fields:[...el.querySelectorAll('select,input,button')].map(n=>n.getBoundingClientRect().toJSON()),index:el.querySelector('.rule-index')?.textContent,visible:[...el.querySelectorAll('input,button')].filter(n=>getComputedStyle(n).opacity!=='0').map(n=>({rect:n.getBoundingClientRect().toJSON(),label:n.getAttribute('aria-label'),fontSize:getComputedStyle(n).fontSize,remove:n.hasAttribute('data-remove-rule'),svgCount:n.querySelectorAll('svg').length}))})),focus:{rule:document.activeElement.closest('[data-rule]')?.dataset.rule,prop:document.activeElement.dataset.ruleProp,rect:document.activeElement.getBoundingClientRect().toJSON()}}})()`);observations.push({label,...result});
 assert.ok(result.scrollHeight>result.clientHeight,'Fixture must actually overflow the scrolling body');assert.ok(result.scrollWidth<=result.clientWidth+1,'No horizontal field clipping at supported native size');
 assert.ok(result.footer.top>=result.body.bottom-.1&&result.footer.bottom<=result.height+.1,'Fixed footer must remain outside the body scroll area');
 assert.ok(result.rows.every(row=>row.fields.every(field=>field.left>=result.body.left&&field.right<=result.body.right+.1)),'All row controls remain horizontally within the body');
 assert.ok(result.rows.every((row,i)=>row.index===String(i+1)),'Show source-style sequential rule numbers, renumbered after deletion');
 assert.ok(result.rows.every((row,i)=>Math.abs(row.rect.height-56)<.1&&(!i||Math.abs(row.rect.top-result.rows[i-1].rect.top-56)<.1)),'Source condition rows have 56px height and pitch');
 assert.ok(result.rows.every(row=>row.visible.every(control=>Math.abs(control.rect.height-32)<.1&&control.fontSize==='14px')),'Source rule controls are 32px high with 14px type');
 for(const row of result.rows){const field=row.visible.find(n=>n.label?.endsWith('字段')),op=row.visible.find(n=>n.label?.endsWith('运算')),value=row.visible.find(n=>n.label?.endsWith('值')),remove=row.visible.find(n=>n.remove);assert.ok(Math.abs(field.rect.width-128)<.1&&Math.abs(op.rect.width-100)<.1,'Source field/operator widths are 128px/100px');assert.ok(Math.abs(field.rect.left-row.rect.left-24)<.1&&Math.abs(op.rect.left-row.rect.left-160)<.1&&Math.abs(value.rect.left-row.rect.left-268)<.1,'Source number and 8px gaps place field/op/value at 24/160/268px');assert.equal(remove.svgCount,1,'Source remove action uses a circle-minus icon');}
 return result;
}
async function mutate(action,selector){
 await evaluate(`(()=>{const trigger=document.querySelector(${JSON.stringify(selector)}),out=window.longRuleObservation={samples:[],done:false};document.addEventListener('click',function capture(e){if(!trigger.contains(e.target))return;document.removeEventListener('click',capture);const start=performance.now();function sample(){const rows=[...document.querySelectorAll('#segment-form [data-rule]')];out.samples.push({ms:performance.now()-start,rows:rows.map(el=>{const css=getComputedStyle(el);return {values:[...el.querySelectorAll('[data-rule-prop]')].map(n=>n.value),opacity:Number(css.opacity),transform:css.transform,animation:css.animationName}}),focusRule:document.activeElement.closest('[data-rule]')?.dataset.rule,focusProp:document.activeElement.dataset.ruleProp});if(performance.now()-start<180)requestAnimationFrame(sample);else out.done=true}queueMicrotask(sample)});})()`);
 await pointerClick(selector);await until(()=>evaluate(`window.longRuleObservation.done`),'rule mutation frames');const result=await evaluate(`window.longRuleObservation`);observations.push({action,...result});
 assert.ok(result.samples.length>=5);assert.ok(result.samples.every(s=>s.rows.every(row=>row.opacity===1&&row.transform==='none'&&row.animation==='none')),'Condition rows must update immediately, without an invented row entrance');return result;
}
try{
 fs.mkdirSync(evidence,{recursive:true});assert.equal(fs.existsSync(path.join(resources,'trade-order-data.json')),false);backend=await startBackend();const empty=await snapshot();assert.equal(Object.keys(empty.data.customers).length,0);assert.equal(empty.data.orders.length,0);
 empty.data.customers={'Alpha Fixture':{country:'US',source:'Referral'},'Beta Fixture':{country:'GB',source:'Mail'},'Gamma Fixture':{country:'US',source:'Mail'}};
 empty.data.previewSegments=[{id:'long-fixture',name:'Long Rules Fixture',kind:'rules',match:'all',rules:initialRules,unknown:{keep:'long-only'}}];
 const seeded=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:empty,baseRevision:empty.revision})});assert.equal(seeded.status,200);
 const port=await freePort();const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps',`--user-data-dir=${path.join(temporary,'chrome')}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});children.push(browser);
 let target;await until(async()=>{try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'private browser');cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');
 const baseline=await snapshot();
 for(const [width,height] of [[1756,1022],[1100,720]]){
  await cdp.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await edit();assert.deepEqual(await inputs(),initialRules);assert.equal(await count(),1);await layout('initial-'+width);checks['longAllAndLayout'+width]=true;
  await reveal(rule(12));await fill(rule(12),'Changed-Draft-12');const drafted=structuredClone(initialRules);drafted[12].value='Changed-Draft-12';assert.deepEqual(await inputs(),drafted);checks['middleInputKeepsAllIndices'+width]=true;
  await reveal('[data-action="add-rule"]');const add=await mutate('add-tail-'+width,'[data-action="add-rule"]');assert.equal(add.samples[0].rows.length,21);assert.equal(add.samples[0].focusRule,'20');assert.equal(add.samples[0].focusProp,'value');const focused=await layout('tail-added-'+width);assert.ok(focused.focus.rect.top>=focused.body.top&&focused.focus.rect.bottom<=focused.body.bottom);await fill(rule(20),'CA');assert.deepEqual((await inputs()).slice(0,20),drafted);checks['tailAddImmediateAndFocusVisible'+width]=true;
  const remove=await mutate('remove-tail-'+width,'[data-remove-rule="20"]');assert.equal(remove.samples[0].rows.length,20);assert.equal(remove.samples[0].focusRule,'19');assert.deepEqual(await inputs(),drafted);checks['tailDeleteKeepsDraftAndFocus'+width]=true;
  await reveal('[data-remove-rule="8"]');await mutate('remove-middle-'+width,'[data-remove-rule="8"]');drafted.splice(8,1);assert.deepEqual(await inputs(),drafted);assert.equal(await evaluate(`document.activeElement.closest('[data-rule]').dataset.rule`),'8');checks['middleDeleteRetainsOrderedRules'+width]=true;
  await reveal('#segment-form [name="match"][value="any"]');await pointerClick('#segment-form [name="match"][value="any"]');await pause(60);await pointerClick('#segment-form [name="match"][value="all"]');assert.equal(await selected(),'all');assert.equal(await count(),1);await pointerClick('#segment-form [name="match"][value="any"]');assert.equal(await selected(),'any');assert.equal(await count(),3);assert.deepEqual(await inputs(),drafted);assert.deepEqual(await snapshot(),baseline);checks['rapidMatchRoundTripKeepsLongDraft'+width]=true;
  const newWidth=width===1756?1100:1756,newHeight=width===1756?720:1022;await cdp.call('Emulation.setDeviceMetricsOverride',{width:newWidth,height:newHeight,deviceScaleFactor:1,mobile:false});await settle();assert.deepEqual(await inputs(),drafted);assert.equal(await selected(),'any');await reveal(rule(18));await layout('resized-tail-'+width);await frame('long-rules-resized-'+width);checks['resizePreservesRulesAndFooter'+width]=true;
  await cancel();assert.equal(await evaluate(`!!document.querySelector('.segment-editor-unsaved')`),true);await pointerClick('[data-action="continue-segment-editor"]');assert.deepEqual(await inputs(),drafted);assert.equal(await selected(),'any');await cancel();await discard();assert.deepEqual(await snapshot(),baseline);checks['continueAndDiscardKeepDatabase'+width]=true;
 }
 await edit();await reveal(rule(12));await fill(rule(12),'Saved-Rule-12');await reveal('[data-remove-rule="8"]');await pointerClick('[data-remove-rule="8"]');await reveal('#segment-form [name="match"][value="any"]');await pointerClick('#segment-form [name="match"][value="any"]');const expected=structuredClone(initialRules);expected[12].value='Saved-Rule-12';expected.splice(8,1);await save();const saved=await snapshot();assert.equal(saved.revision,baseline.revision+1);assert.deepEqual(saved.data.previewSegments[0].rules,expected);assert.equal(saved.data.previewSegments[0].match,'any');assert.deepEqual(saved.data.previewSegments[0].unknown,{keep:'long-only'});assert.deepEqual(saved.data.customers,baseline.data.customers);checks.longSaveOnceKeepsOrderAndMetadata=true;
 await edit();assert.deepEqual(await inputs(),expected);assert.equal(await selected(),'any');assert.equal(await count(),3);await cancel();assert.equal(await evaluate(`!!document.querySelector('.overlay')`),false);assert.deepEqual(await snapshot(),saved);checks.savedReopenAndUnchangedCancel=true;
 // Close private browser before service restart to avoid active HTTP requests at shutdown.
 await stop(browser);cdp.close();cdp=null;await stop(backend.child);assert.equal(backend.child.exitCode,0);backend=await startBackend();assert.deepEqual(await snapshot(),saved);checks.restartPreservesSavedLongRules=true;
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({result:'pass',testedAt:new Date().toISOString(),checks,observations,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),scope:'Existing condition-group long-list behavior at native minimum and wide viewport; not full source/native/pixel acceptance'},null,2));console.log('PASS: '+Object.keys(checks).length+' long rule-list checks');
}catch(error){fs.writeFileSync(path.join(evidence,'failure.json'),JSON.stringify({error:error.message,checks,observations},null,2));throw error;}
finally{cdp?.close();for(const child of [...children].reverse())await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});fs.writeFileSync(path.join(evidence,'cleanup.json'),JSON.stringify({temporaryRemoved:!fs.existsSync(temporary),children:children.map(child=>({pid:child.pid,exitCode:child.exitCode,signalCode:child.signalCode}))},null,2));assert.ok(children.every(child=>child.exitCode===0));}
