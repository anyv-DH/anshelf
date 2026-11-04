/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { resolveManagedPath } = require('./bridge.cjs');
const { sha256 } = require('./files.cjs');

const MAX_CANDIDATES = 64;

function safeFilename(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 255
    && !/[<>:"/\\|?*\x00-\x1f]/.test(value) && !/^[. ]|[. ]$/.test(value)
    && !/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(value);
}

function validateRecoveryPath(asset) {
  if (typeof asset.id !== 'string' || !/^[\w-]{1,128}$/.test(asset.id)) throw new Error('素材 ID 无法用于安全恢复路径');
  const parts = asset.managedPath.replaceAll('\\', '/').split('/');
  const oldHashPath = parts.length === 2 && /^[a-f0-9]{64}\.fla$/i.test(parts[1]);
  const ownNamedPath = parts.length === 3 && parts[1] === asset.id
    && safeFilename(parts[2]) && path.extname(parts[2]).toLowerCase() === '.fla';
  if (parts[0] !== 'assets' || (!oldHashPath && !ownNamedPath)) throw new Error('素材路径对应的文件不存在，旧路径不符合安全恢复规则');
}

function rejectAncestorLinks(filename) {
  let current = path.resolve(filename);
  while (true) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('素材恢复路径包含链接');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function location(root, file, recovered) {
  // Use the same realpath implementation for both paths (including Windows 8.3 aliases).
  return { file, relative: path.relative(fs.realpathSync(root), file), recovered };
}

async function locateManagedFile(root, asset) {
  try {
    return location(root, resolveManagedPath(root, asset?.managedPath, 'assets'), false);
  } catch (error) {
    if (error.message !== '素材路径对应的文件不存在') throw error;
    // The bridge intentionally exposes generic errors. Only an actual missing
    // file may start recovery; permissions, directories and links must fail.
    const previous = path.resolve(root, asset.managedPath);
    rejectAncestorLinks(previous);
    try {
      await fs.promises.lstat(previous);
      throw error;
    } catch (statError) {
      if (statError.code !== 'ENOENT') throw statError;
    }
  }

  validateRecoveryPath(asset);
  const directory = path.join(root, 'assets', asset.id);
  rejectAncestorLinks(directory);
  let handle;
  try { handle = await fs.promises.opendir(directory); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error('素材路径对应的文件不存在');
    throw error;
  }

  const candidates = [];
  for await (const entry of handle) {
    if (path.extname(entry.name).toLowerCase() !== '.fla') continue;
    if (entry.isSymbolicLink()) throw new Error('素材恢复候选路径包含链接');
    if (!entry.isFile()) continue;
    if (candidates.length >= MAX_CANDIDATES) throw new Error('素材恢复候选过多，最多允许 64 个文件，请手动确认');
    const file = resolveManagedPath(root, path.join('assets', asset.id, entry.name), 'assets');
    candidates.push({ name: entry.name, file });
  }
  if (!candidates.length) throw new Error('素材路径对应的文件不存在');

  let contentHash;
  for (const candidate of candidates) {
    const hash = await sha256(candidate.file);
    if (contentHash !== undefined && hash !== contentHash) throw new Error('素材存在多个不同版本，需手动确认');
    contentHash = hash;
  }

  let preferred = typeof asset.name === 'string' ? asset.name : '';
  if (!preferred.toLowerCase().endsWith('.fla')) preferred += '.fla';
  if (!safeFilename(preferred)) preferred = '';
  candidates.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const selected = candidates.find(candidate => candidate.name === preferred) || candidates[0];
  const checked = resolveManagedPath(root, path.join('assets', asset.id, selected.name), 'assets');
  return location(root, checked, true);
}

module.exports = { locateManagedFile };
