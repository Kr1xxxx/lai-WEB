import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

// Customer-detail order handoff using real CDP input and synthetic SQLite only.
const app=path.resolve(process.env.LAI_ACCEPTANCE_APP || 'dist/来财Lai.app');
const resources=path.join(app,'Contents/Resources');
const evidence=path.resolve(process.env.LAI_LONG_SAVE_EVIDENCE || 'evidence/final-acceptance-2026-10-06/long-save');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-customer-detail-order-'));
const derivedCustomer=process.env.LAI_ORDER_DERIVED === '1';
const children=[];
const checks={};
let cdp, backend;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const freePort=()=>new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
async function until(check,label){for(let i=0;i<160;i++){if(await check())return;await pause(50);}throw Error('Timed out: '+label);}
async function stop(child){if(!child||child.exitCode!==null||child.signalCode!==null)return;child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),pause(6000)]);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await new Promise(resolve=>child.once('exit',resolve));}}
async function startBackend(){
  const port=await freePort(),token=crypto.randomBytes(32).toString('hex');
  const child=spawn(path.join(resources,'node-runtime'),[path.join(resources,'server.js')],{
    env:{...process.env,LAI_DATA_DIR:path.join(temporary,'database'),LAI_APP_PORT:String(port),LAI_API_TOKEN:token,LAI_INSTANCE_NONCE:'customer-detail-order-test',LAI_APP_NO_OPEN:'1'},stdio:'ignore'});
  children.push(child);
  const base=`http://127.0.0.1:${port}`;
  await until(async()=>{if(child.exitCode!==null)throw Error('Isolated service exited');try{return (await fetch(base+'/api/health')).ok;}catch{return false;}},'isolated backend');
  return {child,base,token};
}
async function snapshot(){return (await fetch(backend.base+'/api/data',{headers:{'x-trade-token':backend.token}})).json();}
async function connect(url){
  const socket=new WebSocket(url);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let sequence=0;const pending=new Map();const paused=[];const completed=new Set();const exceptions=[];const uiSaves=[];
  socket.addEventListener('message',event=>{const message=JSON.parse(String(event.data));if(message.method==='Network.requestWillBeSent'&&message.params.request.url===backend.base+'/api/save'){uiSaves.push({method:message.params.request.method});return;}if(message.method==='Fetch.requestPaused'){paused.push({requestId:message.params.requestId,networkId:message.params.networkId,method:message.params.request.method});return;}if(message.method==='Network.loadingFinished'||message.method==='Network.loadingFailed'){completed.add(message.params.requestId);return;}if(message.method==='Runtime.exceptionThrown'){exceptions.push({text:message.params.exceptionDetails.text,description:message.params.exceptionDetails.exception?.description?.split('\n')[0]});return;}const request=pending.get(message.id);if(!request)return;pending.delete(message.id);clearTimeout(request.timer);if(message.error)request.reject(Error(message.error.message));else request.resolve(message.result);});
  return {paused,completed,exceptions,uiSaves,call(method,params={}){const id=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('Isolated browser command timed out: '+method))},5000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});},close(){socket.close();}};
}
async function evaluate(expression){const result=await cdp.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description?.split('\n')[0]||result.exceptionDetails.text);return result.result.value;}
async function navigate(){await cdp.call('Page.navigate',{url:backend.base+'/trade-order-system.html?token='+encodeURIComponent(backend.token)+'#customers'});await until(()=>evaluate(`!!document.querySelector('.company-link')`),'customer list');}
async function frame(name){
 await until(()=>evaluate(`!document.querySelector('#toast')?.classList.contains('show')`),'toast finished');
 await until(()=>evaluate(`!document.getAnimations().some(a=>a.playState==='running'&&a.effect.getTiming().iterations!==Infinity)`),'finite screenshot animations settled');
 await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
 const result=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(evidence,name+'.png'),Buffer.from(result.data,'base64'));}

