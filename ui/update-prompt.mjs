/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
export const UPDATE_PROMPT_STORAGE_KEY = 'anshelf-update-reminder';
const day = 86400000;
const validDays = value => Number.isInteger(value) && value >= 1 && value <= 365;

export function createUpdatePromptPreferences({ getStorage = () => globalThis.localStorage, now = Date.now } = {}) {
  let saved;
  try { saved = JSON.parse(getStorage()?.getItem(UPDATE_PROMPT_STORAGE_KEY) || '{}'); } catch { saved = {}; }
  let days = validDays(saved?.days) ? saved.days : 7;
  let snoozedUntil = Number.isFinite(saved?.snoozedUntil) && saved.snoozedUntil > 0 && saved.snoozedUntil <= now() + 365 * day ? saved.snoozedUntil : 0;
  function persist() {
    try { getStorage()?.setItem(UPDATE_PROMPT_STORAGE_KEY, JSON.stringify({ days, snoozedUntil })); } catch { /* retain current-session choice */ }
  }
  return {
    get: () => ({ days, snoozedUntil }),
    shouldPrompt: result => result?.status === 'available' && now() >= snoozedUntil,
    setDays(value) { if (!validDays(value)) return false; days = value; persist(); return true; },
    snooze(value) { if (!validDays(value)) return false; days = value; snoozedUntil = now() + value * day; persist(); return true; },
  };
}

// One startup result, resumed by dialog-close / idle events rather than polling.
export function createStartupUpdatePrompt({ preferences, isEnabled, canOpen, open }) {
  let considered = false, pending = null, disposed = false;
  function resume() {
    if (disposed || !pending) return;
    if (!isEnabled() || !preferences.shouldPrompt(pending)) { pending = null; return; }
    if (!canOpen()) return;
    pending = null;
    open();
  }
  return {
    consider(result) {
      if (disposed || considered) return;
      considered = true;
      pending = result;
      resume();
    },
    resume,
    cancel() { considered = true; pending = null; },
    dispose() { disposed = true; pending = null; },
  };
}
