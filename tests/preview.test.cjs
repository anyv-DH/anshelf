/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { PreviewQueue } = require('../core/preview.cjs');

test('preview queue serializes render and continues after failure', async () => {
  const records = [{ id:'bad',previewStatus:'pending' }, {id:'good',previewStatus:'pending'}];
  const saved = [];
  const library = { getAsset:id=>records.find(a=>a.id===id), setPreview:async(id,p)=>{saved.push({id,...p}); Object.assign(records.find(a=>a.id===id),p);} };
  let active = 0, peak = 0;
  const queue = new PreviewQueue(library, async asset => {
    peak=Math.max(peak,++active);
    await new Promise(resolve=>setTimeout(resolve,10)); active--;
    if(asset.id==='bad') throw new Error('无法解析');
    return {previewPath:'previews/good.png',width:512,height:512,frames:2};
  });
  queue.add(records); await queue.idle();
  assert.equal(peak,1); assert.equal(records[0].previewStatus,'failed');
  assert.equal(records[1].previewStatus,'ready'); assert.equal(records[1].previewOrigin,'rendered');
  assert.match(saved[0].previewError,/无法解析/);
});
test('ready sidecar skips rendering, retry renders failed item', async () => {
  const records=[{id:'ready',previewStatus:'ready'},{id:'retry',previewStatus:'failed'}]; let calls=0;
  const library={getAsset:id=>records.find(a=>a.id===id),setPreview:async(id,p)=>Object.assign(records.find(a=>a.id===id),p)};
  const queue=new PreviewQueue(library,async()=>{calls++;return{previewPath:'x.png'};});
  queue.add(records);await queue.idle();assert.equal(calls,0);
  queue.add([records[1]],true);await queue.idle();assert.equal(calls,1);assert.equal(records[1].previewStatus,'ready');
});

test('continues after an asset is removed while its preview is rendering', async () => {
  const records=[{id:'removed',previewStatus:'pending'},{id:'good',previewStatus:'pending'}];
  let started; let release;
  const rendering= new Promise(resolve=>{started=resolve});
  const gate=new Promise(resolve=>{release=resolve});
  const library={
    getAsset:id=>records.find(asset=>asset.id===id),
    setPreview:async(id,patch)=>{
      const asset=records.find(item=>item.id===id);
      if(!asset) throw new Error('素材已删除');
      Object.assign(asset,patch);
    },
  };
  const queue=new PreviewQueue(library,async asset=>{
    if(asset.id==='removed'){started();await gate;}
    return {previewPath:`previews/${asset.id}.png`};
  });
  queue.add(records);
  await rendering;
  records.splice(0,1);
  release();
  await queue.idle();
  assert.equal(records[0].id,'good');
  assert.equal(records[0].previewStatus,'ready');
  assert.deepEqual(queue.snapshot(),{pending:0,active:null});
});

test('continues when preview metadata persistence fails for one item', async () => {
  const records=[{id:'broken-write',previewStatus:'pending'},{id:'good',previewStatus:'pending'}];
  const attempts=[];
  const library={
    getAsset:id=>records.find(asset=>asset.id===id),
    setPreview:async(id,patch)=>{
      attempts.push(id);
      if(id==='broken-write') throw new Error('磁盘写入失败');
      Object.assign(records.find(asset=>asset.id===id),patch);
    },
  };
  const queue=new PreviewQueue(library,async asset=>({previewPath:`previews/${asset.id}.png`}));
  await queue.add(records);
  await queue.idle();
  assert.equal(attempts.at(-1),'good');
  assert.equal(records[1].previewStatus,'ready');
});

test('force retry requested while active runs once after the active render', async () => {
  const record={id:'retry',previewStatus:'pending'};
  let calls=0; let firstStarted; let releaseFirst;
  const started=new Promise(resolve=>{firstStarted=resolve});
  const gate=new Promise(resolve=>{releaseFirst=resolve});
  const library={
    getAsset:id=>id===record.id?record:null,
    setPreview:async(_id,patch)=>Object.assign(record,patch),
  };
  const queue=new PreviewQueue(library,async()=>{
    calls++;
    if(calls===1){firstStarted();await gate;}
    return {previewPath:`previews/${calls}.png`};
  });
  queue.add([record]);
  await firstStarted;
  queue.add([record],true);
  releaseFirst();
  await queue.idle();
  assert.equal(calls,2);
  assert.equal(record.previewStatus,'ready');
  assert.equal(record.previewPath,'previews/2.png');
});

