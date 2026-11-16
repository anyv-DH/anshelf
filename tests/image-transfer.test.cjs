const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto'), vm = require('node:vm');
const { Bridge } = require('../core/bridge.cjs');
const { Queue } = require('../plugin/queue.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anshelf-image-transfer-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'assets')); fs.mkdirSync(path.join(root, 'previews'));
  const bytes = Buffer.from('image fixture'), hash = crypto.createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(path.join(root, 'assets', hash + '.png'), bytes);
  const asset = { id: 'picture', name: '场景', kind: 'image', hash, managedPath: 'assets/' + hash + '.png' };
  const bridge = new Bridge(root), queue = new Queue(root);
  queue.heartbeat(false, 42);
  return { root, asset, bridge, queue };
}
test('image requests bind a capable ready document for five seconds and CEP verifies bytes', t => {
  const { bridge, asset, queue } = fixture(t);
  const r = bridge.send(asset); assert.equal(r.delivery, 'image-import'); assert.equal(r.asset.kind, 'image');
  assert.equal(r.targetDocumentId, 42); assert.equal(r.expiresAt - r.createdAt, 5000);
  const prepared = queue.prepare(queue.pending()); assert.equal(prepared.asset.kind, 'image'); assert.equal(prepared.delivery, 'image-import');
  assert.equal(prepared.targetDocumentId,42);
  fs.appendFileSync(r.asset.sourcePath, 'tamper'); assert.throws(() => queue.prepare(r), /哈希/);
});
test('offline, old, busy, stale, no document and invalid image deliveries cannot overwrite pending', t => {
  const { root, bridge, asset, queue } = fixture(t), request = bridge.send(asset);
  const heartbeat = bridge.status().heartbeat;
  for (const patch of [{ busy:true },{ documentId:null },{ capabilities:{directSource:1} },{ updatedAt:Date.now()-60000 }]) {
    queue.atomic('status.json',{...heartbeat,...patch}); assert.throws(() => bridge.send(asset));
    assert.equal(bridge.status().pending.requestId,request.requestId);
  }
  queue.heartbeat(false,42);
  for (const patch of [{ expiresAt:Date.now()-1 },{targetDocumentId:null},{asset:{...request.asset,kind:'fla'}}]) assert.throws(() => queue.prepare({...request,...patch}));
  fs.unlinkSync(path.join(root,'bridge/status.json')); assert.throws(() => bridge.send(asset), /连接|就绪/);
});
test('JSFL image import refuses a switched document and imports once without saving or opening source', () => {
  const code = fs.readFileSync(path.join(__dirname,'../plugin/insert-whole.jsfl'),'utf8');
  const calls = [], items = [], timeline = {currentLayer:0,currentFrame:0,layers:[{visible:true,locked:false,frames:[{startFrame:0}]}]};
  const library = { items, itemExists:n=>items.some(i=>i.name===n), newFolder(n){items.push({name:n,itemType:'folder'});}, moveToFolder(folder,name){items.find(i=>i.name===name).name=folder+'/'+name;return true;} };
  const doc = { id:42,width:800,height:600,library,timelines:[timeline],getTimeline:()=>timeline,selectNone(){this.selection=[];},importFile(uri,toLibrary){calls.push(['import',uri,toLibrary]);items.push({name:'test.png',itemType:'bitmap'});},addItem(point,item){calls.push(['add',item.name]);this.selection=[{x:0,y:0,left:0,top:0,width:80,height:60}];return true;} };
  const sandbox = { fl:{getDocumentDOM:()=>doc},FLfile:{exists:()=>true},Date,JSON,isFinite,decodeURIComponent };
  vm.createContext(sandbox); vm.runInContext(code,sandbox);
  const r={version:2,requestId:'test',createdAt:Date.now(),expiresAt:Date.now()+5000,targetDocumentId:43,delivery:'image-import',managedRoot:'file:///C|/lib',asset:{id:'picture',kind:'image',name:'test',hash:'a'.repeat(64),sourceURI:'file:///C|/lib/assets/test.png'}};
  assert.equal(JSON.parse(sandbox.AnShelfImportImage(JSON.stringify(r),r.managedRoot)).ok,false); assert.deepEqual(calls,[]);
  r.targetDocumentId=42;
  const result=JSON.parse(sandbox.AnShelfImportImage(JSON.stringify(r),r.managedRoot));assert.equal(result.ok,true,result.error);
  assert.equal(calls.filter(c=>c[0]==='import').length,1);assert.equal(calls[0][2],true);
  assert.equal(JSON.parse(sandbox.AnShelfImportImage(JSON.stringify(r),r.managedRoot)).ok,true);
  assert.equal(calls.filter(c=>c[0]==='import').length,1);
  assert.equal(doc.selection[0].x,360);assert.equal(doc.selection[0].y,270);
});

test('WebP and GIF convert locally to a verified PNG cache and never rewrite original bytes', async t => {
  const {root,asset}=fixture(t),{prepareImageTransfer}=require('../desktop/image-transfer.cjs');
  const file=path.join(root,'assets',asset.hash+'.webp'), source=Buffer.from('original webp fixture');fs.writeFileSync(file,source);
  const picture={...asset,extension:'.webp',managedPath:'assets/'+asset.hash+'.webp'};
  const png=fs.readFileSync(path.join(__dirname,'../desktop/icon.png'));
  const result=await prepareImageTransfer(root,picture,async input=>{assert.equal(input,file);return png;});
  assert.equal(result.asset.extension,'.png');assert.equal(result.asset.kind,'image');
  assert.deepEqual(fs.readFileSync(file),source);assert.deepEqual(fs.readFileSync(result.file),png);
  assert.equal((await prepareImageTransfer(root,picture,async()=>png)).file,result.file);
  await assert.rejects(prepareImageTransfer(root,picture,async()=>Buffer.from('invalid')),/PNG/);
  fs.writeFileSync(result.file,'tamper');await assert.rejects(prepareImageTransfer(root,picture,async()=>png),/校验/);
});

test('native drag permits image files while keeping FLA isolated and ignoring foreign senders',async()=>{
  const {registerNativeDrag}=require('../desktop/native-drag.cjs');let handler,prepared=0;const calls=[],errors=[];
  const wc={startDrag:x=>calls.push(x)};
  registerNativeDrag({ipcMain:{on:(_name,fn)=>handler=fn},webContents:wc,prepareDrag:async()=>{prepared++;return{kind:'image',file:'C:/managed/image.png'};},createIcon:()=> 'icon',reportError:e=>errors.push(e)});
  await handler({sender:{}},'image');assert.equal(prepared,0);await handler({sender:wc},'image');
  assert.deepEqual(calls,[{file:'C:/managed/image.png',icon:'icon'}]);assert.deepEqual(errors,[]);
});
