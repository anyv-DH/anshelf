/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { selectAsset, visibleAssets, categoryCount, isLiked, categoryDescendantIds, gridColumns } from './model.js';

test('shift selects the current visible range and ctrl toggles a single item', () => {
  const ids = ['a', 'b', 'c', 'd'];
  let result = selectAsset(new Set(), null, 'b', ids, {});
  result = selectAsset(result.selected, result.anchor, 'd', ids, { shift: true });
  assert.deepEqual([...result.selected], ['b', 'c', 'd']);
  result = selectAsset(result.selected, result.anchor, 'c', ids, { ctrl: true });
  assert.deepEqual([...result.selected], ['b', 'd']);
});

test('category, favorites, tag search and sorting apply together', () => {
  const assets = [
    { id: '1', name: '云朵.fla', categoryId: 'sky', tags: ['柔和'], favorite: true, createdAt: 1 },
    { id: '2', name: '星空.fla', categoryId: 'sky', tags: ['夜晚'], favorite: true, createdAt: 3 },
    { id: '3', name: '云朵二.fla', categoryId: null, tags: [], favorite: false, createdAt: 2 },
  ];
  assert.deepEqual(visibleAssets(assets, 'favorites', '夜晚', 'newest').map(a => a.id), ['2']);
  assert.deepEqual(visibleAssets(assets, 'sky', '', 'newest').map(a => a.id), ['2', '1']);
  assert.equal(categoryCount(assets, 'uncategorized'), 1);
});

test('missing shift anchor starts a fresh selection instead of selecting unrelated files', () => {
  const result = selectAsset(new Set(['gone']), 'gone', 'c', ['a', 'b', 'c'], { shift: true });
  assert.deepEqual([...result.selected], ['c']);
});

test('grid density honors a requested row while reducing columns to keep cards readable', () => {
  assert.equal(gridColumns(1012, '5'), 5);
  assert.equal(gridColumns(1012, '6'), 6);
  assert.equal(gridColumns(1179, '6'), 6);
  assert.equal(gridColumns(700, '6'), 4);
  assert.equal(gridColumns(460, '5'), 2);
  assert.equal(gridColumns(155, '6'), 1);
  assert.equal(gridColumns(0, '6'), 1);
  assert.equal(gridColumns(1012, 'auto'), 5);
  assert.equal(gridColumns(460, 'auto'), 2);
  assert.equal(gridColumns(1012, 'invalid'), 5);
});

test('likes expire after 24 hours while favorites remain visible', () => {
  const now = Date.now();
  const assets = [
    { id: 'recent', name: '武器', liked: true, likedAt: now - 1000 },
    { id: 'expired', name: '人物', liked: true, likedAt: now - 86400000, favorite: true },
    { id: 'removed', name: '背景', liked: false, likedAt: now },
  ];
  assert.equal(isLiked(assets[0], now), true);
  assert.equal(isLiked({ liked: true, likedAt: new Date(now - 1000).toISOString() }, now), true);
  assert.equal(isLiked(assets[1], now), false);
  assert.equal(isLiked({ liked: true, likedAt: now + 1000 }, now), false);
  assert.deepEqual(visibleAssets(assets, 'liked', '', 'newest').map(item => item.id), ['recent']);
  assert.equal(categoryCount(assets, 'favorites'), 1);
});

test('a parent category browses all descendants without looping on malformed hierarchy', () => {
  const categories = [{ id: 'people', parentId: null }, { id: 'male', parentId: 'people' }, { id: 'female', parentId: 'people' }, { id: 'child', parentId: 'female' }, { id: 'a', parentId: 'b' }, { id: 'b', parentId: 'a' }];
  const assets = [{ id: '1', categoryId: 'people' }, { id: '2', categoryId: 'male' }, { id: '3', categoryId: 'child' }, { id: '4', categoryId: null }];
  assert.deepEqual([...categoryDescendantIds(categories, 'people')], ['people', 'male', 'female', 'child']);
  assert.deepEqual([...categoryDescendantIds(categories, 'a')], ['a', 'b']);
  assert.deepEqual(visibleAssets(assets, 'people', '', 'newest', categories).map(item => item.id), ['1', '2', '3']);
  assert.equal(categoryCount(assets, 'people', categories), 3);
});

test('hiding child-classified assets keeps only assets directly assigned to the current folder', () => {
  const categories = [
    { id: 'people', name: '人物', parentId: null, scope: 'ordinary' },
    { id: 'female', name: '女', parentId: 'people', scope: 'ordinary' },
    { id: 'adult', name: '成年', parentId: 'female', scope: 'ordinary' },
  ];
  const assets = [
    { id: 'parent', categoryId: 'people' },
    { id: 'child', categoryId: 'female' },
    { id: 'grandchild', categoryId: 'adult' },
    { id: 'outside', categoryId: null },
  ];
  assert.deepEqual(visibleAssets(assets, 'people', '', 'newest', categories).map(item => item.id), ['parent', 'child', 'grandchild']);
  assert.deepEqual(visibleAssets(assets, 'people', '', 'newest', categories, 'ordinary', { hideChildCategories: true }).map(item => item.id), ['parent']);
});

test('hiding child-classified assets from a typed root excludes all scoped categories but keeps unclassified media', () => {
  const categories = [
    { id: 'people', name: '人物', parentId: null, scope: 'ordinary' },
    { id: 'female', name: '女', parentId: 'people', scope: 'ordinary' },
    { id: 'music', name: '音乐', parentId: null, scope: 'audio' },
  ];
  const assets = [
    { id: 'ordinary-folder', categoryId: 'people' },
    { id: 'ordinary-child', categoryId: 'female' },
    { id: 'ordinary-loose', assetType: 'ordinary', categoryId: null },
    { id: 'audio-folder', kind: 'audio', categoryId: 'music' },
  ];
  assert.deepEqual(visibleAssets(assets, 'ordinary', '', 'newest', categories, 'ordinary', { hideChildCategories: true }).map(item => item.id), ['ordinary-loose']);
  assert.deepEqual(visibleAssets(assets, 'audio', '', 'newest', categories, 'audio', { hideChildCategories: true }).map(item => item.id), []);
});

test('child-folder hiding does not alter all-assets, favorites or daily-like views', () => {
  const categories = [{ id: 'root', name: '根', parentId: null }, { id: 'child', name: '子', parentId: 'root' }];
  const assets = [{ id: 'direct', categoryId: 'root', favorite: true, liked: true, likedAt: Date.now() }, { id: 'nested', categoryId: 'child', favorite: true, liked: true, likedAt: Date.now() }];
  for (const view of ['all', 'favorites', 'liked']) {
    assert.deepEqual(visibleAssets(assets, view, '', 'newest', categories, 'all', { hideChildCategories: true }).map(item => item.id), ['direct', 'nested']);
  }
});
