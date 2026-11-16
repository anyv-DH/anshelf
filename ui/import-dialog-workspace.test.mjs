/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountUnifiedImport } from './import-dialog-workspace.mjs';

const selection = names => ({ selectionId: 'selection-1', files: names.map(name => ({ name, extension: name.split('.').at(-1) })), canceled: false });
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture({ names, remainder, failed = [], mode = 'effect' }) {
  const listeners = new Map(), documentListeners = new Map(), errors = [], submissions = [];
  const dialog = { open: false, addEventListener: (type, callback) => listeners.set(type, callback), removeEventListener() {}, showModal() { this.open = true; } };
  const nodes = { '#dialog': dialog };
  const content = { dataset: {} };
  Object.defineProperty(content, 'innerHTML', { set(html) {
    content.markup = html;
    nodes['#import-category'] = { value: html.match(/<option value="([^"]*)" selected>/)?.[1] || '' };
    nodes['#prefer-preview'] = html.includes('id="prefer-preview"') ? { checked: /id="prefer-preview"[^>]* checked/.test(html) } : null;
    nodes['#custom-preview-resolution'] = html.includes('id="custom-preview-resolution"') ? { checked: /id="custom-preview-resolution"[^>]* checked/.test(html) } : null;
    nodes['#preview-resolution'] = html.includes('id="preview-resolution"') ? { value: html.match(/<option value="(\d+)" selected>/)?.[1] || '512' } : null;
    nodes['#import-group-by-folder'] = html.includes('id="import-group-by-folder"') ? { id: 'import-group-by-folder', checked: /id="import-group-by-folder"[^>]* checked/.test(html) } : null;
  } });
  nodes['#dialog-content'] = content;
  const document = { querySelector: selector => nodes[selector] || null, addEventListener(type, callback) { documentListeners.set(type, callback); }, removeEventListener(type) { documentListeners.delete(type); } };
  const state = { typeScope: mode, importMode: mode, importCategoryId: undefined };
  const controller = mountUnifiedImport({
    document, state, api: {}, closeDialog() { dialog.open = false; }, openLegacy() {},
    icon: () => '', escapeHtml: value => String(value ?? ''), categorySelects: { enhance() {} },
    preferences: { get: () => ({ preferExistingPreview: true, customPreview: false, previewResolution: 512 }) },
    defaultImportCategory: selectedMode => 'default-' + selectedMode,
    importCategoryOptions: (_mode, selected) => `<option value="${selected || ''}" selected>${selected || '未分类'}</option>`,
    run: async (...args) => { submissions.push(args); return { added: 1, failed, selection: selection(remainder) }; },
    refresh: async () => {}, busy: value => { state.busy = value; }, toast() {}, onError: error => errors.push(error),
  });
  return { controller, state, content, dialog, nodes, errors, submissions, names, documentListeners };
}

test('failed effects keep their effect mode, chosen destination and current preview settings', async () => {
  const ui = fixture({ names: ['done.fla', 'retry.fla', 'music.wav'], remainder: ['retry.fla', 'music.wav'], failed: [{ file: 'retry.fla', error: '占用' }] });
  await ui.controller.acceptSelection(selection(ui.names));
  ui.nodes['#import-category'].value = ui.state.importCategoryId = 'chosen-effects';
  ui.nodes['#prefer-preview'].checked = false;
  ui.nodes['#custom-preview-resolution'].checked = true;
  ui.nodes['#preview-resolution'].value = '2048';
  ui.controller.handle('confirm-import', { dataset: {} }); await flush();
  assert.deepEqual(ui.errors, []);
  assert.equal(ui.state.importMode, 'effect');
  assert.equal(ui.content.dataset.importMode, 'effect');
  assert.equal(ui.state.importCategoryId, 'chosen-effects');
  assert.equal(ui.nodes['#import-category'].value, 'chosen-effects');
  assert.equal(ui.nodes['#prefer-preview'].checked, false);
  assert.equal(ui.nodes['#custom-preview-resolution'].checked, true);
  assert.equal(ui.nodes['#preview-resolution'].value, '2048');
  assert.equal(ui.dialog.open, true);
  ui.controller.dispose();
});

