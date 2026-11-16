/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const requestEvent = 'com.anshelf.receiver.import-settings.request';
const panelId = 'com.anshelf.receiver.panel';

function settingsWindow() {
  const listeners = {}, dispatches = [], windowEvents = {};
  let closed = 0;
  const element = () => ({ hidden: true, value: '', checked: true, textContent: '', style: {},
    setAttribute() {}, querySelectorAll() { return []; }, addEventListener() {}, focus() {} });
  const controls = Object.fromEntries(['settings-window', 'add-confirm', 'confirm-save', 'confirm-cancel', 'current-file',
    'category-search', 'import-category', 'import-ordinary', 'import-effect', 'preview-resolution',
    'prefer-existing-preview', 'settings-error', 'category-options', 'resolution-options', 'settings-loading'].map(id => [id, element()]));
  const queue = {
    documentImportSettings() { return { categories: [], defaults: { mode: 'ordinary', categoryId: null, previewResolution: null, preferExistingPreview: true } }; },
  };
  const api = {
    getSystemPath: () => '/extension', evalScript() { throw new Error('Settings must not call JSFL'); },
    addEventListener(name, fn) { listeners[name] = fn; }, removeEventListener(name) { delete listeners[name]; },
    dispatchEvent(event) { dispatches.push(event); }, closeExtension() { closed++; },
  };
  const window = { __adobe_cep__: api, addEventListener(name, fn) { windowEvents[name] = fn; },
    cep_node: { require(name) {
      if (name === 'path') return path;
      if (name === 'crypto') return require('node:crypto');
      if (name === 'process') return { env: { APPDATA: '/appdata' } };
      return { Queue: function () { return queue; }, documentImportOptions: value => value, localURI: value => value };
    } },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../plugin/panel.js'), 'utf8'), {
    window, document: { getElementById: id => controls[id] || null, addEventListener() {} }, decodeURI, JSON,
  });
  return { controls, dispatches, closed: () => closed,
    send(data) { listeners[requestEvent]?.({ extensionId: panelId, data }); },
    unload() { windowEvents.unload(); },
  };
}

test('a settings window with a lost initial ready message can be contacted again without reloading the existing extension', () => {
  const view = settingsWindow();
  assert.equal(view.dispatches.length, 1);
  view.dispatches.length = 0; // Simulate CEP dropping the initial ready delivery.
  view.send({ action: 'ping' });
  assert.equal(view.dispatches.length, 1, 'opening an already loaded extension needs a fresh ready response');
  assert.equal(JSON.parse(view.dispatches[0].data).action, 'ready');
});

test('a launch timeout closes an unbound loading window when the show handshake was lost', () => {
  const view = settingsWindow();
  view.send({ action: 'close', requestId: 'a'.repeat(32) });
  assert.equal(view.closed(), 1, 'the independent loading window must close even before a show message arrived');
  assert.equal(view.dispatches.length, 1, 'closing a never-bound window must not send a save or cancellation for another request');
});

test('a late close for an older request cannot close a settings window bound to the next request', () => {
  const view = settingsWindow(), currentId = 'b'.repeat(32);
  view.send({ action: 'show', requestId: currentId, documentId: 42, info: { documentId: 42, name: '新文档', file: null } });
  assert.equal(view.controls['add-confirm'].hidden, false);
  view.send({ action: 'close', requestId: 'a'.repeat(32) });
  assert.equal(view.closed(), 0);
  assert.equal(view.controls['add-confirm'].hidden, false);
  view.send({ action: 'close', requestId: currentId });
  assert.equal(view.closed(), 1);
});
