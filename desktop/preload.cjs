/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const {contextBridge,ipcRenderer}=require('electron');
const methods=['snapshot','sync','importFiles','importFolder','assignCategory','addToCategory','removeFromCategory','undo','createCategory','renameCategory','deleteCategory','setCategoryPinned','updateAsset','removeAssets','retryPreview','send','status','demo','compact','openPluginFolder','openInAnimate','revealInFolder','setTheme','windowAction'];
const shelf=Object.fromEntries(methods.map(method=>[method,(...args)=>ipcRenderer.invoke('shelf:call',method,args)]));
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
