/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

export const resetView = () => ({ scale: 1, x: 0, y: 0 });
export function fitSize(width, height, viewportWidth, viewportHeight) {
  if (!(width > 0 && height > 0 && viewportWidth > 0 && viewportHeight > 0)) return { width: 0, height: 0 };
  const ratio = Math.min(viewportWidth / width, viewportHeight / height);
  return { width: width * ratio, height: height * ratio };
}
export function zoomAt(view, scale, point) {
  const next = clamp(Number.isFinite(scale) ? scale : 1, .25, 8);
  const ratio = next / view.scale;
  return { scale: next, x: point.x - (point.x - view.x) * ratio, y: point.y - (point.y - view.y) * ratio };
}
export function panBy(view, dx, dy, image, viewport) {
  const limitX = Math.max(0, (image.width * view.scale + viewport.width) / 2 - 48);
  const limitY = Math.max(0, (image.height * view.scale + viewport.height) / 2 - 48);
  return { scale: view.scale, x: clamp(view.x + dx, -limitX, limitX), y: clamp(view.y + dy, -limitY, limitY) };
}

/** Owns one open lightbox. Disposing removes captures, wheel listeners and observers. */
export function mountPreviewViewer(root) {
  const viewport = root.querySelector('[data-preview-viewport]');
  const image = viewport?.querySelector('img');
  if (!image) return () => {};
  const listeners = new AbortController(), options = { signal: listeners.signal };
  const label = root.querySelector('[data-zoom-label]');
  let view = resetView(), fitted = { width: 0, height: 0 }, drag = null;
  const dimensions = () => ({ width: viewport.clientWidth, height: viewport.clientHeight });
  function render() {
    image.style.transform = `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    viewport.dataset.scale = String(view.scale);
    if (label) label.textContent = `${Math.round(view.scale * 100)}%`;
  }
  function fit() {
    const box = dimensions();
    fitted = fitSize(image.naturalWidth, image.naturalHeight, Math.max(0, box.width - 36), Math.max(0, box.height - 36));
    image.style.width = `${fitted.width}px`; image.style.height = `${fitted.height}px`;
    view = resetView(); render();
  }
  function zoom(scale, point = { x: 0, y: 0 }) {
    view = panBy(zoomAt(view, scale, point), 0, 0, fitted, dimensions()); render();
  }
  function reset() { view = resetView(); render(); }
  viewport.addEventListener('wheel', event => {
    event.preventDefault();
    const rect = viewport.getBoundingClientRect(), unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
    zoom(view.scale * Math.exp(-event.deltaY * unit * .0015), { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 });
  }, { ...options, passive: false });
  viewport.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault(); viewport.focus({ preventScroll: true });
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    viewport.setPointerCapture(event.pointerId); viewport.classList.add('is-panning');
  }, options);
  viewport.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    view = panBy(view, event.clientX - drag.x, event.clientY - drag.y, fitted, dimensions());
    drag.x = event.clientX; drag.y = event.clientY; render();
  }, options);
  function endDrag() { drag = null; viewport.classList.remove('is-panning'); }
  viewport.addEventListener('pointerup', endDrag, options);
  viewport.addEventListener('pointercancel', endDrag, options);
  viewport.addEventListener('lostpointercapture', endDrag, options);
  viewport.addEventListener('dblclick', reset, options);
  viewport.addEventListener('keydown', event => {
    const keys = ['+', '=', '-', '0', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    if (!keys.includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === '0') return reset();
    if (['+', '=', '-'].includes(event.key)) return zoom(view.scale * (event.key === '-' ? .8 : 1.25));
    view = panBy(view, event.key === 'ArrowLeft' ? -30 : event.key === 'ArrowRight' ? 30 : 0, event.key === 'ArrowUp' ? -30 : event.key === 'ArrowDown' ? 30 : 0, fitted, dimensions()); render();
  }, options);
  root.querySelectorAll('[data-zoom]').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.zoom === 'reset') reset(); else zoom(view.scale * (button.dataset.zoom === 'out' ? .8 : 1.25));
  }, options));
  image.addEventListener('load', fit, options);
  const observer = new ResizeObserver(fit); observer.observe(viewport);
  if (image.complete) fit();
  return () => {
    if (drag && viewport.hasPointerCapture(drag.id)) viewport.releasePointerCapture(drag.id);
    endDrag(); listeners.abort(); observer.disconnect();
  };
}