test('force retry of a removed active asset does not leave stale queue work', async () => {
  const record={id:'removed',previewStatus:'pending'};
  let release; const gate=new Promise(resolve=>{release=resolve});
  const library={getAsset:id=>id===record.id?record:null,setPreview:async()=>{throw new Error('removed')}};
  const queue=new PreviewQueue(library,async()=>{await gate;return {previewPath:'x.png'}});
  queue.add([record]);
  while(queue.snapshot().active===null) await new Promise(resolve=>setImmediate(resolve));
  queue.add([record],true);
  delete record.previewStatus;
  // A real removal makes getAsset return null before the retry is enqueued.
  library.getAsset=()=>null;
  release();
  await queue.idle();
  assert.deepEqual(queue.snapshot(),{pending:0,active:null});
});

test('render failure plus failed metadata write still lets following assets finish', async () => {
  const records=[{id:'bad',previewStatus:'pending'},{id:'good',previewStatus:'pending'}];
  const library={
    getAsset:id=>records.find(asset=>asset.id===id),
    setPreview:async(id,patch)=>{
      if(id==='bad')throw new Error('磁盘写入失败');
      Object.assign(records.find(asset=>asset.id===id),patch);
    },
  };
  const queue=new PreviewQueue(library,async asset=>{
    if(asset.id==='bad')throw new Error('无法解析');
    return {previewPath:'good.png'};
  });
  queue.add(records);
  await queue.idle();
  assert.equal(records[1].previewStatus,'ready');
});

test('repeated force retries while active coalesce and discard the stale result', async () => {
  const record={id:'retry',previewStatus:'pending'};const writes=[];
  let calls=0;let started;let release;
  const firstStarted=new Promise(resolve=>{started=resolve});
  const gate=new Promise(resolve=>{release=resolve});
  const library={getAsset:()=>record,setPreview:async(_id,patch)=>{writes.push(patch);Object.assign(record,patch);}};
  const queue=new PreviewQueue(library,async()=>{
    calls++;
    if(calls===1){started();await gate;}
    return {previewPath:`${calls}.png`};
  },()=>{throw new Error('view disconnected')});
  queue.add([record]);await firstStarted;
  queue.add([record],true);queue.add([record],true);queue.add([record],true);
  release();await queue.idle();
  assert.equal(calls,2);
  assert.equal(writes.length,1);
  assert.equal(writes[0].previewPath,'2.png');
});

for (const fails of [false, true]) test(`active auto-render ${fails ? 'failure' : 'result'} cannot overwrite a newer sidecar preview`, async () => {
  const records=[{id:'hero',previewStatus:'pending',previewOrigin:null,previewRevision:null,previewPath:null}];
  let started; let release;
  const renderStarted=new Promise(resolve=>{started=resolve});
  const gate=new Promise(resolve=>{release=resolve});
  const writes=[];
  const library={
    getAsset:id=>{
      const asset=records.find(item=>item.id===id);
      return asset ? structuredClone(asset) : null;
    },
    setPreview:async(id,patch)=>{
      writes.push({id,patch:structuredClone(patch)});
      Object.assign(records.find(item=>item.id===id),patch);
    },
  };
  const queue=new PreviewQueue(library,async()=>{
    started(); await gate;
    if(fails)throw new Error('旧渲染失败');
    return {previewPath:'previews/auto.png',width:100,height:100,frames:1};
  });
  queue.add(records);
  await renderStarted;
  Object.assign(records[0],{
    previewStatus:'ready', previewOrigin:'sidecar', previewRevision:'sidecar-revision',
    previewPath:'previews/hero-sidecar.png', width:null, height:null, frames:null,
  });
  release();
  await queue.idle();
  assert.equal(writes.length,0);
  assert.equal(records[0].previewOrigin,'sidecar');
  assert.equal(records[0].previewRevision,'sidecar-revision');
  assert.equal(records[0].previewPath,'previews/hero-sidecar.png');
});
