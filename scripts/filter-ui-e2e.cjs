/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { _electron } = require(process.env.ANSHELF_PLAYWRIGHT || 'playwright');

async function main() {
  const root = path.resolve(__dirname, '..');
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-filter-ui-'));
  const executablePath = process.env.ANSHELF_UI_EXECUTABLE || require(path.join(root, 'node_modules/electron'));
  const app = await _electron.launch({ executablePath, args: [...(process.env.ANSHELF_UI_EXECUTABLE ? [] : [root]), '--user-data-dir=' + path.join(base, 'profile')], env: { ...process.env, ANSHELF_DATA_DIR: path.join(base, 'library') }, timeout: 60000 });
  const errors = [];
  try {
    const page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('#empty-state:not([hidden])');
    await page.locator('[data-action="demo"]').click();
    const deadline = Date.now() + 90000;
    let snapshot;
    while (Date.now() < deadline) {
      snapshot = await page.evaluate(() => window.shelf.snapshot());
      if (snapshot.assets.length >= 2 && snapshot.assets.every(asset => asset.previewStatus === 'ready')) break;
      await page.waitForTimeout(250);
    }
    assert.ok(snapshot.assets.length >= 2);
    const parent = await page.evaluate(() => window.shelf.createCategory('筛选父级'));
    const child = await page.evaluate(parentId => window.shelf.createCategory('筛选子级', parentId), parent.id);
    await page.evaluate(({ first, second, parentId, childId }) => Promise.all([
      window.shelf.updateAsset(first, { categoryId: parentId }),
      window.shelf.updateAsset(second, { categoryId: childId }),
    ]), { first: snapshot.assets[0].id, second: snapshot.assets[1].id, parentId: parent.id, childId: child.id });
    await page.waitForTimeout(1800);
    await page.locator(`#categories .nav-item[data-id="${parent.id}"]`).click();
    await page.waitForSelector(`.asset-card[data-asset="${snapshot.assets[0].id}"]`);
    assert.equal(await page.locator('.asset-card').count(), 2);
    await page.locator('.asset-card .filename-row h3').first().click();
    assert.equal(await page.locator('#selection-bar').isVisible(), true);
    await page.locator('#filter').click();
    const option = page.locator('#filter-menu [data-filter="hide-child-categories"]');
    assert.equal(await option.isEnabled(), true);
    await option.click();
    assert.equal(await page.locator('.asset-card').count(), 1);
    assert.equal(await page.locator('.asset-card').first().getAttribute('data-asset'), snapshot.assets[0].id);
    assert.equal(await page.locator('#asset-count').textContent(), '1 个素材');
    assert.equal(await page.locator('#selection-bar').isVisible(), false);
    await page.evaluate(({ id, categoryId }) => window.shelf.assignCategory([id], categoryId), { id: snapshot.assets[0].id, categoryId: child.id });
    await page.waitForFunction(() => document.querySelectorAll('.asset-card').length === 0);
    await page.locator('#filter').click();
    await option.click();
    assert.equal(await page.locator('.asset-card').count(), 2);
    for (const view of ['favorites', 'liked', 'all']) {
      await page.locator(`#navigation [data-id="${view}"]`).click();
      await page.locator('#filter').click();
      assert.equal(await option.isDisabled(), true);
      await page.locator('#filter').click();
    }
    await page.locator('#navigation [data-id="ordinary"]').click();
    const ordinaryCount = snapshot.assets.filter(asset => asset.assetType === 'ordinary').length;
    assert.equal(await page.locator('.asset-card').count(), ordinaryCount);
    await page.locator('#filter').click(); await option.click();
    assert.equal(await page.locator('.asset-card').count(), ordinaryCount - 2);
    await page.screenshot({ path: path.join(root, 'test-output/category-filter.png'), scale: 'css', animations: 'disabled' });
    assert.deepEqual(errors, []);
    const checks = ['direct folder filter hides child-assigned assets with accurate count', 'moving into a child immediately hides the asset', 'turning the filter off restores descendants', 'filter clears stale selection', 'filter is disabled for favorites, likes and all assets', 'typed root filter leaves only unclassified materials'];
    const report = { passed: checks.length, checks, pageErrors: errors };
    await fs.writeFile(path.join(root, 'test-output/filter-ui-e2e-result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await app.close();
    await fs.rm(base, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
