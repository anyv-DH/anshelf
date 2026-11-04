/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
'use strict';
const fs = require('node:fs/promises');
const https = require('node:https');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { releaseInfo, fetchLatestRelease } = require('./update-check.cjs');

const MAX_BYTES = 512 * 1024 * 1024;
const REDIRECT_HOSTS = new Set(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

function failure(code, message) {
  return Object.assign(new Error(message), { code: 'UPDATE_' + code });
}
function stopped(signal) {
  if (signal.aborted) throw signal.reason;
}
function abortable(pending, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(pending).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
function safeDownloadUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw failure('URL', '更新下载地址不安全'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || !REDIRECT_HOSTS.has(url.hostname)) throw failure('URL', '更新下载地址不安全');
  return url;
}
function selectAsset(release, mode) {
  let info;
  try { info = releaseInfo(release); } catch { throw failure('RELEASE', '官方发布信息无效'); }
  const version = info.latestVersion;
  if (release.tag_name !== 'v' + version) throw failure('RELEASE', '官方发布版本标签无效');
  const name = `AnAn-AssetManager-${mode === 'installed' ? 'Setup' : 'Portable'}-${version}.exe`;
  const matches = Array.isArray(release.assets) ? release.assets.filter(asset => asset?.name === name) : [];
  if (matches.length !== 1) throw failure('ASSET', '官方发布缺少唯一对应版本的更新附件');
  const asset = matches[0];
  const url = safeDownloadUrl(asset.browser_download_url);
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { throw failure('URL', '官方更新附件地址无效'); }
  if (url.hostname !== 'github.com' || url.search || pathname !== `/anyv-DH/anshelf/releases/download/v${version}/${name}`) throw failure('ASSET', '官方更新附件地址与发布版本不一致');
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_BYTES) throw failure('SIZE', '更新附件大小无效或超过 512 MB');
  if (typeof asset.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/i.test(asset.digest)) throw failure('DIGEST', '官方更新附件缺少有效的 SHA256 校验信息');
  return { version, name, url: url.href, size: asset.size, hash: asset.digest.slice(7).toLowerCase() };
}

function requestResponse({ url, signal }) {
  return new Promise((resolve, reject) => {
    // No Authorization/Cookie headers, inherited credentials, or persistent agent.
    const request = https.get(url, { signal, agent: false, headers: { 'User-Agent': 'AnAn-AssetManager-Update', 'Accept-Encoding': 'identity' } }, response => {
      resolve({ statusCode: response.statusCode, headers: response.headers, body: response });
    });
    request.on('error', reject);
  });
}
function dispose(body, iterator) {
  try { body?.destroy?.(); } catch { /* Cleanup must preserve the original failure. */ }
  try { Promise.resolve(iterator?.return?.()).catch(() => {}); } catch { /* See above. */ }
}
async function responseFor(asset, download, signal) {
  let url = asset.url;
  for (let hops = 0; ; hops++) {
    stopped(signal);
    const response = await abortable(download({ url, signal }), signal);
    if (REDIRECT_CODES.has(response.statusCode)) {
      dispose(response.body);
      if (hops >= 5) throw failure('REDIRECT', '更新下载重定向次数过多');
      const location = response.headers?.location;
      if (typeof location !== 'string' || !location) throw failure('REDIRECT', '更新下载重定向地址无效');
      let next;
      try { next = new URL(location, url).href; } catch { throw failure('REDIRECT', '更新下载重定向地址无效'); }
      url = safeDownloadUrl(next).href;
      continue;
    }
    if (response.statusCode !== 200) {
      dispose(response.body);
      throw failure('NETWORK', '更新下载暂不可用，请稍后重试');
    }
    const length = response.headers?.['content-length'];
    const encoding = response.headers?.['content-encoding'];
    if ((length !== undefined && (typeof length !== 'string' || !/^\d+$/.test(length) || Number(length) !== asset.size))
      || (encoding !== undefined && encoding !== 'identity')) {
      dispose(response.body);
      throw failure('SIZE', '更新下载响应大小或编码不符合校验要求');
    }
    if (!response.body || typeof response.body[Symbol.asyncIterator] !== 'function') throw failure('NETWORK', '更新下载响应无效');
    return response.body;
  }
}

