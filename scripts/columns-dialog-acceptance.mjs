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
const evidence=path.resolve(process.env.LAI_COLUMNS_EVIDENCE || 'evidence/ui-1.4.12/columns');
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
 const point=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();if(!r.width||!r.height)throw Error('Pointer target is hidden: '+${JSON.stringify(selector)});return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
 await cdp.call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
 await cdp.call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
}
async function pointerDrag(sourceSelector,targetSelector){
 const points=await evaluate(`(()=>{const a=document.querySelector(${JSON.stringify(sourceSelector)}).getBoundingClientRect(),b=document.querySelector(${JSON.stringify(targetSelector)}).getBoundingClientRect();return{from:{x:a.left+a.width/2,y:a.top+a.height/2},to:{x:b.left+b.width/2,y:b.top+4}}})()`);
 await pointerDragPoints(points);
}
async function pointerDragPoints(points){
 await cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',...points.from,button:'none',buttons:0});
 await cdp.call('Input.dispatchMouseEvent',{type:'mousePressed',...points.from,button:'left',buttons:1,clickCount:1});
 for(let i=1;i<=12;i++){await cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:points.from.x+(points.to.x-points.from.x)*i/12,y:points.from.y+(points.to.y-points.from.y)*i/12,button:'left',buttons:1});await pause(16);}
 for(let i=0;i<3;i++){await cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',...points.to,button:'left',buttons:1});await pause(50);}
 await cdp.call('Input.dispatchMouseEvent',{type:'mouseReleased',...points.to,button:'left',buttons:0,clickCount:1});
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


 const baseline=await snapshot();
 async function columns(){await pointerClick('[data-action="table-options"]');await until(()=>evaluate(`!!document.querySelector('.table-popover [data-action="settings"]')`),'column options menu');await pause(100);await pointerClick('.table-popover [data-action="settings"]');await until(()=>evaluate(`!!document.querySelector('.columns-dialog')`),'column settings dialog');}
 if(process.env.LAI_COLUMNS_CANCEL_ONLY==='1'){
   const readDraft=()=>evaluate(`(()=>({fields:[...document.querySelectorAll('.columns-dialog [data-column-toggle]')].map(el=>({id:el.dataset.columnToggle,checked:el.checked})),order:[...document.querySelectorAll('.columns-dialog [data-drag-field]')].map(el=>el.dataset.dragField)}))()`);
   const outcomes=[];
   for(const method of ['keyboard-escape','pointer-mask']){
     await columns();await pause(250);
     const original=await readDraft();
     assert.equal(original.fields.find(field=>field.id==='timezone')?.checked,false);
     await pointerClick('.columns-dialog .drawer-head h2');
     assert.ok(await evaluate(`!!document.querySelector('.columns-dialog')`),'Clicking inside the dialog must not cancel it');
     checks[method+'InsideClickKeepsDraft']=true;
     await pointerClick('.columns-dialog [data-column-toggle="timezone"]');
     assert.equal(await evaluate(`document.querySelector('.columns-dialog [data-column-toggle="timezone"]').checked`),true);
     checks[method+'DraftChanged']=true;
     await frame(method+'-unsaved');
     if(method==='keyboard-escape'){
       await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
       await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
     }else{
       const point=await evaluate(`(()=>{const r=document.querySelector('.columns-dialog').getBoundingClientRect();return{x:r.left-24,y:r.top+r.height/2,hit:document.elementFromPoint(r.left-24,r.top+r.height/2)?.className}})()`);
       assert.ok(point.hit?.includes('overlay'),'Click must reach the mask, not a dialog control');
       await cdp.call('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});
       await cdp.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1});
     }
     await until(()=>evaluate(`!document.querySelector('.overlay')`),method+' closed without a prompt');
     checks[method+'ClosesWithoutPrompt']=true;
     assert.deepEqual(await snapshot(),baseline);checks[method+'NoDatabaseWrite']=true;
     await columns();await pause(250);
     const reopened=await readDraft();assert.deepEqual(reopened,original);
     checks[method+'OriginalFieldsAndOrderRestored']=true;
     outcomes.push({method,original,reopened});await frame(method+'-reopened');
     await pointerClick('.columns-dialog .drawer-footer [data-action="close-modal"]');
     await until(()=>evaluate(`!document.querySelector('.overlay')`),'reopened draft cancelled');
   }
   await openEditor('Motion Customer');await pause(250);
   const editMask=await evaluate(`(()=>{const r=document.querySelector('.drawer').getBoundingClientRect();return{x:r.left-24,y:r.top+r.height/2,hit:document.elementFromPoint(r.left-24,r.top+r.height/2)?.className}})()`);
   assert.ok(editMask.hit?.includes('overlay'));
   await cdp.call('Input.dispatchMouseEvent',{type:'mousePressed',x:editMask.x,y:editMask.y,button:'left',clickCount:1});
   await cdp.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:editMask.x,y:editMask.y,button:'left',clickCount:1});
   assert.ok(await evaluate(`!!document.querySelector('#customer-form')`),'The column mask fix must not change customer-editor dismissal');
   checks.customerEditorMaskBehaviorUnchanged=true;
   await pointerClick('.drawer-head [data-action="close-modal"]');
   await until(()=>evaluate(`!document.querySelector('.overlay')`),'unrelated customer editor cancelled');
   assert.deepEqual(await snapshot(),baseline);checks.finalDatabaseUnchanged=true;
   fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({testedAt:new Date().toISOString(),app,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),result:'pass',scope:'unsaved-columns-keyboard-and-mask-cancel',checks,outcomes},null,2));
   console.log('PASS: '+Object.keys(checks).length+' unsaved column exit checks');
 }else{
 const searchTrigger=await evaluate(`(()=>{const b=document.querySelector('[data-action="global-search-scope"]'),s=getComputedStyle(b);return{width:b.getBoundingClientRect().width,font:s.fontSize,color:s.color,inputFont:getComputedStyle(document.querySelector('#global-search-form input')).fontSize}})()`);
 assert.deepEqual(searchTrigger,{width:100,font:'14px',color:'rgb(51, 51, 51)',inputFont:'14px'});checks.searchTriggerMatchesSource=true;
 await pointerClick('[data-action="global-search-scope"]');await evaluate(`document.querySelector('[data-global-field="nameOrShort"]').click()`);assert.equal(await evaluate(`document.querySelector('.global-search-label').title`),'客户名称/简称');assert.equal(await evaluate(`document.querySelector('[data-action="global-search-scope"]').getBoundingClientRect().width`),100);checks.longSearchScopeKeepsWidthAndFullTitle=true;
 await columns();
 const entering=await evaluate(`(()=>{const d=document.querySelector('.columns-dialog'),o=d.closest('.overlay'),s=getComputedStyle(d),m=getComputedStyle(o,'::before');return{duration:s.transitionDuration,easing:s.transitionTimingFunction,maskDuration:m.transitionDuration,maskEasing:m.transitionTimingFunction,parentOpacity:getComputedStyle(o).opacity}})()`);
 assert.equal(entering.duration,'0.2s, 0.2s');assert.equal(entering.easing,'cubic-bezier(0.08, 0.82, 0.17, 1), cubic-bezier(0.08, 0.82, 0.17, 1)');assert.equal(entering.maskDuration,'0.2s');assert.equal(entering.maskEasing,'linear');assert.equal(entering.parentOpacity,'1');
 const entryFrames=await trace('.columns-dialog','transform',260);assert.ok(entryFrames.some(f=>{const y=Number(f.transform.match(/^matrix\(([^)]+)\)$/)?.[1].split(',')[5]||0);return y>0&&f.opacity>0&&f.opacity<1;}),'Visible bottom-up entrance frames');checks.source200msEntryWithIndependentMask=true;
 const geometry=await evaluate(`(()=>{const d=document.querySelector('.columns-dialog'),b=d.querySelector('.columns-body'),l=d.querySelector('.columns-layout'),r=d.getBoundingClientRect();return{width:r.width,height:r.height,top:r.top,left:r.left,header:d.querySelector('.drawer-head').getBoundingClientRect().height,footer:d.querySelector('.drawer-footer').getBoundingClientRect().height,radius:getComputedStyle(d).borderRadius,bodyPadding:getComputedStyle(b).padding,layoutOverflow:getComputedStyle(l).overflowY,checkbox:(()=>{const c=d.querySelector('input[type=checkbox]'),s=getComputedStyle(c);return{appearance:s.appearance,radius:s.borderRadius,width:c.getBoundingClientRect().width,height:c.getBoundingClientRect().height}})(),availableHeadingTop:d.querySelector('.columns-layout h3').getBoundingClientRect().top,firstCategoryTop:d.querySelector('.available-fields h4').getBoundingClientRect().top,firstFieldTop:d.querySelector('.available-fields label').getBoundingClientRect().top,ratio:l.children[0].getBoundingClientRect().width/l.children[1].getBoundingClientRect().width}})()`);
 assert.equal(geometry.width,688);assert.equal(geometry.height,958);assert.equal(geometry.top,32);assert.equal(geometry.left,534);assert.equal(geometry.header,61);assert.equal(geometry.footer,65);assert.equal(geometry.radius,'8px');assert.equal(geometry.bodyPadding,'16px 0px');assert.equal(geometry.layoutOverflow,'auto');assert.deepEqual(geometry.checkbox,{appearance:'none',radius:'2px',width:16,height:16});assert.equal(geometry.availableHeadingTop,173);assert.equal(geometry.firstCategoryTop,201);assert.ok(Math.abs(geometry.firstFieldTop-233.8)<.1);assert.ok(Math.abs(geometry.ratio-2)<.02);checks.sourceDialogGeometryAndTwoToOneColumns=true;
 await frame('columns-desktop');
 const fixedPositions=await evaluate(`(()=>{const d=document.querySelector('.columns-dialog');return{head:d.querySelector('.drawer-head').getBoundingClientRect().top,foot:d.querySelector('.drawer-footer').getBoundingClientRect().top}})()`);
 await evaluate(`document.querySelector('.columns-layout').scrollTop=300`);assert.ok(await evaluate(`document.querySelector('.columns-layout').scrollTop>0`));assert.deepEqual(await evaluate(`(()=>{const d=document.querySelector('.columns-dialog');return{head:d.querySelector('.drawer-head').getBoundingClientRect().top,foot:d.querySelector('.drawer-footer').getBoundingClientRect().top}})()`),fixedPositions);checks.fieldScrollKeepsHeaderAndFooterFixed=true;
 await pointerClick('.drawer-head [data-action="close-modal"]');const exiting=await evaluate(`(()=>{const d=document.querySelector('.columns-dialog'),s=getComputedStyle(d);return{inert:d.inert,duration:s.transitionDuration,easing:s.transitionTimingFunction,parentOpacity:getComputedStyle(d.closest('.overlay')).opacity}})()`);assert.equal(exiting.inert,true);assert.ok(exiting.duration.split(',').every(value=>Number.parseFloat(value)===.2));assert.equal(exiting.easing,'cubic-bezier(0.6, 0.04, 0.98, 0.34)');assert.equal(exiting.parentOpacity,'1');const exitFrames=await trace('.columns-dialog','transform',260);assert.ok(exitFrames.some(f=>f.animations.filter(a=>['transform','opacity'].includes(a.property)&&a.duration===200).length===2),'Both actual exit transitions last 200ms');assert.ok(exitFrames.some(f=>f.opacity>0&&f.opacity<1&&Number(f.transform.match(/^matrix\(([^)]+)\)$/)?.[1].split(',')[5]||0)>0));await until(()=>evaluate(`!document.querySelector('.overlay')`),'column close completed');assert.equal(await evaluate(`document.activeElement?.dataset.action`),'table-options');checks.source200msExitAndFocusReturn=true;
 await columns();await pause(250);
 const scrolledToggle=await evaluate(`(()=>{const area=document.querySelector('.columns-dialog .columns-layout');area.scrollTop=300;const bounds=area.getBoundingClientRect();const field=[...area.querySelectorAll('[data-column-toggle]:not(:checked):not(:disabled)')].find(el=>{const r=el.getBoundingClientRect();return r.top>bounds.top+60&&r.bottom<bounds.bottom-60});if(!field)throw Error('No visible unchecked column at scrolled position');return{id:field.dataset.columnToggle,top:area.scrollTop}})()`);
 await pointerClick(`[data-column-toggle="${scrolledToggle.id}"]`);
 const scrollAfterToggle=await evaluate(`(()=>({top:document.querySelector('.columns-dialog .columns-layout').scrollTop,checked:document.querySelector('[data-column-toggle="${scrolledToggle.id}"]')?.checked,focused:document.activeElement?.dataset.columnToggle}))()`);
 assert.equal(scrollAfterToggle.checked,true,'Clicked field must remain selected in the draft');
 assert.ok(Math.abs(scrollAfterToggle.top-scrolledToggle.top)<=1,'Checking a visible field must preserve the current list scroll position');checks.scrolledColumnSelectionKeepsPosition=true;
 assert.equal(scrollAfterToggle.focused,scrolledToggle.id,'The selected field must retain keyboard focus after redraw');checks.scrolledColumnSelectionKeepsFocus=true;await frame('columns-scrolled-after-selection');
 await evaluate(`(()=>{const input=document.querySelector('#column-search');input.value='社交';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.columns-layout').scrollTop=0})()`);
 await pointerClick('[data-column-toggle="socialPlatforms"]');
 const searchAfterToggle=await evaluate(`(()=>({query:document.querySelector('#column-search')?.value,visible:[...document.querySelectorAll('[data-field-label]')].filter(el=>!el.hidden).map(el=>el.dataset.fieldLabel)}))()`);
 assert.equal(searchAfterToggle.query,'社交','Selecting a searched field must preserve the search draft');
 assert.ok(searchAfterToggle.visible.length>0&&searchAfterToggle.visible.every(label=>label.includes('社交')));checks.columnSearchSurvivesSelection=true;await frame('columns-search-after-selection');
 const handleRest=await evaluate(`(()=>{const row=document.querySelector('.columns-dialog .selected-fields:nth-of-type(2) [data-drag-field]')||[...document.querySelectorAll('.columns-dialog .selected-fields')][1].querySelector('[data-drag-field]');return{rowDraggable:row.draggable,handleDraggable:row.querySelector('.drag-handle').draggable,handleVisibility:getComputedStyle(row.querySelector('.drag-handle')).visibility,handleDisplay:getComputedStyle(row.querySelector('.drag-handle')).display}})()`);
 assert.equal(handleRest.rowDraggable,true);assert.equal(handleRest.handleDraggable,false);assert.equal(handleRest.handleVisibility,'hidden');assert.notEqual(handleRest.handleDisplay,'none');checks.rowAndHandleMatchSourceDragAffordance=true;
 const grip=await evaluate(`(()=>{const svg=[...document.querySelectorAll('.columns-dialog .selected-fields')][1].querySelector('.drag-handle svg');if(!svg)return null;const r=svg.getBoundingClientRect();return{width:r.width,height:r.height,color:getComputedStyle(svg).color,shape:svg.querySelector('path')?.getAttribute('d')}})()`);
 assert.equal(grip?.width,16);assert.equal(grip?.height,16);assert.equal(grip?.color,'rgb(102, 102, 102)');assert.ok(grip?.shape?.includes('M19 10'));checks.sixDotGripMatchesSource=true;
 const handlePoint=await evaluate(`(()=>{const handle=[...document.querySelectorAll('.columns-dialog .selected-fields')][1].querySelector('.drag-handle'),rect=handle.getBoundingClientRect();return{x:rect.left+rect.width/2,y:rect.top+rect.height/2}})()`);
 await cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',...handlePoint});
 assert.equal(await evaluate(`getComputedStyle([...document.querySelectorAll('.columns-dialog .selected-fields')][1].querySelector('.drag-handle')).visibility`),'visible');await frame('columns-handle-hover');checks.pointerHoverRevealsDragHandle=true;
 const reorder=await evaluate(`(()=>{const group=[...document.querySelectorAll('.columns-dialog .selected-fields')][1],rows=[...group.querySelectorAll('[data-drag-field]')],before=rows.slice(0,3).map(row=>row.dataset.dragField),transfer=new DataTransfer();rows[0].querySelector('span:nth-child(2)').dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer}));const target=rows[2],rect=target.getBoundingClientRect();target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer,clientY:rect.top+4}));return{before,after:[...[...document.querySelectorAll('.columns-dialog .selected-fields')][1].querySelectorAll('[data-drag-field]')].slice(0,3).map(row=>row.dataset.dragField)}})()`);
 assert.deepEqual(reorder.after,[reorder.before[1],reorder.before[2],reorder.before[0]],'Dropping above the midpoint of the third row moves the first row after it');checks.sameSectionDragUsesDropPosition=true;
 await evaluate(`(()=>{const input=document.querySelector('#column-search');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.columns-layout').scrollTop=0})()`);
 await pointerClick('[data-column-toggle="source"]');assert.ok(await evaluate(`!!document.querySelector('[data-column-toggle="source"]')`));await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);assert.equal(await evaluate(`!!document.querySelector('.overlay')`),false);assert.deepEqual(await snapshot(),baseline);checks.cancelColumnDraftNeverWrites=true;
 for(let i=0;i<3;i++){await columns();await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);assert.equal(await evaluate(`!!document.querySelector('.overlay')`),false);}checks.interruptedOpeningsLeaveNoOverlay=true;
 await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:720,deviceScaleFactor:1,mobile:false});await pause(120);await columns();await pause(250);await frame('columns-compact');
 await cdp.call('Emulation.setDeviceMetricsOverride',{width:640,height:640,deviceScaleFactor:1,mobile:false});const compact=await evaluate(`(()=>{const d=document.querySelector('.columns-dialog'),r=d.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,footerHeight:d.querySelector('.drawer-footer').getBoundingClientRect().height}})()`);assert.ok(compact.left>=16&&compact.right<=624&&compact.top>=16&&compact.bottom<=624);assert.equal(compact.footerHeight,65);await frame('columns-short-window');checks.narrowAndShortWindowsRemainUsable=true;
 await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:720,deviceScaleFactor:1,mobile:false});await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await pause(120);await columns();const reducedFrames=await trace('.columns-dialog','transform',160);assert.ok(reducedFrames.every(f=>Number(f.transform.match(/^matrix\(([^)]+)\)$/)?.[1].split(',')[5]||0)===0));assert.equal(await evaluate(`getComputedStyle(document.querySelector('.columns-dialog')).transitionDuration`),'0.08s');await pointerClick('.drawer-head [data-action="close-modal"]');await until(()=>evaluate(`!document.querySelector('.overlay')`),'reduced columns close');checks.reducedMotionFadesWithoutTranslation=true;
 assert.deepEqual(await snapshot(),baseline);checks.noCustomerOrPreferencesWrites=true;
 await cdp.call('Emulation.setEmulatedMedia',{features:[]});await columns();await pause(250);
 const savedOrder=await evaluate(`(()=>{const rows=[...[...document.querySelectorAll('.columns-dialog .selected-fields')][1].querySelectorAll('[data-drag-field]')],before=rows.slice(0,3).map(row=>row.dataset.dragField),transfer=new DataTransfer();rows[0].querySelector('.drag-handle').dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer}));rows[2].dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));return[before[1],before[2],before[0]]})()`);
 await pointerClick('.columns-dialog [data-action="save-columns"]');await until(()=>evaluate(`!document.querySelector('.columns-dialog')`),'column order saved');
 assert.deepEqual((await snapshot()).data.previewTable.order.slice(1,4),savedOrder);await navigate();await columns();await pause(250);
 assert.deepEqual(await evaluate(`[...[...document.querySelectorAll('.columns-dialog .selected-fields')][1].querySelectorAll('[data-drag-field]')].slice(0,3).map(row=>row.dataset.dragField)`),savedOrder);checks.dragOrderPersistsAfterReload=true;
 const beforePointerDrag=await evaluate(`[...[...document.querySelectorAll('.columns-dialog .selected-fields')][1].querySelectorAll('[data-drag-field]')].slice(0,3).map(row=>row.dataset.dragField)`);
 const beforePointerDraft=await snapshot();
 await evaluate(`(()=>{window.__laiPointerDragTrace=[];for(const type of ['dragstart','dragover','drop','dragend'])document.addEventListener(type,event=>window.__laiPointerDragTrace.push({type,field:event.target.closest?.('[data-drag-field]')?.dataset.dragField||''}),{once:false,capture:true})})()`);
 const pointerPlan=await evaluate(`(()=>{const target=document.querySelector('.columns-dialog .selected-fields:nth-of-type(2) [data-drag-field]:nth-child(3)'),r=target.getBoundingClientRect();return{target:target.dataset.dragField,top:r.top,height:r.height,atTop:document.elementFromPoint(r.left+r.width/2,r.top+4)?.closest('[data-drag-field]')?.dataset.dragField}})()`);
 await pointerDrag('.columns-dialog .selected-fields:nth-of-type(2) [data-drag-field]:first-child > span:nth-child(2)','.columns-dialog .selected-fields:nth-of-type(2) [data-drag-field]:nth-child(3)');
 const afterPointerDrag=await evaluate(`[...[...document.querySelectorAll('.columns-dialog .selected-fields')][1].querySelectorAll('[data-drag-field]')].slice(0,3).map(row=>row.dataset.dragField)`);
 const pointerTrace=await evaluate(`window.__laiPointerDragTrace`);
 assert.deepEqual(afterPointerDrag,[beforePointerDrag[1],beforePointerDrag[2],beforePointerDrag[0]],'Real pointer gesture reorders from row text: '+JSON.stringify({pointerPlan,pointerTrace}));checks.realPointerTextDragReorders=true;
 assert.ok(pointerTrace.some(event=>event.type==='dragstart'&&event.field===beforePointerDrag[0]));assert.ok(pointerTrace.some(event=>event.type==='drop'&&event.field===beforePointerDrag[2]));await frame('columns-pointer-drag');checks.realPointerEventsReachedTarget=true;
 await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:1022,deviceScaleFactor:1,mobile:false});await pause(120);
 const blankDropPlan=await evaluate(`(()=>{const group=[...document.querySelectorAll('.columns-dialog .selected-fields')][1],row=group.querySelector('[data-drag-field]'),source=row.querySelector('span:nth-child(2)').getBoundingClientRect(),list=group.getBoundingClientRect(),section=group.closest('section').getBoundingClientRect(),to={x:list.left+80,y:list.bottom+8};return{field:row.dataset.dragField,from:{x:source.left+source.width/2,y:source.top+source.height/2},to,sectionBottom:section.bottom,hit:document.elementFromPoint(to.x,to.y)?.className}})()`);
 assert.ok(blankDropPlan.to.y<blankDropPlan.sectionBottom,'The test drop point must be inside the right panel below the selected rows');
 await pointerDragPoints(blankDropPlan);
 const blankDropOrder=await evaluate(`[...[...document.querySelectorAll('.columns-dialog .selected-fields')][1].querySelectorAll('[data-drag-field]')].map(row=>row.dataset.dragField)`);
 assert.equal(blankDropOrder.at(-1),blankDropPlan.field,'Dropping below the last row must move the dragged field to the end');checks.realPointerBlankTailDropMovesToEnd=true;
 await frame('columns-blank-tail-drop');
 await pointerClick('.columns-dialog [data-action="close-modal"]');
 assert.deepEqual(await snapshot(),beforePointerDraft);checks.pointerDragCancelKeepsSavedOrder=true;
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({testedAt:new Date().toISOString(),app,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),result:'pass',checks,searchTrigger,entering,geometry,exiting,entryFrames,exitFrames,compact,reducedFrames,pointerPlan,pointerTrace,beforePointerDrag,afterPointerDrag,blankDropPlan,blankDropOrder},null,2));console.log('PASS: '+Object.keys(checks).length+' column dialog checks');
 }
}catch(error){console.error('Acceptance failure: '+error.message);if(cdp)await frame('failure').catch(()=>{});throw error;}
finally{cdp?.close();for(const child of children)await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
