/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { Queue } = require('../plugin/queue.cjs');

async function fixture(t, importDocument) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-document-import-'));
  const file = path.join(root, '当前作品.fla');
  await fs.writeFile(file, 'saved FLA');
  const { createDocumentImportReceiver } = require('../desktop/document-import.cjs');
  const receiver = await createDocumentImportReceiver({ root, importDocument });
  t.after(async () => { await receiver.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, file, receiver, queue: new Queue(root) };
}

test('AN current-document request is consumed once, acknowledged, and leaves original bytes intact', async t => {
  const calls = [];
  const f = await fixture(t, async file => { calls.push(file); return { assetId: 'new', name: '当前作品', reused: false }; });
  const request = f.queue.requestDocumentImport(f.file);
  await f.receiver.drain();
  const result = f.queue.documentImportResult(request.requestId);
  assert.equal(result.ok, true);
  assert.equal(result.assetId, 'new');
  assert.equal(result.name, '当前作品');
  assert.deepEqual(calls, [f.file]);
  assert.equal(await fs.readFile(f.file, 'utf8'), 'saved FLA');
  assert.deepEqual(await fs.readdir(path.join(f.root, 'bridge/document-import/inbox')), []);
  await f.receiver.drain();
  assert.equal(calls.length, 1);
  f.queue.clearDocumentImport(request.requestId);
  assert.equal(f.queue.documentImportResult(request.requestId), null);
});

test('receiver watches new descriptors and processes them serially without a polling timer', async t => {
  let active = 0, peak = 0;
  const f = await fixture(t, async () => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 12));
    active--;
    return { assetId: 'saved', name: '当前作品' };
  });
  const first = f.queue.requestDocumentImport(f.file);
  const second = f.queue.requestDocumentImport(f.file);
  const deadline = Date.now() + 1500;
  while ((!f.queue.documentImportResult(first.requestId) || !f.queue.documentImportResult(second.requestId)) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(f.queue.documentImportResult(first.requestId).ok, true);
  assert.equal(f.queue.documentImportResult(second.requestId).ok, true);
  assert.equal(peak, 1);
});

test('receiver handles startup backlog once and preserves an existing completion receipt', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-document-startup-'));
  const file = path.join(root, '已保存.fla');
  await fs.writeFile(file, 'current');
  const queue = new Queue(root);
  const request = queue.requestDocumentImport(file);
  const { createDocumentImportReceiver } = require('../desktop/document-import.cjs');
  let count = 0;
  const create = () => createDocumentImportReceiver({ root, importDocument: async () => { count++; return { assetId: 'known', name: '已保存', updated: true, duplicate: true }; } });
  let receiver = await create();
  try {
    const receipt = queue.documentImportResult(request.requestId);
    assert.equal(receipt.ok, true);
    assert.equal(receipt.updated, true);
    assert.equal(receipt.duplicate, true);
    assert.equal(receipt.reused, true);
    await receiver.close();
    // Replay left behind by a crash between receipt and inbox cleanup.
    queue.atomic(path.join('document-import/inbox', request.requestId + '.json'), request);
    receiver = await create();
    assert.equal(count, 1);
    assert.deepEqual(queue.documentImportResult(request.requestId), receipt);
  } finally { await receiver.close(); await fs.rm(root, { recursive: true, force: true }); }
});

