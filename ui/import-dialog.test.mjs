/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { categoryAccepts, createCategoryCompatibility } from './category-compatibility.mjs';

const source = await fs.readFile(new URL('./app.js', import.meta.url), 'utf8');
const dialogCode = source.slice(source.indexOf('function importCategoryScope('), source.indexOf('function openImportFolderForm('));
function importDialog() {
  const nodes = { '#dialog': { showModal() {} } };
  const content = { dataset: {} };
  Object.defineProperty(content, 'innerHTML', { set(html) {
    content.markup = html;
    nodes['#import-category'] = { value: html.match(/<option value="([^"]*)" selected>/)?.[1] || '' };
    nodes['#prefer-preview'] = html.includes('id="prefer-preview"') ? { checked: true } : null;
    nodes['#custom-preview-resolution'] = null; nodes['#preview-resolution'] = null;
  } });
  nodes['#dialog-content'] = content;
  nodes['#dialog-content .import-options'] = { insertAdjacentHTML() { nodes['#custom-preview-resolution'] = { checked: false }; nodes['#preview-resolution'] = { value: '512', disabled: true }; } };
  const ordinary = { preferExistingPreview: false, customPreview: true, previewResolution: 2048 };
  const effect = { preferExistingPreview: true, customPreview: false, previewResolution: 1024 };
  const state = { category: 'people', snapshot: { categories: [{ id: 'people', scope: 'ordinary' }, { id: 'other', scope: 'ordinary' }, { id: 'flames', scope: 'effect' }] } };
  const context = { state, categoryAccepts, createCategoryCompatibility, $: selector => nodes[selector], closeDialog() {}, icon: () => '', categorySelects: { enhance() {} }, importPreferences: { get: mode => ({ ...(mode === 'effect' ? effect : ordinary) }) }, categoryOptions: (categories, selected) => categories.map(item => `<option value="${item.id}"${item.id === selected ? ' selected' : ''}>${item.id}</option>`).join('') };
  vm.runInNewContext(dialogCode + '\nthis.open = openImportDialog;', context);
  return { ...context, nodes };
}

test('opening an ordinary import restores its saved 2K controls', () => {
  const dialog = importDialog();
  dialog.open('ordinary');
  assert.equal(dialog.nodes['#prefer-preview'].checked, false);
  assert.equal(dialog.nodes['#custom-preview-resolution'].checked, true);
  assert.equal(dialog.nodes['#preview-resolution'].value, '2048');
  assert.equal(dialog.nodes['#preview-resolution'].disabled, false);
});

test('the explicit entry selects the import type and each opening follows the current compatible browsing category', () => {
  const dialog = importDialog();
  dialog.open('ordinary');
  assert.equal(dialog.state.importCategoryId, 'people');
  dialog.state.importCategoryId = 'old-destination';
  dialog.state.category = 'other';
  dialog.open('ordinary');
  assert.equal(dialog.state.importCategoryId, 'other');
  dialog.open('effect');
  assert.equal(dialog.state.importMode, 'effect');
  assert.equal(dialog.state.importCategoryId, undefined);
  assert.equal(dialog.nodes['#prefer-preview'].checked, true);
  assert.equal(dialog.nodes['#preview-resolution'].value, '1024');
  assert.equal(dialog.nodes['#preview-resolution'].disabled, true);
});

test('returning from category creation preserves this dialog destination and controls', () => {
  const dialog = importDialog();
  dialog.state.importCategoryId = 'new-child';
  dialog.open('ordinary', { preserveTarget: true, settings: { preferExistingPreview: true, customPreview: false, previewResolution: 256 } });
  assert.equal(dialog.state.importCategoryId, 'new-child');
  assert.equal(dialog.nodes['#prefer-preview'].checked, true);
  assert.equal(dialog.nodes['#custom-preview-resolution'].checked, false);
  assert.equal(dialog.nodes['#preview-resolution'].value, '256');
  assert.equal(dialog.nodes['#preview-resolution'].disabled, true);
});

test('audio import never loads FLA preview preferences', () => {
  const dialog = importDialog();
  dialog.importPreferences.get = () => { throw new Error('audio must not load preview preferences'); };
  dialog.open('audio');
  assert.equal(dialog.state.importMode, 'audio');
  assert.equal(dialog.nodes['#prefer-preview'], null);
  assert.equal(dialog.nodes['#preview-resolution'], null);
});

test('import destinations apply system-root semantics to legacy shared folders without changing their metadata', () => {
  const dialog = importDialog();
  dialog.state.snapshot.categories = [
    { id: 'people', scope: 'all', systemKey: 'character', parentId: null },
    { id: 'old-child', scope: 'all', parentId: 'people' },
    { id: 'effects', scope: 'all', systemKey: 'effect', parentId: null },
    { id: 'audio', scope: 'all', systemKey: 'audio', parentId: null },
    { id: 'free', scope: 'all', parentId: null },
    { id: 'invalid', scope: 'video', parentId: null },
  ];
  const before = structuredClone(dialog.state.snapshot.categories);
  dialog.state.category = 'old-child';
  dialog.open('ordinary');
  assert.equal(dialog.state.importCategoryId, 'old-child');
  let markup = dialog.nodes['#dialog-content'].markup;
  assert.match(markup, /value="people"/);
  assert.match(markup, /value="old-child" selected/);
  assert.match(markup, /value="free"/);
  assert.doesNotMatch(markup, /value="(?:effects|audio|invalid)"/);
  for (const [mode, root] of [['effect', 'effects'], ['audio', 'audio']]) {
    dialog.open(mode);
    assert.equal(dialog.state.importCategoryId, root);
    markup = dialog.nodes['#dialog-content'].markup;
    assert.match(markup, new RegExp(`value="${root}" selected`));
    assert.match(markup, /value="free"/);
    assert.doesNotMatch(markup, /value="(?:people|old-child|invalid)"/);
  }
  assert.deepEqual(dialog.state.snapshot.categories, before);
});

test('a project child stays the current destination for all three media modes', () => {
  const dialog = importDialog();
  dialog.state.snapshot.categories = [
    { id: 'project', scope: 'all', kind: 'project', parentId: null },
    { id: 'project-child', scope: 'all', parentId: 'project' },
  ];
  dialog.state.category = 'project-child';
  for (const mode of ['ordinary', 'effect', 'audio']) {
    dialog.open(mode);
    assert.equal(dialog.state.importCategoryId, 'project-child');
    assert.match(dialog.nodes['#dialog-content'].markup, /value="project-child" selected/);
  }
});
