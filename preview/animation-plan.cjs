/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const MAX_FRAMES = 60;
const MAX_SECONDS = 6;
const MAX_SOURCE_TICKS = 360;
const MAX_SIDE = 640;
const MAX_TOTAL_PIXELS = 24 * 1024 * 1024;

function animationFrameLimit(maxSide = MAX_SIDE) {
  const side = Number.isFinite(maxSide) && maxSide > 0 ? Math.floor(maxSide) : MAX_SIDE;
  return Math.max(1, Math.min(MAX_FRAMES, Math.floor(MAX_TOTAL_PIXELS / (side * side))));
}

function frames(timeline) {
  return Number.isFinite(timeline?.totalFrames) ? Math.max(1, Math.floor(timeline.totalFrames)) : 1;
}

function visibleLayers(timeline) {
  return (timeline?.layers ?? []).filter((layer, index) => layer.visible !== false
    && !['guide', 'folder', 'camera'].includes(layer.layerType)
    && !timeline.referenceLayers?.has(index));
}

function symbolFor(doc, name) {
  const exact = doc.symbols.get(name);
  if (exact) return exact;
  const normalized = String(name).replace(/\\/g, '/').replace(/^\.\//, '');
  for (const [key, symbol] of doc.symbols) if (key.replace(/\\/g, '/').replace(/^\.\//, '') === normalized) return symbol;
  return null;
}

// Only library symbols reached from this scene can extend independent playback.
// Graphics themselves follow their parent's clock; MovieClips have their own.
function independentDuration(doc, timeline, ancestors = new Set(), cache = new Map(), depth = 0) {
  if (depth > 64) return 1;
  let duration = 1;
  for (const layer of visibleLayers(timeline)) for (const frame of layer.frames ?? []) {
    for (const element of frame.elements ?? []) {
      if (element.type !== 'symbol' || element.isVisible === false || element.symbolType === 'button') continue;
      const symbol = symbolFor(doc, element.libraryItemName);
      if (!symbol || ancestors.has(symbol) || cache.size >= 1000) continue;
      let nested = cache.get(symbol);
      if (nested === undefined) {
        ancestors.add(symbol);
        nested = independentDuration(doc, symbol.timeline, ancestors, cache, depth + 1);
        ancestors.delete(symbol);
        cache.set(symbol, nested);
      }
      const start = Math.max(0, frame.index || 0);
      if (element.symbolType === 'movieclip') duration = Math.max(duration, start + Math.max(frames(symbol.timeline), nested));
      else if (nested > 1) duration = Math.max(duration, start + nested);
    }
  }
  return duration;
}

function createPlan(doc, animate = false, options = {}) {
  const maxSide = Number.isFinite(options.maxSide) ? Math.max(1, Math.floor(options.maxSide)) : MAX_SIDE;
  let scene = 0, startTick = 0, found = false;
  for (let s = 0; s < doc.timelines.length && !found; s++) {
    const populated = visibleLayers(doc.timelines[s]).flatMap(layer => layer.frames ?? [])
      .filter(frame => frame.elements?.length && Number.isInteger(frame.index) && frame.index >= 0);
    if (populated.length) { scene = s; startTick = Math.min(...populated.map(frame => frame.index)); found = true; }
  }
  const timeline = doc.timelines[scene];
  const rootFrames = frames(timeline);
  const frameRate = Number.isFinite(doc.frameRate) && doc.frameRate > 0 ? Math.max(1, Math.min(doc.frameRate, 10000)) : 24;
  if (!animate) return { scene, startTick, endTick: startTick + 1, rootFrames, frameRate, truncated: false, samples: [{ tick: startTick, delay: 0 }] };
  const wantedEnd = Math.max(rootFrames, independentDuration(doc, timeline));
  const span = Math.max(1, Math.min(wantedEnd - startTick, Math.floor(frameRate * MAX_SECONDS), MAX_SOURCE_TICKS));
  const endTick = startTick + span;
  const frameLimit = Number.isFinite(options.maxFrames) ? Math.max(1, Math.floor(options.maxFrames)) : animationFrameLimit(maxSide);
  const step = Math.max(1, frameRate / 10, span / frameLimit);
  const count = Math.min(frameLimit, Math.ceil(span / step));
  const ticks = Array.from({ length: count }, (_, index) => startTick + Math.floor(index * step));
  const samples = ticks.map((tick, index) => {
    const next = ticks[index + 1] ?? endTick;
    const beginning = Math.round((tick - startTick) / frameRate * 100) * 10;
    const ending = Math.round((next - startTick) / frameRate * 100) * 10;
    return { tick, delay: Math.max(20, ending - beginning) };
  });
  return { scene, startTick, endTick, rootFrames, frameRate, truncated: wantedEnd > endTick, reducedSampling: step > Math.max(1, frameRate / 10), samples };
}

function alphaBounds(data, width, height) {
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > 4) {
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
  }
  return right < 0 ? null : { left, top, right, bottom };
}

function unionBounds(a, b) {
  if (!a) return b;
  if (!b) return a;
  return { left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) };
}

function cropGeometry(bounds, maxSide = MAX_SIDE) {
  const sourceWidth = bounds.right - bounds.left + 1;
  const sourceHeight = bounds.bottom - bounds.top + 1;
  const padding = 16;
  const side = Number.isFinite(maxSide) ? Math.max(1, Math.floor(maxSide)) : MAX_SIDE;
  const scale = Math.min(1, (side - padding * 2) / Math.max(sourceWidth, sourceHeight));
  const drawWidth = Math.ceil(sourceWidth * scale), drawHeight = Math.ceil(sourceHeight * scale);
  return { ...bounds, sourceWidth, sourceHeight, padding, drawWidth, drawHeight, width: drawWidth + padding * 2, height: drawHeight + padding * 2 };
}

module.exports = { createPlan, alphaBounds, unionBounds, cropGeometry, animationFrameLimit, MAX_FRAMES, MAX_SECONDS, MAX_SOURCE_TICKS, MAX_SIDE, MAX_TOTAL_PIXELS };
