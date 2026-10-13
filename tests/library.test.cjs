/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Library, filterAssets, findSidecar, categoryDescendantIds, isLiked, LIKE_DURATION_MS } = require('../core/library.cjs');

test('preferred same-name previews replace an existing generated preview on reimport', async t => {
  const { sources, library } = await fixture(t);
  const source = path.join(sources, 'weapon.fla');
  const sidecar = path.join(sources, 'weapon.png');
  await fs.writeFile(source, 'weapon-a');
  const added = await library.importPaths([source]);
  const asset = added.assets[0];
  await library.setPreview(asset.id, { previewPath: 'previews/generated.png', previewStatus: 'ready', previewOrigin: 'rendered' });
  await fs.writeFile(sidecar, 'preview-v1');
  const imported = await library.importPaths([source], { preferExistingPreview: true });
  assert.equal(imported.added, 0);
  assert.equal(imported.duplicates, 1);
  assert.equal(library.getAsset(asset.id).previewOrigin, 'sidecar');
  assert.equal(await fs.readFile(library.previewPath(asset.id), 'utf8'), 'preview-v1');
  const revision = library.getAsset(asset.id).previewRevision;
  await fs.writeFile(sidecar, 'preview-v2');
  await library.importPaths([source], { preferExistingPreview: true });
  assert.equal(await fs.readFile(library.previewPath(asset.id), 'utf8'), 'preview-v2');
  assert.notEqual(library.getAsset(asset.id).previewRevision, revision);
});

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-library-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const sources = path.join(base, 'originals');
  await fs.mkdir(sources);
  const root = path.join(base, 'library');
  return { base, sources, root, library: await Library.open(root) };
}

test('recursively imports FLAs without changing originals and deduplicates bytes', async (t) => {
  const { sources, root, library } = await fixture(t);
  await fs.mkdir(path.join(sources, 'nested'));
  const first = path.join(sources, '剑.fla');
  const second = path.join(sources, 'nested', '剑.FLA');
  const third = path.join(sources, '同内容.fla');
  await fs.writeFile(first, 'weapon-a');
  await fs.writeFile(second, 'weapon-b');
  await fs.writeFile(third, 'weapon-a');
  await fs.writeFile(path.join(sources, 'ignored.txt'), 'not an asset');
  const before = await fs.stat(first);
  const result = await library.importPaths([sources]);
  assert.equal(result.added, 2);
  assert.equal(result.duplicates, 1);
  assert.deepEqual(result.failed, []);
  const snapshot = library.snapshot();
  assert.equal(snapshot.assets.length, 2);
  assert.deepEqual(snapshot.categories.map((c) => c.name), ['武器', '人物', '背景', '特效', '道具']);
  const deduplicated = snapshot.assets.find((a) => a.sourcePaths.length === 2);
  assert.equal(deduplicated.hash.length, 64);
  assert.equal(deduplicated.previewStatus, 'pending');
  assert.equal(path.isAbsolute(deduplicated.managedPath), false);
  assert.equal(await fs.readFile(library.assetPath(deduplicated.id), 'utf8'), 'weapon-a');
  assert.equal(await fs.readFile(first, 'utf8'), 'weapon-a');
  assert.equal((await fs.stat(first)).mtimeMs, before.mtimeMs);
  assert.equal((await Library.open(root)).snapshot().assets.length, 2);
  snapshot.assets[0].tags.push('tampered');
  assert.deepEqual(library.snapshot().assets[0].tags, []);
});

test('uses same-stem previews case-insensitively and force-render resets duplicates', async (t) => {
  const { sources, library } = await fixture(t);
  const source = path.join(sources, 'hero.fla');
  const sidecar = path.join(sources, 'HERO.PNG');
  await fs.writeFile(source, 'hero');
  await fs.writeFile(sidecar, Buffer.from('89504e470d0a1a0a', 'hex'));
  assert.equal(await findSidecar(source), sidecar);
  const result = await library.importPaths([source], { preferExistingPreview: true });
  const asset = result.assets[0];
  assert.equal(asset.previewStatus, 'ready');
  assert.equal(asset.previewOrigin, 'sidecar');
  assert.deepEqual(await fs.readFile(library.previewPath(asset.id)), await fs.readFile(sidecar));
  const forced = await library.importPaths([source], { preferExistingPreview: false });
  assert.equal(forced.added, 0);
  assert.equal(forced.duplicates, 1);
  assert.equal(forced.assets[0].previewStatus, 'pending');
  assert.equal(forced.assets[0].previewPath, null);
  assert.equal(forced.assets[0].previewOrigin, null);
});

