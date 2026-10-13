/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const runtimeFiles = ['index.html', 'style.css', 'icon.png', 'panel.js', 'queue.cjs', 'insert-whole.jsfl', 'README.md', 'CSXS/manifest.xml'];
const signedFiles = [...runtimeFiles, 'mimetype', 'META-INF/signatures.xml'];

function fixture(t, { signed = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anshelf-signed-install-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'package');
  const appData = path.join(root, 'appdata');
  const base = path.join(appData, 'Adobe/CEP/extensions');
  const backupBase = path.join(appData, 'Adobe/CEP/AnShelfPluginBackups');
  const target = path.join(base, 'com.anshelf.receiver');
  fs.mkdirSync(source, { recursive: true });
  for (const relative of [...runtimeFiles, 'install.ps1']) {
    fs.mkdirSync(path.dirname(path.join(source, relative)), { recursive: true });
    fs.copyFileSync(path.join(__dirname, '../plugin', relative), path.join(source, relative));
  }
  if (signed) {
    fs.writeFileSync(path.join(source, 'mimetype'), 'application/vnd.adobe.air-ucf-package+zip');
    const references = [...runtimeFiles, 'mimetype'].map(relative => {
      const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(source, relative))).digest('base64');
      return `<Reference URI="${relative}"><DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><DigestValue>${digest}</DigestValue></Reference>`;
    }).join('');
    fs.mkdirSync(path.join(source, 'META-INF'));
    // Deterministic package-hash fixture; CEP's certificate trust is verified separately in real Animate.
    fs.writeFileSync(path.join(source, 'META-INF/signatures.xml'), `<signatures><Signature xmlns="http://www.w3.org/2000/09/xmldsig#" Id="PackageSignature"><SignedInfo/><SignatureValue>AA==</SignatureValue><Object><Manifest Id="PackageContents">${references}</Manifest></Object></Signature></signatures>\r\n`);
  }
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'previous-panel.txt'), 'previous installation must remain recoverable');
  const library = path.join(appData, 'AnShelf');
  fs.mkdirSync(path.join(library, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(library, 'library.json'), '{"assets":["keep"]}');
  fs.writeFileSync(path.join(library, 'assets/keep.fla'), 'original managed content');
  return { root, source, appData, base, backupBase, target, library };
}

function snapshot(directory) {
  const result = {};
  function visit(current, relative = '') {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const child = path.join(current, entry.name);
      const key = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(child, key);
      else result[key] = fs.readFileSync(child).toString('base64');
    }
  }
  visit(directory);
  return result;
}

function install(f, { args = [], harness = '' } = {}) {
  const installer = path.join(f.source, 'install.ps1');
  let command = installer;
  let parameters = args;
  if (harness) {
    command = path.join(f.root, 'harness.ps1');
    fs.writeFileSync(command, `param([string]$Installer)\n$ErrorActionPreference = 'Stop'\n${harness}\n& $Installer ${args.join(' ')}\n`);
    parameters = ['-Installer', installer];
  }
  return spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', command, ...parameters], {
    encoding: 'utf8', env: { ...process.env, APPDATA: f.appData }, timeout: 30000,
  });
}

function assertFailedWithoutChanging(f, result, before, message) {
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, message);
  assert.deepEqual(snapshot(f.target), before);
  assert.deepEqual(fs.readdirSync(f.base), ['com.anshelf.receiver']);
  if (fs.existsSync(f.backupBase)) assert.deepEqual(fs.readdirSync(f.backupBase), []);
}

