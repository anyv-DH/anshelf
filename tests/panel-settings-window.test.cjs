/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function extensionDispatch(id) {
  const manifest = fs.readFileSync(path.join(__dirname, '../plugin/CSXS/manifest.xml'), 'utf8');
  const dispatches = manifest.match(/<DispatchInfoList>([\s\S]*?)<\/DispatchInfoList>/)?.[1];
  assert.ok(dispatches, 'the shipped CEP manifest must define its extension dispatches');
  const extension = [...dispatches.matchAll(/<Extension\s+Id="([^"]+)"\s*>([\s\S]*?)<\/Extension>/g)]
    .find(match => match[1] === id)?.[2];
  assert.ok(extension, `the shipped CEP manifest must declare ${id}`);
  return extension;
}

test('the requested Modeless import settings extension starts with its host window visible', () => {
  const settings = extensionDispatch('com.anshelf.receiver.import-settings');
  assert.match(settings, /<Type>\s*Modeless\s*<\/Type>/);
  assert.match(settings, /<AutoVisible>\s*true\s*<\/AutoVisible>/,
    'CEP must show the native settings window when it starts; unhiding HTML does not show a hidden host window');
});

test('the settings extension opens on request while the existing compact panel retains its identity and geometry', () => {
  const settings = extensionDispatch('com.anshelf.receiver.import-settings');
  assert.doesNotMatch(settings, /<StartOn\b|<Event\b|<Menu\b/,
    'the settings window must not auto-start with Animate or add a second panel menu');
  const panel = extensionDispatch('com.anshelf.receiver.panel');
  assert.match(panel, /<Type>\s*Panel\s*<\/Type>/);
  assert.match(panel, /<Size>\s*<Height>88<\/Height>\s*<Width>48<\/Width>\s*<\/Size>/);
  assert.match(panel, /<MinSize>\s*<Height>80<\/Height>\s*<Width>40<\/Width>\s*<\/MinSize>/);
});

