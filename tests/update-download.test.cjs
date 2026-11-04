/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Readable } = require('node:stream');
const { createUpdateDownloader } = require('../desktop/update-download.cjs');

const bytes = Buffer.from('verified installer fixture');
const digest = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
function release(version = '0.3.9') {
  return {
    tag_name: 'v' + version, draft: false, prerelease: false,
    html_url: `https://github.com/anyv-DH/anshelf/releases/tag/v${version}`,
    assets: ['Setup', 'Portable'].map(mode => {
      const name = `AnAn-AssetManager-${mode}-${version}.exe`;
      return { name, size: bytes.length, digest, browser_download_url: `https://github.com/anyv-DH/anshelf/releases/download/v${version}/${name}` };
    })
  };
}
function response(body = bytes, headers = {}) {
  return { statusCode: 200, headers, body: Readable.from([body.subarray(0, 5), body.subarray(5)]) };
}
async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-update-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const downloader = createUpdateDownloader({ directory: path.join(root, 'updates'), fetchRelease: async () => release(), download: async () => response(), ...options });
  t.after(() => downloader.close());
  return { root, downloader };
}
async function filenames(root) {
  const result = [];
  async function walk(directory) {
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(file); else result.push(file);
    }
  }
  await walk(root); return result;
}

test('manual download picks the exact official installer or portable and publishes only verified final bytes', async t => {
  const requests = [], progress = [];
  const { root, downloader } = await fixture(t, { download: async input => { requests.push(input); return response(bytes, { 'content-length': String(bytes.length) }); } });
  for (const mode of ['installed', 'portable']) {
    const result = await downloader.start({ mode, onProgress: value => progress.push(value), url: 'https://example.com/ignored.exe' });
    assert.equal(result.mode, mode); assert.equal(result.version, '0.3.9');
    assert.equal(result.sha256, digest.slice(7), 'retain the official digest for every later verification');
    assert.ok(result.file.startsWith(path.join(root, 'updates') + path.sep));
    assert.equal(path.basename(result.file), `AnAn-AssetManager-${mode === 'installed' ? 'Setup' : 'Portable'}-0.3.9.exe`);
    assert.deepEqual(await fs.readFile(result.file), bytes);
    assert.ok(!requests.at(-1).url.includes('example.com'));
  }
  assert.equal(requests.length, 2);
  assert.equal((await filenames(root)).filter(file => file.endsWith('.part')).length, 0);
  assert.equal(progress.at(-1).received, bytes.length);
  assert.ok(progress.length <= 4, 'initial and completed progress are enough for this short stream');
});

test('release, exact versioned filename, URL and mandatory SHA256 are validated before any transfer', async t => {
  const variants = [
    info => { info.html_url = 'https://github.com/other/anshelf/releases/tag/v0.3.9'; },
    info => { info.tag_name = '0.3.9'; },
    info => { info.prerelease = true; },
    info => { info.assets[0].name = 'AnAn-AssetManager-Setup-0.3.8.exe'; },
    info => { info.assets[0].browser_download_url = info.assets[0].browser_download_url.replace('/v0.3.9/', '/v0.3.8/'); },
    info => { info.assets[0].browser_download_url = info.assets[0].browser_download_url.replace('github.com/', 'github.com.evil.example/'); },
    info => { info.assets[0].browser_download_url = info.assets[0].browser_download_url.replace('https://', 'https://user:secret@'); },
    info => { info.assets[0].browser_download_url += '?url=evil'; },
    info => { delete info.assets[0].digest; },
    info => { info.assets[0].digest = 'sha256:wrong'; },
    info => { info.assets[0].size = 512 * 1024 * 1024 + 1; },
    info => { info.assets.push({ ...info.assets[0] }); }
  ];
  for (const mutate of variants) {
    let transfers = 0;
    const info = release(); mutate(info);
    const { root, downloader } = await fixture(t, { fetchRelease: async () => info, download: async () => { transfers++; return response(); } });
    await assert.rejects(downloader.start({ mode: 'installed' }), /官方|发布|附件|校验|版本|大小|地址不安全/);
    assert.equal(transfers, 0); assert.deepEqual(await filenames(root), []);
  }
});

test('redirects use only approved HTTPS hosts without credentials and never forward authentication', async t => {
  const requests = [];
  const { downloader } = await fixture(t, { download: async input => {
    requests.push(input);
    return requests.length === 1
      ? { statusCode: 302, headers: { location: 'https://release-assets.githubusercontent.com/github-production-release-asset/file?signature=test' }, body: Readable.from([]) }
      : response();
  } });
  await downloader.start({ mode: 'installed' });
  assert.equal(requests.length, 2);
  assert.equal(new URL(requests[1].url).hostname, 'release-assets.githubusercontent.com');
  assert.deepEqual(Object.keys(requests[1]).sort(), ['signal', 'url']);
  for (const location of ['http://github.com/file', 'https://evil.example/file', 'https://github.com@evil.example/file', 'https://user:secret@objects.githubusercontent.com/file', 'https://objects.githubusercontent.com:444/file']) {
    const { root, downloader: bad } = await fixture(t, { download: async () => ({ statusCode: 302, headers: { location }, body: Readable.from([]) }) });
    await assert.rejects(bad.start({ mode: 'installed' }), /安全|下载地址|重定向/);
    assert.deepEqual(await filenames(root), []);
  }
});

