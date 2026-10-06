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
const evidence=path.resolve(process.env.LAI_ACTIVITY_QUERY_EVIDENCE || 'evidence/ui-1.4.44/activity-query');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-activity-query-'));
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
    env:{...process.env,LAI_DATA_DIR:path.join(temporary,'database'),LAI_APP_PORT:String(port),LAI_API_TOKEN:token,LAI_INSTANCE_NONCE:'activity-query-test',LAI_APP_NO_OPEN:'1'},stdio:'ignore'});
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
 await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
 await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
 const point=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
 await cdp.call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
 await cdp.call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
}

async function filter(name){await pointerClick('[data-activity-filter="'+name+'"]');}
async function records(){return evaluate(`(()=>({groups:document.querySelectorAll('#activity-results [data-timeline-group]').length,rows:[...document.querySelectorAll('#activity-results .lcd-activity-record')].map(r=>({text:r.querySelector('.lcd-event-body').firstChild.textContent,date:r.querySelector('time').textContent,visible:r.checkVisibility()}))}))()`);}
try{
 fs.mkdirSync(evidence,{recursive:true});backend=await startBackend();const initial=await snapshot();
 initial.data.customers={'Timeline Fixture':{contact:'Main',unknown:'keep',history:[
 {type:'followup',time:'2024-07-31T10:00:00Z',text:'Latest old call',owner:'Fixture'},
 {type:'followup',time:'2023-04-23T10:00:00Z',text:'Middle old call',owner:'Fixture'},
 {type:'followup',time:'2022-10-25T10:00:00Z',text:'Earliest old call',owner:'Fixture'},
 {type:'created',time:'2023-01-01T10:00:00Z',text:'Created account',owner:'Fixture'}]}};initial.data.orders=[];initial.data.previewSegments=[];
 const seeded=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:initial,baseRevision:initial.revision})});assert.equal(seeded.status,200);
 const port=await freePort();const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps',`--user-data-dir=${path.join(temporary,'chrome')}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});children.push(browser);
 let target;await until(async()=>{try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'browser');cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Page.bringToFront');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1728,height:958,deviceScaleFactor:1,mobile:false});await navigate();const baseline=await snapshot();

 await pointerClick('.company-link');await until(()=>evaluate(`!!document.querySelector('[data-tab="activity"]')`),'detail');await pointerClick('[data-tab="activity"]');
 await evaluate(`(()=>{const d=document.querySelector('#followup-text');d.value='Unsubmitted draft';d.dispatchEvent(new Event('input',{bubbles:true}));})()`);

 await filter('followup');await pointerClick('[data-action="activity-search"]');
 async function geometry(){return evaluate(`(()=>{const row=document.querySelector('#activity-search-row'),bar=document.querySelector('.lcd-journey'),r=row.getBoundingClientRect(),b=bar.getBoundingClientRect(),f=document.querySelector('.lcd-activity-filters').getBoundingClientRect();return {inline:!!row.closest('.lcd-journey'),width:r.width,height:r.height,rightGap:Math.abs(r.right-b.right),centerGap:Math.abs((r.top+r.bottom)/2-(b.top+b.bottom)/2),categoryGap:f.top-b.bottom,animation:getComputedStyle(row).animationName,transition:getComputedStyle(row).transitionDuration,toolsVisible:[...document.querySelectorAll('[data-action="refresh-activity"],[data-action="activity-search"],[data-action="activity-sort"],[data-action="activity-advanced-filter"]')].some(e=>e.checkVisibility()),maxLength:document.querySelector('#activity-search-input').maxLength}})()`);}
 const emptyGeometry=await geometry();fs.writeFileSync(path.join(evidence,'empty-geometry.json'),JSON.stringify(emptyGeometry,null,2));assert.equal(emptyGeometry.inline,true,'Dynamic search belongs inside the history toolbar');assert.ok(Math.abs(emptyGeometry.width-222)<0.1,'Search row is 222px wide');assert.ok(Math.abs(emptyGeometry.height-32)<0.1,'Search row is 32px tall');assert.ok(emptyGeometry.rightGap<1);assert.ok(emptyGeometry.centerGap<1);assert.equal(emptyGeometry.toolsVisible,false);assert.equal(emptyGeometry.animation,'none');assert.equal(emptyGeometry.transition,'0s');assert.equal(emptyGeometry.maxLength,200);checks.sourceInlineEmptyGeometryAndImmediateSwitch=true;
 async function input(value){await evaluate(`(()=>{const i=document.querySelector('#activity-search-input');i.value=${JSON.stringify(value)};i.dispatchEvent(new Event('input',{bubbles:true}));})()`);}
 async function key(name){for(const type of ['keyDown','keyUp'])await cdp.call('Input.dispatchKeyEvent',{type,key:name,code:name});}
 async function tabs(){return evaluate(`[...document.querySelectorAll('[data-activity-filter]')].map(e=>({id:e.dataset.activityFilter,text:e.textContent,selected:e.getAttribute('aria-pressed')}))`);}
 const baseRecords=await records();await input('__absent__');const populatedGeometry=await geometry();assert.ok(Math.abs(populatedGeometry.width-244)<.1);assert.ok(Math.abs(populatedGeometry.height-32)<.1);assert.ok(populatedGeometry.rightGap<1);assert.equal(populatedGeometry.categoryGap,emptyGeometry.categoryGap);checks.clearAffixGrowsWidthWithoutMovingCategories=true;const typed=await records();fs.writeFileSync(path.join(evidence,'draft-observation.json'),JSON.stringify({actual:typed,expectedCount:3},null,2));
 assert.equal(typed.rows.length,3,'Typing activity search is a draft; submit is required');assert.deepEqual(typed,baseRecords);checks.typingDoesNotChangeResults=true;
 await key('Enter');assert.equal((await records()).rows.length,0);assert.equal((await records()).groups,0);assert.ok(await evaluate(`document.querySelector('#activity-results').textContent.includes('暂无数据')`));assert.equal((await tabs())[0].selected,'true');assert.ok((await tabs()).every(t=>/\(0\)/.test(t.text)));checks.enterResetsToAllAndShowsCountedEmptyWithoutYearHeading=true;
 await input('call');assert.equal((await records()).rows.length,0);await pointerClick('[data-action="apply-activity-search"]');assert.equal((await records()).rows.length,3);assert.equal((await records()).groups,0);assert.ok((await records()).rows.every(r=>r.visible));assert.equal((await tabs())[0].text,'全部(3)');assert.equal((await tabs())[1].text,'跟进记录(3)');checks.searchButtonCommitsAndFlattensGlobalMatches=true;
 assert.equal(await evaluate(`document.querySelector('.lcd-activity-query-hint')?.checkVisibility()`),true);assert.deepEqual(await evaluate(`(()=>{const s=getComputedStyle(document.querySelector('.lcd-activity-query-hint'));return [s.fontSize,s.lineHeight,s.marginTop]})()`),['12px','16px','16px']);assert.equal(await evaluate(`document.querySelector('#activity-search-status').getBoundingClientRect().height`),1);checks.matchingQueryHintVisibleWithoutExtraCountLine=true;await frame('query-desktop');
 await pointerClick('#followup-text');assert.deepEqual(await evaluate(`(()=>({open:!document.querySelector('#activity-search-row').hidden,query:document.querySelector('#activity-search-input').value,focused:document.activeElement?.id==='activity-search-input'}))()`),{open:true,query:'call',focused:false});assert.equal((await records()).rows.length,3);checks.committedQueryBlurKeepsSearchOpenAndResults=true;
 await input('uncommitted');await filter('followup');assert.equal((await records()).rows.length,3);assert.equal(await evaluate(`document.querySelector('#activity-search-input').value`),'uncommitted');checks.categorySwitchRetainsDraftAndCommittedResults=true;
 await pointerClick('#activity-search-input');await key('Escape');assert.equal(await evaluate(`document.querySelector('#activity-search-row').hidden`),false);assert.equal(await evaluate(`document.querySelector('#activity-search-input').value`),'uncommitted');assert.equal((await records()).rows.length,3);checks.escapeDoesNotDiscardQueryOrDraft=true;
 await pointerClick('#followup-text');assert.equal((await records()).rows.length,3);assert.equal(await evaluate(`document.querySelector('#activity-search-input').value`),'uncommitted');assert.equal(await evaluate(`document.querySelector('#activity-search-row').hidden`),false,'Unsubmitted draft keeps the search row open after blur');checks.nonemptyBlurKeepsDraftAndSearchOpen=true;
 await pointerClick('[data-action="clear-activity-search"]');assert.equal((await tabs())[0].text,'全部(4)');assert.equal((await tabs())[0].selected,'true');assert.equal((await records()).groups,3);assert.equal(await evaluate(`document.activeElement.id`),'activity-search-input');assert.equal(await evaluate(`document.querySelector('#activity-search-row').hidden`),false);checks.clearRestoresAllAndRetainsSearchFocus=true;
 await pointerClick('#followup-text');assert.equal(await evaluate(`document.querySelector('#activity-search-row').hidden`),true,'Empty search row closes without a delayed exit');assert.equal(await evaluate(`document.activeElement.id`),'followup-text');assert.equal(await evaluate(`document.querySelector('[data-action="activity-sort"]').checkVisibility()`),true);checks.emptyBlurClosesSearchAndPreservesFocusTarget=true;
 await pointerClick('[data-action="activity-search"]');await input('Created');await key('Enter');assert.deepEqual((await records()).rows.map(r=>r.text),['Created account']);assert.equal((await tabs())[0].text,'全部(1)');assert.equal((await tabs())[1].text,'跟进记录(0)');assert.equal((await tabs())[4].text,'其它(1)');await filter('other');assert.equal((await records()).groups,0);assert.ok((await records()).rows.every(r=>r.visible));checks.queryFindsOtherCategoryAndUpdatesItsCount=true;
 assert.equal((await geometry()).toolsVisible,false);await pointerClick('[data-action="clear-activity-search"]');await pointerClick('#followup-text');await pointerClick('[data-action="activity-sort"]');await pointerClick('[data-activity-sort="oldest"]');assert.equal(await evaluate(`document.querySelector('#activity-search-input').value`),'');assert.equal(await evaluate(`document.querySelector('#followup-text').value`),'Unsubmitted draft');checks.visibleSortAfterClearingQueryPreservesFollowupDraft=true;
 await until(()=>evaluate(`!document.querySelector('.activity-sort-popover')`),'sort menu exit');await pointerClick('[data-action="refresh-activity"]');await until(()=>evaluate(`document.querySelector('#activity-refresh-status').textContent==='已是最新'`),'unchanged refresh');assert.equal((await records()).rows.length,4);await pointerClick('[data-action="activity-search"]');await input('Created');await key('Enter');assert.deepEqual((await records()).rows.map(r=>r.text),['Created account']);assert.equal(await evaluate(`document.querySelector('#followup-text').value`),'Unsubmitted draft');checks.visibleRefreshThenReopenedQueryRetainsDraftAndResults=true;
 await pointerClick('[data-action="clear-activity-search"]');await input('call');await evaluate(`(()=>{const i=document.querySelector('#activity-search-input');i.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,keyCode:229,bubbles:true}));})()`);assert.equal((await records()).rows.length,4);await evaluate(`document.querySelector('#activity-search-input').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}))`);await key('Enter');assert.equal((await records()).rows.length,3);checks.composingEnterDoesNotCommit=true;
 await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:720,deviceScaleFactor:1,mobile:false});await frame('query-1100');assert.ok((await records()).rows.every(r=>r.visible));checks.minimumWidthShowsCommittedResults=true;
 const minimum=await evaluate(`(()=>{const r=document.querySelector('#activity-search-row').getBoundingClientRect(),b=document.querySelector('.lcd-button-group').getBoundingClientRect(),f=document.querySelector('.lcd-activity-filters').getBoundingClientRect();return {inside:r.left>=0&&r.right<=innerWidth,overlap:r.left<b.right&&r.right>b.left&&r.top<b.bottom&&r.bottom>b.top,categoriesBelow:f.top>=Math.max(r.bottom,b.bottom)}})()`);assert.deepEqual(minimum,{inside:true,overlap:false,categoriesBelow:true});checks.minimumWidthWrapsWithoutOverlap=true;
 await pointerClick('[data-action="clear-activity-search"]');await cdp.call('Input.insertText',{text:'x'.repeat(240)});assert.equal(await evaluate(`document.querySelector('#activity-search-input').value.length`),200);checks.nativeTypingRespects200CharacterLimit=true;
 assert.deepEqual(await snapshot(),baseline);checks.queryAndDraftInteractionsDoNotWriteSQLite=true;
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({testedAt:new Date().toISOString(),app,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),result:'pass',checks,scope:'Disposable SQLite/Chrome, source-proved dynamic query lifecycle; header geometry and continuous trajectory unverified'},null,2));console.log('PASS: '+Object.keys(checks).length+' activity query checks');
}catch(error){if(cdp){await frame('failure').catch(()=>{});fs.writeFileSync(path.join(evidence,'failure-dom.json'),JSON.stringify(await evaluate(`(()=>({input:document.querySelector('#activity-search-input')?.value,hidden:document.querySelector('#activity-search-row')?.hidden,focus:document.activeElement?.outerHTML?.slice(0,200),tabs:[...document.querySelectorAll('[data-activity-filter]')].map(e=>e.textContent)}))()`).catch(()=>({})),null,2));}fs.writeFileSync(path.join(evidence,'progress.json'),JSON.stringify({checks,error:error.message},null,2));throw error;}
finally{cdp?.close();for(const child of children)await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
