/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Library } = require('../core/library.cjs');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHlcAAAAASUVORK5CYII=', 'base64');
const TWO_DAYS = 48 * 60 * 60 * 1000;

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-custom-preview-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'library');
  const source = path.join(base, '人物.fla');
  const picture = path.join(base, '新封面.png');
  await fs.writeFile(source, 'original-fla'); await fs.writeFile(picture, PNG);
  const library = await Library.open(root);
  const asset = (await library.importPaths([source])).assets[0];
  const oldPath = 'previews/old.png';
  await fs.writeFile(path.join(root, oldPath), PNG);
  await library.setPreview(asset.id, { previewPath: oldPath, previewStatus: 'ready', previewOrigin: 'rendered' });
  return { base, root, source, picture, library, asset, oldPath };
}

test('replacing a preview preserves asset metadata and original files, persists and keeps the old cache for exactly 48 hours', async t => {
  const f = await fixture(t);
  const category = await f.library.createCategory('人物分类');
  await f.library.assignCategory([f.asset.id], category.id);
  await f.library.updateAsset(f.asset.id, { favorite: true, tags: ['主角'] });
  const before = f.library.getAsset(f.asset.id), bytes = await fs.readFile(path.join(f.root, 'library.json'));
  const start = Date.now();
  const replaced = await f.library.replacePreview(f.asset.id, f.picture);
  assert.equal(replaced.previewOrigin, 'custom'); assert.equal(replaced.previewStatus, 'ready');
  for (const key of ['id', 'hash', 'managedPath', 'categoryIds', 'favorite', 'tags', 'assetType', 'sourcePaths']) assert.deepEqual(replaced[key], before[key]);
  assert.notEqual(replaced.previewPath, before.previewPath); assert.notEqual(replaced.previewRevision, before.previewRevision);
  assert.deepEqual(await fs.readFile(f.library.previewPath(f.asset.id)), PNG);
  assert.equal(await fs.readFile(f.source, 'utf8'), 'original-fla'); assert.deepEqual(await fs.readFile(f.picture), PNG);
  const reopened = await Library.open(f.root), deadline = reopened.nextPreviewCleanupAt();
  assert.ok(deadline >= start + TWO_DAYS && deadline <= Date.now() + TWO_DAYS);
  await reopened.cleanupExpiredPreviews(deadline - 1); await fs.access(path.join(f.root, f.oldPath));
  const cleaned = await reopened.cleanupExpiredPreviews(deadline);
  assert.deepEqual(cleaned.deleted, [f.oldPath]);
  await assert.rejects(fs.access(path.join(f.root, f.oldPath)), { code: 'ENOENT' });
  assert.deepEqual(await fs.readFile(reopened.previewPath(f.asset.id)), PNG);
  assert.deepEqual(reopened.state.history, JSON.parse(bytes).history);
  assert.equal((await Library.open(f.root)).nextPreviewCleanupAt(), null);
});

test('repeated replacements retain each old version and retire animated preview and poster together', async t => {
  const f = await fixture(t);
  const gif = 'previews/old.gif'; await fs.writeFile(path.join(f.root, gif), 'gif-cache');
  await f.library.setPreview(f.asset.id, { previewPath: gif, previewPosterPath: f.oldPath, previewStatus: 'ready', previewAnimated: true, previewFormat: 'gif' });
  const first = await f.library.replacePreview(f.asset.id, f.picture);
  const second = await f.library.replacePreview(f.asset.id, f.picture);
  assert.equal(second.previewAnimated, false); assert.equal(second.previewPosterPath, null);
  assert.notEqual(second.previewPath, first.previewPath);
  const cleaned = await f.library.cleanupExpiredPreviews(Date.now() + TWO_DAYS + 1000);
  assert.deepEqual(new Set(cleaned.deleted), new Set([f.oldPath, gif, first.previewPath]));
  await fs.access(f.library.previewPath(f.asset.id));
});