async function rejectLinks(filename) {
  let current = path.resolve(filename);
  while (true) {
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw failure('PATH', '更新下载文件夹路径包含链接或无效目录');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

/**
 * Main-process only. The renderer may supply no URL, release object or path.
 * download is a test seam for ONE HTTPS response; this module owns redirects,
 * streaming limits, cancellation, SHA256 and atomic publication of the file.
 */
function createUpdateDownloader({ directory, fetchRelease = fetchLatestRelease, download = requestResponse, timeoutMs = 15 * 60 * 1000 }) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || directory.includes('\0')) throw failure('PATH', '更新下载文件夹路径无效');
  if (typeof fetchRelease !== 'function' || typeof download !== 'function') throw failure('CONFIG', '更新下载服务未正确配置');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30 * 60 * 1000) throw failure('CONFIG', '更新下载超时设置无效');
  const root = path.resolve(directory);
  let active = null, closed = false;

  async function transfer({ mode, onProgress }, controller) {
    const signal = controller.signal;
    let stagingDirectory, temporary, final, output, body, iterator, completed = false;
    try {
      stopped(signal);
      const release = await abortable(fetchRelease({ signal }), signal);
      const asset = selectAsset(release, mode);
      stopped(signal);
      await rejectLinks(root);
      await fs.mkdir(root, { recursive: true });
      await rejectLinks(root);
      stagingDirectory = await fs.mkdtemp(path.join(root, `v${asset.version}-${mode}-`));
      temporary = path.join(stagingDirectory, asset.name + '.part');
      final = path.join(stagingDirectory, asset.name);
      body = await responseFor(asset, download, signal);
      output = await fs.open(temporary, 'wx', 0o600);
      const hash = createHash('sha256');
      let received = 0, lastProgress = 0;
      function progress(force = false) {
        const now = Date.now();
        if (!force && now - lastProgress < 200) return;
        lastProgress = now;
        try { onProgress?.({ received, total: asset.size, percent: Math.floor(received / asset.size * 100) }); } catch { /* A closed UI does not affect verification. */ }
      }
      progress(true);
      iterator = body[Symbol.asyncIterator]();
      while (true) {
        const next = await abortable(iterator.next(), signal);
        if (next.done) break;
        stopped(signal);
        if (!(next.value instanceof Uint8Array)) throw failure('NETWORK', '更新下载响应数据无效');
        const chunk = Buffer.from(next.value.buffer, next.value.byteOffset, next.value.byteLength);
        received += chunk.length;
        if (received > asset.size || received > MAX_BYTES) throw failure('SIZE', '更新下载大小超过官方附件大小');
        hash.update(chunk);
        let offset = 0;
        while (offset < chunk.length) {
          const result = await output.write(chunk, offset, chunk.length - offset);
          if (!result.bytesWritten) throw failure('DISK', '更新下载写入失败，请检查磁盘空间');
          offset += result.bytesWritten;
        }
        progress();
      }
      if (received !== asset.size || hash.digest('hex') !== asset.hash) throw failure('DIGEST', '更新下载大小或 SHA256 校验失败，请重新下载');
      stopped(signal);
      await output.sync();
      await output.close(); output = null;
      stopped(signal);
      await fs.rename(temporary, final);
      stopped(signal);
      completed = true;
      progress(true);
      return { file: final, version: asset.version, mode, sha256: asset.hash };
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (typeof error.code === 'string' && error.code.startsWith('UPDATE_')) throw error;
      throw failure('NETWORK', '更新下载失败，请检查网络连接和磁盘空间后重试');
    } finally {
      dispose(body, iterator);
      await output?.close().catch(() => {});
      if (!completed) {
        if (temporary) await fs.unlink(temporary).catch(() => {});
        if (final) await fs.unlink(final).catch(() => {});
        if (stagingDirectory) await fs.rmdir(stagingDirectory).catch(() => {});
      }
    }
  }

  function start(options = {}) {
    if (closed) return Promise.reject(failure('CLOSED', '更新下载服务已关闭'));
    if (active) return Promise.reject(failure('BUSY', '正在下载更新，请等待完成或先取消'));
    if (!options || !['installed', 'portable'].includes(options.mode)) return Promise.reject(failure('MODE', '更新下载模式无效'));
    const controller = new AbortController();
    const cancel = () => controller.abort(failure('CANCELLED', '更新下载已取消'));
    const external = options.signal;
    if (external?.aborted) cancel(); else external?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => controller.abort(failure('TIMEOUT', '更新下载超时，请检查网络后重试')), timeoutMs);
    timer.unref?.();
    active = controller;
    return transfer(options, controller).finally(() => {
      clearTimeout(timer);
      external?.removeEventListener('abort', cancel);
      active = null;
    });
  }
  return {
    start,
    cancel() { active?.abort(failure('CANCELLED', '更新下载已取消')); },
    close() { closed = true; active?.abort(failure('CLOSED', '更新下载已关闭并取消')); }
  };
}

module.exports = { createUpdateDownloader };
