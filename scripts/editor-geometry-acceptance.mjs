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
const evidence=path.resolve(process.env.LAI_EDITOR_GEOMETRY_EVIDENCE || 'evidence/ui-1.4.20/editor-geometry');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-editor-geometry-'));
const children=[];
const checks={};
const methodLayouts={};
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

async function settle(){await until(()=>evaluate(`!document.getAnimations().some(a=>a.playState==='running'&&a.effect.getTiming().iterations!==Infinity)`),'drawer settled');}
async function metrics(){return evaluate(`(()=>{const b=document.querySelector('.ce-body'),g=document.querySelector('.ce-columns'),d=b.closest('.drawer'),box=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return{x:r.x,y:r.y,width:r.width,height:r.height,offset:e.offsetWidth,client:e.clientWidth,scroll:e.scrollHeight,padding:s.padding}};return{viewport:{width:innerWidth,height:innerHeight},drawer:box(d),body:box(b),grid:box(g),columns:[...g.children].map(box),scrollbarWidth:getComputedStyle(b,'::-webkit-scrollbar').width,scrollbarHeight:getComputedStyle(b,'::-webkit-scrollbar').height,thumb:{background:getComputedStyle(b,'::-webkit-scrollbar-thumb').backgroundColor,radius:getComputedStyle(b,'::-webkit-scrollbar-thumb').borderRadius},track:getComputedStyle(b,'::-webkit-scrollbar-track').backgroundColor,header:box(d.querySelector('.drawer-head')),footer:box(d.querySelector('.drawer-footer'))}})()`);}
try{
 fs.mkdirSync(evidence,{recursive:true});backend=await startBackend();const initial=await snapshot();
 initial.data.customers={'Geometry Customer':{country:'US',source:'Referral',contact:'Main',email:'main@example.test',phone:'5550101'}};initial.data.orders=[];
 const seeded=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:initial,baseRevision:initial.revision})});assert.equal(seeded.status,200);
 const port=await freePort();const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps',`--user-data-dir=${path.join(temporary,'chrome')}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});children.push(browser);
 let target;await until(async()=>{try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item=>item.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'browser');
 cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1728,height:958,deviceScaleFactor:1,mobile:false});await navigate();const baseline=await snapshot();
 await evaluate(`document.querySelector('[data-open="Geometry Customer"]').click()`);await until(()=>evaluate(`!!document.querySelector('.lcd-pagebar [data-action="edit"]')`),'detail');await evaluate(`document.querySelector('.lcd-pagebar [data-action="edit"]').click()`);await until(()=>evaluate(`!!document.querySelector('#customer-form')`),'editor');await settle();
 for (const kind of ['company','contact']) {
  const section='#customer-form .ce-'+kind+'-extra';
  const draftField=kind==='company'?'[name="note"]':'[name="contactNote"]';
  await evaluate(`document.querySelector(${JSON.stringify(section+' > summary')}).scrollIntoView({block:'center',behavior:'instant'})`);
  await pointerClick(section+' > summary');
  assert.deepEqual(await evaluate(`(()=>{const s=document.querySelector(${JSON.stringify(section)}),c=s.querySelector('.ce-extra-content'),css=getComputedStyle(c);return {open:s.open,animated:c.getAnimations().length,opacity:css.opacity,transform:css.transform}})()`),{open:true,animated:0,opacity:'1',transform:'none'});
  await evaluate(`document.querySelector(${JSON.stringify(section+' '+draftField)}).value='Unsaved edit draft'`);
  checks[`edit${kind}OptionalOpensImmediately`]=true;
 }
 assert.deepEqual(await evaluate(`({company:document.querySelector('.ce-company-extra').open,contact:document.querySelector('.ce-contact-extra').open})`),{company:true,contact:true});checks.editOptionalSectionsExpandIndependently=true;
 for (const kind of ['contact','company']) {
  const section='#customer-form .ce-'+kind+'-extra';
  const draftField=kind==='company'?'[name="note"]':'[name="contactNote"]';
  await evaluate(`document.querySelector(${JSON.stringify(section+' .ce-collapse')}).scrollIntoView({block:'center',behavior:'instant'})`);
  await pointerClick(section+' .ce-collapse');
  assert.deepEqual(await evaluate(`(()=>{const s=document.querySelector(${JSON.stringify(section)});return {open:s.open,animated:s.querySelector('.ce-extra-content').getAnimations().length,focus:document.activeElement===s.querySelector('summary'),draft:s.querySelector(${JSON.stringify(draftField)}).value}})()`),{open:false,animated:0,focus:true,draft:'Unsaved edit draft'});
  checks[`edit${kind}OptionalClosesAndPreservesDraft`]=true;
 }
 for (const kind of ['social','phone']) {
  const addedRows=await evaluate(`(()=>{const card=document.querySelector('[data-contact-card="0"]'),add=card.querySelector('[data-method-type="${kind}"]');add.click();add.click();const list=card.querySelector('[data-method-list="${kind}"]'),main=add.closest('.ce-paired'),rows=[...list.querySelectorAll('[data-method-row]')],remove=rows[0].querySelector('[data-editor-action="remove-method"]'),box=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};return {count:rows.length,mainHeight:main.getBoundingClientRect().height,rowHeights:rows.map(row=>row.getBoundingClientRect().height),firstGap:rows[0].getBoundingClientRect().top-main.getBoundingClientRect().bottom,nextGap:rows[1].getBoundingClientRect().top-rows[0].getBoundingClientRect().bottom,mainColumns:getComputedStyle(main).gridTemplateColumns,extraColumns:getComputedStyle(rows[0]).gridTemplateColumns,addButton:box(add),addIcon:box(add.querySelector('svg')),removeButton:box(remove),removeIcon:remove.querySelector('svg')?box(remove.querySelector('svg')):null}})()`);
  methodLayouts[kind]=addedRows;
  assert.equal(addedRows.count,2,`${kind} adds two editable rows`);
  assert.equal(addedRows.mainHeight,32,`${kind} main row matches source height`);
  assert.deepEqual(addedRows.rowHeights,[32,32],`${kind} extra rows match source height`);
  assert.equal(addedRows.firstGap,20,`${kind} first extra row has source 20px gap`);
  assert.equal(addedRows.nextGap,20,`${kind} following extra row has source 20px gap`);
  assert.equal(Number(addedRows.mainColumns.split(' ').at(-1).replace('px','')),48,`${kind} primary control column matches source`);
  assert.equal(Number(addedRows.extraColumns.split(' ').at(-1).replace('px','')),48,`${kind} extra control column matches source`);
  assert.equal(addedRows.addButton.width,48,`${kind} add control covers source-width area`);
  assert.equal(addedRows.addIcon.width,20,`${kind} add glyph matches source width`);
  assert.equal(addedRows.addIcon.height,18,`${kind} add glyph matches source height`);
  assert.equal(addedRows.addIcon.x,addedRows.addButton.x,`${kind} add glyph starts at control edge`);
  assert.equal(addedRows.removeButton.width,48,`${kind} remove control covers source-width area`);
  assert.equal(addedRows.removeIcon?.width,20,`${kind} remove glyph matches source width`);
  assert.equal(addedRows.removeIcon?.height,18,`${kind} remove glyph matches source height`);
  assert.equal(addedRows.removeIcon?.x,addedRows.removeButton.x,`${kind} remove glyph starts at control edge`);
  checks[`${kind}AdditionalRowSpacing`]=true;
 }
 await pointerClick('#customer-form [data-contact-card="0"] [data-method-type="social"]');
 assert.deepEqual(await evaluate(`({count:document.querySelectorAll('#customer-form [data-contact-card="0"] [data-method-list="social"] [data-method-row]').length,focusOnDrawer:document.activeElement===document.querySelector('.customer-editor')})`),{count:3,focusOnDrawer:true},'Pointer add returns focus to the drawer like the source');
 await pointerClick('#customer-form [data-contact-card="0"] [data-method-list="social"] [data-method-row]:last-child [data-editor-action="remove-method"]');
 assert.deepEqual(await evaluate(`({count:document.querySelectorAll('#customer-form [data-contact-card="0"] [data-method-list="social"] [data-method-row]').length,focusOnDrawer:document.activeElement===document.querySelector('.customer-editor')})`),{count:2,focusOnDrawer:true},'Pointer remove returns focus to the drawer like the source');
 checks.pointerMethodFocusMatchesSource=true;
 const keyboardMethodFocus=await evaluate(`(()=>{const card=document.querySelector('#customer-form [data-contact-card="0"]'),add=card.querySelector('[data-method-type="social"]');add.click();const last=card.querySelector('[data-method-list="social"] [data-method-row]:last-child'),focusOnNewInput=document.activeElement===last.querySelector('[data-method-value]');last.querySelector('[data-editor-action="remove-method"]').click();return {focusOnNewInput,focusOnAddAfterRemove:document.activeElement===add}})()`);
 assert.deepEqual(keyboardMethodFocus,{focusOnNewInput:true,focusOnAddAfterRemove:true},'Keyboard method controls keep an explicit focus destination');
 checks.keyboardMethodFocusPreserved=true;
 const before=await metrics();fs.writeFileSync(path.join(evidence,'initial-metrics.json'),JSON.stringify(before,null,2));
 assert.equal(before.body.offset-before.body.client,8,'Editor vertical scrollbar must reserve source 8px');assert.equal(before.drawer.width,840);assert.equal(before.body.padding,'16px 24px');assert.equal(before.grid.width,784);assert.deepEqual(before.columns.map(c=>c.width),[380,380]);assert.equal(before.columns[1].x-before.columns[0].x-before.columns[0].width,24);assert.equal(before.header.height,56);assert.equal(before.footer.height,64);checks.sameViewportSourceColumnGeometry=true;
 assert.equal(before.scrollbarWidth,'8px');assert.equal(before.scrollbarHeight,'8px');assert.equal(before.thumb.background,'rgb(158, 161, 168)');assert.equal(before.thumb.radius,'12px');assert.equal(before.track,'rgb(235, 237, 240)');checks.sourceScrollbarAppearance=true;await frame('editor-1728');
 const trigger='#ce-previewGroup + .lai-select-trigger';await evaluate(`document.querySelector(${JSON.stringify(trigger)}).scrollIntoView({block:'center',behavior:'instant'})`);await pointerClick(trigger);await settle();const popup=await evaluate(`(()=>{const a=document.querySelector(${JSON.stringify(trigger)}).getBoundingClientRect(),m=document.querySelector('.lai-select-menu').getBoundingClientRect();return{triggerWidth:a.width,menuWidth:m.width,leftDelta:m.left-a.left}})()`);assert.equal(popup.triggerWidth,380);assert.equal(popup.menuWidth,380);assert.equal(popup.leftDelta,0);checks.groupMenuTracksCorrectedWidth=true;await frame('group-menu-1728');await evaluate(`document.querySelector(${JSON.stringify(trigger)}).dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
 await evaluate(`document.querySelector('.ce-body').scrollTop=document.querySelector('.ce-body').scrollHeight`);const scrolled=await metrics();assert.ok(await evaluate(`document.querySelector('.ce-body').scrollTop>0`));assert.equal(scrolled.footer.y+scrolled.footer.height,958);assert.equal(scrolled.header.y,0);checks.scrollLeavesHeaderAndFooterFixed=true;await frame('editor-bottom-1728');
 await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:720,deviceScaleFactor:1,mobile:false});await settle();const compact=await metrics();assert.deepEqual(compact.columns.map(c=>c.width),[380,380]);assert.equal(compact.body.offset-compact.body.client,8);assert.equal(compact.footer.y+compact.footer.height,720);assert.ok(await evaluate(`document.querySelector('.ce-body').scrollHeight>document.querySelector('.ce-body').clientHeight`));checks.minimumWindowPreservesColumnsAndScroll=true;await frame('editor-1100');
 await cdp.call('Emulation.setDeviceMetricsOverride',{width:640,height:840,deviceScaleFactor:1,mobile:false});await settle();const mobile=await metrics();assert.equal(mobile.drawer.width,640);assert.equal(mobile.columns[0].width,mobile.columns[1].width);assert.ok(mobile.columns[1].y>mobile.columns[0].y);assert.ok(await evaluate(`document.querySelector('.ce-body').scrollWidth<=document.querySelector('.ce-body').clientWidth`));checks.existingSingleColumnDoesNotOverflow=true;await frame('editor-640');
 await evaluate(`document.querySelector('.customer-editor [data-action="close-modal"]').click()`);await until(()=>evaluate(`!document.querySelector('#customer-form')`),'cancelled');assert.deepEqual(await snapshot(),baseline);checks.cancelDoesNotWriteDatabase=true;
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({testedAt:new Date().toISOString(),app,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),result:'pass',checks,methodLayouts,before,popup,scrolled,compact,mobile,realDataWrites:false},null,2));console.log('PASS: '+Object.keys(checks).length+' editor geometry checks');
}catch(error){console.error('Acceptance failure: '+error.message);if(cdp)await frame('failure').catch(()=>{});throw error;}
finally{cdp?.close();for(const child of children)await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
