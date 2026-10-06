import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

// Assert readable existing order pagination across all 12 pages; no business rules change.
const app=path.resolve(process.env.LAI_ACCEPTANCE_APP || 'dist/来财Lai.app');
const resources=path.join(app,'Contents/Resources');
const evidence=path.resolve(process.env.LAI_ORDER_PAGINATION_EVIDENCE || 'evidence/order-pagination');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-list-combination-'));
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
    env:{...process.env,LAI_DATA_DIR:path.join(temporary,'database'),LAI_APP_PORT:String(port),LAI_API_TOKEN:token,LAI_INSTANCE_NONCE:'list-combination-test',LAI_APP_NO_OPEN:'1'},stdio:'ignore'});
  children.push(child);
  const base=`http://127.0.0.1:${port}`;
  await until(async()=>{if(child.exitCode!==null)throw Error('Isolated service exited');try{return (await fetch(base+'/api/health')).ok;}catch{return false;}},'isolated backend');
  return {child,base,token};
}
async function snapshot(){return (await fetch(backend.base+'/api/data',{headers:{'x-trade-token':backend.token}})).json();}
async function connect(url){
  const socket=new WebSocket(url);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let sequence=0;const pending=new Map();const paused=[];const completed=new Set();const exceptions=[];const uiSaves=[];let pageLoads=0;
  socket.addEventListener('message',event=>{const message=JSON.parse(String(event.data));if(message.method==='Page.loadEventFired'){pageLoads++;return;}if(message.method==='Network.requestWillBeSent'&&message.params.request.url===backend.base+'/api/save'){uiSaves.push({method:message.params.request.method});return;}if(message.method==='Fetch.requestPaused'){paused.push({requestId:message.params.requestId,networkId:message.params.networkId,method:message.params.request.method});return;}if(message.method==='Network.loadingFinished'||message.method==='Network.loadingFailed'){completed.add(message.params.requestId);return;}if(message.method==='Runtime.exceptionThrown'){exceptions.push({text:message.params.exceptionDetails.text,description:message.params.exceptionDetails.exception?.description?.split('\n')[0]});return;}const request=pending.get(message.id);if(!request)return;pending.delete(message.id);clearTimeout(request.timer);if(message.error)request.reject(Error(message.error.message));else request.resolve(message.result);});
  return {get pageLoads(){return pageLoads},paused,completed,exceptions,uiSaves,call(method,params={}){const id=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('Isolated browser command timed out: '+method))},5000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});},close(){socket.close();}};
}
async function evaluate(expression){const result=await cdp.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description?.split('\n')[0]||result.exceptionDetails.text);return result.result.value;}
async function navigate(){const loads=cdp.pageLoads;await cdp.call('Page.navigate',{url:backend.base+'/trade-order-system.html?token='+encodeURIComponent(backend.token)+'#customers'});await until(()=>cdp.pageLoads>loads,'new document loaded');await until(()=>evaluate(`!!document.querySelector('.company-link')`),'customer list');}
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
async function orderPage(expected,width,label){
 const geometry=await evaluate('(()=>{const e=document.querySelector(".order-workspace .pages>span"),r=document.createRange();r.selectNodeContents(e);return{text:e.textContent,rect:e.getBoundingClientRect().toJSON(),textRects:[...r.getClientRects()].map(x=>x.toJSON()),footer:e.closest("footer").getBoundingClientRect().toJSON(),total:e.closest("footer").querySelector(":scope>span").textContent,rows:[...document.querySelectorAll(".order-workspace .order-table tbody [data-biz-order]")].filter(e=>e.classList.contains("company-link")).map(e=>e.textContent),previousDisabled:document.querySelector(".order-workspace [data-biz-action=prev]").disabled,nextDisabled:document.querySelector(".order-workspace [data-biz-action=next]").disabled}})()');
 observations.push({width,label,...geometry});assert.equal(geometry.text,expected+' / 12');assert.equal(geometry.total,'共 221 笔订单');assert.equal(geometry.textRects.length,1,'Order page count is one readable line');assert.ok(geometry.rect.height<=22,'Order page count does not wrap vertically');for(const r of geometry.textRects)assert.ok(r.left>=geometry.rect.left-0.5&&r.right<=geometry.rect.right+0.5,'Whole order page text is not clipped');assert.ok(geometry.rect.left>=geometry.footer.left&&geometry.rect.right<=geometry.footer.right);assert.deepEqual(geometry.rows,Array.from({length:expected===12?1:20},(_,i)=>'REVIEW-'+((expected-1)*20+i)));assert.equal(geometry.previousDisabled,expected===1);assert.equal(geometry.nextDisabled,expected===12);return geometry;
}
try {
 fs.mkdirSync(evidence,{recursive:true});assert.equal(fs.existsSync(path.join(resources,'trade-order-data.json')),false);backend=await startBackend();const seed=await snapshot();assert.equal(seed.data.orders.length,0);assert.deepEqual(seed.data.customers,{});seed.data.customers={'Review Fixture':{country:'US',source:'Synthetic'}};seed.data.orders=Array.from({length:221},(_,i)=>({id:'review-'+i,num:'REVIEW-'+i,client:'Review Fixture',country:'US',currency:'USD',amount:10,paidAmount:0,stage:'production',createdAt:'2026-10-01',orderMonth:'2026-10',isDraft:false}));assert.equal((await fetch(backend.base+'/api/save',{method:'POST',headers:{'x-trade-token':backend.token,'Content-Type':'application/json'},body:JSON.stringify({state:seed,baseRevision:seed.revision})})).status,200);const baseline=await snapshot();
 const port=await freePort();const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps','--user-data-dir='+path.join(temporary,'chrome'),'--remote-debugging-port='+port,'about:blank'],{stdio:'ignore'});children.push(browser);let target;await until(async()=>{try{target=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(t=>t.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'private browser');cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Network.enable');
 for(const [width,height]of [[1756,1022],[1100,720]]){await cdp.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await navigate();await pointerClick('.rail [data-lai-route="order-list"]');await until(()=>evaluate('!!document.querySelector(".order-workspace .pages>span")'),'order footer');
 for(let page=1;page<=12;page++){if(page>1){await pointerClick('.order-workspace [data-biz-action="next"]');await until(()=>evaluate('document.querySelector(".order-workspace .pages>span").textContent==='+JSON.stringify(page+' / 12')),'next page');}await orderPage(page,width,'order page '+page);await assert.deepEqual(await snapshot(),baseline);assert.equal(cdp.uiSaves.length,0);checks['orderPage'+page+'Readable'+width]=true;if(page===1||page===12)await frame('order-page'+page+'-'+width);}
 await pointerClick('.order-workspace [data-biz-action="prev"]');await until(()=>evaluate('document.querySelector(".order-workspace .pages>span").textContent==="11 / 12"'),'previous from last');await orderPage(11,width,'previous from last');assert.deepEqual(await snapshot(),baseline);checks['previousFromLastPreservesRows'+width]=true;
 }
 assert.deepEqual(cdp.exceptions,[]);checks.noBrowserErrors=true;assert.equal(cdp.uiSaves.length,0);checks.noUiSaveRequests=true;fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({result:'pass',checks,observations,uiSaveRequests:0,syntheticFixtureApiSaves:1,htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),scope:'Seedless synthetic order pagination actual clicks at two browser widths; not native/full pixels/all order functions'},null,2));console.log('PASS: '+Object.keys(checks).length+' order pagination checks');
}catch(error){fs.writeFileSync(path.join(evidence,'failure.json'),JSON.stringify({error:error.message,checks,observations},null,2));if(cdp)await frame('failure').catch(()=>{});throw error;}
finally{if(cdp)await cdp.call('Page.navigate',{url:'about:blank'}).catch(()=>{});cdp?.close();for(const child of [...children].reverse())await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});fs.writeFileSync(path.join(evidence,'cleanup.json'),JSON.stringify({temporaryRemoved:!fs.existsSync(temporary),children:children.map(child=>({pid:child.pid,exitCode:child.exitCode,signalCode:child.signalCode}))},null,2));assert.ok(children.every(child=>child.exitCode===0));}