test('a failed input does not stop other imports and oversized previews are rejected', async (t) => {
  const { sources, library } = await fixture(t);
  const good = path.join(sources, 'good.fla');
  const big = path.join(sources, 'big.fla');
  await fs.writeFile(good, 'good');
  await fs.writeFile(big, 'big');
  const image = await fs.open(path.join(sources, 'big.png'), 'w');
  await image.truncate(50 * 1024 * 1024 + 1);
  await image.close();
  const result = await library.importPaths([path.join(sources, 'missing.fla'), good, big]);
  assert.equal(result.added, 1);
  assert.equal(result.failed.length, 2);
  assert.match(result.failed.find((f) => f.path === big).error, /50/);
  assert.equal(library.snapshot().assets[0].name, 'good');
});

test('multi-asset categories update immediately and undo survives reopening', async (t) => {
  const { sources, root, library } = await fixture(t);
  await fs.writeFile(path.join(sources, 'a.fla'), 'a');
  await fs.writeFile(path.join(sources, 'b.fla'), 'b');
  const { assets } = await library.importPaths([sources]);
  const category = await library.createCategory('  战斗  ');
  assert.equal(category.name, '战斗');
  await library.assignCategory(assets.map((a) => a.id), category.id);
  assert.ok(library.snapshot().assets.every((a) => a.categoryId === category.id));
  const reopened = await Library.open(root);
  assert.equal(await reopened.undo(), true);
  assert.ok(reopened.snapshot().assets.every((a) => a.categoryId === null));
  assert.ok((await Library.open(root)).snapshot().assets.every((a) => a.categoryId === null));
});

test('category edits and removal preserve files and are reversible', async (t) => {
  const { sources, library } = await fixture(t);
  const source = path.join(sources, 'a.fla');
  await fs.writeFile(source, 'a');
  const asset = (await library.importPaths([source])).assets[0];
  const category = await library.createCategory('测试');
  await library.renameCategory(category.id, '测试二');
  assert.equal(library.snapshot().categories.find((c) => c.id === category.id).name, '测试二');
  await library.assignCategory([asset.id], category.id);
  await library.deleteCategory(category.id);
  assert.equal(library.getAsset(asset.id).categoryId, null);
  await library.undo();
  assert.equal(library.getAsset(asset.id).categoryId, category.id);
  const managed = library.assetPath(asset.id);
  await library.removeAssets([asset.id]);
  assert.equal(library.getAsset(asset.id), null);
  assert.equal(await fs.readFile(source, 'utf8'), 'a');
  assert.equal(await fs.readFile(managed, 'utf8'), 'a');
  await library.undo();
  assert.equal(library.getAsset(asset.id).id, asset.id);
});

test('search combines categories, favorites, tags and sorting without mutating input', () => {
  const assets = [
    { id: '1', name: '长剑', tags: ['红色', '武器'], categoryId: 'weapons', favorite: true, createdAt: '2024-01-01' },
    { id: '2', name: '法杖', tags: ['红色'], categoryId: 'weapons', favorite: false, createdAt: '2025-01-01' },
    { id: '3', name: '人物', tags: ['红色'], categoryId: null, favorite: true, createdAt: '2026-01-01' },
  ];
  assert.deepEqual(filterAssets(assets, { query: '红色', categoryId: 'weapons', favorites: true }).map((a) => a.id), ['1']);
  assert.deepEqual(filterAssets(assets, { categoryId: 'uncategorized' }).map((a) => a.id), ['3']);
  assert.deepEqual(filterAssets(assets, { query: '法杖 红色' }).map((a) => a.id), ['2']);
  assert.deepEqual(filterAssets(assets, { sort: 'oldest' }).map((a) => a.id), ['1', '2', '3']);
  assert.deepEqual(assets.map((a) => a.id), ['1', '2', '3']);
});

