import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

const app=path.resolve(process.env.LAI_ACCEPTANCE_APP || 'dist/来财Lai.app');
const resources=path.join(app,'Contents/Resources');
const evidence=path.resolve(process.env.LAI_SORT_CYCLE_EVIDENCE || 'evidence/ui-1.4.69/sort-cycle');
const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-sort-cycle-'));
const children=[];
const checks={};
let cdp,backend;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const freePort=()=>new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port));});});
async function until(check,label){for(let i=0;i<160;i++){if(await check())return;await pause(50);}throw Error('Timed out: '+label);}
async function stop(child){if(!child||child.exitCode!==null)return;child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),pause(1500)]);if(child.exitCode===null)child.kill('SIGKILL');}
async function connect(url){
  const socket=new WebSocket(url);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let sequence=0;const pending=new Map();
  socket.addEventListener('message',event=>{const message=JSON.parse(String(event.data));const request=pending.get(message.id);if(!request)return;pending.delete(message.id);clearTimeout(request.timer);if(message.error)request.reject(Error(message.error.message));else request.resolve(message.result);});
  return {call(method,params={}){const id=++sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(Error('Isolated browser command timed out: '+method))},5000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});},close(){socket.close();}};
}
async function evaluate(expression){const result=await cdp.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;}
async function pointerClick(selector){
  const point=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
  await cdp.call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
  await cdp.call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
}
async function state(){return evaluate(`(()=>{const button=document.querySelector('[data-sort-field="name"]');return{direction:button.closest('th').getAttribute('aria-sort'),pressed:button.getAttribute('aria-pressed'),names:[...document.querySelectorAll('.company-link')].map(e=>e.dataset.open)}})()`);}
async function countryState(){return evaluate(`(()=>{const button=document.querySelector('[data-sort-field="country"]');return{direction:button.closest('th').getAttribute('aria-sort'),names:[...document.querySelectorAll('.company-link')].map(e=>e.dataset.open)}})()`);}
async function wonDateState(){return evaluate(`(()=>{const button=document.querySelector('[data-sort-field="lastWonDate"]');return{direction:button.closest('th').getAttribute('aria-sort'),names:[...document.querySelectorAll('.company-link')].map(e=>e.dataset.open)}})()`);}
async function followupState(){return evaluate(`(()=>{const button=document.querySelector('[data-sort-field="lastFollowup"]');return{direction:button.closest('th').getAttribute('aria-sort'),names:[...document.querySelectorAll('.company-link')].map(e=>e.dataset.open)}})()`);}
async function columnState(field){return evaluate(`(()=>{const button=document.querySelector('[data-sort-field="${field}"]');return{direction:button.closest('th').getAttribute('aria-sort'),names:[...document.querySelectorAll('.company-link')].map(e=>e.dataset.open)}})()`);}
async function frame(name){await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);const result=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(evidence,name+'.png'),Buffer.from(result.data,'base64'));}

