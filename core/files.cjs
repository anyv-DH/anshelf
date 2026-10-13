/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
const path = require('node:path');

const MAX_PREVIEW_BYTES = 50 * 1024 * 1024;
const PREVIEW_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];

function insidePath(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || /^[a-z]:/i.test(relative)) {
    throw new Error('无效的素材库相对路径');
  }
  const result = path.resolve(root, relative);
  const relation = path.relative(root, result);
  if (!relation || relation === '..' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    throw new Error('路径必须位于素材库内');
  }
  return result;
}

async function atomicJson(filename, value) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temporary, 'wx');
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporary, filename);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function sha256(filename) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(filename)) hash.update(bytes);
  return hash.digest('hex');
}

async function findSidecar(filename, extensions = PREVIEW_EXTENSIONS) {
  const directory = path.dirname(filename);
  const stem = path.parse(filename).name.toLocaleLowerCase();
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const extension of extensions) {
    const match = entries.find((entry) => entry.isFile()
      && path.parse(entry.name).name.toLocaleLowerCase() === stem
      && path.extname(entry.name).toLowerCase() === extension);
    if (match) return path.join(directory, match.name);
  }
  return null;
}

async function copySidecar(source, destination) {
  if ((await fs.stat(source)).size > MAX_PREVIEW_BYTES) throw new Error('预览图不能超过 50 MB');
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await fs.copyFile(source, temporary);
    if ((await fs.stat(temporary)).size > MAX_PREVIEW_BYTES) throw new Error('预览图不能超过 50 MB');
    await fs.rename(temporary, destination);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function scanFla(input, visit, fail, excludedRoot, extensions = ['.fla']) {
  const absolute = path.resolve(input);
  const relation = path.relative(excludedRoot, absolute);
  if (!relation || (!relation.startsWith('..') && !path.isAbsolute(relation))) return;
  try {
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink()) {
      fail(absolute, new Error('不导入符号链接，请选择实际文件路径'));
    } else if (stat.isDirectory()) {
      const children = (await fs.readdir(absolute)).sort((a, b) => a.localeCompare(b));
      for (const name of children) await scanFla(path.join(absolute, name), visit, fail, excludedRoot, extensions);
    } else if (stat.isFile() && extensions.includes(path.extname(absolute).toLowerCase())) {
      await visit(absolute);
    } else if (stat.isFile()) {
      // Files outside the selected import mode are deliberately ignored.
    }
  } catch (error) {
    fail(absolute, error);
  }
}

module.exports = { insidePath, atomicJson, sha256, findSidecar, copySidecar, scanFla, MAX_PREVIEW_BYTES };
