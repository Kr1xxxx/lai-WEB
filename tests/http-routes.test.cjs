const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const net=require('node:net');const crypto=require('node:crypto');const {spawn}=require('node:child_process');
test('unified HTTP routes reject legacy surfaces and malformed requests while retaining authenticated saves',async()=>{
 const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-http-'));const resources=path.join(temporary,'resources');fs.mkdirSync(resources);for(const file of ['server.js','storage.js','storage-path.js','auth.js','errors.js','mail-account.js','mail-imap.js','mail-client.js','mail-smtp.js','mail-mime.js','mail-service.js','mail-libs.js','opportunity-files.js'])fs.copyFileSync(path.join(__dirname,'../backend',file),path.join(resources,file));
 fs.writeFileSync(path.join(resources,'trade-order-system.html'),'<!doctype html><title>Lai HTTP fixture</title>');fs.writeFileSync(path.join(resources,'trade-order-data.json'),JSON.stringify({app:'lai',data:{orders:[],customers:{Legacy:{name:'Legacy',custom:{preserve:true}}},extraState:{keep:true}}}));
 const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});const token=crypto.randomBytes(32).toString('hex');const child=spawn(process.execPath,[path.join(resources,'server.js')],{env:{...process.env,LAI_DATA_DIR:path.join(temporary,'data'),LAI_APP_PORT:String(port),LAI_API_TOKEN:token,LAI_APP_NO_OPEN:'1'},stdio:['ignore','ignore','ignore']});const base=`http://127.0.0.1:${port}`;const request=(route,options={})=>fetch(base+route,{...options,headers:{Authorization:`Bearer ${token}`,...options.headers}});
 try{
  let ready=false;for(let i=0;i<500;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,20));}assert.equal(ready,true);
  assert.equal((await request('/orders.html')).status,404);assert.equal((await request('/server.js')).status,404);assert.equal((await request('/api/ai-chat',{method:'POST'})).status,404);
  assert.equal((await fetch(base+'/api/data')).status,401);assert.equal((await request('/api/open-data-folder',{method:'POST'})).status,404);assert.equal((await request('/api/data',{headers:{Origin:'https://untrusted.example'}})).status,403);const badHostStatus=await new Promise((resolve,reject)=>{const req=require('node:http').get(base+'/api/data',{headers:{Host:`untrusted.example:${port}`,Authorization:`Bearer ${token}`}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);});assert.equal(badHostStatus,421);
  assert.equal((await request('/api/save',{method:'POST',body:'{}'})).status,415);assert.equal((await request('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'})).status,400);
  const data=await (await request('/api/data')).json();assert.equal(data.data.customers.Legacy.custom.preserve,true);const saved=await request('/api/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:data,baseRevision:data.revision})});assert.equal(saved.status,200);assert.equal((await saved.json()).revision,data.revision+1);assert.deepEqual((await (await request('/api/data')).json()).data.extraState,{keep:true});
 }finally{if(child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');});fs.rmSync(temporary,{recursive:true,force:true});}
});

