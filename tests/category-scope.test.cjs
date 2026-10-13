/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Library } = require('../core/library.cjs');
const { categoryScope, normalizeCategoryScopes, validateCategoryScopes, resolveCategoryScope, assertCategoryMoveScope } = require('../core/category-scope.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-category-scope-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const library = await Library.open(root);
  return { root, library, file: path.join(root, 'library.json') };
}

test('legacy category scopes normalize to all without changing their hierarchy', () => {
  const categories = [{ id: 'old', parentId: null }, { id: 'child', parentId: 'old' }];
  assert.equal(categoryScope(categories[0]), 'all');
  validateCategoryScopes(categories);
  normalizeCategoryScopes(categories);
  assert.deepEqual(categories, [{ id: 'old', parentId: null, scope: 'all' }, { id: 'child', parentId: 'old', scope: 'all' }]);
});

test('children inherit their parent scope and invalid requested scopes are rejected before inheritance', () => {
  const categories = [{ id: 'effects', parentId: null, scope: 'effect' }];
  assert.equal(resolveCategoryScope(categories, null, 'audio'), 'audio');
  assert.equal(resolveCategoryScope(categories, 'effects', 'ordinary'), 'effect');
  assert.equal(resolveCategoryScope(categories, 'effects'), 'effect');
  for (const invalid of [null, 1, false, '', 'video', {}, []]) {
    assert.throws(() => resolveCategoryScope(categories, 'effects', invalid), /scope|类型|范围/);
  }
  assert.throws(() => resolveCategoryScope(categories, 'missing', 'all'), /分类不存在/);
});

test('scope validation refuses corrupt scoped trees and cross-scope moves', () => {
  const categories = [{ id: 'all', parentId: null }, { id: 'effects', parentId: null, scope: 'effect' }, { id: 'audio', parentId: null, scope: 'audio' }, { id: 'child', parentId: 'effects', scope: 'effect' }];
  validateCategoryScopes(categories);
  assert.doesNotThrow(() => assertCategoryMoveScope(categories, categories[3], 'effects'));
  assert.doesNotThrow(() => assertCategoryMoveScope(categories, categories[3], null));
  assert.throws(() => assertCategoryMoveScope(categories, categories[3], 'audio'), /不同|类型|范围/);
  assert.throws(() => assertCategoryMoveScope(categories, categories[3], 'all'), /不同|类型|范围/);
  assert.throws(() => validateCategoryScopes([...categories, { id: 'bad', parentId: 'effects', scope: 'audio' }]), /类型|范围/);
  assert.throws(() => validateCategoryScopes([{ id: 'bad', parentId: null, scope: null }]), /scope|类型|范围/);
});

test('scoped roots and inherited children persist through reopen while sibling names stay unique', async t => {
  const { root, library } = await fixture(t);
  assert.ok(library.snapshot().categories.every(category => category.scope === 'all'));
  const parent = await library.createCategory('特效分类测试', null, 'effect');
  const child = await library.createCategory('冲击', parent.id, 'audio');
  const grandchild = await library.createCategory('火焰', child.id);
  assert.equal(parent.scope, 'effect');
  assert.equal(child.scope, 'effect');
  assert.equal(grandchild.scope, 'effect');
  const reopened = await Library.open(root);
  assert.equal(reopened.snapshot().categories.find(category => category.id === grandchild.id).scope, 'effect');
  await assert.rejects(reopened.createCategory(parent.name, null, 'audio'), /已存在/);
  await assert.rejects(reopened.createCategory(child.name, parent.id, 'ordinary'), /已存在/);
});

