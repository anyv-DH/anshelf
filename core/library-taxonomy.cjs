/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const { randomUUID } = require('node:crypto');

const SYSTEM_CATEGORIES = Object.freeze([
  Object.freeze({ systemKey: 'character', name: '人物', scope: 'ordinary' }),
  Object.freeze({ systemKey: 'scene', name: '背景', scope: 'ordinary' }),
  Object.freeze({ systemKey: 'expression', name: '表情', scope: 'ordinary' }),
  Object.freeze({ systemKey: 'prop', name: '道具', scope: 'ordinary' }),
  Object.freeze({ systemKey: 'effect', name: '特效', scope: 'effect' }),
  Object.freeze({ systemKey: 'creature', name: '动物异兽', scope: 'ordinary' }),
  Object.freeze({ systemKey: 'audio', name: '音效', scope: 'audio' }),
  Object.freeze({ systemKey: 'bgm', name: 'BGM', scope: 'audio' }),
]);
const CHARACTER_CATEGORIES = Object.freeze(['现代都市', '玄幻修仙', '近代人物', '古代人物']);
const systemByKey = new Map(SYSTEM_CATEGORIES.map(category => [category.systemKey, category]));

function validateTaxonomy(state) {
  if (state.taxonomyVersion !== undefined && ![1, 2].includes(state.taxonomyVersion)) throw new Error('分类体系版本无效');
  const keys = new Set();
  for (const category of state.categories) {
    if (category.kind !== undefined && category.kind !== 'project') throw new Error('分类类型标志无效');
    if (category.kind === 'project' && (category.parentId != null || (category.scope ?? 'all') !== 'all')) throw new Error('项目分类须保持顶层且包含所有素材类型');
    if (category.systemKey === undefined) continue;
    const definition = systemByKey.get(category.systemKey);
    if (!definition || keys.has(category.systemKey) || category.kind === 'project' || category.parentId != null
      || !['all', definition.scope].includes(category.scope ?? 'all')) throw new Error('系统分类记录无效');
    keys.add(category.systemKey);
  }
}

function availableRootName(categories, preferred) {
  const occupied = new Set(categories.filter(category => category.parentId == null).map(category => category.name));
  if (!occupied.has(preferred)) return preferred;
  let number = 1;
  let name;
  do { name = `${preferred}（素材${number === 1 ? '' : number}）`; number++; } while (occupied.has(name));
  return name;
}

function ensureTaxonomy(state, { fresh = false } = {}) {
  const legacy = state.taxonomyVersion === undefined;
  const upgrading = legacy || state.taxonomyVersion === 1;
  let changed = upgrading;
  for (const definition of SYSTEM_CATEGORIES) {
    if (state.categories.some(category => category.systemKey === definition.systemKey)) continue;
    // Reusing a legacy unrestricted root preserves every mixed-type membership.
    // Incompatible roots stay intact and reachable in the full category tree.
    const legacyNames = definition.systemKey === 'scene' ? ['背景', '场景']
      : definition.systemKey === 'audio' ? ['音效', '音频'] : [definition.name];
    const existing = state.categories.find(category => category.parentId == null && category.kind !== 'project'
      && legacyNames.includes(category.name) && ['all', definition.scope].includes(category.scope ?? 'all'));
    if (existing) existing.systemKey = definition.systemKey;
    else state.categories.push({ id: randomUUID(), name: availableRootName(state.categories, definition.name),
      parentId: null, pinned: false, scope: definition.scope, systemKey: definition.systemKey });
    changed = true;
  }
  if (fresh || legacy) {
    const character = state.categories.find(category => category.systemKey === 'character');
    for (const name of CHARACTER_CATEGORIES) {
      if (state.categories.some(category => category.parentId === character.id && category.name === name)) continue;
      state.categories.push({ id: randomUUID(), name, parentId: character.id, pinned: false, scope: character.scope ?? 'all' });
      changed = true;
    }
  }
  state.taxonomyVersion = 2;
  return changed;
}

function assertCategoryEditable(category, { name = category.name, parentId = category.parentId, remove = false } = {}) {
  if (category.systemKey && (remove || name !== category.name || parentId !== category.parentId)) throw new Error('系统分类名称与顶层位置固定，不能移动或删除');
  if (category.kind === 'project' && parentId !== null) throw new Error('项目文件夹须保持在顶层');
}

module.exports = { SYSTEM_CATEGORIES, CHARACTER_CATEGORIES, validateTaxonomy, ensureTaxonomy, assertCategoryEditable };