test('backup status route, queued backups after saves, incomplete full saves and manual backups over HTTP',async()=>{
 const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-http-backup-'));const resources=path.join(temporary,'resources');fs.mkdirSync(resources);for(const file of ['server.js','storage.js','storage-path.js','auth.js','errors.js','mail-account.js','mail-imap.js','mail-client.js','mail-smtp.js','mail-mime.js','mail-service.js','mail-libs.js','opportunity-files.js'])fs.copyFileSync(path.join(__dirname,'../backend',file),path.join(resources,file));
 fs.writeFileSync(path.join(resources,'trade-order-system.html'),'<!doctype html><title>Lai HTTP fixture</title>');
 const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});const token=crypto.randomBytes(32).toString('hex');const dataDir=path.join(temporary,'data');const child=spawn(process.execPath,[path.join(resources,'server.js')],{env:{...process.env,LAI_DATA_DIR:dataDir,LAI_APP_PORT:String(port),LAI_API_TOKEN:token,LAI_APP_NO_OPEN:'1'},stdio:['ignore','ignore','ignore']});const base=`http://127.0.0.1:${port}`;const request=(route,options={})=>fetch(base+route,{...options,headers:{Authorization:`Bearer ${token}`,...options.headers}});const post=(route,body)=>request(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  let ready=false;for(let i=0;i<500;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,20));}assert.equal(ready,true);
  assert.equal((await fetch(base+'/api/backup-status')).status,401);
  const first=await (await request('/api/backup-status')).json();assert.equal(first.ok,true);assert.equal(first.backup.ok,true);assert.equal(first.backup.pending,false);
  const data=await (await request('/api/data')).json();data.data.customers.Synthetic={client:'Synthetic'};
  const saved=await (await post('/api/save',{state:data,baseRevision:data.revision})).json();
  assert.equal(saved.ok,true);assert.equal(saved.backup.pending,true,'the save is queued for backup instead of copying the database right away');assert.ok(saved.backup.nextAttemptAt>Date.now());
  assert.deepEqual(fs.readdirSync(path.join(dataDir,'backups')).filter(n=>n.endsWith('.sqlite')),[]);
  const current=await (await request('/api/data')).json();
  const incomplete=await post('/api/save',{state:{data:{orders:[]}},baseRevision:current.revision});
  assert.equal(incomplete.status,400);const refused=await incomplete.json();assert.match(refused.message,/不完整/);assert.equal(refused.code,'incomplete_save');
  assert.equal((await (await request('/api/data')).json()).data.customers.Synthetic.client,'Synthetic');
  const manual=await (await request('/api/manual-backup',{method:'POST'})).json();
  assert.equal(manual.ok,true);assert.match(path.basename(manual.file),/^manual-\d{8}-\d{6}\.sqlite$/);assert.equal(manual.pending,false);
  const status=await (await request('/api/backup-status')).json();assert.equal(status.backup.pending,false);assert.ok(status.backup.lastSuccessfulAt>0);
  const health=await (await request('/api/health')).json();assert.equal(health.ok,true);assert.equal(health.counts.customers,1);
 }finally{if(child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');});fs.rmSync(temporary,{recursive:true,force:true});}
});

