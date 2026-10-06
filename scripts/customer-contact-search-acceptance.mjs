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
const evidence=path.resolve(process.env.LAI_CONTACT_SEARCH_EVIDENCE || 'evidence/ui-1.4.40/contact-search');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-contact-search-'));
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
    env:{...process.env,LAI_DATA_DIR:path.join(temporary,'database'),LAI_APP_PORT:String(port),LAI_API_TOKEN:token,LAI_INSTANCE_NONCE:'contact-search-test',LAI_APP_NO_OPEN:'1'},stdio:'ignore'});
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
async function query(value){await evaluate(`(()=>{const input=document.querySelector('#contact-search-input');input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}));})()`);}
async function key(key){for(const type of ['keyDown','keyUp'])await cdp.call('Input.dispatchKeyEvent',{type,key,code:key});}
async function searchState(){return evaluate(`(()=>{const row=document.querySelector('.lcd-contact-search-row');return {hidden:row.hidden,value:document.querySelector('#contact-search-input').value,visible:[...document.querySelectorAll('.lcd-contact')].filter(c=>!c.hidden).map(c=>c.dataset.contactIndex),focused:document.activeElement.id||document.activeElement.dataset.action,count:Number(document.querySelector('.lcd-contacts h3').textContent.match(/\\((\\d+)\\)/)[1]),status:document.querySelector('#contact-search-status').textContent,empty:!document.querySelector('#contact-search-empty').hidden};})()`);}
async function openSearch(){if((await searchState()).hidden)await pointerClick('[data-action="contact-search"]');}
async function commit(value){await openSearch();await query(value);await key('Enter');}

