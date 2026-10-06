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
const evidence=path.resolve(process.env.LAI_DISPLAY_EVIDENCE || 'evidence/ui-1.4.13/company-display');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-known-motion-'));
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
async function openEditor(name){
  await evaluate(`(()=>{const link=[...document.querySelectorAll('.company-link')].find(link=>link.dataset.customer===${JSON.stringify(name)}||link.textContent.trim().endsWith(${JSON.stringify(name)}));if(!link)throw Error('Test customer missing');link.click();})()`);
  await until(()=>evaluate(`!!document.querySelector('.lcd-pagebar [data-action="edit"]')`),'detail');
  await evaluate(`document.querySelector('.lcd-pagebar [data-action="edit"]').click()`);
  await until(()=>evaluate(`!!document.querySelector('#customer-form')`),'editor');
}
async function submit(){await evaluate(`document.querySelector('#customer-form').requestSubmit(document.querySelector('[form="customer-form"][value="save"]'))`);await until(()=>evaluate(`!document.querySelector('#customer-form')`),'editor saved');}
async function frame(name){
 await until(()=>evaluate(`!document.querySelector('#toast')?.classList.contains('show')`),'toast finished');
 await until(()=>evaluate(`!document.getAnimations().some(a=>a.playState==='running'&&a.effect.getTiming().iterations!==Infinity)`),'finite screenshot animations settled');
 await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
 const result=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(evidence,name+'.png'),Buffer.from(result.data,'base64'));}

