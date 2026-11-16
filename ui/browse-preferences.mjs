/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */

export const BROWSE_PREFERENCES_KEY = 'anshelf-browse-preferences';
// The first run uses the fixed, viewport-fitting preset. The low-level fixed/60
// shape remains accepted for older state and callers.
export const DEFAULT_BROWSE_PREFERENCES = Object.freeze({ mode: 'fit', pageSize: 'auto' });
export const BROWSE_MODE_OPTIONS = Object.freeze([
  { value: 'scroll', label: '滚动浏览' },
  { value: 'fit', label: '固定分页（自动适屏）' }
]);
const MODES = new Set(['fixed', 'fit', 'scroll']);
const FALLBACK_PAGE_SIZE = 60;

function positiveInteger(value, fallback, maximum = 1000) {
  const candidate = typeof value === 'number' || (typeof value === 'string' && value.trim()) ? Number(value) : NaN;
  return Number.isInteger(candidate) && candidate > 0 ? Math.min(maximum, candidate) : fallback;
}

function nonnegativeNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function normalizeBrowsePreferences(value) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    mode: MODES.has(input.mode) ? input.mode : DEFAULT_BROWSE_PREFERENCES.mode,
    pageSize: input.pageSize === 'auto' ? 'auto' : positiveInteger(input.pageSize, DEFAULT_BROWSE_PREFERENCES.pageSize)
  };
}

function storageOrNull(storage) {
  if (storage) return storage;
  try { return globalThis.localStorage; } catch { return null; }
}

export function loadBrowsePreferences(storage, key = BROWSE_PREFERENCES_KEY) {
  try {
    const value = storageOrNull(storage)?.getItem(key);
    return normalizeBrowsePreferences(value ? JSON.parse(value) : {});
  } catch {
    return normalizeBrowsePreferences({});
  }
}

export function saveBrowsePreferences(preferences, storage, key = BROWSE_PREFERENCES_KEY) {
  const normalized = normalizeBrowsePreferences(preferences);
  try { storageOrNull(storage)?.setItem(key, JSON.stringify(normalized)); } catch { /* Keep this session usable when storage is unavailable. */ }
  return normalized;
}

// A custom count is an upper limit in fit mode; keep its preference intact on small windows.
export function resolveBrowseLayout(preferences, measurements = {}) {
  const options = normalizeBrowsePreferences(preferences);
  const columns = positiveInteger(measurements.columns, 1, 64);
  const rowGap = nonnegativeNumber(measurements.rowGap, 16);
  const cardMinHeight = positiveInteger(measurements.cardMinHeight, 220, 2000);
  const cardChromeHeight = nonnegativeNumber(measurements.cardChromeHeight, 100);
  const availableHeight = nonnegativeNumber(measurements.availableHeight, null);
  const availableRows = availableHeight === null
    ? Math.max(1, Math.floor(FALLBACK_PAGE_SIZE / columns))
    : Math.max(1, Math.floor((availableHeight + rowGap) / (cardMinHeight + rowGap)));
  const fitCapacity = availableRows * columns;
  const requestedSize = options.pageSize === 'auto' ? fitCapacity : options.pageSize;
  const size = options.mode === 'fit' ? Math.min(requestedSize, fitCapacity) : requestedSize;
  const rows = Math.max(1, Math.ceil(size / columns));
  const cardHeight = options.mode === 'fit' && availableHeight !== null
    ? Math.max(0, Math.floor((availableHeight - rowGap * (rows - 1)) / rows)) : null;
  return {
    ...options, size, columns, rows, rowGap, fitCapacity, cardHeight,
    previewHeight: cardHeight === null ? null : Math.max(0, cardHeight - cardChromeHeight)
  };
}

export function applyBrowseLayout(grid, layout) {
  if (!grid) return;
  grid.dataset.browseMode = layout.mode;
  grid.dataset.browseRows = String(layout.rows);
  for (const [property, value] of [['--browse-card-height', layout.cardHeight], ['--browse-preview-height', layout.previewHeight]]) {
    if (value === null) grid.style.removeProperty(property);
    else grid.style.setProperty(property, String(value) + 'px');
  }
}

