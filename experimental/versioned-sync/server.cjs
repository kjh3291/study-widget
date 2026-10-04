const http=require('node:http');
const {Store}=require('./store.cjs');
async function start({filename,token}) {
  if(!token||token.length<24)throw new Error('A private test token is required');
  const store=new Store(filename);
  const server=http.createServer(async(req,res)=>{
    const reply=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
    if(req.headers.authorization!==`Bearer ${token}`)return reply(401,{error:'Unauthorized'});
    try {
      let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>1024*1024)return reply(413,{error:'Too large'});}
      const input=body?JSON.parse(body):{},url=new URL(req.url,'http://localhost');
      if(req.method==='POST'&&url.pathname==='/write')return reply(200,store.apply(input));
      if(req.method==='GET'&&url.pathname==='/pull')return reply(200,store.pull(Number(url.searchParams.get('after')||0)));
      if(req.method==='GET'&&url.pathname==='/history')return reply(200,store.history(url.searchParams.get('id')));
      if(req.method==='POST'&&url.pathname==='/ack'){store.ack(input.device,input.seq);return reply(200,{ok:true});}
      if(req.method==='GET'&&url.pathname==='/status')return reply(200,store.status());
      reply(404,{error:'Not found'});
    }catch(e){reply(400,{error:e.message});}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(resolve=>server.close(()=>{store.close();resolve();}))};
}
module.exports={start};
