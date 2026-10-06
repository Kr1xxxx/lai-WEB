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
const evidence=path.resolve(process.env.LAI_SEARCH_MENU_EVIDENCE || 'evidence/ui-1.4.11/search-menu');
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

 const initialDatabase=await snapshot();
 await pointerClick('[data-action="global-search-scope"]');
 await until(()=>evaluate(`!document.querySelector('.global-search-scope-menu').getAnimations().some(a=>a.playState==='running')`),'settled search scope');
 const geometry=await evaluate(`(()=>{const b=document.querySelector('.global-search-scope-menu'),s=getComputedStyle(b),r=b.getBoundingClientRect();return {width:r.width,height:r.height,padding:s.padding,font:getComputedStyle(b.querySelector('button')).fontSize,columns:[...b.children].map(e=>({width:e.getBoundingClientRect().width,height:e.clientHeight,scroll:e.scrollHeight})),animation:s.animationName,origin:s.transformOrigin}})()`);
 assert.equal(geometry.width,242,'Source search menu width');assert.equal(geometry.height,206,'Source search menu height');assert.equal(geometry.padding,'0px');assert.equal(geometry.font,'14px');assert.deepEqual(geometry.columns,[{width:120,height:204,scroll:204},{width:120,height:204,scroll:340}]);assert.equal(geometry.animation,'none');assert.equal(geometry.origin,'0px 0px');checks.capturedGeometryAndDirectOpening=true;
 await frame('search-menu-desktop');
 await pointerClick('[data-action="global-search-scope"]');
 const closedStart=await evaluate(`(()=>{const b=document.querySelector('.global-search-scope-menu'),s=getComputedStyle(b);return {exists:!!b,inert:b.inert,expanded:document.querySelector('[data-action="global-search-scope"]').getAttribute('aria-expanded'),duration:s.transitionDuration,easing:s.transitionTimingFunction}})()`);
 assert.equal(closedStart.exists,true);assert.equal(closedStart.inert,true);assert.equal(closedStart.expanded,'false');assert.equal(closedStart.duration,'0.3s, 0.3s');assert.equal(closedStart.easing,'cubic-bezier(0.23, 1, 0.32, 1), cubic-bezier(0.23, 1, 0.32, 1)');
 const closingFrames=await trace('.global-search-scope-menu','transform');assert.ok(closingFrames.some(f=>{const sy=Number(f.transform.match(/^matrix\(([^)]+)\)$/)?.[1].split(',')[3]||1);return sy>0&&sy<1&&f.opacity>0&&f.opacity<1;}),'Real intermediate closing frames');await until(()=>evaluate(`!document.querySelector('.global-search-scope-menu')`),'search menu removed');checks.sourceScaleYAndOpacityExit=true;
 await pointerClick('[data-action="global-search-scope"]');await evaluate(`window.__searchMenu=document.querySelector('.global-search-scope-menu')`);await pointerClick('[data-action="global-search-scope"]');await pointerClick('[data-action="global-search-scope"]');
 assert.deepEqual(await evaluate(`({same:window.__searchMenu===document.querySelector('.global-search-scope-menu'),inert:document.querySelector('.global-search-scope-menu').inert,expanded:document.querySelector('[data-action="global-search-scope"]').getAttribute('aria-expanded')})`),{same:true,inert:false,expanded:'true'});await pause(360);assert.equal(await evaluate(`!!document.querySelector('.global-search-scope-menu')`),true);checks.closeReversalKeepsMenuAndCancelsRemoval=true;
 await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);assert.deepEqual(await evaluate(`({exists:!!document.querySelector('.global-search-scope-menu'),focus:document.activeElement?.dataset.action})`),{exists:false,focus:'global-search-scope'});checks.escapeRemovesImmediatelyAndRestoresFocus=true;
 await pointerClick('[data-action="global-search-scope"]');await pointerClick('#global-search-form input');assert.equal(await evaluate(`document.querySelector('.global-search-scope-menu').inert`),true);await until(()=>evaluate(`!document.querySelector('.global-search-scope-menu')`),'outside dismissal');assert.equal(await evaluate(`document.activeElement===document.querySelector('#global-search-form input')`),true);checks.outsideDismissalKeepsInputFocus=true;
 await pointerClick('[data-action="global-search-scope"]');await evaluate(`document.querySelector('.global-search-fields').scrollTop=136`);assert.equal(await evaluate(`document.querySelector('.global-search-fields').scrollTop`),136);await pointerClick('[data-global-field="social"]');assert.equal(await evaluate(`!!document.querySelector('.global-search-scope-menu')`),false);checks.lastSearchFieldAccessibleAfterScroll=true;
 await evaluate(`document.querySelector('[data-action="global-search-scope"]').click()`);assert.equal(await evaluate(`document.activeElement.dataset.globalCategory`),'客户');await evaluate(`document.querySelector('[data-global-field="nameOrShort"]').click();window.__searchTriggerBeforeSubmit=document.querySelector('[data-action="global-search-scope"]');document.querySelector('#global-search-form input').value='Motion Customer';document.querySelector('#global-search-form').requestSubmit()`);await until(()=>evaluate(`document.querySelector('[data-action="global-search-scope"]')!==window.__searchTriggerBeforeSubmit&&document.querySelector('.company-link')?.textContent.includes('Motion Customer')`),'selected search field result after navigation');checks.existingSearchSelectionAndQueryWork=true;
 await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:720,deviceScaleFactor:1,mobile:false});
 await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
 await pointerClick('[data-action="global-search-scope"]');
 await frame('search-menu-compact');
 const compactMenu=await evaluate(`(()=>{const b=document.querySelector('.global-search-scope-menu');if(!b)return {exists:false};const r=b.getBoundingClientRect(),s=getComputedStyle(b);return {exists:true,rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height},visible:s.visibility!=='hidden'&&s.display!=='none'&&Number(s.opacity)>0&&!b.inert,viewport:{width:innerWidth,height:innerHeight},expanded:document.querySelector('[data-action="global-search-scope"]').getAttribute('aria-expanded')}})()`);
 assert.equal(compactMenu.exists,true,'Compact search menu remains open after screenshot settling');
 assert.equal(compactMenu.visible,true,'Compact search menu remains visible');
 assert.equal(compactMenu.expanded,'true');
 assert.ok(compactMenu.rect.left>=0&&compactMenu.rect.right<=compactMenu.viewport.width,'Compact search menu fits viewport horizontally');
 assert.ok(compactMenu.rect.top>=0&&compactMenu.rect.bottom<=compactMenu.viewport.height,'Compact search menu fits viewport vertically');checks.compactMenuVisibleAndWithinViewport=true;
 await cdp.call('Emulation.setDeviceMetricsOverride',{width:900,height:720,deviceScaleFactor:1,mobile:false});
 await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
 const resizedMenu=await evaluate(`(()=>{const b=document.querySelector('.global-search-scope-menu'),t=document.querySelector('[data-action="global-search-scope"]');if(!b)return {exists:false};const r=b.getBoundingClientRect(),a=t.getBoundingClientRect();return {exists:true,inert:b.inert,expanded:t.getAttribute('aria-expanded'),menuLeft:r.left,menuRight:r.right,anchorLeft:a.left,viewportWidth:innerWidth}})()`);
 assert.equal(resizedMenu.exists,true,'Open search menu must remain after window resize');
 assert.equal(resizedMenu.inert,false);
 assert.equal(resizedMenu.expanded,'true');
 assert.ok(Math.abs(resizedMenu.menuLeft-Math.max(8,Math.min(resizedMenu.anchorLeft,resizedMenu.viewportWidth-242-16)))<=1,'Search menu follows resized trigger');
 assert.ok(resizedMenu.menuRight<=resizedMenu.viewportWidth,'Resized search menu stays within viewport');
 await frame('search-menu-resized');
 await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:720,deviceScaleFactor:1,mobile:false});
 await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
 const widenedMenu=await evaluate(`(()=>{const b=document.querySelector('.global-search-scope-menu'),t=document.querySelector('[data-action="global-search-scope"]');if(!b)return {exists:false};const r=b.getBoundingClientRect(),a=t.getBoundingClientRect();return {exists:true,inert:b.inert,expanded:t.getAttribute('aria-expanded'),menuLeft:r.left,menuRight:r.right,anchorLeft:a.left,viewportWidth:innerWidth}})()`);
 assert.equal(widenedMenu.exists,true,'Open search menu must remain after widening');
 assert.equal(widenedMenu.inert,false);
 assert.equal(widenedMenu.expanded,'true');
 assert.notEqual(widenedMenu.anchorLeft,resizedMenu.anchorLeft,'Widening must move the search trigger in this test');
 assert.ok(Math.abs(widenedMenu.menuLeft-widenedMenu.anchorLeft)<=1,'Search menu follows widened trigger');checks.resizeKeepsOpenAndRepositions=true;
 await frame('search-menu-widened');
 await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
 await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await pointerClick('[data-action="global-search-scope"]');assert.equal(await evaluate(`document.querySelector('.global-search-scope-menu').getAnimations().length`),0);await pointerClick('[data-action="global-search-scope"]');assert.equal(await evaluate(`!!document.querySelector('.global-search-scope-menu')`),false);checks.reducedMotionDirectBothWays=true;
 assert.deepEqual(await snapshot(),initialDatabase);checks.neverWritesCustomerDatabase=true;
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({testedAt:new Date().toISOString(),app,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),result:'pass',checks,geometry,compactMenu,resizedMenu,widenedMenu,closedStart,closingFrames},null,2));console.log('PASS: '+Object.keys(checks).length+' search menu checks');
}catch(error){console.error('Acceptance failure: '+error.message);if(cdp)await frame('failure').catch(()=>{});throw error;}
finally{cdp?.close();for(const child of children)await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
