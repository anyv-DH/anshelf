/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
'use strict';

function registerNativeDrag({ ipcMain, webContents, prepareDrag, createIcon, reportError }) {
  let dragging = false;
  ipcMain.on('shelf:start-drag', async (event, id) => {
    if (event.sender !== webContents || typeof id !== 'string' || !/^[\w-]{1,128}$/.test(id)) return;
    if (dragging) { reportError('已有素材正在拖拽，请完成后再试'); return; }
    dragging = true;
    try {
      const descriptor = await prepareDrag(id);
      if (!descriptor || typeof descriptor.file !== 'string' || descriptor.kind !== 'audio') throw new Error('原生文件拖拽只支持音频，FLA 请使用舞台拖动');
      webContents.startDrag({ file: descriptor.file, icon: createIcon(descriptor.kind) });
    } catch (error) { reportError(String(error.message || '素材无法拖拽').slice(0, 300)); }
    finally { dragging = false; }
  });
}

module.exports = { registerNativeDrag };
