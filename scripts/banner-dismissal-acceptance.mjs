import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

const app=path.resolve(process.env.LAI_ACCEPTANCE_APP || 'dist/来财Lai.app');
const resources=path.join(app,'Contents/Resources');
const evidence=path.resolve(process.env.LAI_BANNER_EVIDENCE || 'evidence/ui-1.4.53/banner-dismissal');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-banner-'));
const children=[];
let backend,cdp;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const freePort=()=>new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
async function until(check,label){for(let i=0;i<160;i++){if(await check())return;await pause(50);}throw Error('Timed out: '+label);}
async function stop(child){if(!child||child.exitCode!==null)return;child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),pause(1500)]);if(child.exitCode===null)child.kill('SIGKILL');}
async function startBackend(){
  const port=await freePort(),token=crypto.randomBytes(32).toString('hex');
  const child=spawn(path.join(resources,'node-runtime'),[path.join(resources,'server.js')],{
    env:{...process.env,LAI_DATA_DIR:path.join(temporary,'database'),LAI_APP_PORT:String(port),LAI_API_TOKEN:token,LAI_INSTANCE_NONCE:'banner-test',LAI_APP_NO_OPEN:'1'},stdio:'ignore'});
  children.push(child);
  const base=`http://127.0.0.1:${port}`;
  await until(async()=>{if(child.exitCode!==null)throw Error('Isolated service exited');try{return (await fetch(base+'/api/health')).ok;}catch{return false;}},'isolated backend');
  return {child,base,token};
}
async function snapshot(){return (await fetch(backend.base+'/api/data',{headers:{'x-trade-token':backend.token}})).json();}
async function connect(url){
  const socket=new WebSocket(url);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let sequence=0;const pending=new Map();
  socket.addEventListener('message',event=>{const message=JSON.parse(String(event.data));const request=pending.get(message.id);if(!request)return;pending.delete(message.id);if(message.error)request.reject(Error(message.error.message));else request.resolve(message.result);});
  return {call(method,params={}){const id=++sequence;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});},close(){socket.close();}};
}
async function evaluate(expression){const result=await cdp.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;}
async function navigate(){await cdp.call('Page.navigate',{url:backend.base+'/trade-order-system.html?token='+encodeURIComponent(backend.token)+'#customers'});await until(()=>evaluate(`!!document.querySelector('.replica-panel')`),'customer list');}

try{
  fs.mkdirSync(evidence,{recursive:true});
  backend=await startBackend();
  const before=await snapshot();
  const port=await freePort();
  const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps',`--user-data-dir=${path.join(temporary,'chrome')}`,`--remote-debugging-port=${port}`,'about:blank'],{stdio:'ignore'});children.push(browser);
  let target;await until(async()=>{try{target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(item=>item.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'headless browser');
  cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');
  const width=Number(process.env.LAI_BANNER_WIDTH || 1756);
  const height=Number(process.env.LAI_BANNER_HEIGHT || 1022);
  assert(Number.isInteger(width) && width>=640 && Number.isInteger(height) && height>=600);
  await cdp.call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  await navigate();
  assert.equal(await evaluate(`!!document.querySelector('.replica-banner')`),true,'fresh customer list shows banner');
  await evaluate(`document.querySelector('[data-action="close-banner"]').click()`);
  await until(()=>evaluate(`!document.querySelector('.replica-banner')`),'banner closes');
  await until(async()=>(await snapshot()).data.previewBannerClosed===true,'dismissal saved');
  const after=await snapshot(),other={...after.data};delete other.previewBannerClosed;
  assert.deepEqual(other,before.data,'dismissing banner cannot change customers, orders or other settings');
  await cdp.call('Page.reload');await until(()=>evaluate(`!!document.querySelector('.replica-panel')`),'reloaded customer list');
  assert.equal(await evaluate(`!!document.querySelector('.replica-banner')`),false,'reload keeps banner dismissed');
  assert.equal(await evaluate(`document.querySelector('.replica-panel').classList.contains('without-banner')`),true);
  await stop(backend.child);backend=await startBackend();await navigate();
  assert.equal(await evaluate(`!!document.querySelector('.replica-banner')`),false,'backend restart keeps banner dismissed');
  assert.deepEqual((await snapshot()).data,after.data);
  const screenshot=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(evidence,'banner-dismissed-after-restart.png'),Buffer.from(screenshot.data,'base64'));
  fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({testedAt:new Date().toISOString(),result:'pass',viewport:{width,height,deviceScaleFactor:1},htmlSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex'),checks:{freshVisible:true,dismissalSaved:true,otherDataUnchanged:true,reloadHidden:true,restartHidden:true},scope:'Disposable SQLite and headless browser; no formal customer or order writes'},null,2));
  console.log('PASS: banner dismissal survives reload and backend restart without changing other data');
}finally{cdp?.close();for(const child of children.reverse())await stop(child);fs.rmSync(temporary,{recursive:true,force:true});}
