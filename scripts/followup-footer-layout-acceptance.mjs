import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

// Existing followup footer: actual pointer/keyboard reachability, cancel and save in a seedless synthetic service.
const app=path.resolve(process.env.LAI_ACCEPTANCE_APP || 'dist/来财Lai.app');
const resources=path.join(app,'Contents/Resources');
const evidence=path.resolve(process.env.LAI_FOLLOWUP_LAYOUT_EVIDENCE || 'evidence/followup-narrow-layout-2026-10-04');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-activity-refresh-'));
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
    env:{...process.env,LAI_DATA_DIR:path.join(temporary,'database'),LAI_APP_PORT:String(port),LAI_API_TOKEN:token,LAI_INSTANCE_NONCE:'activity-refresh-test',LAI_APP_NO_OPEN:'1'},stdio:'ignore'});
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





const observations=[];
let fixtureSaves=0,expectedDatabase;
const refresh='[data-action="refresh-activity"]';
async function settle(){await until(()=>evaluate(`!document.getAnimations().some(a=>a.playState==='running'&&a.effect.getTiming().iterations!==Infinity)`),'finite UI motion');await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);}
async function key(key,code,n,modifiers=0){for(const type of ['keyDown','keyUp'])await cdp.call('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:n,modifiers,...(type==='keyDown'&&key==='Enter'?{text:'\r'}:{})});}
async function wheel(deltaY){const point=await evaluate(`(()=>{const r=document.querySelector('.customer-main').getBoundingClientRect();return{x:r.right-16,y:r.top+r.height/2}})()`);await cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await cdp.call('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY});await pause(60);}
async function reveal(selector){for(let i=0;i<30;i++){const state=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing target');const r=e.getBoundingClientRect(),b=document.querySelector('.customer-main').getBoundingClientRect();return{visible:r.top>=b.top&&r.bottom<=b.bottom,delta:r.top<b.top?-260:260}})()`);if(state.visible)return;await wheel(state.delta);}throw Error('Target cannot be revealed');}
async function tap(selector){await settle();await reveal(selector);await pointerClick(selector);}
async function input(selector,text){await tap(selector);for(const type of ['keyDown','keyUp'])await cdp.call('Input.dispatchKeyEvent',{type,key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:4,...(type==='keyDown'?{commands:['selectAll']}:{})});assert.ok(await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return document.activeElement===e&&e.selectionStart===0&&e.selectionEnd===e.value.length})()`),'actual keyboard select-all before replacement');await cdp.call('Input.insertText',{text});}
async function changeFixture(change){const data=await snapshot();change(data.data);const res=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:data,baseRevision:data.revision})});assert.equal(res.status,200);fixtureSaves++;expectedDatabase=await snapshot();return expectedDatabase;}
async function initial(){await navigate();await tap('[data-open="Refresh A"]');await until(()=>evaluate(`!!document.querySelector('.lcd-tabs [data-tab="activity"]')`),'A detail');await tap('.lcd-tabs [data-tab="activity"]');await input('#followup-text','A unsent draft');await settle();}
async function readUI(label){const value=await evaluate(`(()=>{const f=document.activeElement;const focus={id:f?.id||null,tag:f?.tagName,kind:f?.matches('[data-action=refresh-activity]')?'refresh':f?.id==='followup-text'?'draft':f?.id==='activity-search-input'?'query':f?.matches('.global-search input')?'global':'other',start:f?.selectionStart??null,end:f?.selectionEnd??null,direction:f?.selectionDirection??null};const b=document.querySelector('[data-action="refresh-activity"]'),s=document.querySelector('#activity-refresh-status'),t=document.querySelector('#toast'),r=document.querySelector('#activity-results');return{focus,title:document.querySelector('.lcd-root h2')?.textContent,tab:document.querySelector('.lcd-tabs [aria-selected="true"]')?.dataset.tab,disabled:b?.disabled,busy:r?.getAttribute('aria-busy'),status:s?.textContent,statusVisible:!!s?.checkVisibility(),toastVisible:!!t?.classList.contains('show'),toast:t?.classList.contains('show')?t.textContent:'',draft:document.querySelector('#followup-text')?.value,text:r?.textContent,query:document.querySelector('#activity-search-input')?.value,category:document.querySelector('[data-activity-filter][aria-pressed="true"]')?.dataset.activityFilter,refreshAnimation:b?getComputedStyle(b.querySelector('svg')).animationName:null}})()`);observations.push({label,pausedGetCount:cdp.paused.length,...value});return value;}
async function hold(label){const start=cdp.paused.length;await tabTo(refresh);await key('Enter','Enter',13);await until(()=>cdp.paused.length===start+1,'refresh request held');const request=cdp.paused[start];assert.equal(request.method,'GET');const ui=await readUI(label);assert.equal(ui.disabled,true);assert.equal(ui.busy,'true');assert.ok(ui.statusVisible&&ui.status.length);return request.requestId;}
async function responseFinished(id){const request=cdp.paused.find(r=>r.requestId===id);assert.ok(request?.networkId);await until(()=>cdp.completed.has(request.networkId),'browser response completed');await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);}
async function finish(id,mode='real',payload){if(mode==='real')await cdp.call('Fetch.continueRequest',{requestId:id});else if(mode==='network')await cdp.call('Fetch.failRequest',{requestId:id,errorReason:'ConnectionClosed'});else await cdp.call('Fetch.fulfillRequest',{requestId:id,responseCode:mode==='http'?503:200,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify(payload??{error:'Synthetic service failure'})).toString('base64')});await responseFinished(id);await until(()=>evaluate(`!document.querySelector('[data-action="refresh-activity"]')?.disabled&&document.querySelector('#activity-results')?.getAttribute('aria-busy')!=='true'`),'refresh UI released');}
async function unchanged(){assert.deepEqual(await snapshot(),expectedDatabase);}

async function tabTo(selector){
 await settle();assert.equal(await evaluate('document.querySelector('+JSON.stringify(selector)+')?.checkVisibility()'),true,'Keyboard target is actually visible');
 await key('Tab','Tab',9);
 for(let i=0;i<160;i++){if(await evaluate('document.activeElement?.matches('+JSON.stringify(selector)+')'))break;await key('Tab','Tab',9);}
 assert.equal(await evaluate('document.activeElement?.matches('+JSON.stringify(selector)+')'),true,'Actual Tab reaches '+selector);
}
async function enter(selector){await tabTo(selector);await key('Enter','Enter',13);}
async function selectTypedTail(selector,text,label){
 await tabTo(selector);await key('End','End',35);await cdp.call('Input.insertText',{text});for(let i=0;i<3;i++)await key('ArrowLeft','ArrowLeft',37,8);
 const ui=await readUI(label);assert.equal(ui.focus.end-ui.focus.start,3);const value=await evaluate('document.querySelector('+JSON.stringify(selector)+').value');assert.equal(value.slice(ui.focus.start,ui.focus.end),text.slice(-3));return {focus:ui.focus,value};
}


const failures=[];
async function check(name,run){try{await run();checks[name]=true;}catch(error){if(error.code!=='ERR_ASSERTION')throw error;checks[name]=false;failures.push({name,error:error.message});}}
const cancel='[data-action="cancel-followup"]',save='#followup-form [type="submit"]',date='#followup-form [name="nextFollow"]';
async function geometry(label){const g=await evaluate(`(()=>{const root=document.querySelector('.lcd-body-activity'),form=document.querySelector('#followup-form'),footer=form.querySelector('.lcd-followup-footer');const rect=e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,right:b.right,bottom:b.bottom,width:b.width,height:b.height}};const bound=rect(root);return {width:innerWidth,body:bound,footer:rect(footer),wrap:getComputedStyle(footer).flexWrap,draft:form.elements.text.value,date:form.elements.nextFollow.value,controls:[...footer.querySelectorAll('input,button')].map(e=>{const b=rect(e),x=b.x+b.width/2,y=b.y+b.height/2,hit=document.elementFromPoint(x,y);return {kind:e.tagName==='INPUT'?'date':e.type==='submit'?'save':'cancel',...b,visible:b.width>0&&b.height>0&&b.x>=bound.x-.5&&b.right<=bound.right+.5&&b.bottom<=innerHeight,hit:!!(hit&&(e.contains(hit)||hit.contains(e))),focused:document.activeElement===e}})}})()`);observations.push({label,...g});return g;}
function assertReach(g,kind){const c=g.controls.find(c=>c.kind===kind);assert.ok(c.visible,'Control fully inside followup body: '+kind);assert.ok(c.hit,'Actual pointer center targets '+kind);}
async function draft(text){await input('#followup-text',text);await settle();}
async function currentBaseline(){expectedDatabase=await snapshot();return expectedDatabase;}
function assertSaved(before,after,text){
 assert.equal(after.revision,before.revision+1);assert.equal(after.data.customers['Refresh A'].history[0].text,text);assert.equal(after.data.customers['Refresh A'].history[0].type,'followup');assert.equal(after.data.customers['Refresh A'].history[0].subtype,'quick');assert.equal(after.data.customers['Refresh A'].nextFollow,'2040-06-15');
 assert.equal(after.data.customers['Refresh A'].country,before.data.customers['Refresh A'].country);assert.equal(after.data.customers['Refresh A'].source,before.data.customers['Refresh A'].source);assert.deepEqual(after.data.customers['Refresh A'].contacts,before.data.customers['Refresh A'].contacts);assert.deepEqual(after.data.customers['Refresh A'].customPreserved,before.data.customers['Refresh A'].customPreserved);assert.deepEqual(after.data.customers['Untouched B'],before.data.customers['Untouched B']);assert.deepEqual(after.data.orders,before.data.orders);
}
try{
 fs.mkdirSync(evidence,{recursive:true});assert.equal(fs.existsSync(path.join(resources,'trade-order-data.json')),false);backend=await startBackend();const start=await snapshot();assert.deepEqual(start.data.customers,{});assert.equal(start.data.orders.length,0);await changeFixture(data=>{data.customers={'Refresh A':{country:'US',source:'Synthetic',contacts:['Fixture Person'],emails:['a@example.test'],nextFollow:'2040-06-15',customPreserved:{future:'unchanged'}},'Untouched B':{country:'FR',source:'Other Synthetic',contacts:['Other Fixture'],note:'Keep this'}};data.orders=[];});
 const port=await freePort(),browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps','--user-data-dir='+path.join(temporary,'chrome'),'--remote-debugging-port='+port,'about:blank'],{stdio:'ignore'});children.push(browser);let target;await until(async()=>{try{target=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(t=>t.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'private browser');cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Network.enable');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:1022,deviceScaleFactor:2,mobile:false});await initial();
 for(const width of [1756,1100,900]){
 await cdp.call('Emulation.setDeviceMetricsOverride',{width,height:1022,deviceScaleFactor:2,mobile:false});await draft('Draft '+width);await reveal(save);await settle();let g=await geometry('initial '+width);
 for(const kind of ['date','cancel','save'])await check('fully visible and hit '+width+' '+kind,()=>assertReach(g,kind));
 await check('resize preserves draft/date '+width,()=>{assert.equal(g.draft,'Draft '+width);assert.equal(g.date,'2040-06-15');});await frame('footer-'+width);
 let before=await currentBaseline();await check('pointer cancel '+width,async()=>{assertReach(g,'cancel');await tap(cancel);await settle();assert.equal(await evaluate('document.querySelector("#followup-text").value'),'');assert.deepEqual(await snapshot(),before);});
 await draft('Keyboard cancel '+width);before=await currentBaseline();await tabTo(cancel);g=await geometry('keyboard cancel focus '+width);await check('keyboard cancel visible '+width,()=>assertReach(g,'cancel'));await key('Enter','Enter',13);await settle();await check('keyboard cancel no save '+width,async()=>{assert.equal(await evaluate('document.querySelector("#followup-text").value'),'');assert.deepEqual(await snapshot(),before);});
 await draft('Pointer save '+width);before=await currentBaseline();g=await geometry('pointer save '+width);await check('pointer save exact customer '+width,async()=>{assertReach(g,'save');await tap(save);await until(async()=>{return (await snapshot()).revision===before.revision+1},'pointer followup persistence');await settle();assertSaved(before,await snapshot(),'Pointer save '+width);assert.equal(await evaluate('document.querySelector("#followup-text").value'),'');});
 await draft('Keyboard save '+width);before=await currentBaseline();await tabTo(save);g=await geometry('keyboard save focus '+width);await check('keyboard save visible '+width,()=>assertReach(g,'save'));await key('Enter','Enter',13);await until(async()=>{return (await snapshot()).revision===before.revision+1},'keyboard followup persistence');await settle();await check('keyboard save exact customer '+width,async()=>{assertSaved(before,await snapshot(),'Keyboard save '+width);assert.equal(await evaluate('document.querySelector("#followup-text").value'),'');});
 }
 await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await draft('Reduced draft');const last=await currentBaseline();const reduce=await geometry('reduced 900');for(const kind of ['date','cancel','save'])await check('reduce visible '+kind,()=>assertReach(reduce,kind));await tabTo(cancel);await key('Enter','Enter',13);await settle();await check('reduce keyboard cancel',async()=>assert.deepEqual(await snapshot(),last));assert.deepEqual(cdp.exceptions,[]);checks.noUncaughtErrors=true;
 if(failures.length)throw Error(failures.map(f=>f.name+': '+f.error).join('\n'));fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({result:'pass',checks,observations,syntheticFixtureApiSaves:fixtureSaves,uiSaveRequests:cdp.uiSaves.length,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),scope:'Existing followup footer only: real pointer/Tab+Enter cancel/save using synthetic customers; journey/filter tools and source pixel/native acceptance not covered'},null,2));console.log('PASS followup footer '+Object.keys(checks).length);
}catch(error){fs.writeFileSync(path.join(evidence,'failure.json'),JSON.stringify({error:error.message,failures,checks,observations,uiSaveRequests:cdp?.uiSaves.length,syntheticFixtureApiSaves:fixtureSaves,uncaught:cdp?.exceptions,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex')},null,2));if(cdp)await frame('failure').catch(()=>{});throw error;}
finally{if(cdp){await cdp.call('Page.navigate',{url:'about:blank'}).catch(()=>{});}cdp?.close();for(const child of [...children].reverse())await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});fs.writeFileSync(path.join(evidence,'cleanup.json'),JSON.stringify({temporaryRemoved:!fs.existsSync(temporary),children:children.map(child=>({pid:child.pid,exitCode:child.exitCode,signalCode:child.signalCode}))},null,2));assert.ok(children.every(child=>child.exitCode===0));}
