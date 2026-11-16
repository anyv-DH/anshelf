/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Library } = require('../core/library.cjs');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHlcAAAAASUVORK5CYII=', 'base64');

async function setup(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-image-library-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'library');
  const source = path.join(base, '角色.PNG');
  await fs.writeFile(source, PNG);
  const library = await Library.open(root);
  return { base, root, source, library, file: path.join(root, 'library.json') };
}

test('fresh libraries have the eight requested system roots in order', async t => {
  const { library, file } = await setup(t);
  assert.deepEqual(library.snapshot().categories.filter(c => c.systemKey).map(c => [c.systemKey, c.name, c.scope]), [
    ['character', '人物', 'ordinary'], ['scene', '背景', 'ordinary'],
    ['expression', '表情', 'ordinary'], ['prop', '道具', 'ordinary'],
    ['effect', '特效', 'effect'], ['creature', '动物异兽', 'ordinary'],
    ['audio', '音效', 'audio'], ['bgm', 'BGM', 'audio'],
  ]);
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).taxonomyVersion, 2);
});

test('v1 taxonomy upgrade preserves old roots, memberships and original bytes', async t => {
  const { base, root, library, file } = await setup(t);
  const source = path.join(base, 'old.wav');
  await fs.writeFile(source, 'legacy-audio');
  const audio = library.snapshot().categories.find(c => c.systemKey === 'audio');
  const asset = (await library.importPaths([source], { mode: 'audio', categoryId: audio.id })).assets[0];
  const old = JSON.parse(await fs.readFile(file, 'utf8'));
  old.taxonomyVersion = 1;
  old.categories = old.categories.filter(c => !['creature', 'bgm'].includes(c.systemKey));
  old.categories.find(c => c.systemKey === 'audio').name = '音频';
  old.categories.find(c => c.systemKey === 'scene').name = '场景';
  const categories = structuredClone(old.categories);
  const record = structuredClone(old.assets[0]);
  await fs.writeFile(file, JSON.stringify(old));
  const opened = await Library.open(root);
  for (const c of categories) assert.deepEqual(opened.snapshot().categories.find(item => item.id === c.id), c);
  for (const [key, value] of Object.entries(record)) assert.deepEqual(opened.getAsset(asset.id)[key], value);
  assert.equal(opened.snapshot().categories.filter(c => c.systemKey).length, 8);
  assert.equal(await fs.readFile(source, 'utf8'), 'legacy-audio');
  assert.equal(await fs.readFile(opened.assetPath(asset.id), 'utf8'), 'legacy-audio');
  assert.deepEqual(opened.getAsset(asset.id).categoryIds, [audio.id]);
  const persisted = await fs.readFile(file);
  await Library.open(root);
  assert.deepEqual(await fs.readFile(file), persisted);
});

test('image import is deduplicated, immediately previewable and persistent without rewriting sources', async t => {
  const { source, root, library } = await setup(t);
  const before = await fs.stat(source);
  const result = await library.importPaths([source], { mode: 'image', previewResolution: 512 });
  assert.equal(result.added, 1);
  assert.deepEqual(result.failed, []);
  const asset = result.assets[0];
  assert.equal(asset.kind, 'image');
  assert.equal(asset.assetType, 'ordinary');
  assert.equal(asset.extension, '.png');
  assert.equal(asset.previewStatus, 'ready');
  assert.ok(asset.previewPath);
  assert.deepEqual(await fs.readFile(library.assetPath(asset.id)), PNG);
  assert.deepEqual(await fs.readFile(library.previewPath(asset.id)), PNG);
  assert.deepEqual(await fs.readFile(source), PNG);
  assert.equal((await fs.stat(source)).mtimeMs, before.mtimeMs);
  const duplicate = await library.importPaths([source], { mode: 'image' });
  assert.equal(duplicate.added, 0);
  assert.equal(duplicate.duplicates, 1);
  assert.equal(duplicate.assets[0].id, asset.id);
  const reopened = await Library.open(root);
  assert.equal(reopened.getAsset(asset.id).kind, 'image');
  assert.deepEqual(await fs.readFile(reopened.previewPath(asset.id)), PNG);
});

test('images can join ordinary system folders and projects but reject effect and audio destinations before writes', async t => {
  const { source, root, library, file } = await setup(t);
  const asset = (await library.importPaths([source], { mode: 'image' })).assets[0];
  const roots = library.snapshot().categories.filter(c => c.systemKey);
  for (const key of ['character', 'scene', 'expression', 'prop', 'creature']) {
    await library.addToCategory([asset.id], roots.find(c => c.systemKey === key).id);
  }
  const project = await library.createProject('第一部剧');
  await library.addToCategory([asset.id], project.id);
  for (const key of ['effect', 'audio', 'bgm']) {
    const target = roots.find(c => c.systemKey === key);
    const before = await fs.readFile(file);
    const files = await fs.readdir(path.join(root, 'assets'));
    await assert.rejects(library.importPaths([source], { mode: 'image', categoryId: target.id }), /类型|分类/);
    await assert.rejects(library.assignCategory([asset.id], target.id), /类型|分类/);
    assert.deepEqual(await fs.readFile(file), before);
    assert.deepEqual(await fs.readdir(path.join(root, 'assets')), files);
  }
});

