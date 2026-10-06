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
const evidence=path.resolve(process.env.LAI_KNOWN_MOTION_EVIDENCE || 'evidence/ui-1.4.7/known-motion');
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
 await evaluate(`document.querySelector('.company-link').click()`);await until(()=>evaluate(`!!document.querySelector('.lcd-body-info')`),'customer details');await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
 const emptyDetailGeometry=await evaluate(`(()=>{const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};return {viewport:{width:innerWidth,height:innerHeight},opportunity:rect('.lcd-opportunity'),schedule:rect('.lcd-schedule'),tabsCard:rect('.lcd-tabs-card'),tabs:rect('.lcd-tabs'),companyCommon:rect('[data-info-section="company-common"]'),companyOther:rect('[data-info-section="company-other"]'),followup:rect('[data-info-section="followup"]'),system:rect('[data-info-section="system"]')}})()`);
 assert.deepEqual(emptyDetailGeometry.viewport,{width:1756,height:1022});
 assert.deepEqual(emptyDetailGeometry.opportunity,{x:744,y:116,width:988,height:48});
 assert.deepEqual(emptyDetailGeometry.schedule,{x:744,y:180,width:988,height:48});
 assert.equal(emptyDetailGeometry.tabsCard.x,744);
 assert.equal(emptyDetailGeometry.tabsCard.y,244);
 assert.equal(emptyDetailGeometry.tabsCard.width,988);
 assert.equal(emptyDetailGeometry.companyCommon.y,306,'Wide Info first section must start 16px below the tabs');
 checks.zeroOpportunityAndScheduleGeometryMatchesSource=true;
 const initialIndicator=await evaluate(`(()=>{const active=document.querySelector('.lcd-tabs button.active'),indicator=document.querySelector('.lcd-active-indicator'),matrix=new DOMMatrixReadOnly(getComputedStyle(indicator).transform);return {x:matrix.m41,width:matrix.m11,expectedX:active.offsetLeft,expectedWidth:active.offsetWidth,animations:indicator.getAnimations().length}})()`);
 assert.equal(initialIndicator.width,initialIndicator.expectedWidth,'The initial underline must immediately match the selected tab width');assert.equal(initialIndicator.x,initialIndicator.expectedX);assert.equal(initialIndicator.animations,0);checks.initialTabIndicatorAlreadyAtSelectedTab=true;
 const beforeDetailFolds=await snapshot();
 const foldObservations=[];
 const foldCases=[['company-common','[data-info-id="company-common"]','#lcd-info-company-common',32],['company-other','[data-info-id="company-other"]','#lcd-info-company-other',32],['followup','[data-info-id="followup"]','#lcd-info-followup',32],['system','[data-info-id="system"]','#lcd-info-system',32],['analysis','[data-card-id="analysis"]','#lcd-card-panel-analysis',32],['contacts','[data-card-id="contacts"]','#lcd-card-panel-contacts',48]];
 for(const [id,button,panel,header] of foldCases){
  await evaluate(`document.querySelector(${JSON.stringify(button)}).scrollIntoView({block:'center',behavior:'instant'})`);const contentBefore=await evaluate(`document.querySelector(${JSON.stringify(panel)}).innerHTML`);
  await pointerClick(button);
  const closed=await evaluate(`(()=>{const p=document.querySelector(${JSON.stringify(panel)}),b=document.querySelector(${JSON.stringify(button)}),css=getComputedStyle(p);return {display:css.display,height:p.getBoundingClientRect().height,animated:p.getAnimations().length,duration:css.transitionDuration,hidden:p.getAttribute('aria-hidden'),inert:p.inert,expanded:b.getAttribute('aria-expanded')}})()`);
  assert.deepEqual(closed,{display:'none',height:0,animated:0,duration:'0s',hidden:'true',inert:true,expanded:'false'},'Captured '+id+' card must close immediately');
  foldObservations.push({id,closed,header});
  assert.equal(await evaluate(`document.querySelector(${JSON.stringify(button)}).closest('.lcd-section-head').getBoundingClientRect().height`),header);
  if(id==='company-common'||id==='contacts')await frame(id+'-card-closed');
  await pointerClick(button);assert.deepEqual(await evaluate(`(()=>{const p=document.querySelector(${JSON.stringify(panel)}),b=document.querySelector(${JSON.stringify(button)});return {visible:p.getBoundingClientRect().height>0,opacity:getComputedStyle(p).opacity,animated:p.getAnimations().length,inert:p.inert,expanded:b.getAttribute('aria-expanded')}})()`),{visible:true,opacity:'1',animated:0,inert:false,expanded:'true'});
  for(let n=0;n<6;n++)await pointerClick(button);assert.equal(await evaluate(`document.querySelector(${JSON.stringify(panel)}).innerHTML`),contentBefore);assert.equal(await evaluate(`document.querySelector(${JSON.stringify(button)}).getAttribute('aria-expanded')`),'true');checks[id+'CardImmediateAndRapidTogglesKeepContent']=true;
 }
 await evaluate(`document.querySelector('.main').scrollTop=0`);await frame('detail-cards-open');
 await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:720,deviceScaleFactor:1,mobile:false});await evaluate(`document.querySelector('.main').scrollTop=0`);await frame('detail-cards-compact');
 const compactDetailGeometry=await evaluate(`(()=>{const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};return {viewport:{width:innerWidth,height:innerHeight},leftSummary:rect('.lcd-summary'),opportunity:rect('.lcd-opportunity'),schedule:rect('.lcd-schedule'),tabsCard:rect('.lcd-tabs-card'),tabs:rect('.lcd-tabs'),companyCommon:rect('[data-info-section="company-common"]'),companyOther:rect('[data-info-section="company-other"]'),followup:rect('[data-info-section="followup"]'),system:rect('[data-info-section="system"]')}})()`);
 assert.deepEqual(compactDetailGeometry.viewport,{width:1100,height:720});
 assert.equal(compactDetailGeometry.companyCommon.y,306,'Compact Info first section must start 16px below the tabs');
 await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:1022,deviceScaleFactor:1,mobile:false});
 await pointerClick('[data-card-id="contacts"]');await pointerClick('[data-action="contact-search"]');assert.equal(await evaluate(`document.querySelector('[data-card-id="contacts"]').getAttribute('aria-expanded')`),'true');assert.equal(await evaluate(`document.activeElement.id`),'contact-search-input');assert.equal(await evaluate(`document.querySelector('#lcd-card-panel-contacts').getAnimations().length`),0);checks.closedContactsSearchOpensImmediatelyAndFocuses=true;await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});assert.equal(await evaluate(`document.querySelector('.lcd-contact-search-row').hidden`),true);assert.equal(await evaluate(`document.activeElement.dataset.action`),'contact-search');
 await evaluate(`document.querySelector('[data-info-id="followup"]').click()`);assert.equal(await evaluate(`document.querySelector('#lcd-info-followup').getBoundingClientRect().height`),0);await evaluate(`document.querySelector('[data-tab="activity"]').click();document.querySelector('[data-tab="info"]').click()`);assert.equal(await evaluate(`document.querySelector('[data-info-id="followup"]').getAttribute('aria-expanded')`),'false');await evaluate(`document.querySelector('[data-info-id="followup"]').click()`);checks.detailFoldsKeepStateAcrossTabsAndKeyboardPathImmediate=true;
 await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await pointerClick('[data-card-id="analysis"]');assert.equal(await evaluate(`document.querySelector('#lcd-card-panel-analysis').getBoundingClientRect().height`),0);assert.equal(await evaluate(`document.querySelector('#lcd-card-panel-analysis').getAnimations().length`),0);await pointerClick('[data-card-id="analysis"]');await cdp.call('Emulation.setEmulatedMedia',{features:[]});checks.detailFoldsReducedMotionImmediate=true;
 assert.deepEqual(await snapshot(),beforeDetailFolds);checks.detailFoldsNeverWriteCustomerData=true;
 await evaluate(`document.querySelector('.lcd-root').scrollIntoView({block:'start',behavior:'instant'})`);
 console.log('Checking initial indicator and tab transitions');
 await pointerClick('[data-tab="activity"]');const tabFrames=await trace('.lcd-active-indicator','transform');
 const tab=await evaluate(`(()=>{const indicator=document.querySelector('.lcd-active-indicator');const css=getComputedStyle(indicator);return {duration:css.transitionDuration,easing:css.transitionTimingFunction,bodyAnimation:getComputedStyle(document.querySelector('.lcd-body')).animationName,selected:document.querySelector('[data-tab="activity"]').getAttribute('aria-selected'),endpoint:indicator.style.transform}})()`);
 assert.equal(tab.duration,'0.3s','Detail tab underline must follow the captured 300ms');assert.equal(tab.easing,'ease');assert.equal(tab.bodyAnimation,'none');assert.equal(tab.selected,'true');
 assert.ok(tabFrames.some(f=>f.animations.some(a=>a.property==='transform'&&a.duration===300)));assert.ok(tabFrames.every(f=>f.bodyAnimation==='none'));checks.tab300EaseWithImmediateContent=true;
 // Reverse while the current underline transition is still running.
 await pointerClick('[data-tab="info"]');await pause(50);const mid=await evaluate(`getComputedStyle(document.querySelector('.lcd-active-indicator')).transform`);await pointerClick('[data-tab="activity"]');
 const reverse=await trace('.lcd-active-indicator','transform');assert.notEqual(mid,reverse.at(-1).transform);assert.equal(await evaluate(`document.querySelector('[data-tab="activity"]').getAttribute('aria-selected')`),'true');checks.tabReversesToLatestSelection=true;
 await evaluate(`document.querySelector('[data-tab="info"]').focus()`);await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:36,text:'\r',unmodifiedText:'\r'});await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:36,text:'\r',unmodifiedText:'\r'});
 assert.equal(await evaluate(`document.querySelector('[data-tab="info"]').getAttribute('aria-selected')`),'true');assert.equal(await evaluate(`document.querySelector('.lcd-active-indicator').getAnimations().length`),0);checks.keyboardTabImmediate=true;
 await pointerClick('.lcd-pagebar [data-action="list"]');await until(()=>evaluate(`!!document.querySelector('.company-link')`),'list');
 const beforeGroups=await snapshot();
 await pointerClick('[data-action="collapse-groups"]');
 assert.equal(await evaluate(`getComputedStyle(document.querySelector('.groups')).transitionDuration`),'0.3s','Captured group sidebar must animate width for 300ms');
 assert.deepEqual(await evaluate(`({inert:document.querySelector('.groups-viewport').inert,hidden:document.querySelector('.groups-viewport').getAttribute('aria-hidden')})`),{inert:true,hidden:'true'},'Collapsed groups must leave the keyboard and accessibility navigation');
 const groupCollapseFrames=await evaluate(`(async()=>{const frames=[],start=performance.now();do{await new Promise(requestAnimationFrame);const el=document.querySelector('.groups'),content=document.querySelector('.groups-content');frames.push({ms:performance.now()-start,width:el.getBoundingClientRect().width,contentWidth:content?.getBoundingClientRect().width,opacity:content?getComputedStyle(content).opacity:null,animations:el.getAnimations().map(a=>({property:a.transitionProperty,duration:a.effect.getTiming().duration}))});}while(performance.now()-start<350);return frames})()`);
 const expandedWidth=await evaluate(`(innerWidth-264)*.15299`);
 assert.ok(groupCollapseFrames.some(f=>f.width>0&&f.width<expandedWidth));assert.equal(groupCollapseFrames.at(-1).width,0);
 assert.ok(groupCollapseFrames.every(f=>Math.abs(f.contentWidth-(expandedWidth-1))<1&&f.opacity==='1'));
 assert.ok(groupCollapseFrames.some(f=>f.animations.some(a=>a.property==='width'&&a.duration===300)));checks.groups300WidthWithOpaqueFixedContent=true;await frame('groups-collapsed');
 await pointerClick('[data-action="collapse-groups"]');await pause(350);assert.ok(Math.abs(await evaluate(`document.querySelector('.groups').getBoundingClientRect().width`)-expandedWidth)<1);assert.equal(await evaluate(`document.querySelector('.groups-viewport').inert`),false);checks.groupsRestoreCapturedWidth=true;checks.collapsedGroupsLeaveKeyboardNavigation=true;
 await evaluate(`document.querySelector('.group-scroll').scrollTop=120`);const scrollBefore=await evaluate(`document.querySelector('.group-scroll').scrollTop`);
 await pointerClick('[data-action="collapse-groups"]');await pause(50);await pointerClick('[data-action="collapse-groups"]');await pause(350);
 assert.deepEqual(await evaluate(`({collapsed:document.querySelector('.panel').classList.contains('groups-collapsed'),motion:document.querySelector('.panel').classList.contains('groups-motion'),scroll:document.querySelector('.group-scroll').scrollTop})`),{collapsed:false,motion:false,scroll:scrollBefore});checks.groupsReverseKeepsLatestTargetAndScroll=true;
 await evaluate(`document.querySelector('[data-action="collapse-groups"]').click()`);assert.equal(await evaluate(`document.querySelector('.groups').getBoundingClientRect().width`),0);assert.equal(await evaluate(`document.querySelector('.groups').getAnimations().length`),0);checks.groupsProgrammaticKeyboardPathImmediate=true;
 await evaluate(`document.querySelector('[data-action="collapse-groups"]').click()`);await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await pointerClick('[data-action="collapse-groups"]');assert.equal(await evaluate(`document.querySelector('.groups').getBoundingClientRect().width`),0);assert.equal(await evaluate(`document.querySelector('.groups').getAnimations().length`),0);checks.groupsReducedImmediate=true;
 await evaluate(`document.querySelector('[data-action="collapse-groups"]').click();document.querySelector('.group-scroll').scrollTop=0`);await cdp.call('Emulation.setEmulatedMedia',{features:[]});assert.deepEqual(await snapshot(),beforeGroups);checks.groupsNeverWriteCustomerData=true;await frame('groups-expanded');
 const beforeNew=await snapshot();await pointerClick('[data-action="new"]');const drawerFrames=await trace('.drawer','transform');
 const create=await evaluate(`(()=>{const drawer=document.querySelector('.drawer'),overlay=document.querySelector('.overlay'),d=getComputedStyle(drawer),o=getComputedStyle(overlay,'::before');return {title:document.querySelector('.drawer-head h2').textContent,width:drawer.getBoundingClientRect().width,duration:d.transitionDuration,easing:d.transitionTimingFunction,maskDuration:o.transitionDuration,maskEasing:o.transitionTimingFunction}})()`);
 assert.equal(create.title,'新建客户');assert.equal(create.width,840);assert.equal(create.duration,'0.3s');assert.equal(create.maskDuration,'0.3s');assert.equal(create.easing,'cubic-bezier(0.23, 1, 0.32, 1)');assert.equal(create.maskEasing,create.easing);
 assert.ok(drawerFrames.some(f=>f.animations.some(a=>a.property==='transform'&&a.duration===300)));assert.ok(drawerFrames.every(f=>f.overlayOpacity===1),'Captured drawer must stay opaque while its separate mask fades');assert.ok(drawerFrames.some(f=>f.maskOpacity>0&&f.maskOpacity<1),'Actual mask must fade in');checks.newDrawer840And300StrongEaseOut=true;await frame('new-customer-open');
 const createGeometry=await drawerMetrics();console.log('Observed new-customer geometry: '+JSON.stringify(createGeometry));
 assert.equal(createGeometry.header,56);assert.equal(createGeometry.bodyPadding,'16px 24px');assert.equal(createGeometry.footer,64);assert.equal(createGeometry.titleWeight,'500');assert.equal(createGeometry.titleLine,'22px');assert.equal(createGeometry.maskColor,'rgba(20, 20, 20, 0.3)');checks.customerGeometryMatchesSeparateCapture=true;
 for(const kind of ['company','contact']){
  console.log('Checking '+kind+' optional section');
  const section='#customer-form .ce-'+kind+'-extra';
  await evaluate(`document.querySelector(${JSON.stringify(section+' > summary')}).scrollIntoView({block:'center',behavior:'instant'})`);await pointerClick(section+' > summary');
  assert.deepEqual(await evaluate(`(()=>{const s=document.querySelector(${JSON.stringify(section)}),c=s.querySelector('.ce-extra-content'),css=getComputedStyle(c);return {open:s.open,animated:c.getAnimations().length,opacity:css.opacity,transform:css.transform}})()`),{open:true,animated:0,opacity:'1',transform:'none'});checks[kind+'OptionalOpensImmediatelyWithoutFade']=true;
  const name=kind==='company'?'note':'contactNote';await evaluate(`document.querySelector('#customer-form [name="${name}"]').value='Unsaved optional draft'`);console.log('Capturing '+kind+' optional section');await frame(kind+'-optional-open');
  await evaluate(`document.querySelector(${JSON.stringify(section+' .ce-collapse')}).scrollIntoView({block:'center',behavior:'instant'})`);await pointerClick(section+' .ce-collapse');
  assert.deepEqual(await evaluate(`(()=>{const s=document.querySelector(${JSON.stringify(section)});return {open:s.open,animated:s.querySelector('.ce-extra-content').getAnimations().length,focus:document.activeElement===s.querySelector('summary')}})()`),{open:false,animated:0,focus:true});checks[kind+'OptionalClosesImmediatelyAndRestoresFocus']=true;
  for(let i=0;i<6;i++){await evaluate(`document.querySelector(${JSON.stringify(section+' > summary')}).scrollIntoView({block:'center',behavior:'instant'})`);await pointerClick(section+' > summary');await evaluate(`document.querySelector(${JSON.stringify(section+' .ce-collapse')}).scrollIntoView({block:'center',behavior:'instant'})`);await pointerClick(section+' .ce-collapse');}
  assert.equal(await evaluate(`document.querySelector('#customer-form [name="${name}"]').value`),'Unsaved optional draft');assert.equal(await evaluate(`document.querySelector(${JSON.stringify(section)}).open`),false);checks[kind+'OptionalRapidTogglesPreserveDraft']=true;
 }
 const createExit=await closeCapturedDrawer();checks.newDrawerCaptured300ExitWithLinearMask=true;assert.deepEqual(await snapshot(),beforeNew);checks.cancelNewDrawerDoesNotWrite=true;
 console.log('Checking five interrupted drawer openings');
 for(let i=0;i<5;i++){
  console.log('Interrupted opening '+(i+1));
  await pointerClick('[data-action="new"]');await pause(i%2?100:50);
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
  await until(()=>evaluate(`!document.querySelector('.drawer')`),'Escape interrupts opening');
 }
 assert.deepEqual(await snapshot(),beforeNew);checks.fiveInterruptedOpeningsUseEscapeHandlerWithoutStaleCallbacks=true;
 console.log('Checking Space-key drawer opening');
 await cdp.call('Page.bringToFront');
 await evaluate(`document.querySelector('[data-action="new"]').focus()`);
 await cdp.call('Input.dispatchKeyEvent',{type:'rawKeyDown',key:' ',code:'Space',windowsVirtualKeyCode:32,nativeVirtualKeyCode:49});
 await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32,nativeVirtualKeyCode:49});
 assert.equal(await evaluate(`document.querySelector('.overlay').classList.contains('modal-motion')`),false);
 assert.equal(await evaluate(`getComputedStyle(document.querySelector('.drawer')).transform`),'none');checks.keyboardNewDrawerSpaceImmediate=true;
 await evaluate(`document.querySelector('.drawer-head [data-action="close-modal"]').click()`);
 await evaluate(`document.querySelector('.company-link').click()`);await pointerClick('.lcd-pagebar [data-action="edit"]');await trace('.drawer','transform');
 const edit=await drawerMetrics();assert.equal(edit.duration,'0.3s');assert.equal(edit.maskDuration,'0.3s');assert.equal(edit.easing,'cubic-bezier(0.23, 1, 0.32, 1)');assert.equal(edit.header,56);checks.editDrawerMatchesDirectEditCapture=true;
 const editExit=await closeCapturedDrawer();checks.editDrawerCaptured300ExitWithLinearMask=true;
 await pointerClick('.lcd-pagebar [data-action="list"]');await until(()=>evaluate(`!!document.querySelector('.company-link')`),'list for groups');if(await evaluate(`document.querySelector('.panel').classList.contains('groups-collapsed')`)){await pointerClick('[data-action="collapse-groups"]');await until(()=>evaluate(`!document.querySelector('.groups').getAnimations().some(a=>a.playState==='running')`),'group navigation visible');}await pointerClick('[data-action="manage-segments"]');await until(()=>evaluate(`!!document.querySelector('.drawer-footer [data-action="new-segment"]')`),'group manager opened');await evaluate(`Promise.all(document.getAnimations().filter(animation=>animation.effect.getTiming().iterations!==Infinity).map(animation=>animation.finished.catch(()=>{})))`);await pointerClick('.drawer-footer [data-action="new-segment"]');await until(()=>evaluate(`!!document.querySelector('#segment-form [name="match"]')`),'rule group form');const groupFrames=await trace('.drawer','transform');
 const group=await drawerMetrics();assert.equal(group.width,840);assert.equal(group.header,66);assert.equal(group.bodyPadding,'16px 24px');assert.equal(group.footer,64);assert.equal(group.duration,'0.3s');assert.equal(group.maskDuration,'0.3s');assert.equal(group.easing,'cubic-bezier(0.23, 1, 0.32, 1)');assert.equal(group.maskColor,'rgba(20, 20, 20, 0.3)');assert.ok(groupFrames.some(f=>f.animations.some(a=>a.property==='transform'&&a.duration===300)));checks.ruleGroupGeometryAndEntranceMatchCapture=true;await frame('rule-group-open');
 const groupExit=await closeCapturedDrawer();checks.ruleGroupCaptured300ExitWithLinearMask=true;assert.deepEqual(await snapshot(),beforeNew);checks.cancelRuleGroupDoesNotWrite=true;
 await evaluate(`document.querySelector('.company-link').click()`);
 await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await pointerClick('[data-tab="activity"]');
 assert.ok(Number.parseFloat(await evaluate(`getComputedStyle(document.querySelector('.lcd-active-indicator')).transitionDuration`))<0.001);assert.equal(await evaluate(`getComputedStyle(document.querySelector('.lcd-body')).animationName`),'none');checks.reducedTabNoMovement=true;
 await evaluate(`document.querySelector('.lcd-pagebar [data-action="list"]').click()`);await pointerClick('[data-action="new"]');await trace('.drawer','transform',120);
 assert.equal(await evaluate(`getComputedStyle(document.querySelector('.drawer')).transform`),'none');assert.equal(await evaluate(`getComputedStyle(document.querySelector('.drawer')).transitionDuration`),'0.08s');checks.reducedDrawerOpacityOnly=true;
 await evaluate(`document.querySelector('.drawer-head [data-action="close-modal"]').click()`);await until(()=>evaluate(`!document.querySelector('.drawer')`),'reduced drawer closed');assert.deepEqual(await snapshot(),beforeNew);checks.motionNeverWritesCustomerData=true;
 await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:720,deviceScaleFactor:1,mobile:false});
 await pointerClick('[data-action="new"]');await trace('.drawer','transform');await frame('new-customer-compact');const compact=await evaluate(`(()=>{const r=document.querySelector('[form="customer-form"][value="save"]').getBoundingClientRect();return {right:r.right,bottom:r.bottom}})()`);assert.ok(compact.right<=1100&&compact.bottom<=720);checks.compactNewDrawerControlsFit=true;
 await evaluate(`document.querySelector('.ce-company-extra').open=true`);
 await pointerClick('#ce-source');await until(()=>evaluate(`!!document.querySelector('.lai-suggestions')`),'customer source suggestions');
 const suggestionGeometry=()=>evaluate(`(()=>{const input=document.querySelector('#ce-source').getBoundingClientRect(),menu=document.querySelector('.lai-suggestions')?.getBoundingClientRect(),body=document.querySelector('.customer-editor .drawer-body');return {inputTop:input.top,inputBottom:input.bottom,menuTop:menu?.top??null,scrollTop:body.scrollTop}})()`);
 const suggestionBefore=await suggestionGeometry();await frame('source-suggestions-before-scroll');await evaluate(`document.querySelector('.customer-editor .drawer-body').scrollTop+=40`);await evaluate(`new Promise(resolve=>requestAnimationFrame(resolve))`);const suggestionAfter=await suggestionGeometry();assert.notEqual(suggestionAfter.inputTop,suggestionBefore.inputTop);assert.notEqual(suggestionAfter.menuTop,null,'Open suggestions must survive editor scrolling');assert.equal(suggestionAfter.menuTop-suggestionAfter.inputBottom,4);checks.sourceSuggestionsFollowDrawerScroll=true;await frame('source-suggestions-after-scroll');
 await cdp.call('Emulation.setDeviceMetricsOverride',{width:1120,height:700,deviceScaleFactor:1,mobile:false});await evaluate(`new Promise(resolve=>requestAnimationFrame(resolve))`);const suggestionResized=await suggestionGeometry();assert.notEqual(suggestionResized.menuTop,null,'Open suggestions must survive viewport resizing');assert.equal(suggestionResized.menuTop-suggestionResized.inputBottom,4);checks.sourceSuggestionsFollowViewportResize=true;await frame('source-suggestions-after-resize');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:720,deviceScaleFactor:1,mobile:false});
 await evaluate(`(()=>{const body=document.querySelector('.customer-editor .drawer-body');body.scrollTop=body.scrollHeight})()`);await evaluate(`new Promise(resolve=>requestAnimationFrame(resolve))`);const suggestionOutOfView=await suggestionGeometry();assert.ok(suggestionOutOfView.inputBottom<=0||suggestionOutOfView.inputTop>=720,'Source input must leave viewport in this check');assert.equal(suggestionOutOfView.menuTop,null,'Offscreen source input must not leave a floating menu');assert.equal(await evaluate(`document.querySelector('#ce-source').getAttribute('aria-expanded')`),'false');checks.sourceSuggestionsCloseWhenInputLeavesViewport=true;await frame('source-suggestions-after-input-leaves');
 await evaluate(`document.querySelector('.drawer-head [data-action="close-modal"]').click()`);await until(()=>evaluate(`!document.querySelector('.drawer')`),'compact drawer closed');
 const compactGroup=await evaluate(`({width:document.querySelector('.groups').getBoundingClientRect().width,content:document.querySelector('.groups-content').getBoundingClientRect().width,buttonHeight:document.querySelector('.collapse-groups').getBoundingClientRect().height})`);
 assert.equal(compactGroup.width,220);assert.equal(compactGroup.content,219);assert.equal(compactGroup.buttonHeight,48);checks.compactGroupsRespectSourceMinimum=true;await frame('groups-compact');
 await pointerClick('[data-action="collapse-subnav"]');const navGroup=await evaluate(`({width:document.querySelector('.groups').getBoundingClientRect().width,content:document.querySelector('.groups-content').getBoundingClientRect().width})`);assert.equal(navGroup.width,220);assert.equal(navGroup.content,219);checks.groupsKeepSourceMinimumAfterNavCollapse=true;await frame('groups-nav-collapsed');
 await evaluate(`document.querySelector('[data-action="collapse-subnav"]').click()`);assert.deepEqual(await snapshot(),beforeNew);checks.optionalDraftCancelNeverWrites=true;
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({testedAt:new Date().toISOString(),app,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),result:'pass',scope:'M02 tab; customer new/edit and rule-group drawer geometry and bidirectional motion; M10 sidebar width; M13 optional sections; M11 six detail cards; isolated SQLite and browser media emulation; interrupted openings use synthetic Escape handler events, native hardware keys verified separately',checks,emptyDetailGeometry,compactDetailGeometry,foldObservations,compactGroup,navGroup,groupCollapseFrames,initialIndicator,tab,create,createGeometry,createExit,edit,editExit,group,groupFrames,reverse,drawerFrames},null,2));console.log('PASS: '+Object.keys(checks).length+' captured-motion checks');
}catch(error){console.error('Acceptance failure: '+error.message);if(cdp)await frame('failure').catch(()=>{});throw error;}
finally{cdp?.close();for(const child of children)await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
