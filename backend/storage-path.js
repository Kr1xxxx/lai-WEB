'use strict';
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
// 数据目录的位置检查（便宜，每次都做）；目录里有没有符号链接、硬链接要把整个目录走一遍，
// 只在启动时做一次（默认 scan: true；保存时传 scan: false），并跳过 backups/（备份由来财自己写，文件多，走一遍很慢）。
function laiDataDirectory({scan=true}={}){
 const defaultPath=path.join(os.homedir(),'Library','Application Support','LaiCRM');
 const requested=process.env.LAI_DATA_DIR;const target=requested||defaultPath;
 if(!path.isAbsolute(target)||path.normalize(target)!==target)throw new Error('Lai data path must be canonical');
 for(const name of ['TradeOrderSystem','TradeOrderSystem-OKKIPreview']){const forbidden=path.join(os.homedir(),'Library','Application Support',name);if(target===forbidden||target.startsWith(forbidden+path.sep))throw new Error('不能使用旧应用的数据目录');}
 if(requested&&target!==defaultPath){const temporaryRoot=fs.realpathSync(os.tmpdir());const relative=path.relative(temporaryRoot,target);if(relative.startsWith('..')||path.isAbsolute(relative)||!/^lai-test-[A-Za-z0-9_-]+(?:\/|$)/.test(relative))throw new Error('Lai override is restricted to canonical test directories');}
 let current=path.parse(target).root;
 for(const part of target.slice(current.length).split(path.sep).filter(Boolean)){current=path.join(current,part);let stat;try{stat=fs.lstatSync(current);}catch(error){if(error.code==='ENOENT')continue;throw error;}if(stat.isSymbolicLink())throw new Error('来财数据目录的路径里有快捷方式（符号链接），为了数据安全已停止');}
 // backups/ 本身不能是符号链接，但不进去逐个检查。
 function check(dir,top){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isSymbolicLink())throw new Error('来财数据目录里有快捷方式（符号链接），为了数据安全已停止');if(item.isDirectory()){if(!(top&&item.name==='backups'))check(file,false);}else if(fs.lstatSync(file).nlink>1)throw new Error('来财数据目录里有硬链接文件，为了数据安全已停止');}}
 if(scan&&fs.existsSync(target))check(target,true);return target;
}
module.exports={laiDataDirectory};
