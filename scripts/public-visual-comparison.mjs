import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

// Read-only public geometry/motion comparison; synthetic isolated browser only.
const app=path.resolve(process.env.LAI_ACCEPTANCE_APP || 'dist/来财Lai.app');
const resources=path.join(app,'Contents/Resources');
const evidence=path.resolve(process.env.LAI_VISUAL_EVIDENCE || 'evidence/final-acceptance-2026-10-06/visual');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-public-visual-'));
const children=[];
let cdp, backend;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const freePort=()=>new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
async function until(check,label){for(let i=0;i<160;i++){if(await check())return;await pause(50);}throw Error('Timed out: '+label);}
async function stop(child){if(!child||child.exitCode!==null||child.signalCode!==null)return;child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),pause(6000)]);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await new Promise(resolve=>child.once('exit',resolve));}}
async function startBackend(){
  // Initialize exclusively from a synthetic fixture, before any bundled seed check.
  const database=path.join(temporary,'database');
  fs.mkdirSync(database,{recursive:true});
  fs.writeFileSync(path.join(database,'lai-data.json'),JSON.stringify({data:{customers:{},orders:[]}}));
  const port=await freePort(),token=crypto.randomBytes(32).toString('hex');
  const child=spawn(path.join(resources,'node-runtime'),[path.join(resources,'server.js')],{
    env:{...process.env,LAI_DATA_DIR:database,LAI_APP_PORT:String(port),LAI_API_TOKEN:token,LAI_INSTANCE_NONCE:'customer-detail-order-test',LAI_APP_NO_OPEN:'1'},stdio:'ignore'});
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







const sourceShadow=()=>JSON.parse(fs.readFileSync(path.join(evidence,'source-geometry.json'),'utf8')).drawer.boxShadow;
const readGeometry=`(()=>{const read=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return {rect:r.toJSON(),fontFamily:s.fontFamily,fontSize:s.fontSize,lineHeight:s.lineHeight,color:s.color,background:s.backgroundColor,border:s.border,borderRadius:s.borderRadius,padding:s.padding,boxShadow:s.boxShadow,transform:s.transform,transitionDuration:s.transitionDuration,transitionTimingFunction:s.transitionTimingFunction}};return {viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},header:read(document.querySelector('.topbar')),search:read(document.querySelector('.global-search')),subnav:read(document.querySelector('.subnav')),drawer:read(document.querySelector('.drawer')),drawerHeader:read(document.querySelector('.drawer-head')),drawerFooter:read(document.querySelector('.drawer-footer'))}})()`;
try {
 fs.mkdirSync(evidence,{recursive:true});backend=await startBackend();const fixture=await snapshot();fixture.data.customers={'Visual fixture':{contact:'Synthetic',country:'US',source:'Synthetic only'}};fixture.data.orders=[];
 const response=await fetch(backend.base+'/api/save',{method:'POST',headers:{'content-type':'application/json','x-trade-token':backend.token},body:JSON.stringify({state:fixture,baseRevision:fixture.revision})});assert.equal(response.status,200);const before=await snapshot();
 const port=await freePort();const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps','--user-data-dir='+path.join(temporary,'chrome'),'--remote-debugging-port='+port,'about:blank'],{stdio:'ignore'});children.push(browser);let target;
 await until(async()=>{try{target=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(t=>t.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'browser');cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Network.enable');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:1023,deviceScaleFactor:1,mobile:false});await navigate();
 await evaluate(`window.visualMotion=[];window.visualStart=performance.now();window.visualSampling=true;function sample(t){const e=document.querySelector('.drawer');if(e){const r=e.getBoundingClientRect();window.visualMotion.push({elapsed:t-window.visualStart,left:r.left,width:r.width,transform:getComputedStyle(e).transform});}if(window.visualSampling)requestAnimationFrame(sample)}requestAnimationFrame(sample);`);
 await pointerClick('[data-action="filter"]',false);await until(()=>evaluate('!!document.querySelector(".drawer")'),'filter drawer');await pause(450);await evaluate('window.visualSampling=false');const motion=await evaluate('window.visualMotion');assert.ok(motion.length>5);fs.writeFileSync(path.join(evidence,'local-drawer-motion.json'),JSON.stringify({method:'rAF DOM samples in isolated headless Chrome; --disable-gpu, not native/GPU frames',samples:motion},null,2));
 const local=await evaluate(readGeometry);fs.writeFileSync(path.join(evidence,'local-geometry.json'),JSON.stringify(local,null,2));assert.equal(local.viewport.width,1756);assert.equal(local.viewport.height,1023);
 if(process.env.LAI_ASSERT_FILTER_REFERENCE==='1'){
  assert.equal(local.drawer.boxShadow,sourceShadow(),'filter drawer must use captured three-layer shadow');
  const arrow=await evaluate(`(()=>{const b=document.querySelector('.filter-assistant button'),a=b.querySelector('.filter-assistant-arrow'),s=b.querySelector('.filter-assistant-label');if(!a||!s)return null;return {gap:b.getBoundingClientRect().right-a.getBoundingClientRect().right,label:s.textContent,arrow:a.textContent}})()`);assert.ok(arrow,'separate label and arrow must exist');assert.ok(Math.abs(arrow.gap)<1,'arrow must align with button trailing edge');
 }
 const shot=await cdp.call('Page.captureScreenshot',{format:'png',clip:{x:local.drawer.rect.x,y:0,width:600,height:180,scale:1}});fs.writeFileSync(path.join(evidence,'lai-filter-public-header.png'),Buffer.from(shot.data,'base64'));
 await pointerClick('.drawer-head [data-action="close-modal"]');await until(()=>evaluate('!document.querySelector(".overlay")'),'drawer closed');assert.deepEqual((await snapshot()).data,before.data);assert.equal((await snapshot()).revision,before.revision);assert.equal(cdp.uiSaves.length,0);assert.deepEqual(cdp.exceptions,[]);
 const source=JSON.parse(fs.readFileSync(path.join(evidence,'source-geometry.json'),'utf8'));const comparison=Object.fromEntries(['header','search','subnav','drawer','drawerHeader','drawerFooter'].map(k=>[k,{source:source[k].rect,local:local[k].rect,deltaWidth:local[k].rect.width-source[k].rect.width,deltaHeight:local[k].rect.height-source[k].rect.height}]));
 const report={version:(await evaluate('document.querySelector(".app-version").textContent')).trim().replace(/^v/,''),cssViewport:{width:1756,height:1023},sourcePageZoom:'0.75 inferred from CSS viewport/override ratio; screenshot API crop corrected separately',sameBusinessData:false,fullPagePixelAcceptance:false,continuousGPUAcceptance:false,syntheticApiWrites:1,uiWrites:0,unchangedDataAndRevision:true,exceptions:[],comparison};fs.writeFileSync(path.join(evidence,'comparison.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({result:'public geometry collected',uiWrites:0,localMotionSamples:motion.length}));
}finally{if(cdp)await cdp.call('Page.navigate',{url:'about:blank'}).catch(()=>{});cdp?.close();for(const child of [...children].reverse())await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});fs.writeFileSync(path.join(evidence,'cleanup.json'),JSON.stringify({temporaryRemoved:!fs.existsSync(temporary),children:children.map(child=>({pid:child.pid,exitCode:child.exitCode,signalCode:child.signalCode}))},null,2));}
