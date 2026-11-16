/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Library } = require('../core/library.cjs');
const { assignmentCategoryScope } = require('../core/category-scope.cjs');

async function legacyFixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-system-scope-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'library'), file = path.join(root, 'library.json');
  const initial = await Library.open(root);
  const assets = {};
  for (const [mode, name] of [['ordinary', '普通.fla'], ['effect', '特效.fla'], ['audio', '音频.wav']]) {
    const source = path.join(base, name);
    await fs.writeFile(source, `${name} original bytes`);
    assets[mode] = (await initial.importPaths([source], { mode })).assets[0];
  }
  const state = JSON.parse(await fs.readFile(file, 'utf8'));
  delete state.taxonomyVersion;
  state.categories = [
    { id: 'legacy-people', name: '人物', parentId: null, scope: 'all' },
    { id: 'legacy-child', name: '旧人物子类', parentId: 'legacy-people', scope: 'all' },
    { id: 'legacy-free', name: '旧混合文件夹', parentId: null, scope: 'all' },
  ];
  for (const asset of state.assets) if (asset.id !== assets.ordinary.id) {
    asset.categoryId = 'legacy-child'; asset.categoryIds = ['legacy-child'];
  }
  state.history = [];
  await fs.writeFile(file, JSON.stringify(state));
  const library = await Library.open(root);
  return { base, root, file, library, assets };
}

test('assignment scopes inherit fixed root semantics while raw legacy scopes stay unrestricted', () => {
  const categories = [
    { id: 'people', systemKey: 'character', scope: 'all', parentId: null },
    { id: 'child', scope: 'all', parentId: 'people' },
    { id: 'effect', systemKey: 'effect', scope: 'all', parentId: null },
    { id: 'audio', systemKey: 'audio', scope: 'all', parentId: null },
    { id: 'project', kind: 'project', scope: 'all', parentId: null },
    { id: 'project-child', scope: 'all', parentId: 'project' },
    { id: 'custom-audio', scope: 'audio', parentId: null },
  ];
  assert.equal(assignmentCategoryScope(categories, 'child'), 'ordinary');
  assert.equal(assignmentCategoryScope(categories, 'effect'), 'effect');
  assert.equal(assignmentCategoryScope(categories, 'audio'), 'audio');
  assert.equal(assignmentCategoryScope(categories, 'project-child'), 'all');
  assert.equal(assignmentCategoryScope(categories, 'custom-audio'), 'audio');
  assert.equal(assignmentCategoryScope(categories, null), 'all');
  assert.equal(categories[0].scope, 'all');
});

test('legacy mixed assets reopen, edit metadata, reimport unchanged types and undo without retrospective rejection', async t => {
  const { root, library, assets } = await legacyFixture(t);
  for (const mode of ['audio', 'effect']) {
    const asset = library.getAsset(assets[mode].id);
    assert.deepEqual(asset.categoryIds, ['legacy-child']);
    assert.equal(asset.assetType, mode);
    await library.updateAsset(asset.id, { tags: ['历史分类保留'], favorite: true });
    await library.undo();
    assert.deepEqual(library.getAsset(asset.id).tags, []);
    const reimported = await library.importPaths(asset.sourcePaths, { mode });
    assert.equal(reimported.duplicates, 1);
    assert.deepEqual(library.getAsset(asset.id).categoryIds, ['legacy-child']);
  }
  const reopened = await Library.open(root);
  assert.equal(reopened.snapshot().categories.find(category => category.id === 'legacy-people').scope, 'all');
  assert.deepEqual(reopened.getAsset(assets.audio.id).categoryIds, ['legacy-child']);
  assert.equal(reopened.getAsset(assets.effect.id).assetType, 'effect');
});

test('new imports into legacy fixed roots and descendants reject wrong types before copying while ordinary imports succeed', async t => {
  const { base, library, file } = await legacyFixture(t);
  const child = await library.createCategory('新增人物子类', 'legacy-people', 'audio');
  assert.equal(child.scope, 'all', 'raw scope continues to inherit the compatible legacy tree');
  const before = await fs.readFile(file), files = await fs.readdir(path.join(library.root, 'assets'));
  for (const categoryId of ['legacy-people', 'legacy-child', child.id]) for (const mode of ['audio', 'effect']) {
    const source = path.join(base, `新${mode}.${mode === 'audio' ? 'wav' : 'fla'}`);
    await fs.writeFile(source, `new ${mode}`);
    await assert.rejects(library.importPaths([source], { mode, categoryId }), /类型|分类/);
  }
  assert.deepEqual(await fs.readFile(file), before);
  assert.deepEqual(await fs.readdir(path.join(library.root, 'assets')), files);
  const ordinary = path.join(base, '新人物.fla'); await fs.writeFile(ordinary, 'new ordinary');
  const result = await library.importPaths([ordinary], { categoryId: child.id });
  assert.equal(result.added, 1);
  assert.deepEqual(result.assets[0].categoryIds, [child.id]);
  assert.equal(await fs.readFile(ordinary, 'utf8'), 'new ordinary');
});

