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
const evidence=path.resolve(process.env.LAI_DETAIL_TAB_EVIDENCE || 'evidence/ui-1.4.51/detail-tab-feedback');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-summary-layout-'));
const children=[];
const checks={};
const deviceScaleFactor=Number(process.env.LAI_DETAIL_TAB_DPR||1);
assert.ok([1,2].includes(deviceScaleFactor));
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
 await cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
 await cdp.call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
 await cdp.call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
}

async function openDetail(name){await pointerClick('[data-open="'+name+'"]');await until(()=>evaluate(`!!document.querySelector('.lcd-summary-fields')`),'summary detail');await until(()=>evaluate(`!document.getAnimations().some(a=>a.playState==='running'&&a.effect.getTiming().iterations!==Infinity)`),'detail entry stable');}
async function movePointer(selector){const point=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);await cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});}
async function metrics(){return evaluate(`(()=>{const nav=document.querySelector('.lcd-tabs'),indicator=document.querySelector('.lcd-active-indicator'),body=document.querySelector('.lcd-body'),rect=el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};return{selected:nav.querySelector('.active')?.dataset.tab,nav:{rect:rect(nav),scrollLeft:nav.scrollLeft},bodyAnimation:getComputedStyle(body).animationName,bodyTransition:getComputedStyle(body).transitionDuration,indicator:rect(indicator),buttons:[...nav.querySelectorAll('button')].map(el=>{const s=getComputedStyle(el);return{id:el.dataset.tab,selected:el.getAttribute('aria-selected'),color:s.color,transitionProperty:s.transitionProperty,transitionDuration:s.transitionDuration,transitionTiming:s.transitionTimingFunction,fontWeight:s.fontWeight,rect:rect(el)}})}})()`);}
function assertSourceInk(state,button,label){const expectedX=state.nav.rect.x+Math.round(button.rect.x-state.nav.rect.x+state.nav.scrollLeft)-state.nav.scrollLeft;assert.ok(Math.abs(state.indicator.x-expectedX)<.1,label+' rounded ink left');assert.ok(Math.abs(state.indicator.width-Math.round(button.rect.width))<.1,label+' rounded ink width');}
async function key(key,code,virtualKey,text){await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:virtualKey,...(text?{text}:{})});await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:virtualKey});}
try{
 fs.mkdirSync(evidence,{recursive:true});backend=await startBackend();const initial=await snapshot();initial.data.orders=[];initial.data.customers={'Tab Layout':{country:'US',source:'Referral',website:'https://layout.example.test',productType:'Layout Product'}};
 const seeded=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:initial,baseRevision:initial.revision})});assert.equal(seeded.status,200);
 const port=await freePort();const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps',`--user-data-dir=${path.join(temporary,'chrome')}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});children.push(browser);let target;await until(async()=>{try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item=>item.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'browser');
 cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:1022,deviceScaleFactor,mobile:false});await navigate();const baseline=await snapshot();await openDetail('Tab Layout');await movePointer('.lcd-pagebar h1');await pause(350);const resting=await metrics();fs.writeFileSync(path.join(evidence,'resting-observed.json'),JSON.stringify(resting,null,2));await frame('detail-tabs-resting');
 assert.deepEqual(resting.buttons.map(b=>b.id),['activity','info','trade','tips','ai','analytics','documents','history']);assert.equal(resting.selected,'info');checks.existingEightTabsAndDefaultInfoRetained=true;
 const selectedResting=resting.buttons.find(button=>button.id==='info');assert.equal(selectedResting.color,'rgb(10, 106, 255)');assert.equal(selectedResting.fontWeight,'600');checks.sourceSelectedTabColorAndWeightAligned=true;
 assert.ok(Math.abs(resting.buttons[0].rect.x-760)<0.1);assert.ok(Math.abs(resting.buttons[0].rect.width-36.5625)<0.1);assert.ok(Math.abs(selectedResting.rect.x-816.5625)<0.1);assert.ok(Math.abs(selectedResting.rect.width-36.5625)<0.1);checks.sourceRestingTabHorizontalGeometryAligned=true;
 for(const button of resting.buttons){assert.equal(button.transitionProperty,'all','Captured tab button transition property');assert.equal(button.transitionDuration,'0.3s','Captured tab button transition duration');assert.equal(button.transitionTiming,'ease','Captured tab button easing');}checks.sourceButtonTransitionDeclarationAligned=true;
 await movePointer('[data-tab="activity"]');await pause(70);const hover=await metrics();await pause(280);const hovered=await metrics();fs.writeFileSync(path.join(evidence,'hover-observed.json'),JSON.stringify({hover,hovered},null,2));const colorAt=(m,id)=>m.buttons.find(b=>b.id===id).color;assert.notEqual(colorAt(hover,'activity'),colorAt(resting,'activity'));assert.notEqual(colorAt(hover,'activity'),colorAt(hovered,'activity'));assert.equal(colorAt(hovered,'activity'),'rgb(10, 106, 255)');assert.equal(hovered.selected,'info');checks.actualPointerHoverInterpolatesWithoutSelecting=true;
 await pointerClick('[data-tab="activity"]');await until(()=>evaluate(`document.querySelector('[data-tab="activity"]').getAttribute('aria-selected')==='true'`),'activity selected');const active=await metrics();assert.equal(active.bodyAnimation,'none');assert.equal(active.bodyTransition,'0s');assert.equal(active.selected,'activity');checks.contentRemainsImmediateAndUnanimated=true;
 await pause(60);await pointerClick('[data-tab="info"]');await pause(40);await pointerClick('[data-tab="activity"]');await movePointer('.lcd-pagebar h1');await pause(360);const interrupted=await metrics();const activeButton=interrupted.buttons.find(b=>b.id==='activity');fs.writeFileSync(path.join(evidence,'rapid-observed.json'),JSON.stringify(interrupted,null,2));assert.equal(interrupted.selected,'activity');assert.equal(colorAt(interrupted,'activity'),'rgb(10, 106, 255)');assert.equal(activeButton.fontWeight,'600');assert.equal(colorAt(interrupted,'info'),'rgb(51, 51, 51)');assert.equal(interrupted.buttons.filter(b=>b.selected==='true').length,1);assertSourceInk(interrupted,activeButton,'Rapid activity');assert.deepEqual(await snapshot(),baseline);checks.rapidPointerReverseSettlesColorAndIndicatorWithoutWrites=true;await frame('detail-tabs-rapid-final');
 const allTabEndpoints=[];for(const id of resting.buttons.map(b=>b.id)){await pointerClick('[data-tab="'+id+'"]');await movePointer('.lcd-pagebar h1');await pause(350);const state=await metrics();const button=state.buttons.find(b=>b.id===id);allTabEndpoints.push({id,button:button.rect,indicator:state.indicator});fs.writeFileSync(path.join(evidence,'all-tab-endpoints.json'),JSON.stringify(allTabEndpoints,null,2));assert.equal(state.selected,id);assert.equal(state.bodyAnimation,'none');assertSourceInk(state,button,id);}assert.deepEqual(await snapshot(),baseline);checks.allEightTabEndpointsKeepRoundedIndicatorAndReadonlyContent=true;

 await evaluate(`document.querySelector('[data-tab="activity"]').focus()`);await key('Tab','Tab',9);assert.equal(await evaluate(`document.activeElement?.dataset.tab`),'info');await key('Enter','Enter',13,'\r');const keyboard=await metrics();assert.equal(keyboard.selected,'info');assert.equal(await evaluate(`document.activeElement?.dataset.tab`),'info');assert.equal(keyboard.bodyAnimation,'none');assert.deepEqual(await snapshot(),baseline);checks.actualTabEnterRetainsFocusAndImmediateContent=true;
 await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await pointerClick('[data-tab="activity"]');const reduced=await metrics();for(const button of reduced.buttons)assert.ok(Number.parseFloat(button.transitionDuration)<0.001);assert.equal(reduced.selected,'activity');assert.equal(reduced.bodyAnimation,'none');assert.deepEqual(await snapshot(),baseline);checks.isolatedReducedMotionSuppressesFeedbackWithoutSystemChanges=true;await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:720,deviceScaleFactor,mobile:false});await evaluate(`document.querySelector('[data-tab="activity"]').focus()`);await key('Tab','Tab',9);await key('Enter','Enter',13,'\r');await pause(350);assert.equal(await evaluate(`document.activeElement?.dataset.tab`),'info');const compactTabs=await metrics();assert.equal(compactTabs.selected,'info');assert.ok(Math.abs(compactTabs.buttons[0].rect.x-660)<0.1);assert.ok(Math.abs(compactTabs.buttons[0].rect.width-36.5625)<0.1);assert.ok(Math.abs(compactTabs.buttons[1].rect.x-716.5625)<0.1);assert.ok(Math.abs(compactTabs.buttons[1].rect.width-36.5625)<0.1);assert.deepEqual(await snapshot(),baseline);await frame('detail-tabs-compact');checks.compactKeyboardAndSourceTabGeometryRetained=true;
 const compactIndicatorFrames=[];
 for(const [target,from,to] of [['activity',717,660],['info',660,717]]){
  await pointerClick('[data-tab="'+target+'"]');
  const frames=[];
  for(let index=0;index<15;index++){frames.push(await evaluate(`(()=>{const r=document.querySelector('.lcd-active-indicator').getBoundingClientRect();return{time:performance.now(),x:r.x,width:r.width}})()`));await pause(25);}
  const xs=frames.map(frame=>frame.x);
  compactIndicatorFrames.push({target,frames});
  fs.writeFileSync(path.join(evidence,'compact-indicator-trajectory.json'),JSON.stringify(compactIndicatorFrames,null,2));
  assert.ok(Math.abs(xs.at(-1)-to)<0.25,target+' compact indicator endpoint');
  assert.ok(xs.some(x=>x>Math.min(from,to)+2&&x<Math.max(from,to)-2),target+' compact indicator has real intermediate frames');
  for(let index=1;index<xs.length;index++)assert.ok((to<from?xs[index]<=xs[index-1]+.25:xs[index]>=xs[index-1]-.25),target+' compact indicator moves monotonically');
 }
 assert.deepEqual(await snapshot(),baseline);checks.compactIndicatorHasContinuousBidirectionalSourceStyleMovement=true;
 const overflowTrigger=await evaluate(`(()=>{const button=document.querySelector('[data-action="detail-tabs-more"]');return{visible:!!button&&getComputedStyle(button).display!=='none',expanded:button?.getAttribute('aria-expanded')}})()`);
 assert.deepEqual(overflowTrigger,{visible:true,expanded:'false'},'Compact detail must expose source-style hidden tab menu');
 const overflowIcon=await evaluate(`(()=>{const button=document.querySelector('[data-action="detail-tabs-more"]'),svg=button.querySelector('svg'),r=svg?.getBoundingClientRect(),b=button.getBoundingClientRect();return{path:svg?.querySelector('path')?.getAttribute('d'),width:r?.width,height:r?.height,offsetX:r?.x-b.x}})()`);
 assert.deepEqual(overflowIcon,{path:'M176 511a56 56 0 10112 0 56 56 0 10-112 0zm280 0a56 56 0 10112 0 56 56 0 10-112 0zm280 0a56 56 0 10112 0 56 56 0 10-112 0z',width:14,height:14,offsetX:16},'Captured source overflow SVG geometry');
 await pointerClick('[data-action="detail-tabs-more"]');
 assert.deepEqual(await evaluate(`[...document.querySelectorAll('.lcd-tabs-overflow-menu:not([hidden]) [data-overflow-tab]:not([hidden])')].map(button=>button.dataset.overflowTab)`),['analytics','documents','history'],'Only clipped right-side tabs appear in the menu');
 const overflowItemMotion=await evaluate(`(()=>{const item=document.querySelector('.lcd-tabs-overflow-menu:not([hidden]) [data-overflow-tab]:not([hidden])');const style=getComputedStyle(item);return{property:style.transitionProperty,duration:style.transitionDuration,timing:style.transitionTimingFunction}})()`);
 assert.deepEqual(overflowItemMotion,{property:'background-color',duration:'0.3s',timing:'ease'},'Captured source menu hover transition');
 const menuBackground=()=>evaluate(`getComputedStyle(document.querySelector('.lcd-tabs-overflow-menu [data-overflow-tab="analytics"]')).backgroundColor`);
 const menuResting=await menuBackground();
 await movePointer('[data-overflow-tab="analytics"]');await pause(70);
 const menuInterpolating=await menuBackground();await pause(300);
 const menuHovered=await menuBackground();
 assert.equal(menuResting,'rgb(255, 255, 255)');
 assert.notEqual(menuInterpolating,menuResting,'Hover has begun changing the menu background');
 assert.notEqual(menuInterpolating,menuHovered,'Hover background changes over time');
 assert.equal(menuHovered,'rgb(245, 245, 245)','Source hover endpoint');
 const overflowAppearance=await evaluate(`(()=>{const trigger=document.querySelector('[data-action="detail-tabs-more"]'),menu=document.querySelector('.lcd-tabs-overflow-menu'),r=menu.getBoundingClientRect();return{triggerColor:getComputedStyle(trigger).color,menuX:r.x,menuWidth:r.width,menuHeight:r.height}})()`);
 assert.equal(overflowAppearance.triggerColor,'rgb(51, 51, 51)','Source ellipsis stays dark while hovered');
 assert.deepEqual({x:overflowAppearance.menuX,width:overflowAppearance.menuWidth,height:overflowAppearance.menuHeight},{x:940,width:120,height:124});
 await frame('detail-tabs-overflow-menu');
 await key('Escape','Escape',27);
 assert.equal(await evaluate(`document.querySelector('[data-action="detail-tabs-more"]').getAttribute('aria-expanded')`),'false');
 assert.equal(await evaluate(`document.activeElement?.dataset.action`),'detail-tabs-more');
 checks.compactOverflowMenuShowsHiddenTabsAndEscapeRestoresFocus=true;
 await key('ArrowDown','ArrowDown',40);
 assert.equal(await evaluate(`document.querySelector('[data-action="detail-tabs-more"]').getAttribute('aria-expanded')`),'true','ArrowDown on the source-style trigger opens the compact menu');
 assert.deepEqual(await evaluate(`[...document.querySelectorAll('.lcd-tabs-overflow-menu [data-overflow-tab][aria-current="true"]')].map(item=>item.dataset.overflowTab)`),[],'Opening arrow does not yet choose a tab');
 await key('ArrowDown','ArrowDown',40);
 assert.deepEqual(await evaluate(`[...document.querySelectorAll('.lcd-tabs-overflow-menu [data-overflow-tab][aria-current="true"]')].map(item=>item.dataset.overflowTab)`),['analytics'],'Second ArrowDown chooses the first clipped tab');
 await key('ArrowDown','ArrowDown',40);
 assert.deepEqual(await evaluate(`[...document.querySelectorAll('.lcd-tabs-overflow-menu [data-overflow-tab][aria-current="true"]')].map(item=>item.dataset.overflowTab)`),['documents'],'ArrowDown advances to the next clipped tab');
 await key('ArrowUp','ArrowUp',38);
 assert.deepEqual(await evaluate(`[...document.querySelectorAll('.lcd-tabs-overflow-menu [data-overflow-tab][aria-current="true"]')].map(item=>item.dataset.overflowTab)`),['analytics'],'ArrowUp reverses without losing trigger focus');
 assert.equal(await evaluate(`document.activeElement?.dataset.action`),'detail-tabs-more');
 await key('ArrowDown','ArrowDown',40);
 await cdp.call('Emulation.setDeviceMetricsOverride',{width:1200,height:720,deviceScaleFactor,mobile:false});
 await until(()=>evaluate(`innerWidth===1200&&document.querySelector('.lcd-tabs').getBoundingClientRect().width>400`),'1200px detail layout');
 assert.equal(await evaluate(`document.querySelector('[data-action="detail-tabs-more"]').getAttribute('aria-expanded')`),'true','Source keeps its compact menu open across a resize while overflow remains');
 await until(()=>evaluate(`(()=>{const nav=document.querySelector('.lcd-tabs').getBoundingClientRect();return [...document.querySelectorAll('[data-overflow-tab]')].every(item=>{const tab=document.querySelector('[data-tab="'+item.dataset.overflowTab+'"]');const r=tab.getBoundingClientRect();return item.hidden===(r.left>=nav.left-.5&&r.right<=nav.right+.5)})})()`),'resized menu tracks current tab geometry');
 const resizedOverflow=await evaluate(`(()=>{const nav=document.querySelector('.lcd-tabs'),rect=el=>{const r=el.getBoundingClientRect();return{x:r.x,right:r.right,width:r.width}};return{nav:rect(nav),items:[...document.querySelectorAll('[data-tab]')].map(el=>({id:el.dataset.tab,...rect(el)})),overflow:[...document.querySelectorAll('[data-overflow-tab]')].map(el=>({id:el.dataset.overflowTab,hidden:el.hidden,current:el.getAttribute('aria-current')}))}})()`);
 fs.writeFileSync(path.join(evidence,'compact-resize-observed.json'),JSON.stringify(resizedOverflow,null,2));
 for(const item of resizedOverflow.overflow){const button=resizedOverflow.items.find(button=>button.id===item.id);const visible=button.x>=resizedOverflow.nav.x-.5&&button.right<=resizedOverflow.nav.right+.5;assert.equal(item.hidden,visible,`1200px menu visibility for ${item.id}`);}
 assert.deepEqual(resizedOverflow.overflow.filter(item=>item.current==='true'),[],'Resize clears a keyboard cursor against the previous layout');
 await frame('detail-tabs-resized-open');
 await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:720,deviceScaleFactor,mobile:false});
 await until(()=>evaluate(`innerWidth===1100&&document.querySelector('.lcd-tabs').getBoundingClientRect().width<400`),'1100px detail layout');
 assert.equal(await evaluate(`document.querySelector('[data-action="detail-tabs-more"]').getAttribute('aria-expanded')`),'true');
 await until(()=>evaluate(`[...document.querySelectorAll('.lcd-tabs-overflow-menu [data-overflow-tab]:not([hidden])')].map(item=>item.dataset.overflowTab).join(',')==='analytics,documents,history'`),'1100px overflow items refreshed');
 await key('ArrowDown','ArrowDown',40);
 assert.deepEqual(await evaluate(`[...document.querySelectorAll('.lcd-tabs-overflow-menu [data-overflow-tab][aria-current="true"]')].map(item=>item.dataset.overflowTab)`),['analytics'],'After resizing, keyboard selection restarts at first hidden tab');
 await key('Enter','Enter',13,'\r');
 assert.equal((await metrics()).selected,'analytics');
 assert.equal(await evaluate(`document.querySelector('[data-action="detail-tabs-more"]').getAttribute('aria-expanded')`),'true','Source keyboard Enter retains the overflow menu after switching tabs');
 assert.equal(await evaluate(`document.activeElement?.dataset.action`),'detail-tabs-more','Source keyboard Enter retains trigger focus');
 assert.deepEqual(await evaluate(`[...document.querySelectorAll('.lcd-tabs-overflow-menu [data-overflow-tab][aria-current="true"]')].map(item=>item.dataset.overflowTab)`),[],'Selection clears its previous hidden-tab cursor');
 await frame('detail-tabs-keyboard-enter-open');
 await key('Escape','Escape',27);
 assert.equal(await evaluate(`document.querySelector('[data-action="detail-tabs-more"]').getAttribute('aria-expanded')`),'false');
 assert.equal(await evaluate(`document.activeElement?.dataset.action`),'detail-tabs-more');
 assert.deepEqual(await snapshot(),baseline);
 await pointerClick('[data-tab="info"]');
 checks.compactOverflowKeyboardArrowsChooseHiddenTabWithoutWriting=true;
 await evaluate(`document.querySelector('[data-tab="info"]').focus()`);
 for(let i=0;i<6;i++)await key('Tab','Tab',9);assert.equal(await evaluate(`document.activeElement?.dataset.tab`),'history');fs.writeFileSync(path.join(evidence,'compact-nav-before-enter.json'),JSON.stringify(await evaluate(`(()=>{const el=document.querySelector('.lcd-tabs'),s=getComputedStyle(el),r=el.getBoundingClientRect();return{scrollLeft:el.scrollLeft,clientWidth:el.clientWidth,scrollWidth:el.scrollWidth,x:r.x,right:r.right,width:r.width,overflowX:s.overflowX,overflowY:s.overflowY,focus:document.activeElement?.dataset.tab}})()`),null,2));await key('Enter','Enter',13,'\r');await pause(350);const scrolled=await metrics();const scrolledLeft=await evaluate(`document.querySelector('.lcd-tabs').scrollLeft`);const historyButton=scrolled.buttons.find(b=>b.id==='history');fs.writeFileSync(path.join(evidence,'compact-scroll-before-assert.json'),JSON.stringify({scrolledLeft,scrolled},null,2));assert.ok(scrolledLeft>0,'Selected compact tab must scroll into full horizontal visibility');assert.equal(scrolled.selected,'history');const tabViewport=await evaluate(`(()=>{const r=document.querySelector('.lcd-tabs').getBoundingClientRect();return{left:r.left,right:r.right}})()`);assert.ok(historyButton.rect.x>=tabViewport.left-0.1);assert.ok(historyButton.rect.x+historyButton.rect.width<=tabViewport.right+0.1,'Selected label must be fully visible');assertSourceInk(scrolled,historyButton,'Scrolled history');assert.deepEqual(await snapshot(),baseline);fs.writeFileSync(path.join(evidence,'compact-scroll-observed.json'),JSON.stringify({scrolledLeft,scrolled},null,2));await frame('detail-tabs-compact-scrolled');checks.compactActualKeyboardScrollKeepsRoundedIndicator=true;
 await pointerClick('[data-action="detail-tabs-more"]');
 assert.deepEqual(await evaluate(`[...document.querySelectorAll('.lcd-tabs-overflow-menu:not([hidden]) [data-overflow-tab]:not([hidden])')].map(button=>button.dataset.overflowTab)`),['activity','info','trade'],'Scrolled menu exposes clipped left-side tabs');
 await pointerClick('[data-overflow-tab="info"]');
 assert.equal((await metrics()).selected,'info');
 assert.equal(await evaluate(`document.querySelector('[data-action="detail-tabs-more"]').getAttribute('aria-expanded')`),'false');
 assert.equal(await evaluate(`document.activeElement?.dataset.tab`),'info');
 assert.deepEqual(await snapshot(),baseline);
 checks.overflowSelectionReturnsToHiddenTabWithoutSaving=true;

 const responsiveColumns=[];
 for(const [width,leftWidth,rightX,rightWidth] of [[1100,380,644,432],[1440,382.515625,646.515625,769.484375],[1992,480,744,1224]]){
  await cdp.call('Emulation.setDeviceMetricsOverride',{width,height:720,deviceScaleFactor,mobile:false});
  const layout=await evaluate(`(()=>{const row=document.querySelector('.lcd-columns'),left=row.children[0],right=row.children[1],rect=el=>{const r=el.getBoundingClientRect();return{x:r.x,width:r.width}};return{viewport:innerWidth,row:rect(row),left:rect(left),right:rect(right),horizontalOverflow:document.documentElement.scrollWidth>innerWidth}})()`);
  responsiveColumns.push(layout);
  assert.equal(layout.viewport,width);
  assert.ok(Math.abs(layout.row.x-248)<1,`${width}px detail origin`);
  assert.ok(Math.abs(layout.left.width-leftWidth)<1,`${width}px left column`);
  assert.ok(Math.abs(layout.right.x-rightX)<1,`${width}px right origin`);
  assert.ok(Math.abs(layout.right.width-rightWidth)<1,`${width}px right column`);
  assert.equal(layout.horizontalOverflow,false,`${width}px page overflow`);
  await until(async()=>await evaluate(`getComputedStyle(document.querySelector('[data-action="detail-tabs-more"]')).display!=='none'`)=== (width===1100),`${width}px overflow menu visibility`);
 }
 fs.writeFileSync(path.join(evidence,'responsive-columns.json'),JSON.stringify(responsiveColumns,null,2));
 checks.sourceResponsiveColumnsAlignedAtThreeWidths=true;

 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({at:new Date().toISOString(),result:'pass',htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),deviceScaleFactor,checks,resting,hover,hovered,active,interrupted,keyboard,reduced,responsiveColumns,scope:'Captured 300ms ease tab button declaration, local color/rapid reversal/keyboard/reduced paths and source-backed two-column geometry at three widths. Full same-state pixel comparison and continuous/native trajectories remain unaccepted. No new fields or rules; disposable SQLite only.'},null,2));console.log('PASS: '+Object.keys(checks).length+' detail tab feedback checks');
}catch(error){console.error('Acceptance failure: '+error.message);if(cdp)await frame('failure').catch(()=>{});throw error;}
finally{cdp?.close();for(const child of children)await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
