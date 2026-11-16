import test from 'node:test';
import assert from 'node:assert/strict';
import { createUpdatePromptPreferences, createStartupUpdatePrompt, UPDATE_PROMPT_STORAGE_KEY } from './update-prompt.mjs';

const day = 86400000;
function storage() { const values = new Map(); return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) }; }

test('update reminders default to seven days and only a real available release prompts', () => {
  const preferences = createUpdatePromptPreferences({ getStorage: () => storage(), now: () => 1000 });
  assert.deepEqual(preferences.get(), { days: 7, snoozedUntil: 0 });
  for (const status of ['current', 'offline', 'unsupported', 'checking']) assert.equal(preferences.shouldPrompt({ status }), false);
  assert.equal(preferences.shouldPrompt({ status: 'available' }), true);
});

test('custom days and suppression persist, suppress every release, and expire at the exact boundary', () => {
  const saved = storage(); let now = 10000;
  let preferences = createUpdatePromptPreferences({ getStorage: () => saved, now: () => now });
  assert.equal(preferences.snooze(13), true);
  assert.deepEqual(preferences.get(), { days: 13, snoozedUntil: now + 13 * day });
  preferences = createUpdatePromptPreferences({ getStorage: () => saved, now: () => now });
  assert.equal(preferences.shouldPrompt({ status: 'available', latestVersion: '0.9.0' }), false);
  now += 13 * day - 1;
  assert.equal(preferences.shouldPrompt({ status: 'available', latestVersion: '1.0.0' }), false);
  now++;
  assert.equal(preferences.shouldPrompt({ status: 'available' }), true);
  assert.equal(preferences.get().days, 13);
});

test('bad input never overwrites a valid reminder preference and corrupt storage falls back safely', () => {
  const saved = storage();
  saved.setItem(UPDATE_PROMPT_STORAGE_KEY, '{bad');
  const preferences = createUpdatePromptPreferences({ getStorage: () => saved, now: () => 1000 });
  for (const value of [0, -1, 366, 1.5, NaN, Infinity, '', '7', null]) assert.equal(preferences.snooze(value), false);
  assert.deepEqual(preferences.get(), { days: 7, snoozedUntil: 0 });
  assert.equal(preferences.setDays(1), true); assert.equal(preferences.snooze(365), true);
  assert.equal(preferences.get().snoozedUntil, 1000 + 365 * day);
  saved.setItem(UPDATE_PROMPT_STORAGE_KEY, JSON.stringify({ days: 999, snoozedUntil: 'tomorrow' }));
  assert.deepEqual(createUpdatePromptPreferences({ getStorage: () => saved }).get(), { days: 7, snoozedUntil: 0 });
});

test('unavailable storage keeps the current session reminder choice working', () => {
  const preferences = createUpdatePromptPreferences({ getStorage() { throw new Error('denied'); }, now: () => 1000 });
  assert.equal(preferences.snooze(3), true);
  assert.equal(preferences.shouldPrompt({ status: 'available' }), false);
  assert.equal(preferences.get().days, 3);
});

test('a malformed far-future pause cannot silence reminders indefinitely', () => {
  const saved = storage(); saved.setItem(UPDATE_PROMPT_STORAGE_KEY, JSON.stringify({ days: 7, snoozedUntil: Number.MAX_VALUE }));
  assert.equal(createUpdatePromptPreferences({ getStorage: () => saved, now: () => 1000 }).shouldPrompt({ status: 'available' }), true);
});

function promptFixture() {
  let idle = true, enabled = true, shown = 0;
  const preferences = createUpdatePromptPreferences({ getStorage: () => storage(), now: () => 1000 });
  const prompt = createStartupUpdatePrompt({ preferences, isEnabled: () => enabled, canOpen: () => idle, open: () => { shown++; } });
  return { prompt, preferences, shown: () => shown, idle: value => { idle = value; }, enabled: value => { enabled = value; } };
}
test('startup prompts once, defers to active work, and does not poll or open twice on resume', () => {
  const f = promptFixture(); f.idle(false);
  f.prompt.consider({ status: 'available' }); assert.equal(f.shown(), 0);
  f.prompt.resume(); assert.equal(f.shown(), 0);
  f.idle(true); f.prompt.resume(); assert.equal(f.shown(), 1);
  f.prompt.resume(); f.prompt.consider({ status: 'available' }); assert.equal(f.shown(), 1);
});
test('no available update, disabled startup checks, and snoozed reminders never auto-open', () => {
  for (const status of ['current', 'offline', 'unsupported']) {
    const f = promptFixture(); f.prompt.consider({ status }); f.prompt.resume(); assert.equal(f.shown(), 0);
  }
  const disabled = promptFixture(); disabled.enabled(false); disabled.prompt.consider({ status: 'available' }); assert.equal(disabled.shown(), 0);
  const snoozed = promptFixture(); snoozed.preferences.snooze(7); snoozed.prompt.consider({ status: 'available' }); assert.equal(snoozed.shown(), 0);
});
test('manual viewing, disabling, disposal, or snoozing while deferred cancels the pending popup', () => {
  for (const action of ['cancel', 'dispose', 'disable', 'snooze']) {
    const f = promptFixture(); f.idle(false); f.prompt.consider({ status: 'available' });
    if (action === 'disable') f.enabled(false);
    else if (action === 'snooze') f.preferences.snooze(1);
    else f.prompt[action]();
    f.idle(true); f.prompt.resume(); assert.equal(f.shown(), 0, action);
  }
});
