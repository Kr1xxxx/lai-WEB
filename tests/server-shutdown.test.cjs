const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function port() { return new Promise(resolve => {const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const value=server.address().port;server.close(()=>resolve(value));});}); }
async function fixture() {
  const temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-shutdown-'));
  const resources=path.join(temporary,'resources'); fs.mkdirSync(resources);
  for(const name of ['server.js','storage.js','storage-path.js','auth.js','errors.js','mail-account.js','mail-imap.js','mail-client.js','mail-smtp.js','mail-mime.js','mail-service.js'])fs.copyFileSync(path.join(__dirname,'../backend',name),path.join(resources,name));
  fs.writeFileSync(path.join(resources,'trade-order-system.html'),'<!doctype html><title>Private shutdown fixture</title>');
  const children=[],sockets=[];
  async function start() {
    const servicePort=await port(),token=crypto.randomBytes(32).toString('hex');
    const child=spawn(process.execPath,[path.join(resources,'server.js')],{env:{...process.env,LAI_DATA_DIR:path.join(temporary,'database'),LAI_APP_PORT:String(servicePort),LAI_API_TOKEN:token,LAI_APP_NO_OPEN:'1'},stdio:'ignore'});children.push(child);
    const base='http://127.0.0.1:'+servicePort;
    for(let i=0;i<100;i++){assert.equal(child.exitCode,null);try{const response=await fetch(base+'/api/health');await response.arrayBuffer();if(response.ok)return{child,port:servicePort,token,base};}catch{}await pause(25);}
    throw Error('Private service did not start');
  }
  async function socket(service) {const connection=net.createConnection({host:'127.0.0.1',port:service.port});sockets.push(connection);await new Promise((resolve,reject)=>{connection.once('connect',resolve);connection.once('error',reject);});return connection;}
  async function exited(child) {if(child.exitCode!==null||child.signalCode!==null)return;await Promise.race([new Promise(resolve=>child.once('exit',resolve)),pause(6500)]);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await new Promise(resolve=>child.once('exit',resolve));}}
  async function cleanup(){for(const socket of sockets)socket.destroy();for(const child of children){if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');await exited(child);}fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
  return {start,socket,exited,cleanup};
}
const read=async service=>(await fetch(service.base+'/api/data',{headers:{'x-trade-token':service.token}})).json();

test('shutdown closes a client that has sent no HTTP request and preserves the checkpointed customer code',async()=>{
  const h=await fixture();try{
    let service=await h.start();let snapshot=await read(service);assert.deepEqual(snapshot.data.customers,{});
    snapshot.data.customers.Synthetic={country:'US',source:'Referral',customerCode:'0007',custom:{kept:true}};
    const response=await fetch(service.base+'/api/save',{method:'POST',headers:{'x-trade-token':service.token,'Content-Type':'application/json'},body:JSON.stringify({state:snapshot,baseRevision:snapshot.revision})});assert.equal(response.status,200);await response.json();const expected=await read(service);
    const unused=await h.socket(service);assert.equal(unused.bytesWritten,0);
    service.child.kill('SIGTERM');await h.exited(service.child);assert.equal(service.child.exitCode,0,'An unused browser connection must not turn normal shutdown into a timeout failure');
    unused.destroy();service=await h.start();assert.deepEqual(await read(service),expected);
  }finally{await h.cleanup();}
});

test('shutdown finishes a received HTTP save body before exiting and keeps the saved code after restart',async()=>{
  const h=await fixture();try{
    let service=await h.start();const snapshot=await read(service);snapshot.data.customers.Synthetic={country:'US',source:'Referral',customerCode:'0011',custom:{kept:true}};
    const body=JSON.stringify({state:snapshot,baseRevision:snapshot.revision}),connection=await h.socket(service);let raw='';connection.setEncoding('utf8');connection.on('data',chunk=>{raw+=chunk;});const closed=new Promise(resolve=>connection.once('close',resolve));
    connection.write('POST /api/save HTTP/1.1\r\nHost: 127.0.0.1:'+service.port+'\r\nx-trade-token: '+service.token+'\r\nContent-Type: application/json\r\nContent-Length: '+Buffer.byteLength(body)+'\r\nConnection: close\r\n\r\n'+body.slice(0,1));
    await pause(100);service.child.kill('SIGTERM');await pause(100);assert.equal(service.child.exitCode,null,'Received request must be drained, not destroyed with the unused connections');
    connection.write(body.slice(1));await Promise.race([closed,pause(6500)]);await h.exited(service.child);assert.equal(service.child.exitCode,0);assert.equal(Number(/^HTTP\/1\.1 (\d+)/.exec(raw)?.[1]),200);
    service=await h.start();const saved=await read(service);assert.equal(saved.data.customers.Synthetic.customerCode,'0011');assert.deepEqual(saved.data.customers.Synthetic.custom,{kept:true});assert.equal(saved.revision,snapshot.revision+1);
  }finally{await h.cleanup();}
});
