/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const TYPED_SCOPES = new Set(['ordinary', 'effect', 'audio']);
const SYSTEM_SCOPES = Object.freeze({ character: 'ordinary', scene: 'ordinary', expression: 'ordinary', prop: 'ordinary',
  effect: 'effect', creature: 'ordinary', audio: 'audio', bgm: 'audio' });

/** UI write targets follow the displayed taxonomy without changing old records. */
export function createCategoryCompatibility(categories) {
  const byId = new Map((Array.isArray(categories) ? categories : []).map(category => [category.id, category]));
  const resolved = new Map();
  function scope(id, seen = new Set()) {
    if (resolved.has(id)) return resolved.get(id);
    const category = byId.get(id);
    if (!category || seen.has(id)) return null;
    seen.add(id);
    let result;
    if (TYPED_SCOPES.has(category.scope)) result = category.scope;
    else if (category.scope !== undefined && category.scope !== 'all') result = null;
    else if (Object.hasOwn(SYSTEM_SCOPES, category.systemKey)) result = SYSTEM_SCOPES[category.systemKey];
    else if (category.kind === 'project' || !category.parentId) result = 'all';
    else result = scope(category.parentId, seen);
    resolved.set(id, result);
    return result;
  }
  return {
    scope,
    accepts(id, mode) {
      const mediaScope = mode === 'image' ? 'ordinary' : mode;
      if (!TYPED_SCOPES.has(mediaScope)) return false;
      const targetScope = scope(id);
      return targetScope === 'all' || targetScope === mediaScope;
    },
  };
}

export function effectiveCategoryScope(categories, id) {
  return createCategoryCompatibility(categories).scope(id);
}

export function categoryAccepts(categories, id, mode) {
  return createCategoryCompatibility(categories).accepts(id, mode);
}
