/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
'use strict';
const fs = process.versions.electron ? require('original-fs') : require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Readable } = require('node:stream');
const { atomicJson } = require('../core/files.cjs');
const FORMATS = {
  '.png': ['image', 'image/png'], '.jpg': ['image', 'image/jpeg'], '.jpeg': ['image', 'image/jpeg'],
  '.webp': ['image', 'image/webp'], '.gif': ['gif', 'image/gif'], '.mp4': ['video', 'video/mp4'], '.webm': ['video', 'video/webm']
};
const defaults = () => ({ version: 1, file: null, opacity: 0.55, animated: true, revision: randomUUID() });

async function rejectLinks(file) {
  let current = path.resolve(file);
  while (true) {
    const stat = await fs.promises.lstat(current);
    if (stat.isSymbolicLink()) throw new Error('皮肤文件路径包含链接，请选择实际文件');
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

async function mediaInfo(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || file.includes('\0')) throw new Error('请选择本机图片或视频文件');
  const format = FORMATS[path.extname(file).toLowerCase()];
  if (!format) throw new Error('不支持此格式，请选择 PNG、JPG、JPEG、WebP、GIF 图片或 MP4、WebM 视频');
  await rejectLinks(file);
  const stat = await fs.promises.stat(file);
  if (!stat.isFile() || stat.size === 0) throw new Error('皮肤文件不存在或为空');
  const limit = (format[0] === 'video' ? 300 : 40) * 1024 * 1024;
  if (stat.size > limit) throw new Error(format[0] === 'video' ? '视频不能超过 300 MB' : '图片不能超过 40 MB');
  return { type: format[0], mime: format[1], size: stat.size };
}

function parseRange(value, size) {
  if (value == null) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  let start, end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return null;
    end = Math.min(end, size - 1);
  }
  return { start, end, partial: true };
}

async function createSkinController({ root, pickFile = async () => [] }) {
  await fs.promises.mkdir(root, { recursive: true });
  await rejectLinks(root);
  const settings = path.join(root, 'skin.json');
  let state = defaults();
  try {
    await rejectLinks(settings);
    if ((await fs.promises.stat(settings)).size > 16 * 1024) throw new Error('皮肤设置过大');
    const saved = JSON.parse(await fs.promises.readFile(settings, 'utf8'));
    if (saved.version !== 1 || !(saved.file === null || typeof saved.file === 'string') || !Number.isFinite(saved.opacity) || saved.opacity < 0 || saved.opacity > 0.9 || typeof saved.animated !== 'boolean' || !/^[\w-]{1,128}$/.test(saved.revision)) throw new Error('皮肤设置无效');
    state = { version: 1, file: saved.file, opacity: saved.opacity, animated: saved.animated, revision: saved.revision };
  } catch { /* Missing or invalid settings restore the ordinary theme. */ }

  async function snapshot() {
    const result = { enabled: false, type: null, url: null, opacity: state.opacity, animated: state.animated, revision: state.revision };
    if (state.file) {
      try { const info = await mediaInfo(state.file); Object.assign(result, { enabled: true, type: info.type, url: 'anshelf://skin/background?rev=' + encodeURIComponent(state.revision) }); }
      catch { result.error = '皮肤文件不存在、已失效或无法读取，请重新选择'; }
    }
    return result;
  }
  let mutation = Promise.resolve();
  function save(change) {
    const pending = mutation.then(async () => {
      const next = change(state);
      await rejectLinks(root);
      try { await rejectLinks(settings); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await atomicJson(settings, next);
      state = next;
      return snapshot();
    });
    mutation = pending.catch(() => {});
    return pending;
  }
  return {
    get: snapshot,
    select: async () => {
      const selected = await pickFile();
      const file = Array.isArray(selected) ? selected[0] : selected;
      if (!file) return snapshot();
      await mediaInfo(file);
      return save(previous => ({ ...previous, file, revision: randomUUID() }));
    },
    update: async patch => {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !['opacity', 'animated'].includes(key))) throw new Error('皮肤设置无效');
      if (Object.hasOwn(patch, 'opacity') && (!Number.isFinite(patch.opacity) || patch.opacity < 0 || patch.opacity > 0.9)) throw new Error('遮罩深浅必须在 0% 到 90% 之间');
      if (Object.hasOwn(patch, 'animated') && typeof patch.animated !== 'boolean') throw new Error('动态播放设置无效');
      return save(previous => ({ ...previous, ...patch }));
    },
    reset: () => save(() => defaults()),
    respond: async request => {
      try {
        const url = new URL(request.url);
        if (url.protocol !== 'anshelf:' || url.hostname !== 'skin' || url.pathname !== '/background' || url.searchParams.get('rev') !== state.revision || !state.file) return new Response(null, { status: 404 });
        const method = request.method || 'GET';
        if (!['GET', 'HEAD'].includes(method)) return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
        const info = await mediaInfo(state.file);
        const range = parseRange(request.headers?.get('Range') ?? null, info.size);
        if (!range) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${info.size}`, 'Accept-Ranges': 'bytes' } });
        const headers = { 'Content-Type': info.mime, 'Content-Length': String(range.end - range.start + 1), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
        if (range.partial) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${info.size}`;
        const body = method === 'HEAD' ? null : Readable.toWeb(fs.createReadStream(state.file, { start: range.start, end: range.end }));
        return new Response(body, { status: range.partial ? 206 : 200, headers });
      } catch { return new Response(null, { status: 404 }); }
    }
  };
}

module.exports = { createSkinController };
