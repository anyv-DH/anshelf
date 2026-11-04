/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHost } = require('../desktop/host.cjs');
const { Library } = require('../core/library.cjs');

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-category-managed-repro-'));
  const source = path.join(base, '共享人物.fla');
  await fs.writeFile(source, 'shared-character-original');
  const opened = [];
  const host = await createHost({ root: path.join(base, 'library'), render: async () => ({ previewPath: null }), openInAnimate: async file => { opened.push(file); } });
  t.after(async () => { await host.queue.idle(); await fs.rm(base, { recursive: true, force: true }); });
  const asset = (await host.api.importPaths([source])).assets[0];
  await host.queue.idle();
  return { base, source, host, asset, opened };
}

test('current category-only undo preserves the moved managed path after adding to another category', async t => {
  const { host, asset } = await fixture(t);
  const first = await host.api.createCategory('第一部');
  const second = await host.api.createCategory('第二部');
  await host.api.assignCategory([asset.id], first.id);
  await host.api.addToCategory([asset.id], second.id);
  await host.api.openInAnimate(asset.id);
  const moved = host.library.getAsset(asset.id).managedPath;
  await host.api.undo();
  assert.equal(host.library.getAsset(asset.id).managedPath, moved);
  assert.deepEqual(host.library.getAsset(asset.id).categoryIds, [first.id]);
  await host.api.openInAnimate(asset.id);
});

test('legacy full previous records must not revert a file path moved after a category edit', async t => {
  const { host, asset } = await fixture(t);
  const second = await host.api.createCategory('第二部');
  const before = host.library.getAsset(asset.id);
  await host.api.addToCategory([asset.id], second.id);
  const stateFile = path.join(host.root, 'library.json');
  const legacy = JSON.parse(await fs.readFile(stateFile, 'utf8'));
  legacy.history.at(-1)[0].previous = before;
  await fs.writeFile(stateFile, JSON.stringify(legacy));
  host.library = await Library.open(host.root);
  await host.library.reconcileManagedFile(asset.id, '共享人物.fla');
  const moved = host.library.getAsset(asset.id).managedPath;
  await host.library.undo();
  assert.equal(host.library.getAsset(asset.id).managedPath, moved, 'undoing a legacy category edit must keep the current file location');
  assert.equal(await fs.readFile(host.library.assetPath(asset.id), 'utf8'), 'shared-character-original');
});

test('remove, reimport and undo must not restore a second record sharing a movable managed file', async t => {
  const { host, source, asset } = await fixture(t);
  await host.api.removeAssets([asset.id]);
  const fresh = (await host.api.importPaths([source])).assets[0];
  await host.queue.idle();
  assert.notEqual(fresh.id, asset.id);
  await host.api.undo();
  // Reopening every restored record reproduces the original missing-file
  // failure; merging into the reimported record is also a valid safe outcome.
  for (const item of host.library.snapshot().assets) await host.api.openInAnimate(item.id);
  const assets = host.library.snapshot().assets;
  const physical = await Promise.all(assets.map(item => fs.realpath(path.join(host.root, item.managedPath))));
  assert.equal(new Set(physical).size, assets.length, 'independent records may not share a file that one record can rename');
});

test('legacy full undo restores user metadata while preserving the saved content hash and current preview', async t => {
  const { host, asset } = await fixture(t);
  const previous = host.library.getAsset(asset.id);
  await host.api.updateAsset(asset.id, { name: '临时名称', tags: ['临时标签'], favorite: true });
  const metadata = path.join(host.root, 'library.json');
  const legacy = JSON.parse(await fs.readFile(metadata, 'utf8'));
  legacy.history.at(-1)[0].previous = previous;
  await fs.writeFile(metadata, JSON.stringify(legacy));
  const library = await Library.open(host.root);
  await fs.writeFile(library.assetPath(asset.id), 'newly-saved-content');
  await library.reconcileManagedFile(asset.id, '临时名称.fla');
  await library.setPreview(asset.id, { previewPath: 'previews/latest.png', previewStatus: 'ready', previewOrigin: 'rendered', width: 800, frames: 12 });
  const latest = library.getAsset(asset.id);
  await library.undo();
  const restored = library.getAsset(asset.id);
  assert.equal(restored.name, previous.name);
  assert.deepEqual(restored.tags, previous.tags);
  assert.equal(restored.favorite, previous.favorite);
  for (const key of ['managedPath', 'hash', 'previewPath', 'previewStatus', 'previewOrigin', 'previewRevision', 'width', 'frames']) assert.deepEqual(restored[key], latest[key], key);
  assert.equal(await fs.readFile(library.assetPath(asset.id), 'utf8'), 'newly-saved-content');
});

