/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const {contextBridge,ipcRenderer}=require('electron');
const methods=['snapshot','sync','importFiles','importFolder','assignCategory','addToCategory','removeFromCategory','removeFromCategories','undo','createCategory','renameCategory','deleteCategory','setCategoryPinned','updateAsset','removeAssets','retryPreview','send','status','demo','compact','openPluginFolder','openInAnimate','revealInFolder','duplicateInFolder','setTheme','windowAction'];
const shelf=Object.fromEntries(methods.map(method=>[method,(...args)=>ipcRenderer.invoke('shelf:call',method,args)]));
shelf.onConfirmRequest=listener=>{
  if(typeof listener!=='function')throw new Error('确认回调无效');
  const handler=(_event,payload)=>listener(payload);
  ipcRenderer.on('shelf:confirm-request',handler);
  return()=>ipcRenderer.removeListener('shelf:confirm-request',handler);
};
shelf.respondConfirm=(requestId,accepted)=>{if(typeof requestId==='string'&&typeof accepted==='boolean')ipcRenderer.send('shelf:confirm-response',requestId,accepted);};
shelf.checkUpdates=options=>ipcRenderer.invoke('shelf:update-check',{manual:options?.manual===true});
shelf.openUpdatePage=()=>ipcRenderer.invoke('shelf:update-open');
shelf.openProjectPage=()=>ipcRenderer.invoke('shelf:project-open');
shelf.pluginStatus=()=>ipcRenderer.invoke('shelf:plugin-status');
shelf.installPlugin=()=>ipcRenderer.invoke('shelf:plugin-install');
shelf.downloadUpdate=()=>ipcRenderer.invoke('shelf:update-download');
shelf.cancelUpdateDownload=()=>ipcRenderer.invoke('shelf:update-cancel');
shelf.launchUpdate=()=>ipcRenderer.invoke('shelf:update-launch');
shelf.revealDownloadedUpdate=()=>ipcRenderer.invoke('shelf:update-reveal');
shelf.onUpdateProgress=listener=>{
  if(typeof listener!=='function')throw new Error('更新进度回调无效');
  const handler=(_event,progress)=>listener(progress);
  ipcRenderer.on('shelf:update-progress',handler);
  return()=>ipcRenderer.removeListener('shelf:update-progress',handler);
};
shelf.onWindowActivity=listener=>{
  if(typeof listener!=='function')throw new Error('窗口状态回调无效');
  const handler=(_event,active)=>listener(active===true);
  ipcRenderer.on('shelf:window-activity',handler);
  return()=>ipcRenderer.removeListener('shelf:window-activity',handler);
};
for(const method of ['getSkin','selectSkin','updateSkin','resetSkin'])shelf[method]=(...args)=>ipcRenderer.invoke('shelf:'+method,...args);
shelf.startDrag=id=>{ipcRenderer.send('shelf:start-drag',id);};
shelf.beginStageDrag=id=>ipcRenderer.invoke('shelf:begin-stage-drag',id);
shelf.endStageDrag=token=>ipcRenderer.invoke('shelf:end-stage-drag',token);
shelf.cancelStageDrag=token=>ipcRenderer.invoke('shelf:cancel-stage-drag',token);
shelf.confirmStageHandoff=token=>ipcRenderer.invoke('shelf:confirm-stage-handoff',token);
shelf.onStageDragResult=listener=>{
  if(typeof listener!=='function')throw new Error('舞台拖动结果回调无效');
  const handler=(_event,result)=>listener(result);
  ipcRenderer.on('shelf:stage-drag-result',handler);
  return()=>ipcRenderer.removeListener('shelf:stage-drag-result',handler);
};
shelf.onDragError=listener=>{
  if(typeof listener!=='function')throw new Error('拖拽错误回调无效');
  const handler=(_event,message)=>listener(String(message));
  ipcRenderer.on('shelf:drag-error',handler);
  return()=>ipcRenderer.removeListener('shelf:drag-error',handler);
};
shelf.onImportNotice=listener=>{
  if(typeof listener!=='function')throw new Error('导入提示回调无效');
  const handler=(_event,message)=>listener(String(message));
  ipcRenderer.on('shelf:import-notice',handler);
  return()=>ipcRenderer.removeListener('shelf:import-notice',handler);
};
contextBridge.exposeInMainWorld('shelf',Object.freeze(shelf));
