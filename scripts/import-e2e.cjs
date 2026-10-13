/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const assert = require('node:assert/strict');
const playwright = require(process.env.ANSHELF_PLAYWRIGHT || 'playwright');

async function run() {
  const root = path.resolve(__dirname, '..');
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-import-ui-'));
  const originals = path.join(base, 'originals');
  await fs.mkdir(originals);
  const demo = (await fs.readdir(path.join(root, 'demo'))).find(name => name.endsWith('.fla'));
  const source = path.join(originals, '已有预览.fla');
  await fs.copyFile(path.join(root, 'demo', demo), source);
  const before = await fs.readFile(source);
  const executablePath = process.env.ANSHELF_EXECUTABLE || require('electron');
  const packaged = Boolean(process.env.ANSHELF_EXECUTABLE);
  const app = await playwright._electron.launch({ executablePath, args: [...(packaged ? [] : [root]), `--user-data-dir=${path.join(base, 'profile')}`], env: { ...process.env, ANSHELF_DATA_DIR: path.join(base, 'data') }, timeout: 60000 });
  const errors = [];
  try {
    const png = await app.evaluate(({ nativeImage }) => nativeImage.createFromBitmap(Buffer.alloc(16 * 16 * 4, 200), { width: 16, height: 16 }).toPNG().toString('base64'));
    await fs.writeFile(path.join(originals, '已有预览.png'), Buffer.from(png, 'base64'));
    const page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('.import-main');
    await app.evaluate(({ dialog }, filename) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] }); }, source);
    await page.locator('.import-main').click();
    assert.equal(await page.locator('#prefer-preview').isChecked(), true);
    await page.locator('[data-action="import-files"]').click();
    await waitAsset(page, asset => asset?.previewStatus === 'ready');
    const reused = (await page.evaluate(() => window.shelf.snapshot())).assets[0];
    assert.equal(reused.previewOrigin, 'sidecar');
    await page.waitForFunction(() => document.querySelector('.asset-card img')?.naturalWidth > 0);
    await page.locator('.import-main').click();
    await page.locator('#prefer-preview').uncheck();
    await page.locator('[data-action="import-files"]').click();
    await waitAsset(page, asset => asset?.previewOrigin === 'rendered');
    const regenerated = (await page.evaluate(() => window.shelf.snapshot())).assets[0];
    assert.equal(regenerated.previewStatus, 'ready');
    assert.equal(regenerated.width, 500);
    assert.notEqual(regenerated.previewUrl, reused.previewUrl);
    assert.deepEqual(await fs.readFile(source), before);
    await page.locator('.import-main').click();
    await page.locator('[data-action="import-files"]').click();
    await waitAsset(page, asset => asset?.previewOrigin === 'sidecar');
    assert.equal((await page.evaluate(() => window.shelf.snapshot())).assets.length, 1);
    await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
    await page.locator('.import-main').click();
    await page.locator('[data-action="import-files"]').click();
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('没有导入'));
    assert.equal((await page.evaluate(() => window.shelf.snapshot())).assets.length, 1);
    let opened;
    await app.evaluate(({ shell }) => { shell.openPath = async filename => { global.__anshelfPluginPath = filename; return ''; }; });
    await page.locator('#connection').click();
    await page.locator('[data-action="open-plugin-folder"]').click();
    opened = await app.evaluate(() => global.__anshelfPluginPath);
    assert.ok(opened);
    await fs.access(path.join(opened, 'CSXS', 'manifest.xml'));
    if (packaged) assert.match(opened, /resources[\\/]AnimatePlugin$/);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, packaged, checks: ['native import entry', 'valid same-name image reused', 'unchecked option renders FLA', 'reenabling preference replaces the generated preview', 'duplicate is folded', 'original bytes unchanged', 'canceled picker feedback', 'external plugin folder exists'], errors }, null, 2));
  } finally { await app.close(); }
}

async function waitAsset(page, predicate) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const snapshot = await page.evaluate(() => window.shelf.snapshot());
    if (predicate(snapshot.assets[0])) return;
    await page.waitForTimeout(100);
  }
  throw new Error('Import did not complete: ' + await page.locator('#toast').textContent());
}

run().catch(error => { console.error(error); process.exitCode = 1; });
