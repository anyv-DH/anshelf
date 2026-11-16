/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const fs = require('node:fs/promises');
const path = require('node:path');
const { insidePath } = require('./files.cjs');

const PREVIEW_RETENTION_MS = 48 * 60 * 60 * 1000;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const PREVIEW_HISTORY_FIELDS = new Set(['previewPath', 'previewPosterPath', 'previewOrigin', 'previewFormat', 'previewAnimated',
  'previewFrameCount', 'previewDurationMs', 'previewWarning', 'width', 'height', 'frames', 'frameRate', 'scene', 'frame',
  'previewStatus', 'previewError']);

function cachePath(root, relative) {
  if (typeof relative !== 'string' || relative.includes('\0') || relative.split(/[\\/]/).includes('..')) throw new Error('预览缓存路径无效');
  const file = insidePath(root, relative);
  const within = path.relative(path.join(root, 'previews'), file);
  if (!within || within === '..' || within.startsWith('..' + path.sep) || path.isAbsolute(within)
    || !IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase())) throw new Error('预览缓存必须是 previews 内的图片');
  return file;
}

function cacheKey(root, relative) {
  const file = cachePath(root, relative);
  return process.platform === 'win32' ? file.toLowerCase() : file;
}

async function rejectLinks(file) {
  let cursor = path.resolve(file);
  while (true) {
    try { if ((await fs.lstat(cursor)).isSymbolicLink()) throw new Error('预览图片路径包含链接'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}

function previewPaths(asset) {
  return [...new Set([asset?.previewPath, asset?.previewPosterPath].filter(Boolean))];
}

function protectedPreviews(state, root, now = Date.now()) {
  const protectedPaths = new Set();
  const include = asset => {
    for (const relative of previewPaths(asset)) {
      try { protectedPaths.add(cacheKey(root, relative)); } catch { /* Legacy non-cache paths are never deletion candidates. */ }
    }
  };
  state.assets.forEach(include);
  // Removal undo restores a whole record. Metadata undo intentionally ignores
  // preview fields, and creation undo removes its asset rather than restoring it.
  for (const changes of state.history) for (const change of changes) {
    if (change.collection === 'assets' && change.before && !change.after) include(change.before);
  }
  for (const item of state.previewHistory || []) if (item.expiresAt > now) include(item.preview);
  return protectedPaths;
}

function retireReplacedPreviews(before, after, root, now = Date.now(), recordHistory = true) {
  const retired = new Map((after.retiredPreviews || []).map(item => [cacheKey(root, item.path), item]));
  const currentAssets = new Map(after.assets.map(asset => [asset.id, asset]));
  for (const oldAsset of before.assets) {
    const current = currentAssets.get(oldAsset.id);
    if (!current) continue; // Library removal retains its existing undo contract.
    const currentPaths = new Set(previewPaths(current).map(relative => { try { return cacheKey(root, relative); } catch { return relative; } }));
    let replaced = false;
    for (const relative of previewPaths(oldAsset)) {
      let key;
      try { key = cacheKey(root, relative); } catch { continue; }
      if (!currentPaths.has(key)) { retired.set(key, { path: relative, deleteAfter: now + PREVIEW_RETENTION_MS }); replaced = true; }
    }
    if (replaced && recordHistory && oldAsset.previewPath) {
      const preview = {};
      for (const key of ['previewPath', 'previewPosterPath', 'previewOrigin', 'previewFormat', 'previewAnimated',
        'previewFrameCount', 'previewDurationMs', 'previewWarning', 'width', 'height', 'frames', 'frameRate', 'scene', 'frame']) preview[key] = oldAsset[key] ?? null;
      // Old pending/failed states can still point to the previous usable image.
      preview.previewStatus = 'ready'; preview.previewError = null;
      const history = after.previewHistory || (after.previewHistory = []);
      history.push({ assetId: oldAsset.id, preview, expiresAt: now + PREVIEW_RETENTION_MS });
    }
  }
  if (retired.size || after.retiredPreviews) after.retiredPreviews = [...retired.values()];
}

function retireUnusedPreview(state, root, output, now = Date.now()) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) throw new Error('未使用的预览记录无效');
  // Validate the complete result before changing state, including a poster that
  // might accompany an otherwise valid image. Never register source payloads.
  const paths = previewPaths(output).map(relative => ({ relative, key: cacheKey(root, relative) }));
  const protectedPaths = protectedPreviews(state, root, now);
  const retired = new Map((state.retiredPreviews || []).map(item => [cacheKey(root, item.path), item]));
  const added = [];
  for (const { relative, key } of paths) {
    if (protectedPaths.has(key) || retired.has(key)) continue;
    retired.set(key, { path: relative, deleteAfter: now + PREVIEW_RETENTION_MS });
    added.push(relative);
  }
  if (added.length) state.retiredPreviews = [...retired.values()];
  return added;
}

function validateRetiredPreviews(state, root) {
  if (state.retiredPreviews !== undefined && !Array.isArray(state.retiredPreviews)) throw new Error('旧预览清理记录无效');
  for (const item of state.retiredPreviews || []) {
    if (!item || !Number.isSafeInteger(item.deleteAfter) || item.deleteAfter < 0) throw new Error('旧预览清理时间无效');
    cachePath(root, item.path);
  }
  if (state.previewHistory !== undefined && !Array.isArray(state.previewHistory)) throw new Error('预览撤回记录无效');
  for (const item of state.previewHistory || []) {
    if (!item || typeof item.assetId !== 'string' || !item.preview?.previewPath || !Number.isSafeInteger(item.expiresAt) || item.expiresAt < 0) throw new Error('预览撤回记录无效');
    if (Object.keys(item.preview).some(key => !PREVIEW_HISTORY_FIELDS.has(key))) throw new Error('预览撤回记录含不可修改的字段');
    previewPaths(item.preview).forEach(relative => cachePath(root, relative));
  }
}

function nextPreviewCleanupAt(state, root, now = Date.now()) {
  const protectedPaths = protectedPreviews(state, root, now);
  const deadlines = (state.retiredPreviews || []).filter(item => !protectedPaths.has(cacheKey(root, item.path))).map(item => item.deleteAfter);
  deadlines.push(...(state.previewHistory || []).map(item => item.expiresAt));
  return deadlines.length ? Math.min(...deadlines) : null;
}

async function cleanRetiredPreviews(state, root, now) {
  if (state.previewHistory) state.previewHistory = state.previewHistory.filter(item => item.expiresAt > now);
  const protectedPaths = protectedPreviews(state, root, now);
  const keep = [], deleted = [], failed = [];
  for (const item of state.retiredPreviews || []) {
    if (item.deleteAfter > now || protectedPaths.has(cacheKey(root, item.path))) { keep.push(item); continue; }
    try {
      const file = cachePath(root, item.path);
      await rejectLinks(file);
      try {
        const stat = await fs.lstat(file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) throw new Error('旧预览不是独立的普通文件');
        const [canonical, directory] = await Promise.all([fs.realpath(file), fs.realpath(path.join(root, 'previews'))]);
        const relative = path.relative(directory, canonical);
        if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('旧预览超出缓存目录');
        await fs.unlink(file);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      deleted.push(item.path);
    } catch (error) { keep.push(item); failed.push({ path: item.path, error: error.message }); }
  }
  if (state.retiredPreviews) state.retiredPreviews = keep;
  return { deleted, pending: keep.length, failed };
}

module.exports = { PREVIEW_RETENTION_MS, IMAGE_EXTENSIONS, cachePath, rejectLinks, retireReplacedPreviews, retireUnusedPreview, validateRetiredPreviews, nextPreviewCleanupAt, cleanRetiredPreviews };
