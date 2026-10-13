/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

async function audioLibrary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-media-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'assets'));
  const bytes = Buffer.from('0123456789abcdefghij');
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const asset = { id: 'known-audio', kind: 'audio', extension: '.mp3', hash, managedPath: `assets/${hash}.mp3` };
  await fs.writeFile(path.join(root, asset.managedPath), bytes);
  return { root, asset, bytes, getAsset(id) { return id === asset.id ? asset : null; } };
}

function request(url = 'anshelf://media/known-audio', { method = 'GET', range } = {}) {
  return { url, method, headers: new Headers(range === undefined ? {} : { Range: range }) };
}

test('audio media protocol streams a known immutable audio asset with correct headers', async t => {
  const { createMediaResponse } = require('../desktop/media.cjs');
  const library = await audioLibrary(t);
  const result = await createMediaResponse(request(), library);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('Content-Type'), 'audio/mpeg');
  assert.equal(result.headers.get('Accept-Ranges'), 'bytes');
  assert.equal(result.headers.get('Content-Length'), String(library.bytes.length));
  assert.deepEqual(Buffer.from(await result.arrayBuffer()), library.bytes);
});

test('audio seek ranges return only requested bytes, including open and suffix ranges', async t => {
  const { createMediaResponse } = require('../desktop/media.cjs');
  const library = await audioLibrary(t);
  for (const [range, start, end] of [['bytes=3-8', 3, 8], ['bytes=12-', 12, 19], ['bytes=-4', 16, 19], ['bytes=17-99', 17, 19]]) {
    const result = await createMediaResponse(request(undefined, { range }), library);
    assert.equal(result.status, 206, range);
    assert.equal(result.headers.get('Content-Range'), `bytes ${start}-${end}/20`);
    assert.equal(result.headers.get('Content-Length'), String(end - start + 1));
    assert.deepEqual(Buffer.from(await result.arrayBuffer()), library.bytes.subarray(start, end + 1));
  }
});

test('invalid audio ranges are bounded failures and HEAD never reads a response body', async t => {
  const { createMediaResponse } = require('../desktop/media.cjs');
  const library = await audioLibrary(t);
  for (const range of ['bytes=50-60', 'bytes=8-3', 'bytes=-0', 'bytes=1-2,4-5', 'nonsense', 'bytes=999999999999999999999-']) {
    const result = await createMediaResponse(request(undefined, { range }), library);
    assert.equal(result.status, 416, range);
    assert.equal(result.headers.get('Content-Range'), 'bytes */20');
  }
  const result = await createMediaResponse(request(undefined, { method: 'HEAD', range: 'bytes=3-5' }), library);
  assert.equal(result.status, 206);
  assert.equal(result.body, null);
  assert.equal(result.headers.get('Content-Length'), '3');
});

test('audio endpoint rejects unknown IDs, FLA assets, path manipulation and linked files', async t => {
  const { createMediaResponse } = require('../desktop/media.cjs');
  const library = await audioLibrary(t);
  for (const url of ['anshelf://media/unknown', 'anshelf://media/%2e%2e%2foutside.mp3', 'anshelf://media/known-audio/../outside', 'https://media/known-audio', 'anshelf://other/known-audio']) {
    assert.equal((await createMediaResponse(request(url), library)).status, 404, url);
  }
  assert.equal((await createMediaResponse(request(undefined, { method: 'POST' }), library)).status, 405);
  library.asset.kind = 'fla';
  assert.equal((await createMediaResponse(request(), library)).status, 404);
  library.asset.kind = 'audio';
  library.asset.managedPath = '../outside.mp3';
  assert.equal((await createMediaResponse(request(), library)).status, 404);
  const outside = path.join(library.root, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, `${library.asset.hash}.mp3`), 'outside');
  const linked = path.join(library.root, 'assets/link');
  await fs.symlink(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
  library.asset.managedPath = `assets/link/${library.asset.hash}.mp3`;
  assert.equal((await createMediaResponse(request(), library)).status, 404);
});

test('native drag resolves known IDs privately and reports errors without sending filesystem paths', async () => {
  const { registerNativeDrag } = require('../desktop/native-drag.cjs');
  const listeners = new Map(), calls = [], errors = [];
  const sender = { startDrag: item => { calls.push(item); } };
  const descriptor = { file: 'C:\\private-library\\assets\\audio.mp3', kind: 'audio' };
  let prepared = 0;
  registerNativeDrag({ ipcMain: { on: (name, handler) => listeners.set(name, handler) }, webContents: sender,
    prepareDrag: async id => { prepared++; assert.equal(id, 'known-id'); return descriptor; },
    createIcon: kind => ({ iconKind: kind }), reportError: message => errors.push(message) });
  const drag = listeners.get('shelf:start-drag');
  await drag({ sender }, 'known-id');
  assert.deepEqual(calls, [{ file: descriptor.file, icon: { iconKind: 'audio' } }]);
  assert.equal(prepared, 1);
  await drag({ sender: {} }, 'known-id');
  await drag({ sender }, { file: descriptor.file });
  assert.equal(prepared, 1);
  assert.equal(errors.length, 0);
  registerNativeDrag({ ipcMain: { on: (name, handler) => listeners.set(name, handler) }, webContents: sender,
    prepareDrag: async () => { throw new Error('路径无效'); }, createIcon: () => ({}), reportError: message => errors.push(message) });
  await listeners.get('shelf:start-drag')({ sender }, 'known-id');
  assert.deepEqual(errors, ['路径无效']);
  assert.equal(calls.length, 1);
});

