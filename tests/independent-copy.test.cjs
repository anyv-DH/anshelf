/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHost } = require('../desktop/host.cjs');
const { Library } = require('../core/library.cjs');

async function fixture(t, options = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-independent-copy-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const source = path.join(base, '人物.fla');
  await fs.writeFile(source, 'original saved bytes');
  const revealed = [], opened = [];
  const host = await createHost({ root: path.join(base, 'library'), render: async () => ({ previewPath: null }),
    revealFile: async file => revealed.push(file), openInAnimate: async file => opened.push(file), ...options });
  const imported = await host.api.importPaths([source]);
  await host.queue.idle();
  return { base, source, host, asset: imported.assets[0], revealed, opened };
}

async function payloads(root) {
  return (await fs.readdir(path.join(root, 'assets'), { recursive: true })).filter(file => /\.(fla|wav)$/.test(file));
}

test('confirmed copy appears as a new independent card with one new payload and inherited metadata', async t => {
  const { host, asset, source, revealed } = await fixture(t);
  const first = await host.api.createCategory('第一部剧');
  const second = await host.api.createCategory('第二部剧');
  await host.api.assignCategory([asset.id], first.id);
  await host.api.addToCategory([asset.id], second.id);
  await host.api.updateAsset(asset.id, { tags: ['人物', '主角'], favorite: true, liked: true });
  const original = host.library.getAsset(asset.id);
  const result = await host.api.duplicateInFolder(asset.id);
  await host.queue.idle();
  const assets = host.library.snapshot().assets;
  assert.equal(assets.length, 2, 'copy must be added without a separate manual import');
  const copy = host.library.getAsset(result.assetId);
  assert.ok(copy && copy.id !== asset.id);
  assert.equal(copy.name, '人物 - 副本');
  assert.notEqual(copy.managedPath, original.managedPath);
  assert.equal(copy.hash, original.hash, 'same initial bytes are still independent');
  assert.deepEqual(copy.categoryIds, original.categoryIds);
  assert.deepEqual(copy.tags, original.tags);
  assert.equal(copy.favorite, false);
  assert.equal(copy.liked, false);
  assert.equal(result.file, host.library.assetPath(copy.id));
  assert.deepEqual(revealed, [result.file]);
  assert.equal((await payloads(host.root)).length, 2, 'exactly one new managed FLA');
  assert.deepEqual((await fs.readdir(path.dirname(source))).sort(), ['library', '人物.fla']);
  assert.deepEqual(host.library.getAsset(asset.id), original);
  const reopened = await Library.open(host.root);
  assert.equal(reopened.snapshot().assets.length, 2);
  assert.deepEqual(reopened.getAsset(copy.id), copy);
});

test('editing the copied FLA and re-adding it from AN changes only that copy', async t => {
  const { host, asset, opened, source } = await fixture(t);
  const result = await host.api.duplicateInFolder(asset.id);
  const copy = host.library.getAsset(result.assetId);
  assert.ok(copy, 'copy is registered before use');
  const original = host.library.getAsset(asset.id);
  await host.api.openInAnimate(copy.id);
  assert.equal(opened.at(-1), host.library.assetPath(copy.id));
  await fs.writeFile(opened.at(-1), 'edited variant');
  const added = await host.importCurrentDocument(opened.at(-1));
  assert.equal(added.assetId, copy.id);
  assert.equal(added.updated, true);
  await host.queue.idle();
  assert.equal(await fs.readFile(host.library.assetPath(asset.id), 'utf8'), 'original saved bytes');
  assert.equal(await fs.readFile(source, 'utf8'), 'original saved bytes');
  assert.deepEqual(host.library.getAsset(asset.id), original);
  assert.notEqual(host.library.getAsset(copy.id).hash, original.hash);
  assert.equal((await payloads(host.root)).length, 2);
});

test('removing either same-byte record and undoing keeps both independent identities', async t => {
  const { host, asset } = await fixture(t);
  const result = await host.api.duplicateInFolder(asset.id);
  assert.ok(result.assetId, 'copy identity is returned');
  for (const id of [result.assetId, asset.id]) {
    await host.api.removeAssets([id]);
    await host.api.undo();
    assert.deepEqual(host.library.snapshot().assets.map(item => item.id).sort(), [asset.id, result.assetId].sort());
  }
});

test('ordinary imports still deduplicate while reimporting a known copy does not absorb it into its original', async t => {
  const { host, asset, source, base } = await fixture(t);
  const result = await host.api.duplicateInFolder(asset.id);
  assert.ok(result.assetId, 'copy identity is returned');
  const reimport = await host.api.importPaths([result.file]);
  assert.equal(reimport.added, 0);
  assert.equal(reimport.assets[0].id, result.assetId);
  const external = path.join(base, '另一个同内容.fla');
  await fs.copyFile(source, external);
  const imported = await host.api.importPaths([external]);
  assert.equal(imported.added, 0);
  assert.equal(imported.assets[0].id, asset.id);
  assert.equal(host.library.snapshot().assets.length, 2);
});

test('a copied preview remains independent when the original preview is overwritten', async t => {
  const { host, asset } = await fixture(t);
  const originalPreview = path.join(host.root, 'previews', asset.id + '.png');
  await fs.writeFile(originalPreview, 'original-preview');
  await host.library.setPreview(asset.id, { previewStatus: 'ready', previewPath: 'previews/' + asset.id + '.png', previewOrigin: 'rendered', previewFormat: 'png' });
  const result = await host.api.duplicateInFolder(asset.id);
  const copy = host.library.getAsset(result.assetId);
  assert.notEqual(copy.previewPath, host.library.getAsset(asset.id).previewPath);
  assert.equal(copy.previewStatus, 'ready');
  assert.equal(await fs.readFile(host.library.previewPath(copy.id), 'utf8'), 'original-preview');
  await fs.writeFile(originalPreview, 'updated-original-preview');
  assert.equal(await fs.readFile(host.library.previewPath(copy.id), 'utf8'), 'original-preview');
});

