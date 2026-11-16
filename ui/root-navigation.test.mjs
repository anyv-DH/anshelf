/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSidebar } from './render.js';
import { icon } from './icons.js';

function fixture() {
  const previous = globalThis.document;
  const navigation = {
    dataset: {}, innerHTML: '', scrollLeft: 0, scrollWidth: 900, clientWidth: 200,
    getBoundingClientRect: () => ({ left: 20, right: 220 }),
    querySelector() {
      const active = this.innerHTML.match(/<button[^>]*data-id="([^"]+)"[^>]*aria-current="page"/);
      if (!active) return null;
      const left = { all: 0, people: 80, custom: 450 }[active[1]];
      return { getBoundingClientRect: () => ({ left: 20 + left - this.scrollLeft, right: 100 + left - this.scrollLeft }) };
    },
  };
  const tree = { innerHTML: '', scrollTop: 30 };
  globalThis.document = { querySelector: selector => selector === '#navigation' ? navigation : tree };
  const state = {
    category: 'custom', typeScope: 'all', snapshot: { assets: [], categories: [
      { id: 'people', name: '人物', systemKey: 'character', parentId: null },
      { id: 'custom', name: '我的新分类', parentId: null },
      { id: 'child', name: '子文件夹', parentId: 'custom' },
    ] },
  };
  return { navigation, tree, state, dispose() { globalThis.document = previous; } };
}

test('ordinary custom root renders as the active folder and reveals itself within horizontal navigation', () => {
  const view = fixture();
  try {
    renderSidebar(view.state);
    const button = view.navigation.innerHTML.match(/<button[^>]*data-id="custom"[^>]*>[\s\S]*?<\/button>/)?.[0];
    assert.ok(button, 'the new top-level folder must be present');
    assert.match(button, /aria-current="page"/);
    assert.ok(button.includes(icon('folder')), 'custom roots use a folder icon');
    assert.equal(view.navigation.scrollLeft, 330, 'only the navigation scrolls enough to reveal the active folder');
    assert.equal(view.tree.scrollTop, 30, 'the separate category tree retains its position');
  } finally { view.dispose(); }
});

test('navigation keeps a manual horizontal position while selecting descendants and refreshes the current root', () => {
  const view = fixture();
  try {
    renderSidebar(view.state);
    view.navigation.scrollLeft = 100;
    view.state.category = 'child';
    renderSidebar(view.state);
    assert.equal(view.navigation.scrollLeft, 100, 'same-root rendering does not pull the user away from a manual scroll');
    view.state.category = 'people';
    renderSidebar(view.state);
    assert.equal(view.navigation.scrollLeft, 80, 'a newly selected root is revealed on the left too');
  } finally { view.dispose(); }
});

test('non-overflowing classic navigation leaves scroll positions unchanged', () => {
  const view = fixture();
  try {
    view.navigation.scrollWidth = view.navigation.clientWidth;
    renderSidebar(view.state);
    assert.equal(view.navigation.scrollLeft, 0);
    assert.equal(view.tree.scrollTop, 30);
  } finally { view.dispose(); }
});

test('root rendering respects local visibility and ordering while keeping the full category tree', () => {
  const view = fixture();
  try {
    view.state.category = 'people';
    view.state.rootNavigationPreferences = { hidden: ['custom'], order: ['custom', 'people'] };
    renderSidebar(view.state);
    assert.doesNotMatch(view.navigation.innerHTML, /data-id="custom"/);
    assert.match(view.tree.innerHTML, /data-category="custom"/, 'hidden navigation roots remain in the category tree');
    view.state.category = 'custom';
    renderSidebar(view.state);
    const current = view.navigation.innerHTML.match(/<button[^>]*data-id="custom"[^>]*>/)?.[0];
    assert.match(current, /root-temporary/);
    assert.match(current, /未常驻顶部/);
    assert.ok(view.navigation.innerHTML.indexOf('data-id="custom"') < view.navigation.innerHTML.indexOf('data-id="people"'));
  } finally { view.dispose(); }
});
