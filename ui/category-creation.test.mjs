/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { categoryScope } from './library-navigation.mjs';

const source = await fs.readFile(new URL('./app.js', import.meta.url), 'utf8');
const saveCode = source.slice(source.indexOf('async function saveCategory('), source.indexOf('async function deleteCategory('));

function fixture({ parentId = null, scope = 'all', fail = false, missingSnapshot = false } = {}) {
  const created = { id: 'new-root', name: '我的新分类', parentId, scope };
  const nodes = { '#category-name': { value: '  我的新分类  ' }, '#category-parent': { value: parentId || '' }, '#category-scope': { value: scope } };
  const state = { category: 'old', typeScope: 'effect', collection: 'favorites', selected: new Set(['old-asset']), detail: 'old-asset', snapshot: { categories: [{ id: 'old', name: '旧分类', parentId: null, scope: 'effect' }] } };
  const calls = [], rendered = [];
  let closed = false;
  const context = {
    state, categoryScope, $: selector => nodes[selector],
    async run(...args) { calls.push(args); if (fail) throw new Error('分类已存在'); return created; },
    async refresh() { if (!missingSnapshot) state.snapshot.categories.push(created); },
    closeDialog() { closed = true; }, toast() {},
    renderAll() { rendered.push({ category: state.category, typeScope: state.typeScope, collection: state.collection, selected: [...state.selected], detail: state.detail }); },
  };
  vm.runInNewContext(saveCode + '\nthis.save = saveCategory;', context);
  return { ...context, created, calls, rendered, isClosed: () => closed };
}

test('creating an ordinary top-level folder immediately selects it and clears previous selection and collection', async () => {
  const view = fixture();
  await view.save();
  assert.deepEqual(view.calls, [['createCategory', '我的新分类', null, 'all']]);
  assert.equal(view.state.category, view.created.id);
  assert.equal(view.state.typeScope, 'all', 'an all-media root must not inherit the previously selected effect filter');
  assert.equal(view.state.collection, 'all');
  assert.equal(view.state.selected.size, 0);
  assert.equal(view.state.detail, null);
  assert.equal(view.rendered.at(-1)?.category, view.created.id, 'the final render exposes the new root');
});

test('creating a typed top-level folder selects its own media scope', async () => {
  const view = fixture({ scope: 'audio' });
  await view.save();
  assert.equal(view.state.category, view.created.id);
  assert.equal(view.state.typeScope, 'audio');
});

test('committed root remains visible and selected when the next refresh has no new snapshot', async () => {
  const view = fixture({ missingSnapshot: true });
  await view.save();
  assert.deepEqual(view.state.snapshot.categories.find(item => item.id === view.created.id), view.created);
  assert.equal(view.state.category, view.created.id);
});

test('creating a child folder or renaming a category preserves current browsing and selection', async () => {
  for (const [options, id] of [[{ parentId: 'old' }, undefined], [{}, 'existing']]) {
    const view = fixture(options);
    await view.save(id);
    assert.equal(view.state.category, 'old');
    assert.equal(view.state.typeScope, 'effect');
    assert.equal(view.state.collection, 'favorites');
    assert.deepEqual([...view.state.selected], ['old-asset']);
    assert.equal(view.state.detail, 'old-asset');
    assert.equal(view.rendered.length, 0);
  }
});

test('failed category creation preserves the active folder and keeps the form available', async () => {
  const view = fixture({ fail: true });
  await view.save();
  assert.equal(view.state.category, 'old');
  assert.equal(view.state.collection, 'favorites');
  assert.deepEqual([...view.state.selected], ['old-asset']);
  assert.equal(view.isClosed(), false);
});
