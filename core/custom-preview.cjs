/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const fs = require('node:fs/promises');
const path = require('node:path');
const { constants } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { MAX_PREVIEW_BYTES } = require('./files.cjs');
const { IMAGE_EXTENSIONS, cachePath, rejectLinks } = require('./preview-cache.cjs');

async function checkImage(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('请选择本地普通图片文件');
  if (stat.size > MAX_PREVIEW_BYTES) throw new Error('预览图不能超过 50 MB');
  const header = Buffer.alloc(32), handle = await fs.open(file, 'r');
  let count;
  try { ({ bytesRead: count } = await handle.read(header, 0, header.length, 0)); }
  finally { await handle.close(); }
  const ext = path.extname(file).toLowerCase();
  const valid = ext === '.png' ? count >= 24 && header.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && header.toString('ascii', 12, 16) === 'IHDR'
    : ext === '.jpg' || ext === '.jpeg' ? count >= 3 && header[0] === 255 && header[1] === 216 && header[2] === 255
    : ext === '.gif' ? count >= 14 && /^GIF8[79]a$/.test(header.toString('ascii', 0, 6))
    : ext === '.webp' ? count >= 16 && header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP' : false;
  if (!valid) throw new Error('预览图片格式无效，请选择 PNG、JPG、WebP 或 GIF');
}

async function copyCustomPreview(root, source, options, createdFiles) {
  if (typeof source !== 'string' || !path.isAbsolute(source) || !IMAGE_EXTENSIONS.has(path.extname(source).toLowerCase())) throw new Error('请选择本地 PNG、JPG、WebP 或 GIF 预览图片');
  await rejectLinks(source); await checkImage(source);
  const revision = randomUUID(), extension = path.extname(source).toLowerCase();
  const relative = `previews/custom-${revision}${extension}`;
  const destination = cachePath(root, relative);
  await rejectLinks(destination);
  await fs.copyFile(source, destination, constants.COPYFILE_EXCL);
  createdFiles.push(destination);
  await checkImage(destination);
  const animated = extension === '.gif';
  let poster = null;
  if (animated) {
    poster = `previews/custom-${revision}-poster.png`;
    const posterFile = cachePath(root, poster);
    await rejectLinks(posterFile);
    // Track the private destination before the decoder starts so a failed GIF
    // decode or index commit cannot leave a half-created replacement behind.
    createdFiles.push(posterFile);
    if (!await options.createPoster(destination, posterFile)) throw new Error('GIF 预览无法解码，请更换图片');
    await checkImage(posterFile);
  } else if (!await options.validateImage(destination)) throw new Error('预览图片无法解码，请更换图片');
  return { previewPath: relative, previewPosterPath: poster, previewOrigin: 'custom', previewStatus: 'ready',
    previewRevision: revision, previewError: null, previewWarning: null, previewFormat: extension.slice(1), previewAnimated: animated,
    previewFrameCount: animated ? null : 1, previewDurationMs: animated ? null : 0 };
}

module.exports = { copyCustomPreview, checkImage };
