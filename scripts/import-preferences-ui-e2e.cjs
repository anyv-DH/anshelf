/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { _electron } = require(process.env.ANSHELF_PLAYWRIGHT || 'playwright');
const { Library } = require('../core/library.cjs');
const { chooseThemedOption } = require('./ui-select.cjs');
const root = path.resolve(__dirname, '..');
const storageKey = 'anshelf-import-preview-preferences';

async function main() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-import-preferences-'));
  const data = path.join(temporary, 'library'), profile = path.join(temporary, 'profile');
  const output = path.join(root, 'test-output/import-preferences-ui');
  await fs.mkdir(output, { recursive: true });
  const library = await Library.open(data);
  const category = await library.createCategory('本次导入分类', null, 'ordinary');
  const source = path.join(temporary, '偏好测试.fla');
  const demo = (await fs.readdir(path.join(root, 'demo'))).find(name => name.endsWith('.fla'));
  await fs.copyFile(path.join(root, 'demo', demo), source);
  const sidecar = source.replace(/\.fla$/, '.png');
  await fs.writeFile(sidecar, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=', 'base64'));
  const originalBytes = await fs.readFile(source);
  const baseline = await fs.readFile(path.join(data, 'library.json'));
  const checks = [], errors = [];
  let app, page;
  async function launch() {
    app = await _electron.launch({
      executablePath: process.env.ANSHELF_UI_EXECUTABLE || require(path.join(root, 'node_modules/electron')),
      args: [...(process.env.ANSHELF_UI_EXECUTABLE ? [] : [root]), '--user-data-dir=' + profile],
      env: { ...process.env, ANSHELF_DATA_DIR: data }, timeout: 60000,
    });
    page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('[data-action="import"][data-mode="ordinary"]');
    await page.evaluate(() => localStorage.setItem('anshelf-check-updates-on-start', 'false'));
  }
  const open = mode => page.locator(`[data-action="import"][data-mode="${mode}"]`).click();
  const close = () => page.locator('#dialog [data-action="close-dialog"]').click();
  async function controls() {
    return page.evaluate(() => ({
      preferExistingPreview: document.querySelector('#prefer-preview').checked,
      customPreview: document.querySelector('#custom-preview-resolution').checked,
      previewResolution: Number(document.querySelector('#preview-resolution').value),
      disabled: document.querySelector('[data-select-trigger="preview-resolution"]').disabled,
    }));
  }
  async function picker(file = null) {
    await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: !file, filePaths: file ? [file] : [] }); }, file);
  }
  try {
    await launch();
    await open('ordinary');
    assert.deepEqual(await controls(), { preferExistingPreview: true, customPreview: false, previewResolution: 512, disabled: true });
    await page.locator('#prefer-preview').uncheck();
    await page.locator('#custom-preview-resolution').check();
    await chooseThemedOption(page, '#preview-resolution', '2048');
    await chooseThemedOption(page, '#import-category', category.id);
    await close();
    await open('ordinary');
    assert.deepEqual(await controls(), { preferExistingPreview: false, customPreview: true, previewResolution: 2048, disabled: false });
    assert.equal(await page.locator('#import-category').inputValue(), '', 'a prior import destination is not reused');
    assert.deepEqual(await fs.readFile(path.join(data, 'library.json')), baseline, 'changing preferences or cancelling never changes the library');
    checks.push('2K and same-name image choices survive closing the dialog; category destination and library index are unaffected');
    await close();

    await open('effect');
    assert.deepEqual(await controls(), { preferExistingPreview: true, customPreview: false, previewResolution: 512, disabled: true });
    await page.locator('#custom-preview-resolution').check();
    await chooseThemedOption(page, '#preview-resolution', '1024');
    await close();
    const beforeAudio = await page.evaluate(key => localStorage.getItem(key), storageKey);
    await open('audio');
    assert.equal(await page.locator('#prefer-preview, #custom-preview-resolution, #preview-resolution').count(), 0);
    await close();
    assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), beforeAudio);
    checks.push('ordinary and effect preferences stay separate; audio exposes no preview controls and does not overwrite them');

    await open('ordinary');
    await picker();
    await page.locator('[data-action="import-files"]').click();
    await page.waitForFunction(() => !document.body.classList.contains('is-busy') && !document.querySelector('#dialog').open);
    assert.deepEqual(await fs.readFile(path.join(data, 'library.json')), baseline);
    await open('ordinary');
    assert.equal((await controls()).previewResolution, 2048);
    await page.locator('#custom-preview-resolution').uncheck();
    await close();
    await app.close(); app = null;

    await launch();
    await open('ordinary');
    assert.deepEqual(await controls(), { preferExistingPreview: false, customPreview: false, previewResolution: 2048, disabled: true });
    assert.equal(await page.locator('#import-category').inputValue(), '');
    await page.locator('#custom-preview-resolution').check();
    assert.equal((await controls()).previewResolution, 2048);
    await close();
    await open('effect');
    assert.deepEqual(await controls(), { preferExistingPreview: true, customPreview: true, previewResolution: 1024, disabled: false });
    await close();
    checks.push('native picker cancellation preserves the index; a real application restart restores each mode and retains 2K while its custom switch is off');

    await open('ordinary');
    await chooseThemedOption(page, '#import-category', category.id);
    await picker(source);
    await page.locator('[data-action="import-files"]').click();
    await page.locator('.asset-card h3').filter({ hasText: '偏好测试' }).waitFor();
    let imported;
    const previewDeadline = Date.now() + 60000;
    while (Date.now() < previewDeadline) {
      imported = (await page.evaluate(() => window.shelf.snapshot())).assets.find(asset => asset.name === '偏好测试');
      if (imported?.previewStatus === 'ready') break;
      if (imported?.previewStatus === 'failed') throw new Error(imported.previewError || 'Preview failed');
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(imported?.previewStatus, 'ready', 'remembered settings allow offline preview generation');
    assert.equal(imported.previewResolution, 2048);
    assert.equal(imported.previewOrigin, 'rendered', 'the remembered unchecked same-name preference ignores the available sidecar');
    assert.equal(imported.categoryId, category.id);
    assert.deepEqual(await fs.readFile(source), originalBytes);
    const saved = JSON.parse(await page.evaluate(key => localStorage.getItem(key), storageKey));
    assert.deepEqual(saved, {
      ordinary: { preferExistingPreview: false, customPreview: true, previewResolution: 2048 },
      effect: { preferExistingPreview: true, customPreview: true, previewResolution: 1024 },
    });
    checks.push('remembered controls reach a real import through IPC; the original FLA is unchanged and preference storage contains no file path or category');
    assert.deepEqual(errors, []);
    const report = { passed: true, checks, pageErrors: errors };
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: false, checks, error: error.message, pageErrors: errors }, null, 2));
    throw error;
  } finally {
    if (app) await app.close().catch(() => {});
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