test('invalid, oversized, stale and linked document requests never reach the importer', async t => {
  let calls = 0;
  const f = await fixture(t, async () => { calls++; return { assetId: 'unexpected' }; });
  const inbox = path.join(f.root, 'bridge/document-import/inbox');
  const bad = [
    { version: 2, file: f.file },
    { file: path.dirname(f.file) },
    { file: path.join(f.root, 'test.txt') },
    { file: f.file, createdAt: Date.now() - 300000 },
    { file: f.file, code: 'anything' },
  ];
  for (let i = 0; i < bad.length; i++) {
    const id = 'bad-' + i;
    await fs.writeFile(path.join(inbox, id + '.json'), JSON.stringify({ version: 1, requestId: id, file: f.file, createdAt: Date.now(), ...bad[i] }));
  }
  await fs.writeFile(path.join(inbox, 'too-big.json'), ' '.repeat(20000));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-document-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.writeFile(path.join(outside, 'linked.fla'), 'outside');
  await fs.symlink(outside, path.join(f.root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await fs.writeFile(path.join(inbox, 'linked.json'), JSON.stringify({ version: 1, requestId: 'linked', file: path.join(f.root, 'linked/linked.fla'), createdAt: Date.now() }));
  await f.receiver.drain();
  assert.equal(calls, 0);
  for (const id of ['bad-0', 'bad-1', 'bad-2', 'bad-3', 'bad-4', 'too-big', 'linked']) assert.equal(f.queue.documentImportResult(id).ok, false, id);
});

test('importer failures return a readable receipt and cannot block the next request', async t => {
  let calls = 0;
  const f = await fixture(t, async () => { if (++calls === 1) throw new Error('无法导入这个素材'); return { assetId: 'second', name: '下一个' }; });
  const first = f.queue.requestDocumentImport(f.file);
  await f.receiver.drain();
  const second = f.queue.requestDocumentImport(f.file);
  await f.receiver.drain();
  assert.match(f.queue.documentImportResult(first.requestId).error, /无法导入这个素材/);
  assert.equal(f.queue.documentImportResult(second.requestId).ok, true);
});

test('a source removed after the AN request gets an immediate failure receipt instead of a timeout', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-document-missing-'));
  let receiver;
  t.after(async () => { await receiver?.close(); await fs.rm(root, { recursive: true, force: true }); });
  const file = path.join(root, '已移走的作品.fla');
  await fs.writeFile(file, 'saved document');
  const queue = new Queue(root);
  const request = queue.requestDocumentImport(file);
  await fs.unlink(file);
  const { createDocumentImportReceiver } = require('../desktop/document-import.cjs');
  let calls = 0;
  receiver = await createDocumentImportReceiver({ root, importDocument: async () => { calls++; return { assetId: 'unexpected' }; } });
  const receipt = queue.documentImportResult(request.requestId);
  assert.equal(receipt?.ok, false);
  assert.match(receipt.error, /不存在|无法读取/);
  assert.equal(calls, 0);
  assert.deepEqual(await fs.readdir(path.join(root, 'bridge/document-import/inbox')), []);
});

test('ENOENT raised inside the importer is reported and does not strand the request', async t => {
  const f = await fixture(t, async () => { throw Object.assign(new Error('missing import dependency'), { code: 'ENOENT' }); });
  const request = f.queue.requestDocumentImport(f.file);
  await f.receiver.drain();
  const receipt = f.queue.documentImportResult(request.requestId);
  assert.equal(receipt?.ok, false);
  assert.match(receipt.error, /不存在|无法读取/);
  assert.deepEqual(await fs.readdir(path.join(f.root, 'bridge/document-import/inbox')), []);
});

test('a request removed by the panel is not recreated when the importer reports ENOENT', async t => {
  let request;
  const f = await fixture(t, async () => {
    f.queue.clearDocumentImport(request.requestId);
    throw Object.assign(new Error('cancelled request'), { code: 'ENOENT' });
  });
  request = f.queue.requestDocumentImport(f.file);
  await f.receiver.drain();
  assert.equal(f.queue.documentImportResult(request.requestId), null);
  assert.deepEqual(await fs.readdir(path.join(f.root, 'bridge/document-import/inbox')), []);
});

test('closing waits for the active receipt and stops before the next queued import', async t => {
  let started, finish;
  const active = new Promise(resolve => { started = resolve; });
  const release = new Promise(resolve => { finish = resolve; });
  let calls = 0;
  const f = await fixture(t, async () => { calls++; started(); await release; return { assetId: 'saved' }; });
  const first = f.queue.requestDocumentImport(f.file);
  const second = f.queue.requestDocumentImport(f.file);
  const [processed, waiting] = [first, second].sort((a, b) => a.requestId < b.requestId ? -1 : 1);
  const draining = f.receiver.drain();
  await active;
  let closed = false;
  const closing = f.receiver.close().then(() => { closed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, false);
  finish();
  await closing;
  await draining;
  assert.equal(f.queue.documentImportResult(processed.requestId).ok, true);
  assert.equal(f.queue.documentImportResult(waiting.requestId), null);
  assert.equal(calls, 1);
  await f.receiver.drain();
  assert.equal(calls, 1);
});

test('fixed JSFL entry saves the current document and exports its path, with cancellation and no-document handling', async () => {
  const code = await fs.readFile(path.join(__dirname, '../plugin/insert-whole.jsfl'), 'utf8');
  const doc = { name: '当前作品.fla', pathURI: 'file:///C|/work/current.fla', path: 'C:\\work\\current.fla' };
  let current = doc, saves = 0, allowSave = true;
  const context = vm.createContext({ fl: { getDocumentDOM: () => current, saveDocument(value) { assert.equal(value, current); saves++; return allowSave; } }, confirm: () => true, JSON });
  vm.runInContext(code, context);
  const run = () => JSON.parse(context.AnShelfCurrentDocumentForLibrary());
  assert.equal(run().file, doc.path);
  assert.equal(saves, 1);
  current = null;
  assert.match(run().error, /打开/);
  current = { name: '未命名', pathURI: null, path: null };
  allowSave = false;
  assert.equal(run().cancelled, true);
  current = { name: '网页.xfl', pathURI: 'file:///C|/work/web.xfl', path: 'C:\\work\\web.xfl' };
  assert.match(run().error, /FLA/);
});

test('current-document confirmation cancellation returns before saving and invalid documents never prompt', async () => {
  const code = await fs.readFile(path.join(__dirname, '../plugin/insert-whole.jsfl'), 'utf8');
  let current = { name: '当前作品.fla', pathURI: 'file:///C|/work/current.fla', path: 'C:\\work\\current.fla' }, saves = 0;
  const prompts = [];
  const context = vm.createContext({ fl: { getDocumentDOM: () => current, saveDocument() { saves++; return true; } }, confirm(message) { prompts.push(message); return false; }, JSON });
  vm.runInContext(code, context);
  const run = () => JSON.parse(context.AnShelfCurrentDocumentForLibrary());
  const cancelled = run();
  assert.equal(cancelled.ok, false);
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.file, undefined);
  assert.equal(saves, 0);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /将当前文档保存并加入安安素材管理器/);
  assert.match(prompts[0], /库内文档将更新原素材/);
  current = null;
  assert.match(run().error, /打开/);
  current = { pathURI: 'file:///C|/work/unpacked.xfl' };
  assert.match(run().error, /FLA/);
  assert.equal(prompts.length, 1);
  assert.equal(saves, 0);
});

