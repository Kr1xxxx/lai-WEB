import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

// Existing search: draft blur must not discard a previously committed query.
const app=path.resolve(process.env.LAI_ACCEPTANCE_APP || 'dist/来财Lai.app');
const resources=path.join(app,'Contents/Resources');
const evidence=path.resolve(process.env.LAI_SEARCH_BLUR_EVIDENCE || 'evidence/activity-search-submit-blur-2026-10-04/red121');
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





async function settle(){await until(()=>evaluate(`!document.getAnimations().some(a=>a.playState==='running'&&a.effect.getTiming().iterations!==Infinity)`),'finite UI motion');await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);}
async function key(key,code,n,modifiers=0){for(const type of ['keyDown','keyUp'])await cdp.call('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:n,modifiers,...(type==='keyDown'&&key==='Enter'?{text:'\r'}:{}),...(type==='keyDown'&&key==='a'&&modifiers===4?{commands:['selectAll']}:{})});}
async function wheel(deltaY){const point=await evaluate(`(()=>{const r=document.querySelector('.customer-main').getBoundingClientRect();return{x:r.right-16,y:r.top+r.height/2}})()`);await cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await cdp.call('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY});await pause(60);}
async function revealVertical(selector){for(let i=0;i<30;i++){const state=await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing target');const r=e.getBoundingClientRect(),b=document.querySelector('.customer-main').getBoundingClientRect();return{visible:r.top>=b.top&&r.bottom<=b.bottom,delta:r.top<b.top?-260:260}})()`);if(state.visible)return;await wheel(state.delta);}throw Error('Target cannot be revealed');}
async function reveal(selector){await revealVertical(selector);for(let i=0;i<12;i++){const v=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(),b=document.querySelector('.customer-main').getBoundingClientRect(),lo=Math.max(0,b.left),hi=Math.min(innerWidth,b.right);return {good:r.left>=lo&&r.right<=hi,delta:r.left<lo?r.left-lo-8:r.right-hi+8,x:lo+(hi-lo)/2,y:Math.max(b.top+20,Math.min(b.bottom-20,r.y+r.height/2))}})()`);if(v.good)return;await cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:v.x,y:v.y});await cdp.call('Input.dispatchMouseEvent',{type:'mouseWheel',x:v.x,y:v.y,deltaX:v.delta,deltaY:0});await pause(80);}throw Error('Horizontal target cannot be revealed '+selector);}
async function tap(selector){await settle();await reveal(selector);await pointerClick(selector);}
async function input(selector,text){await tap(selector);for(const type of ['keyDown','keyUp'])await cdp.call('Input.dispatchKeyEvent',{type,key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:4,...(type==='keyDown'?{commands:['selectAll']}:{})});assert.ok(await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return document.activeElement===e&&e.selectionStart===0&&e.selectionEnd===e.value.length})()`),'actual keyboard select-all before replacement');await cdp.call('Input.insertText',{text});}

const observations=[],failures=[],skipped=[];
const queryInput='#activity-search-input', searchTrigger='[data-action="activity-search"]';
const draft='UNSENT SEARCH BLUR DRAFT', noMatch='__lai_m19_no_match_20261004__';
let fixtureSaves=0,expectedDatabase;
async function check(name,fn){try{await fn();checks[name]=true;}catch(error){if(error.code!=='ERR_ASSERTION')throw error;checks[name]=false;failures.push({name,error:error.message});}}
async function read(label){const value=await evaluate(`(()=>{const row=document.querySelector('#activity-search-row'),input=row?.querySelector('input'),tools=document.querySelector('.lcd-activity-tools-buttons'),active=document.activeElement;return{width:innerWidth,open:!!row&&!row.hidden,input:input?.value,focused:active===input,inside:!!row?.contains(active),toolsVisible:!!tools?.checkVisibility(),triggerExpanded:document.querySelector('[data-action="activity-search"]')?.getAttribute('aria-expanded'),counts:[...document.querySelectorAll('[data-activity-filter]')].map(e=>Number(e.textContent.match(/\\((\\d+)\\)/)?.[1])),records:[...document.querySelectorAll('#activity-results .lcd-activity-record')].map(e=>e.querySelector('.lcd-event-body')?.firstChild?.textContent),selected:document.querySelector('[data-activity-filter][aria-pressed=true]')?.dataset.activityFilter,draft:document.querySelector('#followup-text')?.value,date:document.querySelector('#followup-form [name=nextFollow]')?.value,activeId:active?.id,activeTag:active?.tagName}})()`);observations.push({label,...value});return value;}
function zero(s){assert.deepEqual(s.counts,[0,0,0,0,0]);assert.deepEqual(s.records,[]);assert.equal(s.selected,'all');}
function all(s){assert.deepEqual(s.counts,[4,1,1,1,1]);assert.equal(s.records.length,4);for(const t of ['FOLLOWUP','EMAIL','CHAT','OTHER'])assert.ok(s.records.some(v=>v.includes('BLUR '+t)));assert.ok(!s.records.some(v=>v.includes('SECOND CUSTOMER')));}
function preserved(s){assert.equal(s.draft,draft);assert.equal(s.date,'2040-06-15');}
async function tabTo(selector){await settle();await reveal(selector);if(await evaluate('document.activeElement?.matches('+JSON.stringify(selector)+')'))return;await key('Tab','Tab',9);for(let i=0;i<160;i++){if(await evaluate('document.activeElement?.matches('+JSON.stringify(selector)+')'))return;await key('Tab','Tab',9);}throw Error('Actual Tab could not reach '+selector);}
async function open(mode){if(mode==='keyboard'){await tabTo(searchTrigger);await key('Enter','Enter',13);}else await tap(searchTrigger);assert.equal((await read('opened '+mode)).focused,true);}
async function blur(mode){if(mode!=='keyboard')return tap('#followup-text');for(let i=0;i<8;i++){await key('Tab','Tab',9);if(!await evaluate('document.querySelector("#activity-search-row").contains(document.activeElement)'))return;}throw Error('Actual Tab did not leave search row');}
async function clearTyped(mode){if(mode==='keyboard')await tabTo(queryInput);else await tap(queryInput);await key('a','KeyA',65,4);assert.equal(await evaluate('(()=>{const i=document.querySelector("#activity-search-input");return i.selectionStart===0&&i.selectionEnd===i.value.length})()'),true);await key('Backspace','Backspace',8);assert.equal((await read('actual Backspace')).input,'');}
async function type(mode,text){if(mode==='keyboard')await tabTo(queryInput);else await tap(queryInput);await cdp.call('Input.insertText',{text});}
try{
 fs.mkdirSync(evidence,{recursive:true});backend=await startBackend();const seed=await snapshot();
 seed.data.customers={'Blur Fixture':{contact:'Primary',nextFollow:'2040-06-15',unknown:'PRESERVE',history:[{type:'followup',time:'2024-01-04T10:00:00Z',text:'BLUR FOLLOWUP'},{type:'email',time:'2024-01-03T10:00:00Z',text:'BLUR EMAIL'},{type:'chat',time:'2024-01-02T10:00:00Z',text:'BLUR CHAT'},{type:'created',time:'2024-01-01T10:00:00Z',text:'BLUR OTHER'}]},'Second Fixture':{unknown:'UNCHANGED',history:[{type:'followup',time:'2024-01-01T10:00:00Z',text:'SECOND CUSTOMER'}]}};seed.data.orders=[];seed.data.previewSegments=[];
 const res=await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:seed,baseRevision:seed.revision})});assert.equal(res.status,200);fixtureSaves++;expectedDatabase=await snapshot();
 const port=await freePort(),browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps','--user-data-dir='+path.join(temporary,'chrome'),'--remote-debugging-port='+port,'about:blank'],{stdio:'ignore'});children.push(browser);let target;await until(async()=>{try{target=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(t=>t.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'private browser');cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Network.enable');
 for(const width of [1756,1100,900])for(const mode of ['pointer','keyboard','reduced']){
  const label=width+' '+mode;await cdp.call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:mode==='reduced'?'reduce':'no-preference'}]});await navigate();await tap('[data-open="Blur Fixture"]');await tap('.lcd-tabs [data-tab="activity"]');await input('#followup-text',draft);const initial=await read('initial '+label);
  await check('initial actual records and draft '+label,()=>{all(initial);preserved(initial);});
  await open(mode);await type(mode,noMatch);await key('Enter','Enter',13);await blur(mode);const submitted=await read('nonempty blurred '+label);
  await check('submitted nonempty remains open '+label,()=>{assert.equal(submitted.open,true);assert.equal(submitted.input,noMatch);zero(submitted);preserved(submitted);});
  await clearTyped(mode);const blank=await read('empty unsubmitted '+label);
  await check('Backspace does not submit '+label,()=>{assert.equal(blank.input,'');assert.equal(blank.open,true);zero(blank);});
  await blur(mode);const closed=await read('empty blurred '+label);if(mode==='pointer')await frame('empty-draft-keeps-query-'+width);
  await check('empty draft closes preserving query '+label,()=>{assert.equal(closed.open,false,'Empty newer draft must collapse despite old nonempty committed query');assert.equal(closed.toolsVisible,true);assert.equal(closed.triggerExpanded,'false');zero(closed);preserved(closed);});
  if(closed.open){skipped.push({label,step:'actual reopen',reason:'baseline defect kept row open'});if(mode==='keyboard')await tabTo(queryInput);else await tap(queryInput);}
  else{await open(mode);const reopened=await read('reopened '+label);await check('reopen keeps empty draft and committed result '+label,()=>{assert.equal(reopened.input,'');assert.equal(reopened.focused,true);zero(reopened);preserved(reopened);});}
  await key('Enter','Enter',13);const restored=await read('empty Enter '+label);
  await check('empty Enter restores all '+label,()=>{all(restored);preserved(restored);assert.equal(restored.focused,true);});
  await key('Escape','Escape',27);const escaped=await read('Escape '+label);
  await check('Escape leaves empty focused search open '+label,()=>{assert.equal(escaped.open,true);assert.equal(escaped.focused,true);all(escaped);});
  await blur(mode);const emptyClosed=await read('no-query blur '+label);
  await check('empty no-query blur closes '+label,()=>{assert.equal(emptyClosed.open,false);assert.equal(emptyClosed.toolsVisible,true);all(emptyClosed);});
  await open(mode);await type(mode,'UNSUBMITTED');await blur(mode);const nonempty=await read('unsubmitted nonempty '+label);
  await check('nonempty unsubmitted blur preserves draft '+label,()=>{assert.equal(nonempty.open,true);assert.equal(nonempty.input,'UNSUBMITTED');all(nonempty);preserved(nonempty);});
  await tap('[data-action="clear-activity-search"]');const cleared=await read('clear button '+label);
  await check('clear button restores and keeps focus '+label,()=>{assert.equal(cleared.input,'');assert.equal(cleared.focused,true);assert.equal(cleared.open,true);all(cleared);preserved(cleared);});
  await blur(mode);await check('SQLite unchanged '+label,async()=>{assert.deepEqual(await snapshot(),expectedDatabase);assert.equal(cdp.uiSaves.length,0);});
  if(mode==='pointer')await frame('restored-'+width);
 }
 // Matching query also persists across empty unsubmitted blur, then explicit clear removes it.
 await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:900,deviceScaleFactor:1,mobile:false});await cdp.call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});await navigate();await tap('[data-open="Blur Fixture"]');await tap('.lcd-tabs [data-tab="activity"]');await input('#followup-text',draft);await open('pointer');await type('pointer','FOLLOWUP');await key('Enter','Enter',13);await clearTyped('pointer');await blur('pointer');const match=await read('matching query empty blur');
 await check('matching query retained while collapsed',()=>{assert.equal(match.open,false);assert.deepEqual(match.counts,[1,1,0,0,0]);assert.deepEqual(match.records,['BLUR FOLLOWUP']);preserved(match);});
 if(match.open)await tap(queryInput);else await open('pointer');await type('pointer','UNSUBMITTED');await tap('[data-action="clear-activity-search"]');const explicit=await read('explicit clear committed query');
 await check('explicit clear actually removes committed query',async()=>{all(explicit);preserved(explicit);assert.equal(explicit.focused,true);assert.deepEqual(await snapshot(),expectedDatabase);assert.equal(cdp.uiSaves.length,0);});
 assert.deepEqual(cdp.exceptions,[]);checks.noUncaughtErrors=true;
 const report={result:failures.length?'fail':'pass',checks,failures,skipped,observations,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),probeSha256:crypto.createHash('sha256').update(fs.readFileSync(new URL(import.meta.url))).digest('hex'),uiSaveRequests:cdp.uiSaves.length,syntheticFixtureApiSaves:fixtureSaves,scope:'Existing submitted query and empty newer draft blur, actual CDP pointer/Tab/Enter/Backspace, 1756/1100/900 widths, pointer/keyboard/reduced; no native/GPU/full-pixel claim'};
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({result:report.result,checks:Object.keys(checks).length,failed:failures.length,skipped:skipped.length,uiSaveRequests:cdp.uiSaves.length}));if(failures.length)throw Error(failures.map(f=>f.name+': '+f.error).join('\n'));
}catch(error){fs.writeFileSync(path.join(evidence,'failure.json'),JSON.stringify({error:error.message,checks,failures,skipped,observations,uncaught:cdp?.exceptions},null,2));if(cdp)await frame('failure').catch(()=>{});throw error;}
finally{if(cdp)await cdp.call('Page.navigate',{url:'about:blank'}).catch(()=>{});cdp?.close();for(const child of [...children].reverse())await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});fs.writeFileSync(path.join(evidence,'cleanup.json'),JSON.stringify({temporaryRemoved:!fs.existsSync(temporary),children:children.map(child=>({pid:child.pid,exitCode:child.exitCode,signalCode:child.signalCode}))},null,2));assert.ok(children.every(child=>child.exitCode===0&&child.signalCode===null));}
