const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {start}=require('./server.cjs'),{Client}=require('./client.cjs'),{hash,receiver,upload}=require('./files.cjs');
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'studeck-versioned-files-'));let server;
 try{
  const token=randomUUID();server=await start({filename:path.join(temp,'db'),token});
  const blobDir=path.join(temp,'blobs'),root=path.join(temp,'receiver');fs.mkdirSync(blobDir);fs.mkdirSync(root);
  const blobs={put:async(id,bytes)=>{assert.equal(hash(bytes),id);const p=path.join(blobDir,id);if(!fs.existsSync(p))fs.writeFileSync(p,bytes,{flag:'wx'});},get:async id=>fs.readFileSync(path.join(blobDir,id))};
  const a=new Client({filename:path.join(temp,'a.json'),device:'a',url:server.url,token});
  const b=new Client({filename:path.join(temp,'b.json'),device:'b',url:server.url,token,applyRecord:receiver(root,blobs)});
  const relative='선형대수학/보조자료/정리.pdf',target=path.join(root,relative);
  await upload(a,'one',relative,Buffer.from('version1'),blobs);await a.sync();await b.sync();assert.equal(fs.readFileSync(target,'utf8'),'version1');
  await upload(a,'one',relative,Buffer.from('version2'),blobs);await a.sync();await b.sync();assert.equal(fs.readFileSync(target,'utf8'),'version2');
  const history=path.join(root,'선형대수학/보조자료/이전 자료');assert.equal(fs.readdirSync(history).length,1);assert.equal(fs.readFileSync(path.join(history,fs.readdirSync(history)[0]),'utf8'),'version1');
  // Never overwrite an external local edit that has not yet been queued.
  fs.writeFileSync(target,'unscanned local edit');await upload(a,'one',relative,Buffer.from('version3'),blobs);await a.sync();const cursor=b.state.cursor;
  await assert.rejects(()=>b.sync(),/Local file changed/);assert.equal(b.state.cursor,cursor);assert.equal(fs.readFileSync(target,'utf8'),'unscanned local edit');
  fs.writeFileSync(target,'version2');await b.sync();assert.equal(fs.readFileSync(target,'utf8'),'version3');
  // A missing/corrupt blob never advances the receiving device's applied cursor.
  await upload(a,'one',relative,Buffer.from('version4'),blobs);await a.sync();const blob=path.join(blobDir,hash(Buffer.from('version4')));fs.writeFileSync(blob,'corrupt');
  const before=b.state.cursor;await assert.rejects(()=>b.sync(),/hash mismatch/);assert.equal(b.state.cursor,before);assert.equal(fs.readFileSync(target,'utf8'),'version3');
  fs.writeFileSync(blob,'version4');await b.sync();assert.equal(fs.readFileSync(target,'utf8'),'version4');
  a.edit('file/one',a.value('file/one'),true);await a.sync();await b.sync();assert.equal(fs.existsSync(target),false);
  assert.equal(fs.readFileSync(path.join(root,'삭제한 파일',relative),'utf8'),'version4');
  assert.equal((await a.request('/pull')).records.some(x=>x.value?.path?.startsWith('삭제한 파일/')),false);
  await assert.rejects(()=>upload(a,'bad','../escape',Buffer.from('bad'),blobs),/Unsafe/);
  const status=await a.request('/status');assert.equal(status.devices.find(x=>x.id==='b').seq,status.head);
  console.log('PASS: same-name file updates, previous versions, unqueued local edit protection, corrupt download blocks acknowledgement, remote deletion -> local course trash, trash never published, path traversal blocked');
 }finally{if(server)await server.close();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
