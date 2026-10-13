/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
export function selectAsset(selected, anchor, id, visibleIds, modifiers = {}) {
  let next = new Set();
  if (modifiers.shift && visibleIds.includes(anchor)) {
    if (modifiers.ctrl) next = new Set(selected);
    const start = visibleIds.indexOf(anchor), end = visibleIds.indexOf(id);
    visibleIds.slice(Math.min(start, end), Math.max(start, end) + 1).forEach(value => next.add(value));
    return { selected: next, anchor };
  }
  if (modifiers.ctrl) {
    next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
  } else next.add(id);
  return { selected: next, anchor: id };
}

export function categoryCount(assets, category, categories = [], typeScope = 'all') {
  const ids = categoryDescendantIds(categories, category);
  return assets.filter(asset => (typeScope === 'all' || assetMode(asset) === typeScope) && matchesCategory(asset, category, ids)).length;
}

function matchesCategory(asset, category, categoryIds) {
  if (category === 'all') return true;
  if (category === 'ordinary') return assetMode(asset) === 'ordinary';
  if (category === 'effects') return assetMode(asset) === 'effect';
  if (category === 'audio') return assetMode(asset) === 'audio';
  if (category === 'favorites') return !!asset.favorite;
  if (category === 'liked') return isLiked(asset);
  if (category === 'uncategorized') return !asset.categoryId;
  return categoryIds ? categoryIds.has(asset.categoryId) : asset.categoryId === category;
}

/**
 * Returns whether an asset has been assigned inside a child folder of the
 * currently browsed folder. Typed media roots (ordinary/effects/audio) are
 * virtual folders, so every known category assignment in that media scope is
 * considered a child assignment. The option is intentionally applied only to
 * category browsing; favorites, likes and the all-assets view have no child
 * folder context.
 */
function isChildCategoryAsset(asset, category, categories, categoryIds) {
  if (!asset?.categoryId || !Array.isArray(categories) || !categories.length) return false;
  const typedRoot = { ordinary: 'ordinary', effects: 'effect', audio: 'audio' }[category];
  if (typedRoot) return assetMode(asset) === typedRoot && categories.some(item => item.id === asset.categoryId);
  if (!categoryIds?.has(asset.categoryId)) return false;
  return asset.categoryId !== category;
}

/** A like is deliberately short lived. The library may retain the marker for
 * audit/undo, but the browsing view only exposes it for 24 hours. */
export function isLiked(asset, now = Date.now()) {
  if (!asset?.liked) return false;
  const value = asset.likedAt || asset.likeAt || 0;
  const at = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(at) && !!at && at <= now && now - at < 24 * 60 * 60 * 1000;
}

export function categoryDescendantIds(categories, id) {
  const result = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    categories.forEach(item => {
      if (item.parentId && result.has(item.parentId) && !result.has(item.id)) {
        result.add(item.id); changed = true;
      }
    });
  }
  return result;
}

export function categoryPath(categories, id) {
  const byId = new Map(categories.map(item => [item.id, item]));
  const names = [], seen = new Set();
  while (id && byId.has(id) && !seen.has(id)) {
    seen.add(id); const item = byId.get(id); names.unshift(item.name); id = item.parentId;
  }
  return names.join(' / ');
}

export function visibleAssets(assets, category, query, sort, categories = [], typeScope = 'all', options = {}) {
  const needle = query.trim().toLocaleLowerCase();
  const categoryIds = categoryDescendantIds(categories, category);
  const result = assets.filter(asset => (typeScope === 'all' || assetMode(asset) === typeScope) && matchesCategory(asset, category, categoryIds) &&
    (!options.hideChildCategories || !isChildCategoryAsset(asset, category, categories, categoryIds)) &&
    (!needle || [asset.name, asset.originalName, ...(asset.tags || [])].some(value => String(value || '').toLocaleLowerCase().includes(needle))));
  const time = value => typeof value === 'number' ? value : new Date(value || 0).getTime();
  result.sort((a, b) => sort === 'name' ? String(a.name).localeCompare(String(b.name), 'zh-CN', { numeric: true }) :
    sort === 'oldest' ? time(a.createdAt) - time(b.createdAt) : time(b.createdAt) - time(a.createdAt));
  return result;
}

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

export function gridColumns(width, preference = 'auto', gap = 12) {
  const available = Math.max(0, Number(width) || 0);
  const maximum = Math.max(1, Math.floor((available + gap) / (155 + gap)));
  const desired = ['4', '5', '6'].includes(String(preference)) ? Number(preference) :
    Math.max(1, Math.floor((available + gap) / (190 + gap)));
  return Math.min(desired, maximum);
}

export function previewState(asset) {
  if (asset.previewUrl && !['pending', 'queued', 'rendering', 'active', 'error', 'failed'].includes(asset.previewStatus)) return 'ready';
  if (['error', 'failed'].includes(asset.previewStatus)) return 'error';
  return 'pending';
}

export const assetMode = asset => asset.kind === 'audio' || asset.assetType === 'audio' ? 'audio' : asset.assetType === 'effect' ? 'effect' : 'ordinary';
export function assetFilename(asset) {
  const name = asset.name || asset.originalName || '未命名';
  const extension = asset.extension || (assetMode(asset) === 'audio' ? '.mp3' : '.fla');
  return name.toLocaleLowerCase().endsWith(extension.toLocaleLowerCase()) ? name : name + extension;
}

/** Filtering expands matching ancestry temporarily without changing saved folds. */
export function categoryTree(categories, query = '', collapsed = new Set()) {
  const needle = query.trim().toLocaleLowerCase(), visible = new Set();
  const byId = new Map(categories.map(item => [item.id, item]));
  if (needle) categories.filter(item => String(item.name).toLocaleLowerCase().includes(needle)).forEach(item => {
    let cursor = item; const visited = new Set();
    while (cursor && !visited.has(cursor.id)) { visited.add(cursor.id); visible.add(cursor.id); cursor = byId.get(cursor.parentId); }
  });
  const result = [], visited = new Set();
  function visit(parent, depth) {
    const children = categories.filter(item => (item.parentId || null) === parent && (!needle || visible.has(item.id)));
    children.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
    for (const item of children) {
      if (visited.has(item.id)) continue;
      visited.add(item.id);
      const hasChildren = categories.some(child => child.parentId === item.id);
      result.push({ ...item, depth, hasChildren, collapsed: !needle && collapsed.has(item.id) });
      if (hasChildren && (needle || !collapsed.has(item.id))) visit(item.id, depth + 1);
    }
  }
  visit(null, 0); return result;
}
