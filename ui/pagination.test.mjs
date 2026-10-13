/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { pageAssets } from './pagination.mjs';
test('large libraries retain whole-library filtering while mounting only a page', () => {
  const library = Array.from({ length: 1000 }, (_, n) => ({ id: String(n) }));
  const first = pageAssets(library); assert.equal(first.items.length, 60); assert.equal(first.pages, 17); assert.equal(first.total, 1000);
  const last = pageAssets(library, 16); assert.equal(last.items.length, 40); assert.equal(last.items[0].id, '960');
  const search = pageAssets(library.filter(asset => asset.id === '999'), 16); assert.equal(search.page, 0); assert.deepEqual(search.items.map(a => a.id), ['999']);
  assert.equal(library.length, 1000);
});
test('removal and empty views clamp pages without losing remaining items', () => {
  assert.deepEqual(pageAssets([], 5), { items: [], page: 0, pages: 1, total: 0, size: 60 });
  const result = pageAssets(Array.from({ length: 61 }, (_, n) => n), 99); assert.equal(result.page, 1); assert.deepEqual(result.items, [60]);
  assert.equal(pageAssets([1], -4).page, 0);
});
