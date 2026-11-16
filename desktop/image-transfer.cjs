/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto');
const { resolveManagedPath } = require('../core/bridge.cjs');
const { sha256 } = require('../core/files.cjs');
async function prepareImageTransfer(root, asset, convertToPng) {
  const source = resolveManagedPath(root, asset.managedPath, 'assets');
  if ((await fs.stat(source)).size > 50 * 1024 * 1024) throw new Error('图片过大，导入 AN 的上限为 50 MB');
  if (!['.webp', '.gif'].includes(asset.extension)) return { file: source, asset };
  if (typeof convertToPng !== 'function') throw new Error('当前环境无法转换此图片，请改用 PNG 或 JPG');
  const bytes = await convertToPng(source);
  if (!Buffer.isBuffer(bytes) || bytes.length < 24 || bytes.length > 100 * 1024 * 1024 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('图片转换 PNG 失败或超过 100 MB，请改用较小图片');
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const relative = 'assets/' + asset.hash + '-an-' + hash + '.png', target = path.join(root, relative);
  try { await fs.writeFile(target, bytes, { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const canonical = resolveManagedPath(root, relative, 'assets');
  if (await sha256(canonical) !== hash) throw new Error('图片转换缓存校验失败，请检查素材库');
  return { file: canonical, asset: { ...asset, hash, managedPath: relative, extension: '.png' } };
}
module.exports = { prepareImageTransfer };
