// Injected blob transport: local immutable blobs in tests; authenticated R2 in deployment.
const fs=require('node:fs'),path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {preserveDeleted}=require('../../deleted-files');
const {preserveMaterial}=require('../../material-history');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function safe(root,relative){
 if(typeof relative!=='string'||relative!==relative.normalize('NFC')||relative.includes('\\')||path.isAbsolute(relative)||relative.split('/').some(x=>!x||x==='..'||x==='.'||x==='.git'||x==='삭제한 파일'))throw new Error('Unsafe file path');
 const target=path.join(root,relative);let current=root;
 for(const part of relative.split('/')){current=path.join(current,part);if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw new Error('Symlink not allowed');}
 return target;
}
function receiver(root,blobs){
 return async(previous,next)=>{
  if(!next.id.startsWith('file/'))return;
  const relative=next.value.path,target=safe(root,relative);
  const oldPath=previous?.value?.path,oldTarget=oldPath?safe(root,oldPath):null;
  if(oldTarget&&fs.existsSync(oldTarget)){
    const bytes=fs.readFileSync(oldTarget);
    if(hash(bytes)!==previous.value.hash&&!(oldTarget===target&&!next.deleted&&hash(bytes)===next.value.hash))throw new Error('Local file changed; upload or choose before replacing');
  }
  if(next.deleted){
    if(fs.existsSync(target)){await preserveDeleted(root,relative,fs.readFileSync(target));fs.unlinkSync(target);}return;
  }
  const bytes=await blobs.get(next.value.hash);
  if(hash(bytes)!==next.value.hash)throw new Error('Download hash mismatch');
  if(fs.existsSync(target)&&hash(fs.readFileSync(target))!==next.value.hash){
    if(!previous||oldTarget!==target)throw new Error('Destination occupied; explicit choice required');
    preserveMaterial(root,relative,fs.readFileSync(target));
  }
  fs.mkdirSync(path.dirname(target),{recursive:true});
  if(!fs.existsSync(target)||hash(fs.readFileSync(target))!==next.value.hash){
    const temporary=target+'.sync-pending-'+randomUUID();
    const fd=fs.openSync(temporary,'wx',0o600);
    try{
      try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      fs.renameSync(temporary,target);
    }finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
  }
  if(oldTarget&&oldTarget!==target&&fs.existsSync(oldTarget)){await preserveDeleted(root,oldPath,fs.readFileSync(oldTarget));fs.unlinkSync(oldTarget);}
 };
}
async function upload(client,id,relative,bytes,blobs){
 safe('/unused',relative);const digest=hash(bytes);await blobs.put(digest,bytes);
 client.edit('file/'+id,{path:relative,hash:digest});
}
module.exports={hash,safe,receiver,upload};
