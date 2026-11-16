/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Queue } = require('../plugin/queue.cjs');
const { createDocumentImportReceiver } = require('../desktop/document-import.cjs');

async function fixture(t, importDocument = async () => ({ assetId: 'saved' }), options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-document-recovery-'));
  const file = path.join(root, '当前文档.fla');
  await fs.writeFile(file, 'original saved document');
  const watchers = [], pending = new Set();
  const watch = (_directory, callback) => {
    const watcher = new EventEmitter();
    Object.assign(watcher, { callback, closes: 0, unrefs: 0,
      close() { this.closes++; this.emit('close'); }, unref() { this.unrefs++; } });
    watchers.push(watcher);
    return watcher;
  };
  const recoveryTimers = {
    setTimeout(callback, delay) { const timer = { callback, delay, unrefs: 0, unref() { this.unrefs++; } }; pending.add(timer); return timer; },
    clearTimeout(timer) { pending.delete(timer); },
  };
  const receiver = await createDocumentImportReceiver({ root, importDocument, watch, recoveryTimers, ...options });
  t.after(async () => { await receiver.close(); await fs.rm(root, { recursive: true, force: true }); });
  async function tick() {
    assert.equal(pending.size, 1, 'one recovery deadline is scheduled');
    const timer = [...pending][0];
    assert.equal(timer.unrefs, 1, 'recovery must not keep the process alive');
    assert.ok(timer.delay >= 5000 && timer.delay <= 15000, 'infrequent check still precedes request expiry');
    pending.delete(timer);
    await timer.callback();
  }
  return { root, file, receiver, watchers, pending, tick, queue: new Queue(root), watch };
}

test('a dropped watch notification is recovered once with the original document unchanged', async t => {
  let imports = 0;
  const f = await fixture(t, async () => { imports++; return { assetId: 'saved', name: '当前文档' }; });
  const request = f.queue.requestDocumentImport(f.file);
  assert.equal(f.queue.documentImportResult(request.requestId), null);
  await f.tick();
  const receipt = f.queue.documentImportResult(request.requestId);
  assert.equal(receipt.ok, true);
  assert.equal(imports, 1);
  // A receipt left alongside a replayed descriptor must still prevent reimport.
  f.queue.atomic(path.join('document-import/inbox', request.requestId + '.json'), request);
  await f.tick();
  assert.equal(imports, 1);
  assert.deepEqual(f.queue.documentImportResult(request.requestId), receipt);
  assert.equal(await fs.readFile(f.file, 'utf8'), 'original saved document');
});

test('watcher errors recover the watcher and both recovery and notifications share one serial drain', async t => {
  let active = 0, peak = 0, imports = 0, release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const f = await fixture(t, async () => {
    imports++; peak = Math.max(peak, ++active); entered(); await gate; active--;
    return { assetId: 'saved' };
  });
  const oldWatcher = f.watchers[0];
  assert.equal(oldWatcher.unrefs, 1);
  oldWatcher.emit('error', new Error('watch handle lost'));
  assert.equal(oldWatcher.closes, 1);
  const first = f.queue.requestDocumentImport(f.file);
  const recovering = f.tick();
  await started;
  const second = f.queue.requestDocumentImport(f.file);
  assert.equal(f.watchers.length, 2);
  const notification = f.watchers[1].callback();
  release();
  await Promise.all([recovering, notification]);
  await f.receiver.drain();
  assert.equal(peak, 1);
  assert.equal(imports, 2);
  assert.equal(f.queue.documentImportResult(first.requestId).ok, true);
  assert.equal(f.queue.documentImportResult(second.requestId).ok, true);
  await f.tick();
  assert.equal(imports, 2);
});

test('temporary watcher creation failure does not disable import and is retried later', async t => {
  let attempts = 0, latestCallback;
  const watchers = [];
  const f = await fixture(t, undefined, { watch(_directory, callback) {
    if (++attempts <= 2) throw new Error('temporary watch failure');
    latestCallback = callback;
    const watcher = new EventEmitter(); watcher.unref = () => {}; watcher.close = () => {}; watchers.push(watcher);
    return watcher;
  } });
  const first = f.queue.requestDocumentImport(f.file);
  await f.tick();
  assert.equal(f.queue.documentImportResult(first.requestId).ok, true);
  await f.tick();
  assert.equal(attempts, 3);
  assert.equal(watchers.length, 1);
  const second = f.queue.requestDocumentImport(f.file);
  await latestCallback();
  assert.equal(f.queue.documentImportResult(second.requestId).ok, true);
});

test('a temporary inbox read error leaves recovery scheduled for the next check', async t => {
  const f = await fixture(t);
  const inbox = path.join(f.root, 'bridge/document-import/inbox');
  const parked = inbox + '-parked';
  await fs.rename(inbox, parked);
  await fs.writeFile(inbox, 'temporarily unavailable');
  await f.tick();
  await fs.unlink(inbox);
  await fs.rename(parked, inbox);
  const request = f.queue.requestDocumentImport(f.file);
  await f.tick();
  assert.equal(f.queue.documentImportResult(request.requestId).ok, true);
});

test('closing cancels recovery and rejects late watcher or timer callbacks', async t => {
  let imports = 0;
  const f = await fixture(t, async () => { imports++; return { assetId: 'saved' }; });
  assert.equal(f.pending.size, 1);
  const staleTimer = [...f.pending][0], watcher = f.watchers[0];
  await f.receiver.close();
  assert.equal(f.pending.size, 0);
  assert.equal(watcher.closes, 1);
  const request = f.queue.requestDocumentImport(f.file);
  await staleTimer.callback();
  await watcher.callback();
  await f.receiver.drain();
  assert.equal(f.pending.size, 0);
  assert.equal(imports, 0);
  assert.equal(f.queue.documentImportResult(request.requestId), null);
});

test('closing during recovery waits for its current receipt and does not reschedule', async t => {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const f = await fixture(t, async () => { entered(); await gate; return { assetId: 'saved' }; });
  const request = f.queue.requestDocumentImport(f.file);
  const recovering = f.tick();
  await started;
  let closed = false;
  const closing = f.receiver.close().then(() => { closed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, false);
  release();
  await Promise.all([recovering, closing]);
  assert.equal(f.queue.documentImportResult(request.requestId).ok, true);
  assert.equal(f.pending.size, 0);
});
