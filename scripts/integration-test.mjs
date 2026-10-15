import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import net from 'node:net';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),app=process.env.LAI_ACCEPTANCE_APP||path.join(root,'dist/来财Lai.app'),builtResources=path.join(app,'Contents/Resources');
const temp=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-'));
const resources=path.join(temp,'resources');
const resourceFiles=['node-runtime','server.js','storage.js','storage-path.js','auth.js','errors.js','mail-account.js','mail-imap.js','mail-client.js','mail-smtp.js','mail-mime.js','mail-service.js','mail-libs.js','opportunity-files.js','trade-order-system.html'];
const reportFile=process.env.LAI_INTEGRATION_EVIDENCE||path.join(root,'evidence/integration-report.json');let report;
const oldRoot=path.join(os.homedir(),'Library/Application Support/TradeOrderSystem');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const children=[];
const freePort=()=>new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const p=server.address().port;server.close(()=>resolve(p));});});
async function start(dir){const port=await freePort(),token=crypto.randomBytes(32).toString('hex');const child=spawn(path.join(resources,'node-runtime'),[path.join(resources,'server.js')],{env:{...process.env,LAI_DATA_DIR:dir,LAI_APP_PORT:String(port),LAI_API_TOKEN:token,LAI_INSTANCE_NONCE:'lai-test-instance',LAI_APP_NO_OPEN:'1',TRADE_APP_DATA_DIR:oldRoot},stdio:['ignore','ignore','pipe']});children.push(child);let stderr='';child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-8192);});const base='http://127.0.0.1:'+port;for(let i=0;i<100;i++){if(child.exitCode!==null)return {child,exited:true,stderr};try{if((await fetch(base+'/api/health')).ok)return {child,base,token};}catch{}await new Promise(r=>setTimeout(r,35));}throw Error('Lai backend did not start');}
async function stop(child){if(child.exitCode!==null)return;await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');});}
const request=(s,route,options={})=>fetch(s.base+route,{...options,headers:{'x-trade-token':s.token,...options.headers}});
const read=async s=>(await request(s,'/api/data')).json();
const save=async(s,payload,importLog)=>{const response=await request(s,'/api/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:payload,baseRevision:payload.revision,...(importLog?{importLog}:{})})});assert.equal(response.status,200);return response.json();};
try{
 fs.mkdirSync(resources);
 for(const file of resourceFiles)fs.copyFileSync(path.join(builtResources,file),path.join(resources,file));
 fs.cpSync(path.join(builtResources,'vendor'),path.join(resources,'vendor'),{recursive:true});
 assert.equal(fs.existsSync(path.join(resources,'trade-order-data.json')),false,'Test resources must not contain an application seed');
 for(const forbidden of [oldRoot,path.join(os.homedir(),'Library/Application Support/TradeOrderSystem-OKKIPreview')]){
  const refused=await start(forbidden);assert.equal(refused.exited,true);
  assert.doesNotMatch(refused.stderr,/LAI_TEST_DATA_BLOCK/,'Production path rejection must precede the test guard');
 }
 const dir=path.join(temp,'database');let s=await start(dir);assert.equal(s.exited,undefined);
 assert.equal((await fetch(s.base+'/api/data')).status,401);
 assert.equal((await request(s,'/api/data',{headers:{Origin:'https://untrusted.invalid'}})).status,403);
 assert.equal((await request(s,'/orders.html')).status,404,'Removed legacy page must be unavailable');
 assert.equal(fs.existsSync(path.join(resources,'orders.html')),false,'Legacy page must not ship');
 const boot=await fetch(s.base+'/trade-order-system.html?token='+encodeURIComponent(s.token),{redirect:'manual'});assert.equal(boot.status,303);assert.match(boot.headers.get('set-cookie'),/^lai_session=/);
 const unifiedDocument=await request(s,'/trade-order-system.html');assert.equal(unifiedDocument.status,200);const unifiedHtml=await unifiedDocument.text();assert.match(unifiedHtml,/来财/);assert.match(unifiedHtml,/LaiBusinessModel/);assert.match(unifiedHtml,/LaiBusinessUI/);
 assert.match(unifiedHtml,/\/vendor\/xlsx\.full\.min\.js/);assert.equal((await fetch(s.base+'/vendor/xlsx.full.min.js')).status,401);assert.equal((await request(s,'/vendor/xlsx.full.min.js')).status,200);
 assert.equal((await request(s,'/package.json')).status,404);
 const health=await (await request(s,'/api/health')).json();assert.equal(health.dataFile,path.join(dir,'lai-data.sqlite'));
 let payload=await read(s);const initialCount=Object.keys(payload.data.customers).length,ordersCount=payload.data.orders.length;
 assert.equal(initialCount,0,'Integration must start with no customers');assert.equal(ordersCount,0,'Integration must start with no orders');
 payload.data.customers['LAI TEST CUSTOMER']={client:'LAI TEST CUSTOMER',owner:'Kris',laiBucket:'pool',laiPreviousOwner:'Kris',history:[]};payload.data.previewSegments=[{id:'segment-test',name:'Test',kind:'manual',members:['LAI TEST CUSTOMER'],rules:[],match:'all',archived:false}];payload.data.previewTable={order:['name','email'],frozen:['name'],compact:false};
 await save(s,payload);
 const importId=crypto.randomUUID(), issues=Array.from({length:1001},(_,index)=>({row:index+2,name:`Imported ${index}`,reason:'同名客户已存在'}));
 payload=await read(s);payload.data.laiImportHistory=[{id:importId,time:'2026-09-24T00:00:00Z',fileName:'sample.csv',destination:'active',expected:1001,result:{created:0,updated:0,skipped:1001}}];
 await save(s,payload,{id:importId,issues});
 assert.equal((await request(s,'/api/import-log?id='+encodeURIComponent(importId))).status,200);
 assert.equal((await(await request(s,'/api/import-log?id='+encodeURIComponent(importId))).json()).issues.length,1001);
 assert.equal((await request(s,'/api/import-log?id='+crypto.randomUUID())).status,404);
 assert.equal((await fetch(s.base+'/api/import-log?id='+encodeURIComponent(importId))).status,401);
 const beforeInvalid=await read(s),invalidId=crypto.randomUUID();const invalidState=structuredClone(beforeInvalid);
 invalidState.data.laiImportHistory.unshift({id:invalidId,time:'2026-09-24T00:00:01Z',fileName:'invalid.csv',destination:'active',expected:2,result:{created:0,updated:0,skipped:2}});
 const invalidResponse=await request(s,'/api/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:invalidState,baseRevision:beforeInvalid.revision,importLog:{id:invalidId,issues:[{row:2,name:'Only one',reason:'同名客户已存在'}]}})});
 assert.equal(invalidResponse.status,400);assert.equal((await read(s)).revision,beforeInvalid.revision);assert.equal((await request(s,'/api/import-log?id='+invalidId)).status,404);
 assert.equal((await request(s,'/api/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:payload,baseRevision:payload.revision})})).status,409);
 // An order module save must keep customer settings and lifecycle fields.
 payload=await read(s);payload.data.orders.push({id:'lai-order-test',num:'LAI-TEST-001',client:'LAI TEST CUSTOMER',amount:12,currency:'USD',stage:'quote',createdAt:'2026-09-22'});await save(s,payload);
 const peer=await start(dir);let peerPayload=await read(peer);peerPayload.data.customers['LAI TEST CUSTOMER'].note='Cross-module save';const peerSaved=await save(peer,peerPayload);payload=await read(s);assert.equal(payload.revision,peerSaved.revision);assert.equal(payload.data.customers['LAI TEST CUSTOMER'].note,'Cross-module save');await stop(peer.child);
 for(const route of ['/api/order-notification','/api/ai-settings','/api/ai-chat','/api/track','/api/tracking-settings','/api/ecb-rates','/api/exchange-rate','/api/attachments','/api/open-url','/api/api-status'])for(const method of ['GET','POST'])assert.equal((await request(s,route,{method})).status,404,'Removed external route must remain unavailable');
 assert.equal((await request(s,'/api/manual-backup',{method:'POST'})).status,200);
 await stop(s.child);s=await start(dir);payload=await read(s);assert.equal(Object.keys(payload.data.customers).length,initialCount+1);assert.equal(payload.data.orders.length,ordersCount+1);assert.equal(payload.data.customers['LAI TEST CUSTOMER'].laiBucket,'pool');assert.equal(payload.data.customers['LAI TEST CUSTOMER'].laiPreviousOwner,'Kris');assert.equal(payload.data.previewSegments[0].members[0],'LAI TEST CUSTOMER');assert.deepEqual(payload.data.previewTable.order,['name','email']);assert.equal(payload.data.previewTable.compact,false);assert.equal((await(await request(s,'/api/import-log?id='+encodeURIComponent(importId))).json()).issues.length,1001);await stop(s.child);
 assert.equal(spawnSync('/usr/bin/codesign',['--verify','--deep','--strict',app]).status,0);
 report={testedAt:new Date().toISOString(),result:'pass',native:{sha256:hash(path.join(app,'Contents/MacOS/Lai')),signatureVerified:true,launched:false},resources:{files:resourceFiles,vendor:true,seedCopied:false,sha256:Object.fromEntries([...resourceFiles,'vendor/xlsx.full.min.js'].map(file=>[file,hash(path.join(resources,file))]))},initialCount,ordersCount,checks:['Lai native executable hash and valid signature without launching native app','seedless synthetic database and cookie','original and preview paths rejected before test guard','authenticated unified document and legacy document removed','cross-origin rejection','customer and order saves with extra state preserved','stale revision rejection and coherent concurrent read','restart persistence','manual backup','external integration routes removed']};
}finally{for(const child of children)await stop(child);fs.rmSync(temp,{recursive:true,force:true});assert.equal(fs.existsSync(temp),false);if(report){report.cleanup={temporaryTreeRemoved:true,allChildrenExited:children.every(child=>child.exitCode!==null||child.signalCode!==null)};assert.equal(report.cleanup.allChildrenExited,true);fs.writeFileSync(reportFile,JSON.stringify(report,null,2));}}
console.log('PASS: synthetic SQLite save/backup/restart, authentication, path isolation and cleanup; native signature inspected without launching');
