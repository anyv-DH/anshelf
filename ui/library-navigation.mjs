/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import { isLiked } from './model.js';

export const SYSTEM_LABELS = Object.freeze({
  character: '人物', scene: '背景', expression: '表情', prop: '道具',
  effect: '特效', creature: '动物异兽', audio: '音效', bgm: 'BGM',
});
const scopes = { character: 'ordinary', scene: 'ordinary', expression: 'ordinary', prop: 'ordinary',
  effect: 'effect', creature: 'ordinary', audio: 'audio', bgm: 'audio' };

export function libraryNavigation(categories, selected) {
  const byId = new Map(categories.map(item => [item.id, item]));
  const path = [], seen = new Set();
  for (let item = byId.get(selected); item && !seen.has(item.id); item = byId.get(item.parentId)) {
    seen.add(item.id); path.unshift(item);
  }
  const root = path[0] || null;
  const children = root ? categories.filter(item => item.parentId === root.id) : [];
  children.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
  const roots = Object.keys(SYSTEM_LABELS).flatMap(key => categories.filter(item => !item.parentId && item.systemKey === key))
    .concat(categories.filter(item => !item.parentId && !Object.hasOwn(SYSTEM_LABELS, item.systemKey)));
  const deeper = categories.filter(item => item.parentId === selected);
  return { roots, root, children, path, firstSelected: path[1]?.id || null, deeper: selected === root?.id ? [] : deeper };
}

export function categoryScope(categories, selected, fallback = 'all') {
  const virtual = { all: 'all', ordinary: 'ordinary', effects: 'effect', audio: 'audio' };
  if (selected in virtual) return virtual[selected];
  const { root, path } = libraryNavigation(categories, selected);
  if (root?.kind === 'project') return 'all';
  if (scopes[root?.systemKey]) return scopes[root.systemKey];
  const scope = path.at(-1)?.scope;
  return scope && scope !== 'all' ? scope : fallback;
}

// Typed media has always been browsable across old shared category trees.
export function mediaCategory(categories, selected) {
  const category = categories.find(item => item.id === selected);
  return category?.systemKey === 'effect' ? 'effects' : category?.systemKey === 'audio' ? 'audio' : selected;
}

// Older audio stays reachable under sound effects. Only explicit BGM
// memberships opt out of that aggregate; neither records nor files move.
export function mediaRootAssets(assets, categories, selected) {
  const category = categories.find(item => item.id === selected);
  if (selected !== 'audio' && category?.systemKey !== 'audio') return assets;
  const bgmIds = new Set(categories.filter(item => item.systemKey === 'bgm' && !item.parentId).map(item => item.id));
  if (!bgmIds.size) return assets;
  const children = new Map();
  for (const item of categories) {
    if (!children.has(item.parentId)) children.set(item.parentId, []);
    children.get(item.parentId).push(item.id);
  }
  const pending = [...bgmIds];
  while (pending.length) {
    for (const id of children.get(pending.pop()) || []) {
      if (!bgmIds.has(id)) { bgmIds.add(id); pending.push(id); }
    }
  }
  return assets.filter(asset => ![asset.categoryId, ...(asset.categoryIds || [])].some(id => bgmIds.has(id)));
}

export function collectionAssets(assets, collection) {
  return collection === 'favorites' ? assets.filter(item => item.favorite)
    : collection === 'liked' ? assets.filter(item => isLiked(item)) : assets;
}
