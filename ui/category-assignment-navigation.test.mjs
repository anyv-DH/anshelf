/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCategoryAssignmentNavigation, duplicateCategoryOptions } from './category-assignment-navigation.mjs';
import { renderSelection, renderSubcategories } from './render.js';

const categories = [
  { id: 'audio', name: '音频', systemKey: 'audio', scope: 'all', parentId: null },
  { id: 'hit', name: '打击', parentId: 'audio' },
  { id: 'legacy', name: '旧分类', scope: 'all', parentId: null },
  { id: 'legacy-child', name: '旧子类', parentId: 'legacy' },
  { id: 'project', name: '第一部剧', kind: 'project', scope: 'all', parentId: null },
  { id: 'cast', name: '角色', scope: 'ordinary', parentId: 'project' },
  { id: 'score', name: '配乐', scope: 'audio', parentId: 'project' },
  { id: 'people', name: '人物', systemKey: 'character', scope: 'all', parentId: null },
  { id: 'urban', name: '现代都市', parentId: 'people' },
  { id: 'male', name: '男', parentId: 'urban' },
  { id: 'female', name: '女', parentId: 'urban' },
  { id: 'effect', name: '特效', systemKey: 'effect', scope: 'all', parentId: null },
  { id: 'cross', name: '混合旧目录', scope: 'ordinary', parentId: null },
  { id: 'cross-audio', name: '旧音轨', scope: 'audio', parentId: 'cross' },
];
const ids = view => view.rows.map(row => row.id);

test('assignment starts at compatible roots in system, project and legacy order', () => {
  const navigation = createCategoryAssignmentNavigation(categories, ['ordinary']);
  const view = navigation.browse();
  assert.deepEqual(ids(view), ['people', 'project', 'legacy', 'cross']);
  assert.equal(view.parentId, null);
  assert.deepEqual(view.trail, []);
  assert.equal(view.canSelectCurrent, false);
  assert.equal(view.rows.find(row => row.id === 'people').hasChildren, true);
  assert.equal(view.rows.some(row => row.id === 'male'), false);
});

test('drilling down reveals only direct children and supplies a safe return path', () => {
  const navigation = createCategoryAssignmentNavigation(categories, ['ordinary']);
  const people = navigation.browse('people');
  assert.deepEqual(ids(people), ['urban']);
  assert.equal(people.backId, null);
  assert.equal(people.canSelectCurrent, true);
  const urban = navigation.browse('urban');
  assert.deepEqual(ids(urban), ['male', 'female']);
  assert.deepEqual(urban.trail.map(item => item.label), ['人物', '现代都市']);
  assert.equal(urban.backId, 'people');
  assert.ok(urban.rows.every(row => row.canSelect && !row.hasChildren));
});

test('mixed selections may use shared folders while typed branches stay restricted', () => {
  const navigation = createCategoryAssignmentNavigation(categories, ['ordinary', 'audio']);
  assert.deepEqual(ids(navigation.browse()), ['project', 'legacy']);
  const project = navigation.browse('project');
  assert.deepEqual(ids(project), []);
  assert.equal(project.canSelectCurrent, true);
  assert.deepEqual(ids(navigation.browse('legacy')), ['legacy-child']);
});

test('a nonselectable ancestor remains browsable when it leads to a compatible child', () => {
  const navigation = createCategoryAssignmentNavigation(categories, ['audio']);
  const row = navigation.browse().rows.find(item => item.id === 'cross');
  assert.equal(row.canSelect, false);
  assert.equal(row.hasChildren, true);
  const view = navigation.browse('cross');
  assert.equal(view.canSelectCurrent, false);
  assert.deepEqual(ids(view), ['cross-audio']);
  assert.equal(view.rows[0].canSelect, true);
});

test('search exposes matching descendant branches without flattening the tree', () => {
  const navigation = createCategoryAssignmentNavigation(categories, ['ordinary']);
  assert.deepEqual(ids(navigation.browse(null, '男')), ['people']);
  assert.deepEqual(ids(navigation.browse('people', '男')), ['urban']);
  assert.deepEqual(ids(navigation.browse('urban', '男')), ['male']);
  assert.deepEqual(ids(navigation.browse('urban', '不存在')), []);
  assert.deepEqual(ids(navigation.browse('urban', '人物')), ['male', 'female']);
});

test('search recognizes historic names and displayed system labels', () => {
  const navigation = createCategoryAssignmentNavigation(categories, ['audio']);
  assert.deepEqual(ids(navigation.browse(null, '音效')), ['audio']);
  assert.deepEqual(ids(navigation.browse(null, '音频')), ['audio']);
  assert.equal(navigation.browse().rows.find(row => row.id === 'audio').label, '音效');
});

test('images share ordinary destinations and empty or invalid selections expose no targets', () => {
  assert.deepEqual(ids(createCategoryAssignmentNavigation(categories, ['image']).browse()), ['people', 'project', 'legacy', 'cross']);
  for (const modes of [[], ['video'], ['ordinary', 'video']]) {
    const view = createCategoryAssignmentNavigation(categories, modes).browse('people');
    assert.deepEqual(ids(view), []);
    assert.equal(view.canSelectCurrent, false);
  }
});

test('stale parents, missing ancestors and cycles cannot become writable targets', () => {
  const malformed = categories.concat([
    { id: 'cycle-a', parentId: 'cycle-b' }, { id: 'cycle-b', parentId: 'cycle-a' },
    { id: 'orphan', parentId: 'missing-parent', scope: 'all' },
  ]);
  const navigation = createCategoryAssignmentNavigation(malformed, ['ordinary']);
  for (const parentId of ['gone', 'cycle-a', 'orphan']) {
    const view = navigation.browse(parentId);
    assert.equal(view.parentId, null);
    assert.deepEqual(ids(view), ['people', 'project', 'legacy', 'cross']);
  }
});

