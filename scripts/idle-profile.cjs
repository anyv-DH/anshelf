/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
// Isolated, read-only performance diagnostic. Never opens the user's library.
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { execFileSync, spawn } = require('node:child_process');
const { _electron } = require(process.env.ANSHELF_PLAYWRIGHT || 'playwright');
const root = path.resolve(__dirname, '..');
const seconds = Math.max(60, Number(process.env.ANSHELF_IDLE_SECONDS) || 60);
const warmupSeconds = Math.max(0, Number(process.env.ANSHELF_IDLE_WARMUP) || 10);
const counts = (process.env.ANSHELF_IDLE_COUNTS || '0,200').split(',').map(Number);
const packaged = Boolean(process.env.ANSHELF_EXECUTABLE);
const executablePath = process.env.ANSHELF_EXECUTABLE || require(path.join(root, 'node_modules/electron'));
const logicalCpus = os.cpus().length;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ crc >>> 1 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, bytes) {
  const name = Buffer.from(type), out = Buffer.alloc(bytes.length + 12);
  out.writeUInt32BE(bytes.length); name.copy(out, 4); bytes.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([name, bytes])), out.length - 4); return out;
}
function previewPng() {
  const size = 512, header = Buffer.alloc(13), pixels = Buffer.alloc((size * 4 + 1) * size);
  header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const p = y * (size * 4 + 1) + 1 + x * 4;
    pixels[p] = 130 + x % 90; pixels[p + 1] = 90 + y % 110; pixels[p + 2] = 190; pixels[p + 3] = 255;
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
async function seed(data, count) {
  await fs.mkdir(path.join(data, 'previews'), { recursive: true });
  await fs.mkdir(path.join(data, 'assets'), { recursive: true });
  const categories = Array.from({ length: 5 }, (_, i) => ({ id: 'category-' + i, name: '隔离分类 ' + (i + 1), parentId: null, pinned: i === 0 }));
  const assets = [], png = previewPng();
  const demo = (await fs.readdir(path.join(root, 'demo'))).find(name => name.endsWith('.fla'));
  await fs.copyFile(path.join(root, 'demo', demo), path.join(data, 'assets', 'fixture.fla'));
  for (let i = 0; i < count; i++) {
    const id = 'fixture-' + i;
    await fs.writeFile(path.join(data, 'previews', id + '.png'), png);
    assets.push({ id, hash: crypto.createHash('sha256').update(String(i)).digest('hex'), name: '合成素材 ' + (i + 1), originalName: '合成素材 ' + (i + 1) + '.fla', managedPath: 'assets/fixture.fla', sourcePaths: [], tags: [], kind: 'fla', assetType: 'ordinary', extension: '.fla', previewPath: 'previews/' + id + '.png', previewStatus: 'ready', previewOrigin: 'sidecar', previewRevision: id, width: 512, height: 512, frames: 1, frameRate: 24, createdAt: new Date(1760000000000 + i).toISOString(), categoryId: categories[i % 5].id, favorite: false, likedAt: null });
  }
  await fs.writeFile(path.join(data, 'library.json'), JSON.stringify({ version: 1, assets, categories, history: [] }));
}
async function sample(app) {
  if (app.nativePid) {
    const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', `$all=@(Get-CimInstance Win32_Process); $ids=@(${app.nativePid}); do {$new=@($all | Where-Object { $_.ParentProcessId -in $ids -and $_.ProcessId -notin $ids } | Select-Object -ExpandProperty ProcessId); $ids += $new} while($new.Count); @(Get-Process -Id $ids -ErrorAction SilentlyContinue | Select-Object Id,CPU,WorkingSet64,PrivateMemorySize64) | ConvertTo-Json -Compress`], { windowsHide: true, encoding: 'utf8' });
    const list = JSON.parse(output);
    return { time: Date.now(), processes: (Array.isArray(list) ? list : [list]).map(p => ({ pid: p.Id, type: p.Id === app.nativePid ? 'Browser' : 'Child', ...p })) };
  }
  const metrics = await app.evaluate(({ app }) => app.getAppMetrics().map(p => ({ pid: p.pid, type: p.type, name: p.name, cpu: p.cpu, memory: p.memory })));
  const ids = metrics.map(p => p.pid);
  // Fixed numeric PIDs from this isolated app; no shell interpolation of paths/data.
  const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', `@(Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue | Select-Object Id,CPU,WorkingSet64,PrivateMemorySize64) | ConvertTo-Json -Compress`], { windowsHide: true, encoding: 'utf8' });
  const processes = JSON.parse(output), list = Array.isArray(processes) ? processes : [processes];
  const stats = new Map(list.map(p => [p.Id, p]));
  return { time: Date.now(), processes: metrics.map(p => ({ ...p, ...stats.get(p.pid) })) };
}
function threads(app) {
  return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'idle-threads.ps1'), '-AppPid', String(app.nativePid)], { windowsHide: true, encoding: 'utf8' }));
}
function summary(samples) {
  const intervals = [];
  for (let i = 1; i < samples.length; i++) {
    const before = new Map(samples[i - 1].processes.map(p => [p.pid, p]));
    const cpuSeconds = samples[i].processes.reduce((sum, p) => sum + Math.max(0, (p.CPU || 0) - (before.get(p.pid)?.CPU || p.CPU || 0)), 0);
    const elapsed = (samples[i].time - samples[i - 1].time) / 1000;
    intervals.push({ elapsed, cpuSeconds, cpuPercent: cpuSeconds / elapsed / logicalCpus * 100, workingSetMiB: samples[i].processes.reduce((sum, p) => sum + p.WorkingSet64, 0) / 1048576, privateBytesMiB: samples[i].processes.reduce((sum, p) => sum + p.PrivateMemorySize64, 0) / 1048576 });
  }
  const elapsed = intervals.reduce((sum, p) => sum + p.elapsed, 0), cpuSeconds = intervals.reduce((sum, p) => sum + p.cpuSeconds, 0);
  const round = n => Math.round(n * 1000) / 1000;
  return { sampledSeconds: round(elapsed), groupCPUPercent: round(cpuSeconds / elapsed / logicalCpus * 100), peak5SecondCPUPercent: round(Math.max(...intervals.map(i => i.cpuPercent))), averageWorkingSetMiB: round(intervals.reduce((sum, p) => sum + p.workingSetMiB, 0) / intervals.length), averagePrivateBytesMiB: round(intervals.reduce((sum, p) => sum + p.privateBytesMiB, 0) / intervals.length), processes: samples.at(-1).processes.map(p => ({ pid: p.pid, type: p.type, workingSetMiB: round(p.WorkingSet64 / 1048576), privateBytesMiB: round(p.PrivateMemorySize64 / 1048576) })), intervals };
}
async function main() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-idle-profile-'));
  const result = { version: '0.3.0', packaged, logicalCpus, warmupSeconds, measurement: 'Windows TotalProcessorTime delta / elapsed seconds / logical processors; sum of this Electron instance app.getAppMetrics PIDs only. Memory is Windows working set and private bytes; not Task Manager private working set.', cases: [] };
  let app;
  try {
    for (const count of counts) {
      const data = path.join(temporary, 'library-' + count), profile = path.join(temporary, 'profile-' + count);
      await seed(data, count);
      let page;
      if (process.env.ANSHELF_IDLE_NO_CDP) {
        const child = spawn(executablePath, [...(packaged ? [] : [root]), '--user-data-dir=' + profile], { env: { ...process.env, ANSHELF_DATA_DIR: data }, stdio: 'ignore', windowsHide: true });
        app = { nativePid: child.pid, close: async () => { try { execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch {} } };
      } else {
        app = await _electron.launch({ executablePath, args: [...(packaged ? [] : [root]), '--user-data-dir=' + profile], env: { ...process.env, ANSHELF_DATA_DIR: data }, timeout: 60000 });
        page = await app.firstWindow(); await page.waitForSelector('.import-main');
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.isVisible()).setContentSize(1280, 800));
        await page.locator('#page-title').hover();
      }
      await wait(warmupSeconds * 1000);
      if (process.env.ANSHELF_IDLE_V8_PROFILE) await app.evaluate(async () => {
        const inspector = process.getBuiltinModule('node:inspector'); global.__idleInspector = new inspector.Session(); global.__idleInspector.connect();
        const post = method => new Promise((resolve, reject) => global.__idleInspector.post(method, error => error ? reject(error) : resolve()));
        await post('Profiler.enable'); await post('Profiler.start');
      });
      const snapshots = [await sample(app)], start = Date.now();
      const beforeThreads = process.env.ANSHELF_IDLE_THREADS && app.nativePid ? threads(app) : null;
      console.log('Measuring idle count=' + count + ' for ' + seconds + ' seconds');
      while ((Date.now() - start) / 1000 < seconds) { await wait(5000); snapshots.push(await sample(app)); }
      if (beforeThreads) {
        const earlier = new Map(beforeThreads.map(p => [p.id, p]));
        console.log('Thread CPU ' + JSON.stringify(threads(app).map(p => ({ id: p.id, name: p.name, cpuSeconds: p.cpuSeconds - (earlier.get(p.id)?.cpuSeconds || p.cpuSeconds) })).sort((a, b) => b.cpuSeconds - a.cpuSeconds).slice(0, 15)));
      }
      const dom = page ? await page.evaluate(() => ({ cards: document.querySelectorAll('.asset-card').length, images: document.querySelectorAll('img').length, decodedImages: [...document.querySelectorAll('img')].filter(image => image.complete && image.naturalWidth).length, animations: document.getAnimations().filter(animation => animation.playState === 'running').length })) : null;
      if (process.env.ANSHELF_IDLE_V8_PROFILE) {
        const profile = await app.evaluate(() => new Promise((resolve, reject) => global.__idleInspector.post('Profiler.stop', (error, data) => { global.__idleInspector.disconnect(); delete global.__idleInspector; error ? reject(error) : resolve(data.profile); })));
        await fs.writeFile(path.join(root, 'test-output', 'idle-main-' + count + '.cpuprofile'), JSON.stringify(profile));
        const hits = new Map(); for (const id of profile.samples) hits.set(id, (hits.get(id) || 0) + 1);
        console.log('V8 hotspots ' + JSON.stringify(profile.nodes.map(n => ({ name: n.callFrame.functionName, url: n.callFrame.url, line: n.callFrame.lineNumber, samples: hits.get(n.id) || 0 })).sort((a, b) => b.samples - a.samples).slice(0, 15)));
      }
      const measured = { count, dom, ...summary(snapshots), samples: snapshots }; result.cases.push(measured);
      console.log(JSON.stringify({ count, dom, groupCPUPercent: measured.groupCPUPercent, peak5SecondCPUPercent: measured.peak5SecondCPUPercent, averageWorkingSetMiB: measured.averageWorkingSetMiB, averagePrivateBytesMiB: measured.averagePrivateBytesMiB, processes: measured.processes }, null, 2));
      await app.close(); app = null;
    }
    const output = path.resolve(process.env.ANSHELF_IDLE_OUTPUT || path.join(root, 'test-output', 'idle-profile-0.3.json'));
    await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, JSON.stringify(result, null, 2)); console.log('Saved ' + output);
  } finally { if (app) await app.close(); await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { seed };
