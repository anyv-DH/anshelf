/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const JSZip=require('jszip');
const esbuild=require('esbuild');
const playwright=require(process.env.ANSHELF_PLAYWRIGHT||'playwright');

function shape(color) {
 return `<DOMShape><fills><FillStyle index="1"><SolidColor color="${color}"/></FillStyle></fills><edges><Edge fillStyle1="1" edges="!0 400|81920 400|81920 9800|0 9800|0 400"/></edges></DOMShape>`;
}
async function fla() {
 const zip=new JSZip();
 zip.file('DOMDocument.xml',`<DOMDocument xmlns="http://ns.adobe.com/xfl/2008/" width="4096" height="512" frameRate="24" backgroundColor="#FFFFFF"><timelines><DOMTimeline name="test"><layers><DOMLayer name="shape"><frames><DOMFrame index="0" duration="12"><elements>${shape('#FF5533')}</elements></DOMFrame><DOMFrame index="12" duration="12"><elements>${shape('#3355FF')}</elements></DOMFrame></frames></DOMLayer></layers></DOMTimeline></timelines></DOMDocument>`);
 return Array.from(await zip.generateAsync({type:'uint8array'}));
}
function imageWidth(dataURL) {
 const bytes=Buffer.from(dataURL.split(',')[1],'base64');
 return dataURL.startsWith('data:image/png')?bytes.readUInt32BE(16):bytes.readUInt16LE(6);
}
async function run(){
 const root=path.resolve(__dirname,'..');
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'anshelf-resolution-e2e-'));
 const dataRoot=path.join(base,'data');
 await Promise.all([fs.mkdir(path.join(base,'desktop')),fs.mkdir(path.join(base,'dist')),fs.mkdir(path.join(dataRoot,'assets'),{recursive:true})]);
 await esbuild.build({entryPoints:[path.join(root,'preview/worker.ts')],outfile:path.join(base,'dist/worker.js'),bundle:true,format:'iife',platform:'browser',target:'chrome120'});
 await fs.writeFile(path.join(base,'dist/worker.html'),'<!doctype html><html><body><canvas id="stage"></canvas><script src="worker.js"></script></body></html>');
 await esbuild.build({entryPoints:[path.join(root,'desktop/previews.cjs')],outfile:path.join(base,'desktop/previews.cjs'),bundle:true,format:'cjs',platform:'node',external:['electron']});
 await fs.copyFile(path.join(root,'desktop/worker-preload.cjs'),path.join(base,'desktop/worker-preload.cjs'));
 const bytes=await fla();
 await fs.writeFile(path.join(dataRoot,'assets','fixture.fla'),Buffer.from(bytes));
 await fs.writeFile(path.join(base,'package.json'),'{"main":"main.cjs"}');
 await fs.writeFile(path.join(base,'main.cjs'),`const {app,BrowserWindow}=require('electron');app.whenReady().then(()=>{global.__previewRenderer=require('./desktop/previews.cjs').createRenderer(${JSON.stringify(dataRoot)});const win=new BrowserWindow({show:false,width:900,height:600,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});win.loadFile(${JSON.stringify(path.join(base,'dist/worker.html'))});});`);
 const app=await playwright._electron.launch({executablePath:require('electron'),args:[base],timeout:60000});
 const evidence={}; const errors=[];
 try {
  const page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
  await page.waitForFunction(()=>typeof window.renderPreview==='function');
  for(const previewResolution of [256,512,1024,2048]){
   const result=await page.evaluate(({bytes,previewResolution})=>window.renderPreview(bytes,{previewResolution}),{bytes,previewResolution});
   assert.equal(result.previewFormat,'png');assert.equal(imageWidth(result.png),previewResolution);
   evidence['static-'+previewResolution]={width:imageWidth(result.png),animated:result.previewAnimated};
  }
  const generated=await app.evaluate(async()=>global.__previewRenderer({id:'2k-static',kind:'fla',assetType:'ordinary',managedPath:'assets/fixture.fla',previewResolution:2048}));
  const staticBytes=await fs.readFile(path.join(dataRoot,generated.previewPath));
  assert.equal(staticBytes.readUInt32BE(16),2048);assert.equal(generated.previewAnimated,false);
  const effect=await app.evaluate(async()=>global.__previewRenderer({id:'2k-effect',kind:'fla',assetType:'effect',managedPath:'assets/fixture.fla',previewResolution:2048}));
  assert.equal(effect.previewFormat,'gif');assert.equal(effect.previewAnimated,true);assert.ok(effect.previewFrameCount<=6);
  assert.match(effect.previewWarning,/2K/);
  const gifBytes=await fs.readFile(path.join(dataRoot,effect.previewPath));assert.equal(gifBytes.readUInt16LE(6),2048);
  const posterBytes=await fs.readFile(path.join(dataRoot,effect.previewPosterPath));assert.equal(posterBytes.readUInt32BE(16),2048);
  evidence.hosted2K={static:path.join(dataRoot,generated.previewPath),gif:path.join(dataRoot,effect.previewPath),poster:path.join(dataRoot,effect.previewPosterPath),frameCount:effect.previewFrameCount,warning:effect.previewWarning};
  const invalid=await page.evaluate(async bytes=>{try{await window.renderPreview(bytes,{previewResolution:4096});return ''}catch(e){return e.message}},bytes);assert.match(invalid,/分辨率/);
  const python=process.env.ANSHELF_PYTHON||'C:\\Users\\Administrator\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe';
  const decoded=JSON.parse(execFileSync(python,['-c',`
import sys,json
from PIL import Image
out={}
for filename in sys.argv[1:]:
 im=Image.open(filename)
 assert im.width==2048
 colors=[]
 for i in range(getattr(im,'n_frames',1)):
  im.seek(i)
  rgba=im.convert('RGBA')
  colors.append(rgba.getpixel((im.width//2,im.height//2)))
 assert getattr(im,'n_frames',1)==1 or len(set(map(str,colors)))>1
 out[filename]={'size':im.size,'frames':getattr(im,'n_frames',1),'distinctColors':len(set(map(str,colors)))}
print(json.dumps(out))
`,evidence.hosted2K.static,evidence.hosted2K.gif,evidence.hosted2K.poster],{encoding:'utf8'}));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,checks:8,evidence,independentPillowDecode:decoded,errors},null,2));
 } finally {await app.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1});
