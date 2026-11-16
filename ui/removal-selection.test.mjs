/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSelection, previewDialog } from './render.js';

function selectionMarkup(category, selected) {
  const previous = globalThis.document;
  const bar = { innerHTML: '', contains: () => false };
  globalThis.document = { activeElement: null, querySelector: selector => {
    assert.equal(selector, '#selection-bar'); return bar;
  } };
  try {
    renderSelection({ category, selected: new Set(selected), snapshot: {
      categories: [{ id: 'effects-root', name: '特效', systemKey: 'effect', scope: 'effect', parentId: null }],
      assets: [{ id: 'broken', name: '缺失特效', kind: 'fla', assetType: 'effect', categoryIds: [], previewStatus: 'failed', previewError: '素材路径对应的文件不存在' }],
    } });
    return bar.innerHTML;
  } finally { globalThis.document = previous; }
}

test('an uncategorized failed effect shown in the effect aggregate can explicitly leave the library', () => {
  const markup = selectionMarkup('effects-root', ['broken']);
  assert.match(markup, /<button[^>]*data-action="remove-library"[^>]*>从素材库移除<\/button>/);
  assert.doesNotMatch(markup.match(/<button[^>]*data-action="remove-library"[^>]*>/)?.[0] || '', /disabled/);
});

test('missing assets and empty selections never gain an enabled removal action', () => {
  assert.doesNotMatch(selectionMarkup('effects-root', ['missing']), /data-action="remove-library"/);
  assert.equal(selectionMarkup('effects-root', []), '');
});

test('failed preview explains the actual cause without promising a missing file can still be sent', () => {
  const markup = previewDialog({ id: 'broken', name: '缺失特效', kind: 'fla', assetType: 'effect', previewStatus: 'failed', previewError: '素材路径对应的文件不存在' });
  assert.doesNotMatch(markup, /文件仍可发送到 AN/);
  assert.match(markup, /素材路径对应的文件不存在/);
});
