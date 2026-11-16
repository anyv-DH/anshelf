/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { previewDialog, renderInspector } from './render.js';

const asset = { id: 'imported-fla', name: '已导入的人物', kind: 'fla', assetType: 'ordinary', previewStatus: 'ready', previewUrl: 'anshelf://preview/imported-fla', previewOrigin: 'custom', categoryIds: [] };

test('FLA lightbox offers local preview replacement and explains two-day cache retention', () => {
  const html = previewDialog(asset);
  assert.match(html, /data-action="replace-preview" data-id="imported-fla"/);
  assert.match(html, /更换预览图/);
  assert.match(html, /旧预览缓存保留两天，到期后在软件运行时自动清理/);
});

test('details and replacement live inside the preview dialog while the standalone inspector stays closed', () => {
  const inspector = { dataset: {}, hidden: true, innerHTML: '', contains: () => false };
  const nodes = { '#inspector': inspector, '.app-shell': { classList: { remove() {} } } };
  const previous = globalThis.document;
  globalThis.document = { querySelector: selector => nodes[selector] };
  try {
    const state = { inspectorOpen: true, detail: asset.id, selected: new Set([asset.id]), snapshot: { assets: [asset], categories: [], bridge: {} } };
    renderInspector(state);
    assert.equal(inspector.hidden, true);
    assert.equal(inspector.innerHTML, '');
    const html = previewDialog(asset, state.snapshot);
    assert.match(html, /class="preview-details"/);
    assert.match(html, /自定义预览图/);
    assert.match(html, /data-action="replace-preview" data-id="imported-fla"/);
    assert.match(html, /data-field="name"/);
    assert.match(html, /data-field="tags"/);
    assert.match(html, /旧预览缓存保留两天，到期后在软件运行时自动清理/);
    state.snapshot.assets = [{ ...asset, previewStatus: 'error', previewUrl: null }];
    renderInspector(state);
    assert.equal(inspector.hidden, true);
    assert.match(previewDialog(state.snapshot.assets[0], state.snapshot), /data-action="replace-preview"/);
  } finally { globalThis.document = previous; }
});

test('audio uses its existing artwork and exposes no FLA preview replacement', () => {
  assert.doesNotMatch(previewDialog({ ...asset, kind: 'audio', assetType: 'audio' }), /replace-preview|旧预览/);
});

test('preview replacement can be withdrawn only during its 48-hour recovery window', () => {
  const html = previewDialog({ ...asset, previewUndoUntil: Date.now() + 48 * 60 * 60 * 1000 });
  assert.match(html, /data-action="restore-preview" data-id="imported-fla"/);
  assert.match(html, /撤回预览更换/);
  assert.match(html, /48 小时内可撤回/);
  assert.doesNotMatch(previewDialog({ ...asset, previewUndoUntil: Date.now() - 1 }), /data-action="restore-preview"/);
  assert.doesNotMatch(previewDialog(asset), /data-action="restore-preview"/);
});

test('FLA lightbox and inspector let an existing ready preview be regenerated', () => {
  assert.match(previewDialog(asset), /data-action="retry" data-id="imported-fla"/);
  assert.match(previewDialog(asset), /重新生成预览/);
  assert.doesNotMatch(previewDialog({ ...asset, kind: 'audio', assetType: 'audio' }), /data-action="retry"/);
});

test('a completed background regeneration refreshes its open lightbox while metadata-only changes preserve zoom', async () => {
  const source = await fs.readFile(new URL('./app.js', import.meta.url), 'utf8');
  const handler = source.slice(source.indexOf('function applySnapshot('), source.indexOf('async function refresh('));
  const displayed = [];
  const state = { snapshot: { assets: [asset], categories: [] }, selected: new Set([asset.id]), category: 'all', favoriteCategory: 'all' };
  const dialog = { open: true }, content = { dataset: { previewAsset: asset.id } };
  const context = { state, audio: { reconcile() {} }, $: selector => selector === '#dialog' ? dialog : content,
    sceneGroups: { sync() {} },
    renderAll() {}, renderStatus() {}, toast() {}, resumeStartupUpdate() {}, refreshPreviewDetails() {}, refreshPreviewMedia: value => displayed.push(value),
    document: { activeElement: null } };
  vm.runInNewContext(handler + '\nthis.applySnapshot = applySnapshot;', context);
  const regenerated = { ...asset, previewRevision: 'new-version', previewUrl: 'anshelf://preview/imported-fla?rev=new-version' };
  context.applySnapshot({ assets: [regenerated], categories: [] });
  assert.equal(displayed.length, 1);
  assert.equal(displayed[0].previewUrl, regenerated.previewUrl);
  context.applySnapshot({ assets: [{ ...regenerated, favorite: true }], categories: [] });
  assert.equal(displayed.length, 1, 'unrelated metadata refresh must retain the current lightbox and its zoom');
});
