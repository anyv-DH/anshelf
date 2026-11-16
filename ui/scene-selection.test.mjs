/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { selectAsset } from './model.js';

const source = await fs.readFile(new URL('./app.js', import.meta.url), 'utf8');
const handlers = source.slice(source.indexOf('function selectCard('), source.indexOf("document.addEventListener('click', event => { ['sort'"));
function fixture() {
  const state = {
    selected: new Set(), anchor: null, detail: null,
    visible: ['left', 'cover', 'right'], visibleSelection: ['left', 'cover', 'member', 'right'],
    visibleGroups: new Map([['room', ['cover', 'member']]]),
    snapshot: { sceneGroups: [{ id: 'room', assetIds: ['cover', 'member', 'hidden'] }] },
  };
  const cards = new Map(state.visible.map(id => [id, {
    dataset: { asset: id, ...(id === 'cover' ? { sceneGroup: 'room' } : {}) },
    matches: selector => selector === '.asset-card',
    closest: selector => selector === '.asset-card' ? cards.get(id) : null,
    focus() {},
  }]));
  const context = {
    state, selectAsset, document: { activeElement: { tagName: 'BODY' }, querySelector: () => null },
    $: selector => selector === '#dialog' ? { open: false } : selector.startsWith('[data-asset=') ? { focus() {} } : {},
    confirmation: { isOpen: () => false }, handleMenuKey: () => false,
    renderAll() {}, renderGrid() {}, renderSelection() {}, renderInspector() {}, updateAudioUI() {},
    getComputedStyle: () => ({ gridTemplateColumns: '200px 200px 200px' }), CSS: { escape: value => value },
  };
  vm.runInNewContext(handlers + '\nthis.selectCard = selectCard; this.handleKey = handleKey;', context);
  const event = (id, modifiers) => ({ target: cards.get(id), preventDefault() {}, ...modifiers });
  return {
    state,
    click: (id, modifiers = {}) => context.selectCard(event(id, modifiers)),
    key: (id, key, modifiers = {}) => context.handleKey(event(id, { key, ...modifiers })),
    selected: () => [...state.selected].sort(),
  };
}

test('arrow navigation selects all matching group members and leaves hidden members untouched', () => {
  const ui = fixture();
  ui.click('left'); ui.key('left', 'ArrowRight');
  assert.deepEqual(ui.selected(), ['cover', 'member']);
  assert.equal(ui.state.anchor, 'cover');
  ui.key('cover', 'ArrowRight'); assert.deepEqual(ui.selected(), ['right']);
});

test('shift click includes complete matched groups throughout the visible card range', () => {
  const ui = fixture();
  ui.click('left'); ui.click('right', { shiftKey: true });
  assert.deepEqual(ui.selected(), ['cover', 'left', 'member', 'right']);
  assert.equal(ui.state.anchor, 'left');
  ui.click('left'); ui.click('cover', { shiftKey: true });
  assert.deepEqual(ui.selected(), ['cover', 'left', 'member']);
  assert.equal(ui.state.anchor, 'left');
});

test('control click completes a partial group then toggles only its matching members', () => {
  const ui = fixture();
  ui.state.selected = new Set(['left', 'cover']);
  ui.click('cover', { ctrlKey: true });
  assert.deepEqual(ui.selected(), ['cover', 'left', 'member']);
  ui.click('cover', { ctrlKey: true }); assert.deepEqual(ui.selected(), ['left']);
});

test('shift arrows expand groups and control shift adds the range without losing other selection', () => {
  const ui = fixture();
  ui.click('left'); ui.key('left', 'ArrowRight', { shiftKey: true });
  assert.deepEqual(ui.selected(), ['cover', 'left', 'member']);
  assert.equal(ui.state.anchor, 'left');
  ui.state.selected = new Set(['right']); ui.state.anchor = 'left';
  ui.key('left', 'ArrowRight', { shiftKey: true, ctrlKey: true });
  assert.deepEqual(ui.selected(), ['cover', 'left', 'member', 'right']);
});

test('select all chooses current visible matched members only', () => {
  const ui = fixture();
  ui.state.selected = new Set(['hidden', 'off-page']);
  ui.key('left', 'a', { ctrlKey: true });
  assert.deepEqual(ui.selected(), ['cover', 'left', 'member', 'right']);
});

test('ordinary clicks and stale shift anchors retain existing single-card selection rules', () => {
  const ui = fixture();
  ui.click('left'); ui.click('right', { ctrlKey: true });
  assert.deepEqual(ui.selected(), ['left', 'right']);
  ui.click('right', { ctrlKey: true }); assert.deepEqual(ui.selected(), ['left']);
  ui.state.anchor = 'off-page'; ui.click('right', { shiftKey: true });
  assert.deepEqual(ui.selected(), ['right']);
});