test('duplicate destinations distinguish inherited, unclassified and selected categories', async t => {
  const { base, library } = await setup(t);
  const source = path.join(base, 'ordinary.fla');
  await fs.writeFile(source, 'ordinary');
  const first = await library.createCategory('第一类', null, 'ordinary');
  const second = await library.createCategory('第二类', null, 'ordinary');
  const third = await library.createCategory('副本类', null, 'ordinary');
  const original = (await library.importPaths([source], { categoryId: first.id })).assets[0];
  await library.addToCategory([original.id], second.id);
  assert.deepEqual((await library.duplicateAsset(original.id)).categoryIds, [first.id, second.id]);
  assert.deepEqual((await library.duplicateAsset(original.id, { categoryId: null })).categoryIds, []);
  assert.deepEqual((await library.duplicateAsset(original.id, { categoryId: third.id })).categoryIds, [third.id]);
  assert.deepEqual(library.getAsset(original.id).categoryIds, [first.id, second.id]);
});

test('invalid copy destinations fail before creating payloads or changing the index', async t => {
  const { source, root, library, file } = await setup(t);
  const original = (await library.importPaths([source], { mode: 'image' })).assets[0];
  const audio = library.snapshot().categories.find(c => c.systemKey === 'audio');
  for (const categoryId of ['missing', audio.id, false, 1]) {
    const before = await fs.readFile(file);
    const files = await fs.readdir(path.join(root, 'assets'));
    await assert.rejects(library.duplicateAsset(original.id, { categoryId }), /分类|类型/);
    assert.deepEqual(await fs.readFile(file), before);
    assert.deepEqual(await fs.readdir(path.join(root, 'assets')), files);
  }
});

test('image duplicates have independent managed files and previews and persist separately', async t => {
  const { source, root, library } = await setup(t);
  const original = (await library.importPaths([source], { mode: 'image' })).assets[0];
  const project = await library.createProject('副本项目');
  const copy = await library.duplicateAsset(original.id, { categoryId: project.id });
  assert.equal(copy.kind, 'image');
  assert.equal(copy.previewStatus, 'ready');
  assert.notEqual(copy.managedPath, original.managedPath);
  assert.notEqual(copy.previewPath, original.previewPath);
  assert.deepEqual(copy.categoryIds, [project.id]);
  assert.deepEqual(await fs.readFile(library.assetPath(copy.id)), PNG);
  assert.deepEqual(await fs.readFile(library.previewPath(copy.id)), PNG);
  assert.equal((await Library.open(root)).snapshot().assets.length, 2);
});

test('v1 upgrades preserve an intentionally removed default character child', async t => {
  const { root, library, file } = await setup(t);
  const modern = library.snapshot().categories.find(c => c.name === '现代都市');
  await library.deleteCategory(modern.id);
  const state = JSON.parse(await fs.readFile(file, 'utf8'));
  state.taxonomyVersion = 1;
  state.categories = state.categories.filter(c => !['creature', 'bgm'].includes(c.systemKey));
  await fs.writeFile(file, JSON.stringify(state));
  assert.equal((await Library.open(root)).snapshot().categories.some(c => c.name === '现代都市'), false);
});

test('a failed image index commit rolls back newly created image and preview files', async t => {
  const { source, root, library, file } = await setup(t);
  const before = await fs.readFile(file);
  const beforeFiles = (await fs.readdir(root, { recursive: true })).sort();
  const rename = fs.rename;
  fs.rename = async (from, to) => {
    if (to === file) throw new Error('simulated image index failure');
    return rename(from, to);
  };
  try { await assert.rejects(library.importPaths([source], { mode: 'image' }), /simulated image index failure/); }
  finally { fs.rename = rename; }
  assert.deepEqual(await fs.readFile(file), before);
  assert.deepEqual((await fs.readdir(root, { recursive: true })).sort(), beforeFiles);
  assert.equal(library.snapshot().assets.length, 0);
});

test('image duplication rebuilds a missing cached preview from its independent managed copy', async t => {
  const { source, library } = await setup(t);
  const original = (await library.importPaths([source], { mode: 'image' })).assets[0];
  await fs.unlink(library.previewPath(original.id));
  const copy = await library.duplicateAsset(original.id);
  assert.equal(copy.previewStatus, 'ready');
  assert.deepEqual(await fs.readFile(library.previewPath(copy.id)), PNG);
});
