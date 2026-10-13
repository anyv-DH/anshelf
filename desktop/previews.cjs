/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const { BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { insidePath } = require('../core/files.cjs');
const { resolveManagedPath } = require('../core/bridge.cjs');
const { normalizePreviewResolution, previewSide } = require('../core/preview-resolution.cjs');

const jobs = new Map();
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_ANIMATION_PIXELS = 24 * 1024 * 1024;
let registered = false;

async function safeDestination(root, relative) {
  const destination = insidePath(root, relative);
  let cursor = destination;
  while (true) {
    try { if ((await fs.lstat(cursor)).isSymbolicLink()) throw new Error('预览路径包含链接'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return destination;
}

function imageBytes(value, format, maxSide = 640) {
  const prefix = `data:image/${format};base64,`;
  if (typeof value !== 'string' || !value.startsWith(prefix) || value.length > MAX_OUTPUT_BYTES * 4 / 3 + 100) throw new Error('预览结果无效');
  const encoded = value.slice(prefix.length);
  if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('预览结果无效');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > MAX_OUTPUT_BYTES) throw new Error('预览结果超过大小限制');
  if (format === 'png') {
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      || bytes.subarray(12, 16).toString('ascii') !== 'IHDR') throw new Error('预览 PNG 无效');
  } else if (bytes.length < 14 || !/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii')) || bytes.at(-1) !== 0x3b) throw new Error('动图 GIF 无效');
  const width = format === 'png' ? bytes.readUInt32BE(16) : bytes.readUInt16LE(6);
  const height = format === 'png' ? bytes.readUInt32BE(20) : bytes.readUInt16LE(8);
  if (width < 1 || height < 1 || width > maxSide || height > maxSide) throw new Error('预览尺寸超过限制');
  return bytes;
}

function register() {
  if (registered) return;
  registered = true;
  ipcMain.handle('preview:input', async event => {
    const job = jobs.get(event.sender.id);
    if (!job) throw new Error('Unknown preview');
    return { bytes: new Uint8Array(await fs.readFile(job.source)), animate: job.animate, warning: job.warning, previewResolution: job.previewResolution, maxSide: job.maxSide };
  });
  ipcMain.on('preview:checkpoint', (event, result) => {
    const job = jobs.get(event.sender.id);
    if (!job || job.checkpoint) return;
    try { imageBytes(result?.png, 'png', job.maxSide); job.checkpoint = result; } catch (_) { /* Invalid worker checkpoints cannot replace final validation. */ }
  });
  ipcMain.on('preview:done', (event, result) => {
    const job = jobs.get(event.sender.id);
    if (job) job.finish(null, result);
  });
}

function createRenderer(root) {
  register();
  return async asset => {
    if (asset.kind === 'audio') throw new Error('音频不进入 FLA 预览生成');
    if (typeof asset.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(asset.id)) throw new Error('素材标识无效');
    const previewResolution = normalizePreviewResolution(asset.previewResolution);
    const maxSide = previewSide(previewResolution);
    const source = resolveManagedPath(root, asset.managedPath, 'assets');
    const stat = await fs.stat(source);
    if (stat.size > 128 * 1024 * 1024) throw new Error('素材超过 128MB，使用同名预览图或拆分后导入');
    const requested = asset.assetType === 'effect';
    const animate = requested && stat.size <= 32 * 1024 * 1024;
    const warning = requested && !animate ? '特效文件超过 32MB，已生成静态预览；可使用同名 GIF' : null;
    const result = await new Promise((resolve, reject) => {
      const win = new BrowserWindow({ show: false, width: 1280, height: 1280, webPreferences: {
        preload: path.join(__dirname, 'worker-preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false,
      } });
      const timer = setTimeout(() => finish(new Error('预览生成超时，可以重试或使用同名预览图')), 45000);
      function finish(error, output) {
        const job = jobs.get(win.webContents.id);
        if (!job) return;
        jobs.delete(win.webContents.id); clearTimeout(timer);
        if (!win.isDestroyed()) win.destroy();
        if ((error || output?.error) && job.checkpoint) resolve({ ...job.checkpoint, previewWarning: '动图生成未完成，已保留静态预览' });
        else if (error) reject(error);
        else resolve(output);
      }
      jobs.set(win.webContents.id, { source, animate, warning, previewResolution, maxSide, finish, checkpoint: null });
      win.webContents.on('render-process-gone', () => finish(new Error('预览处理进程退出')));
      win.loadFile(path.join(__dirname, '../dist/worker.html')).catch(finish);
    });
    if (!result || result.error) throw new Error(result?.error || '预览结果无效');
    const png = imageBytes(result.png, 'png', maxSide);
    const posterPath = `previews/${asset.id}.png`;
    await safeDestination(root, posterPath);
    await fs.mkdir(path.join(root, 'previews'), { recursive: true });
    await fs.writeFile(await safeDestination(root, posterPath), png);
    let animated = false, gif = null, previewWarning = result.previewWarning ?? warning;
    if (animate && result.previewAnimated === true) {
      try {
        gif = imageBytes(result.gif, 'gif', maxSide);
        if (!Number.isInteger(result.previewFrameCount) || result.previewFrameCount < 2 || result.previewFrameCount > 60
          || !Number.isFinite(result.previewDurationMs) || result.previewDurationMs < 20 || result.previewDurationMs > 6000) throw new Error('动图时长或帧数无效');
        if (gif.readUInt16LE(6) * gif.readUInt16LE(8) * result.previewFrameCount > MAX_ANIMATION_PIXELS) throw new Error('动图像素配额超过限制');
        animated = true;
      } catch (_) { previewWarning = '动图输出无效，已保留静态预览'; }
    }
    const previewPath = animated ? `previews/${asset.id}.gif` : posterPath;
    if (animated) await fs.writeFile(await safeDestination(root, previewPath), gif);
    return {
      previewPath, previewPosterPath: animated ? posterPath : null,
      previewFormat: animated ? 'gif' : 'png', previewAnimated: animated,
      previewFrameCount: animated ? result.previewFrameCount : 1,
      previewDurationMs: animated ? result.previewDurationMs : 0,
      previewWarning: typeof previewWarning === 'string' ? previewWarning.slice(0, 500) : null,
      width: result.width, height: result.height, frames: result.frames, frameRate: result.frameRate,
      scene: result.scene, frame: result.frame,
    };
  };
}

module.exports = { createRenderer };
