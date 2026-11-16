/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
export function mountTopNavigation({ document, getLayout }) {
  const sidebar = document.querySelector('.sidebar');
  const navigationActions = document.querySelector('#navigation-actions');
  const toolbar = document.querySelector('.topbar');
  const actions = ['.import-entries', '.window-actions'].map(selector => document.querySelector(selector)).filter(Boolean);
  const panels = [
    { className: 'categories-open', selector: '[data-top-categories]', id: 'category-panel' },
    { className: 'more-open', selector: '[data-top-more]', id: 'top-more-panel' },
  ].map(item => ({ ...item, trigger: sidebar?.querySelector(item.selector), panel: sidebar?.querySelector('#' + item.id) }))
    .filter(item => item.trigger && item.panel);
  for (const item of panels) item.trigger?.setAttribute('aria-controls', item.id);
  let current = null, disposed = false;

  function close(layout = getLayout()) {
    for (const item of panels) {
      sidebar?.classList.remove(item.className);
      item.trigger?.setAttribute('aria-expanded', 'false');
    }
    current = null;
    const actionContainer = layout === 'modern' ? navigationActions : toolbar;
    if (actionContainer && actions.some(action => action.parentNode !== actionContainer)) actionContainer.append(...actions);
  }
  function toggle(item) {
    const wasOpen = current === item;
    close();
    if (wasOpen || !item.trigger || !item.panel) return;
    current = item;
    sidebar.classList.add(item.className);
    item.trigger.setAttribute('aria-expanded', 'true');
    const first = item.panel.querySelector('input:not(:disabled):not([type="hidden"]):not([hidden])')
      || item.panel.querySelector('button:not(:disabled), a[href], select:not(:disabled), [tabindex="0"]');
    first?.focus({ preventScroll: true });
  }
  function click(event) {
    if (disposed || getLayout() !== 'modern') return;
    const trigger = event.target.closest?.('[data-top-categories], [data-top-more]');
    const item = panels.find(value => value.trigger === trigger);
    if (item) { toggle(item); return; }
    if (!current) return;
    if (event.target.closest?.('[data-action="category"]')) {
      const restore = current.panel.contains(event.target) ? current.trigger : null;
      close();
      // Category rendering replaces the clicked button; this entry stays mounted.
      restore?.focus({ preventScroll: true });
    } else if (!current.panel.contains(event.target)) close();
  }
  function keydown(event) {
    if (disposed || getLayout() !== 'modern' || !current || event.key !== 'Escape' || event.target.closest?.('dialog')?.open) return;
    const trigger = current.trigger;
    close(); event.preventDefault(); event.stopPropagation();
    if (trigger.isConnected) trigger.focus({ preventScroll: true });
  }
  close();
  document.addEventListener('click', click);
  // Capture Escape before the document's application shortcut listener.
  document.addEventListener('keydown', keydown, true);
  return {
    close,
    dispose() {
      if (disposed) return;
      disposed = true; close();
      document.removeEventListener('click', click);
      document.removeEventListener('keydown', keydown, true);
    },
  };
}
