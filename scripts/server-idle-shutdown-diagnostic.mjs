import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import net from 'node:net';
import {spawn} from 'node:child_process';
const app=path.resolve(process.env.LAI_ACCEPTANCE_APP),resources=path.join(app,'Contents/Resources');
const evidence=path.resolve(process.env.LAI_SHUTDOWN_EVIDENCE),temporary=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'lai-test-idle-shutdown-'));
const children=[],sockets=[],results=[];const pause=ms=>new Promise(r=>setTimeout(r,ms));
const freePort=()=>new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
async function start(name){const port=await freePort(),token=crypto.randomBytes(32).toString('hex');const child=spawn(path.join(resources,'node-runtime'),[path.join(resources,'server.js')],{env:{...process.env,LAI_DATA_DIR:path.join(temporary,name),LAI_APP_PORT:String(port),LAI_API_TOKEN:token,LAI_INSTANCE_NONCE:'idle-shutdown-diagnostic',LAI_APP_NO_OPEN:'1'},stdio:'ignore'});children.push(child);for(let i=0;i<160;i++){assert.equal(child.exitCode,null);try{const response=await fetch('http://127.0.0.1:'+port+'/api/health');await response.arrayBuffer();if(response.ok)return {child,port};}catch{}await pause(25);}throw Error('Isolated backend did not start');}
async function bare(port){const socket=net.createConnection({host:'127.0.0.1',port});sockets.push(socket);await new Promise((r,j)=>{socket.once('connect',r);socket.once('error',j);});return socket;}
async function shutdown(child){const started=Date.now();const exited=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await Promise.race([exited,pause(6200)]);if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}return {exitCode:child.exitCode,signalCode:child.signalCode,elapsedMs:Date.now()-started};}
try{
 fs.mkdirSync(evidence,{recursive:true});assert.equal(fs.existsSync(path.join(resources,'trade-order-data.json')),false);
 let service=await start('normal');results.push({case:'normal completed health read',...await shutdown(service.child)});
 service=await start('unused');let socket=await bare(service.port);const held=await shutdown(service.child);results.push({case:'connected TCP client with no HTTP request sent',...held,socketBytesWritten:socket.bytesWritten});socket.destroy();
 service=await start('closed');socket=await bare(service.port);const completion=shutdown(service.child);await pause(100);socket.destroy();results.push({case:'same unused TCP connection closed by client after signal',...await completion});
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({results,scope:'Actual fixed local service; no browser/native app; synthetic empty data dirs; socket sends no headers or token'},null,2));console.log(JSON.stringify(results));
}finally{for(const socket of sockets)socket.destroy();for(const child of children)if(child.exitCode===null&&child.signalCode===null)await shutdown(child);fs.rmSync(temporary,{recursive:true,force:true,maxRetries:8,retryDelay:100});fs.writeFileSync(path.join(evidence,'cleanup.json'),JSON.stringify({temporaryRemoved:!fs.existsSync(temporary),children:children.map(c=>({pid:c.pid,exitCode:c.exitCode,signalCode:c.signalCode}))},null,2));}
