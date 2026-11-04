/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
export function createConfirmation({ document }) {
  const node = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = text;
    return element;
  };
  const dialog = node('dialog', 'confirmation-dialog'); dialog.id = 'confirm-dialog';
  dialog.setAttribute('role', 'alertdialog'); dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'confirm-title'); dialog.setAttribute('aria-describedby', 'confirm-message confirm-detail');
  const header = node('div', 'confirm-heading'), mark = node('span', 'confirm-mark', '?'); mark.setAttribute('aria-hidden', 'true');
  const heading = node('div', 'confirm-heading-copy'), eyebrow = node('p', 'confirm-eyebrow', '操作确认');
  const title = node('h2', 'confirm-title'); title.id = 'confirm-title'; heading.append(eyebrow, title);
  const close = node('button', 'icon-button confirm-close', '×'); close.type = 'button'; close.setAttribute('aria-label', '取消并关闭确认');
  header.append(mark, heading, close);
  const message = node('div', 'confirm-message'); message.id = 'confirm-message';
  const detail = node('pre', 'confirm-detail'); detail.id = 'confirm-detail';
  const footer = node('div', 'confirm-footer'), hint = node('p', 'confirm-hint', '请您确认操作范围后再继续。');
  const actions = node('div', 'confirm-actions');
  const cancel = node('button', 'button secondary', '取消'); cancel.type = 'button'; cancel.dataset.confirm = 'cancel';
  const accept = node('button', 'button primary', '确认'); accept.type = 'button'; accept.dataset.confirm = 'accept';
  actions.append(cancel, accept); footer.append(hint, actions); dialog.append(header, message, detail, footer); document.body.append(dialog);
  let current = null, disposed = false;

  function restoreFocus(trigger) {
    let target = trigger;
    if (!target?.isConnected && trigger?.dataset?.action) {
      target = [...document.querySelectorAll('[data-action]')].find(element => element.dataset.action === trigger.dataset.action && element.dataset.id === trigger.dataset.id);
    }
    if (!target?.isConnected) target = document.querySelector('#search');
    target?.focus({ preventScroll: true });
  }
  function finish(accepted) {
    if (!current) return;
    const request = current; current = null;
    if (dialog.open) dialog.close();
    restoreFocus(request.trigger); request.resolve(accepted === true);
  }
  cancel.addEventListener('click', () => finish(false)); close.addEventListener('click', () => finish(false));
  accept.addEventListener('click', () => finish(true));
  dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
  dialog.addEventListener('close', () => { if (!dialog.open) finish(false); });
  dialog.addEventListener('keydown', event => event.stopPropagation());
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const box = dialog.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) finish(false);
  });
  return {
    isOpen: () => !!current,
    ask(options = {}) {
      if (disposed || current) return Promise.resolve(false);
      title.textContent = options.title || '确认操作'; dialog.dataset.tone = options.tone === 'danger' ? 'danger' : 'normal';
      mark.textContent = options.tone === 'danger' ? '!' : '?';
      message.replaceChildren(...String(options.message || '请您确认是否继续。').split(/\n+/).filter(Boolean).map((text, index) => node('p', index ? 'confirm-paragraph' : 'confirm-lead', text)));
      detail.textContent = options.detail || ''; detail.hidden = !options.detail;
      accept.textContent = options.confirmLabel || '确认'; cancel.textContent = options.cancelLabel || '取消';
      return new Promise(resolve => {
        current = { resolve, trigger: document.activeElement };
        try { dialog.showModal(); cancel.focus({ preventScroll: true }); } catch { finish(false); }
      });
    },
    dispose() { if (disposed) return; disposed = true; finish(false); dialog.remove(); },
  };
}
