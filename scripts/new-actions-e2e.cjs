/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { _electron } = require(process.env.ANSHELF_PLAYWRIGHT || 'playwright');
const { Library } = require('../core/library.cjs');
const root = path.resolve(__dirname, '..');

async function main() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-new-actions-'));
  const data = path.join(temporary, 'library');
  const output = process.env.ANSHELF_ACTIONS_OUTPUT || path.join(root, 'test-output/new-actions');
  await fs.mkdir(output, { recursive: true });
  const demo = (await fs.readdir(path.join(root, 'demo'))).find(name => name.endsWith('.fla'));
  const source = path.join(temporary, '中文武器.fla');
  await fs.copyFile(path.join(root, 'demo', demo), source);
  const library = await Library.open(data);
  const imported = await library.importPaths([source]);
  const asset = imported.assets[0];
  const checks = [], errors = [];
  const executablePath = process.env.ANSHELF_UI_EXECUTABLE || require(path.join(root, 'node_modules/electron'));
  let app, page;
  try {
    app = await _electron.launch({ executablePath, args: [...(process.env.ANSHELF_UI_EXECUTABLE ? [] : [root]), '--user-data-dir=' + path.join(temporary, 'profile')], env: { ...process.env, ANSHELF_DATA_DIR: data }, timeout: 60000 });
    page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('.asset-card');
    assert.equal(await page.locator('.asset-card [data-action="duplicate-file"]').count(), 1, 'card offers one-click copy');
    await app.evaluate(({ shell }) => { globalThis.revealedCopies = []; shell.showItemInFolder = file => globalThis.revealedCopies.push(file); });
    await page.locator('.asset-card').hover();
    await page.locator('.asset-card [data-action="duplicate-file"]').click();
    await page.locator('#confirm-dialog[open]').waitFor();
    assert.match(await page.locator('#confirm-dialog').textContent(), /复制/);
    assert.equal(await page.locator('[data-confirm="cancel"]').evaluate(button => document.activeElement === button), true);
    await page.locator('[data-confirm="cancel"]').click();
    await page.waitForFunction(() => !document.body.classList.contains('is-busy'));
    await assert.rejects(fs.access(path.join(temporary, '中文武器 - 副本.fla')), { code: 'ENOENT' });
    assert.deepEqual(await app.evaluate(() => globalThis.revealedCopies), []);
    checks.push('copy requires a themed Chinese confirmation dialog with cancel focused; cancel creates no file and opens no Explorer window');
    await page.locator('.asset-card [data-action="duplicate-file"]').click();
    await page.locator('#confirm-dialog[open] [data-confirm="accept"]').click();
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('已复制'));
    const copy = path.join(temporary, '中文武器 - 副本.fla');
    assert.deepEqual(await fs.readFile(copy), await fs.readFile(source));
    assert.deepEqual(await app.evaluate(() => globalThis.revealedCopies), [copy]);
    assert.equal((await page.evaluate(() => window.shelf.snapshot())).assets.length, 1);
    checks.push('card copies readable Chinese file beside original, selects it in Explorer and keeps library unique');
    await page.locator('.asset-card [data-action="zoom-preview"]').click();
    assert.equal(await page.locator('#dialog [data-action="duplicate-file"]').count(), 1);
    await page.locator('#dialog [data-action="duplicate-file"]').click();
    await page.locator('#confirm-dialog[open] [data-confirm="accept"]').click();
    for (let i = 0; i < 100 && (await app.evaluate(() => globalThis.revealedCopies.length)) < 2; i++) await page.waitForTimeout(50);
    await fs.access(path.join(temporary, '中文武器 - 副本 (2).fla'));
    await page.locator('#dialog [data-action="close-dialog"]').click();
    checks.push('large-preview copy increments names without overwriting');
    const incoming = path.join(temporary, 'AN当前作品.fla');
    await fs.writeFile(incoming, Buffer.concat([await fs.readFile(source), Buffer.from('\nnew-document')]));
    const requestId = randomUUID();
    const inbox = path.join(data, 'bridge/document-import/inbox');
    const requestFile = path.join(inbox, requestId + '.json');
    await fs.mkdir(inbox, { recursive: true });
    await fs.writeFile(requestFile + '.tmp', JSON.stringify({ version: 1, requestId, file: incoming, createdAt: Date.now() }));
    await fs.rename(requestFile + '.tmp', requestFile);
    const resultFile = path.join(data, 'bridge/document-import/results', requestId + '.json');
    let receipt;
    for (let i = 0; i < 100; i++) {
      try { receipt = JSON.parse(await fs.readFile(resultFile, 'utf8')); break; } catch {}
      await page.waitForTimeout(100);
    }
    assert.equal(receipt?.ok, true, JSON.stringify(receipt));
    await page.waitForFunction(() => document.querySelector('#asset-count').textContent.includes('2 个'));
    assert.equal((await page.evaluate(() => window.shelf.snapshot())).assets.length, 2);
    assert.deepEqual(await fs.readFile(source), await fs.readFile(copy));
    checks.push('desktop receives real file-bridge request without restart and refreshes asset cards');
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(output, 'new-actions.png') });
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: true, checks, pageErrors: errors }, null, 2));
    console.log(JSON.stringify({ passed: true, checks, pageErrors: errors }, null, 2));
  } catch (error) {
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    if (app) await app.close().catch(() => {});
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
