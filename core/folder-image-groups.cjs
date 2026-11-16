/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createImportedSceneGroup, updateSceneGroup, MAX_MEMBERS } = require('./scene-groups.cjs');

async function sourceFolder(file, cache) {
  const directory = path.dirname(file);
  if (!cache.has(directory)) {
    const canonical = await fs.realpath(directory);
    const key = createHash('sha256').update('anshelf-folder-group-v1\0' + (process.platform === 'win32' ? canonical.toLowerCase() : canonical)).digest('hex');
    const shared = cache.get('key:' + key) || { key, name: path.basename(canonical).trim().slice(0, 100) || '图片分组', ids: new Set() };
    cache.set('key:' + key, shared);
    cache.set(directory, shared);
  }
  return cache.get(directory);
}

function applyFolderImageGroups(state, folders) {
  const summary = { created: 0, updated: 0, skipped: 0, warnings: [] };
  const occupied = new Map((state.sceneGroups || []).flatMap(group => group.assetIds.map(id => [id, group.id])));
  const seenFolders = new Set();
  for (const folder of folders) {
    if (seenFolders.has(folder.key)) continue;
    seenFolders.add(folder.key);
    const existing = (state.sceneGroups || []).find(group => group.folderImportKey === folder.key);
    const ids = [...folder.ids];
    const eligible = ids.filter(id => !occupied.has(id) || occupied.get(id) === existing?.id);
    const conflicts = ids.length - eligible.length;
    if (conflicts) {
      summary.skipped += conflicts;
      summary.warnings.push('“' + folder.name + '”有 ' + conflicts + ' 张图片已在其他组合中，保留原组合。');
    }
    const combined = [...new Set([...(existing?.assetIds || []), ...eligible])];
    if (combined.length > MAX_MEMBERS) {
      const skipped = eligible.filter(id => !existing?.assetIds.includes(id)).length;
      summary.skipped += skipped;
      summary.warnings.push('“' + folder.name + '”超过每组 ' + MAX_MEMBERS + ' 张；图片已导入，新增图片未分组，请分批整理。');
      continue;
    }
    if (!eligible.length) continue;
    let group = existing;
    if (!group) {
      group = createImportedSceneGroup(state, folder.name, eligible, folder.key);
      summary.created++;
    } else if (combined.length !== group.assetIds.length) {
      updateSceneGroup(state, group.id, { assetIds: combined });
      summary.updated++;
    }
    for (const id of eligible) occupied.set(id, group.id);
  }
  return summary;
}
module.exports = { sourceFolder, applyFolderImageGroups };
