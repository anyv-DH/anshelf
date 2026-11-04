/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { _electron } = require(process.env.ANSHELF_PLAYWRIGHT || 'playwright');
const { Library } = require('../core/library.cjs');

const root = path.resolve(__dirname, '..');
const runtime = ['CSXS/manifest.xml', 'META-INF/signatures.xml', 'mimetype', 'panel.js', 'style.css', 'index.html', 'queue.cjs', 'insert-whole.jsfl', 'icon.png', 'README.md'];
const packaged = path.join(root, 'release/win-unpacked');
const executable = path.join(packaged, '安安素材管理器.exe');
const bundled = path.join(packaged, 'resources/AnimatePlugin');
const output = path.join(root, 'test-output/plugin-update-packaged');

async function digest(file) {
  const bytes = await fs.readFile(file), stat = await fs.stat(file);
  return { sha256: createHash('sha256').update(bytes).digest('hex'), size: stat.size, mtimeMs: stat.mtimeMs };
}
async function tree(directory) {
  const result = {};
  async function visit(current, prefix = '') {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      assert.equal(entry.isSymbolicLink(), false, 'test fixtures must not contain links');
      const key = prefix + entry.name, file = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(file, key + '/'); else result[key] = await digest(file);
    }
  }
  await visit(directory); return result;
}
async function absent(file) {
  await assert.rejects(fs.lstat(file), { code: 'ENOENT' });
}

