/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {createHost}=require('../desktop/host.cjs');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6HAAAAABJRU5ErkJggg==','base64');
async function fixture(t,extra={}){
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'anshelf-image-host-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
  const source=path.join(base,'picture.png');await fs.writeFile(source,png);
  const renders=[],revealed=[],opened=[];
  const host=await createHost({root:path.join(base,'library'),render:async asset=>{renders.push(asset.id);throw new Error('unexpected FLA renderer');},revealFile:async file=>revealed.push(file),openInAnimate:async file=>opened.push(file),...extra});
  t.after(()=>host.close());return{base,source,host,renders,revealed,opened};
}
test('image imports stay ready without FLA work and duplicate into a chosen category',async t=>{
  const f=await fixture(t),{host,source}=f;
  const original=(await host.api.importPaths([source],{mode:'image'})).assets[0];
  await host.queue.idle();assert.deepEqual(f.renders,[]);
  const snapshot=await host.api.snapshot();assert.match(snapshot.assets[0].previewUrl,/anshelf:\/\/preview\//);
  const managed=host.library.assetPath(original.id);
  const reimport=await host.api.importPaths([managed],{mode:'image'});assert.equal(reimport.added,0);
  const category=host.library.snapshot().categories.find(item=>item.systemKey==='scene');
  const copied=await host.api.duplicateInFolder(original.id,{categoryId:category.id});
  assert.equal(copied.cancelled,false);assert.equal(host.library.getAsset(copied.assetId).categoryId,category.id);
  assert.equal(host.library.getAsset(original.id).categoryId,null);assert.deepEqual(await fs.readFile(source),png);
  await host.api.revealInFolder(original.id);assert.equal(f.revealed.at(-1),source);
  await fs.rm(source);await host.api.revealInFolder(original.id);assert.equal(f.revealed.at(-1),managed);
  assert.deepEqual(f.renders,[]);
});
test('image actions guard disconnected import and FLA-only paths, permit native image dragging',async t=>{
  const {host,source,renders,opened}=await fixture(t);
  const asset=(await host.api.importPaths([source],{mode:'image'})).assets[0];
  const before=JSON.stringify(host.library.getAsset(asset.id));
  for(const [method,args] of [['openInAnimate',[]],['sendStageDrop',[{}]],['retryPreview',[]],['replacePreview',[]],['restorePreview',[]]]){
    await assert.rejects(host.api[method](asset.id,...args),/图片|FLA|音频/);
    assert.equal(JSON.stringify(host.library.getAsset(asset.id)),before,method);
  }
  await assert.rejects(host.api.send(asset.id),/AN|连接/);
  assert.deepEqual(await host.api.prepareDrag(asset.id),{file:host.library.assetPath(asset.id),kind:'image'});
  await host.queue.idle();assert.deepEqual(renders,[]);assert.deepEqual(opened,[]);
});
test('image import and scene group methods are exposed by the host and preload whitelist',async t=>{
  const {host,source}=await fixture(t);
  const a=(await host.api.importPaths([source],{mode:'image'})).assets[0],b=await host.library.duplicateAsset(a.id);
  const group=await host.api.createSceneGroup('客厅',[a.id,b.id]);
  assert.equal((await host.api.snapshot()).sceneGroups[0].id,group.id);
  await host.api.updateSceneGroup(group.id,{name:'房间'});
  assert.equal((await host.api.snapshot()).sceneGroups[0].name,'房间');
  host.bridge.status();await fs.writeFile(path.join(host.root,'bridge/status.json'),JSON.stringify({version:1,updatedAt:Date.now(),busy:false,documentId:42,capabilities:{directSource:1,imageImport:1}}));
  assert.equal((await host.api.send(a.id)).delivery,'image-import');
  await host.api.deleteSceneGroup(group.id);assert.deepEqual((await host.api.snapshot()).sceneGroups,[]);
  const preload=await fs.readFile(path.join(__dirname,'../desktop/preload.cjs'),'utf8');
  for(const method of ['createSceneGroup','updateSceneGroup','deleteSceneGroup'])assert.ok(preload.includes("'"+method+"'"));
});
test('image copy validates target before confirmation and cancellation is read only',async t=>{
  let confirmations=0,allow=false;
  const {host,source}=await fixture(t,{confirmDuplicate:async()=>{confirmations++;return allow;}});
  const original=(await host.api.importPaths([source],{mode:'image'})).assets[0];
  const before=JSON.stringify(host.library.snapshot());
  await assert.rejects(host.api.duplicateInFolder(original.id,{categoryId:'missing'}),/分类/);
  assert.equal(confirmations,0);
  const effect=host.library.snapshot().categories.find(item=>item.systemKey==='effect');
  await assert.rejects(host.api.duplicateInFolder(original.id,{categoryId:effect.id}),/分类|类型/);
  const result=await host.api.duplicateInFolder(original.id,{categoryId:null});assert.equal(result.cancelled,true);
  assert.equal(JSON.stringify(host.library.snapshot()),before);
  allow=true;const copy=await host.api.duplicateInFolder(original.id,{categoryId:null});assert.equal(host.library.getAsset(copy.assetId).categoryId,null);
});
