/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fitSize, zoomAt, panBy, resetView } from './preview-viewer.mjs';
import { createAudioController, formatTime } from './audio-controller.mjs';
import { assetMode, assetFilename, categoryTree, visibleAssets, categoryCount } from './model.js';

test('preview zoom preserves the image point beneath the pointer and clamps both limits', () => {
  const view = { scale: 1, x: 0, y: 0 };
  const next = zoomAt(view, 2, { x: 80, y: -30 });
  assert.deepEqual(next, { scale: 2, x: -80, y: 30 });
  assert.equal((80 - next.x) / next.scale, 80);
  assert.equal((-30 - next.y) / next.scale, -30);
  assert.equal(zoomAt(next, 100, { x: 0, y: 0 }).scale, 8);
  assert.equal(zoomAt(next, 0, { x: 0, y: 0 }).scale, .25);
});

test('fit preserves aspect ratio and panning always leaves image visible', () => {
  assert.deepEqual(fitSize(1600, 800, 400, 300), { width: 400, height: 200 });
  assert.deepEqual(fitSize(100, 300, 400, 300), { width: 100, height: 300 });
  const next = panBy({ scale: 2, x: 0, y: 0 }, 100000, -100000, { width: 400, height: 200 }, { width: 400, height: 300 });
  assert.ok(next.x < 600 && next.x > 0);
  assert.ok(next.y > -350 && next.y < 0);
  assert.deepEqual(resetView(), { scale: 1, x: 0, y: 0 });
});

class TestAudio extends EventTarget {
  paused = true; currentTime = 0; duration = 120; src = ''; error = null;
  async play() { this.paused = false; this.dispatchEvent(new Event('play')); }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
  load() { this.currentTime = 0; }
  removeAttribute(name) { if (name === 'src') this.src = ''; }
}

test('one audio player switches sources, toggles pause, seeks and survives snapshot updates', async () => {
  const player = new TestAudio(), states = [];
  const controller = createAudioController({ player, onChange: state => states.push(state) });
  const first = { id: 'one', name: '音效', mediaUrl: 'anshelf://media/one', kind: 'audio' };
  await controller.toggle(first);
  assert.equal(controller.state().playing, true);
  controller.seek(30);
  controller.reconcile([{ ...first, favorite: true }]);
  assert.equal(player.currentTime, 30);
  assert.equal(controller.state().playing, true);
  await controller.toggle(first);
  assert.equal(controller.state().playing, false);
  await controller.toggle({ ...first, id: 'two', mediaUrl: 'anshelf://media/two' });
  assert.equal(controller.state().id, 'two');
  assert.equal(player.currentTime, 0);
  controller.seek(1000);
  assert.equal(player.currentTime, 120);
  controller.reconcile([]);
  assert.equal(controller.state().id, null);
  assert.equal(player.paused, true);
  assert.ok(states.length > 0);
  controller.dispose();
});

test('audio decode failures remain visible and later switching recovers', async () => {
  const player = new TestAudio();
  const controller = createAudioController({ player });
  await controller.toggle({ id: 'bad', mediaUrl: 'anshelf://media/bad' });
  player.error = { code: 4 };
  player.dispatchEvent(new Event('error'));
  assert.match(controller.state().error, /解码|格式/);
  player.error = null;
  await controller.toggle({ id: 'good', mediaUrl: 'anshelf://media/good' });
  assert.equal(controller.state().error, '');
  assert.equal(controller.state().playing, true);
  controller.dispose();
});

test('audio time labels are stable for unknown durations', () => {
  assert.equal(formatTime(NaN), '—');
  assert.equal(formatTime(Infinity), '—');
  assert.equal(formatTime(61.8), '1:01');
});

test('ordinary legacy files, effects and audio have separate navigation without changing classification', () => {
  const assets = [{ id: 'old', name: '武器' }, { id: 'fx', name: '火焰', kind: 'fla', assetType: 'effect' }, { id: 'sound', name: '爆炸', kind: 'audio', extension: '.wav' }];
  assert.equal(assetMode(assets[0]), 'ordinary');
  assert.equal(assetFilename(assets[0]), '武器.fla');
  assert.equal(assetFilename(assets[2]), '爆炸.wav');
  assert.deepEqual(visibleAssets(assets, 'ordinary', '', 'newest').map(item => item.id), ['old']);
  assert.deepEqual(visibleAssets(assets, 'effects', '', 'newest').map(item => item.id), ['fx']);
  assert.equal(categoryCount(assets, 'audio'), 1);
});

test('type scope remains active when browsing a category or favorites', () => {
  const assets = [{ id: 'weapon', name: '武器', categoryId: 'people', favorite: true }, { id: 'sound', name: '声音', kind: 'audio', categoryId: 'people', favorite: true }];
  assert.deepEqual(visibleAssets(assets, 'people', '', 'newest', [], 'audio').map(item => item.id), ['sound']);
  assert.deepEqual(visibleAssets(assets, 'favorites', '', 'newest', [], 'audio').map(item => item.id), ['sound']);
});

test('category pin ordering stays within parents, collapse hides descendants, and filter reveals matching path', () => {
  const categories = [{ id: 'people', name: '人物' }, { id: 'scene', name: '场景', pinned: true }, { id: 'male', name: '男', parentId: 'people' }, { id: 'female', name: '女', parentId: 'people', pinned: true }];
  assert.deepEqual(categoryTree(categories).map(item => item.id), ['scene', 'people', 'female', 'male']);
  assert.deepEqual(categoryTree(categories, '', new Set(['people'])).map(item => item.id), ['scene', 'people']);
  const filtered = categoryTree(categories, '女', new Set(['people']));
  assert.deepEqual(filtered.map(item => item.id), ['people', 'female']);
  assert.equal(filtered[1].depth, 1);
  assert.equal(categoryTree([{ id: 'a', name: 'a', parentId: 'b' }, { id: 'b', name: 'b', parentId: 'a' }]).length, 0);
});
