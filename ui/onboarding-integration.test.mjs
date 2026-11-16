/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('./app.js', import.meta.url), 'utf8');
const html = await fs.readFile(new URL('./index.html', import.meta.url), 'utf8');

test('onboarding can be revisited from the shared tools menu in either layout', () => {
  assert.equal((html.match(/data-action="onboarding"/g) || []).length, 1);
  assert.match(html, /href="onboarding\.css"/);
  assert.match(source, /actionName === 'onboarding'/);
  assert.match(source, /onboardingControls\.open\(target\)/);
});

test('startup resumes the pending guide before a deferred release notification', () => {
  const start = source.indexOf('const resumeStartupUpdate =');
  const end = source.indexOf("document.addEventListener('close'", start);
  const calls = [], jobs = [];
  const context = {
    queueMicrotask: task => jobs.push(task),
    onboardingControls: { resume() { calls.push('guide'); } },
    startupUpdatePrompt: { resume() { calls.push('update'); } },
  };
  vm.runInNewContext(source.slice(start, end) + '\nthis.resume = resumeStartupUpdate;', context);
  context.resume();
  assert.deepEqual(calls, []);
  jobs.shift()();
  assert.deepEqual(calls, ['guide', 'update']);
  assert.match(source, /!onboardingControls\.pending\(\)/);
});

test('guide readiness, explicit handoffs and disposal use existing application operations', () => {
  assert.match(source, /mountOnboarding\(\{[\s\S]*?canOpen:.*state\.receivedSnapshot/);
  assert.match(source, /onboardingControls\.consider\(\);\s*pollRefresh\(\)/);
  assert.match(source, /if \(firstSnapshot\) resumeStartupUpdate\(\)/);
  assert.match(source, /onboardingControls\.dispose\(\)/);
  assert.match(source, /onAction: openOnboardingDestination/);
});

test('explicit import handoff stays busy until the existing import launcher has opened', async () => {
  const start = source.indexOf('async function openOnboardingDestination(');
  const end = source.indexOf('function updateAudioUI(', start);
  let resolve, busy = false, opened = false, bridges = 0;
  const errors = [];
  const context = { busy(value) { busy = value; }, errorToast: error => errors.push(error.message),
    unifiedImport: { open: () => new Promise(done => { resolve = () => { opened = true; done(); }; }) },
    openBridgeDialog: () => bridges++ };
  vm.runInNewContext(source.slice(start, end) + '\nthis.open = openOnboardingDestination;', context);
  const operation = context.open('import');
  assert.equal(busy, true); assert.equal(opened, false);
  resolve(); await operation;
  assert.equal(busy, false); assert.equal(opened, true);
  await context.open('bridge'); assert.equal(bridges, 1);
  context.unifiedImport.open = () => Promise.reject(new Error('unable to open'));
  await context.open('import'); assert.equal(busy, false); assert.deepEqual(errors, ['unable to open']);
});

test('a pending guide cannot suppress updates forever when the local library fails to load', () => {
  const start = source.indexOf('const startupUpdatePrompt =');
  const end = source.indexOf('const resumeStartupUpdate =', start);
  const context = { createStartupUpdatePrompt: options => options, updatePromptPreferences: {},
    checkUpdatesOnStart: true, state: { busy: false, receivedSnapshot: false },
    onboardingControls: { pending: () => true }, document: { querySelector: () => null, visibilityState: 'visible' },
    openUpdateDialog() {} };
  vm.runInNewContext(source.slice(start, end) + '\nthis.prompt = startupUpdatePrompt;', context);
  assert.equal(context.prompt.canOpen(), true);
  context.state.receivedSnapshot = true;
  assert.equal(context.prompt.canOpen(), false);
});
