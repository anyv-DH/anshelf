/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveCategoryScope, categoryAccepts, createCategoryCompatibility } from './category-compatibility.mjs';

const categories = [
  { id: 'people', name: '人物', scope: 'all', systemKey: 'character', parentId: null },
  { id: 'modern', name: '现代都市', scope: 'all', parentId: 'people' },
  { id: 'male', name: '男', scope: 'all', parentId: 'modern' },
  { id: 'effect', name: '特效', scope: 'all', systemKey: 'effect', parentId: null },
  { id: 'effect-child', name: '转场', parentId: 'effect' },
  { id: 'audio', name: '音频', scope: 'all', systemKey: 'audio', parentId: null },
  { id: 'project', name: '我的剧', scope: 'all', kind: 'project', parentId: null },
  { id: 'project-audio', name: '配乐', scope: 'audio', parentId: 'project' },
  { id: 'project-audio-child', name: '片尾曲', scope: 'all', parentId: 'project-audio' },
  { id: 'legacy', name: '旧分类', scope: 'all', parentId: null },
  { id: 'legacy-child', name: '旧子类', parentId: 'legacy' },
];

test('legacy all-scoped system roots and their children accept only their displayed media type', () => {
  for (const id of ['people', 'modern', 'male']) {
    assert.equal(effectiveCategoryScope(categories, id), 'ordinary');
    assert.equal(categoryAccepts(categories, id, 'ordinary'), true);
    assert.equal(categoryAccepts(categories, id, 'audio'), false);
    assert.equal(categoryAccepts(categories, id, 'effect'), false);
  }
  for (const id of ['effect', 'effect-child']) {
    assert.equal(effectiveCategoryScope(categories, id), 'effect');
    assert.equal(categoryAccepts(categories, id, 'ordinary'), false);
    assert.equal(categoryAccepts(categories, id, 'effect'), true);
  }
  assert.equal(effectiveCategoryScope(categories, 'audio'), 'audio');
  assert.equal(categoryAccepts(categories, 'audio', 'ordinary'), false);
});

test('projects and non-system legacy all folders remain shared while typed project descendants stay restricted', () => {
  for (const id of ['project', 'legacy', 'legacy-child']) {
    assert.equal(effectiveCategoryScope(categories, id), 'all');
    for (const mode of ['ordinary', 'effect', 'audio']) assert.equal(categoryAccepts(categories, id, mode), true);
  }
  for (const id of ['project-audio', 'project-audio-child']) {
    assert.equal(effectiveCategoryScope(categories, id), 'audio');
    assert.equal(categoryAccepts(categories, id, 'audio'), true);
    assert.equal(categoryAccepts(categories, id, 'ordinary'), false);
  }
});

test('explicit typed category scope takes priority and every system identity has a fixed mapping', () => {
  const sample = ['character', 'scene', 'prop', 'expression', 'effect', 'audio'].map(key => ({ id: key, systemKey: key, scope: 'all' }));
  sample.push({ id: 'explicit', scope: 'audio', parentId: 'character' });
  for (const id of ['character', 'scene', 'prop', 'expression']) assert.equal(effectiveCategoryScope(sample, id), 'ordinary');
  assert.equal(effectiveCategoryScope(sample, 'effect'), 'effect');
  assert.equal(effectiveCategoryScope(sample, 'audio'), 'audio');
  assert.equal(effectiveCategoryScope(sample, 'explicit'), 'audio');
});

test('unknown targets, invalid scopes, cycles and unsupported media cannot become writable UI targets', () => {
  const sample = [{ id: 'a', parentId: 'b' }, { id: 'b', parentId: 'a' }, { id: 'invalid', scope: 'video' }];
  for (const id of ['missing', 'a', 'b', 'invalid']) {
    assert.equal(effectiveCategoryScope(sample, id), null);
    assert.equal(categoryAccepts(sample, id, 'ordinary'), false);
  }
  for (const mode of ['', 'all', 'video', null, {}, '__proto__']) assert.equal(categoryAccepts(categories, 'project', mode), false);
});

test('a single compatibility index supports menu filtering without mutating historic metadata', () => {
  const before = JSON.stringify(categories);
  const compatible = createCategoryCompatibility(categories);
  assert.deepEqual(categories.filter(item => compatible.accepts(item.id, 'effect')).map(item => item.id), ['effect', 'effect-child', 'project', 'legacy', 'legacy-child']);
  assert.equal(compatible.scope('male'), 'ordinary');
  assert.equal(JSON.stringify(categories), before);
});

test('creature and BGM roots inherit their media scope and images share ordinary destinations', () => {
  const sample = [
    { id: 'creature', systemKey: 'creature', scope: 'all', parentId: null },
    { id: 'beasts', scope: 'all', parentId: 'creature' },
    { id: 'bgm', systemKey: 'bgm', scope: 'all', parentId: null },
    { id: 'opening', scope: 'all', parentId: 'bgm' },
    { id: 'shared', kind: 'project', scope: 'all', parentId: null },
    { id: 'effect', systemKey: 'effect', scope: 'all', parentId: null },
    { id: 'audio', systemKey: 'audio', scope: 'all', parentId: null },
  ];
  const compatible = createCategoryCompatibility(sample);
  for (const id of ['creature', 'beasts']) {
    assert.equal(compatible.scope(id), 'ordinary');
    assert.equal(compatible.accepts(id, 'ordinary'), true);
    assert.equal(compatible.accepts(id, 'image'), true);
    assert.equal(compatible.accepts(id, 'audio'), false);
  }
  for (const id of ['bgm', 'opening']) {
    assert.equal(compatible.scope(id), 'audio');
    assert.equal(compatible.accepts(id, 'audio'), true);
    assert.equal(compatible.accepts(id, 'image'), false);
  }
  assert.equal(compatible.accepts('shared', 'image'), true);
  assert.equal(compatible.accepts('effect', 'image'), false);
  assert.equal(compatible.accepts('audio', 'image'), false);
});
