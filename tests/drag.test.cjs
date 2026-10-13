/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');

function transfer(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anshelf-drop-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'assets'));
  const bytes = Buffer.from('managed FLA fixture');
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const sourcePath = path.join(root, 'assets', `${hash}.fla`);
  fs.writeFileSync(sourcePath, bytes);
  const requestId = crypto.randomUUID(), createdAt = Date.now();
  const request = { version: 1, requestId, createdAt, managedRoot: root, asset: { id: 'known', hash, name: '武器', sourcePath } };
  const { Queue } = require('../plugin/queue.cjs');
  const queue = new Queue(root);
  queue.atomic('pending.json', request);
  fs.mkdirSync(path.join(root, 'bridge/drag'));
  const marker = { type: 'anshelf-transfer', version: 1, requestId, expiresAt: createdAt + 5 * 60 * 1000 };
  const name = `${requestId}.anshelf-transfer`;
  fs.writeFileSync(path.join(root, 'bridge/drag', name), JSON.stringify(marker));
  return { root, request, marker, name, queue };
}

test('CEP accepts only the current unexpired drag marker and still verifies the FLA hash before insertion', t => {
  const f = transfer(t);
  const accepted = f.queue.acceptDrop(f.marker, f.name, f.request.createdAt + 100);
  assert.equal(accepted.requestId, f.request.requestId);
  fs.appendFileSync(f.request.asset.sourcePath, 'tampered');
  assert.throws(() => f.queue.prepare(accepted), /哈希/);
});

test('CEP refuses expired, replayed, mismatched or malformed drag markers without replacing pending', t => {
  const f = transfer(t);
  for (const [marker, name, now] of [
    [{ ...f.marker, type: 'other' }, f.name, Date.now()],
    [{ ...f.marker, version: 2 }, f.name, Date.now()],
    [{ ...f.marker, requestId: crypto.randomUUID() }, f.name, Date.now()],
    [{ ...f.marker, expiresAt: Date.now() - 1 }, f.name, Date.now()],
    [{ ...f.marker, expiresAt: Date.now() + 60 * 60 * 1000 }, f.name, Date.now()],
    [{ ...f.marker, sourcePath: 'C:\\outside.fla' }, f.name, Date.now()],
    [f.marker, 'weapon.fla', Date.now()],
    [f.marker, '../' + f.name, Date.now()],
    [f.marker, f.name, f.marker.expiresAt],
  ]) assert.throws(() => f.queue.acceptDrop(marker, name, now), /拖|传递|请求|marker/i);
  assert.equal(f.queue.pending().requestId, f.request.requestId);
  f.queue.complete(f.request, { ok: true });
  assert.throws(() => f.queue.acceptDrop(f.marker, f.name), /请求|拖|传递/);
});

test('CEP requires an identical managed marker and rejects marker links', t => {
  const f = transfer(t);
  const markerFile = path.join(f.root, 'bridge/drag', f.name);
  fs.writeFileSync(markerFile, JSON.stringify({ ...f.marker, expiresAt: f.marker.expiresAt - 100 }));
  assert.throws(() => f.queue.acceptDrop(f.marker, f.name), /拖|传递|marker/);
  fs.rmSync(path.join(f.root, 'bridge/drag'), { recursive: true });
  const outside = path.join(f.root, 'outside'); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, f.name), JSON.stringify(f.marker));
  fs.symlinkSync(outside, path.join(f.root, 'bridge/drag'), 'junction');
  assert.throws(() => f.queue.acceptDrop(f.marker, f.name), /链接|路径/);
});

function dropPanel() {
  const listeners = {}, calls = [], queue = { heartbeat() {}, pending() { return null; },
    acceptDrop(marker, name) { calls.push(['acceptDrop', marker, name]); if (marker.requestId !== 'current') throw new Error('拖拽已过期'); return { version: 1, requestId: 'current', asset: { name: '武器' } }; },
    prepare(request) { calls.push(['prepare', request.requestId]); return { ...request, managedRoot: 'file:///managed', temporaryPath: 'managed/bridge/temp/current.fla' }; },
    complete() {}, cleanup() {},
  };
  const button = { disabled: true, attrs: {}, setAttribute(name, value) { this.attrs[name] = value; }, addEventListener() {} };
  const document = { body: { addEventListener(name, handler) { listeners[name] = handler; } }, getElementById() { return button; } };
  const window = { __adobe_cep__: { getSystemPath() { return '/plugin'; }, evalScript(code, callback) { if (!code.includes('AnShelfInsertWhole')) { callback('42'); return; } calls.push(['evalScript']); } },
    cep_node: { require(name) { if (name === 'process') return { env: { APPDATA: '/managed' } }; if (name === 'path') return path; return { Queue: function () { return queue; }, localURI: value => 'file:///' + value }; } }, addEventListener() {},
  };
  class FileReader { readAsText(file) { this.result = file.text; this.onload(); } }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../plugin/panel.js'), 'utf8'), { window, document, FileReader, JSON, decodeURI, setInterval() {}, clearInterval() {} });
  const drop = (file, extras = {}) => {
    let prevented = false;
    listeners.drop({ preventDefault() { prevented = true; }, stopPropagation() {}, dataTransfer: { files: [file] }, ...extras });
    return prevented;
  };
  return { button, listeners, calls, drop };
}

test('dropping a managed transfer onto the compact CEP panel inserts immediately without another click', () => {
  const view = dropPanel();
  assert.equal(view.drop({ name: 'current.anshelf-transfer', size: 100, text: JSON.stringify({ type: 'anshelf-transfer', version: 1, requestId: 'current', expiresAt: Date.now() + 1000 }) }), true);
  assert.deepEqual(view.calls.map(call => call[0]), ['acceptDrop', 'prepare', 'evalScript']);
  assert.equal(view.button.textContent, '正在粘贴…');
  view.drop({ name: 'current.anshelf-transfer', size: 100, text: '{}' });
  assert.equal(view.calls.filter(call => call[0] === 'prepare').length, 1);
});

test('CEP cancels default drops and reports unrelated FLA files, oversize markers and stale transfers without inserting', () => {
  for (const file of [
    { name: 'weapon.fla', size: 100, text: '{}' },
    { name: 'current.anshelf-transfer', size: 50000, text: '{}' },
    { name: 'current.anshelf-transfer', size: 100, text: '{invalid-json' },
    { name: 'current.anshelf-transfer', size: 100, text: '{"requestId":"old"}' },
  ]) {
    const view = dropPanel();
    assert.equal(view.drop(file), true);
    assert.equal(view.calls.filter(call => call[0] === 'prepare').length, 0);
    assert.equal(view.button.textContent, '拖入失败');
  }
});
