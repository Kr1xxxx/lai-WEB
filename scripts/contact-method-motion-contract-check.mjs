import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// Replay the actual long-workflow style assertions against isolated CDP samples.
// This is assertion verification, not execution of the whole browser workflow.
const reportPath=process.env.LAI_METHOD_CONTRACT_REPORT;
assert.ok(reportPath,'LAI_METHOD_CONTRACT_REPORT must identify an isolated browser report');
const evidence=path.resolve(process.env.LAI_METHOD_CONTRACT_EVIDENCE || 'evidence/method-contract');
fs.mkdirSync(evidence,{recursive:true});
const report=JSON.parse(fs.readFileSync(reportPath,'utf8'));
assert.equal(report.result,'pass');
const source=fs.readFileSync(new URL('./motion-acceptance.mjs',import.meta.url),'utf8');
const results=[];
function block(variable){
 const start=source.indexOf(`  const ${variable}=await evaluate(`);
 assert.ok(start>=0,'Find actual style collection');
 const assertion=source.indexOf(`  assert.deepEqual(${variable}`,start);
 assert.ok(assertion>=start,'Find actual assertion');
 return source.slice(start,source.indexOf('\n',assertion));
}
async function replay(code,row){
 const style={animationName:row.animation,animationDuration:row.duration,opacity:String(row.opacity),transform:row.transform};
 const element={querySelector:()=>({value:''})};
 const context={assert,document:{querySelector:()=>element},getComputedStyle:()=>style};
 context.evaluate=expression=>vm.runInNewContext(expression,context);
 await vm.runInNewContext(`(async()=>{${code}})()`,context);
}
try{
 for(const [variable,index] of [['reducedSocialMethod',5],['pointerPhoneMethod',0]]){
  const action=report.observations[index];
  assert.ok(action.samples.length>=5);
  const code=block(variable);
  for(const sample of action.samples){
   await replay(code,sample.rows.at(-1));
  }
  results.push({variable,observedSamples:action.samples.length,status:'pass'});
  const valid=action.samples[0].rows.at(-1);
  for(const [kind,changed] of [
   ['named_animation',{animation:'lai-contact-method-enter'}],
   ['transparent_row',{opacity:0}],
   ['translated_row',{transform:'matrix(1, 0, 0, 1, 0, 4)'}],
  ]){
   let rejected=false;
   try{await replay(code,{...valid,...changed});}catch(error){assert.equal(error.name,'AssertionError');rejected=true;}
   assert.equal(rejected,true,variable+' must reject '+kind);
   results.push({variable,mutation:kind,status:'expected_rejection'});
  }
 }
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({result:'pass',sourceReport:path.resolve(reportPath),htmlSha256:report.htmlSha256,scope:'actual style collection and assertion fragments only; not full long browser workflow',results},null,2));
 console.log('PASS: both actual style assertions accept observed samples and reject6 animation/opacity/transform mutations');
}catch(error){
 fs.writeFileSync(path.join(evidence,'failure.json'),JSON.stringify({result:'fail',error:error.message,results},null,2));
 throw error;
}
