/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { Library } = require('../core/library.cjs');
const { createHost } = require('../desktop/host.cjs');
const { createImportSelections } = require('../desktop/import-selection.cjs');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHlcAAAAASUVORK5CYII=', 'base64');
async function setup(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-folder-image-groups-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const library = await Library.open(path.join(base, 'library'));
  const source = path.join(base, '场景');
  const sources = new Map();
  async function image(relative) {
    const file = path.join(source, relative), bytes = Buffer.concat([PNG, Buffer.from(relative)]);
    await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, bytes); sources.set(file, bytes); return file;
  }
  return { base, library, source, image, sources };
}
test('folder image imports group by immediate containing directory, including nested and same-named folders', async t => {
  const { library, source, image, sources } = await setup(t);
  for (const file of ['root.png', '客厅/正面.png', '客厅/侧面.png', '客厅/窗边/近景.png', '卧室/窗边/远景.png']) await image(file);
  const result = await library.importPaths([source], { mode: 'image', groupByFolder: true });
  assert.equal(result.added, 5); assert.equal(result.grouping.created, 4); assert.deepEqual(result.failed, []);
  const groups = library.snapshot().sceneGroups;
  assert.deepEqual(groups.map(g => [g.name, g.assetIds.length]).sort(), [['场景', 1], ['客厅', 2], ['窗边', 1], ['窗边', 1]].sort());
  const byId = new Map(library.snapshot().assets.map(a => [a.id, a]));
  for (const group of groups) {
    assert.match(group.folderImportKey, /^[a-f0-9]{64}$/);
    const directories = new Set(group.assetIds.map(id => path.dirname(byId.get(id).sourcePaths[0])));
    assert.equal(directories.size, 1);
    assert.equal(group.name, path.basename([...directories][0]));
  }
  assert.equal(new Set(groups.filter(g => g.name === '窗边').map(g => g.folderImportKey)).size, 2);
  assert.deepEqual((await Library.open(library.root)).snapshot().sceneGroups, groups);
  for (const [file, bytes] of sources) assert.deepEqual(await fs.readFile(file), bytes);
});
test('repeat and partial imports extend only their own folder group and preserve user renames and other membership', async t => {
  const { library, source, image } = await setup(t);
  const a = await image('客厅/a.png'), b = await image('客厅/b.png');
  const first = await library.importPaths([a], { mode: 'image', groupByFolder: true });
  const group = library.snapshot().sceneGroups[0]; assert.equal(first.grouping.created, 1);
  await library.updateSceneGroup(group.id, { name: '我的客厅' });
  const second = await library.importPaths([a, b], { mode: 'image', groupByFolder: true });
  assert.equal(second.grouping.created, 0); assert.equal(second.grouping.updated, 1);
  assert.equal(library.snapshot().sceneGroups[0].name, '我的客厅'); assert.equal(library.snapshot().sceneGroups[0].assetIds.length, 2);
  const repeated = await library.importPaths([source], { mode: 'image', groupByFolder: true });
  assert.equal(repeated.grouping.created, 0); assert.equal(repeated.grouping.updated, 0);
  assert.equal(library.snapshot().sceneGroups.length, 1);
  const c = (await library.importPaths([await image('其他/c.png')], { mode: 'image' })).assets[0];
  const d = await library.duplicateAsset(c.id); await library.createSceneGroup('手动组合', [c.id, d.id]);
  const conflicted = await library.importPaths([source], { mode: 'image', groupByFolder: true });
  assert.equal(conflicted.grouping.skipped, 1); assert.match(conflicted.grouping.warnings.join(' '), /已有|其他|组合/);
  assert.deepEqual(library.snapshot().sceneGroups.find(g => g.name === '手动组合').assetIds, [c.id, d.id]);
});
test('grouping is optional and accepts only a boolean for image mode before persistent writes', async t => {
  const { library, image } = await setup(t), file = await image('普通/a.png');
  await library.importPaths([file], { mode: 'image' }); assert.deepEqual(library.snapshot().sceneGroups, []);
  const before = await fs.readFile(path.join(library.root, 'library.json'));
  for (const options of [{ mode: 'image', groupByFolder: 'true' }, { mode: 'image', groupByFolder: 1 }, { mode: 'ordinary', groupByFolder: true }, { mode: 'audio', groupByFolder: true }]) {
    await assert.rejects(library.importPaths([file], options), /分组|图片/);
    assert.deepEqual(await fs.readFile(path.join(library.root, 'library.json')), before);
  }
  await assert.rejects(library.createSceneGroup('手动单张', [library.snapshot().assets[0].id]), /2/);
});
test('failed image files remain retryable and append to the same folder group when repaired', async t => {
  const { library, image } = await setup(t), a = await image('重试/a.png'), b = await image('重试/b.png');
  const original = await fs.readFile(b); await fs.writeFile(b, 'broken');
  const first = await library.importPaths([a, b], { mode: 'image', groupByFolder: true });
  assert.equal(first.added, 1); assert.equal(first.failed.length, 1); assert.equal(first.grouping.created, 1);
  const id = library.snapshot().sceneGroups[0].id; await fs.writeFile(b, original);
  const retried = await library.importPaths([b], { mode: 'image', groupByFolder: true });
  assert.equal(retried.grouping.updated, 1); assert.equal(library.snapshot().sceneGroups[0].id, id);
  assert.equal(library.snapshot().sceneGroups[0].assetIds.length, 2);
});
test('oversized folder leaves every image imported and reports an explicit ungrouped warning', async t => {
  const { library, source, image } = await setup(t);
  for (let i = 0; i < 201; i++) await image('大文件夹/' + i + '.png');
  const result = await library.importPaths([source], { mode: 'image', groupByFolder: true });
  assert.equal(result.added, 201); assert.equal(library.snapshot().assets.length, 201);
  assert.deepEqual(library.snapshot().sceneGroups, []); assert.equal(result.grouping.skipped, 201);
  assert.match(result.grouping.warnings.join(' '), /200/);
});
test('asset and folder grouping index commit fails atomically and removes newly created managed files', async t => {
  const { library, image } = await setup(t), file = await image('原子/a.png');
  const index = path.join(library.root, 'library.json'), before = await fs.readFile(index);
  const beforeFiles = (await fs.readdir(library.root, { recursive: true })).sort(), rename = fs.rename;
  fs.rename = async (from, to) => { if (to === index) throw new Error('folder grouping commit failed'); return rename(from, to); };
  try { await assert.rejects(library.importPaths([file], { mode: 'image', groupByFolder: true }), /grouping commit failed/); }
  finally { fs.rename = rename; }
  assert.deepEqual(await fs.readFile(index), before); assert.deepEqual(library.snapshot().assets, []); assert.deepEqual(library.snapshot().sceneGroups, []);
  assert.deepEqual((await fs.readdir(library.root, { recursive: true })).sort(), beforeFiles);
});
test('native selections pass the explicit image grouping flag and host persists groups without renderer paths', async t => {
  const { base, source, image } = await setup(t); await image('下层/a.png'); await image('下层/b.png');
  const host = await createHost({ root: path.join(base, 'host-library'), render: async () => { throw new Error('unexpected render'); } });
  t.after(() => host.close());
  const selections = createImportSelections({ importPaths: host.api.importPaths, pickFolder: async () => [source] });
  t.after(() => selections.close());
  const chosen = await selections.chooseImportFolder({ mode: 'image' });
  for (const file of chosen.files) assert.deepEqual(Object.keys(file).sort(), ['extension', 'name']);
  for (const options of [{ mode: 'image', groupByFolder: 'true' }, { mode: 'ordinary', groupByFolder: true }]) await assert.rejects(selections.importSelectedPaths(chosen.selectionId, options), /分组|图片/);
  const result = await selections.importSelectedPaths(chosen.selectionId, { mode: 'image', groupByFolder: true });
  assert.equal(result.grouping.created, 1); assert.equal((await host.api.snapshot()).sceneGroups[0].name, '下层');
});