test('signed CEP upgrade preserves every package byte, a recoverable previous installation and the asset library', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t);
  const previous = snapshot(f.target);
  const library = snapshot(f.library);
  const result = install(f, { harness: `function New-ItemProperty { throw 'Registry must not be changed by default' }` });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /registry settings were not changed/);
  for (const relative of signedFiles) {
    assert.deepEqual(fs.readFileSync(path.join(f.target, relative)), fs.readFileSync(path.join(f.source, relative)), relative);
  }
  assert.deepEqual(Object.keys(snapshot(f.target)).sort(), signedFiles.slice().sort());
  assert.deepEqual(fs.readdirSync(f.base), ['com.anshelf.receiver']);
  const backups = fs.readdirSync(f.backupBase).filter(name => name.startsWith('com.anshelf.receiver.backup-'));
  assert.equal(backups.length, 1);
  assert.deepEqual(snapshot(path.join(f.backupBase, backups[0])), previous);
  assert.deepEqual(snapshot(f.library), library);
});

test('a signed CEP package installs when no Adobe extension directory exists', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t);
  fs.rmSync(path.join(f.appData, 'Adobe'), { recursive: true });
  const result = install(f);
  assert.equal(result.status, 0, result.stderr);
  for (const relative of signedFiles) assert.deepEqual(fs.readFileSync(path.join(f.target, relative)), fs.readFileSync(path.join(f.source, relative)), relative);
  assert.deepEqual(fs.readdirSync(f.base), ['com.anshelf.receiver']);
  assert.deepEqual(fs.readdirSync(f.backupBase), []);
});

test('partial CEP signature metadata is rejected before replacing an installed extension', { skip: process.platform !== 'win32' }, async t => {
  for (const missing of ['mimetype', 'META-INF/signatures.xml']) {
    await t.test(`missing ${missing}`, t => {
      const f = fixture(t);
      const before = snapshot(f.target);
      fs.rmSync(path.join(f.source, missing));
      const result = install(f);
      assertFailedWithoutChanging(f, result, before, /incomplete|partial|signature metadata/i);
    });
  }
});

test('a signed payload modified after signing is rejected and leaves the installed extension intact', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t);
  const before = snapshot(f.target);
  fs.appendFileSync(path.join(f.source, 'panel.js'), '\n// unexpected tampering\n');
  assertFailedWithoutChanging(f, install(f), before, /digest|hash|integrity/i);
});

test('CEP signature file references cannot escape the package or omit a runtime file', { skip: process.platform !== 'win32' }, async t => {
  for (const invalidUri of ['../outside.js', 'queue.cjs']) {
    await t.test(`invalid panel reference ${invalidUri}`, t => {
      const f = fixture(t);
      const before = snapshot(f.target);
      const signature = path.join(f.source, 'META-INF/signatures.xml');
      const xml = fs.readFileSync(signature, 'utf8');
      const modified = invalidUri === 'queue.cjs'
        ? xml.replace(/<Reference URI="panel.js">.*?<\/Reference>/, xml.match(/<Reference URI="queue.cjs">.*?<\/Reference>/)[0])
        : xml.replace('URI="panel.js"', `URI="${invalidUri}"`);
      fs.writeFileSync(signature, modified);
      assertFailedWithoutChanging(f, install(f), before, /signature file reference/i);
    });
  }
});

test('copy failure and staged-byte tampering cannot overwrite an existing CEP installation', { skip: process.platform !== 'win32' }, async t => {
  for (const failure of ['copy failure', 'staged tampering']) {
    await t.test(failure, t => {
      const f = fixture(t);
      const before = snapshot(f.target);
      const action = failure === 'copy failure'
        ? `throw 'Injected staging copy failure'`
        : `[System.IO.File]::AppendAllText($Destination, 'unexpected staged bytes')`;
      const harness = `function Copy-Item {
  param([string]$LiteralPath, [string]$Destination, [switch]$Force)
  Microsoft.PowerShell.Management\\Copy-Item -LiteralPath $LiteralPath -Destination $Destination -Force:$Force
  if ([System.IO.Path]::GetFileName($LiteralPath) -eq 'panel.js') { ${action} }
}`;
      assertFailedWithoutChanging(f, install(f, { harness }), before, /staging|digest|hash|integrity/i);
    });
  }
});

