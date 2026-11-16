const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Library } = require('../core/library.cjs');
async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-groups-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const lib = await Library.open(path.join(base, 'lib'));
  const source = path.join(base, 'scene.png');
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHlcAAAAASUVORK5CYII=', 'base64');
  await fs.writeFile(source, bytes);
  const a = (await lib.importPaths([source], { mode: 'image' })).assets[0];
  const b = await lib.duplicateAsset(a.id), c = await lib.duplicateAsset(a.id);
  return { lib, a, b, c, source, bytes };
}
test('scene groups persist metadata, preserve bytes, rename and dissolve undoably', async t => {
  const { lib, a, b, source, bytes } = await fixture(t);
  const group = await lib.createSceneGroup('  客厅  ', [a.id, b.id]);
  assert.equal(group.name, '客厅'); assert.equal(group.coverAssetId, a.id);
  assert.deepEqual((await Library.open(lib.root)).snapshot().sceneGroups, [group]);
  await lib.updateSceneGroup(group.id, { name: '大厅', assetIds: [b.id, a.id], coverAssetId: b.id });
  assert.equal(lib.snapshot().sceneGroups[0].name, '大厅');
  await lib.undo(); assert.deepEqual(lib.snapshot().sceneGroups, [group]);
  await lib.deleteSceneGroup(group.id); assert.deepEqual(lib.snapshot().sceneGroups, []);
  assert.equal(lib.snapshot().assets.length, 3);
  await lib.undo(); assert.deepEqual(lib.snapshot().sceneGroups, [group]);
  for (const file of [source, lib.assetPath(a.id), lib.assetPath(b.id)]) assert.deepEqual(await fs.readFile(file), bytes);
});
test('reject invalid members, duplicate memberships, bad patches and cover without index mutation', async t => {
  const { lib, a, b, c } = await fixture(t);
  for (const ids of [[a.id], [a.id, a.id], [a.id, 'missing']]) await assert.rejects(lib.createSceneGroup('组', ids));
  const group = await lib.createSceneGroup('组', [a.id, b.id]);
  const before = await fs.readFile(path.join(lib.root, 'library.json'));
  for (const patch of [{ coverAssetId: c.id }, { name: ' ' }, { assetIds: [] }, { unknown: 1 }]) await assert.rejects(lib.updateSceneGroup(group.id, patch));
  await assert.rejects(lib.createSceneGroup('其他组', [b.id, c.id]), /组合/);
  assert.deepEqual(await fs.readFile(path.join(lib.root, 'library.json')), before);
  const file = path.join(path.dirname(lib.root), 'not-image.wav'); await fs.writeFile(file, 'audio');
  const audio = (await lib.importPaths([file], { mode: 'audio' })).assets[0];
  await assert.rejects(lib.createSceneGroup('错误', [audio.id, c.id]), /图片/);
});
test('removing members leaves single image groups, removes empty groups, undo restores consistently', async t => {
  const { lib, a, b } = await fixture(t);
  const group = await lib.createSceneGroup('场景', [a.id, b.id]);
  await lib.removeAssets([a.id]);
  assert.deepEqual(lib.snapshot().sceneGroups[0].assetIds, [b.id]); assert.equal(lib.snapshot().sceneGroups[0].coverAssetId, b.id);
  await lib.removeAssets([b.id]); assert.deepEqual(lib.snapshot().sceneGroups, []);
  await lib.undo(); assert.deepEqual(lib.snapshot().sceneGroups[0].assetIds, [b.id]);
  await lib.undo(); assert.deepEqual(lib.snapshot().sceneGroups, [group]);
});
test('legacy library without groups opens and malformed group metadata fails closed', async t => {
  const { lib, a } = await fixture(t), file = path.join(lib.root, 'library.json');
  const saved = JSON.parse(await fs.readFile(file)); delete saved.sceneGroups; await fs.writeFile(file, JSON.stringify(saved));
  assert.deepEqual((await Library.open(lib.root)).snapshot().sceneGroups, []);
  for (const groups of [{}, [{ id: 'g', name: 'x', assetIds: [a.id, a.id], coverAssetId: a.id }]]) {
    await fs.writeFile(file, JSON.stringify({ ...saved, sceneGroups: groups })); await assert.rejects(Library.open(lib.root), /组合/);
  }
});
test('undo after removal and reimport remaps group members and earlier cover history to the surviving image identity', async t => {
  const { lib, a, b, source } = await fixture(t);
  const group = await lib.createSceneGroup('重导入组合', [a.id, b.id]);
  await lib.updateSceneGroup(group.id, { coverAssetId: b.id });
  await lib.removeAssets([a.id]);
  const current = (await lib.importPaths([source], { mode: 'image' })).assets[0];
  assert.notEqual(current.id, a.id);
  await lib.undo();
  let reopened = await Library.open(lib.root), restored = reopened.snapshot().sceneGroups[0];
  assert.deepEqual(restored.assetIds, [current.id, b.id]); assert.equal(restored.coverAssetId, b.id);
  await reopened.undo();
  restored = reopened.snapshot().sceneGroups[0];
  assert.equal(restored.coverAssetId, current.id); assert.deepEqual(restored.assetIds, [current.id, b.id]);
  assert.equal(reopened.snapshot().assets.filter(item => item.id === current.id).length, 1);
});
