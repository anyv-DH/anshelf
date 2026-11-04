/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import { assetCategoryIds, categoryDescendantIds, categoryPath } from './model.js';

const virtualViews = new Set(['all', 'ordinary', 'effects', 'audio', 'uncategorized', 'favorites', 'liked']);

/** Resolve deletion intent before confirmation. A real folder only cancels
 * memberships inside its tree; explicit library removal affects every view. */
export function planRemoval(state, fromLibrary = false) {
  const { assets, categories } = state.snapshot;
  const category = categories.find(item => item.id === state.category);
  if (!category && !virtualViews.has(state.category) && !fromLibrary) return null;
  const categoryIds = category && !fromLibrary ? [...categoryDescendantIds(categories, category.id)] : null;
  const selected = assets.filter(asset => state.selected.has(asset.id) && (!categoryIds || assetCategoryIds(asset).some(id => categoryIds.includes(id))));
  if (!selected.length) return null;
  const ids = selected.map(asset => asset.id), count = ids.length;
  if (categoryIds) {
    const path = categoryPath(categories, category.id);
    const scope = `“${path}”${categoryIds.length > 1 ? '及其子分类' : ''}`;
    return {
      scope: 'category', count, method: 'removeFromCategories', args: [ids, categoryIds],
      buttonLabel: '从当前分类移除', title: `仅从${scope}移除选中项，保留其他分类与素材`,
      confirmation: `您确定要从${scope}移除选中的 ${count} 项吗？\n\n仅取消这些素材在当前分类${categoryIds.length > 1 ? '及其子分类' : ''}中的归属；其他分类、素材库中的素材和文件都保留。\n没有其他分类归属的素材会进入“未分类”。\n此操作可撤销。`,
      success: `已从当前分类${categoryIds.length > 1 ? '及子分类' : ''}移除 ${count} 项 · 素材与其他分类保留`,
    };
  }
  return {
    scope: 'library', count, method: 'removeAssets', args: [ids],
    buttonLabel: '从素材库移除', title: '从整个素材库移除选中项，同时影响所有分类',
    confirmation: `您确定要从整个素材库移除选中的 ${count} 项吗？\n\n这会同时移除这些素材在所有分类、收藏和点赞中的记录，并非只移出当前页面。\n导入目录中的原始文件不会被删除。\n此操作可撤销。`,
    success: `已从素材库及所有分类移除 ${count} 项`,
  };
}
