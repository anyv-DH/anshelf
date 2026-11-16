/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { AUTHOR_EMAIL, openAuthorFeedback, copyAuthorEmail } from './author-feedback.mjs';

function fixture() {
  const content = { innerHTML: '' };
  const dialog = { open: false, showModal() { this.open = true; } };
  const email = { value: 'q17325759939@qq.com', focused: false, selected: false, focus() { this.focused = true; }, select() { this.selected = true; } };
  const status = { textContent: '' };
  const button = { disabled: false };
  const nodes = { '#dialog': dialog, '#dialog-content': content, '#author-feedback-email': email, '#author-feedback-copy-status': status, '[data-action="copy-author-email"]': button };
  const document = { querySelector: selector => nodes[selector] };
  let closed = 0;
  const open = () => openAuthorFeedback({ document, closeDialog() { closed++; dialog.open = false; }, icon: () => '' });
  return { document, nodes, content, dialog, email, status, button, open, closed: () => closed };
}

test('feedback opens its own free-software dialog with the fixed author email and local QQ code', () => {
  const f = fixture(); f.open();
  assert.equal(f.closed(), 1);
  assert.equal(f.dialog.open, true);
  assert.equal(AUTHOR_EMAIL, 'q17325759939@qq.com');
  assert.match(f.content.innerHTML, /反馈与交流群/);
  assert.match(f.content.innerHTML, /本软件开源免费/);
  assert.match(f.content.innerHTML, /反馈、功能建议和加入交流群均与投喂无关/);
  assert.match(f.content.innerHTML, /无需付费或投喂/);
  assert.match(f.content.innerHTML, /q17325759939@qq[.]com/);
  assert.match(f.content.innerHTML, /Bug|问题反馈/);
  assert.match(f.content.innerHTML, /功能建议/);
  assert.match(f.content.innerHTML, /assets[/]community[/]qq-group[.]png/);
  assert.match(f.content.innerHTML, /QQ.*交流群/);
  assert.doesNotMatch(f.content.innerHTML, /qr-alipay|qr-wechat|收款|mailto:|https?:|data-action=.author-message|[你]/);
});

test('feedback email remains selectable with an accessible copy status and two closing controls', () => {
  const f = fixture(); f.open();
  assert.match(f.content.innerHTML, /id="author-feedback-email"[^>]*readonly/);
  assert.match(f.content.innerHTML, /aria-label="作者邮箱"/);
  assert.match(f.content.innerHTML, /data-action="copy-author-email"/);
  assert.match(f.content.innerHTML, /role="status" aria-live="polite"/);
  assert.equal((f.content.innerHTML.match(/data-action="close-dialog"/g) || []).length, 2);
});

test('copying reports success only after the fixed email reaches the clipboard', async () => {
  const f = fixture(); f.open(); let copied; let finish;
  const promise = copyAuthorEmail({ document: f.document, clipboard: { writeText(value) { copied = value; return new Promise(resolve => { finish = resolve; }); } } });
  assert.equal(copied, AUTHOR_EMAIL);
  assert.equal(f.button.disabled, true);
  assert.doesNotMatch(f.status.textContent, /已复制/);
  finish();
  assert.equal(await promise, true);
  assert.match(f.status.textContent, /邮箱已复制/);
  assert.equal(f.button.disabled, false);
});

test('clipboard rejection preserves visible email and selects it for manual copying', async () => {
  const f = fixture(); f.open();
  assert.equal(await copyAuthorEmail({ document: f.document, clipboard: { writeText() { throw new Error('denied'); } } }), false);
  assert.match(f.status.textContent, /未能自动复制/);
  assert.match(f.status.textContent, /Ctrl[+]C/);
  assert.equal(f.email.value, AUTHOR_EMAIL);
  assert.equal(f.email.focused, true);
  assert.equal(f.email.selected, true);
  assert.equal(f.button.disabled, false);
});

test('missing clipboard API offers the same manual copying fallback', async () => {
  const f = fixture(); f.open();
  assert.equal(await copyAuthorEmail({ document: f.document, clipboard: null }), false);
  assert.match(f.status.textContent, /Ctrl[+]C/);
  assert.equal(f.email.selected, true);
});

test('a late copy failure does not focus or overwrite a newly opened dialog', async () => {
  const f = fixture(); f.open(); let reject;
  const pending = copyAuthorEmail({ document: f.document, clipboard: { writeText() { return new Promise((resolve, fail) => { reject = fail; }); } } });
  const nextStatus = { textContent: '新弹窗' };
  f.nodes['#author-feedback-email'] = { value: 'other' };
  f.nodes['#author-feedback-copy-status'] = nextStatus;
  reject(new Error('late rejection'));
  assert.equal(await pending, false);
  assert.equal(nextStatus.textContent, '新弹窗');
  assert.equal(f.email.focused, false);
});

test('copying outside the feedback dialog or while already copying does nothing', async () => {
  const f = fixture(); let called = 0;
  const clipboard = { async writeText() { called++; } };
  assert.equal(await copyAuthorEmail({ document: f.document, clipboard }), false);
  f.open(); f.button.disabled = true;
  assert.equal(await copyAuthorEmail({ document: f.document, clipboard }), false);
  assert.equal(called, 0);
});

test('tools expose independent feedback and support actions through the shared application handler', async () => {
  const html = await fs.readFile(new URL('./index.html', import.meta.url), 'utf8');
  const app = await fs.readFile(new URL('./app.js', import.meta.url), 'utf8');
  assert.match(html, /data-action="author-feedback"/);
  assert.match(html, /data-action="author-message"/);
  assert.match(html, /href="author-feedback.css"/);
  assert.match(app, /actionName === 'author-feedback'/);
  assert.match(app, /actionName === 'copy-author-email'/);
});