test('invalid scopes and cross-scope moves reject atomically and leave the mutation queue usable', async t => {
  const { library, file } = await fixture(t);
  const effect = await library.createCategory('特效分组', null, 'effect');
  const audio = await library.createCategory('音频分组', null, 'audio');
  const child = await library.createCategory('闪光', effect.id);
  const before = await fs.readFile(file), revision = library.revision;
  for (const scope of [null, 1, 'video', {}]) {
    await assert.rejects(library.createCategory('错误', null, scope), /scope|类型|范围/);
    await assert.rejects(library.createCategory('错误子类', effect.id, scope), /scope|类型|范围/);
  }
  await assert.rejects(library.renameCategory(child.id, '闪光二', audio.id), /不同|类型|范围/);
  assert.deepEqual(await fs.readFile(file), before);
  assert.equal(library.revision, revision);
  const peer = await library.createCategory('特效第二组', null, 'effect');
  await library.renameCategory(child.id, '闪光二', peer.id);
  assert.equal(library.snapshot().categories.find(category => category.id === child.id).scope, 'effect');
});

test('scoped classification changes category metadata without changing the asset import type or bytes', async t => {
  const { root, library } = await fixture(t);
  const originals = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-category-original-'));
  t.after(() => fs.rm(originals, { recursive: true, force: true }));
  const source = path.join(originals, 'original.fla');
  await fs.writeFile(source, 'isolated effect source');
  const asset = (await library.importPaths([source], { mode: 'effect' })).assets[0];
  const parent = await library.createCategory('普通作用域测试', null, 'ordinary');
  const child = await library.createCategory('分类', parent.id);
  await library.assignCategory([asset.id], child.id);
  await library.renameCategory(child.id, '分类二', null);
  assert.equal(library.snapshot().categories.find(category => category.id === child.id).scope, 'ordinary');
  await library.deleteCategory(child.id);
  await library.undo();
  const reopened = await Library.open(root);
  assert.equal(reopened.getAsset(asset.id).assetType, 'effect');
  assert.equal(reopened.getAsset(asset.id).categoryId, child.id);
  assert.equal(await fs.readFile(source, 'utf8'), 'isolated effect source');
  assert.equal(await fs.readFile(reopened.assetPath(asset.id), 'utf8'), 'isolated effect source');
});

test('category deletion and legacy undo preserve scopes across reopening without rewriting old files on read', async t => {
  const { root, library, file } = await fixture(t);
  const scoped = await library.createCategory('音效测试', null, 'audio');
  const child = await library.createCategory('脚步声', scoped.id);
  await library.deleteCategory(scoped.id);
  const reopened = await Library.open(root);
  assert.equal(reopened.snapshot().categories.find(category => category.id === child.id).scope, 'audio');
  await reopened.undo();
  assert.equal(reopened.snapshot().categories.find(category => category.id === child.id).parentId, scoped.id);
  assert.equal(reopened.snapshot().categories.find(category => category.id === scoped.id).scope, 'audio');
  await reopened.deleteCategory(scoped.id);
  const legacy = JSON.parse(await fs.readFile(file, 'utf8'));
  for (const category of legacy.categories) delete category.scope;
  for (const changes of legacy.history) for (const change of changes) {
    if (change.collection !== 'categories') continue;
    if (change.before) delete change.before.scope;
    if (change.after) delete change.after.scope;
    if (change.previous) delete change.previous.scope;
  }
  await fs.writeFile(file, JSON.stringify(legacy));
  const before = await fs.readFile(file);
  const old = await Library.open(root);
  assert.deepEqual(await fs.readFile(file), before);
  assert.ok(old.snapshot().categories.every(category => category.scope === 'all'));
  await old.undo();
  assert.ok(old.snapshot().categories.every(category => category.scope === 'all'));
  assert.ok((await Library.open(root)).snapshot().categories.every(category => category.scope === 'all'));
});

test('invalid persisted category scopes fail to open without touching the metadata file', async t => {
  const { root, file } = await fixture(t);
  const state = JSON.parse(await fs.readFile(file, 'utf8'));
  state.categories[0].scope = 'video';
  await fs.writeFile(file, JSON.stringify(state));
  const before = await fs.readFile(file);
  await assert.rejects(Library.open(root), /scope|类型|范围/);
  assert.deepEqual(await fs.readFile(file), before);
});
