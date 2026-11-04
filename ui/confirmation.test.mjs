/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfirmation } from './confirmation.mjs';

class Node extends EventTarget {
  constructor(tag, document) { super(); this.tagName = tag.toUpperCase(); this.ownerDocument = document; this.children = []; this.dataset = {}; this.attributes = {}; this.open = false; this.textContent = ''; }
  append(...children) { children.forEach(child => { child.parentNode = this; this.children.push(child); }); }
  replaceChildren(...children) { this.children.forEach(child => { child.parentNode = null; }); this.children = []; this.append(...children); }
  remove() { this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  get isConnected() { return this === this.ownerDocument.body || !!this.parentNode?.isConnected; }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatchEvent(new Event('close')); }
  focus() { this.ownerDocument.activeElement = this; }
  getBoundingClientRect() { return { left: 100, top: 100, right: 500, bottom: 400 }; }
}
function fixture() {
  const document = { createElement: tag => new Node(tag, document) };
  document.body = new Node('body', document);
  const find = predicate => { const all = []; const walk = item => { all.push(item); item.children.forEach(walk); }; walk(document.body); return all.filter(predicate); };
  document.querySelector = selector => find(node => node.id === selector.slice(1))[0] || null;
  document.querySelectorAll = selector => selector === '[data-action]' ? find(node => node.dataset.action) : [];
  const trigger = document.createElement('button'); trigger.dataset.action = 'remove'; document.body.append(trigger); trigger.focus();
  const confirmation = createConfirmation({ document });
  return { document, trigger, confirmation, find };
}
const click = (node, x = 150, y = 150) => { const event = new Event('click', { cancelable: true }); Object.defineProperties(event, { clientX: { value: x }, clientY: { value: y } }); node.dispatchEvent(event); };

test('themed confirmation uses safe text and only an explicit accept resolves true', async () => {
  const { document, trigger, confirmation, find } = fixture();
  const pending = confirmation.ask({ title: '移除分类', message: '请您确认。\n原件会保留。', detail: '<img onerror="bad">', confirmLabel: '确认移出分类', tone: 'danger' });
  const dialog = document.querySelector('#confirm-dialog');
  assert.equal(dialog.open, true); assert.equal(dialog.attributes.role, 'alertdialog');
  assert.equal(document.activeElement.dataset.confirm, 'cancel', 'default Enter must cancel');
  assert.equal(find(node => node.id === 'confirm-detail')[0].textContent, '<img onerror="bad">');
  assert.equal(find(node => node.tagName === 'IMG').length, 0);
  click(find(node => node.dataset.confirm === 'accept')[0]);
  assert.equal(await pending, true); assert.equal(dialog.open, false); assert.equal(document.activeElement, trigger);
});

test('cancel button, Escape, backdrop and external close never accept or execute an action', async () => {
  for (const mode of ['button', 'escape', 'backdrop', 'close']) {
    const { document, trigger, confirmation, find } = fixture();
    let executions = 0;
    const result = confirmation.ask({ title: '确认', message: '请您确认操作。' }).then(accepted => { if (accepted) executions++; return accepted; });
    const dialog = document.querySelector('#confirm-dialog');
    if (mode === 'button') click(find(node => node.dataset.confirm === 'cancel')[0]);
    if (mode === 'escape') { const event = new Event('cancel', { cancelable: true }); dialog.dispatchEvent(event); assert.equal(event.defaultPrevented, true); }
    if (mode === 'backdrop') { click(dialog, 200, 200); assert.equal(confirmation.isOpen(), true, 'clicking dialog padding is not a backdrop click'); click(dialog, 10, 10); }
    if (mode === 'close') dialog.close();
    assert.equal(await result, false, mode); assert.equal(executions, 0); assert.equal(document.activeElement, trigger);
  }
});

test('a second simultaneous request is cancelled without replacing or accepting the first', async () => {
  const { confirmation, find } = fixture();
  const first = confirmation.ask({ title: '第一个', message: '请您确认。' });
  assert.equal(await confirmation.ask({ title: '第二个', message: '请您确认。' }), false);
  assert.equal(find(node => node.id === 'confirm-title')[0].textContent, '第一个');
  click(find(node => node.dataset.confirm === 'cancel')[0]); assert.equal(await first, false);
});

test('cancelling an overlaid confirmation preserves the underlying editor and restores its trigger focus', async () => {
  const { document, confirmation } = fixture();
  const editor = document.createElement('dialog'); editor.id = 'dialog'; document.body.append(editor); editor.showModal();
  const trigger = document.createElement('button'); editor.append(trigger); trigger.focus();
  const result = confirmation.ask({ title: '删除分类', message: '请您确认。' });
  document.querySelector('#confirm-dialog').dispatchEvent(new Event('cancel', { cancelable: true }));
  assert.equal(await result, false); assert.equal(editor.open, true); assert.equal(document.activeElement, trigger);
});

test('focus restoration survives a refreshed trigger and disposal cancels pending work', async () => {
  const { document, trigger, confirmation } = fixture();
  const first = confirmation.ask({ title: '移除', message: '请您确认。' });
  trigger.remove(); const replacement = document.createElement('button'); replacement.dataset.action = 'remove'; document.body.append(replacement);
  document.querySelector('#confirm-dialog').close();
  assert.equal(await first, false); assert.equal(document.activeElement, replacement);
  const second = confirmation.ask({ title: '复制', message: '请您确认。' });
  confirmation.dispose(); assert.equal(await second, false); assert.equal(document.querySelector('#confirm-dialog'), null);
});
