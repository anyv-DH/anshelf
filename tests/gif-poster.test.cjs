/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createGifPoster } = require('../desktop/gif-poster.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-poster-unit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'fixture.gif');
  await fs.writeFile(source, Buffer.from('R0lGODlhAQABAIAAAP8AAAAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64'));
  return { root, source, destination: path.join(root, 'poster.png') };
}

function renderer(result) {
  let id = 0, worker;
  const handlers = new Map(), listeners = new Map(), windows = [];
  const ipcMain = { handle: (name, handler) => handlers.set(name, handler), on: (name, handler) => listeners.set(name, handler) };
  class FakeWindow {
    constructor(options) {
      this.options = options; this.webContents = new EventEmitter(); this.webContents.id = ++id;
      this.webContents.setWindowOpenHandler = () => {}; windows.push(this); worker = this;
    }
    isDestroyed() { return Boolean(this.destroyed); }
    destroy() { this.destroyed = true; }
    async loadFile() {
      const bytes = handlers.get('poster:input')({ sender: this.webContents });
      assert.equal(Buffer.from(bytes).subarray(0, 6).toString(), 'GIF89a');
      listeners.get('poster:done')({ sender: { id: 99999 } }, { png: 'invalid untrusted sender' });
      listeners.get('poster:done')({ sender: this.webContents }, result);
    }
  }
  const nativeImage = { createFromBuffer: bytes => ({ isEmpty: () => bytes.length === 0, getSize: () => ({ width: 2, height: 2 }) }) };
  return { create: createGifPoster({ BrowserWindow: FakeWindow, ipcMain, nativeImage }), windows, handlers, getWorker: () => worker };
}

test('GIF poster worker installs only its verified PNG output and preserves source bytes', async t => {
  const f = await fixture(t);
  const before = await fs.readFile(f.source);
  const png = Buffer.from('mock validated PNG');
  const worker = renderer({ png: 'data:image/png;base64,' + png.toString('base64') });
  assert.equal(await worker.create(f.source, f.destination), true);
  assert.deepEqual(await fs.readFile(f.destination), png);
  assert.deepEqual(await fs.readFile(f.source), before);
  assert.equal(worker.windows[0].options.show, false);
  assert.equal(worker.windows[0].options.webPreferences.sandbox, true);
  assert.equal(worker.windows[0].options.webPreferences.nodeIntegration, false);
  assert.equal(worker.windows[0].destroyed, true);
  assert.throws(() => worker.handlers.get('poster:input')({ sender: { id: worker.windows[0].webContents.id } }), /不存在/);
  assert.deepEqual((await fs.readdir(f.root)).sort(), ['fixture.gif', 'poster.png']);
});

test('invalid GIF or failed renderer preserves the previous poster without temporary files', async t => {
  const f = await fixture(t);
  await fs.writeFile(f.destination, 'previous poster');
  const worker = renderer({ error: 'GIF无法解码' });
  await assert.rejects(worker.create(f.source, f.destination), /无法解码/);
  assert.equal(await fs.readFile(f.destination, 'utf8'), 'previous poster');
  await fs.writeFile(f.source, 'invalid header');
  await assert.rejects(worker.create(f.source, f.destination), /文件格式/);
  assert.equal(worker.windows.length, 1);
  assert.equal(await fs.readFile(f.destination, 'utf8'), 'previous poster');
  assert.deepEqual((await fs.readdir(f.root)).sort(), ['fixture.gif', 'poster.png']);
});
