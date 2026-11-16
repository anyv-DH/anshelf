/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Library, filterAssets } = require('../core/library.cjs');

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-taxonomy-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'library');
  const library = await Library.open(root);
  return { base, root, library, file: path.join(root, 'library.json') };
}

test('new libraries persist eight typed roots and ordinary character subcategories', async t => {
  const { root, library, file } = await fixture(t);
  const categories = library.snapshot().categories;
  const roots = categories.filter(category => category.parentId === null);
  assert.deepEqual(roots.map(({ name, systemKey, scope }) => ({ name, systemKey, scope })), [
    { name: '人物', systemKey: 'character', scope: 'ordinary' },
    { name: '背景', systemKey: 'scene', scope: 'ordinary' },
    { name: '表情', systemKey: 'expression', scope: 'ordinary' },
    { name: '道具', systemKey: 'prop', scope: 'ordinary' },
    { name: '特效', systemKey: 'effect', scope: 'effect' },
    { name: '动物异兽', systemKey: 'creature', scope: 'ordinary' },
    { name: '音效', systemKey: 'audio', scope: 'audio' },
    { name: 'BGM', systemKey: 'bgm', scope: 'audio' },
  ]);
  const character = roots.find(category => category.systemKey === 'character');
  assert.deepEqual(categories.filter(category => category.parentId === character.id).map(category => category.name), ['现代都市', '玄幻修仙', '近代人物', '古代人物']);
  assert.ok(categories.filter(category => category.parentId === character.id).every(category => category.scope === 'ordinary'));
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).taxonomyVersion, 2);
  assert.deepEqual((await Library.open(root)).snapshot().categories, categories);
});

test('legacy roots upgrade additively and keep mixed assets, hierarchy, IDs and file bytes intact', async t => {
  const { base, root, library, file } = await fixture(t);
  const source = path.join(base, 'original.fla');
  await fs.writeFile(source, 'legacy effect payload');
  const imported = (await library.importPaths([source], { mode: 'effect' })).assets[0];
  const legacy = JSON.parse(await fs.readFile(file, 'utf8'));
  delete legacy.taxonomyVersion;
  legacy.categories = [
    { id: 'old-character', name: '人物', parentId: null },
    { id: 'old-child', name: '自建混合分类', parentId: 'old-character' },
    { id: 'existing-modern', name: '现代都市', parentId: 'old-character' },
    { id: 'old-background', name: '背景', parentId: null },
  ];
  legacy.assets[0].categoryId = 'old-child';
  legacy.assets[0].categoryIds = ['old-child', 'existing-modern'];
  await fs.writeFile(file, JSON.stringify(legacy));
  const beforeAsset = structuredClone(legacy.assets[0]);
  const managed = await fs.readFile(library.assetPath(imported.id));
  const opened = await Library.open(root);
  const snapshot = opened.snapshot();
  assert.equal(snapshot.categories.find(category => category.systemKey === 'character').id, 'old-character');
  assert.equal(snapshot.categories.find(category => category.id === 'old-character').scope, 'all');
  assert.equal(snapshot.categories.find(category => category.id === 'old-child').parentId, 'old-character');
  const characterChildren = snapshot.categories.filter(category => category.parentId === 'old-character');
  assert.deepEqual(characterChildren.filter(category => ['现代都市', '玄幻修仙', '近代人物', '古代人物'].includes(category.name)).map(category => category.name), ['现代都市', '玄幻修仙', '近代人物', '古代人物']);
  assert.equal(characterChildren.find(category => category.name === '现代都市').id, 'existing-modern');
  assert.ok(characterChildren.every(category => category.scope === 'all'), 'additive defaults inherit the unrestricted legacy root');
  assert.equal(snapshot.categories.find(category => category.id === 'old-background').name, '背景');
  assert.equal(snapshot.categories.filter(category => category.systemKey).length, 8);
  for (const [key, value] of Object.entries(beforeAsset)) assert.deepEqual(opened.getAsset(imported.id)[key], value);
  assert.equal(await fs.readFile(source, 'utf8'), 'legacy effect payload');
  assert.deepEqual(await fs.readFile(opened.assetPath(imported.id)), managed);
  const written = await fs.readFile(file);
  assert.equal(JSON.parse(written).taxonomyVersion, 2);
  assert.deepEqual((await Library.open(root)).snapshot().categories, snapshot.categories);
  assert.deepEqual(await fs.readFile(file), written);
});

test('removing a default character subcategory after upgrade stays removed across reopening', async t => {
  const { root, library } = await fixture(t);
  const modern = library.snapshot().categories.find(category => category.name === '现代都市');
  await library.deleteCategory(modern.id);
  assert.equal((await Library.open(root)).snapshot().categories.some(category => category.name === '现代都市'), false);
});

