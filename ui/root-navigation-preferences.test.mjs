/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRootNavigationPreferences, rootNavigationView, updateRootNavigation } from './root-navigation.mjs';

const roots = ['people', 'scene', 'effect', 'project'].map(id => ({ id, name: id, parentId: null }));
const store = () => { const items = new Map(); return { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value) }; };

test('top navigation can hide roots and put frequent roots first without mutating library metadata', () => {
  const before = JSON.stringify(roots);
  const prefs = { hidden: ['scene'], order: ['project', 'people'] };
  const view = rootNavigationView(roots, '', prefs);
  assert.deepEqual(view.ordered.map(item => item.id), ['project', 'people', 'scene', 'effect']);
  assert.deepEqual(view.visible.map(item => item.id), ['project', 'people', 'effect']);
  assert.equal(JSON.stringify(roots), before);
});

test('a selected hidden root is temporarily visible without undoing its saved hidden preference', () => {
  const prefs = { hidden: ['scene'], order: [] };
  const view = rootNavigationView(roots, 'scene', prefs);
  assert.deepEqual(view.visible.map(item => item.id), ['people', 'scene', 'effect', 'project']);
  assert.equal(view.temporaryId, 'scene');
  assert.deepEqual(rootNavigationView(roots, 'people', prefs).visible.map(item => item.id), ['people', 'effect', 'project']);
  assert.deepEqual(prefs.hidden, ['scene']);
});

test('reordering and unpinning persist across preference controllers while new roots remain reachable', () => {
  const storage = store(), prefs = createRootNavigationPreferences(storage);
  prefs.set(updateRootNavigation(roots, prefs.get(), 'project', 'first'));
  prefs.set(updateRootNavigation(roots, prefs.get(), 'scene', 'hide'));
  const restored = createRootNavigationPreferences(storage).get();
  assert.deepEqual(rootNavigationView([...roots, { id: 'new' }], '', restored).visible.map(item => item.id), ['project', 'people', 'effect', 'new']);
  prefs.set(updateRootNavigation(roots, restored, 'scene', 'show'));
  assert.ok(rootNavigationView(roots, '', prefs.get()).visible.some(item => item.id === 'scene'));
});

test('moving one place respects saved order; missing IDs and invalid changes leave valid roots reachable', () => {
  const prefs = updateRootNavigation(roots, {}, 'effect', 'up');
  assert.deepEqual(rootNavigationView(roots, '', prefs).ordered.map(item => item.id), ['people', 'effect', 'scene', 'project']);
  const down = updateRootNavigation(roots, prefs, 'effect', 'down');
  assert.deepEqual(rootNavigationView(roots, '', down).ordered, roots);
  assert.deepEqual(updateRootNavigation(roots, down, 'missing', 'hide'), down);
  const removed = rootNavigationView(roots.slice(1), '', { order: ['missing', 'project', 'project'], hidden: ['missing', 'scene'] });
  assert.deepEqual(removed.visible.map(item => item.id), ['project', 'effect']);
});

test('bad or unavailable storage uses defaults and retains changes for the current session', () => {
  const corrupt = createRootNavigationPreferences({ getItem: () => '{bad', setItem() { throw Error('disk'); } });
  assert.deepEqual(corrupt.get(), { hidden: [], order: [] });
  assert.equal(corrupt.set({ hidden: ['scene', 'scene', null], order: ['project', 'project', 1] }), false);
  assert.deepEqual(corrupt.get(), { hidden: ['scene'], order: ['project'] });
  const copy = corrupt.get(); copy.hidden.push('effect');
  assert.deepEqual(corrupt.get().hidden, ['scene']);
});

