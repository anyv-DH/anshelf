/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const zlib = require('node:zlib');
const { _electron } = require(process.env.ANSHELF_PLAYWRIGHT || 'playwright');
const { Library } = require('../core/library.cjs');
const root = path.resolve(__dirname, '..');

// A small local illustration makes screenshot previews useful without remote assets.
function previewPng() {
  function crc(buffer) {
    let value = 0xffffffff;
    for (const byte of buffer) {
      value ^= byte;
      for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
    return (value ^ 0xffffffff) >>> 0;
  }
  function chunk(type, data) {
    const name = Buffer.from(type), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(Buffer.concat([name, data])));
    return Buffer.concat([length, name, data, checksum]);
  }
  const width = 320, height = 240, pixels = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = y * (1 + width * 4) + 1 + x * 4;
    const circle = Math.hypot(x - 160, y - 112) < 58;
    const ground = y > 180 + Math.sin(x / 42) * 14;
    const color = circle ? [233, 175, 105, 255] : ground ? [100, 146, 139, 255] : [0, 0, 0, 0];
    color.forEach((value, channel) => { pixels[offset + channel] = value; });
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

function audioWav() {
  const rate = 8000, samples = rate * 15, data = Buffer.alloc(44 + samples * 2);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) data.writeInt16LE(Math.round(Math.sin(index * 440 * Math.PI * 2 / rate) * 600), 44 + index * 2);
  return data;
}

