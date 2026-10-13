/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const DISTANCE = 6;
const point = event => ({ x: Number(event.clientX), y: Number(event.clientY) });

/** FLA gestures use the guarded desktop watcher; audio keeps native file drag. */
export function mountStageDrag({ root = document, shelf = globalThis.window?.shelf, getAsset = () => null, onError = () => {}, onState = () => {}, threshold = DISTANCE } = {}) {
  let active = null, disposed = false;
  const state = value => { if (!disposed) onState(value); };
  function releaseCapture(current) {
    try { current.handle.releasePointerCapture?.(current.pointerId); } catch {}
  }
  function clear(current) {
    releaseCapture(current);
    if (active === current) { active = null; state('idle'); }
  }
  function fail(current, error) {
    if (!disposed && active === current) { state('error'); onError(error); clear(current); }
  }
  function cancelToken(current) {
    if (!current.token || current.cancelSent) return;
    current.cancelSent = true;
    try {
      Promise.resolve(shelf?.cancelStageDrag?.(current.token)).catch(error => {
        if (!disposed && active === current && !current.resultReceived) fail(current, error);
      });
    } catch (error) { fail(current, error); }
  }
  function applyResult(current, result) {
    if (active !== current || result.token !== current.token) return;
    if(result.phase==='host-handoff'){
      current.nativeHandoff=true;
      releaseCapture(current);
      Promise.resolve(shelf?.confirmStageHandoff?.(current.token)).catch(error=>{
        if(active===current&&!current.resultReceived)fail(current,error);
      });
      state('dragging');
      return;
    }
    current.resultReceived = true;
    state(result.ok ? 'success' : result.cancelled ? 'cancelled' : 'error');
    if (!result.ok && !result.cancelled && result.error) onError(new Error(result.error));
    clear(current);
  }
  function cancel(current) {
    current.cancelled = true;
    releaseCapture(current);
    if (!current.started) clear(current);
    else if (current.token) { cancelToken(current); clear(current); }
  }
  function pointerdown(event) {
    if (disposed || active || event.button !== 0 || event.isPrimary === false) return false;
    const handle = event.target?.closest?.('[data-stage-drag-id]');
    const id = handle?.dataset?.stageDragId, asset = id ? getAsset(id) : null, origin = point(event);
    if (!handle || !id || !asset || asset.kind === 'audio' || !Number.isFinite(origin.x) || !Number.isFinite(origin.y)) return false;
    event.preventDefault?.();
    active = { handle, id, pointerId: event.pointerId, origin, started: false, pointerReleased: false, cancelled: false, token: null, earlyResult: null, begin: null };
    return true;
  }
  function pointermove(event) {
    const current = active, next = point(event);
    if (!current || current.pointerId !== event.pointerId || current.started || current.pointerReleased || !Number.isFinite(next.x) || !Number.isFinite(next.y) || Math.hypot(next.x - current.origin.x, next.y - current.origin.y) < threshold) return false;
    current.started = true;
    event.preventDefault?.();
    try { current.handle.setPointerCapture?.(event.pointerId); } catch {}
    state('starting');
    try {
      if (typeof shelf?.beginStageDrag !== 'function') throw new Error('请更新桌面版安安素材管理器后再拖到 AN 舞台。');
      // Invoke now while the mouse is still held; delaying helper startup
      // until a later task can miss a short gesture.
      current.begin = Promise.resolve(shelf.beginStageDrag(current.id)).then(info => {
        if (typeof info?.token !== 'string' || !info.token) throw new Error('舞台拖动准备失败，请重新拖动。');
        current.token = info.token;
        if (disposed || active !== current) { cancelToken(current); return; }
        if (current.earlyResult?.token === current.token) { applyResult(current, current.earlyResult); return; }
        if (current.cancelled) { cancelToken(current); clear(current); return; }
        state('dragging');
      }).catch(error => fail(current, error));
    } catch (error) { fail(current, error); }
    return true;
  }
  function pointerup(event) {
    const current = active;
    if (!current || current.pointerId !== event.pointerId) return false;
    if (current.pointerReleased) return true;
    current.pointerReleased = true;
    if (!current.started) { clear(current); return true; }
    event.preventDefault?.();
    releaseCapture(current);
    // A release before the native watcher is ready is cancellation.
    if (!current.token) { current.cancelled = true; return true; }
    if (!current.endSent) {
      current.endSent = true;
      try { Promise.resolve(shelf?.endStageDrag?.(current.token)).catch(error => fail(current, error)); }
      catch (error) { fail(current, error); }
    }
    return true;
  }
  function pointercancel(event) {
    if (!active || active.pointerId !== event.pointerId) return false;
    if(active.nativeHandoff){releaseCapture(active);return true;}
    cancel(active);
    return true;
  }
  function keydown(event) {
    if (event.key !== 'Escape' || !active) return false;
    event.preventDefault?.();
    cancel(active);
    return true;
  }
  function result(value) {
    if (!active || !value || typeof value.token !== 'string') return;
    if (!active.token) { active.earlyResult = value; return; }
    applyResult(active, value);
  }
  const listeners = [['pointerdown', pointerdown], ['pointermove', pointermove], ['pointerup', pointerup], ['pointercancel', pointercancel], ['keydown', keydown]];
  listeners.forEach(([name, listener]) => root.addEventListener(name, listener, true));
  const unsubscribe = shelf?.onStageDragResult?.(result);
  function dispose() {
    if (disposed) return;
    const current = active;
    if (current) { current.cancelled = true; releaseCapture(current); cancelToken(current); }
    disposed = true;
    active = null;
    unsubscribe?.();
    listeners.forEach(([name, listener]) => root.removeEventListener(name, listener, true));
  }
  return { pointerdown, pointermove, pointerup, pointercancel, keydown, result, dispose, get active() { return active; } };
}

export { DISTANCE };
