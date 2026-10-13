/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const path=require('node:path');const fs=require('node:fs/promises');
const {createHost}=require('./host.cjs');const {createServer}=require('./server.cjs');const {createBrowserRenderer}=require('./browser-render.cjs');
const {chromium}=require(process.env.ANSHELF_PLAYWRIGHT||'playwright');
async function start(){
  const root=process.env.ANSHELF_DATA_DIR||path.resolve(__dirname,'../data');let url,browser;
  const getBrowser=async()=>browser||(browser=await chromium.launch({headless:true}));
  const host=await createHost({root,render:createBrowserRenderer(root,getBrowser,()=>url),previewUrl:id=>`/preview/${id}`});
  const running=await createServer(host,{port:Number(process.env.PORT||4317),allowImportPaths:true});url=running.url;console.log(url);
  const close=async()=>{running.server.close();if(browser)await browser.close();};process.on('SIGINT',async()=>{await close();process.exit();});
}
start().catch(error=>{console.error(error);process.exitCode=1;});
