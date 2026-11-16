/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const margin = 12, gap = 12;
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, low, high) => Math.min(Math.max(value, low), Math.max(low, high));

function viewportFor(document) {
  return { width: finite(document.defaultView?.innerWidth, document.documentElement?.clientWidth || 0), height: finite(document.defaultView?.innerHeight, document.documentElement?.clientHeight || 0) };
}
function clippedRect(bounds, viewport) {
  if (!bounds) return null;
  const left = Math.max(0, finite(bounds.left)), top = Math.max(0, finite(bounds.top));
  const right = Math.min(viewport.width, finite(bounds.right, finite(bounds.left) + finite(bounds.width)));
  const bottom = Math.min(viewport.height, finite(bounds.bottom, finite(bounds.top) + finite(bounds.height)));
  if (right <= left || bottom <= top) return null;
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}
function visibleBounds(document, element) {
  if (!element || element.hidden || !element.getBoundingClientRect || (element.getClientRects && !element.getClientRects().length)) return null;
  const style = document.defaultView?.getComputedStyle?.(element);
  if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return null;
  return element.getBoundingClientRect();
}
function intersectRect(rect, region) {
  if (!rect || !region) return null;
  const left = Math.max(rect.left, region.left), top = Math.max(rect.top, region.top);
  const right = Math.min(rect.right, region.right), bottom = Math.min(rect.bottom, region.bottom);
  return right > left && bottom > top ? { left, top, right, bottom, width: right - left, height: bottom - top } : null;
}
function visiblePreviewCard(document, viewport) {
  const main = document.querySelector('.main');
  const mainBounds = visibleBounds(document, main);
  let region = main ? clippedRect(mainBounds, viewport) : { left: 0, top: 0, right: viewport.width, bottom: viewport.height };
  if (!region) return null;
  const toolbar = clippedRect(visibleBounds(document, document.querySelector('.library-toolbar')), viewport);
  if (toolbar && toolbar.left < region.right && toolbar.right > region.left) region = intersectRect(region, { ...region, top: Math.max(region.top, toolbar.bottom) });
  if (!region) return null;
  const cards = document.querySelectorAll?.('#asset-grid .asset-card') || [document.querySelector('#asset-grid .asset-card:first-child')];
  let best = null, bestArea = 0;
  for (let index = 0; index < cards.length; index++) {
    const element = cards[index], bounds = visibleBounds(document, element);
    const rect = intersectRect(clippedRect(bounds, viewport), region);
    if (!rect) continue;
    const candidate = { element, selector: index ? `#asset-grid .asset-card:nth-child(${index + 1})` : '#asset-grid .asset-card:first-child', rect };
    if (rect.width >= bounds.width - 0.5 && rect.height >= bounds.height - 0.5) return candidate;
    const area = rect.width * rect.height;
    if (area > bestArea) { best = candidate; bestArea = area; }
  }
  return best;
}

export function resolveOnboardingTarget(document, index) {
  const classic = document.documentElement?.dataset?.layout === 'classic';
  const selectors = [
    ['#navigation'], ['.import-entries'], classic ? ['#category-panel', '#categories', '#subcategories', '#navigation'] : ['#subcategories', '#navigation'],
    ['#empty-state .button', '#empty-state h2', '#empty-state'], ['#workspace-tools .workspace-tools-panel'], ['#browse'],
  ][index] || [];
  const viewport = viewportFor(document);
  if (index === 3) { const card = visiblePreviewCard(document, viewport); if (card) return card; }
  for (const selector of [...selectors, '#search', '.main']) {
    const element = document.querySelector(selector);
    const rect = clippedRect(visibleBounds(document, element), viewport);
    if (rect) return { element, selector, rect };
  }
  return null;
}

