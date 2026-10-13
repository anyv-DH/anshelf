/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const path=require('node:path');
const fs=require('node:fs/promises');
// Explorer sees native files, while Electron's fs also exposes ASAR entries.
const nativeFs=process.versions.electron?require('original-fs').promises:fs;
const {randomUUID}=require('node:crypto');
const {Library,AUDIO_EXTENSIONS}=require('../core/library.cjs');
const {Bridge,resolveManagedPath}=require('../core/bridge.cjs');
const {sha256}=require('../core/files.cjs');
const {PreviewQueue}=require('../core/preview.cjs');
const {createSync}=require('./host-sync.cjs');

async function isOriginalFile(file,asset){
  const extensions=asset.kind==='audio'?AUDIO_EXTENSIONS:['.fla'];
  if(typeof file!=='string'||file.includes('\0')||!path.isAbsolute(file)||!extensions.includes(path.extname(file).toLowerCase()))return false;
  try{
    const stat=await nativeFs.lstat(file);
    if(!stat.isFile()||stat.isSymbolicLink())return false;
    let directory=path.dirname(file);
    while(true){
      const ancestor=await nativeFs.lstat(directory);
      if(!ancestor.isDirectory()||ancestor.isSymbolicLink())return false;
      const parent=path.dirname(directory);
      if(parent===directory)return true;
      directory=parent;
    }
  }catch{return false;}
}