test('validates metadata mutations and keeps preview completion across category undo', async (t) => {
  const { sources, library } = await fixture(t);
  const source = path.join(sources, 'a.fla');
  await fs.writeFile(source, 'a');
  const asset = (await library.importPaths([source])).assets[0];
  await library.updateAsset(asset.id, { name: '新名字', tags: ['a', ' a ', 'b'], favorite: true });
  assert.deepEqual(library.getAsset(asset.id).tags, ['a', 'b']);
  const category = library.snapshot().categories[0];
  await library.assignCategory([asset.id], category.id);
  await library.setPreview(asset.id, { previewStatus: 'ready', previewPath: 'previews/a.png', width: 80, height: 100, frames: 1, previewOrigin: 'rendered' });
  await library.undo();
  assert.equal(library.getAsset(asset.id).categoryId, null);
  assert.equal(library.getAsset(asset.id).previewStatus, 'ready');
  assert.equal(library.getAsset(asset.id).width, 80);
  await assert.rejects(library.assignCategory([asset.id], 'missing'), /分类|category/i);
  await assert.rejects(library.updateAsset(asset.id, { managedPath: '../outside.fla' }), /字段|patch|immutable/i);
  await assert.rejects(library.setPreview(asset.id, { previewPath: '../outside.png' }), /路径|path/i);
});

test('concurrent metadata operations persist without losing updates', async (t) => {
  const { sources, root, library } = await fixture(t);
  await fs.writeFile(path.join(sources, 'a.fla'), 'a');
  const asset = (await library.importPaths([sources])).assets[0];
  await Promise.all([library.updateAsset(asset.id, { favorite: true }), library.updateAsset(asset.id, { tags: ['标签'] })]);
  const reopened = await Library.open(root);
  assert.equal(reopened.getAsset(asset.id).favorite, true);
  assert.deepEqual(reopened.getAsset(asset.id).tags, ['标签']);
  assert.equal((await fs.readdir(root)).some((f) => f.endsWith('.tmp')), false);
});

test('a duplicate imported from another location can supply a missing preview', async (t) => {
  const { sources, root, library } = await fixture(t);
  const original = path.join(sources, 'first.fla');
  const second = path.join(sources, 'second.fla');
  await fs.writeFile(original, 'same bytes');
  await fs.writeFile(second, 'same bytes');
  await fs.writeFile(path.join(sources, 'second.webp'), 'preview bytes');
  const initial = (await library.importPaths([original])).assets[0];
  assert.equal(initial.previewStatus, 'pending');
  const duplicate = await library.importPaths([second]);
  assert.equal(duplicate.added, 0);
  assert.equal(duplicate.duplicates, 1);
  assert.equal(duplicate.assets[0].id, initial.id);
  assert.equal(duplicate.assets[0].previewStatus, 'ready');
  assert.deepEqual((await Library.open(root)).getAsset(initial.id).sourcePaths, [original, second]);
});

test('invalid batch assignment rolls back completely and the queue remains usable', async (t) => {
  const { sources, root, library } = await fixture(t);
  await fs.writeFile(path.join(sources, 'a.fla'), 'a');
  const asset = (await library.importPaths([sources])).assets[0];
  const category = library.snapshot().categories[0];
  await assert.rejects(library.assignCategory([asset.id, 'missing'], category.id), /素材不存在/);
  assert.equal(library.getAsset(asset.id).categoryId, null);
  await assert.rejects(library.createCategory('   '), /名称/);
  await assert.rejects(library.createCategory(category.name), /已存在/);
  await library.updateAsset(asset.id, { favorite: true });
  assert.equal((await Library.open(root)).getAsset(asset.id).favorite, true);
});

test('invalid or escaping persisted metadata is rejected without overwriting it', async (t) => {
  const { root, sources, library } = await fixture(t);
  await fs.writeFile(path.join(sources, 'a.fla'), 'a');
  await library.importPaths([sources]);
  const metadata = path.join(root, 'library.json');
  const state = JSON.parse(await fs.readFile(metadata, 'utf8'));
  state.assets[0].managedPath = '../originals/a.fla';
  const escaping = JSON.stringify(state);
  await fs.writeFile(metadata, escaping);
  await assert.rejects(Library.open(root), /路径/);
  assert.equal(await fs.readFile(metadata, 'utf8'), escaping);
  await fs.writeFile(metadata, '{');
  await assert.rejects(Library.open(root), SyntaxError);
  assert.equal(await fs.readFile(metadata, 'utf8'), '{');
});

test('undoing category deletion restores its position in the category list', async (t) => {
  const { library } = await fixture(t);
  const before = library.snapshot().categories;
  await library.deleteCategory(before[1].id);
  await library.undo();
  assert.deepEqual(library.snapshot().categories, before);
});

