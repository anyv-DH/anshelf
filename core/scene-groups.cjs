/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const { randomUUID } = require('node:crypto');
const MAX_MEMBERS = 200;
function groupName(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 100) throw new Error('组合名称须为 1–100 个字符');
  return value.trim();
}
function members(state, ids, exceptId, minimum = 1) {
  if (!Array.isArray(ids) || ids.length < minimum || ids.length > MAX_MEMBERS || new Set(ids).size !== ids.length) throw new Error('场景组合须选择 ' + minimum + '–200 张不重复的图片');
  const assets = new Map(state.assets.map(a => [a.id, a]));
  const occupied = new Set((state.sceneGroups || []).filter(g => g.id !== exceptId).flatMap(g => g.assetIds));
  for (const id of ids) {
    if (typeof id !== 'string' || assets.get(id)?.kind !== 'image') throw new Error('场景组合只能包含素材库中存在的图片');
    if (occupied.has(id)) throw new Error('图片已在其他场景组合中，请先移出原组合');
  }
  return [...ids];
}
function validateSceneGroups(state) {
  if (state.sceneGroups === undefined) return;
  if (!Array.isArray(state.sceneGroups)) throw new Error('场景组合格式无效');
  const known = new Set(), occupied = new Set(), folders = new Set(), images = new Set(state.assets.filter(a => a.kind === 'image').map(a => a.id));
  for (const g of state.sceneGroups) {
    if (!g || typeof g.id !== 'string' || !/^[\w-]{1,128}$/.test(g.id) || known.has(g.id) || groupName(g.name) !== g.name
      || !Array.isArray(g.assetIds) || !g.assetIds.length || g.assetIds.length > MAX_MEMBERS
      || !g.assetIds.includes(g.coverAssetId)) throw new Error('场景组合记录无效');
    known.add(g.id);
    if (g.folderImportKey !== undefined) {
      if (typeof g.folderImportKey !== 'string' || !/^[a-f0-9]{64}$/.test(g.folderImportKey) || folders.has(g.folderImportKey)) throw new Error('场景组合来源记录无效');
      folders.add(g.folderImportKey);
    }
    for (const id of g.assetIds) {
      if (!images.has(id) || occupied.has(id)) throw new Error('场景组合图片记录无效或重复');
      occupied.add(id);
    }
  }
}
function reconcileSceneGroups(state) {
  const images = new Set(state.assets.filter(a => a.kind === 'image').map(a => a.id)), used = new Set();
  state.sceneGroups = (state.sceneGroups || []).filter(g => {
    g.assetIds = g.assetIds.filter(id => images.has(id) && !used.has(id) && (used.add(id), true));
    if (!g.assetIds.includes(g.coverAssetId)) g.coverAssetId = g.assetIds[0];
    return g.assetIds.length;
  });
}
function newSceneGroup(state, name, ids, minimum) {
  const assetIds = members(state, ids, null, minimum), now = new Date().toISOString();
  const g = { id: randomUUID(), name: groupName(name), assetIds, coverAssetId: assetIds[0], createdAt: now, updatedAt: now };
  (state.sceneGroups ||= []).push(g); return g;
}
function createSceneGroup(state, name, ids) { return newSceneGroup(state, name, ids, 2); }
function createImportedSceneGroup(state, name, ids, folderImportKey) {
  if (typeof folderImportKey !== 'string' || !/^[a-f0-9]{64}$/.test(folderImportKey) || (state.sceneGroups || []).some(g => g.folderImportKey === folderImportKey)) throw new Error('场景组合来源记录无效');
  const group = newSceneGroup(state, name, ids, 1);
  group.folderImportKey = folderImportKey;
  return group;
}
function updateSceneGroup(state, id, patch) {
  const g = state.sceneGroups.find(g => g.id === id);
  if (!g) throw new Error('场景组合不存在');
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length || Object.keys(patch).some(k => !['name', 'assetIds', 'coverAssetId'].includes(k))) throw new Error('场景组合修改无效');
  if (Object.hasOwn(patch, 'name')) g.name = groupName(patch.name);
  if (Object.hasOwn(patch, 'assetIds')) g.assetIds = members(state, patch.assetIds, id);
  if (Object.hasOwn(patch, 'coverAssetId')) {
    if (!g.assetIds.includes(patch.coverAssetId)) throw new Error('组合封面必须是组内图片');
    g.coverAssetId = patch.coverAssetId;
  } else if (!g.assetIds.includes(g.coverAssetId)) g.coverAssetId = g.assetIds[0];
  g.updatedAt = new Date().toISOString(); return g;
}
function deleteSceneGroup(state, id) {
  const index = state.sceneGroups.findIndex(g => g.id === id);
  if (index < 0) throw new Error('场景组合不存在');
  state.sceneGroups.splice(index, 1); return true;
}
module.exports = { validateSceneGroups, reconcileSceneGroups, createSceneGroup, createImportedSceneGroup, updateSceneGroup, deleteSceneGroup, MAX_MEMBERS };
