const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const digest = value => createHash('sha256').update(value).digest('hex');
const { createUpdateService } = require('../desktop/update-service.cjs');

test('manual app update verifies newer downloaded bytes before a fixed launch and quit', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-update-service-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'update.exe'); await fs.writeFile(file, 'verified-bytes');
  const calls = [];
  const service = createUpdateService({ version: '0.3.9', mode: 'portable', downloader: { start: async ({ mode }) => ({ file, version: '0.3.10', mode, sha256: digest('verified-bytes') }), close() {}, cancel() {} }, launch: async result => calls.push(result), quit: () => calls.push('quit') });
  await assert.rejects(service.launch(), /先下载/);
  assert.deepEqual(await service.download(), { version: '0.3.10', mode: 'portable', ready: true });
  await service.launch();
  assert.equal(calls[0].file, file); assert.equal(calls[1], 'quit');
  await assert.rejects(service.launch(), /先下载/); service.close();
});
test('same or older versions and changed download files can never execute', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-update-refuse-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'update.exe'); await fs.writeFile(file, 'verified');
  let nextVersion = '0.3.8', runs = 0;
  const service = createUpdateService({ version: '0.3.9', mode: 'installed', downloader: { start: async () => ({ file, version: nextVersion, mode: 'installed', sha256: digest('verified') }), close() {}, cancel() {} }, launch: async () => { runs++; }, quit() {} });
  await assert.rejects(service.download(), /最新|更高/);
  nextVersion = '0.3.10'; await service.download(); await fs.writeFile(file, 'modified');
  await assert.rejects(service.launch(), /校验/); assert.equal(runs, 0); service.close();
});
test('a file replaced between downloader verification and service handoff is rejected against the official digest', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-update-handoff-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'update.exe'); await fs.writeFile(file, 'replaced');
  const service = createUpdateService({ version: '0.3.9', mode: 'portable', downloader: { start: async () => ({ file, version: '0.3.10', mode: 'portable', sha256: digest('original') }), close() {}, cancel() {} }, launch() { throw new Error('must not launch'); }, quit() {} });
  await assert.rejects(service.download(), /校验/);
  await assert.rejects(service.launch(), /先下载/); service.close();
});
test('cancelling while download completes cannot leave a runnable update', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-update-cancel-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'update.exe'); await fs.writeFile(file, 'verified');
  let finish;
  const service = createUpdateService({ version: '0.3.9', mode: 'portable', downloader: { start: () => new Promise(resolve => { finish = resolve; }), close() {}, cancel() {} }, launch() { throw new Error('must not launch'); }, quit() {} });
  const pending = service.download(); service.cancel(); finish({ file, version: '0.3.10', mode: 'portable' });
  await assert.rejects(pending, /取消/);
  await assert.rejects(service.launch(), /先下载/); service.close();
});
test('cancel and close during final launch verification prevent both execution and quit', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-update-launch-cancel-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'update.exe'); await fs.writeFile(file, 'verified');
  for (const operation of ['cancel', 'close']) {
    let launches = 0, quits = 0;
    const service = createUpdateService({ version: '0.3.9', mode: 'portable', downloader: { start: async () => ({ file, version: '0.3.10', mode: 'portable', sha256: digest('verified') }), close() {}, cancel() {} }, launch: async () => { launches++; }, quit() { quits++; } });
    await service.download();
    const lstat = fs.lstat;
    const mock = t.mock.method(fs, 'lstat', async (...args) => { service[operation](); return lstat(...args); });
    await assert.rejects(service.launch(), /取消/); mock.mock.restore();
    assert.equal(launches, 0); assert.equal(quits, 0); service.close();
  }
});
