/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const fs=require('node:fs/promises');const path=require('node:path');
function createBrowserRenderer(root,getBrowser,getUrl){return async asset=>{
  const browser=await getBrowser();const page=await browser.newPage({viewport:{width:1280,height:1280}});
  try{
    await page.goto(getUrl()+'/worker.html');const bytes=Array.from(await fs.readFile(path.resolve(root,asset.managedPath)));
    const result=await page.evaluate(input=>window.renderPreview(input),bytes);
    if(!result.png)throw new Error('预览结果无效');const previewPath=`previews/${asset.id}.png`;await fs.mkdir(path.join(root,'previews'),{recursive:true});await fs.writeFile(path.join(root,previewPath),Buffer.from(result.png.split(',')[1],'base64'));
    return{previewPath,width:result.width,height:result.height,frames:result.frames};
  }finally{await page.close();}
};}
module.exports={createBrowserRenderer};
