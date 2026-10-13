/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('previewWorker',{input:()=>ipcRenderer.invoke('preview:input'),checkpoint:result=>ipcRenderer.send('preview:checkpoint',result),done:result=>ipcRenderer.send('preview:done',result)});