test('undoing removal of several assets restores their original order', async (t) => {
  const { sources, library } = await fixture(t);
  for (const name of ['a', 'b', 'c', 'd']) await fs.writeFile(path.join(sources, `${name}.fla`), name);
  await library.importPaths([sources]);
  const before = library.snapshot().assets;
  await library.removeAssets(before.slice(0, 2).map((asset) => asset.id));
  await library.undo();
  assert.deepEqual(library.snapshot().assets, before);
});

test('nested categories permit matching names in separate parents and reject cycles atomically', async (t) => {
  const { root, library } = await fixture(t);
  const left = await library.createCategory('左侧');
  const right = await library.createCategory('右侧');
  const child = await library.createCategory('表情', left.id);
  const matching = await library.createCategory('表情', right.id);
  const grandchild = await library.createCategory('开心', child.id);
  assert.equal(left.parentId, null);
  assert.equal(child.parentId, left.id);
  assert.equal(matching.parentId, right.id);
  await assert.rejects(library.createCategory(' 表情 ', left.id), /已存在/);
  await assert.rejects(library.createCategory('孤儿', 'missing'), /分类不存在/);
  const before = library.snapshot();
  await assert.rejects(library.renameCategory(left.id, '左侧二', grandchild.id), /循环|自身|子分类/);
  await assert.rejects(library.renameCategory(child.id, '表情', child.id), /循环|自身|子分类/);
  await assert.rejects(library.renameCategory(child.id, '表情', right.id), /已存在/);
  await assert.rejects(library.renameCategory(child.id, '表情', 'missing'), /分类不存在/);
  assert.deepEqual(library.snapshot(), before);
  await library.renameCategory(child.id, '表情二');
  assert.equal(library.snapshot().categories.find(c => c.id === child.id).parentId, left.id);
  await library.renameCategory(child.id, '表情二', right.id);
  const reopened = await Library.open(root);
  assert.equal(reopened.snapshot().categories.find(c => c.id === child.id).parentId, right.id);
  await reopened.undo();
  assert.equal(reopened.snapshot().categories.find(c => c.id === child.id).parentId, left.id);
  await reopened.renameCategory(child.id, '表情二', null);
  assert.equal((await Library.open(root)).snapshot().categories.find(c => c.id === child.id).parentId, null);
});

test('deleting a category promotes children, resolves sibling names, and undo survives reopening', async (t) => {
  const { sources, root, library } = await fixture(t);
  await fs.writeFile(path.join(sources, 'direct.fla'), 'direct');
  await fs.writeFile(path.join(sources, 'child.fla'), 'child');
  const { assets } = await library.importPaths([sources]);
  const parent = await library.createCategory('课程');
  const removed = await library.createCategory('文件夹', parent.id);
  const sibling = await library.createCategory('表情', parent.id);
  await library.createCategory('表情（2）', parent.id);
  const child = await library.createCategory('表情', removed.id);
  const grandchild = await library.createCategory('开心', child.id);
  const directAsset = assets.find(a => a.name === 'direct');
  const childAsset = assets.find(a => a.name === 'child');
  await library.assignCategory([directAsset.id], removed.id);
  await library.assignCategory([childAsset.id], child.id);
  const before = library.snapshot();
  const original = await fs.readFile(path.join(sources, 'direct.fla'));
  await library.deleteCategory(removed.id);
  const deleted = library.snapshot();
  assert.equal(deleted.categories.some(c => c.id === removed.id), false);
  assert.equal(deleted.categories.find(c => c.id === child.id).parentId, parent.id);
  assert.equal(deleted.categories.find(c => c.id === child.id).name, '表情（3）');
  assert.equal(deleted.categories.find(c => c.id === sibling.id).name, '表情');
  assert.equal(deleted.categories.find(c => c.id === grandchild.id).parentId, child.id);
  assert.equal(library.getAsset(directAsset.id).categoryId, null);
  assert.equal(library.getAsset(childAsset.id).categoryId, child.id);
  assert.deepEqual(await fs.readFile(path.join(sources, 'direct.fla')), original);
  assert.equal(await fs.readFile(library.assetPath(directAsset.id), 'utf8'), 'direct');
  const reopened = await Library.open(root);
  await reopened.undo();
  assert.deepEqual(reopened.snapshot(), before);
  assert.deepEqual((await Library.open(root)).snapshot(), before);
});