test('explicit managed-file reimport applies selected settings while retaining independent identity', async t => {
  const { host, asset } = await fixture(t);
  const copy = await host.api.duplicateInFolder(asset.id);
  const category = await host.api.createCategory('火焰', null, 'effect');
  const imported = await host.api.importPaths([copy.file], { mode: 'effect', categoryId: category.id, previewResolution: 2048, preferExistingPreview: false });
  await host.queue.idle();
  assert.equal(imported.added, 0);
  assert.equal(imported.duplicates, 1);
  assert.equal(imported.assets[0].id, copy.assetId);
  const configured = host.library.getAsset(copy.assetId);
  assert.equal(configured.assetType, 'effect');
  assert.equal(configured.previewResolution, 2048);
  assert.deepEqual(configured.categoryIds, [category.id]);
  assert.equal(host.library.getAsset(asset.id).assetType, 'ordinary');
  assert.equal(host.library.snapshot().assets.length, 2);
  assert.equal((await payloads(host.root)).length, 2);
});

test('explicit audio reimport applies its folder but recursive or unregistered library files stay excluded', async t => {
  const { host, base } = await fixture(t);
  const source = path.join(base, '音频.wav');
  await fs.writeFile(source, 'audio bytes');
  const original = (await host.api.importPaths([source], { mode: 'audio' })).assets[0];
  const copy = await host.api.duplicateInFolder(original.id);
  const folder = await host.api.createCategory('音效', null, 'audio');
  const imported = await host.api.importPaths([copy.file], { mode: 'audio', categoryId: folder.id });
  assert.equal(imported.assets[0].id, copy.assetId);
  assert.deepEqual(host.library.getAsset(copy.assetId).categoryIds, [folder.id]);
  const unknown = path.join(host.root, 'assets', 'unregistered.fla');
  await fs.writeFile(unknown, 'unregistered bytes');
  assert.deepEqual((await host.api.importPaths([unknown, host.root])).assets, []);
  assert.equal(host.library.snapshot().assets.length, 3);
  assert.equal(await fs.readFile(unknown, 'utf8'), 'unregistered bytes');
});

test('a metadata write failure rolls back only the new copy and leaves no orphan payload', async t => {
  const { host, asset } = await fixture(t);
  const before = await fs.readFile(path.join(host.root, 'library.json'));
  const beforeFiles = (await fs.readdir(host.root, { recursive: true })).sort();
  const rename = fs.rename;
  fs.rename = async (source, target) => {
    if (target === path.join(host.root, 'library.json')) throw new Error('simulated index write failure');
    return rename(source, target);
  };
  try { await assert.rejects(host.api.duplicateInFolder(asset.id), /simulated index write failure/); }
  finally { fs.rename = rename; }
  assert.equal(host.library.snapshot().assets.length, 1);
  assert.deepEqual(await fs.readFile(path.join(host.root, 'library.json')), before);
  assert.deepEqual((await fs.readdir(host.root, { recursive: true })).sort(), beforeFiles);
  assert.equal(await fs.readFile(host.library.assetPath(asset.id), 'utf8'), 'original saved bytes');
});

test('unknown same-byte files cannot randomly attach to a copy when the original record was removed', async t => {
  const { host, asset, source, base } = await fixture(t);
  const result = await host.api.duplicateInFolder(asset.id);
  await host.api.removeAssets([asset.id]);
  const external = path.join(base, '新来源.fla');
  await fs.copyFile(source, external);
  const added = await host.importCurrentDocument(external);
  assert.notEqual(added.assetId, result.assetId);
  assert.equal(added.duplicate, false);
  assert.equal(host.library.snapshot().assets.length, 2);
  await host.queue.idle();
  await host.api.undo();
  assert.equal(host.library.snapshot().assets.length, 2, 'ordinary restore may merge ordinary reimport, never the copy');
  assert.ok(host.library.getAsset(result.assetId));
});

test('effect copies inherit 2K and classification, audio copies remain audio without FLA rendering', async t => {
  const { host, asset, source, base } = await fixture(t);
  const category = await host.api.createCategory('特效专用', null, 'effect');
  await host.api.importPaths([source], { mode: 'effect', previewResolution: 2048, categoryId: category.id });
  await host.queue.idle();
  const effectResult = await host.api.duplicateInFolder(asset.id);
  const effect = host.library.getAsset(effectResult.assetId);
  assert.equal(effect.assetType, 'effect');
  assert.equal(effect.previewResolution, 2048);
  assert.deepEqual(effect.categoryIds, [category.id]);
  const file = path.join(base, '音效.wav');
  await fs.writeFile(file, 'audio data');
  const audio = (await host.api.importPaths([file], { mode: 'audio' })).assets[0];
  const audioResult = await host.api.duplicateInFolder(audio.id);
  const copiedAudio = host.library.getAsset(audioResult.assetId);
  assert.equal(copiedAudio.kind, 'audio');
  assert.equal(copiedAudio.assetType, 'audio');
  assert.equal(copiedAudio.previewStatus, 'none');
  assert.equal(path.extname(audioResult.file), '.wav');
  assert.equal(await fs.readFile(audioResult.file, 'utf8'), 'audio data');
  await host.queue.idle();
});
