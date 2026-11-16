/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { _electron } = require(process.env.ANSHELF_PLAYWRIGHT || 'playwright');
const { Library } = require('../core/library.cjs');
const root = path.resolve(__dirname, '..');

async function main() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-custom-preview-ui-'));
  const data = path.join(temporary, 'library'), profile = path.join(temporary, 'profile');
  const output = process.env.ANSHELF_CUSTOM_PREVIEW_OUTPUT || path.join(root, 'test-output/custom-preview-ui');
  await fs.mkdir(output, { recursive: true });
  const source = path.join(temporary, '中文角色.fla');
  const oldImage = source.replace(/\.fla$/, '.png');
  const sample = (await fs.readdir(path.join(root, 'demo'))).find(name => name.endsWith('.fla'));
  await fs.copyFile(path.join(root, 'demo', sample), source);
  await fs.writeFile(oldImage, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64'));
  const library = await Library.open(data);
  const first = await library.createCategory('自定义预览示例', null, 'ordinary');
  const second = await library.createCategory('另一个分类', null, 'ordinary');
  const imported = (await library.importPaths([source], { categoryId: first.id, preferExistingPreview: true })).assets[0];
  await library.addToCategory([imported.id], second.id);
  await library.updateAsset(imported.id, { favorite: true, tags: ['保留标签'] });
  const originalBytes = await fs.readFile(source), originalImageBytes = await fs.readFile(oldImage);
  const executablePath = process.env.ANSHELF_UI_EXECUTABLE || require(path.join(root, 'node_modules/electron'));
  const launch = () => _electron.launch({ executablePath, args: [...(process.env.ANSHELF_UI_EXECUTABLE ? [] : [root]), '--user-data-dir=' + profile], env: { ...process.env, ANSHELF_DATA_DIR: data }, timeout: 60000 });
  const checks = [], errors = [];
  let app, page;
  const snapshot = () => page.evaluate(() => window.shelf.snapshot());
  const waitIdle = () => page.waitForFunction(() => !document.body.classList.contains('is-busy'));
  const isModern = () => page.evaluate(() => document.documentElement.dataset.layout === 'modern');
  async function openCategories() {
    if (await isModern() && await page.locator('[data-top-categories]').getAttribute('aria-expanded') !== 'true') {
      await page.locator('[data-top-categories]').click();
    }
  }
  async function chooseTheme(theme) {
    if (await isModern()) {
      await page.locator('[data-action="appearance-settings"]').click();
      await page.locator(`[data-appearance-theme="${theme}"]`).click();
      await page.locator('[data-appearance-close="done"]').click();
    } else await page.locator(`[data-action="theme"][data-theme="${theme}"]`).click();
  }
  async function selectImage(file = null) {
    await app.evaluate(({ dialog }, file) => {
      globalThis.customPreviewPickerCalls = [];
      dialog.showOpenDialog = async (...args) => {
        globalThis.customPreviewPickerCalls.push(args.at(-1));
        return { canceled: !file, filePaths: file ? [file] : [] };
      };
    }, file);
  }
  function assertMetadata(asset, before) {
    for (const key of ['id', 'name', 'managedPath', 'hash', 'categoryId', 'categoryIds', 'tags', 'favorite', 'assetType', 'sourcePaths']) {
      assert.deepEqual(asset[key], before[key], `${key} survives replacement`);
    }
  }
  try {
    app = await launch(); page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('.asset-card');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(930, 700));
    await openCategories();
    await page.locator(`#categories .nav-item[data-id="${first.id}"]`).click();
    await page.locator('#search').fill('中文角色');
    await page.locator('.asset-card').focus();
    await page.locator('.asset-card').press('Enter');
    await page.locator('.asset-card [data-action="zoom-preview"]').click();
    assert.equal(await page.locator('#dialog .preview-details').isVisible(), true);
    assert.equal(await page.locator('#inspector').isVisible(), false, 'details have one visible home in the preview dialog');
    assert.equal(await page.locator('#inspector [data-field]').count(), 0, 'no second detail editor exists on the main page');
    assert.equal(await page.locator('#dialog [data-action="replace-preview"]').isVisible(), true);
    assert.match(await page.locator('#dialog .preview-replacement').textContent(), /旧预览缓存保留两天/);
    const initial = (await snapshot()).assets.find(asset => asset.id === imported.id);
    await page.locator('#dialog [data-zoom="in"]').click();
    const scaleBefore = await page.locator('[data-preview-viewport]').getAttribute('data-scale');
    const srcBefore = await page.locator('#dialog .lightbox-preview img').getAttribute('src');
    const indexBeforeCancel = await fs.readFile(path.join(data, 'library.json'));
    await selectImage();
    await page.locator('#dialog [data-action="replace-preview"]').click(); await waitIdle();
    assert.equal(await page.locator('#dialog').evaluate(dialog => dialog.open), true);
    assert.equal(await page.locator('[data-preview-viewport]').getAttribute('data-scale'), scaleBefore);
    assert.equal(await page.locator('#dialog .lightbox-preview img').getAttribute('src'), srcBefore);
    assert.deepEqual(await fs.readFile(path.join(data, 'library.json')), indexBeforeCancel);
    checks.push('preview dialog contains details and replacement controls; picker cancellation preserves index, lightbox, current image, zoom and selection');

    const replacement = path.join(temporary, '新预览图.png');
    const pngData = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 64;
      const context = canvas.getContext('2d'); context.fillStyle = '#7854bb'; context.fillRect(0, 0, 96, 64);
      context.fillStyle = '#f3ddff'; context.fillRect(18, 14, 60, 36); return canvas.toDataURL('image/png').split(',')[1];
    });
    await fs.writeFile(replacement, Buffer.from(pngData, 'base64'));
    await selectImage(replacement);
    await page.locator('#dialog [data-action="replace-preview"]').click();
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('预览图已更换'));
    await waitIdle();
    const changed = (await snapshot()).assets.find(asset => asset.id === imported.id);
    assertMetadata(changed, initial);
    assert.equal(changed.previewOrigin, 'custom');
    assert.ok(changed.previewUndoUntil > Date.now());
    assert.notEqual(changed.previewPath, initial.previewPath);
    await fs.access(path.join(data, initial.previewPath));
    assert.deepEqual(await fs.readFile(path.join(data, changed.previewPath)), await fs.readFile(replacement));
    await page.waitForFunction(() => { const image = document.querySelector('#dialog .lightbox-preview img'); return image?.complete && image.naturalWidth === 96; });
    assert.equal(await page.locator('#dialog').evaluate(dialog => dialog.open), true);
    assert.equal(await page.locator('#dialog [data-action="restore-preview"]').isVisible(), true);
    assert.notEqual(await page.locator('#dialog .lightbox-preview img').getAttribute('src'), srcBefore);
    assert.equal(await page.locator('.asset-card.selected').getAttribute('data-asset'), imported.id);
    assert.equal(await page.locator('#search').inputValue(), '中文角色');
    assert.equal(await page.locator(`#categories .nav-item[data-id="${first.id}"]`).evaluate(button => button.classList.contains('active')), true);
    const picker = await app.evaluate(() => globalThis.customPreviewPickerCalls);
    assert.equal(picker.length, 1); assert.ok(picker[0].filters.some(filter => filter.extensions.includes('png')));
    checks.push('real IPC replaces the local preview immediately in lightbox and card, retains old cache, categories, tags, favorite, identity and active browsing context');
    await page.screenshot({ path: path.join(output, 'preview-replaced-dark.png') });

    await page.locator('#dialog [data-action="close-dialog"]').click();
    await chooseTheme('warm');
    await page.locator('.asset-card [data-action="zoom-preview"]').click();
    await page.locator('#dialog [data-action="replace-preview"]').waitFor();
    assert.match(await page.locator('#dialog .detail-origin').textContent(), /自定义预览图/);
    const beforeFailure = await fs.readFile(path.join(data, 'library.json'));
    const invalid = path.join(temporary, '不是图片.png'); await fs.writeFile(invalid, 'invalid-image');
    await selectImage(invalid);
    await page.locator('#dialog [data-action="replace-preview"]').click(); await waitIdle();
    assert.deepEqual(await fs.readFile(path.join(data, 'library.json')), beforeFailure);
    assert.equal((await snapshot()).assets.find(asset => asset.id === imported.id).previewPath, changed.previewPath);
    assert.doesNotMatch(await page.locator('#toast').textContent(), /预览图已更换/);
    checks.push('invalid image selected from preview dialog reports failure and preserves active preview and index');

    await selectImage(oldImage);
    await page.locator('#dialog [data-action="replace-preview"]').click();
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('预览图已更换'));
    await waitIdle();
    const twiceChanged = (await snapshot()).assets.find(asset => asset.id === imported.id);
    assertMetadata(twiceChanged, initial);
    assert.notEqual(twiceChanged.previewPath, changed.previewPath);
    await fs.access(path.join(data, changed.previewPath));
    await page.waitForFunction(() => { const image = document.querySelector('#dialog .lightbox-preview img'); return image?.complete && image.naturalWidth === 1; });
    await page.screenshot({ path: path.join(output, 'preview-replaced-warm-details.png') });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('#dialog').evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth), true);
    assert.match(await page.locator('#dialog .detail-origin').textContent(), /自定义预览图/);
    checks.push('preview replacement refreshes the image and details together in warm theme at 930×700 without horizontal overflow');

    await app.close(); app = await launch(); page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message)); await page.waitForSelector('.asset-card');
    const reopened = (await snapshot()).assets.find(asset => asset.id === imported.id);
    assertMetadata(reopened, initial); assert.equal(reopened.previewPath, twiceChanged.previewPath);
    assert.equal(reopened.previewOrigin, 'custom');
    await page.locator('.asset-card [data-action="zoom-preview"]').click();
    assert.match(await page.locator('#dialog .detail-origin').textContent(), /自定义预览图/);
    await page.locator('#dialog [data-action="restore-preview"]').click();
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('已撤回预览更换'));
    await waitIdle();
    const restored = (await snapshot()).assets.find(asset => asset.id === imported.id);
    assertMetadata(restored, initial); assert.equal(restored.previewPath, changed.previewPath);
    await page.waitForFunction(() => { const image = document.querySelector('#dialog .lightbox-preview img'); return image?.complete && image.naturalWidth === 96; });
    assert.equal(await page.locator('#dialog [data-action="restore-preview"]').isVisible(), true);
    await page.locator('#dialog [data-action="restore-preview"]').click();
    await page.waitForFunction(() => { const image = document.querySelector('#dialog .lightbox-preview img'); return image?.complete && image.naturalWidth === 1; });
    await waitIdle();
    const restoredOriginal = (await snapshot()).assets.find(asset => asset.id === imported.id);
    assert.equal(restoredOriginal.previewPath, initial.previewPath);
    assert.equal(await page.locator('#dialog').evaluate(dialog => dialog.open), true);
    assert.equal(await page.locator('#dialog [data-action="restore-preview"]').count(), 0);
    checks.push('reopen retains the 48-hour recovery action; successive restores in the preview dialog recover each previous image without changing categories or identity');

    await page.locator('#dialog [data-action="retry"]').click();
    await page.waitForFunction(async id => {
      const current = (await window.shelf.snapshot()).assets.find(asset => asset.id === id);
      return current?.previewOrigin === 'rendered' && current.previewStatus === 'ready';
    }, imported.id);
    await page.waitForFunction(() => { const image = document.querySelector('#dialog .lightbox-preview img'); return image?.complete && image.naturalWidth > 1; });
    await waitIdle();
    const regenerated = (await snapshot()).assets.find(asset => asset.id === imported.id);
    assertMetadata(regenerated, initial);
    assert.notEqual(regenerated.previewPath, initial.previewPath);
    await fs.access(path.join(data, initial.previewPath));
    assert.equal(await page.locator('#dialog [data-action="restore-preview"]').isVisible(), true);
    await page.locator('#dialog [data-action="restore-preview"]').click();
    await page.waitForFunction(() => { const image = document.querySelector('#dialog .lightbox-preview img'); return image?.complete && image.naturalWidth === 1; });
    assert.equal((await snapshot()).assets.find(asset => asset.id === imported.id).previewPath, initial.previewPath);
    checks.push('existing preview regenerates from local FLA, refreshes the open lightbox on completion and can restore the prior image');
    assert.deepEqual(await fs.readFile(source), originalBytes);
    assert.deepEqual(await fs.readFile(oldImage), originalImageBytes);
    checks.push('restart preserves chosen preview and all memberships; external original FLA and images remain byte-identical');
    assert.deepEqual(errors, []);
    const result = { passed: true, executablePath, checks, pageErrors: errors };
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: false, checks, error: error.message, pageErrors: errors }, null, 2)); throw error;
  } finally { if (app) await app.close().catch(() => {}); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
