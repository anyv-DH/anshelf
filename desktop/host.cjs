/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const path=require('node:path');
const fs=require('node:fs/promises');
const timers=require('node:timers');
// Explorer sees native files, while Electron's fs also exposes ASAR entries.
const nativeFs=process.versions.electron?require('original-fs').promises:fs;
const {Library,AUDIO_EXTENSIONS,IMAGE_EXTENSIONS}=require('../core/library.cjs');
const {assignmentCategoryScope}=require('../core/category-scope.cjs');
const {Bridge,resolveManagedPath}=require('../core/bridge.cjs');
const {sha256}=require('../core/files.cjs');
const {PreviewQueue}=require('../core/preview.cjs');
const {createSync}=require('./host-sync.cjs');
const {isWithin}=require(path.join(__dirname,'duplicate-file.cjs'));
const {locateManagedFile,restoreManagedFileForRetry}=require('../core/managed-file-recovery.cjs');
const {importedAsset,samePath}=require('../core/independent-copy.cjs');
const {documentImportOptions}=require('../core/document-import-options.cjs');
const {isTheme}=require('./themes.cjs');
const {prepareImageTransfer}=require('./image-transfer.cjs');

function animateFilename(asset) {
  let stem = String(asset.name || asset.originalName || '未命名素材').replace(/\.fla$/i, '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 150).replace(/[. ]+$/g, '');
  if (!stem) stem = '未命名素材';
  if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(stem)) stem = '_' + stem;
  return stem + '.fla';
}

