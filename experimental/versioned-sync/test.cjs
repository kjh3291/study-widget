const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {start}=require('./server.cjs'),{Client}=require('./client.cjs');
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'studeck-versioned-')),token=randomUUID();let server;
 try{
  server=await start({filename:path.join(temp,'server.sqlite'),token});
  const options=device=>({filename:path.join(temp,device+'.json'),url:server?.url||'http://127.0.0.1:1',token,device});
  let a=new Client(options('mac')),b=new Client(options('windows'));
  const unauthorized=await fetch(server.url+'/status');assert.equal(unauthorized.status,401);
  a.edit('todo/a',{text:'original'});await a.sync();await b.sync();assert.deepEqual(b.value('todo/a'),{text:'original'});
  a.edit('todo/a',{text:'mac edit'});b.edit('todo/b',{text:'windows addition'});await a.sync();await b.sync();await a.sync();assert.equal(a.value('todo/b').text,'windows addition');assert.equal(b.value('todo/a').text,'mac edit');
  a.edit('todo/a',{text:'mac competing'});b.edit('todo/a',{text:'windows competing'});await a.sync();let result=await b.sync();assert.deepEqual(result.conflicts,['todo/a']);assert.equal(b.value('todo/a').text,'windows competing');assert.equal((await a.request('/status')).devices.find(x=>x.id==='windows').seq<result.serverHead,true);
  b=new Client(options('windows'));assert.equal(b.value('todo/a').text,'windows competing');b.resolve('todo/a','local');await b.sync();await a.sync();assert.equal(a.value('todo/a').text,'windows competing');
  // Delete versus offline edit cannot resurrect data without a choice.
  b.edit('todo/a',{text:'offline edit'});a.edit('todo/a',null,true);await a.sync();result=await b.sync();assert.deepEqual(result.conflicts,['todo/a']);assert.equal(a.value('todo/a'),null);b.resolve('todo/a','remote');await b.sync();assert.equal(b.value('todo/a'),null);
  const history=await a.request('/history?id=todo%2Fa');assert.equal(history.length,5);assert.equal(history.at(-1).deleted,true);assert.equal(history[0].value.text,'original');
  // Explicit restore creates a new revision; it never rewrites history.
  a.edit('todo/a',history[0].value);await a.sync();assert.equal(a.state.records['todo/a'].revision,6);
  // A response lost after server commit is safely replayed after restart.
  a.edit('event/retry',{text:'one copy'});const op=a.state.queue.at(-1);await a.request('/write',op);a=new Client(options('mac'));await a.sync();assert.equal((await a.request('/history?id=event%2Fretry')).length,1);
  await assert.rejects(()=>a.request('/write',{...op,value:{text:'changed retry'}}),/reused/);
  // New edits during upload must remain pending, with their own base revision.
  a.edit('course/c',{name:'Course',room:'A'});const original=a.request.bind(a);let edited=false;
  a.request=async(route,body)=>{const r=await original(route,body);if(route==='/write'&&!edited){edited=true;a.edit('course/c',{name:'Course',room:'B'});}return r;};
  result=await a.sync();assert.equal(result.pending,1);assert.equal(a.value('course/c').room,'B');a.request=original;await a.sync();await b.sync();assert.equal(b.value('course/c').room,'B');
  // Server downtime, client restart, and server restart retain queued writes/receipts.
  await server.close();server=null;a.edit('subtask/child',{text:'offline child'});await assert.rejects(()=>a.sync());a=new Client(options('mac'));assert.equal(a.state.queue.length,1);
  server=await start({filename:path.join(temp,'server.sqlite'),token});a.url=server.url;b.url=server.url;await a.sync();await b.sync();assert.equal(b.value('subtask/child').text,'offline child');
  assert.equal((await a.request('/history?id=event%2Fretry')).length,1);
  const status=await a.request('/status');assert.equal(status.devices.find(x=>x.id==='windows').seq,status.head);
  console.log('PASS: real HTTP + persistent SQLite, authorization, independent edits, stale-write rejection, conflict restart/choice, deletion vs edit, version history/restore, lost-response retry, in-flight edits, offline/server restart, device acknowledgement');
 }finally{if(server)await server.close();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
