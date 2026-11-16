/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { previewDialog } from './render.js';
import { renderAssetDetails } from './asset-details.mjs';

const image = { id: 'picture', kind: 'image', assetType: 'ordinary', name: '背景', originalName: '背景.png', extension: '.png', previewUrl: 'anshelf://preview/picture', previewStatus: 'ready', width: 800, height: 600, tags: [], categoryIds: [] };
test('image previews expose image import and file drag without FLA edit or regeneration actions', () => {
  const html = previewDialog(image, {});
  assert.match(html, /data-action="duplicate-file"/);
  assert.match(html, /data-action="reveal-file"/);
  assert.match(html, /data-action="send"/);
  assert.match(html, /导入 AN/);
  assert.match(html, /data-drag-id="picture" draggable="true"/);
  assert.doesNotMatch(html, /data-action="(?:open-animate|retry|replace-preview|restore-preview)"/);
  assert.doesNotMatch(html, /data-stage-drag-id/);
});
test('image details describe pixels and local image content instead of an Animate timeline', () => {
  const html = renderAssetDetails(image, { bridge: { connected: true } });
  assert.match(html, /800 × 600/);
  assert.match(html, /本地图片/);
  assert.doesNotMatch(html, /时间轴|帧率|AN 已连接|自定义预览图/);
});