test('deep trees remain iterative and leave metadata untouched', () => {
  const deep = [{ id: 'root', name: '旧根', scope: 'all', parentId: null }];
  for (let index = 1; index !== 2500; index++) deep.push({ id: 'deep-' + index, name: '子类' + index, parentId: index === 1 ? 'root' : 'deep-' + (index - 1) });
  const before = JSON.stringify(deep);
  const navigation = createCategoryAssignmentNavigation(deep, ['ordinary']);
  assert.deepEqual(ids(navigation.browse(null, '子类2499')), ['root']);
  const leaf = navigation.browse('deep-2499');
  assert.equal(leaf.trail.length, 2500);
  assert.equal(leaf.canSelectCurrent, true);
  assert.deepEqual(ids(leaf), []);
  assert.equal(JSON.stringify(deep), before);
});

test('copy destinations distinguish inheritance, unclassified and a compatible category', () => {
  assert.deepEqual(duplicateCategoryOptions(categories, 'ordinary'), {});
  assert.deepEqual(duplicateCategoryOptions(categories, 'ordinary', { kind: 'inherit' }), {});
  assert.deepEqual(duplicateCategoryOptions(categories, 'ordinary', { kind: 'uncategorized' }), { categoryId: null });
  assert.deepEqual(duplicateCategoryOptions(categories, 'ordinary', { kind: 'category', categoryId: 'male' }), { categoryId: 'male' });
  assert.deepEqual(duplicateCategoryOptions(categories, 'audio', { kind: 'category', categoryId: 'project' }), { categoryId: 'project' });
  assert.deepEqual(duplicateCategoryOptions(categories, 'image', { kind: 'category', categoryId: 'people' }), { categoryId: 'people' });
});

test('invalid copy destinations are rejected before host work and cannot mutate metadata', () => {
  const before = JSON.stringify(categories);
  assert.throws(() => duplicateCategoryOptions(categories, 'ordinary', { kind: 'category', categoryId: 'gone' }), /分类/);
  assert.throws(() => duplicateCategoryOptions(categories, 'ordinary', { kind: 'category', categoryId: 'audio' }), /不匹配/);
  for (const choice of [null, 'people', { kind: 'unknown' }, { kind: 'category' }]) assert.throws(() => duplicateCategoryOptions(categories, 'ordinary', choice), /分类|选择/);
  assert.equal(JSON.stringify(categories), before);
});

function captureSelection(overrides = {}) {
  const previous = globalThis.document;
  const bar = { hidden: false, innerHTML: '', contains: () => false, querySelectorAll: () => [] };
  globalThis.document = { activeElement: null, querySelector: selector => selector === '#selection-bar' ? bar : null };
  const state = {
    category: 'all', typeScope: 'ordinary', selected: new Set(['asset']), visible: ['asset'],
    quickCategories: true, quickCategoryMode: 'move', quickCategoryQuery: '',
    snapshot: { categories, assets: [{ id: 'asset', name: '测试素材', kind: 'fla', assetType: 'ordinary', categoryIds: [] }] },
    ...overrides,
  };
  try { renderSelection(state); return bar.innerHTML; }
  finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
}
function categoryOptionsHtml(html) {
  const start = html.indexOf('class="quick-category-options"');
  assert.ok(start >= 0);
  return html.slice(html.indexOf('>', start) + 1, html.indexOf('</div>', start));
}

test('the selection renderer mounts roots first and enters folders before exposing children', () => {
  const roots = categoryOptionsHtml(captureSelection());
  assert.match(roots, /data-action="quick-browse-category" data-id="people"/);
  assert.doesNotMatch(roots, /data-id="(?:urban|male|female|cast|legacy-child)"/);
  const childHtml = captureSelection({ quickCategoryParentId: 'people' });
  const children = categoryOptionsHtml(childHtml);
  assert.match(children, /data-id="urban"/);
  assert.doesNotMatch(children, /data-id="(?:male|female|cast)"/);
  assert.match(childHtml, /归入当前分类/);
  assert.match(childHtml, /上一级/);
});

test('selection search retains the current level and add mode excludes unclassified', () => {
  const searched = categoryOptionsHtml(captureSelection({ quickCategoryQuery: '男' }));
  assert.match(searched, /data-id="people"/);
  assert.doesNotMatch(searched, /data-id="(?:male|female|urban|legacy)"/);
  const adding = captureSelection({ quickCategoryMode: 'add', quickCategoryParentId: 'urban' });
  assert.match(adding, /data-action="add-to-category" data-id="male"/);
  assert.doesNotMatch(adding, /data-action="assign"/);
  assert.doesNotMatch(adding, /未分类/);
});

test('the add-subcategory button sits beside folder tabs inside their scrolling row', () => {
  const previous = globalThis.document;
  const folders = { scrollLeft: 0 };
  const bar = { hidden: false, innerHTML: '', querySelector: selector => selector === '.subcategory-folders' ? folders : null };
  globalThis.document = { querySelector: selector => selector === '#subcategories' ? bar : null };
  try {
    renderSubcategories({ category: 'people', collection: 'all', snapshot: { categories, assets: [] } });
    const add = bar.innerHTML.indexOf('data-action="add-root-subcategory"');
    assert.ok(add >= 0);
    assert.ok(add < bar.innerHTML.indexOf('</div>'));
    assert.ok(add < bar.innerHTML.indexOf('subcategory-divider'));
  } finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
});
