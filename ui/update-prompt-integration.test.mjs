/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source = await fs.readFile(new URL('./app.js', import.meta.url), 'utf8');
const checkCode = source.slice(source.indexOf('async function checkForUpdates('), source.indexOf('function openUpdateDialog('));
const openCode = source.slice(source.indexOf('function openUpdateDialog('), source.indexOf('async function openUpdatePage('));

test('update dialog places in-app updating before optional manual instructions', () => {
  assert.ok(openCode.indexOf('<div data-update-download-controls>') < openCode.indexOf('class="update-guide"'));
  assert.match(openCode, /<details class="update-guide"><summary>其他更新方式与说明<\/summary>/);
  assert.match(source, /点击“一键更新”/);
});

test('only the background startup check offers its result to the reminder controller', async () => {
  for (const manual of [false, true]) {
    const offered = [], calls = [];
    const context = { updateTimer: null, updatePromise: null, updateResult: { currentVersion: '0.3.17', status: 'idle' },
      window: { shelf: { async checkUpdates(options) { calls.push(options); return { status: 'available', latestVersion: '0.3.99' }; } } },
      renderUpdateBadge() {}, renderUpdateDialog() {}, startupUpdatePrompt: { consider: value => offered.push(value) } };
    vm.runInNewContext(checkCode + '\nthis.check = checkForUpdates;', context);
    const result = await context.check(manual);
    assert.equal(result.status, 'available');
    assert.equal(calls[0].manual, manual);
    assert.equal(offered.length, manual ? 0 : 1);
  }
});

test('automatic popup uses the completed result without a second request, while manual opening bypasses pending suppression', () => {
  for (const manual of [false, true]) {
    let checked = 0, cancelled = 0, shown = 0, rendered = 0;
    const content = { innerHTML: '' };
    const context = { closeDialog() {}, $: selector => selector === '#dialog' ? { showModal() { shown++; } } : content,
      icon: () => '', e: value => value, checkUpdatesOnStart: true,
      updatePromptPreferences: { get: () => ({ days: 7, snoozedUntil: 0 }) },
      startupUpdatePrompt: { cancel() { cancelled++; } },
      checkForUpdates() { checked++; }, renderUpdateDialog() { rendered++; }, pluginControls: { refresh() {} } };
    vm.runInNewContext(openCode + '\nthis.open = openUpdateDialog;', context);
    context.open(manual);
    assert.equal(shown, 1);
    assert.equal(checked, manual ? 1 : 0);
    assert.equal(cancelled, manual ? 1 : 0);
    assert.equal(rendered, 1);
    assert.match(content.innerHTML, /id="update-reminder-days"[^>]*min="1"[^>]*max="365"/);
    assert.match(content.innerHTML, /data-action="snooze-update"/);
  }
});
