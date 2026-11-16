/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { pageAssets } from './pagination.mjs';
import { DEFAULT_BROWSE_PREFERENCES, BROWSE_PREFERENCES_KEY, normalizeBrowsePreferences, loadBrowsePreferences, saveBrowsePreferences, resolveBrowseLayout, applyBrowseLayout } from './browse-preferences.mjs';

test('browse mode and custom page count survive restart without storing library data', () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
  const preferences = saveBrowsePreferences({ mode: 'scroll', pageSize: 72, sourcePath: 'private' }, storage);
  assert.deepEqual(preferences, { mode: 'scroll', pageSize: 72 });
  assert.deepEqual(loadBrowsePreferences(storage), preferences);
  assert.equal(data.size, 1);
  assert.equal(data.get(BROWSE_PREFERENCES_KEY).includes('private'), false);
  assert.deepEqual(saveBrowsePreferences({ mode: 'fit', pageSize: 'auto' }, storage), { mode: 'fit', pageSize: 'auto' });
  assert.deepEqual(loadBrowsePreferences(storage), { mode: 'fit', pageSize: 'auto' });
});

test('damaged or unavailable preference storage keeps safe usable defaults', () => {
  assert.deepEqual(loadBrowsePreferences({ getItem() { throw Error('unavailable'); } }), DEFAULT_BROWSE_PREFERENCES);
  assert.deepEqual(loadBrowsePreferences({ getItem: () => '{broken' }), DEFAULT_BROWSE_PREFERENCES);
  assert.deepEqual(normalizeBrowsePreferences({ mode: 'unknown', pageSize: -4 }), DEFAULT_BROWSE_PREFERENCES);
  assert.deepEqual(normalizeBrowsePreferences({ mode: 'scroll', pageSize: true }), { mode: 'scroll', pageSize: 'auto' });
  assert.deepEqual(normalizeBrowsePreferences({ mode: 'fit', pageSize: '84' }), { mode: 'fit', pageSize: 84 });
  assert.equal(normalizeBrowsePreferences({ pageSize: 999999 }).pageSize, 1000);
  assert.deepEqual(saveBrowsePreferences({ mode: 'fit', pageSize: 21 }, { setItem() { throw Error('read only'); } }), { mode: 'fit', pageSize: 21 });
});

test('the first run uses automatic fit while fixed paging preserves the 60 item contract', () => {
  const defaults = resolveBrowseLayout();
  assert.equal(defaults.mode, 'fit');
  assert.equal(defaults.size, 60);
  assert.equal(defaults.cardHeight, null);
  assert.equal(pageAssets(Array.from({ length: 1000 }, (_, id) => id), 0, defaults.size).items.length, 60);
  assert.equal(resolveBrowseLayout({ mode: 'fixed', pageSize: 60 }).size, 60);
  assert.equal(resolveBrowseLayout({ mode: 'fixed', pageSize: 72 }, { columns: 7, availableHeight: 500 }).size, 72);
  assert.equal(resolveBrowseLayout({ mode: 'scroll', pageSize: 84 }, { columns: 7, availableHeight: 500 }).size, 84);
});

test('automatic quantities use whole rows and fit height is shared by actual rows', () => {
  const layout = resolveBrowseLayout({ mode: 'fit', pageSize: 'auto' }, { columns: 7, availableHeight: 520, cardMinHeight: 220, rowGap: 16, cardChromeHeight: 92 });
  assert.equal(layout.size, 14);
  assert.equal(layout.rows, 2);
  assert.equal(layout.cardHeight, 252);
  assert.equal(layout.previewHeight, 160);
  assert.equal(layout.size % layout.columns, 0);
  assert.ok(520 >= layout.cardHeight * layout.rows + layout.rowGap * (layout.rows - 1));
  const scroll = resolveBrowseLayout({ mode: 'scroll', pageSize: 'auto' }, { columns: 8, availableHeight: 720, cardMinHeight: 220, rowGap: 16 });
  assert.equal(scroll.size, 24);
  assert.equal(scroll.cardHeight, null);
  assert.equal(resolveBrowseLayout({ pageSize: 'auto' }, { columns: 7 }).size % 7, 0);
});

test('fit paging caps capacity without changing the remembered custom count or making empty cards', () => {
  const preferences = { mode: 'fit', pageSize: 60 };
  const layout = resolveBrowseLayout(preferences, { columns: 7, availableHeight: 520, cardMinHeight: 220 });
  assert.equal(layout.size, 14);
  assert.equal(preferences.pageSize, 60);
  const assets = Array.from({ length: 17 }, (_, id) => ({ id }));
  const result = pageAssets(assets, 1, layout.size);
  assert.equal(result.items.length, 3);
  assert.deepEqual(result.items.map(item => item.id), [14, 15, 16]);
  assert.equal(assets.length, 17);
  const uneven = resolveBrowseLayout({ mode: 'fit', pageSize: 10 }, { columns: 7, availableHeight: 520 });
  assert.equal(uneven.size, 10);
  assert.equal(uneven.rows, 2);
});

test('short viewports and invalid measurements never create overflowing fit rows', () => {
  for (const availableHeight of [0, 35, 219, 220, 451, 800.5]) {
    const layout = resolveBrowseLayout({ mode: 'fit', pageSize: 'auto' }, { columns: 8, availableHeight });
    assert.ok(layout.size > 0);
    assert.ok(layout.rows > 0);
    assert.ok(availableHeight >= layout.cardHeight * layout.rows + layout.rowGap * (layout.rows - 1));
    assert.ok(layout.previewHeight >= 0);
  }
  assert.equal(resolveBrowseLayout({ mode: 'fit', pageSize: 'auto' }, { columns: NaN, availableHeight: Infinity }).cardHeight, null);
});

test('applying browse geometry sets transient variables and clears them outside fit mode', () => {
  const values = new Map();
  const grid = { dataset: {}, style: { setProperty: (key, value) => values.set(key, value), removeProperty: key => values.delete(key) } };
  applyBrowseLayout(grid, resolveBrowseLayout({ mode: 'fit', pageSize: 'auto' }, { columns: 7, availableHeight: 520 }));
  assert.equal(grid.dataset.browseMode, 'fit');
  assert.equal(values.get('--browse-card-height'), '252px');
  assert.equal(values.get('--browse-preview-height'), '152px');
  applyBrowseLayout(grid, resolveBrowseLayout({ mode: 'scroll', pageSize: 60 }));
  assert.equal(grid.dataset.browseMode, 'scroll');
  assert.equal(values.size, 0);
});

