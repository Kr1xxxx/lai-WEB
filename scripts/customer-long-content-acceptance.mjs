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
const evidence=path.resolve(process.env.LAI_LONG_CONTENT_EVIDENCE || 'evidence/finishing-2026-10-06/long-content');
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
try {
 fs.mkdirSync(evidence,{recursive:true});backend=await startBackend();const fixture=await snapshot();
 fixture.data.orders=[];fixture.data.customers={[company]:{contact,country:'US',source:'Long fixture',email:'long-'+('abc'.repeat(80))+'@example.test',phone:'5550101',address:'ADDRESS-'+('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(12)),website:'https://example.test/'+('path'.repeat(110)),history:[{id:'long-followup',time:'2026-10-06T09:00:00',type:'followup',text:message}],extraContacts:[{id:'long-secondary',contact:'Secondary'+('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(7)),email:'secondary@example.test',address:'SECONDARY-ADDRESS-'+('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(10))}]}};
 fixture.data.previewSegments=[{id:'long-group',kind:'rules',match:'all',name:group,rules}];
 const saved=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:fixture,baseRevision:fixture.revision})});assert.equal(saved.status,200);const baseline=await snapshot();
 const port=await freePort();const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps','--user-data-dir='+path.join(temporary,'chrome'),'--remote-debugging-port='+port,'about:blank'],{stdio:'ignore'});children.push(browser);let target;
 await until(async()=>{try{target=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(t=>t.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'private browser');cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Network.enable');
 for(const width of [1756,1100,900]){
  await cdp.call('Emulation.setDeviceMetricsOverride',{width,height:1022,deviceScaleFactor:1,mobile:false});await navigate();await settle();
  await check('list full long name retained and bounded '+width,async()=>{assert.equal(await evaluate('document.querySelector(".company-link").dataset.open'),company);const r=await rects('.company-link');assert.ok(r[0].rect.width<350);assert.equal(await evaluate('document.querySelector(".company-link").textContent'),company);});
  await check('long group label has full tooltip '+width,async()=>{assert.equal(await evaluate(`document.querySelector('[data-group="segment:long-group"]')?.title`),group);});
  await frame('list-'+width);
  await tap('.company-link');await until(()=>evaluate('!!document.querySelector(".lcd-left h2")'),'long detail');
  await check('long summary and contacts wrap inside own columns '+width,async()=>{const r=await rects('.lcd-left h2,.lcd-contact-title strong,.lcd-contact dd');assert.ok(r.length>8);assert.ok(r.every(e=>e.scrollWidth<=e.width+2),JSON.stringify(r));assert.ok(await evaluate('document.querySelector(".lcd-left h2").textContent.includes('+JSON.stringify(company)+')'));});
  await tap('.lcd-tabs [data-tab="info"]');await check('long info values retained without horizontal content overflow '+width,async()=>{const r=await rects('.lcd-info-section dd');assert.ok(r.length>12);assert.ok(r.every(e=>e.scrollWidth<=e.width+2),JSON.stringify(r));});await frame('detail-info-'+width);
  await tap('.lcd-tabs [data-tab="activity"]');
  await check('long followup full text retained and wraps '+width,async()=>{assert.equal(await evaluate('[...document.querySelector(".lcd-event-body").childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join("")'),message);const r=await rects('.lcd-event-body');assert.equal(r.length,1);assert.ok(r[0].rect.width>0);const box=await evaluate('(()=>{const e=document.querySelector(".lcd-event-body");return {width:e.clientWidth,scrollWidth:e.scrollWidth,height:e.clientHeight}})()');assert.ok(box.scrollWidth<=box.width+2);assert.ok(box.height>500);});await frame('detail-activity-'+width);
  await tap('.lcd-pagebar [data-action="edit"]');await until(()=>evaluate('!!document.querySelector("#customer-form")'),'long customer editor');
  await check('existing long editor field values retained '+width,async()=>{assert.equal(await evaluate('document.querySelector("#customer-form [name=name]").value'),company);assert.equal(await evaluate('document.querySelector("#customer-form [name=contact]").value'),contact);});
  // Do not submit legacy overlength data: this check only opens and cancels existing data.
  await closeDrawer();await tap('.lcd-pagebar [data-action="list"]');await until(()=>evaluate('!!document.querySelector(".company-link")'),'list return');
  await tap('[data-action="manage-segments"]');await until(()=>evaluate('!!document.querySelector("[data-edit-segment=long-group]")'),'group management');await tap('[data-edit-segment="long-group"]');await until(()=>evaluate('!!document.querySelector("#segment-form")'),'rule editor');
  await check('32 rules and long values retained '+width,async()=>{assert.equal(await evaluate('document.querySelectorAll("#rules .rule-row").length'),32);assert.equal(await evaluate('document.querySelector("#segment-form [name=name]").value'),group);assert.equal(await evaluate(`document.querySelector('[data-rule="0"] [data-rule-prop=value]').value`),rules[0].value);const r=await rects('#segment-form');assert.ok(r[0].scrollWidth<=r[0].width+2);});
  await tap('[data-rule="31"] [data-rule-prop="value"]');await check('last rule reachable with actual wheel '+width,async()=>assert.equal(await evaluate(`document.activeElement===document.querySelector('[data-rule="31"] [data-rule-prop=value]')`),true));await frame('rules-bottom-'+width);
  await check('fixed group footer cancel remains reachable '+width,async()=>{await tap('.drawer-footer [data-action="close-modal"]');await until(()=>evaluate('!document.querySelector("#segment-form")'),'group cancel');});
  await check('cancelled views have zero UI writes '+width,async()=>{assert.deepEqual(await snapshot(),baseline);assert.equal(cdp.uiSaves.length,0);});
 }
 assert.deepEqual(cdp.exceptions,[]);fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({result:'pass',checks,steps,observations,uiSaveRequests:cdp.uiSaves.length,syntheticFixtureApiSaves:1,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),probeSha256:crypto.createHash('sha256').update(fs.readFileSync(new URL(import.meta.url))).digest('hex'),scope:'Synthetic long company/contact/email/URL/address, long multiline followup, 32 existing group rules; 1756/1100/900 browser actual input and cancellation. No product fields/business limits changed. Not source pixel or native GPU acceptance.'},null,2));console.log(JSON.stringify({result:'pass',checks:Object.keys(checks).length,uiSaves:cdp.uiSaves.length}));
}catch(error){fs.writeFileSync(path.join(evidence,'failure.json'),JSON.stringify({error:error.message,checks,steps},null,2));if(cdp)await frame('failure').catch(()=>{});throw error;}
finally{if(cdp)await cdp.call('Page.navigate',{url:'about:blank'}).catch(()=>{});cdp?.close();for(const child of [...children].reverse())await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});fs.writeFileSync(path.join(evidence,'cleanup.json'),JSON.stringify({temporaryRemoved:!fs.existsSync(temporary),children:children.map(child=>({pid:child.pid,exitCode:child.exitCode,signalCode:child.signalCode}))},null,2));}
