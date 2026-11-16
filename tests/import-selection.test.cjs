/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const {createImportSelections,registerImportSelectionIpc}=require('../desktop/import-selection.cjs');

async function fixture(t){
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'anshelf-import-selection-'));
  t.after(()=>fs.rm(base,{recursive:true,force:true}));
  const inputs=[];
  for(const [folder,name] of [['one','same.fla'],['two','same.fla'],['one','sound.wav'],['one','image.PNG']]){
    const directory=path.join(base,folder);await fs.mkdir(directory,{recursive:true});
    const file=path.join(directory,name);await fs.writeFile(file,name);inputs.push(file);
  }
  return {base,inputs};
}
test('staging retains same basenames, conceals source paths and waits for confirmation',async t=>{
  const {inputs}=await fixture(t),imports=[];
  const selections=createImportSelections({pickFiles:async()=>inputs,importPaths:async(...args)=>{imports.push(args);return{added:args[0].length};}});
  t.after(()=>selections.close());
  const chosen=await selections.chooseImportFiles({mode:'ordinary'});
  assert.equal(chosen.files.length,4);assert.equal(chosen.files[0].name,'same.fla');assert.equal(chosen.files[1].name,'same.fla');
  assert.equal(typeof chosen.selectionId,'string');assert.equal(imports.length,0);
  for(const file of inputs)assert.equal(JSON.stringify(chosen).includes(JSON.stringify(file).slice(1,-1)),false);
  for(const file of chosen.files)assert.deepEqual(Object.keys(file).sort(),['extension','name']);
  await selections.importSelectedPaths(chosen.selectionId,{mode:'effect',previewResolution:1024});
  assert.deepEqual(imports[0],[inputs.slice(0,2),{mode:'effect',previewResolution:1024}]);
  await selections.importSelectedPaths(chosen.selectionId,{mode:'audio'});
  await selections.importSelectedPaths(chosen.selectionId,{mode:'image'});
  assert.deepEqual(imports.map(item=>item[0].length),[2,1,1]);
  await assert.rejects(selections.importSelectedPaths(chosen.selectionId,{mode:'image'}),/失效/);
});
test('failed imports are retryable while invalid modes and expired or cancelled IDs never import',async t=>{
  const {inputs}=await fixture(t);let count=0,fail=true,clock=0;
  const selections=createImportSelections({now:()=>clock,ttlMs:1000,pickFiles:async()=>inputs,importPaths:async()=>{count++;if(fail)throw new Error('disk failed');return{added:1};}});
  t.after(()=>selections.close());
  await assert.rejects(selections.chooseImportFiles({mode:'bad'}),/模式/);
  const chosen=await selections.stagePaths([inputs[3]]);
  await assert.rejects(selections.importSelectedPaths(chosen.selectionId,{mode:'image'}),/disk failed/);
  fail=false;await selections.importSelectedPaths(chosen.selectionId,{mode:'image'});assert.equal(count,2);
  const cancelled=await selections.stagePaths([inputs[0]]);
  assert.equal(await selections.cancelImportSelection(cancelled.selectionId),true);
  await assert.rejects(selections.importSelectedPaths(cancelled.selectionId,{mode:'ordinary'}),/失效/);
  const expired=await selections.stagePaths([inputs[0]]);clock=1001;
  await assert.rejects(selections.importSelectedPaths(expired.selectionId,{mode:'ordinary'}),/失效/);
  await assert.rejects(selections.importSelectedPaths(inputs,{mode:'ordinary'}),/选择/);
  assert.equal(count,2);
});
test('folder staging detects actual nested files, excludes library roots and rejects non-native paths',async t=>{
  const {base,inputs}=await fixture(t),excludedRoot=path.join(base,'library');
  await fs.mkdir(excludedRoot);await fs.writeFile(path.join(excludedRoot,'private.fla'),'private');
  const selections=createImportSelections({excludedRoot,pickFolder:async()=>[base],importPaths:async()=>({added:0})});
  t.after(()=>selections.close());
  const chosen=await selections.chooseImportFolder({mode:'image'});
  assert.equal(chosen.files.length,4);assert.equal(chosen.files.some(file=>file.name==='private.fla'),false);
  for(const value of [[],['relative.fla'],[null],['bad'+String.fromCharCode(0)+'.fla']])await assert.rejects(selections.stagePaths(value),/路径|文件/);
  const chosenFile=await selections.stagePaths([inputs[0],inputs[0]]);assert.equal(chosenFile.files.length,1);
});
test('parallel confirmations are blocked and close releases sessions and late selections',async t=>{
  const {inputs}=await fixture(t);let complete,pickComplete;
  const selections=createImportSelections({pickFiles:()=>new Promise(resolve=>{pickComplete=resolve;}),importPaths:()=>new Promise(resolve=>{complete=resolve;})});
  const staged=await selections.stagePaths([inputs[0]]);
  const first=selections.importSelectedPaths(staged.selectionId,{mode:'ordinary'});
  await assert.rejects(selections.importSelectedPaths(staged.selectionId,{mode:'ordinary'}),/正在导入/);
  complete({added:1});await first;
  const selecting=selections.chooseImportFiles({mode:'ordinary'});selections.close();pickComplete(inputs);
  assert.equal((await selecting).canceled,true);
  await assert.rejects(selections.stagePaths(inputs),/关闭/);
});
test('dedicated import IPC rejects foreign senders and subframes before touching selections',async()=>{
  const handlers=new Map(),webContents={mainFrame:{}},calls=[];
  const selections=Object.fromEntries(['chooseImportFiles','chooseImportFolder','stagePaths','importSelectedPaths','cancelImportSelection'].map(name=>[name,async(...args)=>{calls.push([name,...args]);return name;}]));
  const dispose=registerImportSelectionIpc({ipcMain:{handle:(channel,fn)=>handlers.set(channel,fn),removeHandler:channel=>handlers.delete(channel)},webContents,selections});
  for(const handler of handlers.values()){
    await assert.rejects(handler({sender:{}}),/不允许/);
    await assert.rejects(handler({sender:webContents,senderFrame:{}}),/不允许/);
  }
  assert.equal(calls.length,0);
  const result=await handlers.get('shelf:stage-dropped-files')({sender:webContents,senderFrame:webContents.mainFrame},['native.fla']);
  assert.equal(result,'stagePaths');assert.deepEqual(calls,[['stagePaths',['native.fla']]]);
  dispose();assert.equal(handlers.size,0);
});
test('preload accepts only native File objects for drop staging and exposes no raw path importer',async()=>{
  const source=await fs.readFile(path.join(__dirname,'../desktop/preload.cjs'),'utf8'),invocations=[],native={name:'image.png'},synthetic={name:'fake.png'};
  let shelf;
  const electron={contextBridge:{exposeInMainWorld:(_key,api)=>{shelf=api;}},ipcRenderer:{invoke:async(...args)=>{invocations.push(args);return{};},on(){},send(){},removeListener(){}},webUtils:{getPathForFile:file=>{if(file===native)return'C:/selected/image.png';if(file===synthetic)return'';throw new TypeError('not a File');}}};
  vm.runInNewContext(source,{require:name=>{assert.equal(name,'electron');return electron;},Object,String,Array,Error,TypeError});
  assert.equal(shelf.importPaths,undefined);assert.equal(shelf.getPathForFile,undefined);
  await shelf.stageDroppedFiles([native]);
  assert.deepEqual(JSON.parse(JSON.stringify(invocations)),[['shelf:stage-dropped-files',['C:/selected/image.png']]]);
  for(const files of [[synthetic],['C:/arbitrary/file.fla'],[],null]){
    await assert.rejects(Promise.resolve().then(()=>shelf.stageDroppedFiles(files)),/文件|拖入/);
  }
  assert.equal(invocations.length,1);
  await shelf.chooseImportFiles({mode:'image'});
  assert.equal(invocations[1][0],'shelf:chooseImportFiles');
});
test('mode keys cannot be coerced into a permitted import mode',async t=>{
  const {inputs}=await fixture(t);
  let picked=0,imported=0;
  const selections=createImportSelections({pickFiles:async()=>{picked++;return inputs;},importPaths:async()=>{imported++;return{added:1};}});
  t.after(()=>selections.close());
  const invalid=[['image'],[],1,true,null,{}, {toString(){throw new Error('mode was coerced');}}];
  for(const mode of invalid)await assert.rejects(selections.chooseImportFiles({mode}),/模式/);
  assert.equal(picked,0);
  const chosen=await selections.stagePaths([inputs[3]]);
  for(const mode of invalid)await assert.rejects(selections.importSelectedPaths(chosen.selectionId,{mode}),/模式/);
  assert.equal(imported,0);
});
test('partial import failure retains only failed and unhandled files in the same selection',async t=>{
  const {inputs}=await fixture(t),calls=[];
  const selections=createImportSelections({importPaths:async files=>{
    calls.push([...files]);
    return calls.length===1?{added:1,failed:[{path:inputs[1],error:'temporarily busy'}]}:{added:1,failed:[]};
  }});
  t.after(()=>selections.close());
  const chosen=await selections.stagePaths(inputs);
  const first=await selections.importSelectedPaths(chosen.selectionId,{mode:'ordinary'});
  assert.equal(first.selection.selectionId,chosen.selectionId);
  assert.deepEqual(first.selection.files.map(file=>file.name),['same.fla','sound.wav','image.PNG']);
  for(const file of first.selection.files)assert.deepEqual(Object.keys(file).sort(),['extension','name']);
  const second=await selections.importSelectedPaths(chosen.selectionId,{mode:'ordinary'});
  assert.deepEqual(calls,[inputs.slice(0,2),[inputs[1]]]);
  assert.equal(second.selection.selectionId,chosen.selectionId);
  assert.deepEqual(second.selection.files.map(file=>file.name),['sound.wav','image.PNG']);
});
