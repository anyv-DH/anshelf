/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { renderGrid, renderSelection } from './render.js';

function workspace() {
  const previous = globalThis.document;
  const nodes = Object.fromEntries(['#asset-grid', '#asset-count', '#asset-pagination', '#empty-state', '#footer-summary'].map(selector => [selector, { dataset: {}, hidden: false, innerHTML: '', textContent: '', style: { setProperty() {}, removeProperty() {} } }]));
  globalThis.document = { activeElement: null, querySelector: selector => nodes[selector] };
  const assets = Array.from({ length: 65 }, (_, index) => ({ id: String(index), name: '素材 ' + index, kind: 'image', assetType: 'image', tags: [], createdAt: 65 - index }));
  const state = { snapshot: { assets, categories: [] }, category: 'all', query: '', sort: 'newest', selected: new Set(), page: 0, browsePreferences: { mode: 'scroll', pageSize: 24 } };
  return { nodes, state, dispose() { globalThis.document = previous; } };
}

test('scroll browsing exposes the same bounded page controls as fixed browsing', () => {
  const fixture = workspace();
  try {
    renderGrid(fixture.state);
    assert.equal(fixture.nodes['#asset-pagination'].hidden, false);
    assert.match(fixture.nodes['#asset-pagination'].innerHTML, /第 1 \/ 3 页/);
    assert.match(fixture.nodes['#asset-pagination'].innerHTML, /每页 24 个/);
    assert.equal(fixture.state.visible.length, 24);
  } finally { fixture.dispose(); }
});

test('scroll browsing replaces each page instead of retaining all previous pages', () => {
  const fixture = workspace();
  try {
    renderGrid(fixture.state);
    const first = [...fixture.state.visible];
    fixture.state.page = 1;
    renderGrid(fixture.state);
    assert.deepEqual(fixture.state.visible, Array.from({ length: 24 }, (_, index) => String(index + 24)));
    assert.ok(!fixture.state.visible.some(id => first.includes(id)));
    fixture.state.page = 2;
    renderGrid(fixture.state);
    assert.deepEqual(fixture.state.visible, Array.from({ length: 17 }, (_, index) => String(index + 48)));
    assert.equal((fixture.nodes['#asset-grid'].innerHTML.match(/<article /g) || []).length, 17);
    assert.match(fixture.nodes['#asset-pagination'].innerHTML, /第 3 \/ 3 页/);
  } finally { fixture.dispose(); }
});

test('scroll browsing resets filtered pages and reveals an asset only within its destination page', () => {
  const fixture = workspace();
  try {
    renderGrid(fixture.state);
    fixture.state.revealAssetId = '50';
    renderGrid(fixture.state);
    assert.equal(fixture.state.page, 2);
    assert.equal(fixture.state.visible.length, 17);
    assert.ok(fixture.state.visible.includes('50'));
    fixture.state.query = '素材 64';
    renderGrid(fixture.state);
    assert.deepEqual(fixture.state.visible, ['64']);
    assert.equal(fixture.state.page, 0);
    assert.equal(fixture.nodes['#asset-pagination'].hidden, true);
  } finally { fixture.dispose(); }
});

test('clearing selection for the next fit page measures the hidden bar before rendering and keeps that page', async () => {
  const fixture = workspace();
  try {
    const selectionBar = { hidden: false, contains: () => false };
    fixture.nodes['#selection-bar'] = selectionBar;
    Object.assign(fixture.state, { browsePreferences: { mode: 'fit', pageSize: 'auto' }, browseViewport: { columns: 7, availableHeight: 420 }, selected: new Set(['0']) });
    renderGrid(fixture.state);
    assert.equal(fixture.state.browseLayout.size, 7);
    fixture.state.page = 1;
    fixture.state.selected.clear();
    const measuredBarVisibility = [];
    const measureBrowseViewport = () => {
      measuredBarVisibility.push(selectionBar.hidden);
      fixture.state.browseViewport = { columns: 7, availableHeight: selectionBar.hidden ? 520 : 420 };
    };
    const source = await fs.readFile(new URL('./app.js', import.meta.url), 'utf8');
    const controller = source.slice(source.indexOf('function renderAll('), source.indexOf('function applySnapshot('));
    const context = { state: fixture.state, document: globalThis.document, renderGrid, renderSelection, measureBrowseViewport, renderStatus() {}, renderSidebar() {}, renderSubcategories() {}, updateGridDensity() {}, renderInspector() {}, updateAudioUI() {} };
    vm.runInNewContext(controller + '\nthis.renderAll = renderAll;', context);
    context.renderAll();
    assert.deepEqual(measuredBarVisibility, [true], 'page capacity must use the current selection-bar visibility');
    measureBrowseViewport(); renderGrid(fixture.state);
    assert.equal(fixture.state.page, 1, 'the follow-up resize measurement must keep the requested next page');
    assert.deepEqual(fixture.state.visible, Array.from({ length: 14 }, (_, index) => String(index + 14)));
  } finally { fixture.dispose(); }
});
