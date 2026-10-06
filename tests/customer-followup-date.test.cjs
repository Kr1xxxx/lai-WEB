const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
function modelAt(instant,year,month,day){
 class ClockDate extends Date {
  constructor(...args){super(...(args.length?args:[instant]));this.wallClock=!args.length;}
  getFullYear(){return this.wallClock?year:super.getFullYear();}
  getMonth(){return this.wallClock?month-1:super.getMonth();}
  getDate(){return this.wallClock?day:super.getDate();}
 }
 const context={Date:ClockDate};vm.createContext(context);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/model.js'),'utf8'),context);
 return context.PreviewModel;
}
const rows=['2026-09-30','2026-10-01','2026-10-02'].map((nextFollow,i)=>({name:String(i),nextFollow,tags:[]}));
test('customer followup filter includes local today when UTC is still the previous day',()=>{
 const M=modelAt('2026-09-30T16:30:00Z',2026,10,1);
 assert.deepEqual(Array.from(M.filterCustomers(rows,{group:'followup'}),c=>c.nextFollow),['2026-09-30','2026-10-01']);
});
test('customer followup filter excludes local tomorrow when UTC is already the next day',()=>{
 const M=modelAt('2026-10-01T00:30:00Z',2026,9,30);
 assert.deepEqual(Array.from(M.filterCustomers(rows,{group:'followup'}),c=>c.nextFollow),['2026-09-30']);
});