try{
  fs.mkdirSync(evidence,{recursive:true});
  const port=await freePort(),token=crypto.randomBytes(32).toString('hex');
  const child=spawn(path.join(resources,'node-runtime'),[path.join(resources,'server.js')],{env:{...process.env,LAI_DATA_DIR:path.join(temporary,'database'),LAI_APP_PORT:String(port),LAI_API_TOKEN:token,LAI_INSTANCE_NONCE:'sort-cycle-test',LAI_APP_NO_OPEN:'1'},stdio:'ignore'});children.push(child);
  const base=`http://127.0.0.1:${port}`;
  await until(async()=>{if(child.exitCode!==null)throw Error('Isolated service exited');try{return (await fetch(base+'/api/health')).ok;}catch{return false;}},'isolated backend');
  backend={base,token};
  const snapshot=async()=>{const response=await fetch(base+'/api/data',{headers:{'x-trade-token':token}});return response.json();};
  const initial=await snapshot();
  initial.data.customers={
    'Zulu Co':{country:'US',source:'Zulu',contact:'Zed',email:'zulu@example.test',createdAt:'2026-01-15',customerCode:'1',opportunityLastWonDate:'2026-09-20',lastFollowup:'2026-09-20',opportunityTotal:300,opportunityAverage:150,opportunityCount:10},
    'Alpha Co':{country:'',source:'Middle',contact:'Anne',email:'alpha@example.test',createdAt:'2026-09-15',customerCode:'10',opportunityCount:0},
    'Mike Co':{country:'DE',source:'Avenue',contact:'Mike',email:'mike@example.test',createdAt:'2026-04-15',customerCode:'2',opportunityLastWonDate:'2026-01-10',lastFollowup:'2026-01-10',opportunityTotal:100,opportunityAverage:100,opportunityCount:2},
  };
  initial.data.orders=[];initial.data.previewSegments=[];
  const saved=await fetch(base+'/api/save',{method:'POST',headers:{'x-trade-token':token,'Content-Type':'application/json'},body:JSON.stringify({state:initial,baseRevision:initial.revision})});assert.equal(saved.status,200);
  const baseline=await snapshot();
  const browserPort=await freePort();
  const browser=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--disable-default-apps',`--user-data-dir=${path.join(temporary,'chrome')}`,`--remote-debugging-port=${browserPort}`,'about:blank'],{stdio:'ignore'});children.push(browser);
  let target;await until(async()=>{try{target=(await(await fetch(`http://127.0.0.1:${browserPort}/json/list`)).json()).find(item=>item.type==='page');return !!target?.webSocketDebuggerUrl;}catch{return false;}},'browser');
  cdp=await connect(target.webSocketDebuggerUrl);await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Emulation.setDeviceMetricsOverride',{width:1756,height:1022,deviceScaleFactor:1,mobile:false});
  await cdp.call('Page.navigate',{url:base+'/trade-order-system.html?token='+encodeURIComponent(token)+'#customers'});
  await until(()=>evaluate(`document.querySelectorAll('.company-link').length===3`),'three test customers');
  const defaultSortControls=await evaluate(`(()=>{const labels=['公司名称','主要联系人','国家地区','客户标签','跟进人','最近赢单日期','最近跟进时间','最近动态','赢单商机金额(USD)','赢单商机均价(USD)','赢单商机数'];return Object.fromEntries(labels.map(label=>{const cell=[...document.querySelectorAll('.customer-table thead th')].find(th=>th.querySelector('.column-label')?.textContent.trim()===label);return [label,!!cell?.querySelector('[data-sort-field]')]}))})()`);
  assert.deepEqual(defaultSortControls,{'公司名称':true,'主要联系人':false,'国家地区':true,'客户标签':false,'跟进人':false,'最近赢单日期':true,'最近跟进时间':true,'最近动态':false,'赢单商机金额(USD)':true,'赢单商机均价(USD)':true,'赢单商机数':true});checks.defaultSortControlsMatchSource=true;
  const resting=await state();assert.equal(resting.direction,null);assert.equal(resting.pressed,'false');
  const title='[data-sort-field="name"] .column-label';
  await pointerClick(title);const ascending=await state();assert.equal(ascending.direction,'ascending');assert.deepEqual(ascending.names,['Alpha Co','Mike Co','Zulu Co']);await frame('name-ascending');checks.titleFirstClickAscending=true;
  await pointerClick(title);const descending=await state();assert.equal(descending.direction,'descending');assert.deepEqual(descending.names,['Zulu Co','Mike Co','Alpha Co']);await frame('name-descending');checks.titleSecondClickDescending=true;
  await pointerClick(title);const cleared=await state();assert.equal(cleared.direction,null,'Third title click restores default sort');assert.equal(cleared.pressed,'false');assert.deepEqual(cleared.names,resting.names);await frame('name-default-restored');checks.titleThirdClickRestoresDefault=true;
  await pointerClick('[data-sort-field="name"] .sort-down');assert.equal((await state()).direction,'descending');
  await pointerClick('[data-sort-field="name"] .sort-down');assert.deepEqual(await state(),resting);checks.sameArrowClearsSort=true;
  await pointerClick('[data-sort-field="name"] .sort-up');assert.equal((await state()).direction,'ascending');
  await pointerClick('[data-sort-field="name"] .sort-down');assert.equal((await state()).direction,'descending');checks.oppositeArrowSwitchesDirectly=true;
  const countryTitle='[data-sort-field="country"] .column-label';
  await pointerClick(countryTitle);const countryAscending=await countryState();assert.equal(countryAscending.direction,'ascending');assert.deepEqual(countryAscending.names,['Alpha Co','Mike Co','Zulu Co']);await frame('country-ascending-empty-first');checks.countryAscendingEmptyFirst=true;
  await pointerClick(countryTitle);const countryDescending=await countryState();assert.equal(countryDescending.direction,'descending');assert.deepEqual(countryDescending.names,['Zulu Co','Mike Co','Alpha Co']);await frame('country-descending-empty-last');checks.countryDescendingEmptyLast=true;
  await pointerClick(countryTitle);assert.deepEqual(await countryState(),{direction:null,names:resting.names});checks.countryThirdClickRestoresDefault=true;
  const wonDateTitle='[data-sort-field="lastWonDate"] .column-label';
  await pointerClick(wonDateTitle);const wonDateAscending=await wonDateState();assert.equal(wonDateAscending.direction,'ascending');assert.deepEqual(wonDateAscending.names,['Alpha Co','Mike Co','Zulu Co']);await frame('won-date-ascending-empty-first');checks.wonDateAscendingEmptyFirst=true;
  await pointerClick(wonDateTitle);const wonDateDescending=await wonDateState();assert.equal(wonDateDescending.direction,'descending');assert.deepEqual(wonDateDescending.names,['Zulu Co','Mike Co','Alpha Co']);await frame('won-date-descending-empty-last');checks.wonDateDescendingEmptyLast=true;
  await pointerClick(wonDateTitle);assert.deepEqual(await wonDateState(),{direction:null,names:resting.names});checks.wonDateThirdClickRestoresDefault=true;
  const followupTitle='[data-sort-field="lastFollowup"] .column-label';
  await pointerClick(followupTitle);const followupAscending=await followupState();assert.equal(followupAscending.direction,'ascending');assert.deepEqual(followupAscending.names,['Alpha Co','Mike Co','Zulu Co']);await frame('followup-ascending-empty-first');checks.followupAscendingEmptyFirst=true;
  await pointerClick(followupTitle);const followupDescending=await followupState();assert.equal(followupDescending.direction,'descending');assert.deepEqual(followupDescending.names,['Zulu Co','Mike Co','Alpha Co']);await frame('followup-descending-empty-last');checks.followupDescendingEmptyLast=true;
  await pointerClick(followupTitle);assert.deepEqual(await followupState(),{direction:null,names:resting.names});checks.followupThirdClickRestoresDefault=true;
  await evaluate(`document.querySelector('.table-wrap').scrollLeft=840`);
  await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
  for(const [field,label] of [['opportunityTotal','total'],['opportunityAverage','average']]){
    const amountTitle=`[data-sort-field="${field}"] .column-label`;
    await pointerClick(amountTitle);const asc=await columnState(field);assert.deepEqual(asc,{direction:'ascending',names:['Alpha Co','Mike Co','Zulu Co']});await frame(label+'-ascending-empty-first');checks[label+'AscendingEmptyFirst']=true;
    await pointerClick(amountTitle);const desc=await columnState(field);assert.deepEqual(desc,{direction:'descending',names:['Zulu Co','Mike Co','Alpha Co']});await frame(label+'-descending-empty-last');checks[label+'DescendingEmptyLast']=true;
    await pointerClick(amountTitle);assert.deepEqual(await columnState(field),{direction:null,names:resting.names});checks[label+'ThirdClickRestoresDefault']=true;
  }
  const countTitle='[data-sort-field="opportunityCount"] .column-label';
  await pointerClick(countTitle);
  assert.deepEqual(await columnState('opportunityCount'),{direction:'ascending',names:['Alpha Co','Mike Co','Zulu Co']});
  await frame('count-ascending-zero-first');
  checks.countAscendingStartsAtZero=true;
  await pointerClick(countTitle);
  assert.deepEqual(await columnState('opportunityCount'),{direction:'descending',names:['Zulu Co','Mike Co','Alpha Co']});
  await frame('count-descending-highest-first');
  checks.countDescendingStartsAtHighest=true;
  await pointerClick(countTitle);
  assert.deepEqual(await columnState('opportunityCount'),{direction:null,names:resting.names});
  checks.countThirdClickRestoresDefault=true;
  const sourceTitle='[data-sort-field="source"] .column-label';
  await evaluate(`document.querySelector(${JSON.stringify(sourceTitle)}).scrollIntoView({block:'nearest',inline:'center'})`);
  await pointerClick(sourceTitle);
  const sourceAscending=await columnState('source');
  assert.deepEqual(sourceAscending,{direction:'ascending',names:['Mike Co','Alpha Co','Zulu Co']});
  await frame('source-ascending');
  checks.sourceAscendingUsesSourceValue=true;
  await pointerClick(sourceTitle);
  const sourceDescending=await columnState('source');
  assert.deepEqual(sourceDescending,{direction:'descending',names:['Zulu Co','Alpha Co','Mike Co']});
  await frame('source-descending');
  checks.sourceDescendingUsesSourceValue=true;
  await pointerClick(sourceTitle);
  assert.deepEqual(await columnState('source'),{direction:null,names:resting.names});
  checks.sourceThirdClickRestoresDefault=true;
  for(const [field,expectedAscending] of [
    ['createdAt',['Zulu Co','Mike Co','Alpha Co']],
    ['customerCode',['Zulu Co','Mike Co','Alpha Co']],
  ]){
    const title=`[data-sort-field="${field}"] .column-label`;
    await evaluate(`document.querySelector(${JSON.stringify(title)}).scrollIntoView({block:'nearest',inline:'center'})`);
    await pointerClick(title);
    assert.deepEqual(await columnState(field),{direction:'ascending',names:expectedAscending});
    await frame(field+'-ascending');
    checks[field+'AscendingMatchesSource']=true;
    await pointerClick(title);
    assert.deepEqual(await columnState(field),{direction:'descending',names:[...expectedAscending].reverse()});
    await frame(field+'-descending');
    checks[field+'DescendingMatchesSource']=true;
    await pointerClick(title);
    assert.deepEqual(await columnState(field),{direction:null,names:resting.names});
    checks[field+'ThirdClickRestoresDefault']=true;
  }
  assert.deepEqual(await snapshot(),baseline);checks.sortingNeverWritesCustomerDatabase=true;
  const paginationFixture=await snapshot();
  for(let index=1;index<=22;index++)paginationFixture.data.customers['Pagination Probe '+String(index).padStart(2,'0')]={country:'US',lastFollowup:'2026-02-01'};
  const paginationSaved=await fetch(base+'/api/save',{method:'POST',headers:{'x-trade-token':token,'Content-Type':'application/json'},body:JSON.stringify({state:paginationFixture,baseRevision:paginationFixture.revision})});assert.equal(paginationSaved.status,200);
  const paginationBaseline=await snapshot();
  await cdp.call('Page.reload',{ignoreCache:true});
  await until(()=>evaluate(`document.querySelectorAll('.company-link').length===20`),'isolated pagination fixture');
  await pointerClick(followupTitle);
  assert.equal((await followupState()).direction,'ascending');
  await pointerClick('button[data-page="2"]');
  const secondPage=await evaluate(`({page:document.querySelector('.pagination [aria-current="page"]')?.textContent.trim(),rows:document.querySelectorAll('.company-link').length,sort:document.querySelector('[data-sort-field="lastFollowup"]')?.closest('th')?.getAttribute('aria-sort')})`);
  assert.deepEqual(secondPage,{page:'2',rows:5,sort:'ascending'});checks.paginationRetainsSort=true;
  await pointerClick(countryTitle);
  const changedColumn=await evaluate(`({page:document.querySelector('.pagination [aria-current="page"]')?.textContent.trim(),rows:document.querySelectorAll('.company-link').length,sort:document.querySelector('[data-sort-field="country"]')?.closest('th')?.getAttribute('aria-sort')})`);
  assert.deepEqual(changedColumn,{page:'1',rows:20,sort:'ascending'});checks.changingSortColumnReturnsToFirstPage=true;
  assert.deepEqual(await snapshot(),paginationBaseline);checks.paginationSortingNeverWritesCustomerDatabase=true;
  const htmlSha256=crypto.createHash('sha256').update(fs.readFileSync(path.join(resources,'trade-order-system.html'))).digest('hex');
  fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({testedAt:new Date().toISOString(),app,htmlSha256,result:'pass',checks,resting,ascending,descending,cleared,countryAscending,countryDescending,wonDateAscending,wonDateDescending,followupAscending,followupDescending,secondPage,changedColumn},null,2));
  console.log('PASS: '+Object.keys(checks).length+' customer sort-cycle checks');
}catch(error){console.error('Acceptance failure: '+error.message);throw error;}
finally{cdp?.close();for(const child of children)await stop(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
