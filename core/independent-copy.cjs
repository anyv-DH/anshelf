/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
'use strict';
const path = require('node:path');

function copyName(asset, assets) {
  const extension = asset.extension || '.fla';
  let stem = String(asset.name || asset.originalName || '未命名素材');
  if (stem.toLowerCase().endsWith(extension.toLowerCase())) stem = stem.slice(0, -extension.length);
  stem = stem.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 140).replace(/[. ]+$/g, '') || '未命名素材';
  if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(stem)) stem = '_' + stem;
  const names = new Set(assets.map(item => String(item.name).toLowerCase()));
  for (let number = 1; number <= 10000; number++) {
    const name = stem + ' - 副本' + (number === 1 ? '' : ' (' + number + ')');
    if (!names.has(name.toLowerCase())) return name;
  }
  throw new Error('同名副本过多，请先重命名素材');
}

function samePath(first, second) {
  if (typeof first !== 'string' || typeof second !== 'string') return false;
  return path.relative(path.resolve(first), path.resolve(second)) === '';
}

// Explicit copies are editable identities. Unknown files may deduplicate only
// against normal imports, never arbitrarily pick a same-byte independent copy.
function importedAsset(assets, root, source, hash, kind) {
  const candidates = assets.filter(item => (item.kind || 'fla') === kind);
  return candidates.find(item => samePath(path.resolve(root, item.managedPath), source))
    || candidates.find(item => item.hash === hash && item.sourcePaths.some(file => samePath(file, source)))
    || candidates.find(item => !item.independentCopy && item.hash === hash);
}

module.exports = { copyName, samePath, importedAsset };
