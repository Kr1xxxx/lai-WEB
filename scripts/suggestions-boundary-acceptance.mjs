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
const evidence=path.resolve(process.env.LAI_SUGGESTIONS_BOUNDARY_EVIDENCE || 'evidence/ui-1.4.94/suggestions-boundary');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-suggestions-boundary-'));
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
async function openNew(){await pointerClick('[data-action="new"]');await until(()=>evaluate(`!!document.querySelector('#customer-form')`),'new editor');await settle();}
async function prompt(){await until(()=>evaluate(`!!document.querySelector('.customer-editor-unsaved')||!document.querySelector('#customer-form')`),'close decision');assert.equal(await evaluate(`!!document.querySelector('.customer-editor-unsaved')`),true,'Unsaved customer input must show a close decision rather than disappear');assert.ok(await evaluate(`!!document.querySelector('#customer-form')`));}
async function discard(){await pointerClick('[data-action="discard-customer-editor"]');await until(()=>evaluate(`!document.querySelector('.overlay')`),'explicitly discarded editor');}
async function continueEditing(){await pointerClick('[data-action="continue-customer-editor"]');assert.equal(await evaluate(`!!document.querySelector('.customer-editor-unsaved')`),false);}
async function key(key){await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key,code:key,windowsVirtualKeyCode:{Escape:27,Enter:13,ArrowDown:40,Tab:9}[key]});await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,windowsVirtualKeyCode:{Escape:27,Enter:13,ArrowDown:40,Tab:9}[key]});}
try{
 fs.mkdirSync(evidence,{recursive:true});backend=await startBackend();const initial=await snapshot();
 initial.data.customers={'Keyboard Alpha':{country:'US',source:'Referral'},'Keyboard Beta':{country:'FR',source:'Website'}};initial.data.orders=[];
 const seeded=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:initial,baseRevision:initial.revision})});assert.equal(seeded.status,200);
 const port=await freePort();const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps',`--user-data-dir=${path.join(temporary,'chrome')}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});children.push(browser);
 let target;await until(async()=>{try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item=>item.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'browser');cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1728,height:902,deviceScaleFactor:1,mobile:false});await navigate();const baseline=await snapshot();
 const observed={},failures=[];
 async function check(label,operation){try{await operation();checks[label]=true;}catch(error){failures.push({label,error:error.message});await frame('failure-'+label);}}
 await openNew();await pointerClick('.ce-company-extra summary');await pointerClick('#ce-source');
 await check('sourceFullyClippedByHeaderDismisses',async()=>{
  await evaluate(`(()=>{const body=document.querySelector('.customer-editor .drawer-body'),r=document.querySelector('#ce-source').getBoundingClientRect();body.scrollTop+=r.bottom-body.getBoundingClientRect().top+2;})()`);await settle();
  observed.clipped=await evaluate(`(()=>{const el=document.querySelector('#ce-source'),r=el.getBoundingClientRect(),body=el.closest('.drawer-body').getBoundingClientRect();return {input:r.toJSON(),body:body.toJSON(),menu:!!document.querySelector('.lai-suggestions'),expanded:el.getAttribute('aria-expanded')}})()`);
  assert.ok(observed.clipped.input.top>=0&&observed.clipped.input.bottom<=observed.clipped.body.top,'Test anchor must be inside viewport but fully hidden by scrolling body');assert.equal(observed.clipped.menu,false,'Fully clipped field must not leave a floating suggestion menu');assert.equal(observed.clipped.expanded,'false');
 });
 await check('visibleAnchorCanReopenAfterClipping',async()=>{if(await evaluate(`!!document.querySelector('.lai-suggestions')`))await key('Escape');await pointerClick('#ce-source');assert.equal(await evaluate(`!!document.querySelector('.lai-suggestions')`),true);await key('Escape');});
 await check('partialAnchorRemainsUsable',async()=>{
  await pointerClick('#ce-source');await evaluate(`(()=>{const body=document.querySelector('.customer-editor .drawer-body'),r=document.querySelector('#ce-source').getBoundingClientRect();body.scrollTop+=r.top-body.getBoundingClientRect().top+8;})()`);await settle();
  const state=await evaluate(`(()=>{const el=document.querySelector('#ce-source'),r=el.getBoundingClientRect(),b=el.closest('.drawer-body').getBoundingClientRect();return {top:r.top,bottom:r.bottom,bodyTop:b.top,menu:!!document.querySelector('.lai-suggestions')}})()`);assert.ok(state.top<state.bodyTop&&state.bottom>state.bodyTop);assert.equal(state.menu,true);await key('Escape');
 });
 await check('sourceUpwardMenuHasExactAnchorGap',async()=>{
  await evaluate(`document.querySelector('.customer-editor .drawer-body').scrollTop=0`);await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:480,deviceScaleFactor:1,mobile:false});await settle();await pointerClick('#ce-source');
  observed.upward=await evaluate(`(()=>{const r=document.querySelector('#ce-source').getBoundingClientRect(),m=document.querySelector('.lai-suggestions').getBoundingClientRect();return {input:r.toJSON(),menu:m.toJSON(),options:document.querySelectorAll('.lai-suggestion').length,gap:r.top-m.bottom}})()`);assert.equal(observed.upward.options,2);assert.ok(observed.upward.menu.top<observed.upward.input.top);assert.equal(observed.upward.gap,4,'Upward menu must keep the same 4px anchor gap as downward');await key('Escape');
 });
 await check('emptyUpwardMenuHasExactAnchorGap',async()=>{await fill('#ce-source','Boundary free text');const g=await evaluate(`(()=>{const r=document.querySelector('#ce-source').getBoundingClientRect(),m=document.querySelector('.lai-suggestions').getBoundingClientRect();return {gap:r.top-m.bottom,top:m.top,inputTop:r.top,empty:!!document.querySelector('.lai-suggestions-empty')}})()`);assert.equal(g.empty,true);assert.ok(g.top<g.inputTop);assert.equal(g.gap,4);await key('Escape');});

 await check('countryFullyClippedByHeaderDismisses',async()=>{
  await cdp.call('Emulation.setDeviceMetricsOverride',{width:1728,height:902,deviceScaleFactor:1,mobile:false});await settle();await pointerClick('#ce-country');await key('ArrowDown');
  await evaluate(`(()=>{const el=document.querySelector('#ce-country'),body=el.closest('.drawer-body'),r=el.getBoundingClientRect();body.scrollTop+=r.bottom-body.getBoundingClientRect().top+2;})()`);await settle();
  const g=await evaluate(`(()=>{const el=document.querySelector('#ce-country'),r=el.getBoundingClientRect(),b=el.closest('.drawer-body').getBoundingClientRect();return {top:r.top,bottom:r.bottom,bodyTop:b.top,menu:!!document.querySelector('.lai-suggestions'),expanded:el.getAttribute('aria-expanded'),selected:el.getAttribute('aria-activedescendant'),value:el.value}})()`);assert.ok(g.top>=0&&g.bottom<=g.bodyTop);assert.equal(g.menu,false);assert.equal(g.expanded,'false');assert.equal(g.selected,null);assert.equal(g.value,'');
 });
 await check('programmaticClippedFocusDoesNotOpenMenu',async()=>{
  await evaluate(`(()=>{document.querySelector('#ce-country').blur();document.querySelector('#ce-country').focus({preventScroll:true});})()`);assert.equal(await evaluate(`!!document.querySelector('.lai-suggestions')`),false);
 });
 await check('sourceFullyClippedByFooterDismisses',async()=>{
  await pointerClick('#ce-source');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:450,deviceScaleFactor:1,mobile:false});await evaluate(`document.querySelector('.customer-editor .drawer-body').scrollTop=0`);await settle();
  const g=await evaluate(`(()=>{const el=document.querySelector('#ce-source'),r=el.getBoundingClientRect(),b=el.closest('.drawer-body').getBoundingClientRect();return {top:r.top,bottom:r.bottom,bodyBottom:b.bottom,menu:!!document.querySelector('.lai-suggestions'),height:innerHeight}})()`);observed.footerClipped=g;assert.ok(g.top>=g.bodyBottom&&g.top<g.height);assert.equal(g.menu,false);
 });
 await check('singleOptionUpwardGapUsesActualHeight',async()=>{
  await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:480,deviceScaleFactor:1,mobile:false});await settle();await fill('#ce-source','Referral');await evaluate(`document.querySelector('.customer-editor .drawer-body').scrollTop-=8`);await settle();
  const g=await evaluate(`(()=>{const r=document.querySelector('#ce-source').getBoundingClientRect(),m=document.querySelector('.lai-suggestions').getBoundingClientRect();return {height:m.height,gap:r.top-m.bottom,options:document.querySelectorAll('.lai-suggestion').length}})()`);assert.equal(g.options,1);assert.equal(g.height,46);assert.equal(g.gap,4);await frame('single-option-upward');
 });
 await check('resizeChangesOpeningDirectionWithoutClosing',async()=>{
  await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:902,deviceScaleFactor:1,mobile:false});await settle();
  const g=await evaluate(`(()=>{const r=document.querySelector('#ce-source').getBoundingClientRect(),m=document.querySelector('.lai-suggestions').getBoundingClientRect();return {gap:m.top-r.bottom,width:m.width,inputWidth:r.width,value:document.querySelector('#ce-source').value}})()`);assert.equal(g.gap,4);assert.equal(g.width,g.inputWidth);assert.equal(g.value,'Referral');await key('Escape');
 });
 await check('longUpwardMenuFitsAndKeepsFourPixelGap',async()=>{
  await evaluate(`(()=>{const list=document.querySelector('#ce-options-source');for(let i=0;i<12;i++){const option=document.createElement('option');option.value='Boundary option '+i;list.append(option);}})()`);await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:480,deviceScaleFactor:1,mobile:false});await settle();await fill('#ce-source','');
  const g=await evaluate(`(()=>{const r=document.querySelector('#ce-source').getBoundingClientRect(),m=document.querySelector('.lai-suggestions').getBoundingClientRect();return {height:m.height,top:m.top,gap:r.top-m.bottom,options:document.querySelectorAll('.lai-suggestion').length}})()`);assert.equal(g.options,14);assert.equal(g.height,268);assert.equal(g.gap,4);assert.ok(g.top>=8);await frame('long-menu-upward');
 });
 await check('keyboardHighlightScrollDoesNotDetachMenu',async()=>{
  for(let i=0;i<14;i++)await key('ArrowDown');const g=await evaluate(`(()=>{const r=document.querySelector('#ce-source').getBoundingClientRect(),m=document.querySelector('.lai-suggestions').getBoundingClientRect(),selected=document.querySelector('.lai-suggestion[aria-selected="true"]');return {gap:r.top-m.bottom,selected:!!selected,value:document.querySelector('#ce-source').value}})()`);assert.equal(g.gap,4);assert.equal(g.selected,true);assert.equal(g.value,'');await key('Escape');
 });
 await check('shortMenuRecalculatesAfterLongMenu',async()=>{
  await fill('#ce-source','Website');await evaluate(`document.querySelector('.customer-editor .drawer-body').scrollTop-=8`);await settle();const g=await evaluate(`(()=>{const r=document.querySelector('#ce-source').getBoundingClientRect(),m=document.querySelector('.lai-suggestions').getBoundingClientRect();return {gap:r.top-m.bottom,height:m.height,options:document.querySelectorAll('.lai-suggestion').length}})()`);assert.equal(g.options,1);assert.equal(g.height,46);assert.equal(g.gap,4);await key('Escape');
 });
 await check('explicitDiscardLeavesDatabaseUnchanged',async()=>{await pointerClick('.ce-footer [data-action="close-modal"]');await prompt();await discard();assert.deepEqual(await snapshot(),baseline);});
 const report={testedAt:new Date().toISOString(),app,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),result:failures.length?'fail':'pass',checks,observed,failures};fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify(report,null,2));assert.equal(failures.length,0,JSON.stringify(failures));console.log('PASS: '+Object.keys(checks).length+' suggestion anchor boundary checks');
}catch(error){if(cdp)await frame('failure').catch(()=>{});fs.writeFileSync(path.join(evidence,'failure.json'),JSON.stringify({result:'fail',error:error.message,passedChecks:checks},null,2));throw error;}
finally{cdp?.close();for(const child of children)await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