async function pointerClick(selector,waitForFrames=true){
 if(waitForFrames)await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
 const point=await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)}),r=el.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);if(!r.width||!r.height||!(el.contains(hit)||hit?.contains(el)))throw Error('Pointer target is hidden or covered: '+${JSON.stringify(selector)}+' '+JSON.stringify({x,y,rect:r.toJSON(),hit:hit?.className,overlay:el.closest('.overlay')?.className,animations:document.getAnimations().map(a=>({state:a.playState,time:a.currentTime,target:a.effect.target.className}))}));return {x,y}})()`);
 await cdp.call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
 await cdp.call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
}






const steps=[];
async function key(key,code,n,modifiers=0){for(const type of ['keyDown','keyUp'])await cdp.call('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:n,modifiers,...(type==='keyDown'&&key==='Enter'?{text:'\r'}:{}),...(type==='keyDown'&&key==='a'&&modifiers===4?{commands:['selectAll']}:{})});}
async function settle(){await until(()=>evaluate(`!document.getAnimations().some(a=>a.playState==='running'&&a.effect.getTiming().iterations!==Infinity)`),'finite motion');await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);}
async function reach(selector){
 for(let i=0;i<32;i++){
  const s=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing actual target '+${JSON.stringify(selector)});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,h=document.elementFromPoint(x,y);if(r.width&&r.height&&x>=0&&x<innerWidth&&y>=0&&y<innerHeight&&(e.contains(h)||h?.contains(e)))return {ready:true};const horizontal=x<0||x>=innerWidth;let p=e.parentElement;for(;p;p=p.parentElement){const css=getComputedStyle(p);if(horizontal?p.scrollWidth>p.clientWidth+1&&/auto|scroll/.test(css.overflowX):p.scrollHeight>p.clientHeight+1&&/auto|scroll/.test(css.overflowY))break;}p=p||document.querySelector('.customer-main');const b=p.getBoundingClientRect();return {ready:false,x:Math.max(5,Math.min(innerWidth-12,horizontal?b.x+b.width/2:b.right-15)),y:Math.max(120,Math.min(innerHeight-15,b.y+b.height/2)),deltaX:horizontal?(x<0?-320:320):0,deltaY:horizontal?0:(r.y<b.y?-320:320),rect:r.toJSON(),scroll:p.className,hit:h?.className}})()`);
  if(s.ready)return;
  await cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:s.x,y:s.y});
  await cdp.call('Input.dispatchMouseEvent',{type:'mouseWheel',x:s.x,y:s.y,deltaX:s.deltaX,deltaY:s.deltaY});await pause(50);
 }
 throw Error('Actual wheel cannot reach '+selector);
}
async function tap(selector){await settle();await reach(selector);await pointerClick(selector);}
async function fill(selector,text){await tap(selector);await key('a','KeyA',65,4);assert.equal(await evaluate('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');return document.activeElement===e&&(e.type==="number"||(e.selectionStart===0&&e.selectionEnd===e.value.length))})()'),true,'Actual select-all');await cdp.call('Input.insertText',{text});assert.equal(await evaluate('document.querySelector('+JSON.stringify(selector)+').value'),text);}
async function check(name,fn){await fn();checks[name]=true;steps.push(name);}

