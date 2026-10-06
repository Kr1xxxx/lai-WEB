'use strict';
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
function laiDataDirectory(){
 const defaultPath=path.join(os.homedir(),'Library','Application Support','LaiCRM');
 const requested=process.env.LAI_DATA_DIR;const target=requested||defaultPath;
 if(!path.isAbsolute(target)||path.normalize(target)!==target)throw new Error('Lai data path must be canonical');
 for(const name of ['TradeOrderSystem','TradeOrderSystem-OKKIPreview']){const forbidden=path.join(os.homedir(),'Library','Application Support',name);if(target===forbidden||target.startsWith(forbidden+path.sep))throw new Error('Existing application data directory forbidden');}
 if(requested&&target!==defaultPath){const temporaryRoot=fs.realpathSync(os.tmpdir());const relative=path.relative(temporaryRoot,target);if(relative.startsWith('..')||path.isAbsolute(relative)||!/^lai-test-[A-Za-z0-9_-]+(?:\/|$)/.test(relative))throw new Error('Lai override is restricted to canonical test directories');}
 let current=path.parse(target).root;
 for(const part of target.slice(current.length).split(path.sep).filter(Boolean)){current=path.join(current,part);let stat;try{stat=fs.lstatSync(current);}catch(error){if(error.code==='ENOENT')continue;throw error;}if(stat.isSymbolicLink())throw new Error('Symbolic links in Lai data path forbidden');}
 function check(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isSymbolicLink())throw new Error('Symbolic links within Lai storage forbidden');if(item.isDirectory())check(file);else if(fs.lstatSync(file).nlink>1)throw new Error('Hardlinked files within Lai storage forbidden');}}
 if(fs.existsSync(target))check(target);return target;
}
module.exports={laiDataDirectory};
