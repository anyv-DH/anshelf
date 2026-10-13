/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const JSZip = require('jszip');
const esbuild = require('esbuild');
const playwright = require(process.env.ANSHELF_PLAYWRIGHT || 'playwright');

function square(x, color = '#FF5533') {
  const left = x * 20, right = left + 800;
  return `<DOMShape><fills><FillStyle index="1"><SolidColor color="${color}"/></FillStyle></fills><edges><Edge fillStyle1="1" edges="!${left} 400|${right} 400|${right} 1200|${left} 1200|${left} 400"/></edges></DOMShape>`;
}
function timeline(moving = true) {
  return `<DOMTimeline name="test"><layers><DOMLayer name="shape"><frames><DOMFrame index="0" duration="12"><elements>${square(10)}</elements></DOMFrame><DOMFrame index="12" duration="12"><elements>${square(moving ? 170 : 10)}</elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline>`;
}
async function fixture({ nested = false, graphic = false, moving = true } = {}) {
  const zip = new JSZip();
  const symbol = `<DOMSymbolInstance libraryItemName="effect" symbolType="${graphic ? 'graphic' : 'movie clip'}" loop="loop"><matrix><Matrix a="1" d="1" tx="0" ty="0"/></matrix></DOMSymbolInstance>`;
  const root = nested ? `<DOMTimeline name="root"><layers><DOMLayer name="clip"><frames><DOMFrame index="0" duration="1"><elements>${symbol}</elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline>` : timeline(moving);
  const includes = nested ? '<symbols><Include href="effect.xml"/></symbols>' : '';
  zip.file('DOMDocument.xml', `<DOMDocument xmlns="http://ns.adobe.com/xfl/2008/" width="260" height="140" frameRate="24" backgroundColor="#FFFFFF">${includes}<timelines>${root}</timelines></DOMDocument>`);
  if (nested) zip.file('LIBRARY/effect.xml', `<DOMSymbolItem xmlns="http://ns.adobe.com/xfl/2008/" name="effect" symbolType="movie clip"><timeline>${timeline(moving)}</timeline></DOMSymbolItem>`);
  return Array.from(await zip.generateAsync({ type: 'uint8array' }));
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-gif-e2e-'));
  await fs.mkdir(path.join(base, 'desktop'));
  await fs.mkdir(path.join(base, 'dist'));
  await fs.mkdir(path.join(base, 'data', 'assets'), { recursive: true });
  await esbuild.build({ entryPoints: [path.join(root, 'preview/worker.ts')], outfile: path.join(base, 'dist', 'worker.js'), bundle: true, format: 'iife', platform: 'browser', target: 'chrome120' });
  await fs.writeFile(path.join(base, 'dist', 'worker.html'), '<!doctype html><html><body><canvas id="stage"></canvas><script src="worker.js"></script></body></html>');
  await esbuild.build({ entryPoints: [path.join(root, 'desktop/previews.cjs')], outfile: path.join(base, 'desktop', 'previews.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
  await fs.copyFile(path.join(root, 'desktop', 'worker-preload.cjs'), path.join(base, 'desktop', 'worker-preload.cjs'));
  await fs.writeFile(path.join(base, 'package.json'), '{"main":"main.cjs"}');
  await fs.writeFile(path.join(base, 'main.cjs'), `const {app,BrowserWindow}=require('electron');app.whenReady().then(()=>{global.__previewRenderer=require('./desktop/previews.cjs').createRenderer(${JSON.stringify(path.join(base, 'data'))});const win=new BrowserWindow({show:false,width:900,height:600,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});win.loadFile(${JSON.stringify(path.join(base, 'dist', 'worker.html'))});});`);
  const app = await playwright._electron.launch({ executablePath: require('electron'), args: [base], timeout: 60000 });
  const errors = [];
  const evidence = {};
  try {
    const page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof window.renderPreview === 'function');
    for (const [name, config, animate] of [
      ['moving', {}, true], ['nested', { nested: true }, true], ['static', { moving: false }, true],
      ['ordinary', {}, false], ['graphic', { nested: true, graphic: true }, true],
    ]) {
      const result = await page.evaluate(({ bytes, animate }) => window.renderPreview(bytes, { animate }), { bytes: await fixture(config), animate });
      const expectedGIF = name === 'moving' || name === 'nested';
      assert.equal(result.previewAnimated, expectedGIF, name);
      assert.equal(result.previewFormat, expectedGIF ? 'gif' : 'png', name);
      assert.ok(result.png.startsWith('data:image/png;base64,'));
      const filename = path.join(base, name + (expectedGIF ? '.gif' : '.png'));
      await fs.writeFile(filename, Buffer.from((expectedGIF ? result.gif : result.png).split(',')[1], 'base64'));
      evidence[name] = { path: filename, previewFormat: result.previewFormat, frames: result.previewFrameCount, duration: result.previewDurationMs };
    }
    const fallback = await page.evaluate(bytes => window.renderPreview(bytes, { animate: true, budgetMs: 0 }), await fixture());
    assert.equal(fallback.previewFormat, 'png');
    assert.match(fallback.previewWarning, /预算/);
    evidence.budgetFallback = true;
    await fs.writeFile(path.join(base, 'data', 'assets', 'nested.fla'), Buffer.from(await fixture({ nested: true })));
    const hosted = await app.evaluate(async () => global.__previewRenderer({ id: 'nested-host', kind: 'fla', assetType: 'effect', managedPath: 'assets/nested.fla' }));
    assert.equal(hosted.previewFormat, 'gif');
    assert.equal(hosted.previewAnimated, true);
    assert.equal(hosted.previewFrameCount, 10);
    assert.equal(hosted.previewDurationMs, 1000);
    await fs.access(path.join(base, 'data', hosted.previewPosterPath));
    evidence.hostedIPC = { path: path.join(base, 'data', hosted.previewPath), poster: path.join(base, 'data', hosted.previewPosterPath), frames: hosted.previewFrameCount, duration: hosted.previewDurationMs };
    evidence.nativeImageGIFFirstFrame = await app.evaluate(({ nativeImage }, filename) => {
      const image = nativeImage.createFromPath(filename);
      return { empty: image.isEmpty(), size: image.getSize(), pngBytes: image.toPNG().length };
    }, evidence.moving.path);
    const python = process.env.ANSHELF_PYTHON || 'C:\\Users\\Administrator\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe';
    const decoded = JSON.parse(execFileSync(python, ['-c', `
import sys,json
from PIL import Image
out={}
for filename in sys.argv[1:]:
 im=Image.open(filename)
 frames=[]
 delays=[]
 for i in range(im.n_frames):
  im.seek(i)
  rgba=im.convert('RGBA')
  box=rgba.getchannel('A').getbbox()
  frames.append(box)
  delays.append(im.info.get('duration',0))
 assert im.n_frames>1
 assert im.size[0]<=640 and im.size[1]<=640
 assert len(set(map(str,frames)))>1,frames
 assert sum(delays)<=6000
 assert im.info.get('loop')==0
 out[filename]={'frames':im.n_frames,'size':im.size,'duration':sum(delays),'firstBounds':frames[0],'lastBounds':frames[-1]}
print(json.dumps(out))
`, evidence.moving.path, evidence.nested.path, evidence.hostedIPC.path], { encoding: 'utf8' }));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, checks: 10, evidence, independentPillowDecode: decoded, errors }, null, 2));
  } finally { await app.close(); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
