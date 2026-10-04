const fs=require('node:fs');
const {randomUUID}=require('node:crypto');
const {atomicJSON}=require('../../sync-storage');
class Client {
  constructor({filename,url,token,device,applyRecord=async()=>{}}) {
    Object.assign(this,{filename,url,token,applyRecord});
    this.state=fs.existsSync(filename)?JSON.parse(fs.readFileSync(filename,'utf8')):{device,records:{},queue:[],cursor:0,conflicts:{}};
    this.save();
  }
  save(){atomicJSON(this.filename,this.state);}
  async request(path,body){const r=await fetch(this.url+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${this.token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(5000)});const data=await r.json();if(!r.ok)throw new Error(data.error);return data;}
  edit(id,value,deleted=false){
    const pending=this.state.queue.filter(x=>x.id===id);
    const base=pending.length?pending.at(-1).base+1:(this.state.records[id]?.revision||0);
    this.state.queue.push({op:randomUUID(),id,base,value:structuredClone(value),deleted});this.save();
  }
  value(id){const op=this.state.queue.findLast(x=>x.id===id)||this.state.records[id];return op&&!op.deleted?structuredClone(op.value):null;}
  sync(){if(this.running)return this.running;this.running=this.run().finally(()=>{this.running=null;});return this.running;}
  async run(){
    for(const op of [...this.state.queue]){
      if(Object.hasOwn(this.state.conflicts,op.id))continue;
      const result=await this.request('/write',op);
      if(!result.ok){this.state.conflicts[op.id]=result.conflict;this.save();continue;}
      this.state.records[op.id]=result.record;
      this.state.queue=this.state.queue.filter(x=>x.op!==op.op);this.save();
    }
    const changes=await this.request('/pull?after='+this.state.cursor);
    const blocked=new Set(this.state.queue.map(x=>x.id));
    for(const record of changes.records)if(!blocked.has(record.id)&&(this.state.records[record.id]?.revision||0)<record.revision){
      await this.applyRecord(this.state.records[record.id],record);
      this.state.records[record.id]=record;this.save();
    }
    // A device only acknowledges a complete durable application, not receipt of a response.
    if(!blocked.size){this.state.cursor=changes.head;this.save();await this.request('/ack',{device:this.state.device,seq:this.state.cursor});}
    else this.save();
    return {pending:this.state.queue.length,conflicts:Object.keys(this.state.conflicts),serverHead:changes.head,appliedThrough:this.state.cursor};
  }
  resolve(id,choice){
    if(this.running)throw new Error('Wait until synchronization finishes');
    if(!Object.hasOwn(this.state.conflicts,id)||!['local','remote'].includes(choice))throw new Error('Explicit conflict choice required');
    const current=this.state.conflicts[id],latest=this.state.queue.findLast(x=>x.id===id);
    this.state.queue=this.state.queue.filter(x=>x.id!==id);
    // Keep the last applied revision: the next pull must apply the selected remote record.
    if(choice==='local'&&current)this.state.records[id]=current;
    delete this.state.conflicts[id];
    if(choice==='local')this.state.queue.push({...latest,op:randomUUID(),base:current?.revision||0});
    this.save();
  }
}
module.exports={Client};