export function fitOnboardingPopover(targetRect, viewport, tooltip) {
  const width = Math.max(0, finite(viewport.width)), height = Math.max(0, finite(viewport.height));
  const cardWidth = Math.min(Math.max(0, finite(tooltip.width)), Math.max(0, width - margin * 2));
  const cardHeight = Math.min(Math.max(0, finite(tooltip.height)), Math.max(0, height - margin * 2));
  const target = clippedRect(targetRect, { width, height }) || { left: width / 2, right: width / 2, top: height / 2, bottom: height / 2, width: 0, height: 0 };
  const space = { bottom: Math.max(0, height - margin - target.bottom - gap), top: Math.max(0, target.top - gap - margin), right: Math.max(0, width - margin - target.right - gap), left: Math.max(0, target.left - gap - margin) };
  let placement;
  if (space.bottom >= cardHeight) placement = 'bottom';
  else if (space.top >= cardHeight) placement = 'top';
  else if (Math.max(space.right, space.left) >= cardWidth) placement = space.right >= space.left ? 'right' : 'left';
  else placement = ['bottom', 'top', 'right', 'left'].reduce((best, side) => space[side] / Math.max(1, side === 'top' || side === 'bottom' ? cardHeight : cardWidth) > space[best] / Math.max(1, best === 'top' || best === 'bottom' ? cardHeight : cardWidth) ? side : best);
  let left = target.left + (target.width - cardWidth) / 2, top = target.top + (target.height - cardHeight) / 2;
  if (placement === 'bottom') top = target.bottom + gap;
  if (placement === 'top') top = target.top - gap - cardHeight;
  if (placement === 'right') left = target.right + gap;
  if (placement === 'left') left = target.left - gap - cardWidth;
  return { left: clamp(left, margin, width - margin - cardWidth), top: clamp(top, margin, height - margin - cardHeight), placement };
}

export function mountOnboardingPosition({ document, dialog, highlight, card, getIndex }) {
  const window = document.defaultView;
  let active = false, disposed = false, frame = null, observer = null, observedTarget = null;
  function schedule() {
    if (disposed || !active || !dialog.open || frame !== null) return;
    if (!window?.requestAnimationFrame) { update(); return; }
    frame = window.requestAnimationFrame(() => { frame = null; update(); });
  }
  function stop() {
    if (frame !== null) window?.cancelAnimationFrame?.(frame); frame = null;
    if (active) { window?.removeEventListener('resize', schedule); window?.removeEventListener('scroll', schedule, true); }
    observer?.disconnect(); observer = null; observedTarget = null; active = false;
    highlight.hidden = true;
  }
  function start() {
    if (active) return;
    active = true; window?.addEventListener('resize', schedule); window?.addEventListener('scroll', schedule, true);
    if (window?.ResizeObserver) { observer = new window.ResizeObserver(schedule); observer.observe(card); if (document.documentElement) observer.observe(document.documentElement); }
  }
  function update() {
    if (disposed) return;
    if (!dialog.open) { stop(); return; }
    start();
    const target = resolveOnboardingTarget(document, getIndex()), viewport = viewportFor(document);
    if (target?.element !== observedTarget) {
      if (observedTarget && observer) {
        if (observer.unobserve) observer.unobserve(observedTarget);
        else { observer.disconnect(); observer.observe(card); if (document.documentElement) observer.observe(document.documentElement); }
      }
      observedTarget = target?.element || null;
      if (observedTarget) observer?.observe(observedTarget);
    }
    highlight.hidden = !target;
    highlight.dataset.targetSelector = target?.selector || ''; highlight.dataset.onboardingTarget = target?.selector || '';
    if (target) for (const name of ['left', 'top', 'width', 'height']) highlight.style[name] = `${target.rect[name]}px`;
    const size = card.getBoundingClientRect(), fit = fitOnboardingPopover(target?.rect, viewport, { width: size.width, height: size.height });
    card.style.left = `${fit.left}px`; card.style.top = `${fit.top}px`; card.dataset.placement = fit.placement;
  }
  const close = () => { if (!dialog.open) stop(); };
  dialog.addEventListener('close', close);
  return { update, dispose() { if (disposed) return; disposed = true; stop(); dialog.removeEventListener('close', close); } };
}