test('a themed confirmation saves only its exact AN document and never silently saves a switched document', async () => {
  const code = await fs.readFile(path.join(__dirname, '../plugin/insert-whole.jsfl'), 'utf8');
  let current = { id: 42, name: '已确认的作品.fla', pathURI: 'file:///C|/work/current.fla', path: 'C:\\work\\current.fla' }, saves = 0, prompts = 0;
  const context = vm.createContext({ fl: { getDocumentDOM: () => current, saveDocument() { saves++; return true; } }, confirm() { prompts++; return false; }, JSON });
  vm.runInContext(code, context);
  const run = id => JSON.parse(context.AnShelfCurrentDocumentForLibrary(id));
  assert.equal(run('42').ok, true);
  assert.equal(saves, 1);
  assert.equal(prompts, 0);
  current = { ...current, id: 43 };
  assert.match(run('42').error, /文档已切换/);
  assert.equal(saves, 1);
  for (const invalid of ['-1', '42junk', '', '0043']) assert.match(run(invalid).error, /文档已切换/);
  assert.equal(saves, 1);
  assert.equal(run(undefined).cancelled, true);
  assert.equal(prompts, 1);
  assert.equal(saves, 1);
});

test('plugin document-import descriptor preserves selected type, category, 2K resolution and preview reuse without changing legacy requests', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-plugin-options-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, '当前特效.fla'); await fs.writeFile(file, 'saved effect');
  const queue = new Queue(root);
  const options = { mode: 'effect', categoryId: 'effect-child', previewResolution: 2048, preferExistingPreview: false };
  const selected = queue.requestDocumentImport(file, options);
  assert.deepEqual(selected.options, options);
  assert.deepEqual(JSON.parse(await fs.readFile(queue.file(path.join('document-import/inbox', selected.requestId + '.json')), 'utf8')).options, options);
  assert.equal(Object.hasOwn(queue.requestDocumentImport(file), 'options'), false);
  const before = await fs.readdir(queue.file('document-import/inbox'));
  for (const invalid of [null, [], { mode: 'audio' }, { mode: 'ordinary', extra: true }, { previewResolution: 4096 }, { categoryId: 3 }, { preferExistingPreview: 'yes' }]) assert.throws(() => queue.requestDocumentImport(file, invalid), /选项|类型|分类|分辨率|预览/);
  assert.deepEqual(await fs.readdir(queue.file('document-import/inbox')), before);
});