async function isOriginalFile(file,asset){
  const extensions=asset.kind==='audio'?AUDIO_EXTENSIONS:asset.kind==='image'?IMAGE_EXTENSIONS:['.fla'];
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

async function createHost({root,render,convertToPng,validateImage=async()=>true,createPoster=async()=>false,pickFiles=async()=>[],pickFolder=async()=>[],pickPreviewFile=async()=>[],pickDuplicateFolder=async()=>[],confirmDuplicate=async()=>true,compact=async()=>false,openPluginFolder=async()=>{},openInAnimate=async()=>{throw new Error('当前环境无法打开 Animate');},revealFile=async()=>{throw new Error('当前环境无法打开文件所在位置');},setTheme=async theme=>theme,windowAction=async()=>({maximized:false}),previewUrl=id=>`anshelf://preview/${id}`,mediaUrl=id=>`anshelf://media/${id}`,posterUrl=id=>`anshelf://poster/${id}`,demoPath=path.join(__dirname,'../demo'),now=Date.now,previewCleanupTimers=timers}){
  const library=await Library.open(root);const bridge=new Bridge(root);
  let cleanupTimer=null,closed=false,cleaning=false,cleanupRetryAt=0;
  function scheduleCleanup(){
    if(closed||cleaning)return;
    if(cleanupTimer!==null){previewCleanupTimers.clearTimeout(cleanupTimer);cleanupTimer=null;}
    const due=library.nextPreviewCleanupAt(now());
    if(due===null)return;
    const delay=Math.min(2147483647,Math.max(0,due-now(),cleanupRetryAt-now()));
    cleanupTimer=previewCleanupTimers.setTimeout(()=>{cleanupTimer=null;return cleanupPreviews();},delay);
    cleanupTimer?.unref?.();
  }
  async function cleanupPreviews(){
    if(closed)return;
    cleaning=true;
    try{const result=await library.cleanupExpiredPreviews(now());cleanupRetryAt=result.failed?.length?now()+60000:0;}
    catch{cleanupRetryAt=now()+60000;}
    finally{cleaning=false;scheduleCleanup();}
  }
  const change=library.change.bind(library);
  library.change=(...args)=>change(...args).then(result=>{scheduleCleanup();return result;});
  await cleanupPreviews();
  const queue=new PreviewQueue(library,render,scheduleCleanup);
  const snapshot=async(status={})=>{const data=library.snapshot();return{...data,assets:data.assets.map(a=>({...a,
    mediaUrl:a.kind==='audio'?mediaUrl(a.id):null,
    previewPosterUrl:a.previewPosterPath?posterUrl(a.id)+'?v='+encodeURIComponent(a.previewRevision||a.id):null,
    previewUrl:a.previewStatus==='ready'?previewUrl(a.id)+'?v='+encodeURIComponent(a.previewRevision||a.previewPath||a.id):null})),queue:status.queue||queue.snapshot(),bridge:status.bridge||await bridge.status()};};
  const sync=createSync({library,queue,bridge,snapshot});
  async function validatedAsset(id,animateFilename=null){
    let a=typeof id==='string'?library.getAsset(id):null;
    if(!a)throw new Error('请选择素材库中存在的素材');
    if(a.kind!=='audio'&&a.kind!=='image'){
      if(typeof a.managedPath!=='string'||path.extname(a.managedPath).toLowerCase()!=='.fla')throw new Error('只能使用受管理的 FLA 素材');
      const reconciled=await library.reconcileManagedFile(id,animateFilename);
      a=reconciled.asset;
      if(reconciled.contentChanged)queue.add([a],true);
    }
    const file=resolveManagedPath(bridge.root,a.managedPath,'assets');
    const extension=path.extname(file).toLowerCase();
    const extensions=a.kind==='audio'?AUDIO_EXTENSIONS:a.kind==='image'?IMAGE_EXTENSIONS:['.fla'];
    if(!extensions.includes(extension))throw new Error('受管理素材文件格式无效，FLA、音频或图片格式不匹配');
    if((a.kind==='audio'||a.kind==='image')&&extension!==a.extension)throw new Error(a.kind==='image'?'图片扩展名与记录不一致':'音频扩展名与记录不一致');
    if(await sha256(file)!==a.hash)throw new Error('素材完整性校验失败，请重新导入');
    return{a,file};
  }
  async function importPaths(paths,options={}){
    if(!Array.isArray(paths)||paths.some(p=>typeof p!=='string'))throw new Error('导入路径无效');
    if(options.groupByFolder!==undefined&&(typeof options.groupByFolder!=='boolean'||options.groupByFolder&&options.mode!=='image'))throw new Error('按文件夹分组仅支持图片导入，选项须为布尔值');
    // Explicitly selecting an already registered managed file must keep its
    // identity. The recursive importer still excludes the whole library root.
    const knownAssets=library.snapshot().assets;
    for(const file of paths){
      const known=knownAssets.find(a=>samePath(path.resolve(library.root,a.managedPath),file));
      if(known)await validatedAsset(known.id);
    }
    const result=await library.importPaths(paths,{mode:options.mode===undefined?'ordinary':options.mode,preferExistingPreview:options.preferExistingPreview!==false,previewResolution:options.previewResolution,categoryId:options.categoryId,groupByFolder:options.groupByFolder});
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
    const pending=(result.assets||[]).map(a=>library.getAsset(a.id)).filter(a=>a&&a.kind!=='audio'&&a.kind!=='image'&&a.previewStatus==='pending');
    queue.add(pending,true);
    return result;
  }
  async function importCurrentDocument(file,value){
    const options=documentImportOptions(value);
    if(!await isOriginalFile(file,{kind:'fla'}))throw new Error('请选择已保存、存在且不含链接的 FLA 文件路径');
    const canonical=await nativeFs.realpath(file);
    const canonicalRoot=await nativeFs.realpath(bridge.root);
    if(isWithin(canonicalRoot,canonical)){
      const existing=library.snapshot().assets.find(a=>path.relative(path.resolve(canonicalRoot,a.managedPath),canonical)==='');
      if(!existing)throw new Error('该文件位于素材库内，但尚未登记，不能从插件重复导入');
      const configured=await library.configureDocumentImport(existing.id,options);
      const reconciled=await library.reconcileManagedFile(existing.id);
      if(reconciled.contentChanged||configured.previewChanged)queue.add([reconciled.asset],true);
      return{assetId:existing.id,name:reconciled.asset.name,updated:reconciled.contentChanged||configured.previewChanged,duplicate:true};
    }
    // Re-adding an existing effect must not change it to ordinary or clear its categories.
    const hash=await sha256(canonical);
    const existing=importedAsset(library.snapshot().assets,library.root,canonical,hash,'fla');
    if(existing){
      const configured=await library.configureDocumentImport(existing.id,options);
      if(configured.previewChanged)queue.add([configured.asset],true);
      return library.change(state=>{
        const asset=state.assets.find(a=>a.id===existing.id&&a.hash===hash);
        if(!asset)throw new Error('素材库记录已变化，请重新加入当前文档');
        if(!asset.sourcePaths.includes(canonical))asset.sourcePaths.push(canonical);
        return{assetId:asset.id,name:asset.name,updated:configured.previewChanged,duplicate:true};
      },false);
    }
    const result=await importPaths([canonical],{mode:'ordinary',preferExistingPreview:true,...options,categoryId:options?.categoryId||undefined});
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
    createCategory:async(name,parentId=null,scope='all')=>library.createCategory(name,parentId,scope),createProject:async(name)=>library.createProject(name),renameCategory:async(id,name,parentId=undefined)=>library.renameCategory(id,name,parentId),deleteCategory:async(id)=>library.deleteCategory(id),
    setCategoryPinned:async(id,pinned)=>library.setCategoryPinned(id,pinned),
    updateAsset:async(id,patch)=>library.updateAsset(id,patch),removeAssets:async(ids)=>library.removeAssets(ids),
    createSceneGroup:async(name,ids)=>library.createSceneGroup(name,ids),
    updateSceneGroup:async(id,patch)=>library.updateSceneGroup(id,patch),
    deleteSceneGroup:async(id)=>library.deleteSceneGroup(id),
    retryPreview:async(id)=>{const a=library.getAsset(id);if(!a)throw new Error('素材不存在');if(a.kind==='audio'||a.kind==='image')throw new Error(a.kind==='image'?'图片直接使用原图预览，无需生成 FLA 预览':'音频不需要生成预览图');await restoreManagedFileForRetry(library.root,a);await library.reconcileManagedFile(id);await library.setPreview(id,{previewStatus:'pending',previewError:null});queue.add([library.getAsset(id)],true);return true;},
    replacePreview:async(id)=>{
      const a=typeof id==='string'?library.getAsset(id):null;
      if(!a)throw new Error('请选择素材库中存在的素材');
      if(a.kind==='audio'||a.kind==='image')throw new Error(a.kind==='image'?'图片直接使用原图预览':'音频不需要更换预览图');
      const files=await pickPreviewFile({name:a.name||a.originalName});
      if(!Array.isArray(files)||files.length===0)return{cancelled:true};
      if(files.length!==1||typeof files[0]!=='string')throw new Error('请选择一张本地预览图片');
      const asset=await library.replacePreview(id,files[0],{validateImage,createPoster});
      queue.cancel(id);
      return{cancelled:false,assetId:id,asset};
    },
    restorePreview:async(id)=>{
      const a=typeof id==='string'?library.getAsset(id):null;
      if(!a)throw new Error('请选择素材库中存在的素材');
      if(a.kind==='audio'||a.kind==='image')throw new Error(a.kind==='image'?'图片直接使用原图预览':'音频不需要恢复预览图');
      const asset=await library.restorePreview(id);
      queue.cancel(id);
      return{cancelled:false,assetId:id,asset};
    },
    send:async(id)=>{const {a}=await validatedAsset(id);if(a.kind==='audio')throw new Error('音频请拖入 AN');return bridge.send(a.kind==='image'?(await prepareImageTransfer(root,a,convertToPng)).asset:a);},
    sendStageDrop:async(id,target)=>{const {a}=await validatedAsset(id);if(a.kind==='audio'||a.kind==='image')throw new Error('舞台拖动只支持 FLA');return bridge.sendStageDrop(a,target);},
    prepareDrag:async(id)=>{
      const {a,file}=await validatedAsset(id);
      if(a.kind==='audio')return{file,kind:'audio'};
      if(a.kind==='image')return{file:(await prepareImageTransfer(root,a,convertToPng)).file,kind:'image'};
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
        const extensions=a.kind==='audio'?AUDIO_EXTENSIONS:a.kind==='image'?IMAGE_EXTENSIONS:['.fla'];
        if(!extensions.includes(path.extname(file).toLowerCase()))throw new Error('受管理副本必须是 FLA、受支持音频或图片文件');
      }catch(error){throw new Error('原始文件不可用，库中副本也无法定位：'+error.message);}
      await revealFile(file);return{location:'managed',...(a.independentCopy?{independentCopy:true}:{})};
    },
    duplicateInFolder:async(id,options={})=>{
      const a=typeof id==='string'?library.getAsset(id):null;
      if(!a)throw new Error('请选择素材库中存在的素材');
      if(!options||typeof options!=='object'||Array.isArray(options))throw new Error('复制分类设置无效');
      const copyOptions={},categoryId=Object.hasOwn(options,'categoryId')?options.categoryId:undefined;
      let categoryLabel='沿用原分类';
      if(categoryId!==undefined){
        if(categoryId!==null&&(typeof categoryId!=='string'||!categoryId))throw new Error('复制目标分类无效');
        if(categoryId!==null){
          const categories=library.snapshot().categories,target=categories.find(item=>item.id===categoryId);
          if(!target)throw new Error('复制目标分类不存在');
          const scope=assignmentCategoryScope(categories,categoryId);
          if(scope!=='all'&&scope!==(a.assetType||'ordinary'))throw new Error('素材类型与复制目标分类类型不匹配');
          categoryLabel=target.name;
        }else categoryLabel='未分类';
        copyOptions.categoryId=categoryId;
      }
      const managed=a.kind==='audio'||a.kind==='image'?resolveManagedPath(bridge.root,a.managedPath,'assets'):(await locateManagedFile(bridge.root,a)).file;
      const extension=path.extname(managed).toLowerCase();
      const extensions=a.kind==='audio'?AUDIO_EXTENSIONS:a.kind==='image'?IMAGE_EXTENSIONS:['.fla'];
      if(!extensions.includes(extension))throw new Error('受管理素材文件格式无效，FLA、音频或图片格式不匹配');
      if((a.kind==='audio'||a.kind==='image')&&extension!==a.extension)throw new Error(a.kind==='image'?'图片扩展名与记录不一致':'音频扩展名与记录不一致');
      const directory=path.join(library.root,'assets');
      if(!await confirmDuplicate({name:a.name||a.originalName,directory,extension,categoryLabel}))return{cancelled:true};
      // Reconcile saved AN edits only after confirmation; cancelling must be read-only.
      await validatedAsset(id);
      const copy=await library.duplicateAsset(id,copyOptions);
      if(copy.kind!=='image'&&copy.previewStatus==='pending')queue.add([copy],true);
      const file=library.assetPath(copy.id);
      let revealError=null;
      try{await revealFile(file);}catch(error){revealError=error.message;}
      return{file,assetId:copy.id,name:copy.name,cancelled:false,revealError};
    },
    openInAnimate:async(id)=>{
      const a=library.getAsset(id);if(!a)throw new Error('请先选择一个素材');
      if(a.kind==='audio'||a.kind==='image')throw new Error('只能在 AN 中打开 FLA 素材，音频和图片请另行导入');
      const {file}=await validatedAsset(id,animateFilename(a));
      return openInAnimate(file);
    },
    setTheme:async(theme)=>{if(!isTheme(theme))throw new Error('主题无效');return setTheme(theme);},
    windowAction:async(action)=>{if(!['minimize','maximize','close'].includes(action))throw new Error('窗口操作无效');return windowAction(action);},
    status:async()=>bridge.status(),
    demo:async()=>importPaths([demoPath],{preferExistingPreview:true}),compact,openPluginFolder
  };
  queue.add(library.snapshot().assets.filter(a=>a.kind!=='audio'&&a.kind!=='image'&&a.previewStatus==='pending'));
  return{api,library,bridge,queue,root,importCurrentDocument,close:()=>{closed=true;if(cleanupTimer!==null)previewCleanupTimers.clearTimeout(cleanupTimer);cleanupTimer=null;}};
}
module.exports={createHost,animateFilename};