test('remaining failed images stay in image mode even when audio is next in detection order', async () => {
  const ui = fixture({ names: ['done.png', 'retry.png', 'music.wav'], remainder: ['retry.png', 'music.wav'], mode: 'image', failed: [{ file: 'retry.png', error: '占用' }] });
  await ui.controller.acceptSelection(selection(ui.names));
  ui.controller.configure('image');
  ui.nodes['#import-category'].value = ui.state.importCategoryId = 'chosen-images';
  ui.controller.handle('confirm-import', { dataset: {} }); await flush();
  assert.deepEqual(ui.errors, []);
  assert.equal(ui.state.importMode, 'image');
  assert.equal(ui.state.importCategoryId, 'chosen-images');
  assert.equal(ui.nodes['#import-category'].value, 'chosen-images');
  ui.controller.dispose();
});

test('a fully consumed type advances to remaining media with a fresh compatible destination', async () => {
  const ui = fixture({ names: ['done.fla', 'music.wav'], remainder: ['music.wav'] });
  await ui.controller.acceptSelection(selection(ui.names));
  ui.nodes['#import-category'].value = ui.state.importCategoryId = 'chosen-effects';
  ui.controller.handle('confirm-import', { dataset: {} }); await flush();
  assert.deepEqual(ui.errors, []);
  assert.equal(ui.state.importMode, 'audio');
  assert.equal(ui.content.dataset.importMode, 'audio');
  assert.equal(ui.state.importCategoryId, 'default-audio');
  assert.equal(ui.nodes['#prefer-preview'], null);
  ui.controller.dispose();
});

test('image folder grouping is opt in, explains subfolders and survives type changes and failed retries', async () => {
  const ui = fixture({ names: ['retry.png', 'music.wav'], remainder: ['retry.png', 'music.wav'], mode: 'image', failed: [{ file: 'retry.png', error: '占用' }] });
  await ui.controller.acceptSelection(selection(ui.names));
  ui.controller.configure('image');
  assert.equal(ui.nodes['#import-group-by-folder']?.checked, false);
  assert.match(ui.content.markup, /一个文件夹作为一个分组/);
  assert.match(ui.content.markup, /子文件夹/);
  ui.nodes['#import-group-by-folder'].checked = true;
  ui.documentListeners.get('change')?.({ target: ui.nodes['#import-group-by-folder'] });
  ui.controller.configure('audio');
  assert.equal(ui.nodes['#import-group-by-folder'], null);
  ui.controller.configure('image');
  assert.equal(ui.nodes['#import-group-by-folder']?.checked, true);
  ui.controller.handle('confirm-import', { dataset: {} }); await flush();
  assert.deepEqual(ui.errors, []);
  assert.equal(ui.submissions[0][2].groupByFolder, true);
  assert.equal(ui.nodes['#import-group-by-folder']?.checked, true);
  // A category dialog replaces the import markup, so the change listener must
  // retain the choice until configuring the same staged selection again.
  ui.content.innerHTML = '<form>新建分类</form>';
  ui.controller.configure('image', { preserveTarget: true });
  assert.equal(ui.nodes['#import-group-by-folder']?.checked, true);
  ui.controller.dispose();
  assert.equal(ui.documentListeners.has('change'), false);
});

test('a new selection resets folder grouping, and audio never submits the image option', async () => {
  const ui = fixture({ names: ['one.png', 'music.wav'], remainder: [], mode: 'image' });
  await ui.controller.acceptSelection(selection(ui.names)); ui.controller.configure('image');
  ui.nodes['#import-group-by-folder'].checked = true;
  ui.documentListeners.get('change')?.({ target: ui.nodes['#import-group-by-folder'] });
  await ui.controller.acceptSelection(selection(ui.names)); ui.controller.configure('image');
  assert.equal(ui.nodes['#import-group-by-folder']?.checked, false);
  ui.controller.configure('audio'); ui.controller.handle('confirm-import', { dataset: {} }); await flush();
  assert.equal(Object.hasOwn(ui.submissions[0][2], 'groupByFolder'), false);
  ui.controller.dispose();
});
