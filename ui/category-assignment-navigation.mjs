/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import { createCategoryCompatibility } from './category-compatibility.mjs';
import { SYSTEM_LABELS } from './library-navigation.mjs';

const MEDIA_MODES = new Set(['ordinary', 'effect', 'audio', 'image']);
const systemOrder = new Map(Object.keys(SYSTEM_LABELS).map((key, index) => [key, index]));
const labelOf = category => Object.hasOwn(SYSTEM_LABELS, category.systemKey)
  ? SYSTEM_LABELS[category.systemKey] : String(category.name || '未命名分类');

/** Builds an index once, then searches and browses direct children only. */
export function createCategoryAssignmentNavigation(categories, modes = []) {
  const source = Array.isArray(categories) ? categories : [];
  const wanted = [...new Set(Array.isArray(modes) ? modes : [])];
  const validSelection = wanted.length > 0 && wanted.every(mode => MEDIA_MODES.has(mode));
  const byId = new Map(), duplicatedIds = new Set(), positions = new Map();
  source.forEach((category, index) => {
    if (!category || typeof category.id !== 'string' || !category.id) return;
    if (byId.has(category.id)) duplicatedIds.add(category.id);
    byId.set(category.id, category); positions.set(category.id, index);
  });
  for (const id of duplicatedIds) byId.delete(id);

  const children = new Map(), parents = new Map();
  for (const category of byId.values()) {
    const parentId = category.parentId == null || category.parentId === '' ? null : category.parentId;
    parents.set(category.id, parentId);
    if (!children.has(parentId)) children.set(parentId, []);
    children.get(parentId).push(category);
  }
  // Root-first iteration excludes orphaned/cyclic paths and resolves inherited
  // compatibility from cached parents, even for very deeply nested old trees.
  const ordered = [], reachable = new Set(), pending = [...(children.get(null) || [])];
  for (const category of pending) {
    if (reachable.has(category.id)) continue;
    reachable.add(category.id); ordered.push(category);
    pending.push(...(children.get(category.id) || []));
  }
  const compatibility = createCategoryCompatibility([...byId.values()]);
  const selectable = new Set();
  for (const category of ordered) {
    if (validSelection && wanted.every(mode => compatibility.accepts(category.id, mode))) selectable.add(category.id);
  }
  const reverse = [...ordered].reverse();
  const available = new Set(selectable);
  for (const category of reverse) {
    const parentId = parents.get(category.id);
    if (available.has(category.id) && reachable.has(parentId)) available.add(parentId);
  }

  let lastQuery = null, lastMatches = available;
  function matchingBranches(query) {
    if (!query) return available;
    if (query === lastQuery) return lastMatches;
    const matches = new Set(), matchingAncestor = new Map();
    for (const category of ordered) {
      const inherited = matchingAncestor.get(parents.get(category.id)) || false;
      const matched = inherited || (labelOf(category) + ' ' + String(category.name || '')).toLocaleLowerCase().includes(query);
      matchingAncestor.set(category.id, matched);
      if (matched && selectable.has(category.id)) matches.add(category.id);
    }
    for (const category of reverse) {
      const parentId = parents.get(category.id);
      if (matches.has(category.id) && reachable.has(parentId)) matches.add(parentId);
    }
    lastQuery = query; lastMatches = matches;
    return matches;
  }
  function trailFor(id) {
    const trail = [];
    for (let category = byId.get(id); category; category = byId.get(parents.get(category.id))) {
      trail.push({ id: category.id, name: category.name, label: labelOf(category) });
    }
    return trail.reverse();
  }
  const rootRank = category => systemOrder.has(category.systemKey) ? systemOrder.get(category.systemKey)
    : systemOrder.size + (category.kind === 'project' ? 0 : 1);

  return {
    has: id => reachable.has(id),
    accepts: id => selectable.has(id),
    browse(parentId = null, query = '') {
      const current = typeof parentId === 'string' && available.has(parentId) ? parentId : null;
      const needle = String(query || '').trim().toLocaleLowerCase(), matches = matchingBranches(needle);
      const trail = current ? trailFor(current) : [];
      const rows = (children.get(current) || []).filter(category => matches.has(category.id) && available.has(category.id))
        .sort((a, b) => (current === null ? rootRank(a) - rootRank(b) : 0)
          || Number(!!b.pinned) - Number(!!a.pinned) || positions.get(a.id) - positions.get(b.id))
        .map(category => ({
          id: category.id, name: category.name, label: labelOf(category), category,
          canSelect: selectable.has(category.id),
          hasChildren: (children.get(category.id) || []).some(child => matches.has(child.id) && available.has(child.id)),
        }));
      return {
        parentId: current, parent: current ? byId.get(current) : null, trail, rows, query: needle,
        backId: trail.length > 1 ? trail.at(-2).id : null, canSelectCurrent: selectable.has(current),
      };
    },
  };
}

/** Only the new copy receives the selected destination. No asset is mutated. */
export function duplicateCategoryOptions(categories, mode, choice = { kind: 'inherit' }) {
  if (!MEDIA_MODES.has(mode)) throw new Error('素材类型与分类类型不匹配');
  if (!choice || typeof choice !== 'object' || Array.isArray(choice)) throw new Error('请选择复制后的素材分类');
  if (choice.kind === 'inherit') return {};
  if (choice.kind === 'uncategorized') return { categoryId: null };
  if (choice.kind !== 'category' || typeof choice.categoryId !== 'string' || !choice.categoryId) throw new Error('请选择复制后的素材分类');
  const navigation = createCategoryAssignmentNavigation(categories, [mode]);
  if (!navigation.has(choice.categoryId)) throw new Error('所选分类不存在或分类路径无效，请重新选择');
  if (!navigation.accepts(choice.categoryId)) throw new Error('素材类型与分类类型不匹配，请选择兼容的分类');
  return { categoryId: choice.categoryId };
}
