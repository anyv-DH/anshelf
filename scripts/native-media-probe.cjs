/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
'use strict';
const { app, BrowserWindow, protocol, nativeImage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const { createMediaResponse } = require('../desktop/media.cjs');
const resultFile = process.argv[2];
protocol.registerSchemesAsPrivileged([{ scheme: 'anshelf', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-native-media-probe-'));
  let worker;
  try {
    await fs.mkdir(path.join(root, 'assets'));
    const samples = 24000, wav = Buffer.alloc(44 + samples * 2);
    wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24);
    wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
    for (let index = 0; index < samples; index++) wav.writeInt16LE(Math.round(500 * Math.sin(index * 2 * Math.PI * 440 / 8000)), 44 + index * 2);
    const hash = createHash('sha256').update(wav).digest('hex');
    const asset = { id: 'test-tone', hash, kind: 'audio', extension: '.wav', managedPath: `assets/${hash}.wav` };
    await fs.writeFile(path.join(root, asset.managedPath), wav);
    const requests = [];
    protocol.handle('anshelf', request => { requests.push({ range: request.headers.get('Range'), method: request.method }); return createMediaResponse(request, { root, getAsset: id => id === asset.id ? asset : null }); });
    worker = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required' } });
    await worker.loadURL('data:text/html,<meta http-equiv="Content-Security-Policy" content="default-src %27none%27; media-src anshelf:; script-src %27unsafe-inline%27"><audio id="audio" preload="metadata"></audio>');
    const result = await worker.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const audio = document.getElementById('audio');
      const timer = setTimeout(() => reject(new Error('Audio decode/seek timeout')), 10000);
      audio.onerror = () => { clearTimeout(timer); reject(new Error('Audio decoding failed: ' + audio.error?.code)); };
      audio.onloadedmetadata = () => { audio.currentTime = 1.25; };
      audio.onseeked = () => { clearTimeout(timer); resolve({duration:audio.duration,time:audio.currentTime,ready:audio.readyState}); };
      audio.src = 'anshelf://media/test-tone';
    })`);
    assert.equal(result.duration, 3);
    assert.ok(Math.abs(result.time - 1.25) < 0.01);
    const icon = nativeImage.createFromPath(path.join(__dirname, '../desktop/drag-audio.png'));
    assert.equal(icon.isEmpty(), false); assert.deepEqual(icon.getSize(), { width: 32, height: 32 });
    assert.deepEqual(await fs.readFile(path.join(root, asset.managedPath)), wav);
    if (resultFile) await fs.writeFile(resultFile, JSON.stringify({ ok: true, checks: 5, result, requests, sourceUnchanged: true }));
  } finally { if (worker && !worker.isDestroyed()) worker.destroy(); await fs.rm(root, { recursive: true, force: true }); }
  app.quit();
}).catch(async error => {
  if (resultFile) await fs.writeFile(resultFile, JSON.stringify({ ok: false, error: error.stack }));
  app.exit(1);
});
