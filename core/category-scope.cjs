/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const CATEGORY_SCOPES = Object.freeze(['all', 'ordinary', 'effect', 'audio']);

function checkScope(scope) {
  if (!CATEGORY_SCOPES.includes(scope)) throw new Error('分类范围类型无效');
  return scope;
}

function categoryScope(category) {
  return category.scope === undefined ? 'all' : checkScope(category.scope);
}

function normalizeCategoryScopes(categories) {
  for (const category of categories) if (category.scope === undefined) category.scope = 'all';
}

function validateCategoryScopes(categories) {
  const byId = new Map(categories.map(category => [category.id, category]));
  for (const category of categories) {
    const scope = categoryScope(category);
    if (category.parentId == null) continue;
    const parent = byId.get(category.parentId);
    if (!parent) throw new Error('分类不存在');
    if (categoryScope(parent) !== scope) throw new Error('子分类范围须与父分类类型一致');
  }
}

function resolveCategoryScope(categories, parentId, requestedScope = 'all') {
  checkScope(requestedScope);
  if (parentId === null) return requestedScope;
  const parent = categories.find(category => category.id === parentId);
  if (!parent) throw new Error('分类不存在');
  return categoryScope(parent);
}

function assertCategoryMoveScope(categories, category, parentId) {
  if (parentId === null) return;
  const parent = categories.find(item => item.id === parentId);
  if (!parent) throw new Error('分类不存在');
  if (categoryScope(category) !== categoryScope(parent)) throw new Error('不能移动到不同类型范围的分类');
}

module.exports = { CATEGORY_SCOPES, categoryScope, normalizeCategoryScopes, validateCategoryScopes, resolveCategoryScope, assertCategoryMoveScope };
