/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const jobs = new Map();
const registered = new WeakSet();
const MAX_GIF_BYTES = 32 * 1024 * 1024;

function createGifPoster({ BrowserWindow, ipcMain, nativeImage }) {
  if (!registered.has(ipcMain)) {
    registered.add(ipcMain);
    ipcMain.handle('poster:input', event => {
      const job = jobs.get(event.sender.id);
      if (!job) throw new Error('封面任务不存在');
      return new Uint8Array(job.bytes);
    });
    ipcMain.on('poster:done', (event, result) => {
      const job = jobs.get(event.sender.id);
      if (job) job.finish(null, result);
    });
  }
  return async (source, destination) => {
    const stat = await fs.stat(source);
    if (!stat.isFile() || stat.size > MAX_GIF_BYTES) throw new Error('GIF超过32MB，无法生成封面');
    const bytes = await fs.readFile(source);
    if (bytes.length > MAX_GIF_BYTES || !['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) throw new Error('GIF文件格式无效');
    const result = await new Promise((resolve, reject) => {
      const worker = new BrowserWindow({ show: false, width: 32, height: 32, webPreferences: { preload: path.join(__dirname, 'gif-poster-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
      const id = worker.webContents.id;
      const timer = setTimeout(() => finish(new Error('GIF封面生成超时')), 15000);
      function finish(error, value) {
        if (!jobs.has(id)) return;
        jobs.delete(id); clearTimeout(timer);
        if (!worker.isDestroyed()) worker.destroy();
        error ? reject(error) : resolve(value);
      }
      jobs.set(id, { bytes, finish });
      worker.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      worker.webContents.on('render-process-gone', () => finish(new Error('GIF封面处理进程退出')));
      worker.loadFile(path.join(__dirname, 'gif-poster.html')).catch(finish);
    });
    if (!result || result.error || typeof result.png !== 'string' || !result.png.startsWith('data:image/png;base64,') || result.png.length > 8 * 1024 * 1024) throw new Error(result?.error || 'GIF封面结果无效');
    const png = Buffer.from(result.png.split(',')[1], 'base64');
    const image = nativeImage.createFromBuffer(png);
    if (image.isEmpty()) throw new Error('GIF封面图片无效');
    const size = image.getSize();
    if (size.width < 1 || size.height < 1 || size.width > 640 || size.height > 640) throw new Error('GIF封面尺寸无效');
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try { await fs.writeFile(temporary, png, { flag: 'wx' }); await fs.rename(temporary, destination); }
    finally { await fs.rm(temporary, { force: true }); }
    return true;
  };
}

module.exports = { createGifPoster };
