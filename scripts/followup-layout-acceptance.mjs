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
const evidence=path.resolve(process.env.LAI_FOLLOWUP_LAYOUT_EVIDENCE || 'evidence/ui-1.4.45/followup-layout');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-followup-layout-'));
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
    env:{...process.env,LAI_DATA_DIR:path.join(temporary,'database'),LAI_APP_PORT:String(port),LAI_API_TOKEN:token,LAI_INSTANCE_NONCE:'followup-layout-test',LAI_APP_NO_OPEN:'1'},stdio:'ignore'});
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
 {type:'followup',subtype:'quick',time:'2024-07-31T10:00:49Z',text:'Latest old call',owner:'Fixture',contact:'Alice'},
 {type:'followup',subtype:'quick',time:'2023-04-23T10:00:33Z',text:'Middle old call',owner:'Fixture'},
 {type:'followup',subtype:'quick',time:'2022-10-25T10:00:01Z',text:'Earliest old call',owner:'Fixture'},
 {type:'created',time:'2023-01-01T10:00:00Z',text:'Created account',owner:'Fixture'}]}};initial.data.orders=[];initial.data.previewSegments=[];
 const seeded=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:initial,baseRevision:initial.revision})});assert.equal(seeded.status,200);
 const port=await freePort();const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps',`--user-data-dir=${path.join(temporary,'chrome')}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});children.push(browser);
 let target;await until(async()=>{try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'browser');cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Page.bringToFront');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1728,height:958,deviceScaleFactor:1,mobile:false});await navigate();const baseline=await snapshot();

 await pointerClick('.company-link');await until(()=>evaluate(`!!document.querySelector('[data-tab="activity"]')`),'detail');await pointerClick('[data-tab="activity"]');
 await evaluate(`(()=>{const d=document.querySelector('#followup-text');d.value='Unsubmitted draft';d.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await filter('followup');const actual=await records();fs.writeFileSync(path.join(evidence,'flat-observation.json'),JSON.stringify({actual,expected:{groups:0,visible:3}},null,2));await frame('followup-flat');
 assert.equal(actual.groups,0,'Source follow-up category must not hide old records in year groups');assert.deepEqual(actual.rows.map(r=>r.text),['Latest old call','Middle old call','Earliest old call']);assert.ok(actual.rows.every(r=>r.visible&&/^20\d{2}-\d{2}-\d{2}/.test(r.date)));checks.oldFollowupsVisibleWithoutExpansion=true;
 const geometry=await evaluate(`(()=>{const rows=[...document.querySelectorAll('#activity-results .lcd-activity-record')];return rows.map(r=>{const b=r.querySelector('.lcd-event-body'),h=r.querySelector('.lcd-timeline-owner'),t=r.querySelector('time'),icon=r.querySelector('.lcd-activity-icon'),c=getComputedStyle(b);return {quick:r.classList.contains('lcd-quick-record'),bodyHeight:b.getBoundingClientRect().height,padding:c.padding,radius:c.borderRadius,background:c.backgroundColor,date:t.textContent,dateLine:getComputedStyle(t).lineHeight,heading:h.textContent,headHeight:h.getBoundingClientRect().height,bodyGap:b.getBoundingClientRect().top-h.getBoundingClientRect().bottom,iconSize:icon?icon.getBoundingClientRect().width:0,contact:r.querySelector('.lcd-activity-contact')?.textContent||'',detailInHead:!!h.querySelector('[data-action="toggle-activity-detail"]')};});})()`);
 fs.writeFileSync(path.join(evidence,'card-geometry.json'),JSON.stringify(geometry,null,2));
 assert.ok(geometry.every(r=>r.quick&&r.padding==='12px'&&r.radius==='8px'&&r.background==='rgb(246, 248, 249)'));checks.sourceQuickCardSurface=true;
 assert.deepEqual(geometry.map(r=>r.bodyHeight),[68,44,44]);checks.sourceOptionalContactCardHeight=true;
 assert.ok(geometry.every(r=>r.headHeight===28&&r.bodyGap===8&&r.dateLine==='22px'));checks.sourceHeaderAndBodySpacing=true;
 assert.ok(geometry.every(r=>r.iconSize===24&&r.heading.includes('快速记录')));checks.sourceQuickRecordIconAndLabel=true;
 assert.ok(geometry.every(r=>/^20\d{2}-\d{2}-\d{2} \d{2}:\d{2}$/.test(r.date)));checks.minutePrecisionRetainsYearForOldRecords=true;
 assert.deepEqual(geometry.map(r=>r.contact),['关联联系人：Alice','','']);checks.onlySavedContactAssociationDisplayed=true;
 assert.ok(geometry.every(r=>r.detailInHead));await pointerClick('[data-action="toggle-activity-detail"]');
 assert.equal(await evaluate(`document.querySelector('[data-action="toggle-activity-detail"]').getAttribute('aria-expanded')`),'true');
 assert.ok(await evaluate(`document.querySelector('.lcd-activity-detail').textContent.includes('Latest old call')&&document.querySelector('.lcd-activity-detail').textContent.includes(':49')`));
 await pointerClick('[data-action="toggle-activity-detail"]');checks.existingDetailExpansionRetainsExactTimeAndContent=true;
 await pointerClick('[data-action="activity-sort"]');await pointerClick('[data-activity-sort="oldest"]');assert.deepEqual((await records()).rows.map(r=>r.text),['Earliest old call','Middle old call','Latest old call']);checks.oldestSortOrdersVisibleRecords=true;
 await pointerClick('[data-action="activity-sort"]');await pointerClick('[data-activity-sort="newest"]');assert.deepEqual((await records()).rows.map(r=>r.text),['Latest old call','Middle old call','Earliest old call']);checks.newestSortRestoresVisibleOrder=true;
 await pointerClick('[data-action="activity-search"]');await evaluate(`(()=>{const i=document.querySelector('#activity-search-input');i.value='Middle';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);assert.deepEqual((await records()).rows.map(r=>r.text),['Middle old call']);assert.equal((await records()).groups,0);checks.submittedSearchKeepsFlatMatches=true;
 await evaluate(`(()=>{const i=document.querySelector('#activity-search-input');i.value='__absent__';i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));})()`);assert.equal((await records()).rows.length,0);assert.ok(await evaluate(`document.querySelector('#activity-results').textContent.includes('暂无数据')`));checks.emptySearchShowsNoRecords=true;
 await pointerClick('[data-action="clear-activity-search"]');await filter('all');assert.equal((await records()).groups,3);assert.ok((await records()).rows.every(r=>!r.visible));await pointerClick('[data-timeline-group="year:2024"] button');assert.equal((await records()).rows.filter(r=>r.visible).length,1);checks.allKeepsExpandableYearGroups=true;
 await filter('followup');assert.equal((await records()).groups,0);assert.ok((await records()).rows.every(r=>r.visible));await filter('all');assert.equal((await records()).rows.filter(r=>r.visible).length,1);checks.groupExpansionSurvivesFlatRoundTrip=true;
 await filter('other');assert.equal((await records()).groups,1);assert.deepEqual((await records()).rows.map(r=>r.text),['Created account']);checks.otherKeepsSourceTimeGroups=true;
 await filter('followup');assert.equal(await evaluate(`document.querySelector('#followup-text').value`),'Unsubmitted draft');checks.categoryAndSortKeepFollowupDraft=true;
 await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:720,deviceScaleFactor:1,mobile:false});await frame('followup-1100');assert.ok((await records()).rows.every(r=>r.visible));checks.minimumWidthKeepsFlatRecordsVisible=true;
 assert.deepEqual(await snapshot(),baseline);checks.viewingSortingSearchingDoNotWriteSQLite=true;
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({testedAt:new Date().toISOString(),app,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),result:'pass',checks,scope:'Disposable SQLite/Chrome, source-proved followup flat presentation only'},null,2));console.log('PASS: '+Object.keys(checks).length+' follow-up layout checks');
}catch(error){fs.writeFileSync(path.join(evidence,'progress.json'),JSON.stringify({checks,error:error.message},null,2));throw error;}
finally{cdp?.close();for(const child of children)await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
