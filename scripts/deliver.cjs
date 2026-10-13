/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const JSZip = require('jszip');

async function addTree(zip, directory, prefix) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Delivery cannot include linked files: ' + entry.name);
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) await addTree(zip, filename, `${prefix}/${entry.name}`);
    else zip.file(`${prefix}/${entry.name}`, await fs.readFile(filename));
  }
}

async function deliver() {
  const root = path.resolve(__dirname, '..');
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const product = pkg.build.productName, version = pkg.version;
  const out = path.resolve(process.argv[2] || path.join(root, '../../outputs'));
  await fs.mkdir(out, { recursive: true });
  const source = new JSZip();
  const documents = ['AGENTS.md', 'PRD.md', 'ARCH.md', 'PROJECT_STATE.md', 'DECISIONS.md', 'TEST_PLAN.md', 'SECURITY.md', 'RELEASE_CHECKLIST.md', 'README.md', 'THIRD_PARTY_NOTICES.md', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.gitignore'];
  for (const name of documents) source.file(`AnShelf-source/${name}`, await fs.readFile(path.join(root, name)));
  for (const name of ['core', 'desktop', 'ui', 'preview', 'plugin', 'scripts', 'tests', 'references', 'vendor', 'demo', 'dist']) await addTree(source, path.join(root, name), `AnShelf-source/${name}`);
  await fs.writeFile(path.join(out, product + '-source.zip'), await source.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } }));
  const plugin = new JSZip();
  await addTree(plugin, path.join(root, 'plugin'), 'AnShelf-AnimatePlugin');
  await fs.writeFile(path.join(out, product + '-AnimatePlugin.zip'), await plugin.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  for (const name of [`${product} ${version}.exe`, `${product} Setup ${version}.exe`]) await fs.copyFile(path.join(root, 'release', name), path.join(out, name));
  await fs.copyFile(path.join(root, 'README.md'), path.join(out, product + '-使用说明.md'));
  await fs.copyFile(path.join(root, 'PROJECT_STATE.md'), path.join(out, product + '-验证记录.md'));
  await fs.copyFile(path.join(root, 'THIRD_PARTY_NOTICES.md'), path.join(out, 'THIRD_PARTY_NOTICES.md'));
  for (const [src, name] of [['ui-01-empty-1280.png', product + '-空库界面.png'], ['ui-05-clean-demo-1280.png', product + '-素材库界面.png'], ['media-warm-category.png', product + '-暖色分类界面.png'], ['media-audio-library.png', product + '-音频库界面.png'], ['media-gif-zoom.png', product + '-动图放大预览.png'], ['category-favorites.png', product + '-收藏分类界面.png'], ['ui-08-density5-1280.png', product + '-每行5个.png'], ['ui-10-density6-1480.png', product + '-每行6个.png'], ['panel-compact.png', product + '-AN单按钮面板.png']]) await fs.copyFile(path.join(root, 'test-output', src), path.join(out, name));
  const sums = [];
  for (const name of (await fs.readdir(out)).sort()) {
    if (name === 'SHA256SUMS.txt') continue;
    const filename = path.join(out, name);
    if (!(await fs.stat(filename)).isFile()) continue;
    const bytes = await fs.readFile(filename);
    sums.push(`${crypto.createHash('sha256').update(bytes).digest('hex')}  ${name}`);
  }
  await fs.writeFile(path.join(out, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
  for (const name of [product + '-source.zip', product + '-AnimatePlugin.zip']) {
    const archive = await JSZip.loadAsync(await fs.readFile(path.join(out, name)), { checkCRC32: true });
    const files = Object.keys(archive.files);
    if (!files.some(file => file.endsWith('insert-whole.jsfl')) || files.some(file => /(?:^|\/)(?:node_modules|\.git|data|test-output)(?:\/|$)/.test(file))) throw new Error('Invalid delivery archive: ' + name);
  }
  console.log(JSON.stringify({ output: out, files: (await fs.readdir(out)).sort(), archivesCRC32Verified: true }, null, 2));
}

deliver().catch(error => { console.error(error); process.exitCode = 1; });