test('flat version-one libraries and their old undo records reopen as root categories', async (t) => {
  const { sources, root, library } = await fixture(t);
  await fs.writeFile(path.join(sources, 'legacy.fla'), 'legacy');
  const asset = (await library.importPaths([sources])).assets[0];
  const category = await library.createCategory('旧分类');
  await library.assignCategory([asset.id], category.id);
  await library.deleteCategory(category.id);
  const metadata = path.join(root, 'library.json');
  const legacy = JSON.parse(await fs.readFile(metadata, 'utf8'));
  for (const category of legacy.categories) delete category.parentId;
  for (const asset of legacy.assets) delete asset.likedAt;
  for (const changes of legacy.history) for (const change of changes) {
    if (change.collection === 'categories' && change.before) delete change.before.parentId;
    if (change.collection === 'categories' && change.after) delete change.after.parentId;
  }
  await fs.writeFile(metadata, JSON.stringify(legacy));
  const reopened = await Library.open(root);
  assert.ok(reopened.snapshot().categories.every(c => c.parentId === null));
  await reopened.undo();
  assert.equal(reopened.snapshot().categories.find(c => c.id === category.id).parentId, null);
  assert.equal(reopened.getAsset(asset.id).categoryId, category.id);
  assert.equal((await Library.open(root)).snapshot().categories.find(c => c.id === category.id).parentId, null);
});

test('descendant classification includes grandchildren without changing the input', () => {
  const categories = [
    { id: 'root', name: '课程', parentId: null },
    { id: 'child', name: '表情', parentId: 'root' },
    { id: 'grandchild', name: '开心', parentId: 'child' },
    { id: 'other', name: '其他', parentId: null },
  ];
  const assets = [
    { id: '1', name: 'a', categoryId: 'root', createdAt: '2024-01-01' },
    { id: '2', name: 'b', categoryId: 'grandchild', createdAt: '2024-01-02' },
    { id: '3', name: 'c', categoryId: 'other', createdAt: '2024-01-03' },
  ];
  const before = structuredClone({ categories, assets });
  assert.deepEqual(categoryDescendantIds(categories, 'root'), ['root', 'child', 'grandchild']);
  assert.deepEqual(categoryDescendantIds(categories, 'missing'), []);
  assert.deepEqual(filterAssets(assets, { categoryId: 'root', categories }).map(a => a.id), ['2', '1']);
  assert.deepEqual(filterAssets(assets, { categoryId: 'root' }).map(a => a.id), ['1']);
  assert.deepEqual({ categories, assets }, before);
});

test('likes expire at 24 hours without removing files or losing their timestamp after reopening', async (t) => {
  const { sources, root, library } = await fixture(t);
  const source = path.join(sources, 'liked.fla');
  await fs.writeFile(source, 'liked original');
  const asset = (await library.importPaths([source])).assets[0];
  let now = Date.parse('2026-10-13T02:00:00.000Z');
  t.mock.method(Date, 'now', () => now);
  assert.equal(library.getAsset(asset.id).liked, false);
  assert.equal(library.getAsset(asset.id).likedAt, null);
  const liked = await library.updateAsset(asset.id, { liked: true });
  assert.equal(liked.liked, true);
  assert.equal(liked.likedAt, '2026-10-13T02:00:00.000Z');
  assert.equal((await Library.open(root)).getAsset(asset.id).liked, true);
  now += 86_399_999;
  assert.equal(library.snapshot().assets[0].liked, true);
  now += 1;
  const expired = library.snapshot().assets[0];
  assert.equal(expired.liked, false);
  assert.equal(expired.likedAt, liked.likedAt);
  const reopened = await Library.open(root);
  assert.equal(reopened.getAsset(asset.id).liked, false);
  assert.equal(reopened.getAsset(asset.id).likedAt, liked.likedAt);
  assert.equal(await fs.readFile(source, 'utf8'), 'liked original');
  assert.equal(await fs.readFile(reopened.assetPath(asset.id), 'utf8'), 'liked original');
  assert.equal(reopened.snapshot().assets.length, 1);
  const renewed = await reopened.toggleLike(asset.id);
  assert.equal(renewed.liked, true);
  assert.equal(renewed.likedAt, '2026-10-14T02:00:00.000Z');
  await reopened.undo();
  assert.equal(reopened.getAsset(asset.id).liked, false);
  assert.equal(reopened.getAsset(asset.id).likedAt, liked.likedAt);
});

