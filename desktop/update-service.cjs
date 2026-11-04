/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
'use strict';
const fs = require('node:fs/promises');
const { compareVersions } = require('./update-check.cjs');
const { sha256 } = require('../core/files.cjs');

function createUpdateService({ version, mode, downloader, launch, quit, onProgress, reveal = async () => {} }) {
  let ready = null, launching = false, downloading = false, closed = false, generation = 0;
  return {
    async download() {
      if (closed) throw new Error('更新服务已关闭');
      if (!['installed', 'portable'].includes(mode)) throw new Error('开发环境请使用官方发布页下载更新');
      if (downloading || launching) throw new Error('正在处理更新，请稍候');
      const current = ++generation; downloading = true;
      try {
        ready = null;
        const result = await downloader.start({ mode, onProgress });
        if (closed || current !== generation) throw new Error('更新已取消');
        if (compareVersions(result.version, version) <= 0) throw new Error('您已是最新版本，无需下载；仅能更新到更高版本');
        const stat = await fs.lstat(result.file);
        if (!stat.isFile() || stat.isSymbolicLink() || !/^[a-f0-9]{64}$/.test(result.sha256 || '')) throw new Error('更新文件校验失败，请重新下载');
        if (await sha256(result.file) !== result.sha256) throw new Error('更新文件校验失败，请重新下载');
        if (closed || current !== generation) throw new Error('更新已取消');
        ready = { ...result, hash: result.sha256 };
        return { version: ready.version, mode, ready: true };
      } finally { downloading = false; }
    },
    async launch() {
      if (closed || !ready || launching) throw new Error('请先下载并校验新版，再启动更新');
      const result = ready, current = generation; launching = true;
      try {
        const stat = await fs.lstat(result.file);
        if (!stat.isFile() || stat.isSymbolicLink() || await sha256(result.file) !== result.hash) throw new Error('更新文件校验失败，请重新下载');
        if (closed || current !== generation || ready !== result) throw new Error('更新已取消');
        await launch(result); ready = null; quit(); return true;
      } finally { launching = false; }
    },
    async reveal() {
      if (!ready || closed) throw new Error('请先下载新版');
      await reveal(ready.file); return true;
    },
    cancel() { ++generation; ready = null; downloader.cancel(); },
    close() { ++generation; closed = true; ready = null; downloader.close(); }
  };
}
module.exports = { createUpdateService };