test('restoring a deleted record merges metadata into the reimported record without replacing current storage', async t => {
  const { host, source, asset } = await fixture(t);
  const oldCategory = await host.api.createCategory('旧剧集');
  const newCategory = await host.api.createCategory('新剧集');
  await host.api.assignCategory([asset.id], oldCategory.id);
  await host.api.updateAsset(asset.id, { favorite: true, tags: ['旧标签'] });
  await host.library.change(state => { state.assets[0].likedAt = '2026-01-01T00:00:00.000Z'; }, false);
  await host.api.removeAssets([asset.id]);
  const fresh = (await host.api.importPaths([source])).assets[0];
  await host.queue.idle();
  // These later non-undoable writes stand for independent metadata retained
  // while a deleted record waits in the undo history.
  await host.library.change(state => {
    const current = state.assets.find(item => item.id === fresh.id);
    current.categoryId = newCategory.id; current.categoryIds = [newCategory.id];
    current.tags = ['新标签']; current.likedAt = '2026-01-02T00:00:00.000Z';
    current.sourcePaths.push(path.join(path.dirname(source), 'another-source.fla'));
  }, false);
  await host.api.openInAnimate(fresh.id);
  await host.library.setPreview(fresh.id, { previewPath: 'previews/newest.png', previewStatus: 'ready' });
  const beforeUndo = host.library.getAsset(fresh.id);
  await host.api.undo();
  const restored = host.library.snapshot().assets;
  assert.equal(restored.length, 1);
  assert.equal(restored[0].id, fresh.id);
  assert.equal(restored[0].managedPath, beforeUndo.managedPath);
  assert.equal(restored[0].previewPath, beforeUndo.previewPath);
  assert.deepEqual(new Set(restored[0].categoryIds), new Set([oldCategory.id, newCategory.id]));
  assert.deepEqual(new Set(restored[0].tags), new Set(['旧标签', '新标签']));
  assert.equal(restored[0].favorite, true);
  assert.equal(restored[0].likedAt, '2026-01-02T00:00:00.000Z');
  assert.deepEqual(restored[0].sourcePaths, beforeUndo.sourcePaths);
  await host.api.openInAnimate(fresh.id);
});

test('an earlier metadata undo follows a safely merged asset ID after reopening the library', async t => {
  const { host, source, asset } = await fixture(t);
  await host.api.updateAsset(asset.id, { name: '被删除前的临时名称' });
  await host.api.removeAssets([asset.id]);
  const fresh = (await host.api.importPaths([source])).assets[0];
  await host.queue.idle();
  await host.library.change(state => { state.assets.find(item => item.id === fresh.id).name = '当前条目的新名称'; }, false);
  await host.api.undo();
  const library = await Library.open(host.root);
  assert.equal(library.snapshot().assets.length, 1);
  assert.equal(library.getAsset(fresh.id).name, '当前条目的新名称');
  await library.undo();
  assert.equal(library.getAsset(fresh.id).name, asset.name);
  assert.equal(await fs.readFile(library.assetPath(fresh.id), 'utf8'), 'shared-character-original');
  assert.equal(library.snapshot().assets.length, 1);
});

test('deleted restore merges a shared path even after the current saved bytes have a different hash', async t => {
  const { host, source, asset } = await fixture(t);
  await host.api.removeAssets([asset.id]);
  const fresh = (await host.api.importPaths([source])).assets[0];
  await host.queue.idle();
  await fs.writeFile(host.library.assetPath(fresh.id), 'latest-saved-content');
  await host.library.reconcileManagedFile(fresh.id);
  const saved = host.library.getAsset(fresh.id);
  assert.notEqual(saved.hash, asset.hash);
  assert.equal(saved.managedPath, asset.managedPath);
  await host.api.undo();
  assert.equal(host.library.snapshot().assets.length, 1);
  assert.equal(host.library.getAsset(fresh.id).hash, saved.hash);
  assert.equal(await fs.readFile(host.library.assetPath(fresh.id), 'utf8'), 'latest-saved-content');
});

test('identical bytes in audio and FLA records are not merged by deletion undo', async t => {
  const { host, source, asset } = await fixture(t);
  await host.api.removeAssets([asset.id]);
  const audioSource = path.join(path.dirname(source), '同内容音频.mp3');
  await fs.copyFile(source, audioSource);
  const audio = (await host.api.importPaths([audioSource], { mode: 'audio' })).assets[0];
  await host.api.undo();
  assert.equal(host.library.snapshot().assets.length, 2);
  assert.equal(host.library.getAsset(audio.id).kind, 'audio');
  assert.equal(host.library.getAsset(asset.id).kind, 'fla');
  assert.notEqual(host.library.assetPath(audio.id), host.library.assetPath(asset.id));
});

test('an older creation undo cannot delete an independently reimported asset after merging', async t => {
  const { host, source, asset } = await fixture(t);
  await host.library.change(state => {
    state.history.push([{ collection: 'assets', id: asset.id, before: null, after: state.assets[0], index: 0 }]);
  }, false);
  await host.api.removeAssets([asset.id]);
  const fresh = (await host.api.importPaths([source])).assets[0];
  await host.queue.idle();
  await host.api.undo();
  await host.api.undo();
  assert.equal(host.library.snapshot().assets.length, 1);
  assert.equal(host.library.getAsset(fresh.id).id, fresh.id);
  assert.equal(await fs.readFile(host.library.assetPath(fresh.id), 'utf8'), 'shared-character-original');
});