test('project roots collect existing ordinary, effect and audio assets without copying payloads', async t => {
  const { base, root, library } = await fixture(t);
  const assets = [];
  for (const [name, mode] of [['角色.fla', 'ordinary'], ['火焰.fla', 'effect'], ['环境.wav', 'audio']]) {
    const source = path.join(base, name);
    await fs.writeFile(source, name);
    const rootCategory = library.snapshot().categories.find(category => category.systemKey === ({ ordinary: 'character', effect: 'effect', audio: 'audio' })[mode]);
    assets.push((await library.importPaths([source], { mode, categoryId: rootCategory.id })).assets[0]);
  }
  const project = await library.createProject('  第一部剧  ');
  assert.equal(project.name, '第一部剧');
  assert.equal(project.kind, 'project');
  assert.equal(project.parentId, null);
  assert.equal(project.scope, 'all');
  const paths = assets.map(asset => library.assetPath(asset.id));
  await library.addToCategory(assets.map(asset => asset.id), project.id);
  const opened = await Library.open(root);
  assert.equal(opened.snapshot().assets.length, 3);
  for (const asset of assets) {
    const current = opened.getAsset(asset.id);
    assert.deepEqual(current.categoryIds, [asset.categoryId, project.id]);
    assert.equal(opened.assetPath(asset.id), paths[assets.indexOf(asset)]);
  }
  assert.equal(filterAssets(opened.snapshot().assets, { categoryId: project.id, categories: opened.snapshot().categories }).length, 3);
  await opened.undo();
  for (const asset of assets) assert.deepEqual(opened.getAsset(asset.id).categoryIds, [asset.categoryId]);
});

test('system roots reject rename, move and deletion atomically while normal folders remain editable', async t => {
  const { library, file } = await fixture(t);
  const system = library.snapshot().categories.find(category => category.systemKey === 'character');
  const parent = await library.createCategory('自建普通分类', null, 'ordinary');
  const before = await fs.readFile(file);
  await assert.rejects(library.renameCategory(system.id, '改名'), /系统|固定/);
  await assert.rejects(library.renameCategory(system.id, system.name, parent.id), /系统|固定/);
  await assert.rejects(library.deleteCategory(system.id), /系统|固定/);
  assert.deepEqual(await fs.readFile(file), before);
  await library.renameCategory(parent.id, '已改名');
  await library.deleteCategory(parent.id);
  await library.undo();
  assert.equal(library.snapshot().categories.find(category => category.id === parent.id).name, '已改名');
});

test('project roots remain top level and project children inherit all scopes', async t => {
  const { library } = await fixture(t);
  const project = await library.createProject('项目甲');
  const child = await library.createCategory('本剧人物', project.id, 'ordinary');
  assert.equal(child.scope, 'all');
  await assert.rejects(library.renameCategory(project.id, '项目甲', child.id), /项目|顶层/);
  await assert.rejects(library.createProject('项目甲'), /已存在/);
  await assert.rejects(library.createProject('  '), /名称/);
  await library.renameCategory(project.id, '项目乙');
  await library.deleteCategory(project.id);
  assert.equal(library.snapshot().categories.find(category => category.id === child.id).parentId, null);
  await library.undo();
  assert.equal(library.snapshot().categories.find(category => category.id === project.id).kind, 'project');
  assert.equal(library.snapshot().categories.find(category => category.id === child.id).parentId, project.id);
});

test('old undo records cannot remove or move a now fixed system root', async t => {
  const { root, library, file } = await fixture(t);
  const state = JSON.parse(await fs.readFile(file, 'utf8'));
  const character = state.categories.find(category => category.systemKey === 'character');
  state.history = [[{ collection: 'categories', id: character.id, before: null, after: character }]];
  await fs.writeFile(file, JSON.stringify(state));
  const opened = await Library.open(root);
  await opened.undo();
  assert.deepEqual(opened.snapshot().categories.find(category => category.id === character.id), character);
  assert.equal((await Library.open(root)).snapshot().categories.filter(category => category.systemKey).length, 8);
});

test('pinning a fixed root remains undoable without unlocking its identity', async t => {
  const { root, library } = await fixture(t);
  const character = library.snapshot().categories.find(category => category.systemKey === 'character');
  await library.setCategoryPinned(character.id, true);
  const opened = await Library.open(root);
  assert.equal(opened.snapshot().categories.find(category => category.id === character.id).pinned, true);
  await opened.undo();
  assert.deepEqual(opened.snapshot().categories.find(category => category.id === character.id), character);
});

test('incompatible legacy same-name roots remain intact with a distinct system category', async t => {
  const { root, file } = await fixture(t);
  const state = { version: 1, assets: [], categories: [{ id: 'legacy-audio', name: '人物', parentId: null, scope: 'audio' }], history: [] };
  await fs.writeFile(file, JSON.stringify(state));
  const opened = await Library.open(root);
  const categories = opened.snapshot().categories;
  assert.deepEqual(categories.find(category => category.id === 'legacy-audio'), { ...state.categories[0], pinned: false });
  const character = categories.find(category => category.systemKey === 'character');
  assert.equal(character.scope, 'ordinary');
  assert.notEqual(character.id, 'legacy-audio');
  assert.equal(new Set(categories.filter(category => category.parentId === null).map(category => category.name)).size, categories.filter(category => category.parentId === null).length);
});

test('invalid taxonomy markers are rejected without rewriting an existing library', async t => {
  const { root, file } = await fixture(t);
  const original = JSON.parse(await fs.readFile(file, 'utf8'));
  for (const mutate of [
    state => { state.taxonomyVersion = 99; },
    state => { state.categories[0].systemKey = 'unknown'; },
    state => { state.categories[1].systemKey = state.categories[0].systemKey; },
    state => { state.categories[0].kind = 'project'; },
    state => { state.categories[0].parentId = state.categories[2].id; },
  ]) {
    const state = structuredClone(original);
    mutate(state);
    await fs.writeFile(file, JSON.stringify(state));
    const before = await fs.readFile(file);
    await assert.rejects(Library.open(root), /分类|体系|项目|类型|范围/);
    assert.deepEqual(await fs.readFile(file), before);
  }
});