const observations=[];
const company='LongCompany'+('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(14));
const contact='LongContact'+('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(10));
const message='LONG-ACTIVITY-START-'+('ABCDEFGHIJKLMNOPQRSTUVWXYZ\n长内容换行测试'.repeat(80))+'-LONG-ACTIVITY-END';
const group='LongGroup'+('名称'.repeat(35));
const rules=Array.from({length:32},(_,i)=>({field:'name',op:'contains',value:i===0?'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(20):'LongCompany'}));
const rects=selector=>evaluate(`Array.from(document.querySelectorAll(${JSON.stringify(selector)}),e=>({text:e.textContent.length,width:e.clientWidth,scrollWidth:e.scrollWidth,height:e.clientHeight,scrollHeight:e.scrollHeight,rect:e.getBoundingClientRect().toJSON(),overflow:getComputedStyle(e).overflowX,title:e.getAttribute('title')}))`);
async function closeDrawer(){await tap('.drawer-head [data-action="close-modal"]');await until(()=>evaluate('!document.querySelector(".overlay")'),'drawer closed');}

async function startBrowser(){
 const port=await freePort();const child=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps','--user-data-dir='+path.join(temporary,'chrome'),'--remote-debugging-port='+port,'about:blank'],{stdio:'ignore'});children.push(child);let target;
 await until(async()=>{try{target=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(t=>t.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'private browser');
 cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Network.enable');return child;
}
let beforeRestart, afterRestart, firstSaves=0, browser;
const updatedContact=contact+'-SAVED',updatedGroup=group+'Z',updatedRule='SavedRule-'+('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(20));
function retainedCustomer(customer){
 assert.equal(customer.contact,updatedContact);assert.equal(customer.email,'long-'+('abc'.repeat(80))+'@example.test');
 assert.equal(customer.address,'ADDRESS-'+('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(12)));assert.equal(customer.website,'https://example.test/'+('path'.repeat(110)));
 assert.equal(customer.extraContacts[0].contact,'Secondary'+('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(7)));assert.equal(customer.extraContacts[0].id,'long-secondary');
 assert.equal(customer.extraContacts[0].address,'SECONDARY-ADDRESS-'+('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(10)));assert.deepEqual(customer.extraContacts[0].legacyUnshown,{sentinel:'UNCHANGED'});
 assert.equal(customer.history.find(e=>e.id==='long-followup').text,message);
}
try {
 fs.mkdirSync(evidence,{recursive:true});backend=await startBackend();const fixture=await snapshot();
 fixture.data.orders=[];fixture.data.customers={[company]:{contact,country:'US',source:'Long fixture',email:'long-'+('abc'.repeat(80))+'@example.test',phone:'5550101',address:'ADDRESS-'+('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(12)),website:'https://example.test/'+('path'.repeat(110)),history:[{id:'long-followup',time:'2026-10-06T09:00:00',type:'followup',text:message}],extraContacts:[{id:'long-secondary',contact:'Secondary'+('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(7)),email:'secondary@example.test',address:'SECONDARY-ADDRESS-'+('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(10)),legacyUnshown:{sentinel:'UNCHANGED'}}]}};
 fixture.data.previewSegments=[{id:'long-group',kind:'rules',match:'all',name:group,rules}];
 const seeded=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:fixture,baseRevision:fixture.revision})});assert.equal(seeded.status,200);
 browser=await startBrowser();await cdp.call('Emulation.setDeviceMetricsOverride',{width:900,height:1022,deviceScaleFactor:1,mobile:false});await navigate();await tap('.company-link');await until(()=>evaluate('!!document.querySelector(".lcd-left h2")'),'detail');
 await tap('.lcd-pagebar [data-action="edit"]');await until(()=>evaluate('!!document.querySelector("#customer-form")'),'editor');
 await fill('#customer-form [name="contact"]',updatedContact);await tap('button[type="submit"][form="customer-form"]');await until(()=>evaluate('!document.querySelector("#customer-form")'),'customer saved');
 await check('900 actual customer save preserves long fields and secondary hidden attributes',async()=>retainedCustomer((await snapshot()).data.customers[company]));
 await tap('.lcd-pagebar [data-action="edit"]');await until(()=>evaluate('!!document.querySelector("#customer-form")'),'reopened editor');
 await check('long contact saved and reopened in actual form',async()=>assert.equal(await evaluate('document.querySelector("#customer-form [name=contact]").value'),updatedContact));await frame('customer-saved-reopened');await closeDrawer();
 await tap('.lcd-tabs [data-tab="activity"]');await fill('#followup-form [name="text"]',message+'-SECOND-SAVED');await tap('#followup-form button[type="submit"]');
 await until(async()=>((await snapshot()).data.customers[company].history||[]).some(e=>e.text===message+'-SECOND-SAVED'),'long followup saved');
 await check('long followup saved once without losing original history',async()=>{const h=(await snapshot()).data.customers[company].history;assert.equal(h.filter(e=>e.text===message+'-SECOND-SAVED').length,1);assert.equal(h.find(e=>e.id==='long-followup').text,message);});
 await tap('.lcd-pagebar [data-action="list"]');await until(()=>evaluate('!!document.querySelector(".company-link")'),'list');await tap('[data-action="manage-segments"]');await tap('[data-edit-segment="long-group"]');
 await fill('#segment-form [name="name"]',updatedGroup);await fill('[data-rule="31"] [data-rule-prop="value"]',updatedRule);await tap('button[type="submit"][form="segment-form"]');await until(()=>evaluate('!document.querySelector("#segment-form")'),'group saved');
 await check('80-character group name and 32 rules save without truncation',async()=>{const g=(await snapshot()).data.previewSegments.find(g=>g.id==='long-group');assert.equal(g.name,updatedGroup);assert.equal(g.rules.length,32);assert.deepEqual(g.rules.slice(0,31),rules.slice(0,31));assert.equal(g.rules[31].value,updatedRule);});
 if(await evaluate('!!document.querySelector(".overlay")'))await closeDrawer();
 beforeRestart=await snapshot();firstSaves=cdp.uiSaves.length;assert.equal(firstSaves,3);assert.deepEqual(cdp.exceptions,[]);fs.writeFileSync(path.join(evidence,'before-restart.json'),JSON.stringify(beforeRestart,null,2));
 await cdp.call('Page.navigate',{url:'about:blank'});cdp.close();cdp=null;await stop(browser);await stop(backend.child);
 backend=await startBackend();browser=await startBrowser();await cdp.call('Emulation.setDeviceMetricsOverride',{width:1100,height:1022,deviceScaleFactor:1,mobile:false});await navigate();
 afterRestart=await snapshot();await check('real backend and browser restart preserves complete data and revision',async()=>{assert.deepEqual(afterRestart.data,beforeRestart.data);assert.equal(afterRestart.revision,beforeRestart.revision);retainedCustomer(afterRestart.data.customers[company]);});
 await tap('.company-link');await until(()=>evaluate('!!document.querySelector(".lcd-left h2")'),'restarted detail');await tap('.lcd-pagebar [data-action="edit"]');
 await check('1100 restarted editor contains full saved long contact',async()=>assert.equal(await evaluate('document.querySelector("#customer-form [name=contact]").value'),updatedContact));await closeDrawer();await tap('.lcd-pagebar [data-action="list"]');
 await tap('[data-action="manage-segments"]');await tap('[data-edit-segment="long-group"]');
 await check('restarted rule editor contains full saved name and first/last values',async()=>{assert.equal(await evaluate('document.querySelector("#segment-form [name=name]").value'),updatedGroup);assert.equal(await evaluate('document.querySelectorAll("#rules .rule-row").length'),32);assert.equal(await evaluate('document.querySelector("[data-rule=\\"0\\"] [data-rule-prop=value]").value'),rules[0].value);assert.equal(await evaluate('document.querySelector("[data-rule=\\"31\\"] [data-rule-prop=value]").value'),updatedRule);});
 await tap('[data-rule="31"] [data-rule-prop="value"]');await frame('rules-saved-restarted');await closeDrawer();
 await check('restart inspection and cancel have zero extra writes',async()=>{assert.equal(cdp.uiSaves.length,0);assert.deepEqual((await snapshot()).data,beforeRestart.data);assert.equal((await snapshot()).revision,beforeRestart.revision);});assert.deepEqual(cdp.exceptions,[]);
 fs.writeFileSync(path.join(evidence,'after-restart.json'),JSON.stringify(afterRestart,null,2));
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({result:'pass',checks,steps,uiSaveRequests:firstSaves,syntheticFixtureApiSaves:1,completeDataAndRevisionEqualAfterRestart:true,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),probeSha256:crypto.createHash('sha256').update(fs.readFileSync(new URL(import.meta.url))).digest('hex'),scope:'Synthetic existing long customer/contact/email/URL/address/history and 32 rules; actual customer edit, followup and group save at900, restart service+browser, reopen at1100. Product limits unchanged; not native/source pixels.'},null,2));console.log(JSON.stringify({result:'pass',checks:Object.keys(checks).length,uiSaves:firstSaves}));
}catch(error){fs.writeFileSync(path.join(evidence,'failure.json'),JSON.stringify({error:error.message,checks,steps},null,2));if(cdp)await frame('failure').catch(()=>{});throw error;}
finally{if(cdp)await cdp.call('Page.navigate',{url:'about:blank'}).catch(()=>{});cdp?.close();for(const child of [...children].reverse())await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});fs.writeFileSync(path.join(evidence,'cleanup.json'),JSON.stringify({temporaryRemoved:!fs.existsSync(temporary),children:children.map(child=>({pid:child.pid,exitCode:child.exitCode,signalCode:child.signalCode}))},null,2));}