test('new assignments and category patches enforce effective ancestry while projects retain mixed memberships', async t => {
  const { library, file, assets } = await legacyFixture(t);
  const project = await library.createProject('混合项目');
  const before = await fs.readFile(file);
  for (const categoryId of ['legacy-people', 'legacy-child']) for (const mode of ['audio', 'effect']) {
    await assert.rejects(library.assignCategory([assets[mode].id], categoryId), /类型|分类/);
    await assert.rejects(library.addToCategory([assets[mode].id], categoryId), /类型|分类/);
    await assert.rejects(library.updateAsset(assets[mode].id, { name: '不应提交', categoryId }), /类型|分类/);
  }
  assert.deepEqual(await fs.readFile(file), before);
  await library.assignCategory([assets.ordinary.id], 'legacy-child');
  await library.addToCategory(Object.values(assets).map(asset => asset.id), project.id);
  for (const asset of Object.values(assets)) assert.ok(library.getAsset(asset.id).categoryIds.includes(project.id));
  await library.undo();
  assert.deepEqual(library.getAsset(assets.audio.id).categoryIds, ['legacy-child']);
});

test('document import validates new destinations and type changes while same-type legacy preview settings still work', async t => {
  const { library, file, assets } = await legacyFixture(t);
  await library.configureDocumentImport(assets.effect.id, { mode: 'effect', previewResolution: 1024 });
  assert.equal(library.getAsset(assets.effect.id).previewResolution, 1024);
  const before = await fs.readFile(file);
  await assert.rejects(library.configureDocumentImport(assets.effect.id, { mode: 'effect', categoryId: 'legacy-child' }), /类型|分类/);
  await library.assignCategory([assets.ordinary.id], 'legacy-child');
  const assigned = await fs.readFile(file);
  await assert.rejects(library.configureDocumentImport(assets.ordinary.id, { mode: 'effect' }), /类型|分类/);
  assert.deepEqual(await fs.readFile(file), assigned);
  assert.notDeepEqual(assigned, before);
  assert.equal(library.getAsset(assets.ordinary.id).assetType, 'ordinary');
});

test('reimports cannot change the type of a material kept in an incompatible system category', async t => {
  const { library, assets, file } = await legacyFixture(t);
  await library.assignCategory([assets.ordinary.id], 'legacy-child');
  const before = await fs.readFile(file);
  const result = await library.importPaths(assets.ordinary.sourcePaths, { mode: 'effect' });
  assert.equal(result.added, 0);
  assert.equal(result.duplicates, 0);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].error, /类型|分类/);
  assert.deepEqual(await fs.readFile(file), before);
  assert.equal(library.getAsset(assets.ordinary.id).assetType, 'ordinary');
});

test('moving unrestricted category trees under a legacy system root validates descendant material types atomically', async t => {
  const { library, assets, file } = await legacyFixture(t);
  const freeChild = await library.createCategory('混合子类', 'legacy-free');
  await library.assignCategory([assets.audio.id], freeChild.id);
  const before = await fs.readFile(file);
  await assert.rejects(library.renameCategory('legacy-free', '旧混合文件夹', 'legacy-people'), /类型|分类/);
  assert.deepEqual(await fs.readFile(file), before);
  const ordinaryGroup = await library.createCategory('可移动普通组');
  const ordinaryChild = await library.createCategory('普通子类', ordinaryGroup.id);
  await library.assignCategory([assets.ordinary.id], ordinaryChild.id);
  await library.renameCategory(ordinaryGroup.id, ordinaryGroup.name, 'legacy-people');
  assert.equal(library.snapshot().categories.find(category => category.id === ordinaryGroup.id).parentId, 'legacy-people');
  await assert.rejects(library.addToCategory([assets.audio.id], ordinaryChild.id), /类型|分类/);
  await library.undo();
  assert.equal(library.snapshot().categories.find(category => category.id === ordinaryGroup.id).parentId, null);
  await library.addToCategory([assets.audio.id], ordinaryChild.id);
  assert.ok(library.getAsset(assets.audio.id).categoryIds.includes(ordinaryChild.id));
});
