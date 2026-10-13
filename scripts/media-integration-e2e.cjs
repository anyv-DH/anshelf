/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { _electron } = require(process.env.ANSHELF_PLAYWRIGHT || 'playwright');
const { GIFEncoder } = require('gifenc');
const root = path.resolve(__dirname, '..');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function wavBytes(frequency = 330, seconds = 20) {
  const result = Buffer.alloc(44 + 44100 * 2 * seconds);
  result.write('RIFF'); result.writeUInt32LE(result.length - 8, 4); result.write('WAVEfmt ', 8); result.writeUInt32LE(16, 16); result.writeUInt16LE(1, 20); result.writeUInt16LE(1, 22); result.writeUInt32LE(44100, 24); result.writeUInt32LE(88200, 28); result.writeUInt16LE(2, 32); result.writeUInt16LE(16, 34); result.write('data', 36); result.writeUInt32LE(result.length - 44, 40);
  for (let n = 0; n < seconds * 44100; n++) result.writeInt16LE(Math.round(Math.sin(n * frequency * 2 * Math.PI / 44100) * 700), 44 + n * 2);
  return result;
}
function gifBytes() {
  const encoder = GIFEncoder(), size = 160, palette = [[35, 30, 48], [193, 170, 249], [235, 143, 166], [240, 210, 145]];
  for (let frame = 0; frame < 6; frame++) {
    const pixels = new Uint8Array(size * size), center = 35 + frame * 17;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if ((x - center) ** 2 + (y - 80) ** 2 < 28 ** 2) pixels[y * size + x] = 1 + frame % 3;
    encoder.writeFrame(pixels, size, size, { palette, delay: 130, repeat: 0 });
  }
  encoder.finish(); return Buffer.from(encoder.bytes());
}
async function waitSnapshot(page, predicate) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const value = await page.evaluate(() => window.shelf.snapshot());
    if (predicate(value)) return value;
    await page.waitForTimeout(100);
  }
  throw new Error('媒体库未达到预期状态：' + await page.locator('#toast').textContent());
}
async function importFromDialog(app, page, mode, files) {
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async (_window, options) => { global.__mediaPicker = options; return { canceled: false, filePaths: paths }; };
  }, files);
  await page.locator(`[data-action="import"][data-mode="${mode}"]`).click();
  assert.equal(await page.locator('#dialog-content').getAttribute('data-import-mode'), mode);
  await page.locator('[data-action="import-files"]').click();
  await page.waitForFunction(() => !document.body.classList.contains('is-busy'));
  const picker = await app.evaluate(() => global.__mediaPicker);
  assert.deepEqual(picker.filters[0].extensions, mode === 'audio' ? ['mp3', 'wav', 'ogg', 'flac'] : ['fla']);
}
async function decodeUrl(page, url) {
  return page.evaluate(url => new Promise(resolve => { const image = new Image(); image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight }); image.onerror = () => resolve(null); image.src = url; }), url);
}

