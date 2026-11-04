const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createPluginUpdater, runInstaller } = require('../desktop/plugin-update.cjs');
const RUNTIME = ['CSXS/manifest.xml', 'META-INF/signatures.xml', 'mimetype', 'panel.js', 'style.css', 'index.html', 'queue.cjs', 'insert-whole.jsfl', 'icon.png', 'README.md'];
async function fixture(t, run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-plugin-update-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'bundled'), installed = path.join(root, 'installed');
  await fs.mkdir(path.join(source, 'CSXS'), { recursive: true });
  const manifest = '<ExtensionManifest ExtensionBundleId="com.anshelf.receiver" ExtensionBundleVersion="0.3.9"><ExtensionList><Extension Id="com.anshelf.receiver.panel" Version="0.3.9"/></ExtensionList></ExtensionManifest>';
  for (const file of RUNTIME) {
    await fs.mkdir(path.dirname(path.join(source, file)), { recursive: true });
    await fs.writeFile(path.join(source, file), file === 'CSXS/manifest.xml' ? manifest : 'fixture ' + file);
  }
  await fs.writeFile(path.join(source, 'install.ps1'), '# trusted package');
  const updater = createPluginUpdater({ directory: source, installedDirectory: installed, run });
  return { source, installed, updater, manifest };
}
test('plugin status detects absent, changed and matching signed runtime without launching anything', async t => {
  let runs = 0; const f = await fixture(t, async () => { runs++; });
  assert.equal((await f.updater.status()).status, 'not-installed');
  await fs.cp(f.source, f.installed, { recursive: true });
  await fs.writeFile(path.join(f.installed, 'CSXS/manifest.xml'), f.manifest.replaceAll('0.3.9', '0.3.8'));
  assert.equal((await f.updater.status()).status, 'needs-update');
  await fs.writeFile(path.join(f.installed, 'CSXS/manifest.xml'), f.manifest);
  assert.equal((await f.updater.status()).status, 'current');
  assert.equal(runs, 0);
});
test('one click plugin update uses fixed local installer and verifies installed version', async t => {
  let options; const f = await fixture(t, async request => {
    options = request; await fs.cp(f.source, f.installed, { recursive: true });
  });
  assert.deepEqual(await f.updater.install(), { status: 'current', bundledVersion: '0.3.9', installedVersion: '0.3.9', restartRequired: true });
  assert.equal(options.file, path.join(f.source, 'install.ps1'));
  assert.equal(options.directory, f.source);
});
test('failed install and concurrent requests never report success', async t => {
  let release; const f = await fixture(t, () => new Promise((_resolve, reject) => { release = () => reject(new Error('installer failed')); }));
  const pending = f.updater.install();
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(f.updater.install(), /正在/);
  while (!release) await new Promise(resolve => setImmediate(resolve));
  release(); await assert.rejects(pending, /installer failed/);
  assert.equal((await f.updater.status()).status, 'not-installed');
});

test('every bundled signed runtime file is mandatory even when both source and target are missing it', async t => {
  for (const missing of RUNTIME) {
    const f = await fixture(t, async () => {});
    await fs.cp(f.source, f.installed, { recursive: true });
    await fs.unlink(path.join(f.source, missing));
    await fs.unlink(path.join(f.installed, missing));
    await assert.rejects(f.updater.status(), /不完整/);
    await assert.rejects(f.updater.install(), /不完整/);
  }
});

test('target missing or changed signed payloads including README never report current', async t => {
  for (const missing of RUNTIME.filter(file => file !== 'CSXS/manifest.xml')) {
    const f = await fixture(t, async () => {});
    await fs.cp(f.source, f.installed, { recursive: true });
    await fs.unlink(path.join(f.installed, missing));
    assert.equal((await f.updater.status()).status, 'needs-update', missing);
  }
  const f = await fixture(t, async () => {});
  await fs.cp(f.source, f.installed, { recursive: true });
  await fs.writeFile(path.join(f.installed, 'README.md'), 'changed signed README');
  assert.equal((await f.updater.status()).status, 'needs-update');
});

