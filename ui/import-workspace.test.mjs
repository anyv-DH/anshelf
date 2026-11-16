/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { IMPORT_TYPES, analyzeImportFiles, createImportSession, mountFileDrop } from './import-workspace.mjs';
const selection = (names, selectionId = 'selection-1') => ({ selectionId, files: names.map(name => ({ name, extension: name.split('.').at(-1) })) });

test('the unified entry offers ordinary, effect, audio and image imports', () => {
  assert.deepEqual(IMPORT_TYPES.map(type => type.mode), ['ordinary', 'effect', 'audio', 'image']);
});

test('detected mixed media keeps duplicate basenames and leaves the supplied metadata untouched', () => {
  const input = selection(['角色.FLA', '角色.FLA', '背景.png', '音乐.mp3', '说明.txt']).files;
  const before = structuredClone(input);
  const detected = analyzeImportFiles(input);
  assert.deepEqual(detected.counts, { fla: 2, audio: 1, image: 1, folder: 0 });
  assert.equal(detected.unsupported.length, 1);
  assert.equal(detected.mixed, true);
  assert.equal(detected.mode, 'ordinary');
  assert.deepEqual(input, before);
});

test('selection never imports before confirmation and submission sends only the opaque selection ID', async () => {
  const imported = [], canceled = [];
  const session = createImportSession({ api: { chooseImportFiles: async () => selection(['one.png']), importSelectedPaths: async (...args) => { imported.push(args); return { added: 1 }; }, cancelImportSelection: async id => canceled.push(id) } });
  await session.select('chooseImportFiles', { mode: 'image' });
  assert.equal(imported.length, 0);
  assert.equal(session.snapshot().selectionId, 'selection-1');
  await session.submit('image', { categoryId: 'scene' });
  assert.deepEqual(imported, [['selection-1', { categoryId: 'scene', mode: 'image' }]]);
  assert.deepEqual(session.snapshot().files, []);
  assert.deepEqual(canceled, ['selection-1']);
});

test('mixed batches share one staged selection until every detected type is handled', async () => {
  const imported = [], canceled = [];
  const session = createImportSession({ api: { importSelectedPaths: async (id, options) => { imported.push({ id, options }); return { added: 1 }; }, cancelImportSelection: async id => canceled.push(id) } });
  session.setSelection(selection(['角色.fla', '音效.wav', '背景.webp']));
  await session.submit('effect', { previewResolution: 1024 });
  assert.deepEqual(imported[0], { id: 'selection-1', options: { previewResolution: 1024, mode: 'effect' } });
  assert.deepEqual(session.snapshot().files.map(file => file.name), ['音效.wav', '背景.webp']);
  assert.equal(canceled.length, 0);
  await session.submit('audio');
  assert.deepEqual(session.snapshot().files.map(file => file.name), ['背景.webp']);
  await session.submit('image');
  assert.deepEqual(canceled, ['selection-1']);
});

test('cancel invalidates and releases a late picker selection without importing', async () => {
  let resolvePicker;
  const canceled = [];
  const session = createImportSession({ api: { chooseImportFiles: () => new Promise(resolve => { resolvePicker = resolve; }), cancelImportSelection: async id => canceled.push(id) } });
  const picking = session.select('chooseImportFiles', { mode: 'ordinary' });
  await session.cancel();
  resolvePicker(selection(['late.fla'], 'late-selection'));
  assert.equal(await picking, null);
  assert.deepEqual(session.snapshot().files, []);
  assert.deepEqual(canceled, ['late-selection']);
});

test('failed or cancelled confirmation remains retryable and an empty type never submits', async () => {
  let calls = 0, fail = true;
  const session = createImportSession({ api: { importSelectedPaths: async () => { calls++; if (fail) throw new Error('磁盘不可用'); return { canceled: true }; } } });
  session.setSelection(selection(['retry.jpg']));
  await assert.rejects(session.submit('audio'), /没有可导入/);
  assert.equal(calls, 0);
  await assert.rejects(session.submit('image'), /磁盘不可用/);
  fail = false;
  await session.submit('image');
  assert.equal(session.snapshot().files[0].name, 'retry.jpg');
  assert.equal(session.snapshot().selectionId, 'selection-1');
});

