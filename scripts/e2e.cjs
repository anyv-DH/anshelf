/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const path=require('node:path');const fs=require('node:fs/promises');const os=require('node:os');const assert=require('node:assert/strict');
const playwright=require(process.env.ANSHELF_PLAYWRIGHT||'playwright');
async function run(){
  const root=path.resolve(__dirname,'..');const data=await fs.mkdtemp(path.join(os.tmpdir(),'anshelf-e2e-'));const out=path.join(root,'test-output');await fs.mkdir(out,{recursive:true});
  const app=await playwright._electron.launch({executablePath:require('electron'),args:[root],env:{...process.env,ANSHELF_DATA_DIR:data},timeout:60000});
  const errors=[];
  try{
    const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(()=>window.shelf&&document.querySelector('#app,main'));
    await page.screenshot({path:path.join(out,'01-empty.png')});
    const imported=await page.evaluate(()=>window.shelf.demo());assert.equal(imported.added,6);
    let state;
    for(let tick=0;tick<300;tick++){state=await page.evaluate(()=>window.shelf.snapshot());if(state.assets.length===6&&state.assets.every(a=>a.previewStatus!=='pending')&&!state.queue.active)break;await page.waitForTimeout(300);}
    assert.equal(state.assets.length,6);
    const failed=state.assets.filter(a=>a.previewStatus!=='ready');assert.deepEqual(failed.map(a=>({name:a.name,status:a.previewStatus,error:a.previewError})),[], 'all FLA demo fixtures render');
    const result=await page.evaluate(async()=>{const s=await window.shelf.snapshot();await window.shelf.assignCategory(s.assets.slice(0,2).map(a=>a.id),s.categories[0].id);return window.shelf.snapshot();});
    assert.equal(result.assets.filter(a=>a.categoryId===result.categories[0].id).length,2);
    await page.evaluate(()=>window.shelf.undo());
    const restored=await page.evaluate(()=>window.shelf.snapshot());assert.equal(restored.assets.filter(a=>a.categoryId).length,0);
    const sent=await page.evaluate(async()=>{const s=await window.shelf.snapshot();await window.shelf.send(s.assets[0].id);return window.shelf.status();});assert.equal(sent.connected,false);assert.ok(sent.pending);
    await page.waitForTimeout(1800);await page.screenshot({path:path.join(out,'02-library.png'),fullPage:true});
    assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,assets:state.assets.length,previews:state.assets.length,errors,screenshot:path.join(out,'02-library.png'),data},null,2));
  }finally{await app.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
