/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const fs=process.versions.electron?require('original-fs').promises:require('node:fs/promises');
const {isWithin}=require('./duplicate-file.cjs');
const EXTENSIONS={
  ordinary:['.fla'],effect:['.fla'],audio:['.mp3','.wav','.ogg','.flac'],
  image:['.png','.jpg','.jpeg','.webp','.gif']
};
const MAX_FILES=20000;
function importMode(options={}){
  if(!options||typeof options!=='object'||Array.isArray(options))throw new Error('导入模式无效');
  const mode=options.mode===undefined?'ordinary':options.mode;
  if(typeof mode!=='string'||!Object.hasOwn(EXTENSIONS,mode))throw new Error('导入模式无效');
  if(Object.hasOwn(options,'groupByFolder')&&(typeof options.groupByFolder!=='boolean'||options.groupByFolder&&mode!=='image'))throw new Error('按文件夹分组仅支持图片导入，选项须为布尔值');
  return mode;
}
const pathKey=file=>process.platform==='win32'?file.toLowerCase():file;

// Only native pickers and the native-File preload bridge create selections.
// The renderer sees names and an opaque ID rather than an import path API.
function createImportSelections({pickFiles=async()=>[],pickFolder=async()=>[],importPaths,excludedRoot=null,now=Date.now,ttlMs=30*60*1000}={}){
  if(typeof importPaths!=='function')throw new Error('导入服务不可用');
  const selections=new Map();
  let closed=false;
  function assertOpen(){if(closed)throw new Error('导入服务已关闭');}
  function prune(){
    const time=now();
    for(const [id,selection] of selections)if(!selection.busy&&time-selection.updatedAt>=ttlMs)selections.delete(id);
  }
  function describe(id,selection){
    return {selectionId:id,files:selection.files.map(({name,extension})=>({name,extension})),canceled:false};
  }
  async function stagePaths(input){
    assertOpen();prune();
    if(!Array.isArray(input)||!input.length||input.length>MAX_FILES||input.some(file=>typeof file!=='string'||!file.trim()||file.includes(String.fromCharCode(0))||!path.isAbsolute(file)))throw new Error('请拖入或选择有效的本地文件路径');
    if(selections.size>=32)throw new Error('待确认的导入过多，请先完成或取消已有导入');
    const excluded=excludedRoot?path.resolve(excludedRoot):null;
    const files=[],seen=new Set(),directories=new Map();
    async function plainDirectory(directory){
      if(directories.has(directory))return directories.get(directory);
      const checked=[];
      let current=directory,valid=true;
      while(!directories.has(current)){
        const stat=await fs.lstat(current);
        checked.push(current);
        if(!stat.isDirectory()||stat.isSymbolicLink()){valid=false;break;}
        const parent=path.dirname(current);
        if(parent===current)break;
        current=parent;
      }
      if(directories.get(current)===false)valid=false;
      for(const item of checked)directories.set(item,valid);
      return valid;
    }
    const pending=input.map(file=>path.resolve(file));
    let cursor=0;
    while(cursor!==pending.length){
      assertOpen();
      const file=pending[cursor++];
      if(excluded&&isWithin(excluded,file))continue;
      const key=pathKey(file);
      if(seen.has(key))continue;
      seen.add(key);
      if(seen.size>MAX_FILES*5)throw new Error('单次选择的文件夹过多，请分批选择');
      let stat;
      try{stat=await fs.lstat(file);}catch{throw new Error('无法读取所选文件：'+path.basename(file)+'，请重新选择');}
      if(stat.isSymbolicLink()||!await plainDirectory(path.dirname(file)))continue;
      if(stat.isDirectory()){
        for(const entry of await fs.readdir(file,{withFileTypes:true}))if(!entry.isSymbolicLink())pending.push(path.join(file,entry.name));
      }else if(stat.isFile()){
        files.push({file,name:path.basename(file),extension:path.extname(file).toLowerCase()});
        if(files.length>MAX_FILES)throw new Error('单次导入文件过多，请分批选择');
      }
    }
    assertOpen();
    if(!files.length)throw new Error('没有可选择的本地文件，请检查文件夹或素材库位置');
    const id=randomUUID(),selection={files,busy:false,updatedAt:now()};
    selections.set(id,selection);
    return describe(id,selection);
  }
  async function choose(picker,options={}){
    assertOpen();importMode(options);
    const files=await picker(options);
    if(closed||!Array.isArray(files)||!files.length)return{selectionId:null,files:[],canceled:true};
    return stagePaths(files);
  }
  async function importSelectedPaths(id,options={}){
    assertOpen();prune();
    const selection=typeof id==='string'?selections.get(id):null;
    if(!selection)throw new Error('导入选择已失效，请重新选择文件');
    if(selection.busy)throw new Error('正在导入，请稍候');
    const mode=importMode(options),selected=selection.files.filter(file=>EXTENSIONS[mode].includes(file.extension));
    if(!selected.length)throw new Error('所选类型没有可导入的文件，请选择其他素材类型');
    const configured={mode};
    for(const key of ['categoryId','previewResolution','preferExistingPreview','groupByFolder'])if(Object.hasOwn(options,key))configured[key]=options[key];
    selection.busy=true;selection.updatedAt=now();
    try{
      const result=await importPaths(selected.map(item=>item.file),configured);
      if(result?.canceled||result?.cancelled)return result;
      // Preserve failed files for retry. Unknown failure identities retain the
      // batch; core deduplication protects already successful entries.
      const failed=Array.isArray(result?.failed)?result.failed:[];
      const failedPaths=failed.map(item=>item?.file||item?.path||item?.source).filter(file=>typeof file==='string').map(file=>pathKey(path.resolve(file)));
      const failedKeys=new Set(failedPaths),unresolvedFailure=failed.length!==failedPaths.length;
      const consumed=new Set(unresolvedFailure?[]:selected.filter(item=>!failedKeys.has(pathKey(item.file))));
      selection.files=selection.files.filter(item=>!consumed.has(item));
      if(!selection.files.length)selections.delete(id);
      return {...result,selection:selection.files.length&&selections.get(id)===selection?describe(id,selection):{selectionId:null,files:[],canceled:false}};
    }finally{selection.busy=false;selection.updatedAt=now();}
  }
  return {
    chooseImportFiles:options=>choose(pickFiles,options),
    chooseImportFolder:options=>choose(pickFolder,options),
    stagePaths,importSelectedPaths,
    cancelImportSelection:async id=>typeof id==='string'&&selections.delete(id),
    close(){closed=true;selections.clear();}
  };
}
function registerImportSelectionIpc({ipcMain,webContents,selections}){
  const actions={
    'shelf:chooseImportFiles':options=>selections.chooseImportFiles(options),
    'shelf:chooseImportFolder':options=>selections.chooseImportFolder(options),
    'shelf:stage-dropped-files':paths=>selections.stagePaths(paths),
    'shelf:importSelectedPaths':(id,options)=>selections.importSelectedPaths(id,options),
    'shelf:cancelImportSelection':id=>selections.cancelImportSelection(id)
  };
  for(const [channel,action] of Object.entries(actions))ipcMain.handle(channel,async(event,...args)=>{
    if(event.sender!==webContents||webContents.mainFrame&&event.senderFrame!==webContents.mainFrame)throw new Error('操作不允许');
    return action(...args);
  });
  return()=>{for(const channel of Object.keys(actions))ipcMain.removeHandler(channel);};
}
module.exports={createImportSelections,registerImportSelectionIpc};
