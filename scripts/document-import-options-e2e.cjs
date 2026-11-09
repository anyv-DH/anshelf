/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { _electron } = require(process.env.ANSHELF_PLAYWRIGHT || 'playwright');
const { Library } = require('../core/library.cjs');
const { Queue } = require('../plugin/queue.cjs');
const root = path.resolve(__dirname, '..');

async function receipt(file) {
  const deadline = Date.now() + 30000;
  while (true) {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT' || Date.now() >= deadline) throw error; }
    await new Promise(resolve => setTimeout(resolve, 30));
  }
}

async function main() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-main-import-options-'));
  const data = path.join(temporary, 'library');
  const output = path.join(root, 'test-output/document-import-options');
  await fs.mkdir(output, { recursive: true });
  const file = path.join(temporary, '当前火焰.fla');
  const demo = (await fs.readdir(path.join(root, 'demo'))).find(name => name.endsWith('.fla'));
  await fs.copyFile(path.join(root, 'demo', demo), file);
  const library = await Library.open(data);
  const category = await library.createCategory('火焰特效', null, 'effect');
  let app;
  const errors = [], checks = [];
  try {
    app = await _electron.launch({ executablePath: process.env.ANSHELF_UI_EXECUTABLE || require(path.join(root, 'node_modules/electron')),
      args: [...(process.env.ANSHELF_UI_EXECUTABLE ? [] : [root]), '--user-data-dir=' + path.join(temporary, 'profile')],
      env: { ...process.env, ANSHELF_DATA_DIR: data }, timeout: 60000 });
    const page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => !!window.shelf);
    const queue = new Queue(data);
    const request = queue.requestDocumentImport(file, { mode: 'effect', categoryId: category.id, previewResolution: 2048, preferExistingPreview: false });
    const receiptFile = path.join(data, 'bridge/document-import/results', request.requestId + '.json');
    await page.waitForFunction(async () => (await window.shelf.snapshot()).assets.length === 1, null, { timeout: 30000 });
    const result = await receipt(receiptFile);
    assert.equal(result.ok, true, result.error);
    const snapshot = await page.evaluate(() => window.shelf.snapshot());
    const asset = snapshot.assets[0];
    assert.equal(asset.id, result.assetId);
    assert.equal(asset.assetType, 'effect');
    assert.equal(asset.previewResolution, 2048);
    assert.deepEqual(asset.categoryIds, [category.id]);
    checks.push('real plugin descriptor passes through Electron main receiver and imports the selected effect/category/2K settings');
    const again = queue.requestDocumentImport(path.join(data, asset.managedPath), { mode: 'effect', categoryId: category.id, previewResolution: 512, preferExistingPreview: true });
    await page.waitForFunction(async () => (await window.shelf.snapshot()).assets[0]?.previewResolution === 512, null, { timeout: 30000 });
    const updated = await receipt(path.join(data, 'bridge/document-import/results', again.requestId + '.json'));
    assert.equal(updated.ok, true, updated.error);
    assert.equal(updated.assetId, asset.id);
    assert.equal((await page.evaluate(() => window.shelf.snapshot())).assets.length, 1);
    checks.push('managed AN document settings update the same identity without another FLA');
    assert.deepEqual(errors, []);
    const report = { passed: true, checks, pageErrors: errors, actualAnimateHost: false };
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (app) await app.close().catch(() => {});
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