test('native drag rejects overlapping operations and never exposes the internal prepareDrag API', async () => {
  const { registerNativeDrag } = require('../desktop/native-drag.cjs');
  const vm = require('node:vm');
  let handler, resolvePrepare, shelf;
  const sender = { startDrag() {} }, errors = [], ipcCalls = [];
  registerNativeDrag({ ipcMain: { on: (_name, value) => { handler = value; } }, webContents: sender,
    prepareDrag: () => new Promise(resolve => { resolvePrepare = resolve; }), createIcon: () => ({}), reportError: message => errors.push(message) });
  const first = handler({ sender }, 'first');
  await handler({ sender }, 'second');
  assert.match(errors[0], /拖拽|拖动/);
  resolvePrepare({ file: '/managed/a.anshelf-transfer', kind: 'fla' });
  await first;
  assert.equal(errors.length,2);
  assert.match(errors[1],/音频|FLA/);
  const electron = { contextBridge: { exposeInMainWorld(_name, value) { shelf = value; } }, ipcRenderer: {
    invoke(...args) { ipcCalls.push(['invoke', ...args]); }, send(...args) { ipcCalls.push(['send', ...args]); }, on() {}, removeListener() {},
  } };
  vm.runInNewContext(await fs.readFile(path.join(__dirname, '../desktop/preload.cjs'), 'utf8'), { require: () => electron });
  assert.equal(shelf.prepareDrag, undefined);
  assert.equal(shelf.startDrag('known-id'), undefined);
  assert.deepEqual(ipcCalls, [['send', 'shelf:start-drag', 'known-id']]);
  assert.equal(typeof shelf.setCategoryPinned, 'function');
});

test('desktop integrates streaming media, safe poster lookup, mode filters and an internal-only drag descriptor', async t => {
  const vm = require('node:vm');
  const { EventEmitter } = require('node:events');
  const library = await audioLibrary(t);
  await fs.mkdir(path.join(library.root, 'previews'));
  library.asset.previewPosterPath = 'previews/known-poster.png';
  await fs.writeFile(path.join(library.root, library.asset.previewPosterPath), 'poster-fixture');
  let callbacks, protocolHandler, callHandler, dragHandler, privileged, window;
  const fetched = [], dragCalls = [], picked = [];
  const app = new EventEmitter();
  Object.assign(app, { requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(), getPath: () => library.root, getAppPath: () => path.join(__dirname, '..'), isPackaged: false, quit() {} });
  class FakeWindow {
    constructor() { window = this; this.webContents = { setWindowOpenHandler() {}, on() {}, send() {}, startDrag(item) { dragCalls.push(item); } }; }
    isDestroyed() { return false; }
    loadFile() { return Promise.resolve(); }
  }
  const host = { api: { prepareDrag: async () => ({ file: '/private/known.mp3', kind: 'audio' }) }, library };
  const electron = { app, BrowserWindow: FakeWindow, dialog: { showOpenDialog: async (_win, options) => { picked.push(options); return { canceled: true, filePaths: [] }; }, showErrorBox: (_title, message) => { throw new Error(message); } },
    ipcMain: { handle(_channel, handler) { callHandler = handler; }, on(_channel, handler) { dragHandler = handler; } },
    protocol: { registerSchemesAsPrivileged(value) { privileged = value; }, handle(_scheme, handler) { protocolHandler = handler; } },
    session: { defaultSession: { webRequest: { onBeforeRequest() {} } } }, shell: {}, nativeImage: { createFromPath: () => ({ resize: () => ({ size: 32 }) }) },
    net: { fetch: async url => { fetched.push(url); return new Response('poster-fixture'); } },
  };
  const context = { require(name) {
    if (name === 'electron') return electron;
    if (name === './host.cjs') return { createHost: async value => { callbacks = value; return host; } };
    if (name === './previews.cjs') return { createRenderer: () => async () => ({}) };
    if (name === './gif-poster.cjs') return { createGifPoster: () => async () => true };
    if (name.startsWith('./')) return require(path.join(__dirname, '../desktop', name));
    if (name.startsWith('../')) return require(path.join(__dirname, '../desktop', name));
    return require(name);
  }, __dirname: path.join(__dirname, '../desktop'), process: { env: {}, resourcesPath: '/resources' }, URL, Response };
  vm.runInNewContext(await fs.readFile(path.join(__dirname, '../desktop/main.cjs'), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(privileged[0].privileges.stream, true);
  const result = await protocolHandler(request());
  assert.equal(result.status, 200);
  assert.deepEqual(Buffer.from(await result.arrayBuffer()), library.bytes);
  assert.equal((await protocolHandler(request('anshelf://poster/known-audio'))).status, 200);
  assert.equal(fetched.length, 1);
  assert.match(fetched[0], /known-poster\.png$/);
  library.asset.previewPosterPath = '../outside.png';
  assert.equal((await protocolHandler(request('anshelf://poster/known-audio'))).status, 404);
  assert.equal(fetched.length, 1);
  await callbacks.pickFiles({ mode: 'audio' });
  assert.deepEqual(Array.from(picked[0].filters[0].extensions), ['mp3', 'wav', 'ogg', 'flac']);
  await callbacks.pickFiles({ mode: 'effect' });
  assert.deepEqual(Array.from(picked[1].filters[0].extensions), ['fla']);
  assert.match(picked[1].title, /特效/);
  await assert.rejects(callbacks.pickFiles({ mode: 'invalid' }), /模式/);
  await assert.rejects(callHandler({ sender: window.webContents }, 'prepareDrag', ['known-audio']), /不允许/);
  await dragHandler({ sender: window.webContents }, 'known-audio');
  assert.equal(dragCalls[0].file, '/private/known.mp3');
});
