import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

// Read-only detail column/journey diagnosis against captured source dimensions, in a seedless synthetic service.
const app=path.resolve(process.env.LAI_ACCEPTANCE_APP || 'dist/来财Lai.app');
const resources=path.join(app,'Contents/Resources');
const evidence=path.resolve(process.env.LAI_JOURNEY_BEHAVIOR_EVIDENCE || 'evidence/activity-navigation-implementation-2026-10-04/layout');
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
const ids=['all','followup','email','chat','other'];
const text={followup:'CAT FIXTURE FOLLOWUP',email:'CAT FIXTURE EMAIL',chat:'CAT FIXTURE CHAT',other:'CAT FIXTURE OTHER'};
async function check(name,fn){try{await fn();checks[name]=true;}catch(error){if(error.code!=='ERR_ASSERTION')throw error;checks[name]=false;failures.push({name,error:error.message});}}
async function stateFor(id,label){const value=await evaluate(`(()=>{const e=document.querySelector('[data-activity-filter="${id}"]'),nav=e.closest('.lcd-activity-filters'),body=e.closest('.lcd-body'),r=e.getBoundingClientRect(),b=body.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);return{width:innerWidth,id:${JSON.stringify(id)},selected:nav.querySelector('[aria-pressed="true"]')?.dataset.activityFilter,selectedCount:nav.querySelectorAll('[aria-pressed="true"]').length,focused:document.activeElement===e,focusTag:document.activeElement?.tagName,rect:r.toJSON(),body:b.toJSON(),visible:r.x>=b.x&&r.right<=b.right&&r.y>=56&&r.bottom<=innerHeight,hit:!!(hit&&(e.contains(hit)||hit.contains(e))),draft:document.querySelector('#followup-text').value,date:document.querySelector('#followup-form [name=nextFollow]').value,resultText:document.querySelector('#activity-results').textContent,labels:[...nav.querySelectorAll('[data-activity-filter]')].map(e=>e.textContent),prevArrow:!!nav.querySelector('button[aria-label="向左查看动态类别"]'),nextArrow:!!nav.querySelector('button[aria-label="向右查看动态类别"]')}})()`);observations.push({label,...value});return value;}
function assertResults(s,id){assert.equal(s.selected,id);assert.equal(s.selectedCount,1);assert.equal(s.draft,'A unsent draft');assert.equal(s.date,'2040-06-15');for(const key of Object.keys(text))assert.equal(s.resultText.includes(text[key]),id==='all'||id===key,'Correct visible fixture history '+key);assert.ok(!s.resultText.includes('OTHER CUSTOMER HISTORY'));assert.deepEqual(s.labels.map(s=>s.match(/\((\d+)\)/)?.[1]),['4','1','1','1','1']);}
async function pointerChoose(id){for(let i=0;i<5;i++){const s=await stateFor(id,'pointer reach attempt '+id);if(s.visible&&s.hit){await tap('[data-activity-filter="'+id+'"]');await settle();return;}const direction=s.rect.right>s.body.right?'右':'左';const selector='button[aria-label="向'+direction+'查看动态类别"]';assert.equal(await evaluate('!!document.querySelector('+JSON.stringify(selector)+')'),true,'Clipped category has an actual '+direction+' arrow');await tap(selector);}assert.fail('Category not reachable after scrolling');}
try{
 fs.mkdirSync(evidence,{recursive:true});assert.equal(fs.existsSync(path.join(resources,'trade-order-data.json')),false);backend=await startBackend();const start=await snapshot();assert.deepEqual(start.data.customers,{});assert.equal(start.data.orders.length,0);await changeFixture(data=>{data.customers={'Refresh A':{country:'US',source:'Synthetic',contacts:['Fixture Person'],nextFollow:'2040-06-15',history:Object.entries(text).map(([type,value],i)=>({type:type==='other'?'note':type,time:'2026-01-0'+(i+1)+'T12:00:00Z',text:value,owner:'Synthetic'}))},'Untouched B':{country:'FR',source:'Synthetic',history:[{type:'followup',text:'OTHER CUSTOMER HISTORY',time:'2026-01-01T12:00:00Z'}]}};data.orders=[];});
 const port=await freePort(),browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps','--user-data-dir='+path.join(temporary,'chrome'),'--remote-debugging-port='+port,'about:blank'],{stdio:'ignore'});children.push(browser);let target;await until(async()=>{try{target=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(t=>t.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'private browser');cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Network.enable');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:1022,deviceScaleFactor:2,mobile:false});await initial();
 async function readLayout(label){const layout=await evaluate(`(()=>{const desc=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return{rect:r.toJSON(),minWidth:s.minWidth,overflowX:s.overflowX,scrollLeft:e.scrollLeft,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,padding:[s.paddingLeft,s.paddingRight]}};const root=document.querySelector('.lcd-root'),main=document.querySelector('.customer-main'),body=document.querySelector('.lcd-body'),journey=document.querySelector('.lcd-journey'),group=journey.querySelector('.lcd-button-group');return{width:innerWidth,root:desc(root),main:desc(main),columns:desc(document.querySelector('.lcd-columns')),left:desc(document.querySelector('.lcd-left')),right:desc(document.querySelector('.lcd-right')),body:desc(body),journey:desc(journey),group:desc(group),document:desc(document.documentElement),draft:document.querySelector('#followup-text').value,date:document.querySelector('#followup-form [name=nextFollow]').value}})()`);observations.push({label,...layout});return layout;}
 async function horizontal(deltaX){const point=await evaluate(`(()=>{const r=document.querySelector('.customer-main').getBoundingClientRect();return{x:Math.min(innerWidth-20,r.x+r.width/2),y:r.top+Math.min(360,r.height/2)}})()`);await cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await cdp.call('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX,deltaY:0});await pause(120);}
 async function inspect(label){const layout=await readLayout(label),available=layout.columns.rect.width,expectedLeft=Math.min(480,Math.max(380,available*.3275)),expectedRight=Math.max(400,available-expectedLeft-16);
 await check(label+' left source constraint',()=>assert.ok(Math.abs(layout.left.rect.width-expectedLeft)<.1));
 await check(label+' right source constraint',()=>assert.ok(Math.abs(layout.right.rect.width-expectedRight)<.1));
 await check(label+' journey group fits',()=>assert.ok(layout.group.rect.width<=layout.journey.rect.width+.1));
 await check(label+' draft/date preserved',()=>{assert.equal(layout.draft,'A unsent draft');assert.equal(layout.date,'2040-06-15');});
 if(layout.main.scrollWidth>layout.main.clientWidth+1){await horizontal(1600);const right=await readLayout(label+' horizontal right');await check(label+' real horizontal input reaches right',()=>{assert.equal(right.main.overflowX,'auto');assert.ok(right.main.scrollLeft>0);assert.ok(right.main.scrollLeft+right.main.clientWidth>=right.main.scrollWidth-1);assert.ok(right.right.rect.right<=right.main.rect.right);});await horizontal(-1600);const left=await readLayout(label+' horizontal left');await check(label+' real horizontal input returns left',()=>assert.equal(left.main.scrollLeft,0));}
 await unchanged();await frame('layout-'+label.replaceAll(' ','-'));}
 for(const width of [1756,1100,900]){await cdp.call('Emulation.setDeviceMetricsOverride',{width,height:1022,deviceScaleFactor:2,mobile:false});await settle();await inspect('main '+width);}
 await tap('[data-action="collapse-subnav"]');await settle();await inspect('collapsed 900');await tap('[data-action="expand-subnav"]');await settle();await inspect('expanded 900');
 await enter('[data-action="cancel-followup"]');await until(()=>evaluate('document.querySelector("#followup-text").value===""'),'cancel existing draft before route navigation');
 await tap('.lcd-return[data-action="list"]');await until(()=>evaluate('!!document.querySelector(".company-link")'),'return list');
 await check('list scope restored',async()=>{const v=await evaluate(`(()=>{const e=document.querySelector('.customer-main');return{detail:!!document.querySelector('.lcd-root'),overflow:getComputedStyle(e).overflowX,scroll:e.scrollLeft,bodyMin:getComputedStyle(document.body).minWidth}})()`);assert.equal(v.detail,false);assert.equal(v.overflow,'hidden');assert.equal(v.scroll,0);assert.notEqual(v.bodyMin,'1024px');});
 await tap('[data-lai-route="order-list"]');await until(()=>evaluate('!document.querySelector(".lcd-root")&&!document.querySelector(".customer-main")'),'orders route');await check('order scope unchanged',async()=>{const v=await evaluate(`(()=>{const e=document.querySelector('main.main');return{overflow:getComputedStyle(e).overflowX,scroll:e.scrollLeft,bodyMin:getComputedStyle(document.body).minWidth}})()`);assert.equal(v.overflow,'hidden');assert.equal(v.scroll,0);assert.notEqual(v.bodyMin,'1024px');});
 await cdp.call('Page.navigate',{url:backend.base+'/trade-order-system.html?token='+encodeURIComponent(backend.token)+'&customer=Refresh%20A#customers'});await until(()=>evaluate('!!document.querySelector(".lcd-root")'),'direct detail entry');await tap('.lcd-tabs [data-tab="activity"]');await input('#followup-text','A unsent draft');await inspect('direct entry 900');

 assert.equal(cdp.uiSaves.length,0);assert.deepEqual(cdp.exceptions,[]);checks.noUiSaveOrDatabaseMutation=true;
 if(failures.length)throw Error(failures.map(f=>f.name+': '+f.error).join('\n'));fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({result:'pass',checks,observations,syntheticFixtureApiSaves:fixtureSaves,uiSaveRequests:cdp.uiSaves.length,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex')},null,2));console.log('PASS journey behavior '+Object.keys(checks).length);
}catch(error){fs.writeFileSync(path.join(evidence,'failure.json'),JSON.stringify({error:error.message,failures,checks,observations,syntheticFixtureApiSaves:fixtureSaves,uiSaveRequests:cdp?.uiSaves.length,uncaught:cdp?.exceptions,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex')},null,2));if(cdp)await frame('failure').catch(()=>{});throw error;}
finally{if(cdp)await cdp.call('Page.navigate',{url:'about:blank'}).catch(()=>{});cdp?.close();for(const child of [...children].reverse())await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});fs.writeFileSync(path.join(evidence,'cleanup.json'),JSON.stringify({temporaryRemoved:!fs.existsSync(temporary),children:children.map(child=>({pid:child.pid,exitCode:child.exitCode,signalCode:child.signalCode}))},null,2));assert.ok(children.every(child=>child.exitCode===0));}