// ---- Data safety over HTTP (advisor review round 2): refused deltas, Chinese messages, a newer database ----
const {DatabaseSync}=require('node:sqlite');
async function startServer(t,{prepare}={}){
 const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-http-safety-'));const resources=path.join(temporary,'resources');fs.mkdirSync(resources);
 for(const file of ['server.js','storage.js','storage-path.js','auth.js','errors.js','mail-account.js','mail-imap.js','mail-client.js','mail-smtp.js','mail-mime.js','mail-service.js','mail-libs.js','opportunity-files.js'])fs.copyFileSync(path.join(__dirname,'../backend',file),path.join(resources,file));
 fs.writeFileSync(path.join(resources,'trade-order-system.html'),'<!doctype html><title>Lai HTTP fixture</title>');
 const dataDir=path.join(temporary,'data');fs.mkdirSync(dataDir);if(prepare)prepare(path.join(dataDir,'lai-data.sqlite'));
 const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});const token=crypto.randomBytes(32).toString('hex');
 let stderr='';const child=spawn(process.execPath,[path.join(resources,'server.js')],{env:{...process.env,LAI_DATA_DIR:dataDir,LAI_APP_PORT:String(port),LAI_API_TOKEN:token,LAI_APP_NO_OPEN:'1'},stdio:['ignore','ignore','pipe']});child.stderr.on('data',chunk=>{stderr+=chunk;});
 t.after(async()=>{if(child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}fs.rmSync(temporary,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${port}`;const request=(route,options={})=>fetch(base+route,{...options,headers:{Authorization:`Bearer ${token}`,...options.headers}});
 const post=(route,body)=>request(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 let up=false;for(let i=0;i<500;i++){try{await fetch(base+'/api/health');up=true;break;}catch{}await new Promise(r=>setTimeout(r,20));}assert.equal(up,true);
 return {base,request,post,dataDir,stderr:()=>stderr};
}
const CHINESE=/[一-鿿]/;

test('HTTP: a delta that removes a settings key or blanks a customer is refused (400 incomplete_save, Chinese) and the data is unchanged',async t=>{
 const {request,post}=await startServer(t);
 const data=await (await request('/api/data')).json();data.data.customers.Acme={client:'Acme',note:'kept'};data.data.laiOpportunities=[{id:'p1'},{id:'p2'}];
 assert.equal((await post('/api/save',{state:data,baseRevision:data.revision})).status,200);
 const before=await (await request('/api/data')).json();
 const counts={orders:0,trashOrders:0,deletedOrders:0,customers:1,trackingLookups:0};
 const removal=await post('/api/save-changes',{changes:{customers:{set:{},remove:[]},appState:{},removeAppState:['laiOpportunities'],counts},baseRevision:before.revision});
 assert.equal(removal.status,400);const refused=await removal.json();
 assert.equal(refused.ok,false);assert.equal(refused.code,'incomplete_save');assert.equal(refused.message,'保存的内容不完整，原数据没有改动。请刷新页面后再试。');
 const blank=await post('/api/save-changes',{changes:{customers:{set:{Acme:null},remove:[]},appState:{},removeAppState:[],counts},baseRevision:before.revision});
 assert.equal(blank.status,400);assert.equal((await blank.json()).code,'incomplete_save');
 const after=await (await request('/api/data')).json();
 assert.deepEqual(after,before,'revision and every block are as they were');
 assert.equal(after.data.customers.Acme.note,'kept');
});

test('HTTP: English and internal errors reach the page as plain Chinese; Chinese messages, codes and currentRevision are kept',async t=>{
 const {request,post,stderr}=await startServer(t);
 const data=await (await request('/api/data')).json();
 // 428 baseRevision is required (a write): the generic save message; currentRevision stays.
 const noRevision=await post('/api/save',{state:data});
 assert.equal(noRevision.status,428);const body428=await noRevision.json();
 assert.equal(body428.message,'保存失败，数据没有改动。请稍后再试。');assert.equal(body428.currentRevision,data.revision);
 // 409 state revision conflict: Chinese, with currentRevision.
 const stale=await post('/api/save-changes',{changes:{customers:{set:{},remove:[]},counts:{}},baseRevision:data.revision+5});
 assert.equal(stale.status,409);const body409=await stale.json();assert.equal(body409.currentRevision,data.revision);assert.match(body409.message,CHINESE);assert.doesNotMatch(body409.message,/revision/);
 // An internal error inside the write (duplicate order id → plain Error, status 500): the same generic message, original logged to stderr.
 const dup=await post('/api/save',{state:{...data,data:{...data.data,orders:[{id:'d1',num:'A'},{id:'d1',num:'B'}]}},baseRevision:data.revision});
 assert.equal(dup.status,500);assert.equal((await dup.json()).message,'保存失败，数据没有改动。请稍后再试。');
 assert.match(stderr(),/duplicate order id: d1/);
 // 422 change verification failed: translated too; the page falls back to the full save by status.
 const counts=await post('/api/save-changes',{changes:{customers:{set:{},remove:[]},counts:{orders:9}},baseRevision:data.revision});
 assert.equal(counts.status,422);const body422=await counts.json();assert.equal(body422.message,'保存失败，数据没有改动。请稍后再试。');assert.equal(body422.currentRevision,data.revision);
 // Reads: 400 invalid import log id and 404 not found become the generic read message.
 const badLog=await request('/api/import-log?id=nope');assert.equal(badLog.status,400);assert.equal((await badLog.json()).message,'出了点问题，请稍后再试。');
 const missing=await request('/api/nothing-here');assert.equal(missing.status,404);assert.equal((await missing.json()).message,'出了点问题，请稍后再试。');
 const wrongType=await request('/api/save',{method:'POST',body:'{}'});assert.equal(wrongType.status,415);assert.equal((await wrongType.json()).message,'保存失败，数据没有改动。请稍后再试。');
 // Already-Chinese messages with a status pass through unchanged (incomplete_save, bad backup name).
 const incomplete=await post('/api/save',{state:{data:{orders:[]}},baseRevision:data.revision});
 assert.equal(incomplete.status,400);const bodyIncomplete=await incomplete.json();assert.equal(bodyIncomplete.message,'保存的内容不完整，原数据没有改动。请刷新页面后再试。');assert.equal(bodyIncomplete.code,'incomplete_save');
 const restore=await post('/api/restore',{name:'../x'});assert.equal(restore.status,400);const bodyRestore=await restore.json();assert.equal(bodyRestore.code,'invalid_backup_name');assert.equal(bodyRestore.message,'找不到这份备份。');
 for(const body of [body428,body409,body422,bodyIncomplete,bodyRestore])assert.doesNotMatch(body.message,/[A-Za-z]/,'no English reaches the page');
 assert.equal((await (await request('/api/data')).json()).revision,data.revision,'none of the refused requests changed anything');
});

test('HTTP: a database written by a newer 来财: /api/health and /api/data answer with the Chinese message and code, the file is unchanged',async t=>{
 const prepare=file=>{const db=new DatabaseSync(file);try{db.exec(`CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);CREATE TABLE customers (name TEXT PRIMARY KEY, data_json TEXT NOT NULL);CREATE TABLE orders (id TEXT PRIMARY KEY, bucket TEXT NOT NULL, position INTEGER NOT NULL, data_json TEXT NOT NULL);CREATE TABLE app_state (key TEXT PRIMARY KEY, data_json TEXT NOT NULL);
  INSERT INTO metadata VALUES ('initialized','1'),('schema_version','2'),('revision','3');INSERT INTO customers VALUES ('Future', '{"client":"Future"}');`);}finally{db.close();}};
 const {base,request,post,dataDir}=await startServer(t,{prepare});
 const file=path.join(dataDir,'lai-data.sqlite');const bytes=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 const message='这份数据是更新版本的来财写的，这个版本打不开，数据没有改动。请换用新版本的来财打开。';
 const health=await request('/api/health');assert.equal(health.status,500);const healthBody=await health.json();
 assert.equal(healthBody.ok,false);assert.equal(healthBody.code,'schema_too_new');assert.equal(healthBody.message,message);assert.equal(healthBody.storageMode,'error');
 const anonymous=await (await fetch(base+'/api/health')).json();assert.equal(anonymous.code,'schema_too_new');assert.equal(anonymous.message,message);
 const data=await request('/api/data');assert.equal(data.status,503);const dataBody=await data.json();assert.equal(dataBody.code,'schema_too_new');assert.equal(dataBody.message,message);
 const save=await post('/api/save',{state:{data:{orders:[],customers:{}}},baseRevision:3});assert.equal(save.status,503);const saveBody=await save.json();assert.equal(saveBody.code,'schema_too_new');assert.equal(saveBody.message,message);
 const delta=await post('/api/save-changes',{changes:{customers:{set:{},remove:[]},counts:{}},baseRevision:3});assert.equal(delta.status,503);assert.equal((await delta.json()).code,'schema_too_new');
 assert.equal((await request('/api/manual-backup',{method:'POST'})).status,503);
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),bytes,'not one byte of the database changed');
 assert.deepEqual(fs.readdirSync(dataDir).filter(n=>n.startsWith('lai-data.sqlite')),['lai-data.sqlite']);
 assert.equal(fs.existsSync(path.join(dataDir,'sqlite-storage.json')),false);
});
