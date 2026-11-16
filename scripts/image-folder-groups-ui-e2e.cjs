/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto'),{deflateSync}=require('node:zlib');
const {_electron}=require(process.env.ANSHELF_PLAYWRIGHT||'playwright');
const root=path.resolve(__dirname,'..'),hash=b=>createHash('sha256').update(b).digest('hex');
function png(seed){
  function chunk(type,data){const bytes=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;for(const b of bytes){crc^=b;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}const prefix=Buffer.alloc(4),suffix=Buffer.alloc(4);prefix.writeUInt32BE(data.length);suffix.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([prefix,bytes,suffix]);}
  const header=Buffer.alloc(13);header.writeUInt32BE(2,0);header.writeUInt32BE(2,4);header[8]=8;header[9]=6;
  const row=Buffer.from([0,seed,80,120,255,seed,80,120,255]);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.concat([row,row]))),chunk('IEND',Buffer.alloc(0))]);
}
async function main(){
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'anshelf-folder-groups-ui-')),data=path.join(temp,'library'),profile=path.join(temp,'profile');
  const out=process.env.ANSHELF_FOLDER_GROUP_OUTPUT||path.join(root,'test-output/image-folder-groups-ui');await fs.mkdir(out,{recursive:true});
  const folder=path.join(temp,'剧集素材'),originals=new Map();let seed=1;
  async function imageFile(relative){const file=path.join(temp,relative);await fs.mkdir(path.dirname(file),{recursive:true});const bytes=png(seed++);await fs.writeFile(file,bytes);originals.set(file,hash(bytes));return file;}
  for(const relative of ['剧集素材/总览.png','剧集素材/客厅/正面.png','剧集素材/客厅/侧面.png','剧集素材/客厅/夜景/月色.png','剧集素材/卧室/正面.png','剧集素材/卧室/侧面.png'])await imageFile(relative);
  await fs.mkdir(path.join(folder,'空文件夹'));await fs.writeFile(path.join(folder,'说明.txt'),'non-image');
  const contexts=[],checks=[],errors=[];let app,page;
  async function launch(){
    const executable=process.env.ANSHELF_UI_EXECUTABLE||require(path.join(root,'node_modules/electron'));
    app=await _electron.launch({executablePath:executable,args:[...(process.env.ANSHELF_UI_EXECUTABLE?[]:[root]),'--user-data-dir='+profile],env:{...process.env,ANSHELF_DATA_DIR:data},timeout:60000});
    const context=await app.evaluate(({app})=>({version:app.getVersion(),packaged:app.isPackaged,executable:process.execPath,profile:app.getPath('userData'),library:process.env.ANSHELF_DATA_DIR}));
    assert.equal(context.version,'0.3.16');assert.equal(context.packaged,!!process.env.ANSHELF_UI_EXECUTABLE);assert.equal(path.resolve(context.executable).toLowerCase(),path.resolve(executable).toLowerCase());contexts.push(context);
    page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));await page.waitForSelector('.import-entries [data-action="import"]');
    await page.evaluate(()=>localStorage.setItem('anshelf-check-updates-on-start','false'));
  }
  const snapshot=()=>page.evaluate(()=>window.shelf.snapshot());
  async function pick(directory){
    await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},directory);
    await page.locator('.import-entries [data-action="import"]').click();await page.locator('[data-action="import-select-type"][data-mode="image"]').click();await page.locator('[data-action="select-import-folder"]').click();
    await page.locator('#import-group-by-folder').waitFor();assert.equal(await page.locator('#import-group-by-folder').isChecked(),false);
  }
  async function confirm(group=true){if(group)await page.locator('#import-group-by-folder').check();await page.locator('[data-action="confirm-import"]').click();await page.waitForFunction(()=>!document.querySelector('#dialog').open);}
  function membersByFolder(s){return Object.fromEntries(s.sceneGroups.map(g=>[g.name,g.assetIds.map(id=>s.assets.find(a=>a.id===id).originalName).sort()]));}
  try{
    await launch();await pick(folder);assert.equal((await snapshot()).assets.length,0);
    await page.locator('#import-group-by-folder').check();await page.locator('[data-action="import-create-category"]').click();await page.locator('#import-folder-name').fill('按目录导入');await page.locator('[data-action="save-import-folder"]').click();
    await page.locator('#import-group-by-folder').waitFor();assert.equal(await page.locator('#import-group-by-folder').isChecked(),true);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(850,600));await page.screenshot({path:path.join(out,'folder-option-small.png')});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1480,940));
    await confirm();let s=await snapshot();assert.equal(s.assets.length,6);assert.equal(s.sceneGroups.length,4);
    assert.deepEqual(membersByFolder(s),{'剧集素材':['总览.png'],'客厅':['侧面.png','正面.png'],'夜景':['月色.png'],'卧室':['侧面.png','正面.png']});
    const category=s.categories.find(c=>c.name==='按目录导入');assert.ok(s.assets.every(a=>a.categoryIds.includes(category.id)));
    assert.equal(await page.locator('.scene-group-card').count(),4);await page.screenshot({path:path.join(out,'nested-folder-groups.png')});
    const living=s.sceneGroups.find(g=>g.name==='客厅');await page.locator(`.scene-group-card[data-scene-group="${living.id}"] [data-action="open-scene-group"]`).first().click();assert.equal(await page.locator('.scene-member').count(),2);await page.locator('#dialog [data-action="close-dialog"]').first().click();
    checks.push('real folder picker stages nested images, retains grouping during category creation, creates four immediate-parent groups including singletons without ancestor flattening');
    const ids=s.sceneGroups.map(g=>g.id).sort();await pick(folder);await confirm();s=await snapshot();assert.equal(s.assets.length,6);assert.deepEqual(s.sceneGroups.map(g=>g.id).sort(),ids);
    await imageFile('剧集素材/客厅/后侧.png');await pick(folder);await confirm();s=await snapshot();assert.equal(s.assets.length,7);assert.equal(s.sceneGroups.find(g=>g.id===living.id).assetIds.length,3);checks.push('reimport is idempotent; a new image updates only its original immediate-parent group');
    const independent=path.join(temp,'散图');await imageFile('散图/一.png');await imageFile('散图/二.png');await pick(independent);await confirm(false);s=await snapshot();assert.equal(s.assets.length,9);assert.equal(s.sceneGroups.length,4);checks.push('unchecked option imports ordinary independent images');
    const dragged=[await imageFile('拖入/街道/正面.png'),await imageFile('拖入/街道/侧面.png')];
    await page.evaluate(()=>{const input=document.createElement('input');input.type='file';input.multiple=true;input.id='folder-drop-fixture';document.body.append(input);});await page.locator('#folder-drop-fixture').setInputFiles(dragged);
    await page.locator('#folder-drop-fixture').evaluate(input=>{const transfer=new DataTransfer();for(const file of input.files)transfer.items.add(file);document.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));input.remove();});
    await page.locator('#import-group-by-folder').waitFor();assert.equal((await snapshot()).assets.length,9);await confirm();s=await snapshot();assert.equal(s.assets.length,11);assert.equal(s.sceneGroups.find(g=>g.name==='街道').assetIds.length,2);checks.push('native File drop stages without import button and groups by trusted actual source folder after confirmation');
    const before=s.sceneGroups;await app.close();app=null;await launch();s=await snapshot();assert.deepEqual(s.sceneGroups,before);for(const [file,sha]of originals)assert.equal(hash(await fs.readFile(file)),sha);assert.deepEqual(errors,[]);checks.push('real restart preserves all groups; source files remain byte-identical; zero page errors');
    const report={passed:true,contexts,checks,pageErrors:errors,sourceFilesUnchanged:originals.size,animateVerified:false};await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }catch(error){if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});console.error(JSON.stringify({pageErrors:errors}));throw error;}
  finally{if(app)await app.close();await fs.rm(temp,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