test('replacement rejects invalid image and audio and rolls back copied cache on decoding or index failure', async t => {
  const f = await fixture(t), index = await fs.readFile(path.join(f.root, 'library.json'));
  const cache = (await fs.readdir(path.join(f.root, 'previews'))).sort();
  await assert.rejects(f.library.replacePreview(f.asset.id, f.picture, { validateImage: async () => false }), /图片|预览/);
  const invalid = path.join(f.base, 'bad.png'); await fs.writeFile(invalid, 'not-an-image');
  await assert.rejects(f.library.replacePreview(f.asset.id, invalid), /图片|预览/);
  await assert.rejects(f.library.replacePreview('missing', f.picture), /素材/);
  const audioFile = path.join(f.base, 'sound.wav'); await fs.writeFile(audioFile, 'wave');
  const audio = (await f.library.importPaths([audioFile], { mode: 'audio' })).assets[0];
  await assert.rejects(f.library.replacePreview(audio.id, f.picture), /音频/);
  // Failure at the atomic index replacement must leave the active image intact.
  const realRename = fs.rename;
  fs.rename = async (from, to) => { if (to === path.join(f.root, 'library.json')) throw new Error('index write failed'); return realRename(from, to); };
  try { await assert.rejects(f.library.replacePreview(f.asset.id, f.picture), /index write failed/); }
  finally { fs.rename = realRename; }
  assert.equal(f.library.getAsset(f.asset.id).previewPath, f.oldPath);
  assert.deepEqual((await fs.readdir(path.join(f.root, 'previews'))).sort(), cache);
  assert.deepEqual(JSON.parse(index).assets[0], JSON.parse(await fs.readFile(path.join(f.root, 'library.json'))).assets[0]);
});

test('cleanup protects shared previews and caches needed to undo removal', async t => {
  const f = await fixture(t), anotherFile = path.join(f.base, 'second.fla'); await fs.writeFile(anotherFile, 'second');
  const another = (await f.library.importPaths([anotherFile])).assets[0];
  await f.library.setPreview(another.id, { previewPath: f.oldPath, previewStatus: 'ready' });
  await f.library.replacePreview(f.asset.id, f.picture);
  await f.library.cleanupExpiredPreviews(Date.now() + TWO_DAYS + 1000);
  await fs.access(path.join(f.root, f.oldPath));
  await f.library.removeAssets([another.id]);
  await f.library.cleanupExpiredPreviews(Date.now() + TWO_DAYS + 1000);
  await f.library.undo(); await fs.access(f.library.previewPath(another.id));
});

test('retired cache cleanup rejects traversal and linked paths without touching originals', async t => {
  const f = await fixture(t), external = path.join(f.base, 'external'); await fs.mkdir(external);
  await fs.writeFile(path.join(external, 'keep.png'), PNG);
  const junction = path.join(f.root, 'previews', 'linked');
  await fs.symlink(external, junction, process.platform === 'win32' ? 'junction' : 'dir');
  const indexFile = path.join(f.root, 'library.json');
  const index = JSON.parse(await fs.readFile(indexFile));
  index.retiredPreviews = [{ path: '../新封面.png', deleteAfter: 1 }];
  await fs.writeFile(indexFile, JSON.stringify(index));
  await assert.rejects(Library.open(f.root), /预览|路径/);
  index.retiredPreviews = [{ path: 'previews/linked/keep.png', deleteAfter: 1 }];
  await fs.writeFile(indexFile, JSON.stringify(index));
  const reopened = await Library.open(f.root);
  const result = await reopened.cleanupExpiredPreviews(Date.now());
  assert.equal(result.failed.length, 1);
  assert.deepEqual(await fs.readFile(path.join(external, 'keep.png')), PNG);
  assert.deepEqual(await fs.readFile(f.picture), PNG);
});

