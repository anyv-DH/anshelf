/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { _electron } = require(process.env.ANSHELF_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');

async function main() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-skin-e2e-'));
  const data = path.join(temporary, 'data'), profile = path.join(temporary, 'profile');
  const output = process.env.ANSHELF_SKIN_OUTPUT || path.join(root, 'test-output/skin-ui');
  await fs.mkdir(output, { recursive: true });
  const ffmpeg = process.env.ANSHELF_FFMPEG || 'ffmpeg';
  const image = path.join(temporary, '渐变底图.png'), gif = path.join(temporary, '动态测试.gif'), video = path.join(temporary, '动态测试.webm');
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x665588:s=640x360', '-frames:v', '1', image], { windowsHide: true });
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=6', '-t', '1', gif], { windowsHide: true });
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=12', '-t', '1', '-c:v', 'libvpx', '-an', video], { windowsHide: true });
  const checks = [], errors = [];
  const executablePath = process.env.ANSHELF_UI_EXECUTABLE || require(path.join(root, 'node_modules/electron'));
  let app, page;
  async function launch() {
    app = await _electron.launch({ executablePath, args: [...(process.env.ANSHELF_UI_EXECUTABLE ? [] : [root]), '--user-data-dir=' + profile], env: { ...process.env, ANSHELF_DATA_DIR: data }, timeout: 60000 });
    page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('[data-action="skin-settings"]');
  }
  async function choose(file) {
    await app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: !selected, filePaths: selected ? [selected] : [] }); }, file);
    await page.locator('.skin-select').click();
    await page.waitForFunction(() => !document.querySelector('.skin-select').disabled);
    return page.evaluate(() => window.shelf.getSkin());
  }
  try {
    await launch();
    await page.locator('[data-action="skin-settings"]').click();
    assert.equal(await page.locator('#skin-dialog').isVisible(), true);
    const first = await choose(image);
    await page.waitForFunction(() => document.querySelector('#skin-background img')?.naturalWidth === 640);
    assert.equal(first.type, 'image');
    assert.ok(!JSON.stringify(first).includes(image));
    checks.push('native file choice decodes a real PNG through the restricted local skin protocol');
    await page.locator('#skin-opacity').fill('70');
    await page.locator('#skin-opacity').dispatchEvent('change');
    await page.waitForFunction(async () => (await window.shelf.getSkin()).opacity === .7);
    const beforeCancel = await page.evaluate(() => window.shelf.getSkin());
    assert.deepEqual(await choose(null), beforeCancel);
    checks.push('opacity persists and native chooser cancellation preserves the current choice');
    await app.close(); app = null;
    await launch();
    await page.waitForFunction(() => document.querySelector('#skin-background img')?.naturalWidth === 640);
    const reopened = await page.evaluate(() => window.shelf.getSkin());
    assert.equal(reopened.opacity, .7); assert.equal(reopened.revision, first.revision);
    await page.locator('[data-action="skin-settings"]').click();
    checks.push('reopening the app restores image and opacity from the same tiny settings file');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await choose(gif);
    await page.waitForFunction(() => !document.querySelector('#skin-background img')?.hasAttribute('src'), undefined, { polling: 100 });
    await page.locator('#skin-animated').check();
    await page.waitForFunction(() => document.querySelector('#skin-background img')?.naturalWidth === 320);
    checks.push('GIF decodes after explicit playback while reduced-motion mode starts it paused');
    await page.locator('.skin-close').click();
    await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows().find(w => w.getTitle().includes('安安')); win.minimize(); });
    await page.waitForFunction(() => !document.querySelector('#skin-background img')?.hasAttribute('src'), undefined, { polling: 100 });
    await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows().find(w => !w.webContents.isDestroyed()); win.restore(); win.show(); win.focus(); });
    await page.waitForFunction(() => document.querySelector('#skin-background img')?.naturalWidth === 320);
    await page.locator('[data-action="skin-settings"]').click();
    checks.push('actual window minimization unloads GIF and restoration resumes playback');

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await choose(video);
    await page.waitForFunction(() => document.querySelector('#skin-background video')?.videoWidth === 320);
    if (!await page.locator('#skin-animated').isChecked()) await page.locator('#skin-animated').check();
    await page.waitForFunction(() => document.querySelector('#skin-background video')?.currentTime > 0);
    await app.evaluate(({ BrowserWindow }) => { globalThis.skinBlurProbe = new BrowserWindow({ width: 220, height: 140, show: true }); globalThis.skinBlurProbe.focus(); });
    await page.waitForFunction(() => document.querySelector('#skin-background video')?.paused === true, undefined, { polling: 100 });
    assert.match(await page.locator('.skin-current-status').textContent(), /后台.*暂停/);
    await app.evaluate(({ BrowserWindow }) => { globalThis.skinBlurProbe.close(); const win = BrowserWindow.getAllWindows().find(w => !w.webContents.isDestroyed()); win.show(); win.focus(); });
    await page.waitForFunction(() => document.querySelector('#skin-background video')?.paused === false);
    checks.push('real WebM decodes and plays; actual focus loss pauses video and focus restoration resumes it');
    await page.locator('#skin-animated').uncheck();
    await page.waitForFunction(() => document.querySelector('#skin-background video')?.paused === true);
    const url = (await page.evaluate(() => window.shelf.getSkin())).url;
    const response = await app.evaluate(async ({net}, selected) => { const r = await net.fetch(selected, { headers: { Range: 'bytes=0-15' } }); return { status: r.status, range: r.headers.get('content-range'), bytes: (await r.arrayBuffer()).byteLength }; }, url);
    assert.equal(response.status, 206); assert.equal(response.bytes, 16);
    checks.push('video range requests stream only requested bytes and the manual pause switch stops playback');
    await page.screenshot({ path: path.join(output, 'skin-settings.png') });
    const brokenImage = path.join(temporary, '无法解码.png');
    await fs.writeFile(brokenImage, 'this-is-not-a-png');
    await choose(brokenImage);
    await page.waitForFunction(() => !document.documentElement.classList.contains('has-custom-skin') && document.querySelector('.skin-error').textContent.includes('恢复默认'));
    checks.push('undecodable background restores the ordinary display and offers reselection without blocking the library');
    await page.locator('.skin-reset').click();
    await page.waitForFunction(() => !document.documentElement.classList.contains('has-custom-skin'));
    await page.waitForFunction(async () => (await window.shelf.getSkin()).enabled === false);
    assert.equal((await page.evaluate(() => window.shelf.getSkin())).enabled, false);
    assert.equal((await fs.readdir(data)).includes(path.basename(video)), false);
    await fs.access(image); await fs.access(gif); await fs.access(video);
    checks.push('reset restores the ordinary theme, original files remain untouched and no background media is copied');
    assert.deepEqual(errors, []);
    const report = { passed: true, checks, pageErrors: errors };
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    if (app) console.error('skin-state', await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().map(w=>({title:w.getTitle(),visible:w.isVisible(),minimized:w.isMinimized(),focused:w.isFocused()}))).catch(()=>null));
    if (page && !page.isClosed()) console.error('skin-dom', await page.evaluate(()=>({hidden:document.hidden,focus:document.hasFocus(),status:document.querySelector('.skin-current-status')?.textContent,img:document.querySelector('#skin-background img')?.getAttribute('src')})).catch(()=>null));
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    if (app) await app.close().catch(() => {});
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
