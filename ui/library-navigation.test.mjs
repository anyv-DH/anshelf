import test from 'node:test';
import assert from 'node:assert/strict';
import { libraryNavigation, categoryScope, collectionAssets, mediaCategory } from './library-navigation.mjs';
import * as navigation from './library-navigation.mjs';

const categories = [
  { id: 'c', name: '人物', systemKey: 'character', parentId: null, scope: 'all' },
  { id: 'e', name: '特效', systemKey: 'effect', parentId: null, scope: 'effect' },
  { id: 'm', name: '现代都市', parentId: 'c', scope: 'all' },
  { id: 'a', name: '古代人物', parentId: 'c', scope: 'all' },
  { id: 'd', name: '男', parentId: 'm', scope: 'all' },
  { id: 'p', name: '我的剧', kind: 'project', parentId: null, scope: 'all' },
  { id: 'legacy', name: '旧分类', parentId: null, scope: 'all' },
];
test('root order is canonical, followed by projects and ordinary custom roots', () => {
  const view = libraryNavigation(categories, 'all');
  assert.deepEqual(view.roots.map(x => x.id), ['c', 'e', 'p', 'legacy']);
  assert.equal(view.root, null);
});
test('custom top-level folders remain in stored order without duplicating system projects or including children', () => {
  const sample = [
    { id: 'custom-first', name: '第一部剧', parentId: null },
    { id: 'sound', name: '音效', systemKey: 'audio', parentId: null },
    { id: 'project', name: '第二部剧', kind: 'project', parentId: null },
    { id: 'people', name: '人物', systemKey: 'character', kind: 'project', parentId: null },
    { id: 'custom-last', name: '素材资料', parentId: null },
    { id: 'child', name: '子分类', parentId: 'custom-last' },
    { id: 'future-root', name: '其他顶层', systemKey: 'future', parentId: null },
  ];
  const before = JSON.stringify(sample);
  assert.deepEqual(libraryNavigation(sample, 'custom-last').roots.map(x => x.id),
    ['people', 'sound', 'custom-first', 'project', 'custom-last', 'future-root']);
  assert.equal(JSON.stringify(sample), before);
});
test('deep selection retains root first-level siblings and exposes deeper folders separately', () => {
  const view = libraryNavigation(categories, 'd');
  assert.equal(view.root.id, 'c');
  assert.equal(view.firstSelected, 'm');
  assert.deepEqual(view.children.map(x => x.id), ['m', 'a']);
  assert.deepEqual(libraryNavigation(categories, 'm').deeper.map(x => x.id), ['d']);
});
test('system type overrides legacy shared scope while projects reset media filtering', () => {
  assert.equal(categoryScope(categories, 'd', 'audio'), 'ordinary');
  assert.equal(categoryScope(categories, 'p', 'effect'), 'all');
  assert.equal(categoryScope(categories, 'legacy', 'audio'), 'audio');
  assert.equal(categoryScope(categories, 'all', 'audio'), 'all');
});
test('collection filters intersect current assets and respect expiry', () => {
  const assets = [{ id: '1', favorite: true }, { id: '2', liked: true, likedAt: Date.now() }, { id: '3', liked: true, likedAt: 1 }];
  assert.deepEqual(collectionAssets(assets, 'favorites').map(x => x.id), ['1']);
  assert.deepEqual(collectionAssets(assets, 'liked').map(x => x.id), ['2']);
  assert.equal(collectionAssets(assets, 'all'), assets);
});
test('media roots include old scattered assets without changing category memberships', () => {
  assert.equal(mediaCategory(categories, 'e'), 'effects');
  assert.equal(mediaCategory(categories, 'c'), 'c');
  assert.equal(mediaCategory(categories, 'm'), 'm');
  assert.equal(mediaCategory(categories, 'legacy'), 'legacy');
});

test('all eight system roots use canonical order and labels while old stored names stay intact', () => {
  const keys = ['character', 'scene', 'expression', 'prop', 'effect', 'creature', 'audio', 'bgm'];
  const sample = keys.toReversed().map(key => ({ id: key, systemKey: key, name: key === 'scene' ? '场景' : key === 'audio' ? '音频' : key, parentId: null, scope: 'all' }));
  sample.push({ id: 'project', name: '项目', kind: 'project', scope: 'all', parentId: null });
  const before = JSON.stringify(sample);
  const roots = libraryNavigation(sample, 'all').roots;
  assert.deepEqual(roots.map(c => c.id), [...keys, 'project']);
  assert.deepEqual(keys.map(key => navigation.SYSTEM_LABELS[key]), ['人物', '背景', '表情', '道具', '特效', '动物异兽', '音效', 'BGM']);
  assert.equal(categoryScope(sample, 'creature', 'audio'), 'ordinary');
  assert.equal(categoryScope(sample, 'bgm', 'ordinary'), 'audio');
  assert.equal(JSON.stringify(sample), before);
});

test('sound effects aggregate legacy audio but exclude BGM memberships and descendants', () => {
  const sample = [
    { id: 'sound', systemKey: 'audio', name: '音频', parentId: null, scope: 'audio' },
    { id: 'bgm-root', systemKey: 'bgm', name: 'BGM', parentId: null, scope: 'audio' },
    { id: 'bgm-child', name: '片头', parentId: 'bgm-root', scope: 'audio' },
    { id: 'bgm-grandchild', name: '轻快', parentId: 'bgm-child', scope: 'audio' },
    { id: 'legacy', name: '旧音乐', parentId: null, scope: 'all' },
  ];
  const assets = [
    { id: 'unclassified', kind: 'audio', assetType: 'audio', categoryIds: [] },
    { id: 'old', kind: 'audio', assetType: 'audio', categoryId: 'legacy', categoryIds: ['legacy'] },
    { id: 'score', kind: 'audio', assetType: 'audio', categoryId: 'bgm-root', categoryIds: ['bgm-root'] },
    { id: 'theme', kind: 'audio', assetType: 'audio', categoryId: 'bgm-grandchild', categoryIds: ['bgm-grandchild'] },
    { id: 'shared', kind: 'audio', assetType: 'audio', categoryId: 'legacy', categoryIds: ['legacy', 'bgm-child'] },
  ];
  const before = JSON.stringify({ sample, assets });
  assert.deepEqual(navigation.mediaRootAssets(assets, sample, 'sound').map(a => a.id), ['unclassified', 'old']);
  assert.equal(navigation.mediaRootAssets(assets, sample, 'bgm-root'), assets);
  assert.equal(navigation.mediaRootAssets(assets, sample, 'legacy'), assets);
  assert.equal(mediaCategory(sample, 'bgm-root'), 'bgm-root');
  assert.equal(mediaCategory(sample, 'sound'), 'audio');
  assert.equal(JSON.stringify({ sample, assets }), before);
});
