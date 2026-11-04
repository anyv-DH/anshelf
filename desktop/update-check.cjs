/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
'use strict';
const https = require('node:https');
const API_URL = 'https://api.github.com/repos/anyv-DH/anshelf/releases/latest';
const RELEASES_URL = 'https://github.com/anyv-DH/anshelf/releases/latest';
const VERSION = /^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;

function compareVersions(a, b) {
  if (!VERSION.test(a) || !VERSION.test(b)) throw new Error('版本号无效');
  const left = a.split('.').map(Number), right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return Math.sign(left[i] - right[i]);
  return 0;
}
function releaseInfo(release) {
  const version = typeof release?.tag_name === 'string' ? release.tag_name.replace(/^v/, '') : '';
  if (!VERSION.test(version) || release.draft !== false || release.prerelease !== false) throw new Error('发布版本无效');
  const url = `https://github.com/anyv-DH/anshelf/releases/tag/v${version}`;
  if (String(release.html_url).toLowerCase() !== url.toLowerCase()) throw new Error('发布地址无效');
  return { latestVersion: version, releaseUrl: url };
}
function fetchLatestRelease({ signal }) {
  // This fixed public endpoint receives no library paths, files or credentials.
  return new Promise((resolve, reject) => {
    const request = https.get(API_URL, { signal, headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'AnAn-AssetManager-Update', 'X-GitHub-Api-Version': '2022-11-28' } }, response => {
      if (response.statusCode !== 200) { response.destroy(); reject(new Error('版本服务暂不可用')); return; }
      let size = 0;
      const chunks = [];
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 256 * 1024) { response.destroy(new Error('版本响应过大')); return; }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (error) { reject(error); } });
    });
    request.on('error', reject);
  });
}
function createUpdateChecker({ version, fetchRelease = fetchLatestRelease, now = Date.now }) {
  if (!VERSION.test(version)) throw new Error('当前版本号无效');
  let cached = null, checkedAt = 0, pending = null, controller = null, closed = false;
  const unavailable = () => ({ currentVersion: version, status: 'offline', error: '暂时无法连接 GitHub，素材库可以正常使用，稍后再试。' });
  function check() {
    if (closed) return Promise.resolve(unavailable());
    if (pending) return pending;
    const cacheTime = cached?.status === 'offline' ? 30000 : 600000;
    if (cached && now() - checkedAt < cacheTime) return Promise.resolve({ ...cached });
    controller = new AbortController();
    const timer = setTimeout(() => controller?.abort(), 8000);
    timer.unref?.();
    pending = (async () => {
      try {
        const info = releaseInfo(await fetchRelease({ signal: controller.signal }));
        cached = { currentVersion: version, status: compareVersions(info.latestVersion, version) > 0 ? 'available' : 'current', ...info };
      } catch { cached = unavailable(); }
      checkedAt = now();
      return { ...cached };
    })().finally(() => { clearTimeout(timer); pending = null; controller = null; });
    return pending;
  }
  return { check, releaseUrl: () => cached?.releaseUrl || RELEASES_URL, close() { closed = true; controller?.abort(); } };
}
function registerUpdateIpc({ ipcMain, webContents, checker, openExternal }) {
  ipcMain.handle('shelf:update-check', async event => {
    if (event.sender !== webContents) throw new Error('操作不允许');
    return checker.check();
  });
  ipcMain.handle('shelf:update-open', async event => {
    if (event.sender !== webContents) throw new Error('操作不允许');
    await openExternal(checker.releaseUrl());
    return true;
  });
  ipcMain.handle('shelf:project-open', async event => {
    if (event.sender !== webContents) throw new Error('操作不允许');
    await openExternal('https://github.com/anyv-DH/anshelf');
    return true;
  });
}
module.exports = { createUpdateChecker, releaseInfo, compareVersions, registerUpdateIpc };
