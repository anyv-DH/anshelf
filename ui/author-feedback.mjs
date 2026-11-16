/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
export const AUTHOR_EMAIL = 'q17325759939@qq.com';

export function openAuthorFeedback({ document, closeDialog, icon }) {
  closeDialog();
  document.querySelector('#dialog-content').innerHTML = `<div class="dialog-heading"><div><div class="eyebrow">安屿动画</div><h2 id="dialog-title">反馈与交流群</h2></div><button class="icon-button" data-action="close-dialog" aria-label="关闭">${icon('close', 18)}</button></div><div class="author-feedback"><p class="feedback-free-notice"><strong>本软件开源免费。</strong>问题反馈、功能建议和加入交流群均与投喂无关，无需付费或投喂，不影响正常使用。</p><div class="author-feedback-grid"><section class="feedback-email-section" aria-labelledby="feedback-email-heading"><h3 id="feedback-email-heading">作者邮箱 · Bug 与功能建议</h3><p>欢迎您通过邮箱提交问题、功能建议或使用意见。</p><label for="author-feedback-email">作者邮箱</label><div class="feedback-email-row"><input id="author-feedback-email" type="text" value="${AUTHOR_EMAIL}" readonly spellcheck="false" aria-label="作者邮箱"><button type="button" class="button secondary" data-action="copy-author-email">复制邮箱</button></div><p id="author-feedback-copy-status" class="feedback-copy-status" role="status" aria-live="polite"></p><p class="feedback-send-hint">反馈 Bug 时，请尽量附上软件版本、复现步骤和问题截图，方便作者定位。</p></section><section class="feedback-community-section" aria-labelledby="feedback-community-heading"><h3 id="feedback-community-heading">QQ 交流群</h3><figure class="feedback-community-code"><img src="assets/community/qq-group.png" alt="安安素材管理器 QQ 交流群二维码"><figcaption>使用 QQ 扫描二维码加入交流群</figcaption></figure><p>欢迎您交流使用心得、反馈问题和提出功能建议。加群与投喂无关。</p></section></div></div><div class="dialog-actions"><button class="button primary" data-action="close-dialog">返回素材库</button></div>`;
  document.querySelector('#dialog').showModal();
}

export async function copyAuthorEmail({ document, clipboard = globalThis.navigator?.clipboard }) {
  const email = document.querySelector('#author-feedback-email');
  const status = document.querySelector('#author-feedback-copy-status');
  const button = document.querySelector('[data-action="copy-author-email"]');
  if (!document.querySelector('#dialog')?.open || !email || !status || !button || button.disabled) return false;
  const current = () => document.querySelector('#dialog')?.open && document.querySelector('#author-feedback-email') === email;
  button.disabled = true;
  status.textContent = '正在复制邮箱…';
  try {
    if (!clipboard?.writeText) throw new Error('Clipboard unavailable');
    await clipboard.writeText(AUTHOR_EMAIL);
    if (current()) status.textContent = '邮箱已复制，您可以粘贴到邮件收件人。';
    return true;
  } catch {
    if (current()) {
      status.textContent = '未能自动复制，已选中邮箱，请按 Ctrl+C 手动复制。';
      email.focus();
      email.select();
    }
    return false;
  } finally {
    button.disabled = false;
  }
}
