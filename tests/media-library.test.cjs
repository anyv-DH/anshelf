/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Library } = require('../core/library.cjs');
async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-media-library-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const sources = path.join(base, 'sources'); await fs.mkdir(sources);
  const root = path.join(base, 'library');
  return { sources, root, library: await Library.open(root) };
}
test('audio import builds a searchable persistent library, preserving bytes and deduplicating', async t => {
  const { sources, root, library } = await fixture(t);
  for (const [name, bytes] of [['击打.WAV', 'sound-a'], ['另一个.wav', 'sound-a'], ['风.mp3', 'sound-b'], ['人物.fla', 'fla'], ['ignored.txt', 'text']]) await fs.writeFile(path.join(sources, name), bytes);
  const before = await fs.stat(path.join(sources, '击打.WAV'));
  const result = await library.importPaths([sources], { mode: 'audio' });
  assert.equal(result.added, 2); assert.equal(result.duplicates, 1);
  assert.deepEqual(result.failed, []);
  for (const asset of library.snapshot().assets) {
    assert.equal(asset.kind, 'audio'); assert.equal(asset.assetType, 'audio');
    assert.equal(asset.previewStatus, 'none'); assert.equal(asset.previewPath, null);
    assert.ok(['.wav', '.mp3'].includes(asset.extension));
    assert.equal(path.extname(asset.managedPath), asset.extension);
  }
  const sound = result.assets.find(a => a.sourcePaths.length === 2);
  const category = await library.createCategory('音效');
  await library.assignCategory([sound.id], category.id);
  await library.updateAsset(sound.id, { favorite: true, tags: ['击打'] });
  const reopened = await Library.open(root);
  assert.equal(reopened.getAsset(sound.id).favorite, true);
  assert.equal(reopened.getAsset(sound.id).categoryId, category.id);
  assert.equal(await fs.readFile(reopened.assetPath(sound.id), 'utf8'), 'sound-a');
  assert.equal((await fs.stat(path.join(sources, '击打.WAV'))).mtimeMs, before.mtimeMs);
});
test('import can place new and duplicate assets into a typed folder while omitted target preserves duplicates', async t => {
  const { sources, library } = await fixture(t);
  const file = path.join(sources, '武器.fla'); await fs.writeFile(file, 'weapon');
  const folder = await library.createCategory('导入武器', null, 'ordinary');
  const child = await library.createCategory('近战', folder.id);
  const first = (await library.importPaths([file], { categoryId: child.id })).assets[0];
  assert.equal(first.categoryId, child.id);
  await library.assignCategory([first.id], folder.id);
  const duplicate = await library.importPaths([file]);
  assert.equal(duplicate.duplicates, 1);
  assert.equal(library.getAsset(first.id).categoryId, folder.id);
  await library.importPaths([file], { categoryId: child.id });
  assert.equal(library.getAsset(first.id).categoryId, child.id);
  await library.importPaths([file], { categoryId: null });
  assert.equal(library.getAsset(first.id).categoryId, null);
  await assert.rejects(library.importPaths([file], { mode: 'effect', categoryId: child.id }), /普通素材分类/);
  await assert.rejects(library.importPaths([file], { categoryId: 'missing' }), /分类不存在/);
});
test('ordinary and effect imports isolate GIF sidecar selection and record their mode', async t => {
  const { sources, library } = await fixture(t);
  await fs.writeFile(path.join(sources, '武器.fla'), 'weapon');
  await fs.writeFile(path.join(sources, '武器.gif'), 'GIF89a');
  await fs.writeFile(path.join(sources, '火焰.fla'), 'fire');
  await fs.writeFile(path.join(sources, '火焰.gif'), 'GIF89a');
  await fs.writeFile(path.join(sources, '火焰.png'), 'png');
  const ordinary = (await library.importPaths([path.join(sources, '武器.fla')])).assets[0];
  assert.equal(ordinary.assetType, 'ordinary'); assert.equal(ordinary.previewStatus, 'pending');
  const effect = (await library.importPaths([path.join(sources, '火焰.fla')], { mode: 'effect' })).assets[0];
  assert.equal(effect.assetType, 'effect'); assert.equal(effect.previewFormat, 'gif');
  assert.equal(effect.previewAnimated, true); assert.equal(effect.previewOrigin, 'sidecar');
  assert.equal(await fs.readFile(library.previewPath(effect.id), 'utf8'), 'GIF89a');
  const disabled = (await library.importPaths([path.join(sources, '火焰.fla')], { mode: 'effect', preferExistingPreview: false })).assets[0];
  assert.equal(disabled.previewStatus, 'pending'); assert.equal(disabled.previewPath, null);
  assert.equal(disabled.previewAnimated, false);
});
test('explicit effect reimport upgrades ordinary once, category changes do not change its type', async t => {
  const { sources, library } = await fixture(t);
  const file = path.join(sources, '光.fla'); await fs.writeFile(file, 'light');
  const original = (await library.importPaths([file])).assets[0];
  await library.setPreview(original.id, { previewStatus: 'ready', previewPath: 'previews/still.png', previewOrigin: 'rendered' });
  const effect = (await library.importPaths([file], { mode: 'effect' })).assets[0];
  assert.equal(effect.id, original.id); assert.equal(effect.assetType, 'effect'); assert.equal(effect.previewStatus, 'pending');
  const category = await library.createCategory('普通'); await library.assignCategory([effect.id], category.id);
  assert.equal(library.getAsset(effect.id).assetType, 'effect');
  const ordinary = (await library.importPaths([file], { mode: 'ordinary', preferExistingPreview: false })).assets[0];
  assert.equal(ordinary.assetType, 'ordinary'); assert.equal(ordinary.previewStatus, 'pending');
});
test('category pins persist, undo and reject malformed values', async t => {
  const { root, library } = await fixture(t);
  const parent = await library.createCategory('声音'); const child = await library.createCategory('击打', parent.id);
  assert.equal(child.pinned, false);
  await library.setCategoryPinned(child.id, true);
  assert.equal((await Library.open(root)).snapshot().categories.find(c => c.id === child.id).pinned, true);
  await library.undo(); assert.equal(library.snapshot().categories.find(c => c.id === child.id).pinned, false);
  for (const value of [1, 'true', null, {}]) await assert.rejects(library.setCategoryPinned(child.id, value), /置顶/);
  await assert.rejects(library.setCategoryPinned('missing', true), /分类/);
});
test('invalid import modes fail before importing and legacy records receive defaults', async t => {
  const { root, library, sources } = await fixture(t);
  const file = path.join(sources, '旧.fla'); await fs.writeFile(file, 'legacy');
  for (const mode of ['gif', '', null, {}]) await assert.rejects(library.importPaths([file], { mode }), /导入类型/);
  const asset = (await library.importPaths([file])).assets[0];
  const state = JSON.parse(await fs.readFile(path.join(root, 'library.json'), 'utf8'));
  for (const key of ['kind', 'assetType', 'extension']) delete state.assets[0][key];
  for (const category of state.categories) delete category.pinned;
  await fs.writeFile(path.join(root, 'library.json'), JSON.stringify(state));
  const reopened = await Library.open(root);
  assert.equal(reopened.getAsset(asset.id).kind, 'fla'); assert.equal(reopened.getAsset(asset.id).assetType, 'ordinary');
  assert.equal(reopened.getAsset(asset.id).extension, '.fla');
  assert.ok(reopened.snapshot().categories.every(c => c.pinned === false));
});
