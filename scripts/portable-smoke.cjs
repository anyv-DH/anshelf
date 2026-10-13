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
  const executable = process.env.ANSHELF_PORTABLE_EXECUTABLE || path.join(root, 'release/安安素材管理器 0.2.0.exe');
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-portable-smoke-'));
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const child = spawn(executable, [`--remote-debugging-port=${port}`, `--user-data-dir=${path.join(base, 'profile')}`], {
    env: { ...process.env, ANSHELF_DATA_DIR: path.join(base, 'library') }, stdio: 'ignore', windowsHide: true,
  });
  let launchError, endpoint, browser, page;
  child.on('error', error => { launchError = error; });
  const errors = [], checks = [];
  try {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (launchError) throw launchError;
      if (child.exitCode !== null) throw new Error('Portable launcher exited before the window was ready: ' + child.exitCode);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) });
        if (response.ok) { endpoint = await response.json(); break; }
      } catch { /* The portable application is still extracting or starting. */ }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(endpoint?.webSocketDebuggerUrl, 'Portable application must expose its test renderer');
    browser = await chromium.connectOverCDP(endpoint.webSocketDebuggerUrl);
    page = browser.contexts()[0].pages()[0];
    await page.waitForSelector('.import-main');
    page.on('pageerror', error => errors.push(error.message));
    assert.equal(await page.title(), '安安素材管理器');
    assert.equal(await page.locator('#inspector').isVisible(), false);
    checks.push('portable EXE extracts and opens an isolated library');
    assert.match(await page.locator('.brand .anan-wordmark').evaluate(element => getComputedStyle(element).maskImage), /brand-anan\.svg/);
    checks.push('original wordmark loads from the portable package');
    await page.locator('[data-action="demo"]').click();
    const previewDeadline = Date.now() + 90000;
    let snapshot;
    while (Date.now() < previewDeadline) {
      snapshot = await page.evaluate(() => window.shelf.snapshot());
      if (snapshot.assets.length === 6 && snapshot.assets.every(asset => asset.previewStatus === 'ready')) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.equal(snapshot.assets.length, 6);
    assert.ok(snapshot.assets.every(asset => asset.previewStatus === 'ready'));
    await page.waitForFunction(() => document.querySelectorAll('.asset-card img').length === 6 && [...document.querySelectorAll('.asset-card img')].every(image => image.naturalWidth > 0));
    checks.push('all six bundled FLA previews render and decode');
    await page.locator('#density').click();
    await page.locator('[data-action="density"][data-density="6"]').click();
    assert.equal(await page.locator('#asset-grid').getAttribute('data-columns'), '6');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    checks.push('six-column density works without horizontal overflow');
    await page.locator('[data-action="theme"][data-theme="warm"]').click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'warm');
    checks.push('warm theme works in the portable application');
    assert.deepEqual(errors, []);
    const report = { passed: true, checks, errors };
    await fs.writeFile(path.join(root, 'test-output/portable-smoke-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
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