try{
 fs.mkdirSync(evidence,{recursive:true});backend=await startBackend();const initial=await snapshot();
 initial.data.customers={'Contact Search Fixture':{country:'US',source:'Referral',contact:'First Contact',email:'first@example.test',phone:'5550101',additionalPhones:[{phone:'5566',phoneCountryCode:'+44'}],additionalSocialAccounts:[{socialPlatform:'LinkedIn',socialAccount:'first-team'}],alternateEmail:'backup@example.test',address:'Excluded Address',contactNote:'Excluded Note',extraContacts:[{contact:'Second Contact',email:'second@example.test',phone:'5550102',unknownContact:'keep'}],unknownCustomer:'keep'},'Other Fixture':{country:'NL',source:'Referral',contact:'Other Contact',email:'other@example.test'}};initial.data.orders=[];initial.data.previewSegments=[];
 const seeded=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:initial,baseRevision:initial.revision})});assert.equal(seeded.status,200);
 const port=await freePort();const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps',`--user-data-dir=${path.join(temporary,'chrome')}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});children.push(browser);
 let target;await until(async()=>{try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'browser');cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Page.bringToFront');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1728,height:958,deviceScaleFactor:1,mobile:false});await navigate();const baseline=await snapshot();
 await pointerClick('.company-link');await until(()=>evaluate(`!!document.querySelector('[data-action="contact-search"]')`),'contact detail');
 const before=await evaluate(`(()=>{const c=document.querySelector('.lcd-contacts'),h=c.querySelector('.lcd-section-head');return {cardHeight:c.getBoundingClientRect().height,headerHeight:h.getBoundingClientRect().height,contacts:c.querySelectorAll('.lcd-contact').length};})()`);
 assert.equal(before.contacts,2);await pointerClick('[data-action="contact-search"]');
 const opened=await evaluate(`(()=>{const c=document.querySelector('.lcd-contacts'),h=c.querySelector('.lcd-section-head'),s=c.querySelector('.lcd-contact-search-row'),r=s.getBoundingClientRect(),hr=h.getBoundingClientRect(),style=getComputedStyle(s);return {insideHeader:!!s.closest('.lcd-section-head'),cardHeight:c.getBoundingClientRect().height,headerHeight:hr.height,searchHeight:r.height,searchTop:r.top,headerTop:hr.top,headerBottom:hr.bottom,searchBottom:r.bottom,focused:document.activeElement.id,animations:s.getAnimations().map(a=>({name:a.animationName,property:a.transitionProperty})),opacity:style.opacity,transform:style.transform};})()`);
 fs.writeFileSync(path.join(evidence,'open-observation.json'),JSON.stringify({before,opened},null,2));await frame('search-layout');
 assert.equal(opened.insideHeader,true,'Original contact search overlays header actions; body search row is a layout mismatch');
 assert.equal(opened.cardHeight,before.cardHeight,'Opening empty contact search must not add body height');assert.equal(opened.headerHeight,48);assert.equal(opened.searchHeight,32);assert.ok(opened.searchTop>=opened.headerTop&&opened.searchBottom<=opened.headerBottom);assert.equal(opened.focused,'contact-search-input');assert.equal(opened.animations.length,0,'Original wrapper has no position/opacity entrance');checks.headerSearchDoesNotAddBodyRow=true;
 const titleGap=await evaluate(`document.querySelector('.lcd-contact-search-row').getBoundingClientRect().left-document.querySelector('#contact-count-label').getBoundingClientRect().right`);
 fs.writeFileSync(path.join(evidence,'title-gap.json'),JSON.stringify({actual:titleGap,expected:24,source:'2026-09-27-contact-header-spacing/observations.json'},null,2));
 assert.equal(titleGap,24,'Source contact title uses 24px right margin before search');checks.sourceTitleSearchSpacing=true;
 assert.equal(await evaluate(`getComputedStyle(document.querySelector('#contact-count-label')).fontWeight`),'700','Source contact title uses bold 700 weight');
 assert.deepEqual(await snapshot(),baseline);checks.openingSearchDoesNotWriteData=true;
 assert.equal(await evaluate(`document.querySelector('.lcd-contact-search-controls').inert`),true);checks.coveredToolbarCannotReceiveFocus=true;
 // Model WebKit/macOS pointer defaults: an unfocusable button can blur the
 // input with relatedTarget=null before click. A cancelled pointer default
 // must retain input focus so clear/search still receive the click.
 await query('no-match-native-focus');
 await evaluate(`document.addEventListener('mousedown', function emulateUnfocusableButton(event) { if (event.target.closest('[data-action="clear-contact-search"]') && !event.defaultPrevented) document.querySelector('#contact-search-input').blur(); }, {once:true})`);
 await pointerClick('[data-action="clear-contact-search"]');
 assert.equal((await searchState()).value,'','A nonfocusable native clear button must execute before search is dismissed');assert.equal((await searchState()).count,2);assert.equal((await searchState()).hidden,false);assert.equal((await searchState()).focused,'contact-search-input');checks.unfocusableNativeClearRetainsClickAndInputFocus=true;
 await query(' SECOND@EXAMPLE.TEST ');assert.deepEqual((await searchState()).visible,['0','1'],'Typing is a draft until explicit submit or blur');assert.equal((await searchState()).count,2);checks.inputDoesNotFilterBeforeCommit=true;
 await key('Enter');assert.deepEqual((await searchState()).visible,['1']);assert.equal((await searchState()).count,1);assert.equal((await searchState()).hidden,true);checks.enterAppliesQueryUpdatesCountAndClosesOnCountChange=true;
 await openSearch();assert.equal((await searchState()).value,' SECOND@EXAMPLE.TEST ');await query('First Contact');assert.deepEqual((await searchState()).visible,['1']);await key('Enter');assert.deepEqual((await searchState()).visible,['0']);assert.equal((await searchState()).count,1);assert.equal((await searchState()).hidden,false);assert.equal((await searchState()).focused,'contact-search-input');checks.sameCountDifferentContactKeepsSearchAndFocus=true;
 await query('5550102');await pointerClick('[data-action="apply-contact-search"]');assert.deepEqual((await searchState()).visible,['1']);assert.equal((await searchState()).hidden,false);assert.equal((await searchState()).focused,'contact-search-input');checks.buttonCommitsPhoneQueryAndRetainsFocusAtSameCount=true;
 await pointerClick('[data-action="clear-contact-search"]');assert.equal((await searchState()).hidden,true);assert.equal((await searchState()).value,'');assert.equal((await searchState()).count,2);assert.deepEqual((await searchState()).visible,['0','1']);checks.clearAppliesEmptyQueryAndClosesOnCountChange=true;
 await openSearch();await query('__unsubmitted__');await pointerClick('[data-action="clear-contact-search"]');assert.equal((await searchState()).hidden,false);assert.equal((await searchState()).focused,'contact-search-input');assert.equal((await searchState()).value,'');assert.equal((await searchState()).count,2);checks.clearUnsubmittedQueryKeepsSearchOpenAtSameCount=true;
 await commit('\u90ae\u7bb1');assert.equal((await searchState()).count,0);assert.deepEqual((await searchState()).visible,[]);assert.equal((await searchState()).empty,true);assert.equal(await evaluate(`document.querySelector('.lcd-contacts').getBoundingClientRect().height`),64);checks.fieldLabelsDoNotMatchAndEmptyHeaderShowsZero=true;
 await openSearch();await query('__absent__');await pointerClick('[data-action="apply-contact-search"]');assert.equal((await searchState()).hidden,false);assert.equal((await searchState()).count,0);assert.equal((await searchState()).focused,'contact-search-input');checks.sameEmptyResultsKeepInputOpen=true;
 await key('Escape');const escaped=await searchState();assert.equal(escaped.hidden,true);assert.equal(escaped.value,'');assert.equal(escaped.focused,'contact-search');assert.deepEqual(escaped.visible,['0','1']);assert.equal(escaped.count,2);checks.escapeClearsAndRestoresContactsCountAndFocus=true;
 assert.equal(await evaluate(`document.querySelector('.lcd-contact-search-controls').inert`),false);checks.closedToolbarIsUsable=true;
 await openSearch();await query('second');assert.equal((await searchState()).count,2);await pointerClick('.lcd-summary h2');assert.equal((await searchState()).hidden,true);assert.equal((await searchState()).value,'second');assert.equal((await searchState()).count,1);assert.deepEqual((await searchState()).visible,['1']);checks.blurCommitsAndHidesButPreservesQuery=true;
 await openSearch();assert.equal((await searchState()).value,'second');assert.equal((await searchState()).focused,'contact-search-input');checks.reopenPreservesBlurredQuery=true;
 await key('Escape');await openSearch();await key('Escape');await openSearch();await pause(200);assert.equal((await searchState()).hidden,false);assert.equal((await searchState()).focused,'contact-search-input');checks.rapidReopenHasNoDelayedClose=true;
 await query('second');await pointerClick('[data-action="toggle-detail-card"][data-card-id="contacts"]');assert.equal((await searchState()).hidden,true);assert.equal(await evaluate(`document.querySelector('.lcd-contacts').dataset.collapsed`),'true');await openSearch();assert.equal(await evaluate(`document.querySelector('.lcd-contacts').dataset.collapsed`),'false');assert.equal((await searchState()).value,'second');assert.equal((await searchState()).count,1);checks.collapseCommitsAndSearchReopensCard=true;
 await key('Escape');
 for(const [value,expected] of [['5566',['0']],['LinkedIn',['0']],['first-team',['0']],['backup@example.test',['0']]]){await commit(value);assert.deepEqual((await searchState()).visible,expected);await openSearch();await key('Escape');}checks.appendedPhonesSocialAccountsAndBackupEmailMatch=true;
 for(const value of ['Excluded Address','Excluded Note']){await commit(value);assert.deepEqual((await searchState()).visible,[]);await openSearch();await key('Escape');}checks.otherFieldsAreNotSearchableByTheFourFieldControl=true;
 await openSearch();await evaluate(`(()=>{const input=document.querySelector('#contact-search-input');input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));input.value='second';input.dispatchEvent(new InputEvent('input',{bubbles:true,data:'second',isComposing:true}));input.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,key:'Enter',isComposing:true,keyCode:229}));})()`);assert.equal((await searchState()).count,2);await evaluate(`document.querySelector('#contact-search-input').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'second'}))`);assert.equal((await searchState()).count,2);await key('Enter');assert.equal((await searchState()).count,1);checks.inputMethodEnterDoesNotCommitUntilCompositionEnds=true;
 await openSearch();await key('Escape');await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await openSearch();assert.equal(await evaluate(`document.querySelector('.lcd-contact-search-row').getAnimations().length`),0);await query('second');await key('Enter');assert.equal((await searchState()).hidden,true);await openSearch();await key('Escape');checks.reducedMotionHasSameCommitPolicyAndNoEntrance=true;
 await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
 await openSearch();await pointerClick('.lcd-summary h2');assert.equal((await searchState()).hidden,true);assert.equal((await searchState()).value,'');checks.emptyBlurRestoresHeaderControls=true;
 await openSearch();await cdp.call('Input.insertText',{text:'x'.repeat(240)});assert.equal((await searchState()).value.length,200);assert.equal((await searchState()).count,2);await key('Escape');checks.typedSearchHasSourceLengthLimitWithoutAutoCommit=true;
 await commit('second');await openSearch();await query('First Contact');await key('Enter');assert.equal((await searchState()).count,1);assert.equal((await searchState()).hidden,false);await frame('committed-one');const clearGlyph=await evaluate(`(()=>{const r=document.querySelector('[data-action="clear-contact-search"] svg').getBoundingClientRect();return {width:r.width,height:r.height};})()`);assert.deepEqual(clearGlyph,{width:14,height:14});await key('Escape');checks.committedOneHeaderAndClearGlyphRendered=true;
 assert.ok(await evaluate(`document.querySelector('.lcd-contact-title .lcd-contact-actions').getBoundingClientRect().width<=64`),'Row action icons must not inherit the expanding header toolbar layout');checks.contactRowActionsDoNotInheritHeaderSizing=true;
 for(const width of [1100,1728]){await cdp.call('Emulation.setDeviceMetricsOverride',{width,height:958,deviceScaleFactor:1,mobile:false});await openSearch();const fits=await evaluate(`(()=>{const s=document.querySelector('.lcd-contact-search-row').getBoundingClientRect(),h=document.querySelector('.lcd-contacts .lcd-section-head').getBoundingClientRect(),i=document.querySelector('#contact-search-input').getBoundingClientRect();return s.left>=h.left&&s.right<=h.right&&s.height===32&&i.width>0;})()`);assert.equal(fits,true);await frame('search-width-'+width);await key('Escape');}checks.searchFitsSupportedWindowWidths=true;
 await openSearch();await query('second');await pointerClick('[data-tab="activity"]');assert.equal((await searchState()).hidden,true);assert.equal((await searchState()).value,'second');assert.deepEqual((await searchState()).visible,['1']);assert.equal((await searchState()).count,1);checks.tabBlurCommitsAndPreservesContactQuery=true;
 await openSearch();await pointerClick('[data-action="list"]');await until(()=>evaluate(`!!document.querySelector('.company-link')`),'return list');await evaluate(`([...document.querySelectorAll('.company-link')].find(e=>e.textContent.includes('Other Fixture'))).click()`);await until(()=>evaluate(`!!document.querySelector('#contact-search-input')`),'other customer');assert.equal((await searchState()).value,'');assert.deepEqual((await searchState()).visible,['0']);assert.equal((await searchState()).count,1);checks.customerChangeDoesNotLeakQuery=true;
 assert.deepEqual(await snapshot(),baseline);checks.allSearchInteractionsPreserveSQLiteAndUnknownFields=true;
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({testedAt:new Date().toISOString(),result:'pass',app,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),checks,before,opened,scope:'Header layout, explicitly submitted four-field contact search, result count lifecycle and existing keyboard cancellation; no production data writes or source internal implementation claim'},null,2));console.log('PASS: '+Object.keys(checks).length+' contact search checks');
}catch(error){console.error(error.message);fs.writeFileSync(path.join(evidence,'progress.json'),JSON.stringify({checks,error:error.message},null,2));throw error;}
finally{cdp?.close();for(const child of children)await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
