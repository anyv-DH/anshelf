/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { sha256 } = require('../core/files.cjs');
const RUNTIME = ['CSXS/manifest.xml', 'META-INF/signatures.xml', 'mimetype', 'panel.js', 'style.css', 'index.html', 'queue.cjs', 'insert-whole.jsfl', 'icon.png', 'README.md'];

async function assertSafe(file) {
  let cursor = path.resolve(file);
  while (true) {
    const stat = await fs.lstat(cursor);
    if (stat.isSymbolicLink()) throw new Error('插件路径包含链接，无法更新');
    const parent = path.dirname(cursor); if (parent === cursor) break; cursor = parent;
  }
}
async function version(directory) {
  const file = path.join(directory, 'CSXS/manifest.xml');
  try {
    await assertSafe(file);
    const xml = await fs.readFile(file, 'utf8');
    if (!/ExtensionBundleId="com\.anshelf\.receiver"/.test(xml)) throw new Error('AN 插件标识无效');
    const match = xml.match(/ExtensionBundleVersion="(\d+\.\d+\.\d+)"/);
    if (!match) throw new Error('AN 插件版本无效'); return match[1];
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function runInstaller({ file, directory, env = process.env }) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { cwd: directory, env, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', settled = false;
    const finish = error => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(); };
    const timer = setTimeout(() => { child.kill(); finish(new Error('插件更新超时，请关闭 AN 面板后重试')); }, 30000); timer.unref?.();
    const capture = chunk => { output = (output + chunk.toString()).slice(-8000); };
    child.stdout.on('data', capture); child.stderr.on('data', capture);
    child.once('error', error => finish(error));
    child.once('exit', code => finish(code === 0 ? null : new Error('AN 插件更新失败：' + output.trim().slice(-1200))));
  });
}
function createPluginUpdater({ directory, installedDirectory = path.join(process.env.APPDATA, 'Adobe/CEP/extensions/com.anshelf.receiver'), run = runInstaller }) {
  let busy = false;
  async function status() {
    // The bundle must be complete before checking its version or the target.
    // Missing on both sides must never make an incomplete package "current".
    for (const relative of RUNTIME) {
      const file = path.join(directory, relative);
      try {
        await assertSafe(file);
        if (!(await fs.lstat(file)).isFile()) throw new Error('软件附带的 AN 插件不完整，运行文件必须是普通文件');
      } catch (error) {
        if (error.code === 'ENOENT') throw new Error('软件附带的 AN 插件不完整：' + relative);
        throw error;
      }
    }
    const bundledVersion = await version(directory), installedVersion = await version(installedDirectory);
    if (!bundledVersion) throw new Error('软件附带的 AN 插件不完整');
    let same = bundledVersion === installedVersion;
    if (same) for (const file of RUNTIME) {
      try {
        const source = path.join(directory, file), target = path.join(installedDirectory, file);
        await assertSafe(source); await assertSafe(target);
        if (!(await fs.lstat(target)).isFile()) { same = false; break; }
        if (await sha256(source) !== await sha256(target)) { same = false; break; }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        same = false; break;
      }
    }
    return { status: !installedVersion ? 'not-installed' : same ? 'current' : 'needs-update', bundledVersion, installedVersion };
  }
  return { status, async install() {
    if (busy) throw new Error('正在更新 AN 插件，请稍候'); busy = true;
    try {
      await status(); const file = path.join(directory, 'install.ps1'); await assertSafe(file);
      if (!(await fs.stat(file)).isFile()) throw new Error('插件安装程序不存在');
      await run({ file, directory });
      const result = await status();
      if (result.status !== 'current') throw new Error('插件更新后的文件校验未通过，请重试');
      return { ...result, restartRequired: true };
    } finally { busy = false; }
  } };
}
module.exports = { createPluginUpdater, runInstaller };
