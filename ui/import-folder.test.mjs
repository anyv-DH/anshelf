/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('./app.js', import.meta.url), 'utf8');
const saveCode = source.slice(source.indexOf('async function saveImportFolder('), source.indexOf('function openCategoryDialog('));

function fixture({ delayed = false, fail = false, missingSnapshot = false } = {}) {
  const created = { id: 'new-folder', name: '本次新分类', parentId: 'parent', scope: 'ordinary' };
  const form = { dataset: { parentId: 'parent' }, isConnected: true };
  const dialog = { open: true };
  const nodes = { '.import-folder-form': form, '#dialog': dialog, '#import-folder-name': { value: '本次新分类' }, '#prefer-preview': { checked: false }, '#custom-preview-resolution': { checked: true }, '#preview-resolution': { value: '2048' }, '#search': { value: '不匹配的旧搜索' }, '#category-filter': { value: '旧分类筛选' } };
  const state = { importMode: 'ordinary', importCategoryId: 'parent', category: 'effects', typeScope: 'effect', query: '不匹配的旧搜索', categoryQuery: '旧分类筛选', selected: new Set(['old-asset']), detail: 'old-asset', favoriteCategory: 'all', snapshot: { categories: [{ id: 'parent', scope: 'ordinary' }] } };
  const calls = [], reopened = [];
  let releaseRefresh, reachedRefresh;
  const enteredRefresh = new Promise(resolve => { reachedRefresh = resolve; });
  const refreshGate = delayed ? new Promise(resolve => { releaseRefresh = resolve; }) : Promise.resolve();
  const context = {
    state, $: selector => nodes[selector],
    busy: value => { state.busy = value; },
    async run(...args) { calls.push(args); state.busy = true; try { if (fail) throw new Error('分类已存在'); return created; } finally { state.busy = false; } },
    async refresh() { reachedRefresh(); await refreshGate; if (!missingSnapshot) state.snapshot.categories.push(created); },
    openImportDialog(mode, options) { reopened.push({ mode, options }); },
    toast() {}, renderAll() {},
  };
  vm.runInNewContext(saveCode + '\nthis.save = saveImportFolder;', context);
  return { ...context, calls, reopened, created, form, dialog, nodes, enteredRefresh, releaseRefresh };
}

test('folder creation stays busy through refresh and ignores a repeated Enter submission', async () => {
  const view = fixture({ delayed: true });
  const saving = view.save();
  await view.enteredRefresh;
  try {
    assert.equal(view.state.busy, true, 'the import action must not read the old destination while refresh is pending');
    await view.save();
    assert.equal(view.calls.length, 1, 'Enter cannot create the same folder a second time');
  } finally { view.releaseRefresh(); await saving; }
  assert.equal(view.state.busy, false);
});

test('a committed folder becomes visible in its own type and stays selected with 2K controls', async () => {
  const view = fixture();
  await view.save();
  assert.equal(view.state.importCategoryId, view.created.id);
  assert.equal(view.state.category, view.created.id);
  assert.equal(view.state.typeScope, 'ordinary');
  assert.equal(view.state.query, '');
  assert.equal(view.state.categoryQuery, '');
  assert.equal(view.nodes['#search'].value, '');
  assert.equal(view.nodes['#category-filter'].value, '');
  assert.equal(view.state.selected.size, 0);
  assert.equal(view.state.detail, null);
  assert.deepEqual(JSON.parse(JSON.stringify(view.reopened)), [{ mode: 'ordinary', options: { preserveTarget: true, settings: { preferExistingPreview: false, customPreview: true, previewResolution: 2048 } } }]);
});

test('a failed snapshot refresh cannot discard the successfully created import destination', async () => {
  const view = fixture({ missingSnapshot: true });
  await view.save();
  assert.deepEqual(view.state.snapshot.categories.find(category => category.id === view.created.id), view.created);
  assert.equal(view.state.importCategoryId, view.created.id);
});

test('closing the import dialog during category creation never reopens it after refresh', async () => {
  const view = fixture({ delayed: true });
  const saving = view.save();
  await view.enteredRefresh;
  view.dialog.open = false;
  view.releaseRefresh();
  await saving;
  assert.equal(view.reopened.length, 0);
  assert.equal(view.state.busy, false);
});

test('a category creation error preserves the original destination and allows retry', async () => {
  const view = fixture({ fail: true });
  await view.save();
  assert.equal(view.state.importCategoryId, 'parent');
  assert.equal(view.state.category, 'effects');
  assert.equal(view.state.typeScope, 'effect');
  assert.equal(view.reopened.length, 0);
  assert.equal(view.state.busy, false);
});
