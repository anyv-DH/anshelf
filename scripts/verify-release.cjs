/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const builder = path.dirname(require.resolve('electron-builder'));
const lib = path.dirname(require.resolve('app-builder-lib', { paths: [builder] }));
const asar = require(require.resolve('@electron/asar', { paths: [lib] }));
const release = path.join(root, 'release/win-unpacked');
const archive = path.join(release, 'resources/app.asar');
assert.deepEqual(fs.readFileSync(path.join(release,'resources/StageTarget/stage-target.exe')),fs.readFileSync(path.join(root,'desktop/native/stage-target.exe')),'External stage helper matches final build');
const config = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const packagedConfig = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
assert.equal(config.build.productName, '安安素材管理器', 'Release product name must retain the requested brand');
assert.equal(config.build.appId, 'com.anshelf.desktop', 'Release app ID must retain the existing library identity');
assert.equal(packagedConfig.name, config.name, 'Packaged application identity must match final source');
assert.equal(packagedConfig.version, config.version, 'Packaged version must match final source');
assert.equal(packagedConfig.description, config.description, 'Packaged product description must match final source');
assert.equal(packagedConfig.main, config.main, 'Packaged application entry must match final source');
function treeFiles(directory) {
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry => {
    assert.ok(!entry.isSymbolicLink(), 'Release source must not contain linked files');
    const file = directory + '/' + entry.name;
    return entry.isDirectory() ? treeFiles(file) : [file];
  });
}
const files = [...['core', 'desktop', 'dist', 'plugin'].flatMap(treeFiles), 'README.md', 'LICENSE', 'NOTICE', 'COMMERCIAL-ATTRIBUTION.md', 'THIRD_PARTY_NOTICES.md'];
for (const file of treeFiles('ui')) assert.deepEqual(fs.readFileSync(path.join(root, file)), fs.readFileSync(path.join(root, 'dist', file.slice('ui/'.length))), 'Built UI must match final source: ' + file);
const demoFiles = fs.readdirSync(path.join(root, 'demo')).filter(file => path.extname(file).toLowerCase() === '.fla').sort();
assert.equal(demoFiles.length, 6, 'Release must include all six demonstration materials');
files.push(...demoFiles.map(file => 'demo/' + file));
for (const file of files) assert.deepEqual(asar.extractFile(archive, path.normalize(file)), fs.readFileSync(path.join(root, file)), 'Packaged version must match final source: ' + file);
const pluginFiles = treeFiles('plugin').map(file => file.slice('plugin/'.length));
for (const file of pluginFiles) assert.deepEqual(fs.readFileSync(path.join(release, 'resources/AnimatePlugin', file)), fs.readFileSync(path.join(root, 'plugin', file)), 'Released plugin must match final source: ' + file);
for (const file of ['JSZip.txt', 'pako.txt', 'gifenc.txt', 'Electron.txt']) assert.ok(fs.statSync(path.join(release, 'resources/licenses', file)).size > 100);
const executableName = (config.build.executableName || config.build.productName) + '.exe';
assert.ok(fs.statSync(path.join(release, executableName)).size > 1000000);
for (const filename of [`${config.build.productName} ${config.version}.exe`, `${config.build.productName} Setup ${config.version}.exe`]) assert.ok(fs.statSync(path.join(root, 'release', filename)).size > 1000000);
console.log(JSON.stringify({ passed: true, product: config.build.productName, appId: config.build.appId, version: config.version, executable: executableName, packagedFilesMatchSource: files.length, demoFilesMatchSource: demoFiles.length, pluginFilesMatchSource: pluginFiles.length, licensesIncluded: 4, projectNoticesIncluded: 3 }, null, 2));
