/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createGIF } = require('../preview/gif-encoder.cjs');

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHlcAAAAASUVORK5CYII=';
const staticResult = { png, width: 200, height: 100, frames: 24, frameRate: 24, scene: 0, frame: 0 };

async function setup(t, behavior, sourceSize = 32) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-preview-host-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'assets'));
  const source = path.join(root, 'assets', 'fixture.fla');
  await fs.writeFile(source, Buffer.alloc(32));
  if (sourceSize > 32) await fs.truncate(source, sourceSize);
  const events = new Map(), handles = new Map();
  const inputs = [], windows = [];
  let timer;
  class BrowserWindow {
    constructor() {
      this.webContents = { id: windows.length + 1, on: (name, callback) => this[name] = callback };
      windows.push(this);
    }
    isDestroyed() { return Boolean(this.destroyed); }
    destroy() { this.destroyed = true; }
    async loadFile() {
      const event = { sender: this.webContents };
      const input = await handles.get('preview:input')(event);
      inputs.push(input);
      await behavior({ input, done: result => events.get('preview:done')(event, result),
        checkpoint: result => events.get('preview:checkpoint')?.(event, result), timeout: () => timer(), crash: () => this['render-process-gone']() });
    }
  }
  const context = vm.createContext({
    require: name => name === 'electron' ? { BrowserWindow, ipcMain: { handle: (name, callback) => handles.set(name, callback), on: (name, callback) => events.set(name, callback) } }
      : name.startsWith('../core/') ? require('../core/' + name.slice('../core/'.length)) : require(name),
    module: { exports: {} }, __dirname: path.resolve(__dirname, '../desktop'), Buffer, Uint8Array,
    setTimeout: callback => { timer = callback; return 1; }, clearTimeout: () => {},
  });
  vm.runInContext(await fs.readFile(path.join(__dirname, '../desktop/previews.cjs'), 'utf8'), context);
  return { root, render: context.module.exports.createRenderer(root), inputs, windows, asset: { id: 'preview-test', managedPath: 'assets/fixture.fla', kind: 'fla', assetType: 'effect' } };
}

test('ordinary files stay PNG while effect previews write GIF and a PNG poster', async t => {
  const encoder = createGIF();
  encoder.append(new Uint8Array([255, 0, 0, 255]), 1, 1, 100);
  encoder.append(new Uint8Array([0, 0, 255, 255]), 1, 1, 100);
  const gif = Buffer.from(encoder.finish());
  const fixture = await setup(t, ({ input, done }) => done(input.animate ? { ...staticResult, gif: 'data:image/gif;base64,' + gif.toString('base64'), previewAnimated: true, previewFrameCount: 2, previewDurationMs: 200 } : staticResult));
  const effect = await fixture.render(fixture.asset);
  assert.equal(effect.previewFormat, 'gif');
  assert.equal(effect.previewPosterPath, 'previews/preview-test.png');
  assert.equal(effect.previewFrameCount, 2);
  assert.deepEqual(await fs.readFile(path.join(fixture.root, effect.previewPath)), gif);
  await fs.access(path.join(fixture.root, effect.previewPosterPath));
  const ordinary = await fixture.render({ ...fixture.asset, assetType: 'ordinary' });
  assert.equal(ordinary.previewFormat, 'png');
  assert.equal(ordinary.previewAnimated, false);
  assert.equal(fixture.inputs[1].animate, false);
});

test('large effect bypasses animation with an explicit static warning', async t => {
  const fixture = await setup(t, ({ input, done }) => done({ ...staticResult, previewWarning: input.warning }), 32 * 1024 * 1024 + 1);
  const result = await fixture.render(fixture.asset);
  assert.equal(fixture.inputs[0].animate, false);
  assert.equal(result.previewFormat, 'png');
  assert.match(result.previewWarning, /32MB/);
});

