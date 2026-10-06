import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
const output=process.argv[2];
if(!output)throw Error('Output path is required');
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const databases=[];
for(const [label,relative] of [['Lai','LaiCRM/lai-data.sqlite'],['TOS','TradeOrderSystem/trade-order-system.sqlite']]){
 const file=path.join(os.homedir(),'Library/Application Support',relative);
 const database=new DatabaseSync(file,{readOnly:true});
 try{
  const tables=database.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row=>row.name);
  const content=tables.map(name=>({name,rows:database.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all().map(row=>JSON.stringify(row)).sort()}));
  databases.push({label,path:file,logicalSha256:digest(JSON.stringify(content)),tableCount:tables.length,files:Object.fromEntries(['','-wal'].filter(s=>fs.existsSync(file+s)).map(s=>[s||'main',digest(fs.readFileSync(file+s))]))});
 }finally{database.close();}
}
fs.writeFileSync(output,JSON.stringify({at:new Date().toISOString(),databases},null,2));
console.log('Read-only fingerprints written; no table values printed.');
