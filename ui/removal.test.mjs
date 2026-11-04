/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { planRemoval } from './removal.mjs';

const categories = [
  { id: 'a', name: '原分类' },
  { id: 'b', name: '新分类' },
  { id: 'child', name: '子文件夹', parentId: 'b' },
  { id: 'deep', name: '更深一层', parentId: 'child' },
];
const assets = [
  { id: 'shared', categoryId: 'a', categoryIds: ['a', 'b'], managedPath: 'assets/shared.fla' },
  { id: 'nested', categoryId: 'a', categoryIds: ['a', 'deep'], managedPath: 'assets/nested.fla' },
  { id: 'outside', categoryId: 'a' },
];
const state = (category, ids = ['shared']) => ({ category, snapshot: { assets, categories }, selected: new Set(ids) });

test('removing shared material from B plans category membership removal and preserves the asset', () => {
  const before = JSON.stringify(assets);
  const plan = planRemoval(state('b'));
  assert.equal(plan.method, 'removeFromCategories');
  assert.deepEqual(plan.args, [['shared'], ['b', 'child', 'deep']]);
  assert.equal(plan.scope, 'category');
  assert.match(plan.confirmation, /新分类.*子分类/);
  assert.match(plan.confirmation, /其他分类.*素材库.*保留/);
  assert.match(plan.confirmation, /未分类/);
  assert.equal(JSON.stringify(assets), before, 'planning does not mutate paths or memberships');
});

test('a parent category removes only selected memberships within its descendant tree in one batch', () => {
  const plan = planRemoval(state('b', ['shared', 'nested', 'outside', 'missing']));
  assert.deepEqual(plan.args, [['shared', 'nested'], ['b', 'child', 'deep']]);
  assert.equal(plan.count, 2);
  assert.deepEqual(planRemoval(state('child', ['nested'])).args, [['nested'], ['child', 'deep']]);
  assert.match(planRemoval(state('child', ['nested'])).confirmation, /新分类 \/ 子文件夹/);
});

test('global removal remains explicit and warns about every category even inside a real folder', () => {
  const plan = planRemoval(state('b'), true);
  assert.equal(plan.method, 'removeAssets');
  assert.deepEqual(plan.args, [['shared']]);
  assert.equal(plan.scope, 'library');
  assert.match(plan.confirmation, /整个素材库/);
  assert.match(plan.confirmation, /所有分类、收藏和点赞/);
  assert.match(plan.confirmation, /原始文件不会被删除/);
});

test('virtual views keep an explicitly global remove command and never infer folder membership from favorites', () => {
  for (const view of ['all', 'ordinary', 'effects', 'audio', 'uncategorized', 'favorites', 'liked']) {
    const plan = planRemoval({ ...state(view), favoriteCategory: 'b' });
    assert.equal(plan.method, 'removeAssets', view);
    assert.equal(plan.buttonLabel, '从素材库移除', view);
    assert.match(plan.confirmation, /并非只移出当前页面/, view);
  }
});

test('missing categories, stale selection and empty selection cannot silently expand into library removal', () => {
  assert.equal(planRemoval(state('gone')), null);
  assert.equal(planRemoval(state('b', ['outside', 'missing'])), null);
  assert.equal(planRemoval(state('all', [])), null);
  assert.equal(planRemoval(state('all', ['missing'])), null);
});