async function main() {
  assert.equal(process.platform, 'win32', 'this verifies the real Windows packaged installer');
  await fs.access(executable);
  await fs.mkdir(output, { recursive: true });
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-plugin-packaged-'));
  const appData = path.join(temporary, 'isolated-appdata');
  const data = path.join(temporary, 'isolated-library');
  const profile = path.join(temporary, 'isolated-profile');
  const originals = path.join(temporary, 'originals');
  const cepBase = path.join(appData, 'Adobe/CEP');
  const installed = path.join(cepBase, 'extensions/com.anshelf.receiver');
  await fs.mkdir(originals, { recursive: true });
  await fs.mkdir(appData, { recursive: true });
  const source = path.join(originals, '不应改动的示例人物.fla');
  const sample = (await fs.readdir(path.join(root, 'demo'))).find(file => file.endsWith('.fla'));
  await fs.copyFile(path.join(root, 'demo', sample), source);
  await fs.writeFile(source.replace(/\.fla$/, '.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=', 'base64'));
  const library = await Library.open(data);
  const asset = (await library.importPaths([source], { preferExistingPreview: true })).assets[0];
  assert.equal(asset.previewStatus, 'ready');
  const originalsBefore = await tree(originals), libraryBefore = await tree(data);
  const version = (await fs.readFile(path.join(bundled, 'CSXS/manifest.xml'), 'utf8')).match(/ExtensionBundleVersion="([\d.]+)"/)[1];
  const errors = [], nativeDialogs = [], checks = [];
  let app, page;
  async function launch() {
    app = await _electron.launch({
      executablePath: executable, args: [`--user-data-dir=${profile}`],
      env: { ...process.env, APPDATA: appData, ANSHELF_DATA_DIR: data, PORTABLE_EXECUTABLE_FILE: '' }, timeout: 60000
    });
    page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => { nativeDialogs.push({ type: dialog.type(), message: dialog.message() }); dialog.dismiss(); });
    const context = await app.evaluate(({ app, BrowserWindow, dialog }) => {
      BrowserWindow.getAllWindows()[0].setContentSize(930, 700);
      globalThis.packagedPluginNativeDialogs = [];
      // Guard unexpected native dialogs only. The real shelf IPC, updater,
      // PowerShell spawn and signed install script are left untouched.
      for (const method of ['showMessageBox', 'showMessageBoxSync', 'showErrorBox', 'showOpenDialog', 'showOpenDialogSync', 'showSaveDialog', 'showSaveDialogSync']) {
        dialog[method] = (...args) => {
          globalThis.packagedPluginNativeDialogs.push({ method, args: args.map(value => typeof value === 'string' ? value : typeof value) });
          throw new Error('Unexpected native dialog during packaged plugin installation: ' + method);
        };
      }
      return { packaged: app.isPackaged, appData: process.env.APPDATA, data: process.env.ANSHELF_DATA_DIR, appPath: app.getAppPath() };
    });
    assert.equal(context.packaged, true);
    assert.equal(path.relative(context.appData, appData), '', 'packaged default plugin location must use only isolated AppData');
    assert.equal(path.relative(context.data, data), '');
    assert.match(context.appPath, /app\.asar$/);
    await page.locator('#app-update').waitFor();
  }
  async function close() {
    if (!app) return;
    nativeDialogs.push(...await app.evaluate(() => globalThis.packagedPluginNativeDialogs));
    await app.close(); app = null; page = null;
  }
  async function openUpdates() {
    await page.locator('#app-update').click();
    await page.locator('[data-plugin-panel]').waitFor({ state: 'visible' });
  }
  try {
    // Verify default, fixed production launch arguments and registry guard from
    // the actual package, without querying or changing the real registry.
    const builder = path.dirname(require.resolve('electron-builder'));
    const lib = path.dirname(require.resolve('app-builder-lib', { paths: [builder] }));
    const asar = require(require.resolve('@electron/asar', { paths: [lib] }));
    const updaterSource = asar.extractFile(path.join(packaged, 'resources/app.asar'), 'desktop/plugin-update.cjs').toString('utf8');
    const installSource = await fs.readFile(path.join(bundled, 'install.ps1'), 'utf8');
    assert.match(updaterSource, /'-File', file\]/);
    assert.doesNotMatch(updaterSource, /['"]-EnableDebug['"]/);
    assert.match(installSource, /if \(\$EnableDebug\) \{[\s\S]*New-ItemProperty/);
    checks.push('packaged production installer uses no debug switch; registry mutation is guarded by explicit EnableDebug; no registry was read');

    await launch(); await openUpdates();
    await page.waitForFunction(() => document.querySelector('[data-plugin-state]')?.textContent.includes('尚未安装'));
    assert.match(await page.locator('[data-plugin-bundled]').textContent(), new RegExp(version.replaceAll('.', '\\.')));
    assert.match(await page.locator('[data-plugin-installed]').textContent(), /无/);
    await absent(cepBase);
    await page.locator('[data-plugin-panel]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, '01-not-installed.png'), scale: 'css' });
    checks.push('real packaged UI detects no installed plugin inside isolated AppData and displays the bundled version');

    await page.locator('[data-plugin-action="install"]').click();
    await page.locator('#confirm-dialog[open]').waitFor();
    assert.match(await page.locator('#confirm-message').textContent(), /不会自动保存或关闭 AN/);
    await page.screenshot({ path: path.join(output, '02-confirm-install.png'), scale: 'css' });
    await page.locator('#confirm-dialog[open] [data-confirm="cancel"]').click();
    await page.locator('#confirm-dialog').waitFor({ state: 'hidden' });
    await absent(cepBase);
    assert.deepEqual(await tree(data), libraryBefore);
    checks.push('cancelling the themed confirmation creates no CEP directory and changes no library file');

    await page.locator('[data-plugin-action="install"]').click();
    await page.locator('#confirm-dialog[open] [data-confirm="accept"]').click();
    await page.waitForFunction(() => document.querySelector('[data-plugin-state]')?.textContent.includes('已是随软件附带的版本'), undefined, { timeout: 45000 });
    await page.locator('[data-plugin-restart]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-plugin-error]').isVisible(), false);
    for (const relative of runtime) assert.deepEqual(await fs.readFile(path.join(installed, relative)), await fs.readFile(path.join(bundled, relative)), relative);
    assert.deepEqual(Object.keys(await tree(installed)).sort(), runtime.slice().sort());
    assert.deepEqual(await tree(originals), originalsBefore);
    assert.deepEqual(await tree(data), libraryBefore);
    await page.locator('[data-plugin-panel]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, '03-installed-current.png'), scale: 'css' });
    checks.push('explicit confirmation executes the real packaged PowerShell installer; all ten signed runtime files match release resources byte for byte');
    checks.push('original FLA, preview and isolated library retain identical bytes, timestamps and membership; no Animate document was opened or closed');

    await close(); await launch(); await openUpdates();
    await page.waitForFunction(() => document.querySelector('[data-plugin-state]')?.textContent.includes('已是随软件附带的版本'));
    assert.match(await page.locator('[data-plugin-installed]').textContent(), new RegExp(version.replaceAll('.', '\\.')));
    assert.equal(await page.locator('[data-plugin-action="install"]').isEnabled(), false);
    for (const relative of runtime) assert.deepEqual(await fs.readFile(path.join(installed, relative)), await fs.readFile(path.join(bundled, relative)), relative);
    await page.locator('[data-plugin-panel]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, '04-current-after-restart.png'), scale: 'css' });
    checks.push('a genuine packaged-process restart finds the same installed plugin and disables redundant installation');
    await close();
    assert.deepEqual(await tree(originals), originalsBefore);
    assert.deepEqual(await tree(data), libraryBefore);
    assert.deepEqual(errors, []); assert.deepEqual(nativeDialogs, []);
    const report = { passed: true, version, packagedExecutable: executable, mockedPluginIpc: false, mockedInstaller: false, checks, pageErrors: errors, nativeDialogs };
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await close().catch(() => {});
    // This is the task-owned mkdtemp root; only isolated test files are removed.
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
