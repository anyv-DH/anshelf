/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Library, assetCategoryIds } = require('../core/library.cjs');

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-removal-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'data'), source = path.join(base, '共享人物.fla');
  await fs.writeFile(source, 'shared-character');
  const library = await Library.open(root);
  const asset = (await library.importPaths([source])).assets[0];
  const first = await library.createCategory('剧集一');
  const second = await library.createCategory('剧集二');
  const child = await library.createCategory('男生', second.id);
  await library.assignCategory([asset.id], first.id);
  await library.addToCategory([asset.id], second.id);
  await library.addToCategory([asset.id], child.id);
  return { library, root, asset, first, second, child, source };
}

test('removing a shared asset from a category subtree preserves other memberships, files and preview', async t => {
  const { library, root, asset, first, second, child, source } = await fixture(t);
  await library.setPreview(asset.id, { previewStatus: 'ready', previewPath: 'previews/shared.png' });
  const before = library.getAsset(asset.id), file = library.assetPath(asset.id);
  await library.removeFromCategories([asset.id], [second.id, child.id]);
  const after = library.getAsset(asset.id);
  assert.deepEqual(assetCategoryIds(after), [first.id]);
  assert.deepEqual({ ...after, categoryId: before.categoryId, categoryIds: before.categoryIds }, before);
  assert.equal(await fs.readFile(file, 'utf8'), 'shared-character');
  assert.equal(await fs.readFile(source, 'utf8'), 'shared-character');
  const reopened = await Library.open(root);
  assert.deepEqual(assetCategoryIds(reopened.getAsset(asset.id)), [first.id]);
  await reopened.undo();
  assert.deepEqual(assetCategoryIds(reopened.getAsset(asset.id)), [first.id, second.id, child.id]);
});

test('removing the only membership leaves the asset available as uncategorized and is idempotent', async t => {
  const { library, asset, first, second, child } = await fixture(t);
  await library.removeFromCategories([asset.id, asset.id], [first.id, second.id, child.id, child.id]);
  assert.deepEqual(assetCategoryIds(library.getAsset(asset.id)), []);
  assert.equal(library.snapshot().assets.length, 1);
  const revision = library.revision;
  await library.removeFromCategories([asset.id], [second.id]);
  assert.equal(library.revision, revision);
});

test('category unlink validates an entire batch before changing any asset', async t => {
  const { library, root, asset, second } = await fixture(t);
  const before = await fs.readFile(path.join(root, 'library.json'), 'utf8');
  for (const [ids, categories] of [[[asset.id, 'missing-asset'], [second.id]], [[asset.id], [second.id, 'missing-category']], [[asset.id], []], [[asset.id], [null]], [[asset.id], second.id]]) {
    await assert.rejects(library.removeFromCategories(ids, categories));
    assert.equal(await fs.readFile(path.join(root, 'library.json'), 'utf8'), before);
  }
});
