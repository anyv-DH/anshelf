/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHost } = require('../desktop/host.cjs');

test('a slow Animate process probe cannot delay a completed import or offline preview', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-responsive-import-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const source = path.join(base, 'a.fla'); await fs.writeFile(source, 'a');
  let release, entered, committed = false;
  const gate = new Promise(resolve => release = resolve);
  const probing = new Promise(resolve => entered = resolve);
  const host = await createHost({ root: path.join(base, 'library'), render: async () => ({ previewPath: null }),
    ensureAnimateRunning: async () => { entered(); await gate; } });
  const importing = host.api.importPaths([source]).then(result => { committed = true; return result; });
  try {
    await probing; await host.queue.idle(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(committed, true, 'the import IPC must complete while the process probe is still pending');
  } finally { release(); await importing; await host.queue.idle(); }
});
