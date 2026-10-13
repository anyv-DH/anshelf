/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {Library,normalizePreviewResolution}=require('../core/library.cjs');

test('preview resolution accepts default and 2K values and persists selected generated preference',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'anshelf-resolution-')); t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const source=path.join(base,'asset.fla'); await fs.writeFile(source,'fla');
 const library=await Library.open(path.join(base,'library'));
 const added=await library.importPaths([source],{previewResolution:2048});
 assert.equal(added.assets[0].previewResolution,2048);
 assert.equal(library.getAsset(added.assets[0].id).previewResolution,2048);
 assert.equal(normalizePreviewResolution(null),null);
 assert.equal(normalizePreviewResolution(2048),2048);
 for(const value of [0,128,4096,'2048',{},true]) assert.throws(()=>normalizePreviewResolution(value),/分辨率/);
});

test('changing generated resolution invalidates preview while sidecar remains untouched',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'anshelf-resolution-sidecar-')); t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const source=path.join(base,'asset.fla'); await fs.writeFile(source,'fla');
 const library=await Library.open(path.join(base,'library'));
 const first=(await library.importPaths([source],{previewResolution:256})).assets[0];
 await library.setPreview(first.id,{previewStatus:'ready',previewOrigin:'rendered',previewPath:'previews/generated.png'});
 const changed=(await library.importPaths([source],{previewResolution:2048})).assets[0];
 assert.equal(changed.previewStatus,'pending'); assert.equal(changed.previewPath,null); assert.equal(changed.previewResolution,2048);
 const sidecar=path.join(base,'asset.png'); await fs.writeFile(sidecar,'sidecar');
 const reused=(await library.importPaths([source],{previewResolution:256,preferExistingPreview:true})).assets[0];
 assert.equal(reused.previewStatus,'ready'); assert.equal(reused.previewOrigin,'sidecar'); assert.equal(reused.previewPath.includes('sidecar'),true); assert.equal(reused.previewResolution,256);
});

test('invalid resolution fails before files copy and legacy records default safely',async t=>{
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'anshelf-resolution-invalid-')); t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const source=path.join(base,'asset.fla'); await fs.writeFile(source,'fla');
 const root=path.join(base,'library'); const library=await Library.open(root);
 for(const previewResolution of [0,128,4096,'2048',{},true]) await assert.rejects(library.importPaths([source],{previewResolution}),/分辨率/);
 assert.equal(library.snapshot().assets.length,0);
 const asset=(await library.importPaths([source])).assets[0];
 const state=JSON.parse(await fs.readFile(path.join(root,'library.json'),'utf8')); delete state.assets[0].previewResolution;
 await fs.writeFile(path.join(root,'library.json'),JSON.stringify(state));
 assert.equal((await Library.open(root)).getAsset(asset.id).previewResolution,null);
});

test('resolution change during host rendering discards old output and queues selected setting',async t=>{
 const {createHost}=require('../desktop/host.cjs');
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'anshelf-resolution-host-')); t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const source=path.join(base,'asset.fla'); await fs.writeFile(source,'fla');
 let entered,release; const started=new Promise(resolve=>{entered=resolve}); const gate=new Promise(resolve=>{release=resolve});
 const sizes=[];
 const host=await createHost({root:path.join(base,'library'),render:async a=>{sizes.push(a.previewResolution);if(sizes.length===1){entered();await gate;}return {previewPath:`previews/${a.previewResolution}.png`};},pickFiles:async()=>[source]});
 await host.api.importFiles({previewResolution:256}); await started;
 await host.api.importFiles({previewResolution:2048}); release(); await host.queue.idle();
 assert.deepEqual(sizes,[256,2048]); assert.equal(host.library.snapshot().assets[0].previewPath,'previews/2048.png');
});
