/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
'use strict';
const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createGifPoster } = require('../desktop/gif-poster.cjs');
const resultFile = process.argv[2];
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-gif-poster-probe-'));
  try {
    const create = createGifPoster({ BrowserWindow, ipcMain, nativeImage });
    const source = path.join(root, 'source.gif'), destination = path.join(root, 'poster.png');
    const fixture = Buffer.from('R0lGODlhAQABAIAAAP8AAAAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');
    await fs.writeFile(source, fixture);
    assert.equal(await create(source, destination), true);
    const poster = nativeImage.createFromPath(destination);
    assert.equal(poster.isEmpty(), false);
    assert.deepEqual(poster.getSize(), { width: 1, height: 1 });
    assert.deepEqual(await fs.readFile(source), fixture);
    await fs.writeFile(source, 'invalid-gif');
    await assert.rejects(create(source, path.join(root, 'bad.png')), /GIF文件格式/);
    if (resultFile) await fs.writeFile(resultFile, JSON.stringify({ ok: true, checks: 4, size: poster.getSize(), sourceUnchanged: true }));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
  app.quit();
}).catch(async error => {
  if (resultFile) await fs.writeFile(resultFile, JSON.stringify({ ok: false, error: error.stack }));
  app.exit(1);
});