function compactPanel({ open = true } = {}) {
  const listeners = {}, calls = [], windowEvents = {};
  const element = () => ({ disabled: false, textContent: '', title: '', setAttribute() {}, addEventListener(name, fn) { this[name] = fn; }, focus() {} });
  const insert = element(), add = element();
  const api = {
    getSystemPath: () => '/extension',
    evalScript(code, callback) {
      if (code.includes('AnShelfCurrentDocumentInfoForLibrary')) callback(JSON.stringify({ version: 1, ok: true, documentId: 42, name: '作品.fla', file: 'C:\\works\\作品.fla' }));
      else if (code.includes('AnShelfCurrentDocumentForLibrary')) calls.push(['save', code]);
      else callback('42');
    },
    resizeContent() { calls.push(['resize']); },
    addEventListener(name, callback) { listeners[name] = callback; },
    removeEventListener(name) { delete listeners[name]; },
    dispatchEvent(event) { calls.push(['dispatch', event]); },
    requestOpenExtension(id, params) { calls.push(['open', id, params]); if (!open) throw new Error('opening failed'); }
  };
  const queue = { heartbeat() {}, pending() {}, documentImportSettings: () => ({ categories: [], defaults: { mode: 'ordinary', categoryId: null, previewResolution: null, preferExistingPreview: true } }) };
  let tick, offset = 0;
  const window = { innerWidth: 48, innerHeight: 88, __adobe_cep__: api, addEventListener(name, callback) { windowEvents[name] = callback; }, cep_node: { require(name) { if (name === 'path') return path; if (name === 'crypto') return require('node:crypto'); if (name === 'process') return { env: { APPDATA: '/appdata' } }; return { Queue: function () { return queue; }, localURI: value => value, documentImportOptions: value => value }; } } };
  const Clock = class extends Date { constructor(...args) { super(...(args.length ? args : [Date.now() + offset])); } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../plugin/panel.js'), 'utf8'), { window, document: { getElementById: id => id === 'insert' ? insert : id === 'add-current' ? add : null, addEventListener() {} }, Date: Clock, setInterval(fn) { tick = fn; return 1; }, clearInterval() {}, decodeURI, JSON });
  return { add, calls, emit(data, extensionId = 'com.anshelf.receiver.import-settings', parsed = false) { const handler = listeners['com.anshelf.receiver.import-settings.response']; if (handler) handler({ extensionId, data: parsed ? data : JSON.stringify(data) }); }, advance(ms) { offset += ms; tick(); }, unload() { windowEvents.unload(); } };
}

test('compact AN panel opens an independent settings extension without resizing or saving, and keeps the document bound', () => {
  const view = compactPanel();
  view.add.click();
  assert.deepEqual(view.calls.filter(call => call[0] === 'open'), [['open', 'com.anshelf.receiver.import-settings', '']]);
  assert.equal(view.calls.some(call => call[0] === 'resize' || call[0] === 'save'), false);
  view.emit({ action: 'ready' });
  const request = JSON.parse(view.calls.find(call => call[0] === 'dispatch' && JSON.parse(call[1].data).action === 'show')[1].data);
  assert.equal(request.documentId, 42);
  view.emit({ action: 'opened', requestId: request.requestId });
  view.emit({ action: 'confirm', requestId: 'wrong', options: { mode: 'ordinary' } });
  assert.equal(view.calls.some(call => call[0] === 'save'), false);
  view.emit({ action: 'confirm', requestId: request.requestId, options: { mode: 'ordinary', categoryId: null, previewResolution: 2048, preferExistingPreview: false } });
  assert.match(view.calls.find(call => call[0] === 'save')[1], /AnShelfCurrentDocumentForLibrary","42"/);
  assert.equal(view.calls.some(call => call[0] === 'resize'), false);
});

test('settings launch failures or a missing handshake become retryable errors without saving', () => {
  for (const open of [false, true]) {
    const view = compactPanel({ open }); view.add.click();
    if (open) view.advance(11000);
    assert.equal(view.add.disabled, false);
    assert.equal(view.add.textContent, '加入失败');
    assert.match(view.add.title, /设置|打开/);
    assert.equal(view.calls.some(call => call[0] === 'resize' || call[0] === 'save'), false);
  }
});

test('CEP native JSON objects are accepted just like string event payloads', () => {
  const view = compactPanel(); view.add.click();
  view.emit({ action: 'ready' }, undefined, true);
  assert.equal(view.calls.filter(call => call[0] === 'dispatch' && JSON.parse(call[1].data).action === 'show').length, 1);
  const request = JSON.parse(view.calls.find(call => call[0] === 'dispatch' && JSON.parse(call[1].data).action === 'show')[1].data);
  view.emit({ action: 'opened', requestId: request.requestId }, undefined, true);
  view.emit({ action: 'cancel', requestId: request.requestId }, undefined, true);
  assert.equal(view.add.textContent, '已取消');
});

test('dialog close cancels without saving and panel unload rejects late confirmations', () => {
  const view = compactPanel(); view.add.click(); view.emit({ action: 'ready' });
  const request = JSON.parse(view.calls.find(call => call[0] === 'dispatch' && JSON.parse(call[1].data).action === 'show')[1].data);
  view.emit({ action: 'cancel', requestId: request.requestId });
  assert.equal(view.add.textContent, '已取消');
  assert.equal(view.calls.some(call => call[0] === 'save'), false);
  view.add.click(); view.emit({ action: 'ready' });
  const latest = JSON.parse(view.calls.filter(call => call[0] === 'dispatch' && JSON.parse(call[1].data).action === 'show').at(-1)[1].data);
  view.unload();
  view.emit({ action: 'confirm', requestId: latest.requestId, options: { mode: 'ordinary', categoryId: null, previewResolution: 2048, preferExistingPreview: false } });
  assert.equal(view.calls.some(call => call[0] === 'save'), false);
});
