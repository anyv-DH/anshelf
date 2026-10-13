/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('posterWorker', {
  input: () => ipcRenderer.invoke('poster:input'),
  done: result => ipcRenderer.send('poster:done', result),
});
