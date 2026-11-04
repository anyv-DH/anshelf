/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { _electron } = require(process.env.ANSHELF_PLAYWRIGHT || 'playwright');
const { Library } = require('../core/library.cjs');
const root = path.resolve(__dirname, '..');

async function main() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-confirmation-ui-'));
  const data = path.join(temporary, 'library'), output = path.join(root, 'test-output/confirmation-ui');
  await fs.mkdir(output, { recursive: true });
  const demo = (await fs.readdir(path.join(root, 'demo'))).find(name => name.endsWith('.fla'));
  const source = path.join(temporary, '跨剧人物.fla'); await fs.copyFile(path.join(root, 'demo', demo), source);
  const original = await fs.readFile(source), library = await Library.open(data);
  const asset = (await library.importPaths([source])).assets[0];
  const a = await library.createCategory('人物原分类'), b = await library.createCategory('新剧分类');
  const child = await library.createCategory('子分类', b.id);
  await library.assignCategory([asset.id], a.id); await library.addToCategory([asset.id], b.id);
  const executablePath = process.env.ANSHELF_UI_EXECUTABLE || require(path.join(root, 'node_modules/electron'));
  let app, page; const checks = [], errors = [], nativeDialogs = [];
  try {
    app = await _electron.launch({ executablePath, args: [...(process.env.ANSHELF_UI_EXECUTABLE ? [] : [root]), `--user-data-dir=${path.join(temporary, 'profile')}`], env: { ...process.env, ANSHELF_DATA_DIR: data }, timeout: 60000 });
    page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => { nativeDialogs.push(dialog.message()); dialog.dismiss(); });
    await page.waitForSelector('.asset-card');
    await app.evaluate(({ BrowserWindow, shell }) => { BrowserWindow.getAllWindows()[0].setContentSize(930, 700); globalThis.revealedConfirmCopies = []; shell.showItemInFolder = file => globalThis.revealedConfirmCopies.push(file); });
    const snapshot = () => page.evaluate(() => window.shelf.snapshot());
    const select = async () => { await page.locator(`[data-asset="${asset.id}"] h3`).click(); };
    const openRemove = async () => { await page.locator('[data-action="remove"]').focus(); await page.locator('[data-action="remove"]').click(); await page.locator('#confirm-dialog[open]').waitFor(); };
    const waitClosed = () => page.locator('#confirm-dialog').waitFor({ state: 'hidden' });
    const noMutation = async () => { const current = await snapshot(); assert.equal(current.assets.length, 1); assert.deepEqual([...new Set([current.assets[0].categoryId, ...current.assets[0].categoryIds])].sort(), [a.id, b.id].sort()); };
    await page.locator(`[data-action="category"][data-id="${b.id}"]`).first().click(); await select();
    for (const mode of ['Enter', 'Escape', 'backdrop', 'close', 'cancel']) {
      await openRemove();
      assert.equal(await page.locator('[data-confirm="cancel"]').evaluate(button => document.activeElement === button), true);
      if (mode === 'Enter' || mode === 'Escape') await page.keyboard.press(mode);
      else if (mode === 'backdrop') await page.mouse.click(4, 4);
      else if (mode === 'close') await page.locator('.confirm-close').click();
      else await page.locator('[data-confirm="cancel"]').click();
      await waitClosed(); await noMutation();
      assert.equal(await page.locator('[data-action="remove"]').evaluate(button => document.activeElement === button), true, mode);
    }
    checks.push('default Enter, Escape, backdrop, close and cancel all preserve memberships and restore the action focus');

    await openRemove();
    await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
    assert.equal(await page.locator('#confirm-dialog').evaluate(dialog => dialog.contains(document.activeElement)), true);
    const fit = await page.locator('#confirm-dialog').evaluate(dialog => { const r = dialog.getBoundingClientRect(); return { fits: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, noX: dialog.scrollWidth <= dialog.clientWidth, theme: getComputedStyle(dialog).backgroundColor }; });
    assert.equal(fit.fits, true); assert.equal(fit.noX, true);
    await page.screenshot({ path: path.join(output, 'remove-dark.png'), scale: 'css' });
    await page.locator('[data-confirm="cancel"]').click(); await waitClosed();
    await page.locator('[data-action="theme"][data-theme="warm"]').click();
    await openRemove();
    assert.notEqual(await page.locator('#confirm-dialog').evaluate(dialog => getComputedStyle(dialog).backgroundColor), fit.theme);
    await page.screenshot({ path: path.join(output, 'remove-warm.png'), scale: 'css' });
    await page.keyboard.press('Escape'); await waitClosed();
    checks.push('confirmation follows dark and warm themes, fits 930x700 without horizontal overflow and traps keyboard focus');

    await page.locator(`[data-action="edit-category"][data-id="${b.id}"]`).click();
    await page.locator('[data-action="delete-category"]').click();
    await page.locator('#confirm-dialog[open]').waitFor();
    assert.match(await page.locator('#confirm-message').textContent(), /您.*新剧分类/);
    await page.keyboard.press('Escape'); await waitClosed();
    assert.equal(await page.locator('#dialog').evaluate(dialog => dialog.open), true);
    assert.equal(await page.locator('[data-action="delete-category"]').evaluate(button => document.activeElement === button), true);
    assert.equal((await snapshot()).categories.some(item => item.id === b.id), true);
    await page.locator('[data-action="delete-category"]').click();
    await page.locator('#confirm-dialog[open] [data-confirm="accept"]').click();
    await page.waitForFunction(id => !document.querySelector(`#categories [data-action="category"][data-id="${id}"]`), b.id);
    assert.equal((await snapshot()).categories.find(item => item.id === child.id).parentId, null);
    checks.push('category editor stays open on Escape; explicit themed confirmation deletes only the category and promotes children');

    await page.locator('[data-action="category"][data-id="all"]').first().click();
    await page.locator('.asset-card [data-action="duplicate-file"]').click();
    await page.locator('#confirm-dialog[open]').waitFor();
    assert.match(await page.locator('#confirm-detail').textContent(), new RegExp(temporary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    await page.screenshot({ path: path.join(output, 'copy-warm.png'), scale: 'css' });
    await page.keyboard.press('Escape'); await waitClosed(); await page.waitForFunction(() => !document.body.classList.contains('is-busy'));
    assert.deepEqual(await app.evaluate(() => globalThis.revealedConfirmCopies), []);
    await assert.rejects(fs.access(path.join(temporary, '跨剧人物 - 副本.fla')), { code: 'ENOENT' });
    await page.locator('.asset-card [data-action="zoom-preview"]').click();
    await page.locator('#dialog [data-action="duplicate-file"]').click();
    await page.locator('#confirm-dialog[open] [data-confirm="cancel"]').click(); await waitClosed();
    assert.equal(await page.locator('#dialog').evaluate(dialog => dialog.open), true);
    await page.locator('#dialog [data-action="duplicate-file"]').click();
    await page.locator('#confirm-dialog[open] [data-confirm="accept"]').click(); await waitClosed();
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('已复制'));
    assert.deepEqual(await fs.readFile(path.join(temporary, '跨剧人物 - 副本.fla')), original);
    assert.deepEqual(await app.evaluate(() => globalThis.revealedConfirmCopies), [path.join(temporary, '跨剧人物 - 副本.fla')]);
    assert.equal((await snapshot()).assets.length, 1); assert.deepEqual(await fs.readFile(source), original);
    checks.push('copy broker uses the same themed dialog; cancellation writes nothing, preview remains open and explicit acceptance copies one file');
    assert.deepEqual(errors, []); assert.deepEqual(nativeDialogs, []);
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ checks, pageErrors: errors, nativeDialogs }, null, 2));
    console.log(JSON.stringify({ checks, pageErrors: errors, nativeDialogs }, null, 2));
  } catch (error) {
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    throw error;
  } finally { if (app) await app.close().catch(() => {}); await fs.rm(temporary, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
