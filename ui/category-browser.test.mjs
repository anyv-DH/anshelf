/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { categoryBrowser, categoryTrail, favoriteCategoryGroups, favoriteCategoryMatches, FAVORITE_UNCATEGORIZED } from './category-browser.mjs';

const categories = [
  { id: 'weapon', name: '武器', parentId: null },
  { id: 'sword', name: '剑', parentId: 'weapon' },
  { id: 'long', name: '长剑', parentId: 'sword' },
  { id: 'short', name: '短剑', parentId: 'sword', pinned: true },
  { id: 'fire', name: '火焰', parentId: null, scope: 'effect' },
  { id: 'magic', name: '魔法火焰', parentId: 'fire', scope: 'effect' },
  { id: 'urban', name: '都市人物', parentId: null, scope: 'ordinary' },
  { id: 'female', name: '女', parentId: 'urban', scope: 'ordinary' },
  { id: 'male', name: '男', parentId: 'urban', scope: 'ordinary' },
  { id: 'background', name: '背景', parentId: null, scope: 'ordinary' },
  { id: 'indoor', name: '室内', parentId: 'background', scope: 'ordinary' },
  { id: 'outdoor', name: '户外', parentId: 'background', scope: 'ordinary' },
  { id: 'music', name: '音乐', parentId: null, scope: 'audio' },
  { id: 'shared', name: '旧分类', parentId: null },
];
const assets = [{ id: 'fx', categoryId: 'shared', assetType: 'effect', kind: 'fla' }];

test('a selected folder exposes only immediate children, with pinned order and a usable parent', () => {
  const root = categoryBrowser(categories, assets, 'weapon', 'all');
  assert.deepEqual(root.children.map(c => c.id), ['sword']);
  const child = categoryBrowser(categories, assets, 'sword', 'ordinary');
  assert.deepEqual(child.children.map(c => c.id), ['short', 'long']);
  assert.equal(child.parentId, 'weapon');
  assert.deepEqual(child.path.map(c => c.id), ['weapon', 'sword']);
  assert.equal(child.creationParent, 'sword');
});

test('type roots show their own empty categories and compatible legacy categories without unrelated folders', () => {
  const effects = categoryBrowser(categories, assets, 'effects', 'effect');
  assert.deepEqual(effects.children.map(c => c.id), ['fire', 'shared']);
  assert.equal(effects.creationScope, 'effect');
  assert.equal(effects.creationParent, null);
  const audio = categoryBrowser(categories, assets, 'audio', 'audio');
  assert.deepEqual(audio.children.map(c => c.id), ['music']);
  assert.equal(categoryBrowser(categories, assets, 'fire', 'effect').parentId, 'effects');
});

test('typed ordinary roots expose folder buttons, then only the deeper children', () => {
  const root = categoryBrowser(categories, [], 'ordinary', 'ordinary');
  assert.deepEqual(root.children.map(c => c.id), ['urban', 'background']);
  const urban = categoryBrowser(categories, [], 'urban', 'ordinary');
  assert.deepEqual(urban.children.map(c => c.id), ['female', 'male']);
  assert.deepEqual(categoryTrail(categories, 'urban', 'ordinary'), [
    { id: 'ordinary', name: '普通素材' }, { id: 'urban', name: '都市人物' },
  ]);
  assert.deepEqual(categoryTrail(categories, 'background', 'ordinary'), [
    { id: 'ordinary', name: '普通素材' }, { id: 'background', name: '背景' },
  ]);
});

test('all and special collection views do not repeat sidebar roots; cycles do not hang navigation', () => {
  for (const id of ['all', 'favorites', 'liked', 'uncategorized', 'missing']) {
    assert.equal(categoryBrowser(categories, assets, id, 'all').visible, false);
  }
  const malformed = [{ id: 'a', parentId: 'b', name: 'A' }, { id: 'b', parentId: 'a', name: 'B' }];
  assert.ok(categoryBrowser(malformed, [], 'a', 'all').path.length <= 2);
  assert.equal(categoryBrowser(categories, assets, 'magic', 'effect').children.length, 0);
});

test('normalized legacy shared categories return to the current effect or audio root', () => {
  const legacy = [{ id: 'shared', name: '旧共享类目', parentId: null, scope: 'all' }];
  const mixed = [{ id: 'fx', kind: 'fla', assetType: 'effect', categoryId: 'shared' },
    { id: 'audio', kind: 'audio', assetType: 'audio', categoryId: 'shared' }];
  assert.equal(categoryBrowser(legacy, mixed, 'shared', 'effect').parentId, 'effects');
  assert.equal(categoryBrowser(legacy, mixed, 'shared', 'audio').parentId, 'audio');
  assert.equal(categoryBrowser(legacy, mixed, 'shared', 'all').parentId, 'all');
});

test('legacy shared folders keep the active media scope while typed folders select theirs', () => {
  const legacyEffect = categoryBrowser(categories, assets, 'shared', 'effect');
  assert.equal(legacyEffect.parentId, 'effects');
  assert.equal(legacyEffect.creationScope, 'effect');
  const typedAudio = categoryBrowser(categories, assets, 'music', 'effect');
  assert.equal(typedAudio.parentId, 'audio');
  assert.equal(typedAudio.creationScope, 'audio');
});

test('favorite category groups reuse the original category path and keep liked views separate', () => {
  const groups = favoriteCategoryGroups(categories, [
    { id: 'a', favorite: true, categoryId: 'female', assetType: 'ordinary' },
    { id: 'b', favorite: true, categoryId: 'female', assetType: 'ordinary' },
    { id: 'c', favorite: true, categoryId: 'background', assetType: 'ordinary' },
    { id: 'd', favorite: true, categoryId: null, assetType: 'ordinary' },
    { id: 'e', favorite: false, categoryId: 'urban', assetType: 'ordinary' },
  ]);
  assert.deepEqual(groups.map(group => ({ id: group.id, name: group.name, count: group.count })), [
    { id: 'background', name: '背景', count: 1 },
    { id: 'female', name: '都市人物 / 女', count: 2 },
    { id: FAVORITE_UNCATEGORIZED, name: '未分类', count: 1 },
  ]);
});

test('favorite category filters use the original direct folder and isolate uncategorized assets', () => {
  const scoped = [
    { id: 'parent', favorite: true, categoryId: 'urban' },
    { id: 'child', favorite: true, categoryId: 'female' },
    { id: 'none', favorite: true, categoryId: null },
    { id: 'stale', favorite: true, categoryId: 'deleted-folder' },
    { id: 'unliked', favorite: false, categoryId: 'female' },
  ];
  const groups = favoriteCategoryGroups(categories, scoped);
  assert.deepEqual(new Set(groups.map(group => group.id)), new Set(['female', 'urban', FAVORITE_UNCATEGORIZED]));
  assert.equal(favoriteCategoryMatches(categories, scoped[0], 'urban'), true);
  assert.equal(favoriteCategoryMatches(categories, scoped[1], 'urban'), false);
  assert.equal(favoriteCategoryMatches(categories, scoped[2], FAVORITE_UNCATEGORIZED), true);
  assert.equal(favoriteCategoryMatches(categories, scoped[3], FAVORITE_UNCATEGORIZED), true);
  assert.equal(favoriteCategoryMatches(categories, scoped[4], 'female'), true);
});
