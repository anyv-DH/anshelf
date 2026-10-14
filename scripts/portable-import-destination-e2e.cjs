/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.ANSHELF_PLAYWRIGHT || 'playwright');

async function main() {
  const root = path.resolve(__dirname, '..');
  const config = require(path.join(root, 'package.json'));
  const executable = process.env.ANSHELF_PORTABLE_EXECUTABLE || path.join(root, 'release', `${config.build.productName} ${config.version}.exe`);
  const output = process.env.ANSHELF_IMPORT_CHECK_OUTPUT || path.join(root, 'test-output', 'portable-import-destination');
  await fs.mkdir(output, { recursive: true });
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-portable-import-'));
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const child = spawn(executable, [`--remote-debugging-port=${port}`, `--user-data-dir=${path.join(temporary, 'profile')}`], {
    env: { ...process.env, ANSHELF_DATA_DIR: path.join(temporary, 'library') }, stdio: 'ignore', windowsHide: true,
  });
  let launchError, browser, page;
  child.on('error', error => { launchError = error; });
  const checks = [], errors = [];
  try {
    let endpoint;
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (launchError) throw launchError;
      if (child.exitCode !== null) throw new Error(`Portable launcher exited: ${child.exitCode}`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) });
        if (response.ok) { endpoint = await response.json(); break; }
      } catch { /* Wait for extraction and startup. */ }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.ok(endpoint?.webSocketDebuggerUrl, 'Portable program must start');
    browser = await chromium.connectOverCDP(endpoint.webSocketDebuggerUrl);
    page = browser.contexts()[0].pages()[0];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('.import-main');
    for (const mode of ['ordinary', 'effect', 'audio']) {
      await page.locator(`[data-action="import"][data-mode="${mode}"]`).click();
      await page.waitForSelector('#dialog[open]');
      await page.screenshot({ path: path.join(output, `import-${mode}.png`) });
      assert.equal(await page.locator('#import-category').isVisible(), true, `${mode}: import must show the destination category selector`);
      await page.locator('[data-action="import-create-category"]').click();
      await page.locator('#import-folder-name').fill(`导入测试-${mode}`);
      await page.locator('[data-action="save-import-folder"]').click();
      await page.waitForFunction(() => !!document.querySelector('#import-category')?.value);
      const parentId = await page.locator('#import-category').inputValue();
      await page.locator('#import-category').selectOption('');
      await page.locator('#import-category').selectOption(parentId);
      await page.locator('[data-action="import-create-child-category"]').click();
      await page.locator('#import-folder-name').fill('子分类');
      await page.locator('[data-action="save-import-folder"]').click();
      await page.waitForFunction(() => document.querySelector('#import-category option:checked')?.textContent.includes('子分类'));
      const childId = await page.locator('#import-category').inputValue();
      const snapshot = await page.evaluate(() => window.shelf.snapshot());
      assert.equal(snapshot.categories.find(category => category.id === childId)?.parentId, parentId);
      checks.push(`${mode}: create folder, select existing folder and create selected child folder`);
      await page.screenshot({ path: path.join(output, `import-${mode}-child.png`) });
      await page.locator('[data-action="close-dialog"]').click();
    }
    assert.deepEqual(errors, []);
    const result = { passed: true, executable, checks, pageErrors: errors };
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ passed: false, executable, checks, error: error.message, pageErrors: errors }, null, 2));
    throw error;
  } finally {
    if (page && !page.isClosed()) await page.evaluate(() => window.shelf.windowAction('close')).catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (child.exitCode === null) await new Promise(resolve => {
      const timer = setTimeout(() => { child.kill(); resolve(); }, 5000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