async function main() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-media-integration-'));
  const originals = path.join(temporary, 'originals'), data = path.join(temporary, 'library'), profile = path.join(temporary, 'profile');
  const out = path.join(root, 'test-output'), checks = [], errors = [];
  const packaged = Boolean(process.env.ANSHELF_EXECUTABLE);
  const executablePath = process.env.ANSHELF_EXECUTABLE || require(path.join(root, 'node_modules/electron'));
  const launch = () => _electron.launch({ executablePath, args: [...(packaged ? [] : [root]), `--user-data-dir=${profile}`], env: { ...process.env, ANSHELF_DATA_DIR: data, ANSHELF_ANIMATE_EXE: '' }, timeout: 60000 });
  let app;
  try {
    await fs.mkdir(originals); await fs.mkdir(out, { recursive: true });
    const demos = (await fs.readdir(path.join(root, 'demo'))).filter(name => name.endsWith('.fla'));
    const ordinary = path.join(originals, '普通武器.fla'), effect = path.join(originals, '特效火焰.fla'), sidecar = path.join(originals, '特效火焰.gif'), sound = path.join(originals, '试听音效.wav'), sound2 = path.join(originals, '第二音效.wav');
    await fs.copyFile(path.join(root, 'demo', demos[0]), ordinary);
    await fs.copyFile(path.join(root, 'demo', demos[1]), effect);
    await fs.writeFile(sidecar, gifBytes());
    await fs.writeFile(sound, wavBytes()); await fs.writeFile(sound2, wavBytes(440));
    const before = new Map(await Promise.all([ordinary, effect, sidecar, sound, sound2].map(async file => [file, hash(await fs.readFile(file))])));
    app = await launch(); let page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('.import-main');
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.isVisible()).setContentSize(1280, 800));
    await importFromDialog(app, page, 'ordinary', [ordinary]);
    await waitSnapshot(page, state => state.assets.length === 1 && state.assets[0].previewStatus === 'ready');
    await importFromDialog(app, page, 'effect', [effect]);
    let snapshot = await waitSnapshot(page, state => state.assets.length === 2 && state.assets.every(asset => asset.previewStatus === 'ready'));
    const effectAsset = snapshot.assets.find(asset => asset.assetType === 'effect');
    assert.equal(effectAsset.previewOrigin, 'sidecar'); assert.equal(effectAsset.previewFormat, 'gif'); assert.equal(effectAsset.previewAnimated, true);
    assert.ok(effectAsset.previewPosterUrl?.startsWith('anshelf://poster/'));
    assert.deepEqual(await fs.readFile(path.join(data, effectAsset.previewPath)), await fs.readFile(sidecar));
    const decoded = await decodeUrl(page, effectAsset.previewPosterUrl); assert.ok(decoded?.width > 0 && decoded.height > 0);
    assert.ok((await decodeUrl(page, effectAsset.previewUrl))?.width > 0);
    await page.locator(`[data-asset="${effectAsset.id}"] .card-preview`).hover();
    const animatedCard = page.locator(`[data-asset="${effectAsset.id}"] .animated-image`);
    await animatedCard.waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('.animated-image:not([hidden])')?.naturalWidth === 160);
    assert.equal(await animatedCard.getAttribute('src'), effectAsset.previewUrl);
    await page.locator('#page-title').hover(); assert.equal(await animatedCard.isVisible(), false);
    checks.push('ordinary offline PNG and sidecar GIF import with real decoded poster/preview protocols');
    await importFromDialog(app, page, 'audio', [sound, sound2]);
    snapshot = await waitSnapshot(page, state => state.assets.length === 4);
    const audioAssets = snapshot.assets.filter(asset => asset.kind === 'audio'), firstSound = audioAssets.find(asset => asset.name === '试听音效');
    assert.equal(audioAssets.length, 2); assert.ok(audioAssets.every(asset => asset.previewStatus === 'none' && !asset.previewUrl && asset.mediaUrl.startsWith('anshelf://media/')));
    assert.equal(snapshot.assets.filter(asset => asset.assetType === 'ordinary').length, 1); assert.equal(snapshot.assets.filter(asset => asset.assetType === 'effect').length, 1);
    await importFromDialog(app, page, 'audio', [sound]);
    assert.equal((await page.evaluate(() => window.shelf.snapshot())).assets.length, 4);
    checks.push('audio picker filters, immutable WAV imports, deduplication and mode-separated asset counts');
    await page.locator('#navigation [data-id="audio"]').click();
    assert.equal(await page.locator('.audio-card').count(), 2); assert.equal(await page.locator('.asset-card [data-action="send"]').count(), 0);
    await page.locator(`[data-asset="${firstSound.id}"] .audio-play`).click();
    await page.waitForFunction(() => document.querySelector('#audio-player').dataset.playing === 'true' && Number(document.querySelector('#audio-seek').max) > 19);
    await page.waitForTimeout(350);
    const startedAt = Number(await page.locator('#audio-player').getAttribute('data-time'));
    await page.locator(`[data-asset="${firstSound.id}"] [data-action="favorite"]`).click();
    await page.waitForTimeout(1350);
    assert.equal(await page.locator('#audio-player').getAttribute('data-playing'), 'true'); assert.ok(Number(await page.locator('#audio-player').getAttribute('data-time')) > startedAt);
    await page.locator('#audio-seek').evaluate(input => { input.value = '7'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.waitForFunction(() => Number(document.querySelector('#audio-player').dataset.time) >= 7);
    assert.equal(await page.locator('#audio-error').isVisible(), false);
    await page.screenshot({ path: path.join(out, 'media-audio-library.png'), scale: 'css', animations: 'disabled' });
    checks.push('real anshelf audio streaming playback/seek and library refresh without interruption');
    await page.locator('#audio-player [data-action="audio-stop"]').click();
    await page.locator('[data-action="create-category"]').first().click(); await page.locator('#category-name').fill('音频验收'); await page.locator('[data-action="save-category"]').click();
    snapshot = await waitSnapshot(page, state => state.categories.some(category => category.name === '音频验收'));
    const category = snapshot.categories.find(item => item.name === '音频验收');
    await page.locator(`[data-asset="${firstSound.id}"] h3`).click();
    await page.locator('[data-action="toggle-quick-categories"]').click(); await page.locator('#quick-category-filter').fill('音频验收'); await page.locator(`.quick-category-options [data-id="${category.id}"]`).click();
    await waitSnapshot(page, state => state.assets.find(asset => asset.id === firstSound.id).categoryId === category.id);
    await page.locator(`#categories [data-action="pin-category"][data-id="${category.id}"]`).click();
    await waitSnapshot(page, state => state.categories.find(item => item.id === category.id).pinned);
    await page.locator(`#categories [data-action="category"][data-id="${category.id}"]`).click();
    assert.equal(await page.locator('.asset-card').count(), 1); assert.equal(await page.locator('.audio-card').count(), 1); assert.match(await page.locator('#page-title').textContent(), /音频/);
    await page.locator('#navigation [data-id="favorites"]').click(); assert.equal(await page.locator('.audio-card').count(), 1);
    const persisted = JSON.parse(await fs.readFile(path.join(data, 'library.json'), 'utf8')); assert.equal(persisted.categories.find(item => item.id === category.id).pinned, true);
    await page.locator('[data-action="theme"][data-theme="warm"]').click();
    await page.screenshot({ path: path.join(out, 'media-warm-category.png'), scale: 'css', animations: 'disabled' });
    checks.push('real audio classification/favorites retain type filter and category pin persists to library JSON');
    await page.locator('#navigation [data-id="effects"]').click(); await page.locator(`[data-asset="${effectAsset.id}"] .preview-trigger`).click();
    await page.waitForFunction(() => document.querySelector('.lightbox-preview img').naturalWidth > 0);
    assert.equal(await page.locator('.lightbox-preview img').getAttribute('src'), effectAsset.previewUrl);
    const viewport = page.locator('[data-preview-viewport]'), box = await viewport.boundingBox(); await page.mouse.move(box.x + box.width * .6, box.y + box.height * .5); await page.mouse.wheel(0, -700);
    await page.waitForFunction(() => Number(document.querySelector('[data-preview-viewport]').dataset.scale) > 2);
    // Screenshot capture can move the pointer; use the persistent lightbox for frame-change evidence.
    const animationClip = await viewport.boundingBox(), firstFrame = await page.screenshot({ clip: animationClip });
    await page.waitForTimeout(190);
    assert.notEqual(hash(await page.screenshot({ clip: animationClip })), hash(firstFrame), '动态图未切换显示帧');
    await page.screenshot({ path: path.join(out, 'media-gif-zoom.png'), scale: 'css', animations: 'disabled' });
    await page.locator('[data-action="close-dialog"]').click();
    checks.push('real sidecar GIF lightbox decodes and supports zoom');
    await app.close(); app = await launch(); page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message)); await page.waitForSelector('.asset-card');
    snapshot = await page.evaluate(() => window.shelf.snapshot()); assert.equal(snapshot.assets.length, 4); assert.equal(snapshot.categories.find(item => item.id === category.id).pinned, true);
    assert.equal(await page.locator('#categories .category-row').first().getAttribute('data-category'), category.id); assert.equal(await page.locator('html').getAttribute('data-theme'), 'warm');
    await page.locator(`#categories [data-action="pin-category"][data-id="${category.id}"]`).click();
    await waitSnapshot(page, state => !state.categories.find(item => item.id === category.id).pinned);
    checks.push('real app restart retains category pin ordering, audio metadata and warm theme; unpin persists');
    for (const [file, digest] of before) assert.equal(hash(await fs.readFile(file)), digest, '原件字节被修改：' + file);
    checks.push('all FLA/GIF/WAV original byte hashes remain unchanged');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: checks.length, packaged, checks, pageErrors: errors, screenshots: ['media-audio-library.png', 'media-warm-category.png', 'media-gif-zoom.png'] }, null, 2));
  } finally { if (app) await app.close(); await fs.rm(temporary, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
