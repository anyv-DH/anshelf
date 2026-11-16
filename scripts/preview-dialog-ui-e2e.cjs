/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { _electron } = require(process.env.ANSHELF_PLAYWRIGHT || 'playwright');
const { Library } = require('../core/library.cjs');
const root = path.resolve(__dirname, '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function main() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-preview-dialog-ui-'));
  const data = path.join(temporary, 'library'), profile = path.join(temporary, 'profile');
  const output = process.env.ANSHELF_PREVIEW_DIALOG_OUTPUT || path.join(root, 'test-output/preview-dialog-ui');
  await fs.mkdir(output, { recursive: true });
  const sources = [], checks = [], geometries = [], errors = [];
  const image = path.join(temporary, 'TT Image 2.6_1794606259871_0.png');
  await fs.copyFile(path.join(root, 'desktop/icon.png'), image); sources.push(image);
  const library = await Library.open(data);
  const first = (await library.importPaths([image], { mode: 'image' })).assets[0];
  const second = await library.duplicateAsset(first.id);
  const plain = await library.duplicateAsset(first.id);
  await library.updateAsset(plain.id, { name: '独立图片' });
  const group = await library.createSceneGroup('客厅多张图片', [first.id, second.id]);
  const fla = path.join(temporary, '普通FLA.fla');
  const demo = (await fs.readdir(path.join(root, 'demo'))).find(name => name.endsWith('.fla'));
  await fs.copyFile(path.join(root, 'demo', demo), fla); sources.push(fla);
  await fs.copyFile(image, fla.replace(/\.fla$/, '.png')); sources.push(fla.replace(/\.fla$/, '.png'));
  const ordinary = (await library.importPaths([fla], { preferExistingPreview: true })).assets[0];
  const sound = path.join(temporary, '短试听.wav'), rate = 8000, wav = Buffer.alloc(44 + rate * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(rate * 2, 40);
  await fs.writeFile(sound, wav); sources.push(sound);
  const audio = (await library.importPaths([sound], { mode: 'audio' })).assets[0];
  const originals = await Promise.all(sources.map(async file => ({ file, hash: hash(await fs.readFile(file)) })));
  const executable = process.env.ANSHELF_UI_EXECUTABLE || require(path.join(root, 'node_modules/electron'));
  let app, page;
  const tick = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const passed = value => { checks.push(value); console.log('[pass] ' + value); };
  async function resize(width, height) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size), [width, height]);
    await page.waitForFunction(([width, height]) => Math.abs(innerWidth - width) < 3 && Math.abs(innerHeight - height) < 3, [width, height]);
    await tick();
  }
  async function inspect(label, isAudio = false, withBack = false) {
    await tick();
    const geometry = await page.evaluate(({ label, isAudio }) => {
      const dialog = document.querySelector('#dialog'), viewport = dialog.querySelector('[data-preview-viewport]'), image = viewport?.querySelector('img');
      const rect = element => element?.getBoundingClientRect().toJSON() || null;
      return { label, width: innerWidth, height: innerHeight, open: dialog.open, classes: dialog.className, dialog: rect(dialog), heading: rect(dialog.querySelector('.dialog-heading')), title: rect(dialog.querySelector('#dialog-title')), actions: rect(dialog.querySelector('.preview-heading-actions')), back: rect(dialog.querySelector('[data-action="open-scene-group"]')), close: rect(dialog.querySelector('[data-action="close-dialog"]')), viewport: rect(viewport), image: rect(image), imageLoaded: image ? image.complete && image.naturalWidth > 0 : null, panel: rect(dialog.querySelector('.preview-details')), expanded: !dialog.querySelector('.preview-details').hidden, overflow: dialog.scrollWidth > dialog.clientWidth + 2, isAudio };
    }, { label, isAudio });
    geometries.push(geometry);
    await page.screenshot({ path: path.join(output, label + '.png') });
    assert.equal(geometry.open, true, label + ': preview remains open');
    assert.match(geometry.classes, /(?:^|\s)preview-dialog(?:\s|$)/, label + ': late close event must not remove the new preview layout');
    assert.equal(geometry.overflow, false, label + ': no horizontal overflow');
    assert.ok(geometry.dialog.left >= -1 && geometry.dialog.right <= geometry.width + 1 && geometry.dialog.top >= -1 && geometry.dialog.bottom <= geometry.height + 1, label + ': dialog fits window');
    assert.ok(geometry.dialog.width >= Math.min(900, geometry.width - 60), label + ': preview uses the available horizontal space');
    if (!isAudio) {
      assert.equal(geometry.imageLoaded, true, label + ': actual image loaded');
      assert.ok(geometry.image.width > 40 && geometry.image.height > 40 && geometry.viewport.width > 200, label + ': fitted image has visible pixels');
      await page.locator('#dialog [data-zoom="in"]').click();
      assert.ok(Number(await page.locator('#dialog [data-preview-viewport]').getAttribute('data-scale')) > 1, label + ': new preview controller remains live');
      await page.locator('#dialog [data-zoom="reset"]').click();
    } else assert.equal(await page.locator('#dialog .audio-lightbox').isVisible(), true);
    if (withBack) {
      assert.ok(geometry.back.width > 60 && geometry.back.height < 48, label + ': return label stays on one line');
      assert.ok(geometry.back.right <= geometry.close.left + 1, label + ': close action remains at far right');
      assert.ok(geometry.title.right <= geometry.actions.left + 1 && geometry.actions.right <= geometry.dialog.right, label + ': title and action buttons have separate visible space');
    }
    return geometry;
  }
  const close = async () => { await page.locator('#dialog [data-action="close-dialog"]').click(); await tick(); };
  async function openGroupMember() {
    await page.locator('#search').fill(group.name);
    await page.locator(`.scene-group-card [data-action="open-scene-group"][data-id="${group.id}"]`).first().click();
    await page.locator(`.scene-member [data-action="zoom-preview"][data-id="${first.id}"]`).click();
  }
  try {
    app = await _electron.launch({ executablePath: executable, args: [...(process.env.ANSHELF_UI_EXECUTABLE ? [] : [root]), '--user-data-dir=' + profile], env: { ...process.env, ANSHELF_DATA_DIR: data }, timeout: 60000 });
    const context = await app.evaluate(({ app, ipcMain }) => {
      ipcMain.removeHandler('shelf:update-check'); ipcMain.handle('shelf:update-check', () => ({ status: 'current', currentVersion: app.getVersion(), latestVersion: app.getVersion() }));
      return { version: app.getVersion(), executable: process.execPath, packaged: app.isPackaged, library: process.env.ANSHELF_DATA_DIR, profile: app.getPath('userData') };
    });
    assert.equal(context.version, require('../package.json').version); assert.equal(context.packaged, Boolean(process.env.ANSHELF_UI_EXECUTABLE));
    for (const [actual, expected] of [[context.executable, executable], [context.library, data], [context.profile, profile]]) assert.equal(path.resolve(actual).toLowerCase(), path.resolve(expected).toLowerCase());
    page = await app.firstWindow(); page.setDefaultTimeout(9000); page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('.scene-group-card'); await page.locator('#onboarding-dialog[open]').waitFor(); await page.locator('[data-onboarding-action="skip"]').click();
    await page.evaluate(() => { localStorage.setItem('anshelf-theme', 'bluewhite'); localStorage.setItem('anshelf-preview-background', 'white'); }); await page.reload(); await page.waitForSelector('.scene-group-card');
    await resize(1480, 940); await openGroupMember(); await inspect('group-member-wide', false, true);
    await page.locator('#dialog [data-preview-details-toggle]').click(); assert.equal(await page.locator('#dialog .preview-details').isVisible(), true); await inspect('group-member-details-wide', false, true);
    await page.locator('#dialog [data-preview-title]').click(); await page.locator('[data-preview-title-input]').fill('组合中的新名称'); await page.locator('[data-preview-title-input]').press('Enter'); await page.waitForFunction(() => document.querySelector('[data-preview-title-text]')?.textContent === '组合中的新名称');
    await page.locator('#dialog [data-action="open-scene-group"]').click(); await tick();
    assert.equal(await page.locator('.scene-member').count(), 2); assert.equal(await page.locator('#dialog').getAttribute('class'), 'scene-group-dialog');
    await page.locator('.scene-member [data-action="zoom-preview"]').first().click(); await inspect('group-member-reopened', false, true);
    passed('combination → member preview → details/name editing → return → preview keeps the live image, layout and controls');
    await close(); await page.locator('#search').fill('');
    await page.locator(`.asset-card[data-asset="${plain.id}"] [data-action="zoom-preview"]`).first().click(); await inspect('plain-image-wide'); await close();
    await page.locator(`.asset-card[data-asset="${ordinary.id}"] [data-action="zoom-preview"]`).first().click(); await inspect('fla-preview-wide'); await close();
    await page.locator(`.asset-card[data-asset="${audio.id}"] [data-action="zoom-preview"]`).first().click(); await inspect('audio-preview-wide', true); await close();
    passed('ordinary image, FLA and audio previews retain their appropriate wide layout');
    await resize(850, 600); await openGroupMember(); await inspect('group-member-details-small', false, true);
    await page.locator('#dialog [data-preview-details-toggle]').click(); assert.equal(await page.locator('#dialog .preview-details').isVisible(), false); await inspect('group-member-small', false, true);
    await page.keyboard.press('Escape'); await tick(); assert.equal(await page.locator('#dialog').getAttribute('class'), '');
    passed('minimum 850×600 window supports expanded and collapsed details; Escape releases preview classes');
    for (let index = 0; index < 4; index++) { await openGroupMember(); await inspect('repeated-member-' + index, false, true); await page.locator('#dialog [data-action="open-scene-group"]').click(); await tick(); await close(); }
    passed('four repeated group/preview transitions preserve layout, viewer listeners and return action');
    await page.locator('#workspace-tools > summary').click();
    await page.locator('[data-action="appearance-settings"]').click();
    await page.locator('[data-appearance-layout="classic"]').click();
    await page.locator('[data-appearance-close="done"]').click();
    assert.equal(await page.locator('html').getAttribute('data-layout'), 'classic');
    const longName = '客厅场景正面视角窗户与沙发位置参考'.repeat(9) + '最终整理名称';
    for (const [label, width, height] of [['wide', 1480, 940], ['small', 850, 600]]) {
      await resize(width, height); await openGroupMember();
      if (label === 'wide') {
        await page.locator('#dialog [data-preview-title]').click();
        await page.locator('[data-preview-title-input]').fill(longName);
        await page.locator('[data-preview-title-input]').press('Enter');
        await page.waitForFunction(name => document.querySelector('[data-preview-title-text]')?.textContent === name, longName);
      }
      await inspect('classic-long-name-' + label, false, true);
      await page.locator('#dialog [data-preview-details-toggle]').click();
      assert.equal(await page.locator('#dialog .preview-details').isVisible(), true);
      await inspect('classic-long-name-details-' + label, false, true);
      await page.locator('#dialog [data-preview-details-toggle]').click();
      assert.equal(await page.locator('#dialog .preview-details').isVisible(), false);
      await inspect('classic-long-name-collapsed-' + label, false, true);
      await page.locator('#dialog [data-action="open-scene-group"]').click(); await tick();
      assert.equal(await page.locator('.scene-member').count(), 2);
      assert.equal(await page.locator('#dialog').getAttribute('class'), 'scene-group-dialog');
      assert.equal(await page.locator('.scene-member strong').first().textContent(), longName + '.png');
      await close();
      passed('classic ' + width + '×' + height + ' combination member with a long title keeps return/details/close visible and supports expand, collapse and return');
    }
    for (const original of originals) assert.equal(hash(await fs.readFile(original.file)), original.hash);
    assert.deepEqual(errors, []);
    const result = { passed: true, context, contexts: [context], checks, geometries, pageErrors: errors, originalsUnchanged: true, animateVerified: false };
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify({ ...result, geometries: geometries.length }, null, 2));
  } catch (error) { await fs.writeFile(path.join(output, 'failure.json'), JSON.stringify({ geometries, pageErrors: errors, message: error.message }, null, 2)); if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {}); throw error; }
  finally { if (app) await app.close(); await fs.rm(temporary, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
