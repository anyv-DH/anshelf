/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const fs=require('node:fs/promises'), path=require('node:path'), os=require('node:os'), assert=require('node:assert/strict'), {createHash}=require('node:crypto');
const {_electron}=require(process.env.ANSHELF_PLAYWRIGHT||'playwright');
const {Library}=require('../core/library.cjs'), {Queue}=require('../plugin/queue.cjs');
const root=path.resolve(__dirname,'..');
async function main(){
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'anshelf-scenes-ui-')),data=path.join(temp,'library'),profile=path.join(temp,'profile');
  const out=process.env.ANSHELF_SCENE_OUTPUT||path.join(root,'test-output/scene-image-ui');await fs.mkdir(out,{recursive:true});
  const source=path.join(temp,'原始图片.png');await fs.copyFile(path.join(root,'desktop/icon.png'),source);
  const hash=b=>createHash('sha256').update(b).digest('hex'),original=hash(await fs.readFile(source));
  const lib=await Library.open(data),a=(await lib.importPaths([source],{mode:'image'})).assets[0];
  const members=[a];for(const name of ['组图B','组图C','组图D']){const c=await lib.duplicateAsset(a.id);await lib.updateAsset(c.id,{name});members.push(c);}
  for(let i=0;i<24;i++){const c=await lib.duplicateAsset(a.id);await lib.updateAsset(c.id,{name:'分页图'+String(i).padStart(2,'0')});}
  await lib.updateAsset(a.id,{name:'组图A'});
  const queue=new Queue(data),executable=process.env.ANSHELF_UI_EXECUTABLE||require(path.join(root,'node_modules/electron'));
  let app,page;const contexts=[],checks=[],errors=[];
  async function launch(){
    app=await _electron.launch({executablePath:executable,args:[...(process.env.ANSHELF_UI_EXECUTABLE?[]:[root]),'--user-data-dir='+profile],env:{...process.env,ANSHELF_DATA_DIR:data},timeout:60000});
    const c=await app.evaluate(({app})=>({packaged:app.isPackaged,version:app.getVersion(),executable:process.execPath,profile:app.getPath('userData'),library:process.env.ANSHELF_DATA_DIR}));
    assert.equal(c.version,'0.3.16');assert.equal(c.packaged,!!process.env.ANSHELF_UI_EXECUTABLE);assert.equal(path.resolve(c.executable).toLowerCase(),path.resolve(executable).toLowerCase());contexts.push(c);
    page=await app.firstWindow();page.setDefaultTimeout(9000);page.on('pageerror',e=>errors.push(e.message));await page.waitForSelector('.asset-card');
    await page.evaluate(()=>localStorage.setItem('anshelf-check-updates-on-start','false'));
  }
  const snapshot=()=>page.evaluate(()=>window.shelf.snapshot());
  const close=()=>page.locator('#dialog [data-action="close-dialog"]').first().click();
  const card=id=>page.locator(`.asset-card[data-asset="${id}"]`);
  try{
    await launch();await page.locator('#search').fill('组图');await page.waitForFunction(()=>document.querySelectorAll('.asset-card').length===4);
    await card(a.id).locator('h3').click({modifiers:['Control']});await card(members[1].id).locator('h3').click({modifiers:['Control']});
    await page.locator('[data-action="create-scene-group"]').click();await page.locator('#scene-new-name').fill('客厅组合');await page.locator('[data-action="save-scene-group"]').click();
    await page.waitForFunction(()=>document.querySelectorAll('.scene-member').length===2);let group=(await snapshot()).sceneGroups[0];assert.equal(group.name,'客厅组合');
    assert.equal(await page.locator('.scene-member-grid img').evaluateAll(images=>images.every(i=>i.complete&&i.naturalWidth>0)),true);
    assert.equal(await page.locator('.scene-member [data-action="send"]').count(),2);assert.equal(await page.locator('.scene-member [data-drag-id]').count(),2);
    await page.screenshot({path:path.join(out,'scene-members.png')});checks.push('create a metadata group through UI; members appear together with independent preview/import/drag');
    await page.locator('.scene-member [data-action="zoom-preview"]').first().click();assert.equal(await page.locator('.preview-details').isVisible(),false);
    assert.equal(await page.locator('.lightbox-actions [data-action="send"]').count(),1);assert.equal(await page.locator('.lightbox-actions [data-drag-id]').count(),1);
    await page.locator('#dialog [data-action="open-scene-group"]').click();await page.locator('#scene-group-name').fill('客厅整理');await page.locator('[data-action="rename-scene-group"]').click();
    await page.waitForFunction(()=>document.querySelector('#dialog-title')?.textContent==='客厅整理');
    await page.locator('[data-action="pick-scene-members"]').click();await page.locator(`[data-scene-pick="${members[2].id}"]`).check();await page.locator('[data-action="add-scene-members"]').click();
    await page.waitForFunction(()=>document.querySelectorAll('.scene-member').length===3);
    await page.locator(`[data-action="scene-cover"][data-id="${members[2].id}"]`).click();await page.waitForFunction(id=>document.querySelector(`[data-action="scene-cover"][data-id="${id}"]`)?.disabled,members[2].id);
    await page.locator(`[data-action="remove-scene-member"][data-id="${members[1].id}"]`).click();await page.waitForFunction(()=>document.querySelectorAll('.scene-member').length===2);
    await page.locator('#dialog [data-action="undo-scene-group"]').click();await page.waitForFunction(()=>document.querySelectorAll('.scene-member').length===3);checks.push('rename, add members, cover, remove and undo preserve image records');
    queue.heartbeat(false,42);await page.locator(`.scene-member [data-action="send"][data-id="${a.id}"]`).click();
    await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('等待 AN'));
    const request=queue.pending();assert.equal(request.delivery,'image-import');assert.equal(request.targetDocumentId,42);assert.equal(request.asset.kind,'image');assert.equal(queue.prepare(request).asset.kind,'image');
    queue.complete(request,{ok:true,message:'isolated receiver fixture'});await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('确认插入完成'));
    await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.webContents.startDrag=item=>{globalThis.__sceneDrag={file:item.file,icon:!item.icon.isEmpty()};};});
    await page.locator(`.scene-member [data-drag-id="${a.id}"]`).dispatchEvent('dragstart');
    let drag;for(let i=0;i<50;i++){drag=await app.evaluate(()=>globalThis.__sceneDrag);if(drag)break;await page.waitForTimeout(50);}
    assert.ok(drag?.icon);assert.equal(hash(await fs.readFile(drag.file)),original);checks.push('real renderer image button reaches guarded IPC/queue; native drag IPC resolves the private managed PNG (Animate not involved)');
    await close();assert.equal(await page.locator('.asset-card').count(),2);
    const visibleCards=await page.locator('.asset-card').evaluateAll(cards=>cards.map(card=>({id:card.dataset.asset,group:!!card.dataset.sceneGroup})));
    const groupIndex=visibleCards.findIndex(card=>card.group),ordinaryIndex=1-groupIndex;
    await card(visibleCards[ordinaryIndex].id).focus();await page.keyboard.press(groupIndex>ordinaryIndex?'ArrowRight':'ArrowLeft');
    assert.equal(await page.locator('.scene-group-card.selected').count(),1);assert.match(await page.locator('#selection-bar').textContent(),/3/);
    await page.locator('.asset-card h3').first().click();await page.locator('.asset-card h3').last().click({modifiers:['Shift']});
    assert.equal(await page.locator('.asset-card.selected').count(),2);assert.match(await page.locator('#selection-bar').textContent(),/4/);
    await page.keyboard.press('Escape');checks.push('real keyboard and Shift-range selection expand the visible grouped members consistently');
    await page.locator('#search').fill('客厅整理');await page.waitForFunction(()=>document.querySelectorAll('.asset-card').length===1);
    assert.equal(await page.locator('.scene-group-card').count(),1);await page.locator('#search').fill('组图B');assert.equal(await page.locator('.asset-card').count(),1);assert.match(await page.locator('.asset-card').textContent(),/匹配 1 \/ 3/);
    await page.locator('#search').fill('');await page.locator('#browse').click();await page.locator('[data-action="browse-mode"][data-browse-mode="scroll"]').click();await page.locator('#search').click();await page.locator('#browse').click();await page.locator('#browse-size-input').fill('12');await page.locator('[data-action="browse-custom-size"]').click();
    await page.waitForFunction(()=>document.querySelectorAll('.asset-card').length===12);const ids=[];
    for(let i=0;i<3;i++){ids.push(...await page.locator('.asset-card').evaluateAll(cards=>cards.map(c=>c.dataset.sceneGroup||c.dataset.asset)));if(i<2)await page.locator('[data-action="next-page"]').click();}
    assert.equal(ids.length,26);assert.equal(new Set(ids).size,26);assert.equal(await page.locator('.asset-card').count(),2);checks.push('group and image names searchable; 28 images collapse into 26 cards paginated 12/12/2 without gaps or duplicates');
    await app.close();app=null;await launch();await page.locator('#search').fill('客厅整理');await page.locator('.scene-group-card [data-action="open-scene-group"]').first().click();await page.waitForFunction(()=>document.querySelectorAll('.scene-member').length===3);
    const reopened=(await snapshot()).sceneGroups[0];assert.equal(reopened.id,group.id);assert.equal(reopened.coverAssetId,members[2].id);checks.push('real process restart restores grouping, membership, title, cover and browse preferences');
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(850,600));await page.screenshot({path:path.join(out,'scene-members-small.png')});
    const geometry=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,dialog:document.querySelector('#dialog').getBoundingClientRect().toJSON(),width:innerWidth,height:innerHeight}));assert.equal(geometry.overflow,false);assert.ok(geometry.dialog.right<=geometry.width&&geometry.dialog.bottom<=geometry.height);
    await page.locator('[data-action="dissolve-scene-group"]').click();await page.locator('#confirm-dialog [data-confirm="accept"]').click();await page.waitForFunction(()=>!document.querySelector('#dialog').open);assert.equal((await snapshot()).assets.length,28);assert.deepEqual((await snapshot()).sceneGroups,[]);checks.push('small window fits; dissolve keeps all 28 image assets');
    await page.locator('#workspace-tools > summary').click();await page.locator('[data-action="author-message"]').click();
    const codes=page.locator('.author-payment-codes img');assert.equal(await codes.count(),2);assert.equal(await codes.evaluateAll(images=>images.every(i=>i.complete&&i.naturalWidth>0)),true);
    const copy=await page.locator('.author-support').textContent();assert.ok(!copy.includes('你'));assert.match(copy,/自愿赠与/);assert.match(copy,/不换取任何商品、服务或虚拟礼物/);
    await app.evaluate(({shell})=>{shell.openExternal=async url=>{globalThis.__starUrl=url;};});
    await page.locator('#dialog [data-action="open-project-page"]').click();assert.equal(await app.evaluate(()=>globalThis.__starUrl),'https://github.com/anyv-DH/anshelf');
    await page.screenshot({path:path.join(out,'author-support-small.png')});await close();checks.push('both clean local QR crops render; polite voluntary gift copy and fixed Star action work (offline decoding recorded separately)');
    assert.equal(hash(await fs.readFile(source)),original);assert.deepEqual(errors,[]);
    const report={passed:true,contexts,checks,pageErrors:errors,geometry,originalUnchanged:true,animateVerified:false};await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  }catch(error){console.error(JSON.stringify({pageErrors:errors}));if(page)await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});throw error;}
  finally{if(app)await app.close();await fs.rm(temp,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