test('install does not claim success when a runner leaves only a manifest or omits one payload', async t => {
  for (const missing of ['panel.js', 'README.md']) {
    const f = await fixture(t, async () => {
      await fs.cp(f.source, f.installed, { recursive: true });
      await fs.unlink(path.join(f.installed, missing));
    });
    await assert.rejects(f.updater.install(), /校验未通过/);
  }
});

test('linked or non-file runtime entries fail without running the installer', async t => {
  let runs = 0;
  const f = await fixture(t, async () => { runs++; });
  await fs.unlink(path.join(f.source, 'panel.js'));
  await fs.mkdir(path.join(f.source, 'panel.js'));
  await assert.rejects(f.updater.status(), /不完整|普通文件/);
  assert.equal(runs, 0);
  await fs.rmdir(path.join(f.source, 'panel.js'));
  await fs.writeFile(path.join(f.source, 'panel.js'), 'fixture panel.js');
  // Directory junctions are available without Windows symlink privileges.
  await fs.rename(path.join(f.source, 'CSXS'), path.join(f.source, 'real-CSXS'));
  await fs.symlink(path.join(f.source, 'real-CSXS'), path.join(f.source, 'CSXS'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.updater.install(), /链接/);
  assert.equal(runs, 0);
});

test('one click runs the real signed-payload installer only inside isolated AppData and preserves its library', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t);
  for (const file of RUNTIME.filter(file => file !== 'META-INF/signatures.xml')) {
    await fs.copyFile(path.join(__dirname, '../plugin', file), path.join(f.source, file));
  }
  await fs.copyFile(path.join(__dirname, '../plugin/install.ps1'), path.join(f.source, 'install.ps1'));
  const references = await Promise.all(RUNTIME.filter(file => file !== 'META-INF/signatures.xml').map(async file => {
    const digest = createHash('sha256').update(await fs.readFile(path.join(f.source, file))).digest('base64');
    return `<Reference URI="${file}"><DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><DigestValue>${digest}</DigestValue></Reference>`;
  }));
  // Deterministic digest fixture exercises install.ps1's package checks. Adobe
  // certificate/CEP acceptance is a separate actual-host verification.
  await fs.writeFile(path.join(f.source, 'META-INF/signatures.xml'), `<signatures><Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><Object><Manifest Id="PackageContents">${references.join('')}</Manifest></Object></Signature></signatures>`);
  const appData = path.join(path.dirname(f.source), 'isolated-appdata');
  const target = path.join(appData, 'Adobe/CEP/extensions/com.anshelf.receiver');
  const library = path.join(appData, 'AnShelf');
  await fs.mkdir(library, { recursive: true });
  await fs.writeFile(path.join(library, 'library.json'), '{"private":"unchanged"}');
  const updater = createPluginUpdater({ directory: f.source, installedDirectory: target, run: request => runInstaller({ ...request, env: { ...process.env, APPDATA: appData } }) });
  assert.equal((await updater.status()).status, 'not-installed');
  const result = await updater.install();
  assert.equal(result.status, 'current'); assert.equal(result.restartRequired, true);
  assert.equal(await fs.readFile(path.join(library, 'library.json'), 'utf8'), '{"private":"unchanged"}');
  for (const file of RUNTIME) assert.deepEqual(await fs.readFile(path.join(target, file)), await fs.readFile(path.join(f.source, file)), file);
  // A corrupted digest fixture must be rejected by the actual installer before replacement.
  await fs.writeFile(path.join(f.source, 'panel.js'), 'tampered payload');
  await assert.rejects(updater.install(), /integrity|digest|校验/i);
  assert.notEqual(await fs.readFile(path.join(target, 'panel.js'), 'utf8'), 'tampered payload');
});
