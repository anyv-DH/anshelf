/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const JSZip = require('jszip');
const esbuild = require('esbuild');
const playwright = require(process.env.ANSHELF_PLAYWRIGHT || 'playwright');

function rectangle(left, top, right, bottom, color) {
  const points = [[left, top], [right, top], [right, bottom], [left, bottom], [left, top]];
  return `<DOMShape><fills><FillStyle index="1"><SolidColor color="${color}"/></FillStyle></fills><edges><Edge fillStyle1="1" edges="${points.map(([x, y], index) => `${index ? '|' : '!'}${Math.round(x * 20)} ${Math.round(y * 20)}`).join('')}"/></edges></DOMShape>`;
}

async function fixture() {
  const zip = new JSZip();
  const namespace = 'xmlns="http://ns.adobe.com/xfl/2008/"';
  const instance = (name, tx, ty, pivot) => `<DOMSymbolInstance libraryItemName="${name}" symbolType="graphic" loop="loop"><matrix><Matrix tx="${tx}" ty="${ty}"/></matrix><transformationPoint><Point x="${pivot.x}" y="${pivot.y}"/></transformationPoint></DOMSymbolInstance>`;
  const wheel = instance('wheel', 3.95, 0.85, { x: 54.7, y: 54 });
  zip.file('DOMDocument.xml', `<DOMDocument ${namespace} width="320" height="240" frameRate="24"><symbols><Include href="spinner.xml"/><Include href="wheel.xml"/></symbols><timelines><DOMTimeline name="root"><layers><DOMLayer name="effect"><frames><DOMFrame index="0" duration="19"><elements>${instance('spinner', 68, 50, { x: 0, y: 0 })}</elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timelines></DOMDocument>`);
  zip.file('LIBRARY/spinner.xml', `<DOMSymbolItem ${namespace} name="spinner" symbolType="graphic"><timeline><DOMTimeline name="spin"><layers><DOMLayer name="rotation"><frames><DOMFrame index="0" duration="18" tweenType="motion" motionTweenRotate="clockwise" motionTweenRotateTimes="3"><elements>${wheel}</elements></DOMFrame><DOMFrame index="18"><elements>${wheel}</elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timeline></DOMSymbolItem>`);
  const shape = rectangle(50.7, 50, 58.7, 58, '#FF0000') + rectangle(62.7, 52, 92.7, 56, '#2266FF');
  zip.file('LIBRARY/wheel.xml', `<DOMSymbolItem ${namespace} name="wheel" symbolType="graphic"><timeline><DOMTimeline name="shape"><layers><DOMLayer name="shape"><frames><DOMFrame index="0"><elements>${shape}</elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timeline></DOMSymbolItem>`);
  return Array.from(await zip.generateAsync({ type: 'uint8array' }));
}

async function run() {
  const root = path.resolve(__dirname, '..');
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'anshelf-pivot-e2e-'));
  await esbuild.build({ entryPoints: [path.join(root, 'preview/worker.ts')], outfile: path.join(base, 'worker.js'), bundle: true, format: 'iife', platform: 'browser', target: 'chrome120' });
  await fs.writeFile(path.join(base, 'worker.html'), '<!doctype html><html><body><canvas id="stage"></canvas><script src="worker.js"></script></body></html>');
  await fs.writeFile(path.join(base, 'package.json'), '{"main":"main.cjs"}');
  await fs.writeFile(path.join(base, 'main.cjs'), `const {app,BrowserWindow}=require('electron');app.whenReady().then(()=>{const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});win.loadFile(${JSON.stringify(path.join(base, 'worker.html'))});});`);
  const app = await playwright._electron.launch({ executablePath: require('electron'), args: [base], timeout: 60000 });
  try {
    const page = await app.firstWindow(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof window.renderPreview === 'function');
    const result = await page.evaluate(bytes => window.renderPreview(bytes, { animate: true }), await fixture());
    assert.equal(result.previewAnimated, true);
    assert.equal(result.previewFormat, 'gif');
    const gifPath = path.join(base, 'stationary-spinner.gif');
    await fs.writeFile(gifPath, Buffer.from(result.gif.split(',')[1], 'base64'));
    const python = process.env.ANSHELF_PYTHON || 'C:\\Users\\Administrator\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe';
    const decoded = JSON.parse(execFileSync(python, ['-c', `
from PIL import Image
import sys,json,hashlib
im=Image.open(sys.argv[1]); centers=[]; hashes=[]
for index in range(im.n_frames):
 im.seek(index); rgba=im.convert('RGBA'); points=[]
 for y in range(rgba.height):
  for x in range(rgba.width):
   r,g,b,a=rgba.getpixel((x,y))
   if r>200 and g<70 and b<70 and a>0: points.append((x,y))
 assert points,'rotation center marker disappeared'
 centers.append([sum(x for x,y in points)/len(points),sum(y for x,y in points)/len(points)])
 hashes.append(hashlib.sha256(rgba.tobytes()).hexdigest())
drift=max(((x-centers[0][0])**2+(y-centers[0][1])**2)**.5 for x,y in centers)
assert drift<1.0,('stationary rotation center moved',drift,centers)
assert len(set(hashes))>2,'spinner did not rotate'
print(json.dumps({'frames':im.n_frames,'size':im.size,'centerDriftPixels':drift,'distinctFrames':len(set(hashes))}))
`, gifPath], { encoding: 'utf8' }));
    const evidence = { synthetic: { path: gifPath, ...decoded } };
    if (process.env.ANSHELF_PIVOT_ASSET) {
      const bytes = Array.from(await fs.readFile(process.env.ANSHELF_PIVOT_ASSET));
      const actual = await page.evaluate(bytes => window.renderPreview(bytes, { animate: true }), bytes);
      assert.equal(actual.previewAnimated, true);
      const actualPath = path.join(base, 'local-asset.gif');
      await fs.writeFile(actualPath, Buffer.from(actual.gif.split(',')[1], 'base64'));
      evidence.localAsset = { path: actualPath, frames: actual.previewFrameCount, duration: actual.previewDurationMs, warning: actual.previewWarning };
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, checks: 5, evidence, errors }, null, 2));
  } finally { await app.close(); }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
