/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
'use strict';
const fs = process.versions.electron ? require('original-fs') : require('node:fs');
const path = require('node:path');

function isWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return !relative || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

async function plainDirectory(directory) {
  if (typeof directory !== 'string' || directory.includes('\0') || !path.isAbsolute(directory)) throw new Error('请选择有效的文件夹路径');
  let current = directory;
  while (true) {
    const stat = await fs.promises.lstat(current);
    if (stat.isSymbolicLink()) throw new Error('文件夹路径包含链接，请选择实际文件夹');
    if (!stat.isDirectory()) throw new Error('目标路径不是文件夹');
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function readableStem(name, extension) {
  let stem = String(name || '未命名素材');
  if (stem.toLowerCase().endsWith(extension.toLowerCase())) stem = stem.slice(0, -extension.length);
  stem = stem.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 140).replace(/[. ]+$/g, '');
  if (!stem) stem = '未命名素材';
  if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(stem)) stem = '_' + stem;
  return stem;
}

async function duplicateFile({ source, directory, name, extension, excludedRoot }) {
  await plainDirectory(directory);
  if (isWithin(await fs.promises.realpath(excludedRoot), await fs.promises.realpath(directory))) throw new Error('请选择素材库之外的文件夹，避免增加库内副本');
  const stem = readableStem(name, extension);
  for (let number = 1; number <= 10000; number++) {
    const suffix = number === 1 ? '' : ' (' + number + ')';
    const destination = path.join(directory, stem + ' - 副本' + suffix + extension);
    try {
      // COPYFILE_EXCL protects existing files, including concurrent copy actions.
      // Node attempts to remove a partially created destination on copy failure.
      await fs.promises.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
      return destination;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw new Error('同名副本过多，请选择其他文件夹或重命名素材');
}

module.exports = { duplicateFile, isWithin };
