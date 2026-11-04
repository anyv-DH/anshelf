/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const path=require('node:path');
const fs=require('node:fs/promises');
// Explorer sees native files, while Electron's fs also exposes ASAR entries.
const nativeFs=process.versions.electron?require('original-fs').promises:fs;
const {Library,AUDIO_EXTENSIONS}=require('../core/library.cjs');
const {Bridge,resolveManagedPath}=require('../core/bridge.cjs');
const {sha256}=require('../core/files.cjs');
const {PreviewQueue}=require('../core/preview.cjs');
const {createSync}=require('./host-sync.cjs');
const {duplicateFile,isWithin}=require(path.join(__dirname,'duplicate-file.cjs'));
const {locateManagedFile}=require('../core/managed-file-recovery.cjs');

function animateFilename(asset) {
  let stem = String(asset.name || asset.originalName || '未命名素材').replace(/\.fla$/i, '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 150).replace(/[. ]+$/g, '');
  if (!stem) stem = '未命名素材';
  if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(stem)) stem = '_' + stem;
  return stem + '.fla';
}

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

async function createHost({root,render,validateImage=async()=>true,createPoster=async()=>false,pickFiles=async()=>[],pickFolder=async()=>[],pickDuplicateFolder=async()=>[],confirmDuplicate=async()=>true,compact=async()=>false,openPluginFolder=async()=>{},openInAnimate=async()=>{throw new Error('当前环境无法打开 Animate');},revealFile=async()=>{throw new Error('当前环境无法打开文件所在位置');},setTheme=async theme=>theme,windowAction=async()=>({maximized:false}),previewUrl=id=>`anshelf://preview/${id}`,mediaUrl=id=>`anshelf://media/${id}`,posterUrl=id=>`anshelf://poster/${id}`,demoPath=path.join(__dirname,'../demo')}){
  const library=await Library.open(root);const bridge=new Bridge(root);
  const queue=new PreviewQueue(library,render);
  const snapshot=async(status={})=>{const data=library.snapshot();return{...data,assets:data.assets.map(a=>({...a,
    mediaUrl:a.kind==='audio'?mediaUrl(a.id):null,
    previewPosterUrl:a.previewPosterPath?posterUrl(a.id)+'?v='+encodeURIComponent(a.previewRevision||a.id):null,
    previewUrl:a.previewStatus==='ready'?previewUrl(a.id)+'?v='+encodeURIComponent(a.previewRevision||a.previewPath||a.id):null})),queue:status.queue||queue.snapshot(),bridge:status.bridge||await bridge.status()};};
  const sync=createSync({library,queue,bridge,snapshot});
  async function validatedAsset(id,animateFilename=null){
    let a=typeof id==='string'?library.getAsset(id):null;
    if(!a)throw new Error('请选择素材库中存在的素材');
    if(a.kind!=='audio'){
      if(typeof a.managedPath!=='string'||path.extname(a.managedPath).toLowerCase()!=='.fla')throw new Error('只能使用受管理的 FLA 素材');
      const reconciled=await library.reconcileManagedFile(id,animateFilename);
      a=reconciled.asset;
      if(reconciled.contentChanged)queue.add([a],true);
    }
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
    const pending=(result.assets||[]).map(a=>library.getAsset(a.id)).filter(a=>a&&a.kind!=='audio'&&a.previewStatus==='pending');
    queue.add(pending,true);
    return result;
  }
  async function importCurrentDocument(file){
    if(!await isOriginalFile(file,{kind:'fla'}))throw new Error('请选择已保存、存在且不含链接的 FLA 文件路径');
    const canonical=await nativeFs.realpath(file);
    const canonicalRoot=await nativeFs.realpath(bridge.root);
    if(isWithin(canonicalRoot,canonical)){
      const existing=library.snapshot().assets.find(a=>path.relative(path.resolve(canonicalRoot,a.managedPath),canonical)==='');
      if(!existing)throw new Error('该文件位于素材库内，但尚未登记，不能从插件重复导入');
      const reconciled=await library.reconcileManagedFile(existing.id);
      if(reconciled.contentChanged)queue.add([reconciled.asset],true);
      return{assetId:existing.id,name:reconciled.asset.name,updated:reconciled.contentChanged,duplicate:true};
    }
    // Re-adding an existing effect must not change it to ordinary or clear its categories.
    const hash=await sha256(canonical);
    const existing=library.snapshot().assets.find(a=>a.kind!=='audio'&&a.hash===hash);
    if(existing){
      return library.change(state=>{
        const asset=state.assets.find(a=>a.id===existing.id&&a.hash===hash);
        if(!asset)throw new Error('素材库记录已变化，请重新加入当前文档');
        if(!asset.sourcePaths.includes(canonical))asset.sourcePaths.push(canonical);
        return{assetId:asset.id,name:asset.name,updated:false,duplicate:true};
      },false);
    }
    const result=await importPaths([canonical],{mode:'ordinary',preferExistingPreview:true});
    const asset=result.assets?.[0];
    if(!asset)throw new Error(result.failed?.[0]?.error||'当前文档未能加入素材库');
    return{assetId:asset.id,name:asset.name,updated:false,duplicate:result.added===0};
  }
  const api={
    snapshot:()=>snapshot(),sync,
    importFiles:async(options={})=>importPaths(await pickFiles(options),options),
    importFolder:async(options={})=>importPaths(await pickFolder(options),options),
    importPaths,
    assignCategory:async(ids,id)=>library.assignCategory(ids,id),undo:async()=>library.undo(),
    addToCategory:async(ids,id)=>library.addToCategory(ids,id),removeFromCategory:async(ids,id)=>library.removeFromCategory(ids,id),
    removeFromCategories:async(ids,categoryIds)=>library.removeFromCategories(ids,categoryIds),
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
    duplicateInFolder:async(id)=>{
      const a=typeof id==='string'?library.getAsset(id):null;
      if(!a)throw new Error('请选择素材库中存在的素材');
      const managed=a.kind==='audio'?resolveManagedPath(bridge.root,a.managedPath,'assets'):(await locateManagedFile(bridge.root,a)).file;
      const extension=path.extname(managed).toLowerCase();
      if(a.kind==='audio'?!AUDIO_EXTENSIONS.includes(extension):extension!=='.fla')throw new Error('受管理素材文件格式无效，FLA或音频格式不匹配');
      if(a.kind==='audio'&&extension!==a.extension)throw new Error('音频扩展名与记录不一致');
      let directory=null;
      for(const source of a.sourcePaths){
        if(await isOriginalFile(source,a)&&!isWithin(bridge.root,source)){directory=path.dirname(source);break;}
      }
      if(!directory){
        const selected=await pickDuplicateFolder();
        directory=Array.isArray(selected)?selected[0]:selected;
        if(!directory)return{cancelled:true};
      }
      if(!await confirmDuplicate({name:a.name||a.originalName,directory,extension}))return{cancelled:true};
      // Reconcile saved AN edits only after confirmation; cancelling must be read-only.
      const {file}=await validatedAsset(id);
      const duplicate=await duplicateFile({source:file,directory,name:a.name||a.originalName,extension:path.extname(file).toLowerCase(),excludedRoot:bridge.root});
      await revealFile(duplicate);
      return{file:duplicate,cancelled:false};
    },
    openInAnimate:async(id)=>{
      const a=library.getAsset(id);if(!a)throw new Error('请先选择一个素材');
      if(a.kind==='audio')throw new Error('只能在 AN 中打开 FLA 素材，音频请拖入AN');
      const {file}=await validatedAsset(id,animateFilename(a));
      return openInAnimate(file);
    },
    setTheme:async(theme)=>{if(!['dark','warm'].includes(theme))throw new Error('主题无效');return setTheme(theme);},
    windowAction:async(action)=>{if(!['minimize','maximize','close'].includes(action))throw new Error('窗口操作无效');return windowAction(action);},
    status:async()=>bridge.status(),
    demo:async()=>importPaths([demoPath],{preferExistingPreview:true}),compact,openPluginFolder
  };
  queue.add(library.snapshot().assets.filter(a=>a.previewStatus==='pending'));
  return{api,library,bridge,queue,root,importCurrentDocument};
}
module.exports={createHost,animateFilename};
