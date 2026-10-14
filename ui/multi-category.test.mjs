/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleAssets, categoryCount } from './model.js';
import { favoriteCategoryGroups, favoriteCategoryMatches, categoryBrowser } from './category-browser.mjs';
const categories = [{ id: 'a', name: '剧集一', parentId: null, scope: 'ordinary' }, { id: 'b', name: '剧集二', parentId: null, scope: 'all' }, { id: 'c', name: '女', parentId: 'b', scope: 'all' }];
const asset = { id: 'shared', categoryId: 'a', categoryIds: ['a', 'c'], favorite: true, name: '女主', assetType: 'ordinary' };

test('shared asset counts once in each category tree and remains discoverable in legacy category buttons', () => {
  assert.equal(categoryCount([asset], 'b', categories), 1);
  assert.deepEqual(visibleAssets([asset], 'b', '', 'newest', categories).map(item => item.id), ['shared']);
  assert.deepEqual(visibleAssets([asset], 'a', '', 'newest', categories).map(item => item.id), ['shared']);
  assert.equal(visibleAssets([asset], 'b', '', 'newest', categories, 'all', { hideChildCategories: true }).length, 0);
  assert.equal(visibleAssets([asset], 'a', '', 'newest', categories, 'all', { hideChildCategories: true }).length, 1);
  assert.equal(visibleAssets([asset], 'uncategorized', '', 'newest', categories).length, 0);
  assert.equal(categoryBrowser(categories, [asset], 'ordinary', 'ordinary').children.some(item => item.id === 'b'), true);
});

test('favorites expose each shared category path without duplicating cards', () => {
  assert.deepEqual(new Set(favoriteCategoryGroups(categories, [asset]).map(item => item.id)), new Set(['a', 'c']));
  assert.equal(favoriteCategoryMatches(categories, asset, 'c'), true);
  assert.equal(favoriteCategoryMatches(categories, asset, 'all'), true);
});