async function main() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-appearance-ui-'));
  const data = path.join(temporary, 'library'), profile = path.join(temporary, 'profile');
  const output = process.env.ANSHELF_APPEARANCE_OUTPUT || path.join(root, 'test-output/appearance-ui');
  await fs.mkdir(output, { recursive: true });
  const source = path.join(temporary, '布局测试.fla'), picture = path.join(temporary, '布局测试.png'), sound = path.join(temporary, '外观试听.wav');
  const demos = (await fs.readdir(path.join(root, 'demo'))).filter(file => file.endsWith('.fla'));
  await fs.copyFile(path.join(root, 'demo', demos[0]), source);
  await fs.writeFile(picture, previewPng()); await fs.writeFile(sound, audioWav());
  const originals = await Promise.all([source, picture, sound].map(async file => createHash('sha256').update(await fs.readFile(file)).digest('hex')));
  const library = await Library.open(data);
  const category = await library.createCategory('外观验收分类', null, 'ordinary');
  const imported = await library.importPaths([source], { categoryId: category.id });
  const first = imported.assets[0];
  for (let index = 1; index < 65; index++) {
    const asset = await library.duplicateAsset(first.id);
    await library.updateAsset(asset.id, { name: '布局测试 · ' + String(index).padStart(2, '0') });
  }
  await library.importPaths([sound], { mode: 'audio' });
  const originalIndex = await fs.readFile(path.join(data, 'library.json'));
  const checks = [], errors = [], geometry = [];
  let app, page;
  async function launch() {
    app = await _electron.launch({
      executablePath: process.env.ANSHELF_UI_EXECUTABLE || require(path.join(root, 'node_modules/electron')),
      args: [...(process.env.ANSHELF_UI_EXECUTABLE ? [] : [root]), '--user-data-dir=' + profile],
      env: { ...process.env, ANSHELF_DATA_DIR: data }, timeout: 60000,
    });
    page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('main');
    assert.equal(await page.locator('[data-action="appearance-settings"]').count(), 1, 'persistent appearance settings entry exists');
    await page.waitForSelector('.asset-card');
    await page.evaluate(() => localStorage.setItem('anshelf-check-updates-on-start', 'false'));
  }
  const openAppearance = () => page.locator('[data-action="appearance-settings"]').click();
  async function openCategoryPanel() {
    if (await page.locator('html').getAttribute('data-layout') === 'modern' && !await page.locator('#category-panel').isVisible()) {
      await page.locator('[data-top-categories]').click();
    }
  }
  async function choose(kind, value) {
    await page.locator(`[data-appearance-${kind}="${value}"]`).click();
    await page.waitForFunction(({kind, value}) => document.documentElement.dataset[kind] === value, { kind, value });
    assert.equal(await page.locator(`[data-appearance-${kind}="${value}"]`).getAttribute('aria-pressed'), 'true');
  }
  const closeAppearance = () => page.locator('[data-appearance-close]').first().click();
  async function resize(width, height) {
    await app.evaluate(({BrowserWindow}, size) => {
      const win = BrowserWindow.getAllWindows().find(window => window.getTitle() === '安安素材管理器');
      win.setContentSize(size.width, size.height);
    }, { width, height });
    // The Windows minimum window size rounds by up to two CSS pixels at 125% DPI.
    await page.waitForFunction(({width,height}) => Math.abs(innerWidth - width) <= 2 && Math.abs(innerHeight - height) <= 2, { width, height });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  async function checkGeometry(label) {
    const metrics = await page.evaluate(() => {
      const main = document.querySelector('.main'), rect = main.getBoundingClientRect();
      const visible = element => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0; };
      const box = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width, height: r.height }; };
      return {
        viewport: [innerWidth, innerHeight], layout: document.documentElement.dataset.layout, theme: document.documentElement.dataset.theme,
        bodyOverflow: document.body.scrollWidth - innerWidth, mainOverflow: main.scrollWidth - main.clientWidth,
        main: box(main), controls: [...document.querySelectorAll('.tools > *, .import-entries > button, .window-actions > button')].filter(visible)
          .map(element => ({ id: element.id || element.dataset.action || element.className, ...box(element) })),
        preview: box(document.querySelector('.card-preview')), columns: document.querySelector('#asset-grid').dataset.columns,
        inspectorVisible: visible(document.querySelector('#inspector')) && !document.querySelector('#inspector').hidden,
        sidebarOverflow: document.querySelector('.sidebar').scrollHeight - document.querySelector('.sidebar').clientHeight,
        navigation: box(document.querySelector('#navigation')),
        topControls: [...document.querySelectorAll('[data-top-categories], [data-top-more]')].filter(visible).map(element => ({ id: element.dataset.topCategories !== undefined ? 'categories' : 'more', ...box(element) })),
      };
    });
    const issues = [];
    if (metrics.bodyOverflow > 1) issues.push('body horizontal overflow ' + metrics.bodyOverflow);
    if (metrics.mainOverflow > 1) issues.push('main horizontal overflow ' + metrics.mainOverflow);
    for (const control of metrics.controls) {
      if (control.left < metrics.main.left - 1 || control.right > metrics.main.right + 1) issues.push('clipped control ' + JSON.stringify(control));
    }
    if (metrics.layout === 'classic' && metrics.sidebarOverflow > 1) issues.push('sidebar overflow ' + metrics.sidebarOverflow);
    if (metrics.layout === 'modern') {
      if (metrics.main.left > 1) issues.push('modern layout retains left sidebar width ' + metrics.main.left);
      if (metrics.navigation.width < 20 || metrics.navigation.left < -1 || metrics.navigation.right > metrics.viewport[0] + 1) issues.push('top navigation clipped ' + JSON.stringify(metrics.navigation));
      for (const control of metrics.topControls) if (control.left < -1 || control.right > metrics.viewport[0] + 1) issues.push('top control clipped ' + JSON.stringify(control));
      if (metrics.topControls.length !== 2) issues.push('top category/more controls missing');
    }
    geometry.push({ label, issues, ...metrics });
  }
  try {
    await launch();
    assert.equal(await page.locator('html').getAttribute('data-layout'), 'modern');
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    assert.equal(await page.locator('.asset-card').count(), 60);
    await page.waitForFunction(() => [...document.querySelectorAll('.card-preview img')].some(image => image.naturalWidth === 320));
    checks.push('fresh isolated profile opens modern layout and renders real local previews with the existing 60-item page limit');

    await openCategoryPanel();
    await page.locator(`#categories .nav-item[data-id="${category.id}"]`).click();
    await page.locator('#search').fill('布局测试');
    await page.locator('[data-action="next-page"]').click();
    await page.locator('.asset-card .filename-row h3').first().click();
    await page.locator('.asset-card .filename-row h3').nth(1).click({ modifiers: ['Control'] });
    await openAppearance();
    await page.evaluate(() => {
      globalThis.appearanceProbe = {
        nodes: [...document.querySelectorAll('.asset-card')], selected: [...document.querySelectorAll('.asset-card.selected')].map(card => card.dataset.asset),
        pagination: document.querySelector('#asset-pagination').textContent, breadcrumb: document.querySelector('#breadcrumb').textContent,
        search: document.querySelector('#search').value, scroll: document.querySelector('.main').scrollTop,
      };
    });
    for (const layout of ['classic', 'modern']) for (const theme of ['dark', 'warm', 'paper', 'slate', 'sage']) {
      await choose('layout', layout); await choose('theme', theme);
      const preserved = await page.evaluate(() => {
        const probe = globalThis.appearanceProbe;
        return probe.nodes.every((node, index) => node === document.querySelectorAll('.asset-card')[index])
          && probe.selected.join() === [...document.querySelectorAll('.asset-card.selected')].map(card => card.dataset.asset).join()
          && probe.pagination === document.querySelector('#asset-pagination').textContent
          && probe.breadcrumb === document.querySelector('#breadcrumb').textContent
          && probe.search === document.querySelector('#search').value;
      });
      assert.equal(preserved, true, layout + '/' + theme + ' preserves nodes, selection, page and query');
      assert.equal(await page.locator('meta[name="color-scheme"]').getAttribute('content'), ['warm', 'paper', 'sage'].includes(theme) ? 'light' : 'dark');
      const expected = { dark: '#171520', warm: '#f7f1e9', paper: '#f4f5f7', slate: '#191f27', sage: '#f0f4f1' }[theme];
      let background;
      for (let attempt = 0; attempt < 30; attempt++) {
        background = await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().find(window => window.getTitle() === '安安素材管理器').getBackgroundColor());
        if (background.toLowerCase() === expected) break;
        await page.waitForTimeout(20);
      }
      assert.equal(background.toLowerCase(), expected, 'native window background follows ' + theme);
    }
    await page.screenshot({ path: path.join(output, 'appearance-settings.png') });
    await closeAppearance();
    checks.push('all ten layout/palette combinations preserve exact card DOM, category, query, second page and multi-selection; native window colors follow each theme');

    // Exercise toolbar measurements with actual rendered content and selected actions.
    for (const size of [[1480,940], [1080,760], [930,700], [850,600]]) {
      await resize(...size);
      for (const theme of ['paper','slate','sage','dark','warm']) {
        await openAppearance(); await choose('theme', theme); await closeAppearance();
        await checkGeometry(`modern-${size.join('x')}-${theme}`);
        if (size[0] === 1480 && ['paper','slate','sage'].includes(theme)) await page.screenshot({ path: path.join(output, `modern-${size.join('x')}-${theme}.png`) });
      }
      if (size[0] === 1480 || size[0] === 930) await page.screenshot({ path: path.join(output, `modern-${size.join('x')}.png`) });
      await page.locator('#inspector-toggle').click();
      await checkGeometry(`modern-${size.join('x')}-inspector`);
      if (size[0] <= 930) await page.screenshot({ path: path.join(output, `modern-${size.join('x')}-inspector.png`) });
      await page.locator('#inspector [data-action="toggle-inspector"]').click();
      await openCategoryPanel();
      const panel = await page.locator('#category-panel').boundingBox();
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      assert.ok(panel && panel.x >= 0 && panel.y >= 0 && panel.x + panel.width <= viewport.width + 1 && panel.y + panel.height <= viewport.height + 1, 'category drawer fits ' + JSON.stringify({size,panel,viewport}));
      await page.locator('#category-filter').fill('外观验收');
      assert.equal(await page.locator(`#categories .nav-item[data-id="${category.id}"]`).isVisible(), true);
      if (size[0] === 930) await page.screenshot({ path: path.join(output, 'modern-930x700-categories.png') });
      await page.locator('#category-filter').fill('');
      const selectedBeforeEscape = await page.locator('.asset-card.selected').evaluateAll(cards => cards.map(card => card.dataset.asset));
      await page.locator('#category-filter').press('Escape');
      assert.equal(await page.locator('#category-panel').isVisible(), false);
      assert.equal(await page.locator('[data-top-categories]').evaluate(element => element === document.activeElement), true);
      assert.deepEqual(await page.locator('.asset-card.selected').evaluateAll(cards => cards.map(card => card.dataset.asset)), selectedBeforeEscape, 'drawer Escape preserves selection');
      await page.locator('[data-top-more]').click();
      const morePanel = await page.locator('#top-more-panel').boundingBox();
      assert.ok(morePanel && morePanel.x >= 0 && morePanel.y >= 0 && morePanel.x + morePanel.width <= viewport.width + 1 && morePanel.y + morePanel.height <= viewport.height + 1, 'more panel fits ' + JSON.stringify({size,morePanel,viewport}));
      if (size[0] === 930) await page.screenshot({ path: path.join(output, 'modern-930x700-more.png') });
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#top-more-panel').isVisible(), false);
    }
    await resize(1480,940); await openAppearance(); await choose('layout','classic'); await choose('theme','paper'); await closeAppearance();
    await checkGeometry('classic-standard-paper');
    await page.screenshot({ path: path.join(output, 'classic-1480x940.png') });
    checks.push('modern toolbar, imports, selection and category navigation remain inside the viewport at four supported sizes in five palettes, including expanded detail');

    await openAppearance(); await choose('layout','modern'); await choose('theme','paper'); await closeAppearance();
    await page.locator('.asset-card [data-action="zoom-preview"]').first().click();
    await page.waitForSelector('#dialog.preview-dialog[open]');
    await page.waitForFunction(() => document.querySelector('.lightbox-preview img')?.naturalWidth === 320);
    await page.screenshot({ path: path.join(output, 'paper-large-preview.png') });
    await page.locator('[data-action="close-dialog"]').first().click();
    await page.locator('[data-action="import"][data-mode="ordinary"]').click();
    await page.locator('[data-category-trigger="import-category"]').click();
    await page.locator('[data-category-search]').fill('外观验收');
    await page.locator(`[data-category-option="${category.id}"]`).click();
    assert.equal(await page.locator('#import-category').inputValue(), category.id);
    await page.screenshot({ path: path.join(output, 'paper-import.png') });
    await page.locator('[data-action="close-dialog"]').first().click();
    await openAppearance(); await page.locator('[data-appearance-skin]').click();
    assert.equal(await page.locator('#skin-dialog').isVisible(), true);
    assert.equal(await page.locator('#appearance-dialog').isVisible(), false);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#skin-dialog').open);
    const focusAfterSkin = await page.evaluate(() => {
      const element = document.activeElement, bounds = element.getBoundingClientRect();
      return { tag: element.tagName, action: element.dataset.action, visible: bounds.width > 0 && bounds.height > 0 && !element.closest('dialog:not([open])') };
    });
    assert.equal(focusAfterSkin.visible, true, 'skin handoff restores visible focus: ' + JSON.stringify(focusAfterSkin));
    await page.locator('[data-top-more]').click();
    assert.equal(await page.locator('#top-more-panel').isVisible(), true);
    await page.locator('[data-action="skin-settings"]').click();
    assert.equal(await page.locator('#skin-dialog').isVisible(), true);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#skin-dialog').open);
    assert.equal(await page.locator('#top-more-panel').isVisible(), true, 'native dialog Escape takes precedence over the open navigation menu');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#top-more-panel').isVisible(), false);
    checks.push('large preview and themed import category picker decode and work; appearance opens the existing skin settings');

    await page.locator('#navigation [data-id="audio"]').click();
    await page.locator('#search').fill('');
    await page.locator('.audio-card [data-action="play-audio"]').first().click();
    await page.waitForFunction(() => document.querySelector('#audio-player').dataset.playing === 'true' && Number(document.querySelector('#audio-player').dataset.time) > 0);
    const audioBefore = await page.locator('#audio-player').getAttribute('data-id');
    await openAppearance(); await choose('layout','classic'); await choose('theme','slate'); await choose('layout','modern');
    assert.equal(await page.locator('#audio-player').getAttribute('data-id'), audioBefore);
    assert.equal(await page.locator('#audio-player').getAttribute('data-playing'), 'true');
    await closeAppearance(); await page.locator('[data-action="audio-stop"]').click();
    checks.push('actual WAV playback keeps its asset and playing state while changing layout and palette');

    await openAppearance(); await choose('layout','classic'); await choose('theme','sage'); await closeAppearance();
    await page.locator('#density').click(); await page.locator('[data-action="density"][data-density="4"]').click();
    await app.close(); app = null; await launch();
    assert.equal(await page.locator('html').getAttribute('data-layout'), 'classic');
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'sage');
    assert.equal(await page.locator('#density-label').textContent(), '每行 4 个');
    await openAppearance();
    assert.equal(await page.locator('[data-appearance-layout="classic"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('[data-appearance-theme="sage"]').getAttribute('aria-pressed'), 'true');
    await closeAppearance();
    for (let iteration = 0; iteration < 12; iteration++) { await openAppearance(); await closeAppearance(); }
    assert.equal(await page.locator('#appearance-dialog').count(), 1, 'repeated opening keeps one dialog');
    checks.push('a real process restart restores independent classic/sage appearance and the existing explicit grid density');
    await app.close(); app = null;
    assert.deepEqual(await fs.readFile(path.join(data, 'library.json')), originalIndex, 'appearance and playback never change the library index');
    assert.deepEqual(await Promise.all([source, picture, sound].map(async file => createHash('sha256').update(await fs.readFile(file)).digest('hex'))), originals);
    assert.deepEqual(errors, []);
    assert.deepEqual(geometry.filter(value => value.issues.length).map(({label,issues}) => ({label,issues})), [], 'all viewport controls remain reachable');
    checks.push('external originals and library index stay byte-identical; no renderer errors');
    const result = { passed: true, checks, geometry, pageErrors: errors };
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ passed: true, checks, geometryCases: geometry.length, pageErrors: errors, output }, null, 2));
  } catch (error) {
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify({ error: error.stack, checks, geometry, pageErrors: errors }, null, 2));
    throw error;
  } finally {
    if (app) await app.close();
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
