/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { openSupportAuthor } from './import-dialog-workspace.mjs';

function open() {
  const content = { innerHTML: '' }, dialog = { open: false, showModal() { this.open = true; } };
  let previousClosed = false;
  openSupportAuthor({
    document: { querySelector: selector => ({ '#dialog': dialog, '#dialog-content': content })[selector] },
    closeDialog() { previousClosed = true; dialog.open = false; },
    icon: () => '',
  });
  return { markup: content.innerHTML, dialog, previousClosed };
}

test('support dialog thanks the user politely and explains the voluntary gift without benefits', () => {
  const { markup, dialog, previousClosed } = open();
  assert.equal(previousClosed, true);
  assert.equal(dialog.open, true);
  assert.match(markup, /感谢您使用安安素材管理器/);
  assert.match(markup, /欢迎投喂作者一杯咖啡/);
  assert.match(markup, /本软件开源免费/);
  assert.match(markup, /投喂纯属自愿赠与，不换取任何商品、服务或虚拟礼物/);
  assert.match(markup, /无论是否投喂，都不影响软件的正常使用/);
  assert.doesNotMatch(markup, /你|筹备中|待填写/);
});

test('support dialog displays two clean local QR crops without usernames or payment labels', async () => {
  const { markup } = open();
  assert.equal((markup.match(/<img /g) || []).length, 2);
  assert.doesNotMatch(markup, /<figcaption|支付宝|微信支付|donate-(?:alipay|wechat)-small\.jpg/);
  const crops = [
    { name: 'alipay', size: 927, hash: 'f395ee6f532d74bfdce210b24a3ee5003be29b7bd4775178b27bf4407ea15cf0' },
    { name: 'wechat', size: 657, hash: 'a4bc04e577cd551fd70263f1e5819f16adab076c5141bcdfd46c12215f36c3df' },
  ];
  for (const item of crops) {
    const file = `assets/support/qr-${item.name}.png`;
    assert.ok(markup.includes(file));
    const bytes = await fs.readFile(new URL(file, import.meta.url));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(bytes.readUInt32BE(16), item.size);
    assert.equal(bytes.readUInt32BE(20), item.size);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), item.hash);
  }
  assert.doesNotMatch(markup, /https?:|src=.[/][/]/i);
});

test('support dialog retains untouched official reference images separately from presentation crops', async () => {
  const expected = [
    { name: 'alipay', hash: '47ed0c928924506ed582f09116b43fb7a2ce0827931d7abdece9bbd67257c676' },
    { name: 'wechat', hash: '8bafced4b484f59b679a8ca3e2665b853be38ba6925259a99555e24d95bcdaf0' },
  ];
  for (const item of expected) {
    const file = 'assets/support/donate-' + item.name + '-small.jpg';
    const bytes = await fs.readFile(new URL(file, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), item.hash);
  }
});

test('support dialog reuses the project action and provides clear ways to return to creation', () => {
  const { markup } = open();
  assert.match(markup, /data-action=.open-project-page.[^>]*>.*GitHub.*Star/s);
  assert.equal((markup.match(/data-action=.close-dialog./g) || []).length, 2);
  assert.match(markup, /aria-label=.关闭./);
  assert.match(markup, /继续创作/);
});
