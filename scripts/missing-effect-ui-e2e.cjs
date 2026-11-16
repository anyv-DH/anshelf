/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { _electron } = require(process.env.ANSHELF_PLAYWRIGHT || 'playwright');
const { Library } = require('../core/library.cjs');
const root = path.resolve(__dirname, '..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function main() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-missing-effect-ui-'));
  const output = process.env.ANSHELF_MISSING_EFFECT_OUTPUT || path.join(root, 'test-output/missing-effect-ui');
  await fs.mkdir(output, { recursive: true });
  const original = process.env.ANSHELF_EFFECT_SOURCE || path.join(root, 'demo', (await fs.readdir(path.join(root, 'demo'))).find(name => name.endsWith('.fla')));
  const originalHash = digest(await fs.readFile(original));
  const source = path.join(temporary, '缺失特效验收.fla'), data = path.join(temporary, 'library'), profile = path.join(temporary, 'profile');
  await fs.copyFile(original, source);
  const library = await Library.open(data);
  const asset = (await library.importPaths([source], { mode: 'effect', preferExistingPreview: false, previewResolution: 2048 })).assets[0];
  const managed = path.join(data, asset.managedPath);
  await fs.unlink(managed);
  const executable = process.env.ANSHELF_UI_EXECUTABLE || require(path.join(root, 'node_modules/electron'));
  let app, page;
  const checks = [], contexts = [], errors = [];
  const card = () => page.locator(`.asset-card[data-asset="${asset.id}"]`);
  const snapshot = () => page.evaluate(() => window.shelf.snapshot());
  async function waitForSnapshot(predicate, message, timeout = 12000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const current = await snapshot();
      if (predicate(current)) return current;
      await page.waitForTimeout(100);
    }
    assert.fail(message);
  }
  const closeDialog = () => page.locator('#dialog [data-action="close-dialog"]').first().click();
  async function launch() {
    app = await _electron.launch({ executablePath: executable,
      args: [...(process.env.ANSHELF_UI_EXECUTABLE ? [] : [root]), '--user-data-dir=' + profile], env: { ...process.env, ANSHELF_DATA_DIR: data }, timeout: 60000 });
    const context = await app.evaluate(({ app, ipcMain }) => {
      ipcMain.removeHandler('shelf:update-check');
      ipcMain.handle('shelf:update-check', () => ({ status: 'current', currentVersion: app.getVersion(), latestVersion: app.getVersion() }));
      return { packaged: app.isPackaged, version: app.getVersion(), executable: process.execPath, profile: app.getPath('userData'), library: process.env.ANSHELF_DATA_DIR };
    });
    assert.equal(context.packaged, !!process.env.ANSHELF_UI_EXECUTABLE);
    assert.equal(context.version, require('../package.json').version);
    for (const [actual, expected] of [[context.executable, executable], [context.profile, profile], [context.library, data]]) assert.equal(path.resolve(actual).toLowerCase(), path.resolve(expected).toLowerCase());
    contexts.push(context);
    page = await app.firstWindow(); page.setDefaultTimeout(8000);
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('.asset-card');
    await page.evaluate(() => localStorage.setItem('anshelf-check-updates-on-start', 'false'));
  }
  try {
    await launch();
    await waitForSnapshot(data => data.assets.find(item => item.id === asset.id)?.previewStatus === 'failed', 'missing source must actually fail');
    await page.locator('#navigation [data-system-key="effect"]').click();
    await card().locator('.preview-origin.error').waitFor();
    assert.equal((await snapshot()).assets[0].categoryIds.length, 0);
    assert.match(await card().locator('.preview-placeholder').getAttribute('title'), /文件不存在/);
    await assert.rejects(fs.access(managed), { code: 'ENOENT' });
    checks.push('startup never silently repairs missing files; the effect aggregate exposes the exact missing-file error');
    await card().locator('h3').click();
    const removal = page.locator('#selection-bar [data-action="remove-library"]');
    assert.equal(await removal.isEnabled(), true);
    await removal.click();
    await page.locator('#confirm-dialog[open]').waitFor();
    assert.match(await page.locator('#confirm-message').textContent(), /整个素材库/);
    assert.match(await page.locator('#confirm-message').textContent(), /原始文件不会被删除/);
    await page.locator('#confirm-dialog [data-confirm="cancel"]').click();
    assert.equal((await snapshot()).assets.length, 1);
    await removal.click(); await page.locator('#confirm-dialog [data-confirm="accept"]').click();
    await waitForSnapshot(data => data.assets.length === 0, 'confirmed library removal must finish');
    await page.locator('#toast [data-action="undo-assign"]').click();
    await card().waitFor();
    assert.equal((await snapshot()).assets[0].id, asset.id);
    assert.equal(digest(await fs.readFile(source)), originalHash);
    checks.push('uncategorized failed effect supports explicit library removal, cancellation and undo while keeping originals');
    await card().locator('[data-action="zoom-preview"]').click();
    assert.doesNotMatch(await page.locator('#dialog-content').textContent(), /文件仍可发送到 AN/);
    await page.locator('#dialog [data-action="retry"]').click();
    const restored = (await waitForSnapshot(data => data.assets.find(item => item.id === asset.id)?.previewStatus === 'ready', 'explicit retry must actually render a ready preview', 100000)).assets[0];
    assert.equal(restored.hash, originalHash); assert.equal(restored.assetType, 'effect');
    assert.deepEqual(restored.categoryIds, []);
    assert.equal(digest(await fs.readFile(path.join(data, restored.managedPath))), originalHash);
    assert.equal(digest(await fs.readFile(source)), originalHash);
    await page.locator('#dialog .lightbox-preview img').waitFor();
    assert.equal(await page.locator('#dialog .lightbox-preview img').evaluate(image => image.complete && image.naturalWidth > 0), true);
    await page.screenshot({ path: path.join(output, 'restored-preview.png') });
    checks.push('explicit retry restores only matching bytes and the actual offline FLA renderer produces a visible preview');
    await closeDialog();
    await app.close(); app = null;
    await launch();
    await page.locator('#navigation [data-system-key="effect"]').click();
    await card().locator('.preview-origin.ready').waitFor();
    const restarted = (await snapshot()).assets[0];
    assert.equal(restarted.id, asset.id); assert.equal(restarted.previewStatus, 'ready');
    assert.equal(digest(await fs.readFile(original)), originalHash);
    assert.deepEqual(errors, []);
    checks.push('restored managed file and rendered preview survive restart; external original SHA256 stays unchanged');
    const result = { passed: true, groups: checks.length, checks, contexts, pageErrors: errors, isolatedLibrary: true, originalsUnchanged: true,
      realUserFixture: !!process.env.ANSHELF_EFFECT_SOURCE, previewFormat: restarted.previewFormat, previewAnimated: restarted.previewAnimated,
      frames: restarted.frames, previewFrameCount: restarted.previewFrameCount, width: restarted.width, height: restarted.height };
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    await page?.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify({ checks, errors, message: error.message }, null, 2)); throw error;
  } finally {
    if (app) await app.close();
    assert.equal(digest(await fs.readFile(original)), originalHash);
    assert.equal(path.dirname(temporary), path.resolve(os.tmpdir())); assert.ok(path.basename(temporary).startsWith('anshelf-missing-effect-ui-'));
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
