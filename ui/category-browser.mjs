/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import { assetCategoryIds, assetMode, categoryDescendantIds, categoryPath } from './model.js';

const typeViews = { ordinary: 'ordinary', effects: 'effect', audio: 'audio' };
const scopeViews = { ordinary: 'ordinary', effect: 'effects', audio: 'audio' };
const scopeLabels = { ordinary: '普通素材', effect: '特效素材', audio: '音频素材' };
// A separate UI value keeps “未分类收藏” distinct from “全部收藏”. It is
// deliberately impossible to collide with a persisted category id.
export const FAVORITE_UNCATEGORIZED = '__favorite_uncategorized__';

/**
 * Returns the visible breadcrumb from the media root to the selected folder.
 * Typed roots are virtual navigation nodes; they are intentionally included
 * so the path makes the sidebar choice explicit before showing deeper folders.
 */
export function categoryTrail(categories, selected, typeScope = 'all') {
  const byId = new Map(categories.map(item => [item.id, item]));
  const current = byId.get(selected);
  const selectedScope = typeViews[selected] || (current?.scope && current.scope !== 'all' ? current.scope : typeScope);
  const trail = selectedScope && scopeLabels[selectedScope]
    ? [{ id: scopeViews[selectedScope], name: scopeLabels[selectedScope] }]
    : [];
  const path = [], visited = new Set();
  for (let item = current; item && !visited.has(item.id); item = byId.get(item.parentId)) {
    visited.add(item.id); path.unshift({ id: item.id, name: item.name });
  }
  return trail.concat(path);
}

/** Group only favorited assets by the category assigned to each asset. */
export function favoriteCategoryGroups(categories, assets) {
  const byId = new Map(categories.map(item => [item.id, item]));
  const groups = new Map();
  for (const asset of assets) {
    if (!asset.favorite) continue;
    const ids = assetCategoryIds(asset).filter(id => byId.has(id));
    for (const id of ids.length ? ids : [FAVORITE_UNCATEGORIZED]) {
      const group = groups.get(id) || { id, name: id === FAVORITE_UNCATEGORIZED ? '未分类' : categoryPath(categories, id), count: 0 };
      group.count += 1;
      groups.set(id, group);
    }
  }
  return [...groups.values()].sort((a, b) => a.id === FAVORITE_UNCATEGORIZED ? 1 : b.id === FAVORITE_UNCATEGORIZED ? -1 : a.name.localeCompare(b.name, 'zh-CN'));
}

/** Match a favorite category by the asset's original direct category path. */
export function favoriteCategoryMatches(categories, asset, selected) {
  if (selected === 'all') return true;
  const known = new Set(categories.map(item => item.id));
  const ids = assetCategoryIds(asset);
  if (selected === FAVORITE_UNCATEGORIZED) return !ids.some(id => known.has(id));
  return ids.includes(selected);
}

/** Only the next folder level is shown; old shared folders remain discoverable by content. */
export function categoryBrowser(categories, assets, selected, typeScope = 'all') {
  const byId = new Map(categories.map(item => [item.id, item]));
  const current = byId.get(selected), mode = typeViews[selected];
  const path = [], visited = new Set();
  for (let item = current; item && !visited.has(item.id); item = byId.get(item.parentId)) {
    visited.add(item.id); path.unshift(item);
  }
  // Legacy/shared categories use scope=all and must stay inside the active
  // media view. Only explicitly typed categories switch the view scope.
  const scope = current?.scope && current.scope !== 'all' ? current.scope : typeScope;
  const rootView = scopeViews[scope] || 'all';
  const parentId = current ? current.parentId && byId.has(current.parentId) ? current.parentId : rootView : null;
  let children = [];
  if (current) children = categories.filter(item => item.parentId === current.id);
  else if (mode) children = categories.filter(item => {
    if (item.parentId) return false;
    if (item.scope === mode) return true;
    if (item.scope && item.scope !== 'all') return false;
    const ids = categoryDescendantIds(categories, item.id);
    return assets.some(asset => assetMode(asset) === mode && assetCategoryIds(asset).some(id => ids.has(id)));
  });
  children.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
  return { visible: !!(current || mode), children, path, parentId,
    creationParent: current?.id || null, creationScope: mode || (current?.scope && current.scope !== 'all' ? current.scope : typeScope) || 'all' };
}