test('preview changes can be restored for 48 hours, including after restart, without reverting other asset metadata', async t => {
  const f = await fixture(t);
  const original = f.library.getAsset(f.asset.id);
  const first = await f.library.replacePreview(f.asset.id, f.picture);
  await f.library.replacePreview(f.asset.id, f.picture);
  const reopened = await Library.open(f.root);
  assert.ok(reopened.getAsset(f.asset.id).previewUndoUntil > Date.now());
  const category = await reopened.createCategory('更换后整理');
  await reopened.assignCategory([f.asset.id], category.id);
  const restoredFirst = await reopened.restorePreview(f.asset.id);
  assert.equal(restoredFirst.previewPath, first.previewPath);
  assert.deepEqual(restoredFirst.categoryIds, [category.id]);
  const restoredOriginal = await reopened.restorePreview(f.asset.id);
  assert.equal(restoredOriginal.previewPath, original.previewPath);
  assert.equal(restoredOriginal.previewOrigin, original.previewOrigin);
  assert.deepEqual(await fs.readFile(reopened.previewPath(f.asset.id)), PNG);
  assert.equal(reopened.getAsset(f.asset.id).previewUndoUntil, null);
  await assert.rejects(reopened.restorePreview(f.asset.id), /撤回/);
});

test('expired preview history cannot be restored and ordinary metadata undo keeps the current preview', async t => {
  const f = await fixture(t);
  await f.library.updateAsset(f.asset.id, { name: '新名称' });
  const replacement = await f.library.replacePreview(f.asset.id, f.picture);
  await f.library.undo();
  assert.equal(f.library.getAsset(f.asset.id).name, f.asset.name);
  assert.equal(f.library.getAsset(f.asset.id).previewPath, replacement.previewPath);
  await f.library.cleanupExpiredPreviews(Date.now() + TWO_DAYS + 1000);
  assert.equal(f.library.getAsset(f.asset.id).previewUndoUntil, null);
  await assert.rejects(f.library.restorePreview(f.asset.id), /撤回/);
});

test('cleanup preserves the old image when expiring its undo history cannot be committed', async t => {
  const f = await fixture(t);
  await f.library.replacePreview(f.asset.id, f.picture);
  const indexPath = path.join(f.root, 'library.json');
  const before = await fs.readFile(indexPath);
  const realRename = fs.rename;
  fs.rename = async (from, to) => { if (to === indexPath) throw new Error('index write failed'); return realRename(from, to); };
  try { await assert.rejects(f.library.cleanupExpiredPreviews(Date.now() + TWO_DAYS + 1000), /index write failed/); }
  finally { fs.rename = realRename; }
  assert.deepEqual(await fs.readFile(indexPath), before);
  assert.deepEqual(await fs.readFile(path.join(f.root, f.oldPath)), PNG);
  const reopened = await Library.open(f.root);
  await reopened.restorePreview(f.asset.id);
  assert.deepEqual(await fs.readFile(reopened.previewPath(f.asset.id)), PNG);
});

test('preview undo rejects stored fields that could overwrite asset identity or metadata', async t => {
  const f = await fixture(t);
  await f.library.replacePreview(f.asset.id, f.picture);
  const indexPath = path.join(f.root, 'library.json');
  const index = JSON.parse(await fs.readFile(indexPath));
  index.previewHistory.at(-1).preview.managedPath = 'assets/replaced.fla';
  await fs.writeFile(indexPath, JSON.stringify(index));
  await assert.rejects(Library.open(f.root), /预览撤回/);
});

