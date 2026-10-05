const assert=require('node:assert/strict');
const {mergeShared}=require('../sync-model');
const course=(name,place='A')=>({name,professor:'Professor',times:[{day:0,start:108,end:120,place}]});
const merge=(base,local,remote,choices)=>mergeShared({timetableFull:base},{timetableFull:local},{timetableFull:remote},choices);
const base=[course('Math'),course('Network')],local=[course('Math','B'),course('Network'),course('Study')],remote=[course('Math'),course('Network','C')];
for(const [a,b] of [[local,remote],[remote,local]]){
 const r=merge(base,a,b);assert.equal(r.conflicts.length,0);assert.equal(r.data.timetableFull.length,3);
 assert.equal(r.data.timetableFull.find(x=>x.name==='Math').times[0].place,'B');assert.equal(r.data.timetableFull.find(x=>x.name==='Network').times[0].place,'C');assert.ok(r.data.timetableFull.some(x=>x.name==='Study'));
}
const conflict=merge(base,[course('Math','B'),course('Network')],[course('Math','C'),course('Network')]);assert.equal(conflict.conflicts.length,1);assert.deepEqual(conflict.conflicts[0].path,['timetableFull',{name:'Math'},'times']);assert.deepEqual(conflict.conflicts[0].base.value,base[0].times);
const chosen=merge(base,[course('Math','B'),course('Network')],[course('Math','C'),course('Network')],{[conflict.conflicts[0].id]:'remote'});assert.equal(chosen.data.timetableFull[0].times[0].place,'C');
assert.equal(merge(base,[course('Network')],[course('Math','C'),course('Network')]).conflicts.length,1);
assert.deepEqual(merge(base,[course('Network')],base).data.timetableFull,[course('Network')]);
const duplicate=[course('Math'),course('Math','B')];assert.equal(merge(base,duplicate,[course('Math','C')]).conflicts.length,1);
assert.equal(merge([course('선형대수학')],[course('선형대수학','B')],[course('선형대수학'.normalize('NFD'))]).conflicts.length,0);
console.log('PASS: bidirectional study addition/course edits, explicit same-course conflict, deletion protection, duplicate-name fallback and Unicode names');
