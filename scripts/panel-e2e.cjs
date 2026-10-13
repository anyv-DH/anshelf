/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { chromium } = require(process.env.ANSHELF_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');

async function main() {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const errors = [], checks = [];
  try {
    const page = await browser.newPage({ viewport: { width: 48, height: 48 }, deviceScaleFactor: 2 });
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.panelTest = { pending: null, response: null, heartbeatError: false, completed: [], cleaned: [], prepared: [] };
      const queue = {
        heartbeat() { if (window.panelTest.heartbeatError) throw new Error('写入失败'); },
        pending() { return window.panelTest.pending; },
        prepare(request) { window.panelTest.prepared.push(request.requestId); return { ...request, managedRoot: 'file:///managed', temporaryPath: 'managed/temp/asset.fla' }; },
        complete(request, result) { window.panelTest.completed.push({ requestId: request.requestId, result }); if (window.panelTest.pending && window.panelTest.pending.requestId === request.requestId) window.panelTest.pending = null; },
        cleanup(value) { window.panelTest.cleaned.push(value); }
      };
      window.__adobe_cep__ = { getSystemPath: () => '/extension', evalScript(code, callback) {
        if (!code.includes('AnShelfInsertWhole')) { callback('42'); return; }
        window.panelTest.response = callback;
      } };
      window.cep_node = { require(name) {
        if (name === 'path') return { join: (...parts) => parts.join('/') };
        if (name === 'process') return { env: { APPDATA: '/appdata' } };
        return { Queue: function () { return queue; }, localURI: value => 'file:///' + value };
      } };
      window.setInterval = callback => { window.panelTest.tick = callback; return 1; };
    });
    await page.goto(pathToFileURL(path.join(root, 'plugin/index.html')).href);
    const button = page.locator('#insert');
    await button.waitFor();
    assert.equal(await button.textContent(), '等待素材');
    assert.equal(await button.isDisabled(), true);
    assert.equal(await page.locator('button').count(), 1);
    checks.push('waiting state with one button');

    async function layouts(state) {
      for (const [width, height] of [[40, 40], [48, 48], [180, 56], [240, 60]]) {
        await page.setViewportSize({ width, height });
        const layout = await page.evaluate(() => {
          const button = document.getElementById('insert'), rect = button.getBoundingClientRect();
          const style = getComputedStyle(button), icon = getComputedStyle(button, '::before');
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, textFits: button.scrollWidth <= button.clientWidth && button.scrollHeight <= button.clientHeight, fontSize: parseFloat(style.fontSize), icon: icon.backgroundImage, iconWidth: parseFloat(icon.width), label: button.getAttribute('aria-label'), title: button.title, state: button.getAttribute('data-state') };
        });
        assert.equal(layout.state, state);
        assert.deepEqual([layout.x, layout.y, layout.width, layout.height], [4, 4, width - 8, height - 8]);
        assert.equal(layout.scrollWidth, width);
        assert.equal(layout.scrollHeight, height);
        assert.equal(layout.textFits, true, `${state} at ${width}x${height}`);
        assert.equal(layout.fontSize === 0, width < 120);
        assert.match(layout.icon, /icon\.png/);
        assert.ok(layout.iconWidth > 0 && layout.iconWidth <= layout.width);
        assert.ok(layout.label.length > 0 && layout.title.length > 0);
      }
      checks.push(`${state} at 40/48/180/240 pixels retains tooltip/accessibility and has no clipping or scrolling`);
    }
    await layouts('waiting');

    async function send(id) {
      await page.evaluate(value => {
        window.panelTest.pending = { version: 1, requestId: value, asset: { id: value, name: '非常长的武器素材名称'.repeat(20) } };
        window.panelTest.tick();
      }, id);
    }
    await send('first');
    assert.equal(await button.isEnabled(), true);
    assert.equal(await button.textContent(), '粘贴到舞台');
    assert.match(await button.getAttribute('title'), /非常长的武器素材名称/);
    await layouts('ready');
    const icon = await page.evaluate(() => new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight }); image.onerror = () => reject(new Error('Panel icon failed to decode')); image.src = 'icon.png'; }));
    assert.deepEqual(icon, { width: 64, height: 64 });
    checks.push('original local PNG icon decodes without remote assets');
    const out = path.join(root, 'test-output');
    await fs.mkdir(out, { recursive: true });
    await page.setViewportSize({ width: 48, height: 48 });
    await page.screenshot({ path: path.join(out, 'panel-icon-small.png'), scale: 'css' });
    await page.setViewportSize({ width: 240, height: 60 });
    await page.screenshot({ path: path.join(out, 'panel-icon-wide.png'), scale: 'css' });
    await page.screenshot({ path: path.join(out, 'panel-compact.png'), scale: 'css' });
    await button.click();
    assert.equal(await button.textContent(), '正在粘贴…');
    assert.equal(await button.isDisabled(), true);
    await layouts('busy');
    await page.evaluate(() => window.panelTest.response(JSON.stringify({ version: 1, ok: true, warning: '提示保留在悬停内容中' })));
    assert.equal(await button.textContent(), '已粘贴 ✓');
    assert.match(await button.getAttribute('title'), /提示保留/);
    await layouts('success');
    await page.evaluate(() => window.panelTest.tick());
    assert.equal(await button.textContent(), '已粘贴 ✓');
    checks.push('click, busy, completed state and warning tooltip');
    await send('second');
    await button.click();
    await page.evaluate(() => window.panelTest.response(JSON.stringify({ version: 1, ok: false, error: '当前图层锁定' })));
    assert.equal(await button.textContent(), '粘贴失败');
    assert.match(await button.getAttribute('aria-label'), /当前图层锁定/);
    await layouts('error');
    await send('third');
    await page.evaluate(() => { window.panelTest.heartbeatError = true; window.panelTest.tick(); });
    assert.equal(await button.textContent(), '连接失败');
    assert.equal(await button.isDisabled(), true);
    await page.evaluate(() => { window.panelTest.heartbeatError = false; window.panelTest.tick(); });
    assert.equal(await button.textContent(), '粘贴到舞台');
    assert.equal(await button.isEnabled(), true);
    const state = await page.evaluate(() => ({ completed: window.panelTest.completed.length, cleaned: window.panelTest.cleaned.length, prepared: window.panelTest.prepared.length }));
    assert.deepEqual(state, { completed: 2, cleaned: 2, prepared: 2 });
    checks.push('failure, new request and connection recovery');
    await page.evaluate(() => {
      const createdAt = Date.now();
      window.panelTest.pending = { version: 1, requestId: 'stage-drag', createdAt, delivery: 'stage-drop', expiresAt: createdAt + 5000, targetDocumentId: 42, asset: { id: 'stage-drag', name: '自动拖到舞台的武器' } };
      window.panelTest.tick();
    });
    assert.equal(await button.textContent(), '正在粘贴…');
    assert.equal(await button.isDisabled(), true);
    await page.evaluate(() => {
      window.panelTest.tick();
      window.panelTest.response(JSON.stringify({ version: 1, ok: true }));
      window.panelTest.tick();
    });
    assert.equal(await button.textContent(), '已粘贴 ✓');
    const stageState = await page.evaluate(() => ({ prepared: window.panelTest.prepared.filter(id => id === 'stage-drag').length, completed: window.panelTest.completed.filter(item => item.requestId === 'stage-drag').length }));
    assert.deepEqual(stageState, { prepared: 1, completed: 1 });
    checks.push('stage-drop automatically inserts once while the existing manual button flow remains intact');
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(out, 'panel-e2e-result.json'), JSON.stringify({ checks, pageErrors: errors }, null, 2));
    console.log(JSON.stringify({ checks, pageErrors: errors }, null, 2));
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
