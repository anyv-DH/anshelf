/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { createHost } = require('../desktop/host.cjs');
const { createDocumentImportReceiver } = require('../desktop/document-import.cjs');
const { atomicJson } = require('../core/files.cjs');

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-current-options-'));
  const file = path.join(base, '当前特效.fla');
  await fs.writeFile(file, 'current document bytes');
  const host = await createHost({ root: path.join(base, 'library'), render: async () => ({ previewPath: null }) });
  const receiver = await createDocumentImportReceiver({ root: host.root, importDocument: host.importCurrentDocument });
  t.after(async () => { await receiver.close(); await host.queue.idle(); await fs.rm(base, { recursive: true, force: true }); });
  async function request(options) {
    const id = randomUUID();
    await atomicJson(path.join(host.root, 'bridge/document-import/inbox', id + '.json'), { version: 1, requestId: id, file, createdAt: Date.now(), options });
    await receiver.drain();
    return JSON.parse(await fs.readFile(path.join(host.root, 'bridge/document-import/results', id + '.json'), 'utf8'));
  }
  return { base, file, host, request };
}

test('AN import request applies selected effect type, category and 2K preview before rendering', async t => {
  const { host, request } = await fixture(t);
  const category = await host.api.createCategory('火焰', null, 'effect');
  const result = await request({ mode: 'effect', categoryId: category.id, previewResolution: 2048, preferExistingPreview: false });
  assert.equal(result.ok, true, result.error);
  const asset = host.library.getAsset(result.assetId);
  assert.equal(asset.assetType, 'effect');
  assert.equal(asset.previewResolution, 2048);
  assert.deepEqual(asset.categoryIds, [category.id]);
  assert.equal(host.library.snapshot().assets.length, 1);
});

test('invalid quick-import options and wrong-scope categories cannot add any material', async t => {
  const { host, request } = await fixture(t);
  const audioCategory = await host.api.createCategory('音乐', null, 'audio');
  for (const options of [null, [], { mode: 'audio' }, { previewResolution: 4096 }, { categoryId: 42 }, { preferExistingPreview: 'yes' }, { command: 'anything' }, { mode: 'effect', categoryId: audioCategory.id }]) {
    const result = await request(options);
    assert.equal(result.ok, false, JSON.stringify(options));
    assert.equal(host.library.snapshot().assets.length, 0);
  }
});

test('AN settings update an already-managed independent copy without duplicating or resetting other memberships', async t => {
  const { host, file } = await fixture(t);
  const first = (await host.api.importPaths([file])).assets[0];
  const category = await host.api.createCategory('旧分类');
  const secondCategory = await host.api.createCategory('新分类');
  await host.api.assignCategory([first.id], category.id);
  const copy = await host.library.duplicateAsset(first.id);
  const result = await host.importCurrentDocument(host.library.assetPath(copy.id), { mode: 'effect', previewResolution: 1024, categoryId: secondCategory.id });
  assert.equal(result.assetId, copy.id);
  assert.equal(host.library.snapshot().assets.length, 2);
  const after = host.library.getAsset(copy.id);
  assert.equal(after.assetType, 'effect');
  assert.equal(after.previewResolution, 1024);
  assert.deepEqual(after.categoryIds, [category.id, secondCategory.id]);
  assert.equal(host.library.getAsset(first.id).assetType, 'ordinary');
});