test('a partial import keeps the host-selected failed files and retries only that remainder', async () => {
  const canceled = [], calls = [];
  const session = createImportSession({ api: {
    importSelectedPaths: async (id, options) => {
      calls.push({ id, options, names: session.snapshot().files.map(file => file.name) });
      if (calls.length === 1) return { added: 1, failed: [{ file: 'D:/input/retry.png', error: '文件暂时占用' }], selection: selection(['retry.png', 'music.wav']) };
      return { added: 1, selection: selection(['music.wav']) };
    }, cancelImportSelection: async id => canceled.push(id),
  } });
  session.setSelection(selection(['done.png', 'retry.png', 'music.wav']));
  await session.submit('image', { categoryId: 'scene' });
  assert.deepEqual(session.snapshot().files.map(file => file.name), ['retry.png', 'music.wav']);
  assert.equal(session.snapshot().selectionId, 'selection-1');
  assert.deepEqual(canceled, []);
  await session.submit('image', { categoryId: 'scene' });
  assert.deepEqual(calls[1], { id: 'selection-1', options: { categoryId: 'scene', mode: 'image' }, names: ['retry.png', 'music.wav'] });
  assert.deepEqual(session.snapshot().files.map(file => file.name), ['music.wav']);
});

test('an all-failed batch stays configured and can finish on a later retry', async () => {
  const canceled = []; let attempts = 0;
  const session = createImportSession({ api: {
    importSelectedPaths: async () => ++attempts === 1
      ? { added: 0, failed: [{ file: 'D:/input/retry.png', error: '磁盘不可用' }], selection: selection(['retry.png']) }
      : { added: 1, selection: { selectionId: null, files: [], canceled: false } },
    cancelImportSelection: async id => canceled.push(id),
  } });
  session.setSelection(selection(['retry.png']));
  await session.submit('image');
  assert.equal(session.snapshot().selectionId, 'selection-1');
  assert.deepEqual(session.snapshot().files.map(file => file.name), ['retry.png']);
  assert.deepEqual(canceled, []);
  await session.submit('image');
  assert.equal(session.snapshot().selectionId, null);
  assert.deepEqual(session.snapshot().files, []);
});

test('legacy import failures without a remainder keep the whole selection for safe deduplicated retry', async () => {
  const canceled = [];
  const session = createImportSession({ api: {
    importSelectedPaths: async () => ({ added: 1, failed: [{ error: '无法识别失败文件' }] }),
    cancelImportSelection: async id => canceled.push(id),
  } });
  session.setSelection(selection(['done.png', 'retry.png']));
  await session.submit('image');
  assert.deepEqual(session.snapshot().files.map(file => file.name), ['done.png', 'retry.png']);
  assert.deepEqual(canceled, []);
});

test('a file drop passes native files to staging and busy drops cannot navigate or import', async () => {
  const listeners = new Map(), staged = [], chosen = [], hover = [];
  const root = { addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name) };
  let busy = false, prevented = 0, imported = 0;
  const nativeFile = { name: 'drag.png' };
  const drop = mountFileDrop({ root, api: { stageDroppedFiles: async files => { staged.push(files); return selection(['drag.png']); }, importSelectedPaths: () => { imported++; } }, canAccept: () => !busy, onFiles: value => chosen.push(value), onError: error => { throw error; }, onHover: value => hover.push(value) });
  const event = { dataTransfer: { types: ['Files'], files: [nativeFile] }, preventDefault() { prevented++; } };
  await listeners.get('drop')(event);
  assert.deepEqual(staged, [[nativeFile]]);
  assert.equal(chosen[0].selectionId, 'selection-1');
  assert.equal(imported, 0);
  busy = true;
  await listeners.get('drop')(event);
  assert.equal(chosen.length, 1);
  assert.equal(prevented, 2);
  drop.dispose();
  assert.equal(listeners.size, 0);
  assert.equal(hover.at(-1), false);
});