async function createHost({root,render,validateImage=async()=>true,createPoster=async()=>false,pickFiles=async()=>[],pickFolder=async()=>[],compact=async()=>false,openPluginFolder=async()=>{},openInAnimate=async()=>{throw new Error('当前环境无法打开 Animate');},revealFile=async()=>{throw new Error('当前环境无法打开文件所在位置');},setTheme=async theme=>theme,windowAction=async()=>({maximized:false}),previewUrl=id=>`anshelf://preview/${id}`,mediaUrl=id=>`anshelf://media/${id}`,posterUrl=id=>`anshelf://poster/${id}`,demoPath=path.join(__dirname,'../demo')}){
  const library=await Library.open(root);const bridge=new Bridge(root);
  const queue=new PreviewQueue(library,render);
  const snapshot=async(status={})=>{const data=library.snapshot();return{...data,assets:data.assets.map(a=>({...a,
    mediaUrl:a.kind==='audio'?mediaUrl(a.id):null,
    previewPosterUrl:a.previewPosterPath?posterUrl(a.id)+'?v='+encodeURIComponent(a.previewRevision||a.id):null,
    previewUrl:a.previewStatus==='ready'?previewUrl(a.id)+'?v='+encodeURIComponent(a.previewRevision||a.previewPath||a.id):null})),queue:status.queue||queue.snapshot(),bridge:status.bridge||await bridge.status()};};
  const sync=createSync({library,queue,bridge,snapshot});
  async function validatedAsset(id){
    const a=typeof id==='string'?library.getAsset(id):null;
    if(!a)throw new Error('请选择素材库中存在的素材');
    const file=resolveManagedPath(bridge.root,a.managedPath,'assets');
    const extension=path.extname(file).toLowerCase();
    if(a.kind==='audio'?!AUDIO_EXTENSIONS.includes(extension):extension!=='.fla')throw new Error('受管理素材文件格式无效，FLA或音频格式不匹配');
    if(a.kind==='audio'&&extension!==a.extension)throw new Error('音频扩展名与记录不一致');
    if(await sha256(file)!==a.hash)throw new Error('素材完整性校验失败，请重新导入');
    return{a,file};
  }
  async function importPaths(paths,options={}){
    if(!Array.isArray(paths)||paths.some(p=>typeof p!=='string'))throw new Error('导入路径无效');
    const result=await library.importPaths(paths,{mode:options.mode===undefined?'ordinary':options.mode,preferExistingPreview:options.preferExistingPreview!==false,previewResolution:options.previewResolution,categoryId:options.categoryId});
    for(const a of result.assets||[])if(a.previewStatus==='ready'&&a.previewOrigin==='sidecar'){
      let valid=false;
      const posterRelative=`previews/${a.hash}-poster-${a.previewRevision}.png`;
      try{
        valid=a.previewAnimated?await createPoster(library.previewPath(a.id),path.join(library.root,posterRelative)):await validateImage(library.previewPath(a.id));
        if(valid&&a.previewAnimated)await library.setPreview(a.id,{previewPosterPath:posterRelative},a.previewRevision);
      }catch{/* Unreadable images use the same automatic-render fallback as invalid images. */}
      if(!valid){
        const current=await library.setPreview(a.id,{previewStatus:'pending',previewPath:null,previewPosterPath:null,previewAnimated:false,previewFormat:null,previewError:null,previewOrigin:null},a.previewRevision);
        a.previewStatus=current.previewStatus;
      }
    }
    queue.add((result.assets||library.snapshot().assets).filter(a=>a.kind!=='audio'&&a.previewStatus==='pending'),true);return result;
  }
  const api={
    snapshot:()=>snapshot(),sync,
    importFiles:async(options={})=>importPaths(await pickFiles(options),options),
    importFolder:async(options={})=>importPaths(await pickFolder(options),options),
    importPaths,
    assignCategory:async(ids,id)=>library.assignCategory(ids,id),undo:async()=>library.undo(),
    createCategory:async(name,parentId=null,scope='all')=>library.createCategory(name,parentId,scope),renameCategory:async(id,name,parentId=undefined)=>library.renameCategory(id,name,parentId),deleteCategory:async(id)=>library.deleteCategory(id),
    setCategoryPinned:async(id,pinned)=>library.setCategoryPinned(id,pinned),
    updateAsset:async(id,patch)=>library.updateAsset(id,patch),removeAssets:async(ids)=>library.removeAssets(ids),
    retryPreview:async(id)=>{const a=library.getAsset(id);if(!a)throw new Error('素材不存在');if(a.kind==='audio')throw new Error('音频不需要生成预览图');await library.setPreview(id,{previewStatus:'pending',previewError:null});queue.add([a],true);return true;},
    send:async(id)=>{const {a}=await validatedAsset(id);if(a.kind==='audio')throw new Error('粘贴到舞台只支持FLA，音频请拖入AN');return bridge.send(a);},
    sendStageDrop:async(id,target)=>{const {a}=await validatedAsset(id);if(a.kind==='audio')throw new Error('舞台拖动只支持 FLA');return bridge.sendStageDrop(a,target);},
    prepareDrag:async(id)=>{
      const {a,file}=await validatedAsset(id);
      if(a.kind==='audio')return{file,kind:'audio'};
      throw new Error('FLA 请使用舞台拖动通道，不能作为文件拖入 AN');
    },
    revealInFolder:async(id)=>{
      const a=typeof id==='string'?library.getAsset(id):null;
      if(!a)throw new Error('请选择素材库中存在的素材');
      for(const source of a.sourcePaths){
        if(await isOriginalFile(source,a)){await revealFile(source);return{location:'original'};}
      }
      let file;
      try{
        file=resolveManagedPath(bridge.root,a.managedPath,'assets');
        if(a.kind==='audio'?!AUDIO_EXTENSIONS.includes(path.extname(file).toLowerCase()):path.extname(file).toLowerCase()!=='.fla')throw new Error('受管理副本必须是 FLA 或受支持音频文件');
      }catch(error){throw new Error('原始文件不可用，库中副本也无法定位：'+error.message);}
      await revealFile(file);return{location:'managed'};
    },
    openInAnimate:async(id)=>{
      const a=library.getAsset(id);if(!a)throw new Error('请先选择一个素材');
      if(a.kind==='audio')throw new Error('只能在 AN 中打开 FLA 素材，音频请拖入AN');
      const source=resolveManagedPath(bridge.root,a.managedPath,'assets');
      if(path.extname(source).toLowerCase()!=='.fla')throw new Error('只能在 AN 中打开受管理的 FLA 素材');
      const directory=path.join(bridge.root,'opened');
      try{const stat=await fs.lstat(directory);if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('打开副本目录包含链接或路径无效');}
      catch(error){
        if(error.code!=='ENOENT')throw error;
        // Multiple selections can open at once. Recursive creation makes the
        // first-directory race harmless; lstat again before using the path so
        // a link inserted during the race is still rejected.
        await fs.mkdir(directory,{recursive:true});
        const stat=await fs.lstat(directory);
        if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('打开副本目录包含链接或路径无效');
      }
      const canonicalDirectory=await fs.realpath(directory),canonicalRoot=await fs.realpath(bridge.root);
      if(path.relative(canonicalRoot,canonicalDirectory)!=='opened')throw new Error('打开副本目录路径无效');
      const file=path.join(directory,randomUUID()+'.fla');
      await fs.copyFile(source,file,fs.constants.COPYFILE_EXCL);
      return openInAnimate(resolveManagedPath(bridge.root,file,'opened'));
    },
    setTheme:async(theme)=>{if(!['dark','warm'].includes(theme))throw new Error('主题无效');return setTheme(theme);},
    windowAction:async(action)=>{if(!['minimize','maximize','close'].includes(action))throw new Error('窗口操作无效');return windowAction(action);},
    status:async()=>bridge.status(),
    demo:async()=>importPaths([demoPath],{preferExistingPreview:true}),compact,openPluginFolder
  };
  queue.add(library.snapshot().assets.filter(a=>a.previewStatus==='pending'));
  return{api,library,bridge,queue,root};
}
module.exports={createHost};
