/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const http=require('node:http');const fs=require('node:fs/promises');const path=require('node:path');
const MIME={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml'};
async function createServer(host,{port=0,allowImportPaths=false}={}){
  const server=http.createServer(async(req,res)=>{
    try{
      if(req.headers.origin && !/^http:\/\/127\.0\.0\.1:\d+$/.test(req.headers.origin))throw new Error('来源不允许');
      const url=new URL(req.url,'http://127.0.0.1');
      if(req.method==='POST'&&url.pathname.startsWith('/api/')){
        const method=url.pathname.slice(5);if(!Object.hasOwn(host.api,method)||(!allowImportPaths&&method==='importPaths'))throw new Error('操作不允许');
        let body='';for await(const chunk of req){body+=chunk;if(body.length>2*1024*1024)throw new Error('请求过大');}
        const args=JSON.parse(body||'[]');if(!Array.isArray(args))throw new Error('参数无效');
        const result=await host.api[method](...args);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result??null));return;
      }
      let file;
      if(url.pathname.startsWith('/preview/')){const id=decodeURIComponent(url.pathname.slice(9));file=host.library.previewPath(id);}
      else{const relative=decodeURIComponent(url.pathname==='/'?'index.html':url.pathname.slice(1));const base=path.resolve(__dirname,'../dist');file=path.resolve(base,relative);if(path.relative(base,file).startsWith('..')||path.isAbsolute(path.relative(base,file)))throw new Error('路径不允许');}
      if(!file){res.writeHead(404);res.end();return;}
      const data=await fs.readFile(file);res.writeHead(200,{'content-type':MIME[path.extname(file).toLowerCase()]||'application/octet-stream','cache-control':'no-cache','x-content-type-options':'nosniff'});res.end(data);
    }catch(error){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:error.message}));}
  });
  await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));return{server,url:`http://127.0.0.1:${server.address().port}`};
}
module.exports={createServer};
