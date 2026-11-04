/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
'use strict';
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const { atomicJson } = require('../core/files.cjs');
const MAX_DESCRIPTOR_BYTES = 16384;
const REQUEST_TTL = 120000;
const ID = /^[a-zA-Z0-9-]{1,80}$/;

async function noLinks(file) {
  let cursor = path.resolve(file);
  while (true) {
    try {
      if ((await fsp.lstat(cursor)).isSymbolicLink()) throw new Error('路径包含符号链接，请使用实际 FLA 文件');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(cursor);
    if (parent === cursor) return;
    cursor = parent;
  }
}

async function createDocumentImportReceiver({ root, importDocument, onResult = () => {} }) {
  if (typeof importDocument !== 'function') throw new Error('缺少当前文档导入处理器');
  const base = path.join(path.resolve(root), 'bridge/document-import');
  const inbox = path.join(base, 'inbox'), results = path.join(base, 'results');
  for (const directory of [inbox, results]) {
    await noLinks(directory);
    await fsp.mkdir(directory, { recursive: true });
    await noLinks(directory);
  }
  let closed = false, requested = false, running = null;

  async function consume(name) {
    const requestId = name.slice(0, -5);
    if (!ID.test(requestId)) return;
    const file = path.join(inbox, name), receipt = path.join(results, name);
    let result;
    try {
      await noLinks(file);
      await noLinks(receipt);
      // A crash after writing the receipt must not repeat an import on restart.
      try { await fsp.access(receipt); await fsp.unlink(file); return; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const stat = await fsp.lstat(file);
      if (!stat.isFile() || stat.size > MAX_DESCRIPTOR_BYTES) throw new Error('当前文档导入请求过大或不是普通文件');
      const handle = await fsp.open(file, 'r');
      const bytes = Buffer.alloc(MAX_DESCRIPTOR_BYTES + 1);
      let count;
      try { count = (await handle.read(bytes, 0, bytes.length, 0)).bytesRead; }
      finally { await handle.close(); }
      if (count > MAX_DESCRIPTOR_BYTES) throw new Error('当前文档导入请求过大');
      const request = JSON.parse(bytes.subarray(0, count).toString('utf8'));
      if (!request || Array.isArray(request) || Object.keys(request).sort().join(',') !== 'createdAt,file,requestId,version'
        || request.version !== 1 || request.requestId !== requestId
        || !Number.isSafeInteger(request.createdAt) || request.createdAt > Date.now() + 5000 || Date.now() - request.createdAt > REQUEST_TTL) throw new Error('当前文档导入请求无效或已过期，请重新点击加入素材库');
      if (typeof request.file !== 'string' || request.file.includes('\0') || !path.isAbsolute(request.file)
        || path.extname(request.file).toLowerCase() !== '.fla') throw new Error('请先将当前文档保存为本地 FLA 文件');
      await noLinks(request.file);
      const source = await fsp.stat(request.file);
      if (!source.isFile() || source.size > 512 * 1024 * 1024) throw new Error('当前 FLA 不存在或超过 512 MB 导入上限');
      const imported = await importDocument(request.file);
      if (!imported || typeof imported.assetId !== 'string') throw new Error('当前文档未能加入素材库');
      result = { version: 1, requestId, completedAt: Date.now(), ok: true, assetId: imported.assetId, name: String(imported.name || ''), updated: Boolean(imported.updated), duplicate: Boolean(imported.duplicate), reused: Boolean(imported.reused || imported.duplicate || imported.updated) };
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Only a removed request means the panel cancelled. A missing source
        // or importer dependency still needs a receipt instead of a timeout.
        try { await fsp.lstat(file); }
        catch (missing) { if (missing.code === 'ENOENT') return; throw missing; }
      }
      const message = error.code === 'ENOENT' ? '当前 FLA 或导入所需文件不存在，请重新保存文档后再加入素材库' : error.message || error;
      result = { version: 1, requestId, completedAt: Date.now(), ok: false, error: String(message).slice(0, 1000) };
    }
    await noLinks(receipt);
    await atomicJson(receipt, result);
    await fsp.unlink(file).catch(error => { if (error.code !== 'ENOENT') throw error; });
    try { await onResult(result); } catch { /* A notification cannot repeat a successful import. */ }
  }

  function drain() {
    if (closed) return Promise.resolve();
    requested = true;
    if (!running) running = (async () => {
      while (requested && !closed) {
        requested = false;
        await noLinks(inbox);
        const names = (await fsp.readdir(inbox)).filter(name => name.endsWith('.json')).sort();
        for (const name of names) {
          if (closed) break;
          await consume(name);
        }
      }
    })().finally(() => { running = null; });
    return running;
  }
  const watcher = fs.watch(inbox, () => { drain().catch(() => {}); });
  watcher.unref();
  watcher.on('error', () => { watcher.close(); });
  try { await drain(); } catch (error) { watcher.close(); throw error; }
  return { drain, async close() { closed = true; watcher.close(); if (running) await running; } };
}

module.exports = { createDocumentImportReceiver };
