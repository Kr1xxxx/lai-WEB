const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {DatabaseSync}=require('node:sqlite');
const {openStorage}=require('../backend/storage.js');
// Explicit pre-import tables, independent of current schema generation.
// Every record is synthetic; no installed database or attachment is copied.
function legacyFixture(target) {
 const db=new DatabaseSync(target);
 try {
  db.exec(`
   CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE orders (
    id TEXT PRIMARY KEY, bucket TEXT NOT NULL CHECK(bucket IN ('orders','trashOrders','deletedOrders')),
    position INTEGER NOT NULL, num TEXT NOT NULL DEFAULT '', client TEXT NOT NULL DEFAULT '',
    country TEXT NOT NULL DEFAULT '', order_month TEXT NOT NULL DEFAULT '', stage TEXT NOT NULL DEFAULT '',
    amount REAL NOT NULL DEFAULT 0, paid_amount REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'USD', tracking_number TEXT NOT NULL DEFAULT '',
    carrier TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '', data_json TEXT NOT NULL
   );
   CREATE TABLE customers (
    name TEXT PRIMARY KEY, country TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
    contact TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '', data_json TEXT NOT NULL
   );
   CREATE TABLE app_state (key TEXT PRIMARY KEY, data_json TEXT NOT NULL);
   INSERT INTO metadata VALUES ('initialized','1'),('schema_version','1'),('revision','4');
  `);
  const customerRow={name:'Legacy Fixture'};
  const customer={country:'US',source:'Synthetic legacy',note:'Before save',contacts:['legacy-contact','second-contact'],legacyExtra:{keep:['existing-fields',1],nested:{enabled:true}}};
  const order={id:'legacy-order-1',num:'OLD-001',client:customerRow.name,amount:12,currency:'USD',attachments:[{link:'/attachments/compat/legacy.txt',name:'legacy link only',legacyExtra:'keep'}],legacyExtra:{retain:true}};
  db.prepare('INSERT INTO customers(name,data_json) VALUES(?,?)').run(customerRow.name,JSON.stringify(customer));
  db.prepare('INSERT INTO orders(id,bucket,position,num,client,data_json) VALUES(?,?,?,?,?,?)').run(order.id,'orders',0,order.num,order.client,JSON.stringify(order));
  db.prepare('INSERT INTO app_state(key,data_json) VALUES(?,?)').run('legacyStateEnvelope',JSON.stringify({unrecognized:true,nested:[{preserve:'yes'}]}));
  return {customerRow,customer,order,schema:db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all()};
 } finally {db.close();}
}
test('synthetic legacy SQLite keeps schema, all fields and attachment bytes after save, backup and restart',()=>{
 const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-legacy-'));const dataDir=path.join(temporary,'data');fs.mkdirSync(dataDir);const target=path.join(dataDir,'lai-data.sqlite');const previous=process.env.LAI_DATA_DIR;let store;
 try{
  const {customerRow,customer,order,schema}=legacyFixture(target);
  fs.mkdirSync(path.join(dataDir,'attachments/compat'),{recursive:true});fs.writeFileSync(path.join(dataDir,'attachments/compat/legacy.txt'),'Original attachment bytes');
  process.env.LAI_DATA_DIR=dataDir;store=openStorage({seedFile:path.join(temporary,'missing-seed.json')});const before=store.readSnapshot();assert.deepEqual(before.data.customers[customerRow.name],customer);assert.deepEqual(before.data.orders.find(o=>o.id===order.id),order);assert.deepEqual(before.data.legacyStateEnvelope,{unrecognized:true,nested:[{preserve:'yes'}]});
  before.data.customers[customerRow.name].note='Saved using unified app';const saved=store.save(before,{baseRevision:before.revision});assert.equal(saved.revision,before.revision+1);
  const snapshot=store.backup(true);assert.equal(snapshot.ok,true);assert.equal(fs.readFileSync(path.join(snapshot.attachmentsDir,'compat/legacy.txt'),'utf8'),'Original attachment bytes');assert.equal(fs.readFileSync(path.join(dataDir,'attachments/compat/legacy.txt'),'utf8'),'Original attachment bytes');
  store.close();store=openStorage({seedFile:path.join(temporary,'missing-seed.json')});const reopened=store.readSnapshot();assert.deepEqual(reopened.data,before.data);store.close();store=null;
  const check=new DatabaseSync(target,{readOnly:true});try{const after=check.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all();for(const table of schema)assert.deepEqual(after.find(row=>row.name===table.name),table);assert.ok(after.some(row=>row.name==='import_logs'),'Additive import log table should survive restart');}finally{check.close();}
 }finally{store?.close();if(previous===undefined)delete process.env.LAI_DATA_DIR;else process.env.LAI_DATA_DIR=previous;fs.rmSync(temporary,{recursive:true,force:true});}
});
