/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createUpdateChecker, releaseInfo, compareVersions, registerUpdateIpc } = require('../desktop/update-check.cjs');
const latest = version => ({ tag_name: 'v' + version, draft: false, prerelease: false, html_url: `https://github.com/anyv-DH/anshelf/releases/tag/v${version}` });

test('version checking compares numeric stable releases rather than lexical text', () => {
  assert.equal(compareVersions('0.3.10', '0.3.8'), 1);
  assert.equal(compareVersions('0.3.8', '0.3.8'), 0);
  assert.equal(compareVersions('0.3.7', '0.3.8'), -1);
  assert.throws(() => compareVersions('0.3.9-beta', '0.3.8'));
});

test('release metadata permits only stable releases from the official repository', () => {
  assert.deepEqual(releaseInfo(latest('0.3.9')), { latestVersion: '0.3.9', releaseUrl: latest('0.3.9').html_url });
  for (const bad of [null, { ...latest('0.3.9'), draft: true }, { ...latest('0.3.9'), prerelease: true }, { ...latest('0.3.9'), tag_name: 'v0.3.9-beta' }, { ...latest('0.3.9'), html_url: 'https://example.com/setup.exe' }]) assert.throws(() => releaseInfo(bad));
});

test('update checker shares requests and caches small results without polling', async () => {
  let calls = 0, time = 1000, resolve;
  const checker = createUpdateChecker({ version: '0.3.8', now: () => time, fetchRelease: async () => { calls++; await new Promise(done => { resolve = done; }); return latest('0.3.10'); } });
  const first = checker.check(), second = checker.check();
  assert.equal(calls, 1);
  resolve();
  assert.deepEqual(await first, await second);
  assert.equal((await checker.check()).status, 'available');
  assert.equal(calls, 1);
  time += 600001;
  const again = checker.check();
  assert.equal(calls, 2); resolve(); await again;
  checker.close();
});

test('same and older releases do not prompt an update', async () => {
  for (const version of ['0.3.7', '0.3.8']) {
    const checker = createUpdateChecker({ version: '0.3.8', fetchRelease: async () => latest(version) });
    assert.equal((await checker.check()).status, 'current'); checker.close();
  }
});

test('network, rate limit and invalid release failures keep the application usable', async () => {
  for (const fetchRelease of [async () => { throw new Error('HTTP 403 token=not-for-ui'); }, async () => ({ tag_name: 'malformed' })]) {
    const checker = createUpdateChecker({ version: '0.3.8', fetchRelease });
    const result = await checker.check();
    assert.equal(result.status, 'offline');
    assert.equal(result.currentVersion, '0.3.8');
    assert.ok(!JSON.stringify(result).includes('token='));
    checker.close();
  }
});

test('closing update checker aborts its only pending network request', async () => {
  const checker = createUpdateChecker({ version: '0.3.8', fetchRelease: async ({ signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) });
  const pending = checker.check(); checker.close();
  assert.equal((await pending).status, 'offline');
  assert.equal((await checker.check()).status, 'offline');
});

test('update IPC accepts only the manager and opens only its verified release page', async () => {
  const handlers = new Map(), opened = [], webContents = {};
  const checker = createUpdateChecker({ version: '0.3.8', fetchRelease: async () => latest('0.3.9') });
  registerUpdateIpc({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, webContents, checker, openExternal: async url => opened.push(url) });
  await assert.rejects(handlers.get('shelf:update-check')({ sender: {} }), /操作不允许/);
  await assert.rejects(handlers.get('shelf:update-open')({ sender: {} }), /操作不允许/);
  await assert.rejects(handlers.get('shelf:project-open')({ sender: {} }), /操作不允许/);
  await handlers.get('shelf:project-open')({ sender: webContents }, 'https://example.com/evil');
  assert.deepEqual(opened.splice(0), ['https://github.com/anyv-DH/anshelf']);
  await handlers.get('shelf:update-open')({ sender: webContents }, 'https://example.com/evil');
  assert.deepEqual(opened, ['https://github.com/anyv-DH/anshelf/releases/latest']);
  const result = await handlers.get('shelf:update-check')({ sender: webContents });
  assert.equal(result.status, 'available');
  await handlers.get('shelf:update-open')({ sender: webContents }, 'https://example.com/evil');
  assert.equal(opened[1], latest('0.3.9').html_url);
  checker.close();
});