test('a failed final CEP directory swap restores the previous installation', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t);
  const before = snapshot(f.target);
  const harness = `function Move-Item {
  param([string]$LiteralPath, [string]$Destination)
  Microsoft.PowerShell.Management\\Move-Item -LiteralPath $LiteralPath -Destination $Destination
  if ([System.IO.Path]::GetFileName($Destination) -like '*.backup-*') {
    $staging = Get-ChildItem -LiteralPath ([System.IO.Path]::GetDirectoryName($Destination)) -Directory -Filter '*.staging-*'
    foreach ($item in $staging) { Microsoft.PowerShell.Management\\Remove-Item -LiteralPath $item.FullName -Recurse -Force }
  }
}`;
  assertFailedWithoutChanging(f, install(f, { harness }), before, /Move|find|exist/i);
});

test('an occupied CEP destination fails without nesting the staged package or overwriting the competing tree', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t);
  const before = snapshot(f.target);
  const library = snapshot(f.library);
  const harness = `function Move-Item {
  param([string]$LiteralPath, [string]$Destination)
  Microsoft.PowerShell.Management\\Move-Item -LiteralPath $LiteralPath -Destination $Destination
  if ([System.IO.Path]::GetFileName($Destination) -like '*.backup-*') {
    [System.IO.Directory]::CreateDirectory($LiteralPath) | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $LiteralPath 'competing-panel.txt'), 'competing installation')
  }
}`;
  const result = install(f, { harness });
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /target is occupied.*previous plugin is preserved at/i);
  assert.deepEqual(snapshot(f.target), { 'competing-panel.txt': Buffer.from('competing installation').toString('base64') });
  const backupNames = fs.readdirSync(f.backupBase);
  assert.equal(backupNames.length, 1);
  assert.match(backupNames[0], /^com\.anshelf\.receiver\.backup-/);
  assert.deepEqual(snapshot(path.join(f.backupBase, backupNames[0])), before);
  assert.deepEqual(snapshot(f.library), library);
});

test('unsigned CEP development installation requires explicit debug mode without real registry writes', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t, { signed: false });
  const before = snapshot(f.target);
  assertFailedWithoutChanging(f, install(f), before, /unsigned|EnableDebug/i);
  const harness = `function New-Item {
  param([string]$Path, [string]$ItemType, [switch]$Force)
  if ($Path.StartsWith('HKCU:')) { return }
  Microsoft.PowerShell.Management\\New-Item -Path $Path -ItemType $ItemType -Force:$Force
}
function New-ItemProperty {
  param([string]$Path, [string]$Name, [string]$Value, [string]$PropertyType, [switch]$Force)
  if ($Path -ne 'HKCU:\\Software\\Adobe\\CSXS.11' -or $Name -ne 'PlayerDebugMode' -or $Value -ne '1' -or $PropertyType -ne 'String') { throw 'Unexpected debug registry request' }
}`;
  const result = install(f, { args: ['-EnableDebug'], harness });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /unsigned-extension development mode/);
  assert.deepEqual(Object.keys(snapshot(f.target)).sort(), runtimeFiles.slice().sort());
});

test('linked CEP signature metadata is rejected without touching the link destination or installed extension', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t);
  const before = snapshot(f.target);
  const outside = path.join(f.root, 'outside-signatures');
  fs.renameSync(path.join(f.source, 'META-INF'), outside);
  fs.symlinkSync(outside, path.join(f.source, 'META-INF'), 'junction');
  const outsideBefore = snapshot(outside);
  assertFailedWithoutChanging(f, install(f), before, /reparse-point|link/i);
  assert.deepEqual(snapshot(outside), outsideBefore);
});

test('linked CEP backup directory is rejected without changing an installation or outside files', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t);
  const before = snapshot(f.target);
  const outside = path.join(f.root, 'outside-backups');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep');
  fs.symlinkSync(outside, f.backupBase, 'junction');
  const outsideBefore = snapshot(outside);
  const result = install(f);
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /reparse-point/);
  assert.deepEqual(snapshot(f.target), before);
  assert.deepEqual(snapshot(outside), outsideBefore);
});
