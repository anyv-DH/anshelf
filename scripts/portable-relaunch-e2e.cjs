/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { chromium } = require(process.env.ANSHELF_PLAYWRIGHT || 'playwright');

async function waitUntil(read, accept, label, timeout = 60000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (accept(last)) return last;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`${label}: ${JSON.stringify(last)}`);
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const pkg = require(path.join(root, 'package.json'));
  const executable = process.env.ANSHELF_PORTABLE_EXECUTABLE || path.join(root, 'release', `${pkg.build.productName} ${pkg.version}.exe`);
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-portable-relaunch-'));
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  const profile = `--user-data-dir=${path.join(temporary, 'profile')}`;
  const options = { env: { ...process.env, ANSHELF_DATA_DIR: path.join(temporary, 'library') }, stdio: 'ignore', windowsHide: true };
  const child = spawn(executable, [`--remote-debugging-port=${port}`, profile], options);
  let browser, page;
  const errors = [], checks = [];
  try {
    const endpoint = await waitUntil(async () => {
      if (child.exitCode !== null) throw new Error(`Portable launcher exited: ${child.exitCode}`);
      try { return await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) })).json(); }
      catch { return null; }
    }, value => value?.webSocketDebuggerUrl, 'Portable application must start');
    browser = await chromium.connectOverCDP(endpoint.webSocketDebuggerUrl);
    page = browser.contexts()[0].pages()[0];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('.import-main');
    await page.locator('[data-action="demo"]').click();
    const initial = await waitUntil(() => page.evaluate(() => window.shelf.snapshot()), value =>
      value.assets.length === 6 && value.assets.every(asset => ['ready', 'failed'].includes(asset.previewStatus)), 'Initial previews must finish');
    assert.ok(initial.assets.every(asset => asset.previewStatus === 'ready'), 'Initial previews must succeed');
    checks.push('portable startup and initial offline FLA previews');

    // Double-clicking the same desktop shortcut must only focus the first app.
    // The second portable launcher must not delete the first launcher's runtime.
    const duplicate = spawn(executable, [profile], options);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { duplicate.kill(); reject(new Error('Duplicate launcher did not finish')); }, 30000);
      duplicate.once('error', error => { clearTimeout(timer); reject(error); });
      duplicate.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    checks.push('second shortcut launch exits while original window stays open');
    const id = initial.assets[0].id;
    await page.evaluate(id => window.shelf.retryPreview(id), id);
    const retried = await waitUntil(() => page.evaluate(() => window.shelf.snapshot()), value => {
      const asset = value.assets.find(asset => asset.id === id);
      return ['ready', 'failed'].includes(asset?.previewStatus) && value.queue.active === null && value.queue.pending === 0;
    }, 'Preview after repeated launch must finish');
    const asset = retried.assets.find(asset => asset.id === id);
    assert.equal(asset.previewStatus, 'ready', `Preview after repeated launch: ${asset.previewError}`);
    await page.waitForFunction(id => document.querySelector(`.asset-card[data-asset="${id}"] img`)?.naturalWidth > 0, id);
    checks.push('new preview renderer starts and its image decodes after repeated launch');
    assert.equal(retried.assets.length, initial.assets.length);
    assert.deepEqual(retried.categories, initial.categories);
    assert.deepEqual(errors, []);
    const report = { passed: true, checks, errors };
    await fs.mkdir(path.join(root, 'test-output'), { recursive: true });
    await fs.writeFile(path.join(root, 'test-output', 'portable-relaunch-report.json'), JSON.stringify(report, null, 2));
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
