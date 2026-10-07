'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const S=require('../src/segments.js'),M=require('../src/model.js'),F=require('../src/customer-fields.js');
const profiles={
 MainBackup:{alternateEmail:'same@example.test'},
 ExtraBackup:{extraContacts:[null,{alternateEmail:'same@example.test'}]},
 LegacyBackup:{alternativeEmail:'same@example.test'},
 OldBackup:{backupEmail:'same@example.test'},
 Cleared:{alternateEmail:'',alternativeEmail:'stale@example.test',extraContacts:[{alternateEmail:'',backupEmail:'stale@example.test'}]},
 PaymentOnly:{paymentEmail:'same@example.test'},
 Other:{email:'other@example.test'},
};
const rows=()=>M.buildCustomers({customers:structuredClone(profiles),orders:[]});
const names=items=>items.map(row=>row.name);
for(const [op,value,want] of [
 ['eq','same@example.test',['MainBackup','ExtraBackup','LegacyBackup','OldBackup']],
 ['neq','same@example.test',['Other']],
 ['contains','SAME@',['MainBackup','ExtraBackup','LegacyBackup','OldBackup']],
 ['notContains','same@',['Other']],
 ['empty',undefined,['Cleared','PaymentOnly']],
 ['notEmpty',undefined,['MainBackup','ExtraBackup','LegacyBackup','OldBackup','Other']],
])test(`advanced email ${op} uses the complete contact email collection`,()=>{
 const input=rows(),before=structuredClone(input),rule={field:'email',op,...(value===undefined?{}:{value})};
 assert.deepEqual(names(S.filterByRules(input,{rules:[rule]})),want);
 assert.deepEqual(names(S.resolveMembers(input,{kind:'rules',rules:[rule]})),want);
 assert.deepEqual(input,before);
});
test('global, ordinary and saved dynamic email group agree and explicit clears remain empty',()=>{
 const state={customers:structuredClone(profiles),orders:[]};
 const next=S.upsertSegment(state,'email-group',{name:'Email group',kind:'rules',match:'all',rules:[{field:'email',op:'eq',value:'same@example.test'}]});
 const input=M.buildCustomers(next),expected=['MainBackup','ExtraBackup','LegacyBackup','OldBackup'];
 assert.deepEqual(names(F.globalCustomerSearch(input,{field:'email',query:'same@example.test'})),expected);
 assert.deepEqual(names(F.filter(input,{field:'email',query:'same@example.test'})),expected);
 assert.deepEqual(names(S.resolveMembers(input,next.previewSegments[0])),expected);
 assert.deepEqual(S.filterByRules(input,{rules:[{field:'email',op:'eq',value:'stale@example.test'}]}),[]);
 assert.deepEqual(state.customers,profiles);
});
test('non-email advanced conditions keep their prior field boundaries',()=>{
 const input=rows();assert.deepEqual(S.filterByRules(input,{rules:[{field:'contact',op:'contains',value:'same@example.test'}]}),[]);
});