test('regenerated previews can be restored while failed regeneration retains the previous usable image', async t => {
  const f = await fixture(t);
  await f.library.setPreview(f.asset.id, { previewStatus: 'pending', previewError: null });
  await f.library.setPreview(f.asset.id, { previewStatus: 'failed', previewError: 'render failed' });
  assert.equal(f.library.getAsset(f.asset.id).previewPath, f.oldPath);
  assert.equal(f.library.getAsset(f.asset.id).previewUndoUntil, null);
  assert.deepEqual(await fs.readFile(f.library.previewPath(f.asset.id)), PNG);
  const regenerated = 'previews/new-render.png';
  await fs.writeFile(path.join(f.root, regenerated), PNG);
  await f.library.setPreview(f.asset.id, { previewStatus: 'pending', previewError: null });
  await f.library.setPreview(f.asset.id, { previewPath: regenerated, previewStatus: 'ready', previewOrigin: 'rendered' });
  assert.ok(f.library.getAsset(f.asset.id).previewUndoUntil > Date.now());
  await (await Library.open(f.root)).restorePreview(f.asset.id);
  const restored = (await Library.open(f.root)).getAsset(f.asset.id);
  assert.equal(restored.previewPath, f.oldPath);
  assert.equal(restored.previewStatus, 'ready');
  assert.equal(restored.previewError, null);
});

test('failed GIF replacement removes a half-created poster and keeps the active image', async t => {
  const f = await fixture(t), gif = path.join(f.base, 'animated.gif');
  await fs.writeFile(gif, Buffer.from('47494638396101000100800000000000ffffff2c00000000010001000002024401003b', 'hex'));
  const before = await fs.readFile(path.join(f.root, 'library.json'));
  const files = await fs.readdir(path.join(f.root, 'previews'));
  await assert.rejects(f.library.replacePreview(f.asset.id, gif, { createPoster: async (_source, destination) => {
    await fs.writeFile(destination, 'partial poster');
    throw new Error('decode failed');
  } }), /decode failed/);
  assert.deepEqual(await fs.readFile(path.join(f.root, 'library.json')), before);
  assert.deepEqual(await fs.readdir(path.join(f.root, 'previews')), files);
});

test('preview undo is available until the last millisecond before its 48-hour deadline', async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const beforeExpiry = await fixture(t), atExpiry = await fixture(t);
  await beforeExpiry.library.replacePreview(beforeExpiry.asset.id, beforeExpiry.picture);
  await atExpiry.library.replacePreview(atExpiry.asset.id, atExpiry.picture);
  const deadline = atExpiry.library.getAsset(atExpiry.asset.id).previewUndoUntil;
  now = deadline - 1;
  assert.equal((await beforeExpiry.library.restorePreview(beforeExpiry.asset.id)).previewPath, beforeExpiry.oldPath);
  now = deadline;
  assert.equal(atExpiry.library.getAsset(atExpiry.asset.id).previewUndoUntil, null);
  await assert.rejects(atExpiry.library.restorePreview(atExpiry.asset.id), /48 小时/);
  await atExpiry.library.cleanupExpiredPreviews(now);
  await assert.rejects(fs.access(path.join(atExpiry.root, atExpiry.oldPath)), { code: 'ENOENT' });
});

test('an undo index failure keeps the current preview and allows retry after reopening', async t => {
  const f = await fixture(t);
  const current = await f.library.replacePreview(f.asset.id, f.picture);
  const indexPath = path.join(f.root, 'library.json'), before = await fs.readFile(indexPath);
  const realRename = fs.rename;
  fs.rename = async (from, to) => { if (to === indexPath) throw new Error('undo index failed'); return realRename(from, to); };
  try { await assert.rejects(f.library.restorePreview(f.asset.id), /undo index failed/); }
  finally { fs.rename = realRename; }
  assert.equal(f.library.getAsset(f.asset.id).previewPath, current.previewPath);
  assert.deepEqual(await fs.readFile(indexPath), before);
  assert.deepEqual(await fs.readFile(f.library.previewPath(f.asset.id)), PNG);
  const reopened = await Library.open(f.root);
  assert.equal((await reopened.restorePreview(f.asset.id)).previewPath, f.oldPath);
});