test('plugin reads category choices and an existing managed effect defaults without modifying the library', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-plugin-choices-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const queue = new Queue(root), file = path.join(root, 'assets', 'material', '旋转特效.fla');
  const metadata = { version: 1, categories: [{ id: 'effect-root', name: '特效', parentId: null, scope: 'effect' }, { id: 'effect-child', name: '旋转', parentId: 'effect-root', scope: 'effect' }, { id: 'audio', name: '音频', parentId: null, scope: 'audio' }], assets: [{ id: 'material', kind: 'fla', assetType: 'effect', managedPath: path.relative(root, file), sourcePaths: [], categoryId: 'effect-child', previewResolution: 2048 }] };
  const index = path.join(root, 'library.json'); await fs.writeFile(index, JSON.stringify(metadata));
  const before = await fs.readFile(index);
  const choices = queue.documentImportSettings(file);
  assert.deepEqual(choices.categories, metadata.categories);
  assert.deepEqual(choices.defaults, { mode: 'effect', categoryId: 'effect-child', previewResolution: 2048, preferExistingPreview: true });
  assert.deepEqual(queue.documentImportSettings(null).defaults, { mode: 'ordinary', categoryId: null, previewResolution: null, preferExistingPreview: true });
  assert.deepEqual(await fs.readFile(index), before);
  await fs.writeFile(index, '{broken');
  assert.throws(() => queue.documentImportSettings(file), /分类|素材库/);
  assert.equal(await fs.readFile(index, 'utf8'), '{broken');
});

test('read-only JSFL document inspection binds document id and displays the current file before any confirmation or save', async () => {
  const code = await fs.readFile(path.join(__dirname, '../plugin/insert-whole.jsfl'), 'utf8');
  let current = { id: 42, name: '当前特效.fla', pathURI: 'file:///C|/work/current.fla', path: 'C:\\work\\current.fla' }, saves = 0, prompts = 0;
  const context = vm.createContext({ fl: { getDocumentDOM: () => current, saveDocument() { saves++; return true; } }, confirm() { prompts++; return true; }, JSON });
  vm.runInContext(code, context);
  const inspect = () => JSON.parse(context.AnShelfCurrentDocumentInfoForLibrary());
  assert.deepEqual(inspect(), { version: 1, ok: true, documentId: 42, name: current.name, file: current.path });
  current = { id: 43, name: '未命名-1', pathURI: null, path: null };
  assert.equal(inspect().file, null);
  current = null; assert.match(inspect().error, /打开/);
  assert.equal(saves, 0); assert.equal(prompts, 0);
});
