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
const evidence=path.resolve(process.env.LAI_CODE_FOCUS_EVIDENCE || 'evidence/ui-1.4.26/code-focus');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-code-focus-'));
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
 const point=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
 await cdp.call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
 await cdp.call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
}


const pencil='#customer-form [data-editor-action="edit-customer-code"]';
const inputSelector='#customer-form [name="customerCode"]';
async function key(key,code,keyCode,text){await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:keyCode,...(text?{text,unmodifiedText:text}:{})});await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:keyCode});}
async function inputState(){return evaluate(`(()=>{const i=document.querySelector('${inputSelector}'),r=i.getBoundingClientRect(),s=getComputedStyle(i),row=i.closest('.ce-customer-number'),b=row.querySelector('[data-editor-action="finish-customer-code"]');return{hidden:i.hidden,focused:i===document.activeElement,width:r.width,height:r.height,rowWidth:row.getBoundingClientRect().width,radius:s.borderRadius,padding:s.padding,animation:s.animationName,transform:s.transform,opacity:s.opacity,border:s.borderColor,outline:s.outlineWidth,outlineStyle:s.outlineStyle,transition:s.transitionDuration,transitionProperty:s.transitionProperty,font:s.fontSize,line:s.lineHeight,doneExists:!!b,inputRect:r.toJSON()}})()`);}
async function open(){await pointerClick(pencil);return inputState();}
async function staticFrames(){return evaluate(`(async()=>{let out=[],start=performance.now();do{let i=document.querySelector('${inputSelector}'),s=getComputedStyle(i);out.push({ms:performance.now()-start,transform:s.transform,opacity:s.opacity,animation:s.animationName});await new Promise(requestAnimationFrame);}while(performance.now()-start<340);return out;})()`);}
try{
fs.mkdirSync(evidence,{recursive:true});backend=await startBackend();let initial=await snapshot();initial.data.customers={'Code Customer':{country:'US',source:'Referral',customerCode:'0007',contact:'Main',email:'main@example.test',phone:'5550101',website:'https://original.example.test'}};initial.data.orders=[];initial.data.previewSegments=[];
assert.equal((await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:initial,baseRevision:initial.revision})})).status,200);
const port=await freePort(),browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps',`--user-data-dir=${path.join(temporary,'chrome')}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});children.push(browser);let target;await until(async()=>{try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'browser');cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1728,height:958,deviceScaleFactor:1,mobile:false});await navigate();const baseline=await snapshot();await evaluate(`document.querySelector('.company-link').click()`);await until(()=>evaluate(`!!document.querySelector('.lcd-pagebar [data-action="edit"]')`),'detail');await evaluate(`document.querySelector('.lcd-pagebar [data-action="edit"]').click()`);await until(()=>evaluate(`!!document.querySelector('#customer-form')`),'editor');await evaluate(`document.querySelector('${pencil}').scrollIntoView({block:'center',behavior:'instant'})`);
const opened=await open();const frames=await staticFrames();assert.ok(frames.every(f=>f.transform==='none'&&f.opacity==='1'&&f.animation==='none'),'Code input should stay still without invented entry motion');checks.sourceStaticInputFrames=true;
const geometry=await inputState();assert.equal(geometry.width,geometry.rowWidth);assert.equal(geometry.width,380);assert.equal(geometry.height,32);assert.equal(geometry.radius,'4px');assert.equal(geometry.font,'14px');assert.equal(geometry.line,'22px');assert.equal(geometry.border,'rgb(0, 79, 217)');assert.equal(geometry.outlineStyle,'none');assert.equal(geometry.transition,'0.3s');assert.ok(geometry.transitionProperty.includes('border-color'));assert.equal(geometry.padding,'4px 12px');assert.equal(geometry.doneExists,false);assert.ok(geometry.focused);await frame('code-input');checks.sourceOuterGeometryWithoutExtraButton=true;
await evaluate(`document.querySelector('${inputSelector}').value='discarded'`);await key('Escape','Escape',27);assert.equal((await inputState()).hidden,false);assert.equal(await evaluate(`document.querySelector('${inputSelector}').value`),'discarded');await key('Enter','Enter',13,'\r');assert.equal((await inputState()).hidden,false);assert.equal(await evaluate(`document.querySelector('${inputSelector}').value`),'discarded');assert.deepEqual(await snapshot(),baseline);checks.enterAndEscapeKeepDraftEditing=true;
await key('Tab','Tab',9);assert.equal((await inputState()).hidden,true);assert.equal(await evaluate(`document.querySelector('[data-customer-code-display]').textContent`),'discarded');checks.tabBlurCommitsDisplayOnly=true;
await open();await evaluate(`document.querySelector('${inputSelector}').value='0010'`);await pointerClick('#customer-form .ce-number-field .ce-label');assert.equal(await evaluate(`document.querySelector('[data-customer-code-display]').textContent`),'0010');checks.pointerBlurCommitsDisplayOnly=true;
await open();await evaluate(`document.querySelector('${inputSelector}').value='0011';document.querySelector('#customer-form [name="name"]').focus()`);assert.equal((await inputState()).hidden,true);assert.equal(await evaluate(`document.querySelector('[data-customer-code-display]').textContent`),'0011');checks.blurUpdatesDraftOnly=true;
await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await open();const reducedFrames=await staticFrames();assert.ok(reducedFrames.every(f=>f.transform==='none'&&f.opacity==='1'&&f.animation==='none'));await evaluate(`document.querySelector('#customer-form [name="name"]').focus()`);checks.reducedInputAlsoStatic=true;
await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});await evaluate(`document.querySelector('${pencil}').focus()`);await key('Enter','Enter',13,'\r');assert.equal((await inputState()).focused,true);assert.ok((await staticFrames()).every(f=>f.transform==='none'));await key('Enter','Enter',13,'\r');assert.equal((await inputState()).hidden,false);await key('Tab','Tab',9);assert.equal((await inputState()).hidden,true);checks.hardwareKeyboardOpenAndTabCommit=true;
await cdp.call('Emulation.setDeviceMetricsOverride',{width:640,height:480,deviceScaleFactor:1,mobile:false});await evaluate(`document.querySelector('${pencil}').scrollIntoView({block:'center',behavior:'instant'})`);await open();const narrow=await inputState();assert.equal(narrow.width,narrow.rowWidth);assert.ok(narrow.inputRect.left>=0&&narrow.inputRect.right<=640);await frame('code-input-640');await evaluate(`document.querySelector('#customer-form [name="name"]').focus()`);checks.narrowInputWithinColumn=true;
await pointerClick('.ce-footer [data-action="close-modal"]');await until(()=>evaluate(`!document.querySelector('#customer-form')`),'cancel');assert.deepEqual(await snapshot(),baseline);checks.cancelAndAllInteractionsDoNotWriteData=true;
fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({testedAt:new Date().toISOString(),result:'pass',app,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),checks,opened,geometry,frames,reducedFrames,narrow,sourceEvidence:'evidence/planning-2026-09-28/source-customer-code-keyboard-readonly.json',realDataWrites:false},null,2));console.log('PASS: '+Object.keys(checks).length+' code focus checks');
}catch(error){fs.writeFileSync(path.join(evidence,'progress.json'),JSON.stringify({checks,error:error.message},null,2));if(cdp)await frame('failure').catch(()=>{});throw error;}
finally{cdp?.close();for(const child of children)await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
