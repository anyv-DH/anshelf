/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const {app,BrowserWindow,dialog,ipcMain,protocol,net,shell,nativeImage,session,screen}=require('electron');
const path=require('node:path');
const fs=require('node:fs/promises');
const {spawn}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const {createHost}=require('./host.cjs');
const {createRenderer}=require('./previews.cjs');
const {createMediaResponse}=require('./media.cjs');
const {registerNativeDrag}=require('./native-drag.cjs');
const {registerStageDrag,createNativeTargetProbe}=require('./stage-drag.cjs');
const {createWindowMode}=require('./window-mode.cjs');
const {createGifPoster}=require('./gif-poster.cjs');
const {resolveManagedPath}=require('../core/bridge.cjs');
const {createAnimateLauncher}=require('./animate-launcher.cjs');
protocol.registerSchemesAsPrivileged([{scheme:'anshelf',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
let win,host;
async function openAnimateFile(file){
  const executable=process.env.ANSHELF_ANIMATE_EXE;
  if(executable){
    if(!path.isAbsolute(executable)||path.extname(executable).toLowerCase()!=='.exe')throw new Error('配置的 Animate 程序无效');
    let valid=false;try{valid=(await fs.stat(executable)).isFile();}catch{}
    if(!valid)throw new Error('配置的 Animate 程序无效');
    await new Promise((resolve,reject)=>{const child=spawn(executable,[file],{shell:false,detached:true,stdio:'ignore',windowsHide:true});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});});
    return true;
  }
  const error=await shell.openPath(file);
  if(error)throw new Error('无法在 AN 中打开素材：'+error+'。请检查 FLA 默认关联，或设置 ANSHELF_ANIMATE_EXE。');
  return true;
}
if(!app.requestSingleInstanceLock())app.quit();
app.on('second-instance',()=>{if(win){win.show();win.focus();}});
app.whenReady().then(async()=>{
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_request,callback)=>callback({cancel:true}));
  const root=process.env.ANSHELF_DATA_DIR||path.join(app.getPath('appData'),'AnShelf');
  const animateLauncher=createAnimateLauncher({executable:process.env.ANSHELF_ANIMATE_EXE});
  win=new BrowserWindow({width:1480,height:940,minWidth:850,minHeight:600,frame:false,icon:path.join(__dirname,'icon.ico'),backgroundColor:'#171520',title:'安安素材管理器',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false}});
  const windowMode=createWindowMode(win);
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(event,url)=>{if(!url.startsWith('file:'))event.preventDefault();});
  host=await createHost({root,render:createRenderer(root),createPoster:createGifPoster({BrowserWindow,ipcMain,nativeImage}),validateImage:async file=>{const image=nativeImage.createFromPath(file);if(image.isEmpty())return false;const size=image.getSize();return size.width>0&&size.height>0&&size.width<=20000&&size.height<=20000;},
    pickFiles:async({mode='ordinary'}={})=>{if(!['ordinary','effect','audio'].includes(mode))throw new Error('导入模式无效');const audio=mode==='audio';const r=await dialog.showOpenDialog(win,{title:audio?'导入音频':mode==='effect'?'导入特效素材':'导入普通素材',properties:['openFile','multiSelections'],filters:[{name:audio?'音频文件':'Adobe Animate 素材',extensions:audio?['mp3','wav','ogg','flac']:['fla']}]});return r.canceled?[]:r.filePaths;},
    pickFolder:async({mode='ordinary'}={})=>{if(!['ordinary','effect','audio'].includes(mode))throw new Error('导入模式无效');const r=await dialog.showOpenDialog(win,{title:mode==='audio'?'选择音频文件夹':mode==='effect'?'选择特效素材文件夹':'选择素材文件夹',properties:['openDirectory']});return r.canceled?[]:r.filePaths;},
    compact:async()=>windowMode.toggleCompact(),
    openInAnimate:openAnimateFile,
    ensureAnimateRunning:()=>animateLauncher.ensureRunning(),
    onImportNotice:message=>{if(!win.isDestroyed())win.webContents.send('shelf:import-notice',message);},
    revealFile:async file=>{shell.showItemInFolder(file);},
    setTheme:async(theme)=>{win.setBackgroundColor(theme==='warm'?'#f7f1e9':'#171520');return theme;},
    windowAction:async(action)=>windowMode.action(action),
    openPluginFolder:async()=>{const error=await shell.openPath(app.isPackaged?path.join(process.resourcesPath,'AnimatePlugin'):path.join(app.getAppPath(),'plugin'));if(error)throw new Error('无法打开 AN 面板文件夹：'+error);return true;}});
  protocol.handle('anshelf',request=>{try{const url=new URL(request.url);if(url.hostname==='media')return createMediaResponse(request,host.library);const id=decodeURIComponent(url.pathname.slice(1));if(!/^[\w-]{1,128}$/.test(id))return new Response('',{status:404});let preview;if(url.hostname==='poster'){const asset=host.library.getAsset(id);if(!asset?.previewPosterPath)return new Response('',{status:404});preview=resolveManagedPath(host.library.root,asset.previewPosterPath,'previews');if(path.extname(preview).toLowerCase()!=='.png')return new Response('',{status:404});}else if(url.hostname==='preview')preview=host.library.previewPath(id);else return new Response('',{status:404});if(!preview)return new Response('',{status:404});return net.fetch(pathToFileURL(preview).toString());}catch{return new Response('',{status:404});}});
  ipcMain.handle('shelf:call',async(event,method,args)=>{if(event.sender!==win.webContents||typeof method!=='string'||!Array.isArray(args)||['importPaths','prepareDrag','sendStageDrop'].includes(method)||!Object.hasOwn(host.api,method))throw new Error('操作不允许');return host.api[method](...args);});
  registerNativeDrag({ipcMain,webContents:win.webContents,prepareDrag:id=>host.api.prepareDrag(id),createIcon:kind=>nativeImage.createFromPath(path.join(__dirname,kind==='audio'?'drag-audio.png':'icon.png')).resize({width:32,height:32}),reportError:message=>{if(!win.isDestroyed())win.webContents.send('shelf:drag-error',message);}});
  const helperPath=app.isPackaged?path.join(process.resourcesPath,'StageTarget','stage-target.exe'):path.join(__dirname,'native','stage-target.exe');
  try {
    const monitor=createNativeTargetProbe({helperPath});
    registerStageDrag({ipcMain,webContents:win.webContents,sourceWindow:win,getAsset:id=>host.library.getAsset(id),getBridgeStatus:()=>host.bridge.status(),sendStageDrop:(id,target)=>host.api.sendStageDrop(id,target),monitor,screen,getAnimatePids:()=>monitor.getAnimatePids(),onResult:result=>{if(!win.isDestroyed())win.webContents.send('shelf:stage-drag-result',result);}});
  } catch (error) { win.webContents.once?.('did-finish-load',()=>win.webContents.send('shelf:drag-error','舞台拖动暂不可用：'+String(error.message||error))); }
  await win.loadFile(path.join(__dirname,'../dist/index.html'));
}).catch(error=>{dialog.showErrorBox('安安素材管理器启动失败',error.message);app.quit();});
app.on('window-all-closed',()=>app.quit());