test('like toggles, unlikes and their undo persist without altering favorite state', async (t) => {
  const { sources, root, library } = await fixture(t);
  await fs.writeFile(path.join(sources, 'a.fla'), 'a');
  const asset = (await library.importPaths([sources])).assets[0];
  let now = Date.parse('2026-10-13T02:00:00.000Z');
  t.mock.method(Date, 'now', () => now);
  await library.updateAsset(asset.id, { favorite: true });
  const liked = await library.toggleLike(asset.id);
  assert.equal(liked.liked, true);
  assert.equal(liked.favorite, true);
  now += 1_000;
  const unchanged = await library.updateAsset(asset.id, { liked: true });
  assert.equal(unchanged.likedAt, liked.likedAt);
  assert.equal((await library.toggleLike(asset.id)).likedAt, null);
  const reopened = await Library.open(root);
  await reopened.undo();
  assert.equal(reopened.getAsset(asset.id).likedAt, liked.likedAt);
  assert.equal(reopened.getAsset(asset.id).liked, true);
  await reopened.updateAsset(asset.id, { liked: false });
  assert.equal((await Library.open(root)).getAsset(asset.id).likedAt, null);
  const before = reopened.snapshot();
  await assert.rejects(reopened.updateAsset(asset.id, { liked: 'yes' }), /点赞|布尔/);
  await assert.rejects(reopened.updateAsset(asset.id, { likedAt: '2020-01-01' }), /字段/);
  await assert.rejects(reopened.toggleLike('missing'), /素材不存在/);
  assert.deepEqual(reopened.snapshot(), before);
  now += 86_400_000;
  const renewed = await reopened.toggleLike(asset.id);
  assert.equal(renewed.likedAt, '2026-10-14T02:00:01.000Z');
  assert.equal(renewed.liked, true);
});

test('legacy assets expose unliked defaults and like expiry filters combine with descendants and favorites', async (t) => {
  const { root, sources, library } = await fixture(t);
  await fs.writeFile(path.join(sources, 'legacy.fla'), 'legacy');
  const asset = (await library.importPaths([sources])).assets[0];
  const metadata = path.join(root, 'library.json');
  const legacy = JSON.parse(await fs.readFile(metadata, 'utf8'));
  delete legacy.assets[0].likedAt;
  await fs.writeFile(metadata, JSON.stringify(legacy));
  const reopened = await Library.open(root);
  assert.equal(reopened.snapshot().assets[0].liked, false);
  assert.equal(reopened.getAsset(asset.id).likedAt, null);
  await reopened.updateAsset(asset.id, { liked: true });
  const afterFirstLike = await Library.open(root);
  assert.equal(afterFirstLike.getAsset(asset.id).liked, true);
  await afterFirstLike.undo();
  assert.equal(afterFirstLike.getAsset(asset.id).liked, false);
  assert.equal((await Library.open(root)).getAsset(asset.id).likedAt, null);
  const now = Date.parse('2026-10-14T02:00:00.000Z');
  const categories = [{ id: 'root', parentId: null }, { id: 'child', parentId: 'root' }];
  const assets = [
    { id: 'fresh', name: '新表情', categoryId: 'child', favorite: true, likedAt: '2026-10-13T02:00:00.001Z', createdAt: '2026-10-13' },
    { id: 'expired', name: '旧表情', categoryId: 'child', favorite: true, likedAt: '2026-10-13T02:00:00.000Z', createdAt: '2026-10-12' },
    { id: 'other', name: '新背景', categoryId: null, favorite: false, likedAt: '2026-10-14T01:00:00.000Z', createdAt: '2026-10-14' },
  ];
  assert.equal(LIKE_DURATION_MS, 86_400_000);
  assert.equal(isLiked(assets[0], now), true);
  assert.equal(isLiked(assets[1], now), false);
  assert.equal(isLiked({ likedAt: 'invalid' }, now), false);
  assert.equal(isLiked({ likedAt: '2026-10-14T03:00:00.000Z' }, now), false);
  const before = structuredClone(assets);
  assert.deepEqual(filterAssets(assets, { likes: true, now }).map(a => a.id), ['other', 'fresh']);
  assert.deepEqual(filterAssets(assets, { likes: true, now, favorites: true, categories, categoryId: 'root', query: '表情' }).map(a => a.id), ['fresh']);
  assert.deepEqual(assets, before);
});