test('redirect loops stop after five hops and clean their private staging file', async t => {
  let requests = 0;
  const { root, downloader } = await fixture(t, { download: async () => { requests++; return { statusCode: 302, headers: { location: 'https://objects.githubusercontent.com/loop' }, body: Readable.from([]) }; } });
  await assert.rejects(downloader.start({ mode: 'portable' }), /重定向/);
  assert.equal(requests, 6); assert.deepEqual(await filenames(root), []);
});

test('bad digest, short or excessive bytes, bad status and wrong response size never leave an executable', async t => {
  const variants = [
    () => response(Buffer.from('X'.repeat(bytes.length))),
    () => response(bytes.subarray(0, -1)),
    () => response(Buffer.concat([bytes, Buffer.from('extra')])),
    () => ({ statusCode: 403, headers: {}, body: Readable.from(['private debug=secret']) }),
    () => response(bytes, { 'content-length': '999999' }),
    () => response(bytes, { 'content-encoding': 'gzip' })
  ];
  for (const makeResponse of variants) {
    const { root, downloader } = await fixture(t, { download: async () => makeResponse() });
    await assert.rejects(downloader.start({ mode: 'installed' }), /校验|大小|下载|响应/);
    assert.deepEqual(await filenames(root), []);
  }
});

test('only one active transfer is allowed, cancellation aborts the stream and removes partial bytes', async t => {
  let started, transferSignal;
  const ready = new Promise(resolve => { started = resolve; });
  const { root, downloader } = await fixture(t, { download: async ({ signal }) => {
    transferSignal = signal;
    return { statusCode: 200, headers: {}, body: (async function* () { yield bytes.subarray(0, 2); started(); await new Promise(() => {}); })() };
  } });
  const pending = downloader.start({ mode: 'installed' });
  await ready;
  await assert.rejects(downloader.start({ mode: 'portable' }), /正在下载/);
  downloader.cancel();
  await assert.rejects(pending, /取消/);
  assert.equal(transferSignal.aborted, true); assert.deepEqual(await filenames(root), []);
});

test('timeouts, external aborts and closing abort metadata requests without leaving timers or files', async t => {
  for (const kind of ['timeout', 'external', 'close']) {
    let requestSignal;
    const { root, downloader } = await fixture(t, { timeoutMs: 25, fetchRelease: async ({ signal }) => { requestSignal = signal; await new Promise(() => {}); } });
    const controller = new AbortController();
    const pending = downloader.start({ mode: 'installed', signal: controller.signal });
    if (kind === 'external') controller.abort();
    if (kind === 'close') downloader.close();
    // Keep this test process alive while the production deadline is correctly unref'd.
    const keepAlive = setTimeout(() => {}, 1000);
    try { await assert.rejects(pending, /超时|取消|关闭/); }
    finally { clearTimeout(keepAlive); }
    assert.equal(requestSignal.aborted, true); assert.deepEqual(await filenames(root), []);
    if (kind === 'close') await assert.rejects(downloader.start({ mode: 'installed' }), /关闭/);
  }
});

test('offline failure never exposes response details and a later manual attempt remains usable', async t => {
  let attempts = 0;
  const { downloader } = await fixture(t, { fetchRelease: async () => { if (++attempts === 1) throw new Error('token=do-not-show'); return release(); } });
  await assert.rejects(downloader.start({ mode: 'installed' }), error => /网络|连接|下载/.test(error.message) && !error.message.includes('token='));
  assert.equal((await downloader.start({ mode: 'installed' })).version, '0.3.9');
});

test('a linked download directory is rejected and no file is written outside the fixed updater root', async t => {
  const { root } = await fixture(t);
  const external = path.join(root, 'external'); await fs.mkdir(external);
  const linked = path.join(root, 'linked');
  await fs.symlink(external, linked, process.platform === 'win32' ? 'junction' : 'dir');
  const downloader = createUpdateDownloader({ directory: linked, fetchRelease: async () => release(), download: async () => response() });
  t.after(() => downloader.close());
  await assert.rejects(downloader.start({ mode: 'installed' }), /链接|路径/);
  assert.deepEqual(await fs.readdir(external), []);
});

test('an interrupted response closes partial output and invalid mode never starts a request', async t => {
  const { root, downloader } = await fixture(t, { download: async () => ({ statusCode: 200, headers: {}, body: (async function* () { yield bytes.subarray(0, 3); throw new Error('socket reset'); })() }) });
  await assert.rejects(downloader.start({ mode: 'installed' }), /下载|连接/);
  assert.deepEqual(await filenames(root), []);
  await assert.rejects(downloader.start({ mode: 'https://example.com/evil.exe' }), /模式/);
});

test('cancellation while the verified file is being committed removes the final executable too', async t => {
  const { root, downloader } = await fixture(t);
  const original = fs.rename;
  fs.rename = async (...args) => { downloader.cancel(); return original(...args); };
  try { await assert.rejects(downloader.start({ mode: 'installed' }), /取消/); }
  finally { fs.rename = original; }
  assert.deepEqual(await filenames(root), []);
});
