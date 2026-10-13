/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHost } = require('../desktop/host.cjs');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

for (const outcome of ['success', 'failure']) {
  test(`sidecar reimport survives an older render ${outcome} queued behind a serial mutation`, { timeout: 10000 }, async t => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-render-commit-race-'));
    t.after(() => fs.rm(base, { recursive: true, force: true }));
    const source = path.join(base, 'hero.fla');
    await fs.writeFile(source, 'isolated-fla-fixture');
    const renderStarted = deferred(), finishRender = deferred();
    const mutationEntered = deferred(), finishMutation = deferred();
    const oldCommitQueued = deferred();
    const host = await createHost({
      root: path.join(base, 'library'),
      validateImage: async () => true,
      render: async () => {
        renderStarted.resolve();
        await finishRender.promise;
        if (outcome === 'failure') throw new Error('older renderer failed');
        return { previewPath: 'previews/older.png', previewFormat: 'png', previewAnimated: false };
      },
    });
    // Observe the commit enqueue boundary without replacing its implementation.
    // This prevents a timing-dependent delay from deciding whether the race ran.
    const setPreview = host.library.setPreview.bind(host.library);
    host.library.setPreview = (...args) => {
      const pending = setPreview(...args);
      const patch = args[1];
      if (patch.previewOrigin === 'rendered' || patch.previewStatus === 'failed') oldCommitQueued.resolve();
      return pending;
    };
    try {
      await host.api.importPaths([source]);
      await renderStarted.promise;
      await fs.writeFile(path.join(base, 'hero.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'));

      // Hold a real Library mutation while the sidecar import and the old render
      // result enqueue behind it. stale() still sees the previous pending state.
      const blocker = host.library.change(async () => {
        mutationEntered.resolve();
        await finishMutation.promise;
        return null;
      }, false);
      await mutationEntered.promise;
      const reimport = host.api.importPaths([source], { preferExistingPreview: true });
      finishRender.resolve();
      await oldCommitQueued.promise;
      finishMutation.resolve();
      await blocker;
      const imported = await reimport;
      await host.queue.idle();

      const asset = host.library.snapshot().assets[0];
      assert.equal(asset.previewStatus, 'ready', 'an old failure must not mark the newer sidecar failed');
      assert.equal(asset.previewOrigin, 'sidecar', 'an old result must not overwrite the newer user preview');
      assert.equal(asset.previewPath, imported.assets[0].previewPath);
      assert.equal(asset.previewRevision, imported.assets[0].previewRevision);
      assert.equal(asset.previewError, null);
    } finally {
      finishRender.resolve();
      finishMutation.resolve();
      await host.queue.idle();
      await host.library.queue;
    }
  });
}
