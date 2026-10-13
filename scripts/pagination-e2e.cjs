/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron } = require(process.env.ANSHELF_PLAYWRIGHT || 'playwright');
const { seed } = require('./idle-profile.cjs');
const root = path.resolve(__dirname, '..');
async function main() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-pagination-e2e-')), data = path.join(temporary, 'library');
  let app;
  try {
    await seed(data, 183);
    const libraryFile = path.join(data, 'library.json'), state = JSON.parse(await fs.readFile(libraryFile));
    state.assets.forEach((asset, i) => {
      if (i % 3 === 1) asset.assetType = 'effect';
      if (i % 3 === 2) Object.assign(asset, { kind: 'audio', assetType: 'audio', extension: '.wav', previewStatus: 'none', previewPath: null, managedPath: 'assets/test.wav' });
    });
    await fs.writeFile(libraryFile, JSON.stringify(state)); await fs.writeFile(path.join(data, 'assets', 'test.wav'), 'diagnostic-only');
    const packaged = Boolean(process.env.ANSHELF_EXECUTABLE);
    app = await _electron.launch({ executablePath: process.env.ANSHELF_EXECUTABLE || require(path.join(root, 'node_modules/electron')), args: [...(packaged ? [] : [root]), '--user-data-dir=' + path.join(temporary, 'profile')], env: { ...process.env, ANSHELF_DATA_DIR: data }, timeout: 60000 });
    const page = await app.firstWindow(), errors = [], checks = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('.asset-card');
    assert.equal(await page.locator('.asset-card').count(), 60);
    assert.match(await page.locator('#asset-pagination').textContent(), /1.*4/);
    assert.match(await page.locator('#asset-count').textContent(), /183/);
    await page.locator('[data-action="next-page"]').click(); assert.equal(await page.locator('.asset-card').count(), 60);
    await page.locator('.asset-card').first().press('Control+a'); assert.match(await page.locator('#selection-bar').textContent(), /60/);
    await page.locator('[data-action="next-page"]').click(); assert.equal(await page.locator('#selection-bar').isVisible(), false);
    await page.locator('[data-action="next-page"]').click(); assert.equal(await page.locator('.asset-card').count(), 3);
    checks.push('whole library 183 results mount 60 per page; paging bounds selection and last page');
    await page.locator('#search').fill('合成素材 183'); assert.equal(await page.locator('.asset-card').count(), 1); assert.equal(await page.locator('#asset-pagination').isVisible(), false);
    await page.locator('#search').fill(''); assert.equal(await page.locator('.asset-card').count(), 60);
    checks.push('search finds distant-page files and resets paging');
    for (const category of ['ordinary', 'effects', 'audio']) {
      await page.locator(`#navigation [data-id="${category}"]`).click(); assert.equal(await page.locator('.asset-card').count(), 60);
      await page.locator('[data-action="next-page"]').click(); assert.equal(await page.locator('.asset-card').count(), 1);
      await page.locator('[data-action="previous-page"]').click(); assert.equal(await page.locator('.asset-card').count(), 60);
    }
    checks.push('ordinary/effects/audio each paginate 61 assets consistently');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: checks.length, checks, pageErrors: errors, packaged }, null, 2));
  } finally { if (app) await app.close(); await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