test('unused render output survives restart and is deleted after 48 hours without becoming an undo step', async t => {
  const f = await fixture(t);
  const output = { previewPath: 'previews/stale-render.gif', previewPosterPath: 'previews/stale-render.png' };
  await fs.writeFile(path.join(f.root, output.previewPath), 'stale gif');
  await fs.writeFile(path.join(f.root, output.previewPosterPath), PNG);
  const before = f.library.snapshot();
  const started = Date.now();
  assert.deepEqual(await f.library.retireUnusedPreview(output), [output.previewPath, output.previewPosterPath]);
  assert.deepEqual(f.library.snapshot(), before);
  const reopened = await Library.open(f.root), deadline = reopened.nextPreviewCleanupAt();
  assert.ok(deadline >= started + TWO_DAYS && deadline <= Date.now() + TWO_DAYS);
  assert.equal(reopened.getAsset(f.asset.id).previewUndoUntil, null);
  await reopened.cleanupExpiredPreviews(deadline - 1);
  await fs.access(path.join(f.root, output.previewPath));
  await fs.access(path.join(f.root, output.previewPosterPath));
  const cleaned = await reopened.cleanupExpiredPreviews(deadline);
  assert.deepEqual(new Set(cleaned.deleted), new Set([output.previewPath, output.previewPosterPath]));
  await fs.access(reopened.previewPath(f.asset.id));
  assert.equal((await Library.open(f.root)).nextPreviewCleanupAt(), null);
});

test('unused render retirement deduplicates paths and protects active, removed and undoable previews', async t => {
  const f = await fixture(t);
  const protectedOutput = { previewPath: f.oldPath, previewPosterPath: f.oldPath };
  assert.deepEqual(await f.library.retireUnusedPreview(protectedOutput), []);
  await f.library.replacePreview(f.asset.id, f.picture);
  const index = JSON.parse(await fs.readFile(path.join(f.root, 'library.json')));
  const oldDeadline = index.retiredPreviews.find(item => item.path === f.oldPath).deleteAfter;
  assert.deepEqual(await f.library.retireUnusedPreview(protectedOutput), []);
  await f.library.removeAssets([f.asset.id]);
  const removed = index.assets[0];
  assert.deepEqual(await f.library.retireUnusedPreview({ previewPath: removed.previewPath }), []);
  const stale = 'previews/duplicate-stale.png';
  await fs.writeFile(path.join(f.root, stale), PNG);
  assert.deepEqual(await f.library.retireUnusedPreview({ previewPath: stale, previewPosterPath: stale }), [stale]);
  const deadline = f.library.nextPreviewCleanupAt();
  assert.deepEqual(await f.library.retireUnusedPreview({ previewPath: stale }), []);
  assert.equal(f.library.nextPreviewCleanupAt(), deadline);
  const state = JSON.parse(await fs.readFile(path.join(f.root, 'library.json')));
  assert.equal(state.retiredPreviews.filter(item => item.path === stale).length, 1);
  assert.equal(state.retiredPreviews.find(item => item.path === f.oldPath).deleteAfter, oldDeadline);
  await f.library.cleanupExpiredPreviews(Date.now() + TWO_DAYS + 1000);
  await f.library.undo();
  await fs.access(f.library.previewPath(f.asset.id));
});

test('unused render retirement rejects unsafe paths atomically and protects a later adopted output', async t => {
  const f = await fixture(t), stale = 'previews/adopted-stale.png';
  await fs.writeFile(path.join(f.root, stale), PNG);
  const before = await fs.readFile(path.join(f.root, 'library.json'));
  for (const previewPosterPath of ['../新封面.png', f.picture, 'assets/payload.png', 'previews/data.json']) {
    await assert.rejects(f.library.retireUnusedPreview({ previewPath: stale, previewPosterPath }), /预览|路径/);
    assert.deepEqual(await fs.readFile(path.join(f.root, 'library.json')), before);
  }
  await f.library.retireUnusedPreview({ previewPath: stale });
  await f.library.setPreview(f.asset.id, { previewPath: stale, previewStatus: 'ready' });
  await f.library.cleanupExpiredPreviews(Date.now() + TWO_DAYS + 1000);
  assert.deepEqual(await fs.readFile(f.library.previewPath(f.asset.id)), PNG);
  assert.deepEqual(await fs.readFile(f.picture), PNG);
});