test('selected 2K size reaches the worker and output validation accepts it only when requested', async t => {
  const bytes = Buffer.from(png.split(',')[1], 'base64');
  bytes.writeUInt32BE(2048, 16);
  const large = { ...staticResult, png: 'data:image/png;base64,' + bytes.toString('base64') };
  const fixture = await setup(t, ({ done }) => done(large));
  const result = await fixture.render({ ...fixture.asset, previewResolution: 2048 });
  assert.equal(fixture.inputs[0].previewResolution, 2048);
  assert.equal(fixture.inputs[0].maxSide, 2048);
  const output = await fs.readFile(path.join(fixture.root, result.previewPath));
  assert.equal(output.readUInt32BE(16), 2048);
  await assert.rejects(fixture.render({ ...fixture.asset, previewResolution: 256 }), /尺寸/);
  await assert.rejects(fixture.render({ ...fixture.asset, previewResolution: 4096 }), /分辨率/);
});

test('oversized 2K animation pixel budget falls back to its selected-size PNG', async t => {
  const pngBytes = Buffer.from(png.split(',')[1], 'base64'); pngBytes.writeUInt32BE(2048, 16); pngBytes.writeUInt32BE(2048, 20);
  const encoder = createGIF(); encoder.append(new Uint8Array([255, 0, 0, 255]), 1, 1, 100);
  const gif = Buffer.from(encoder.finish()); gif.writeUInt16LE(2048, 6); gif.writeUInt16LE(2048, 8);
  const fixture = await setup(t, ({ done }) => done({ ...staticResult, png:'data:image/png;base64,'+pngBytes.toString('base64'),
    gif:'data:image/gif;base64,'+gif.toString('base64'),previewAnimated:true,previewFrameCount:60,previewDurationMs:6000 }));
  const result = await fixture.render({ ...fixture.asset, previewResolution:2048 });
  assert.equal(result.previewAnimated,false); assert.match(result.previewWarning,/动图/);
  const saved = await fs.readFile(path.join(fixture.root,result.previewPath)); assert.equal(saved.readUInt32BE(16),2048);
});

for (const interruption of ['timeout', 'crash']) test(`already available PNG survives animation ${interruption}`, async t => {
  const fixture = await setup(t, controls => { controls.checkpoint(staticResult); controls[interruption](); });
  const result = await fixture.render(fixture.asset);
  assert.equal(result.previewFormat, 'png');
  assert.match(result.previewWarning, /静态/);
  await fs.access(path.join(fixture.root, result.previewPath));
  assert.equal(fixture.windows[0].destroyed, true);
});

test('malformed animation output falls back to its valid PNG and audio does not enter the renderer', async t => {
  const fixture = await setup(t, ({ done }) => done({ ...staticResult, gif: 'data:image/gif;base64,AAAA', previewAnimated: true, previewFrameCount: 2, previewDurationMs: 200 }));
  const result = await fixture.render(fixture.asset);
  assert.equal(result.previewFormat, 'png');
  assert.match(result.previewWarning, /动图/);
  await assert.rejects(fixture.render({ ...fixture.asset, kind: 'audio' }), /音频/);
  assert.equal(fixture.windows.length, 1);
});

test('preview renderer rejects invalid IDs, escaping source paths and invalid PNG bytes', async t => {
  const fixture = await setup(t, ({ done }) => done({ ...staticResult, png: 'data:image/png;base64,AAAA' }));
  await assert.rejects(fixture.render({ ...fixture.asset, id: '../../unsafe' }), /标识/);
  await assert.rejects(fixture.render({ ...fixture.asset, managedPath: '../outside.fla' }), /路径/);
  await assert.rejects(fixture.render(fixture.asset), /预览/);
});

test('preview writes refuse linked cache destinations and leave external files intact', async t => {
  const fixture = await setup(t, ({ done }) => done(staticResult));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-preview-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.writeFile(path.join(outside, 'preview-test.png'), 'keep');
  await fs.symlink(outside, path.join(fixture.root, 'previews'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(fixture.render(fixture.asset), /链接/);
  assert.equal(await fs.readFile(path.join(outside, 'preview-test.png'), 'utf8'), 'keep');
});