async function pointerClick(selector){
 const point=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
 await cdp.call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
 await cdp.call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
}
async function trace(selector,property,duration=360){return evaluate(`(async()=>{const frames=[],start=performance.now();do{await new Promise(requestAnimationFrame);const el=document.querySelector(${JSON.stringify(selector)});if(!el)break;const css=getComputedStyle(el);frames.push({ms:performance.now()-start,transform:css.transform,opacity:Number(css.opacity),overlayOpacity:document.querySelector('.overlay')?Number(getComputedStyle(document.querySelector('.overlay')).opacity):null,maskOpacity:document.querySelector('.overlay')?Number(getComputedStyle(document.querySelector('.overlay'),'::before').opacity):null,duration:css.transitionDuration,easing:css.transitionTimingFunction,animations:el.getAnimations().map(a=>({property:a.transitionProperty,time:a.currentTime,duration:a.effect.getTiming().duration})),bodyAnimation:document.querySelector('.lcd-body')?getComputedStyle(document.querySelector('.lcd-body')).animationName:null});}while(performance.now()-start<${duration});return frames})()`);}
async function drawerMetrics(){return evaluate(`(()=>{const d=document.querySelector('.drawer'),o=document.querySelector('.overlay'),h=d.querySelector('.drawer-head'),b=d.querySelector('.drawer-body'),f=d.querySelector('.drawer-footer'),t=h.querySelector('h2'),ds=getComputedStyle(d),os=getComputedStyle(o,'::before');return {width:d.getBoundingClientRect().width,header:h.getBoundingClientRect().height,bodyPadding:getComputedStyle(b).padding,footer:f.getBoundingClientRect().height,titleWeight:getComputedStyle(t).fontWeight,titleLine:getComputedStyle(t).lineHeight,duration:ds.transitionDuration,easing:ds.transitionTimingFunction,maskDuration:os.transitionDuration,maskEasing:os.transitionTimingFunction,maskColor:os.backgroundColor}})()`);}
async function closeCapturedDrawer(){
 await pointerClick('.drawer-head [data-action="close-modal"]');
 const metrics=await drawerMetrics(),frames=await trace('.drawer','transform');
 assert.equal(metrics.duration,'0.3s');assert.equal(metrics.easing,'cubic-bezier(0.23, 1, 0.32, 1)');assert.equal(metrics.maskDuration,'0.3s');assert.equal(metrics.maskEasing,'linear');
 assert.ok(frames.every(f=>f.overlayOpacity===1),'Exit must keep drawer opaque');assert.ok(frames.some(f=>f.maskOpacity>0&&f.maskOpacity<1),'Actual mask must fade out');assert.ok(frames.some(f=>f.animations.some(a=>a.property==='transform'&&a.duration===300)));assert.ok(frames.some(f=>{const x=new DOMMatrixFallback(f.transform);return x.x>0&&x.x<840;}));
 await until(()=>evaluate(`!document.querySelector('.drawer')`),'captured drawer closed');return {metrics,frames};
}
function DOMMatrixFallback(transform){return {x:Number(transform.match(/^matrix\(([^)]+)\)$/)?.[1].split(',')[4]||0)};}
try{
 fs.mkdirSync(evidence,{recursive:true});backend=await startBackend();const initial=await snapshot();
 initial.data.customers={'Motion Customer':{country:'US',source:'Referral',contact:'Main',email:'main@example.test',phone:'5550101'}};initial.data.orders=[];initial.data.previewSegments=[];
 const seeded=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:initial,baseRevision:initial.revision})});assert.equal(seeded.status,200);
 const port=await freePort();const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps',`--user-data-dir=${path.join(temporary,'chrome')}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});children.push(browser);
 let target;await until(async()=>{try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item=>item.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'browser');
 cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Page.bringToFront');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:1022,deviceScaleFactor:1,mobile:false});await navigate();
 const baseline=await snapshot();await evaluate(`document.querySelector('.company-link').click()`);await until(()=>evaluate(`!!document.querySelector('.lcd-body [data-action="company-display-settings"]')`),'detail');
 const open=async()=>pointerClick('.lcd-body [data-action="company-display-settings"]');
 await open();const enteringFrames=await trace('.company-display','transform');const metrics=await drawerMetrics();
 assert.equal(metrics.width,400);assert.equal(metrics.header,60);assert.equal(metrics.footer,64);assert.equal(metrics.titleWeight,'500');assert.equal(metrics.titleLine,'22px');assert.equal(metrics.bodyPadding,'16px 24px');
 const rows=await evaluate(`(()=>{const d=document.querySelector('.company-display'),r=d.querySelector('.company-display-row'),n=d.querySelector('.company-display-note');return {height:r.getBoundingClientRect().height,border:getComputedStyle(r).borderTopWidth,noticeSize:getComputedStyle(n).fontSize,noticeLine:getComputedStyle(n).lineHeight,noticeBackground:getComputedStyle(n).backgroundColor,icon:!!n.querySelector('svg'),common:d.querySelectorAll('[data-company-list="common"] li').length,other:d.querySelectorAll('[data-company-list="other"] li').length}})()`);
 assert.deepEqual(rows,{height:28,border:'0px',noticeSize:'14px',noticeLine:'22px',noticeBackground:'rgb(235, 243, 255)',icon:true,common:10,other:6});checks.sourceGeometryAndCompactRows=true;
 const sourceShadow=await evaluate(`getComputedStyle(document.querySelector('.company-display')).boxShadow`);assert.equal(sourceShadow,'rgba(0, 0, 0, 0.08) -6px 0px 16px -8px, rgba(0, 0, 0, 0.05) -9px 0px 28px 0px, rgba(0, 0, 0, 0.03) -12px 0px 48px 16px');checks.sourceThreeLayerShadow=true;
 assert.equal(metrics.duration,'0.3s');assert.equal(metrics.easing,'cubic-bezier(0.23, 1, 0.32, 1)');assert.equal(metrics.maskDuration,'0.3s');assert.equal(metrics.maskColor,'rgba(20, 20, 20, 0.3)');assert.ok(enteringFrames.every(f=>f.overlayOpacity===1));assert.ok(enteringFrames.some(f=>f.maskOpacity>0&&f.maskOpacity<1));assert.ok(enteringFrames.some(f=>new DOMMatrixFallback(f.transform).x>0&&new DOMMatrixFallback(f.transform).x<400));assert.ok(enteringFrames.some(f=>f.animations.some(a=>a.property==='transform'&&a.duration===300)));checks.independentMaskAnd300msEntry=true;await frame('company-display-desktop');
 await cdp.call('Emulation.setDeviceMetricsOverride',{width:640,height:480,deviceScaleFactor:1,mobile:false});assert.equal(await evaluate(`document.querySelector('.company-display .drawer-footer').getBoundingClientRect().bottom`),480);await evaluate(`document.querySelector('.company-display-body').scrollTop=300`);assert.ok(await evaluate(`document.querySelector('.company-display-body').scrollTop>0`));assert.equal(await evaluate(`document.querySelector('.company-display .drawer-footer').getBoundingClientRect().bottom`),480);await frame('company-display-short');checks.shortWindowScrollKeepsFooter=true;await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:1022,deviceScaleFactor:1,mobile:false});
 await pointerClick('.company-display .drawer-head [data-action="close-modal"]');assert.equal(await evaluate(`document.querySelector('.company-display').inert`),true);const exiting=await drawerMetrics(),exitFrames=await trace('.company-display','transform');assert.equal(exiting.maskEasing,'linear');assert.equal(exiting.duration,'0.3s');assert.ok(exitFrames.every(f=>f.overlayOpacity===1));assert.ok(exitFrames.some(f=>f.maskOpacity>0&&f.maskOpacity<1));assert.ok(exitFrames.some(f=>new DOMMatrixFallback(f.transform).x>0&&new DOMMatrixFallback(f.transform).x<400));await until(()=>evaluate(`!document.querySelector('.overlay')`),'closed');assert.equal(await evaluate(`document.activeElement.dataset.action`),'company-display-settings');checks.exitInertAndFocusReturn=true;
 await open();await pause(50);await pointerClick('.company-display .drawer-head [data-action="close-modal"]');await evaluate(`document.querySelector('.lcd-body [data-action="company-display-settings"]').click()`);await pause(380);assert.equal(await evaluate(`document.querySelectorAll('.company-display').length`),1);assert.equal(await evaluate(`document.querySelector('.company-display').inert`),false);await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);checks.oldExitCannotDeleteNewDialog=true;
 for(let i=0;i<5;i++){await open();await pause(i%2?100:50);await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);assert.equal(await evaluate(`!!document.querySelector('.overlay')`),false);}checks.interruptedOpeningsLeaveNoDialog=true;
 await evaluate(`document.querySelector('.lcd-body [data-action="company-display-settings"]').click()`);assert.equal(await evaluate(`document.querySelector('.company-display').getAnimations().length`),0);await evaluate(`document.querySelector('.company-display [data-action="close-modal"]').click()`);checks.keyboardClickPathImmediate=true;
 await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await open();const reducedFrames=await trace('.company-display','transform',150);assert.ok(reducedFrames.every(f=>f.transform==='none'));assert.equal(await evaluate(`getComputedStyle(document.querySelector('.company-display')).transitionDuration`),'0.08s');await pointerClick('.company-display [data-action="close-modal"]');await until(()=>evaluate(`!document.querySelector('.overlay')`),'reduced close');await cdp.call('Emulation.setEmulatedMedia',{features:[]});checks.reducedFadesWithoutHorizontalMovement=true;
 await evaluate(`document.querySelector('.lcd-pagebar [data-action="edit"]').click()`);await until(()=>evaluate(`!!document.querySelector('#customer-form')`),'editor');await evaluate(`document.querySelector('#customer-form [name="source"]').value='Unsaved source draft';document.querySelector('#customer-form [data-action="company-display-settings"]').click()`);await until(()=>evaluate(`!!document.querySelector('.company-display')`),'nested');await evaluate(`document.querySelector('.company-display [data-action="close-modal"]').click()`);assert.equal(await evaluate(`document.querySelector('#customer-form [name="source"]').value`),'Unsaved source draft');await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);checks.nestedCancelPreservesEditorDraft=true;
 await evaluate(`document.querySelector('.lcd-body [data-action="company-display-settings"]').click()`);
 await evaluate(`document.querySelector('.company-display [data-company-field-id="tags"] [data-company-move]').click()`);
 assert.equal(await evaluate(`document.querySelector('[data-company-field-id="tags"]').parentElement.dataset.companyList`),'other');
 await evaluate(`document.querySelector('.company-display .drawer-footer [data-action="close-modal"]').click()`);
 assert.equal(await evaluate(`!!document.querySelector('.company-display [role="alertdialog"]')`),true,'Changed display order must ask before closing');
 assert.equal(await evaluate(`!!document.querySelector('.company-display')`),true);
 await frame('company-display-unsaved');
 await cdp.call('Emulation.setDeviceMetricsOverride',{width:640,height:480,deviceScaleFactor:1,mobile:false});
 const warningBounds=await evaluate(`(()=>{const r=document.querySelector('.company-display-unsaved').getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}})()`);
 assert.ok(warningBounds.left>=0&&warningBounds.right<=640&&warningBounds.top>=0&&warningBounds.bottom<=480);
 await frame('company-display-unsaved-short');
 await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:1022,deviceScaleFactor:1,mobile:false});
 await evaluate(`document.querySelector('[data-action="continue-company-display"]').click()`);
 assert.equal(await evaluate(`!!document.querySelector('.company-display [role="alertdialog"]')`),false);
 assert.equal(await evaluate(`document.querySelector('[data-company-field-id="tags"]').parentElement.dataset.companyList`),'other');
 await evaluate(`document.querySelector('.company-display .drawer-footer [data-action="close-modal"]').click()`);
 await evaluate(`document.querySelector('[data-action="discard-company-display"]').click()`);
 await until(()=>evaluate(`!document.querySelector('.company-display')`),'discarded display drawer closed');
 await evaluate(`document.querySelector('.lcd-body [data-action="company-display-settings"]').click()`);
 assert.equal(await evaluate(`document.querySelector('[data-company-field-id="tags"]').parentElement.dataset.companyList`),'other','Unsaved order remains in this page until reload');
 await evaluate(`document.querySelector('.company-display .drawer-footer [data-action="close-modal"]').click()`);
 assert.equal(await evaluate(`!!document.querySelector('.company-display [role="alertdialog"]')`),false,'Unchanged reopened draft closes directly');
 checks.unsavedDisplayOrderNeedsConfirmation=true;
 await evaluate(`document.querySelector('.lcd-body [data-action="company-display-settings"]').click()`);
 await evaluate(`(()=>{const source=document.querySelector('[data-company-field-id="productType"]'),target=document.querySelector('[data-company-field-id="previewGroup"]'),dataTransfer=new DataTransfer(),y=target.getBoundingClientRect().top+target.getBoundingClientRect().height*.65;source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer}));target.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer,clientY:y}));target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer,clientY:y}));source.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer}));})()`);
 const draggedOrder=await evaluate(`[...document.querySelectorAll('[data-company-list="common"] [data-company-field-id]')].map(row=>row.dataset.companyFieldId)`);
 assert.ok(draggedOrder.indexOf('productType')>draggedOrder.indexOf('previewGroup'),`Dropping below a row midpoint places the dragged field after it: ${JSON.stringify(draggedOrder)}`);
 checks.pointerDropUsesRowHalf=true;
 await evaluate(`document.querySelector('.company-display .drawer-footer [data-action="close-modal"]').click()`);
 await evaluate(`document.querySelector('[data-action="discard-company-display"]').click()`);
 assert.deepEqual(await snapshot(),baseline);checks.cancelNeverWritesPreferencesOrCustomers=true;
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({testedAt:new Date().toISOString(),app,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),result:'pass',checks,metrics,rows,sourceShadow,exiting,enteringFrames,exitFrames,reducedFrames},null,2));console.log('PASS: '+Object.keys(checks).length+' company display checks');
}catch(error){console.error('Acceptance failure: '+error.message);if(cdp)await frame('failure').catch(()=>{});throw error;}
finally{cdp?.close();for(const child of children)await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
