/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const JSZip = require('jszip');

async function main() {
  const tool = process.argv[2], work = process.argv[3];
  if (!tool || !work || !path.isAbsolute(tool) || !path.isAbsolute(work)) throw new Error('Provide absolute ZXPSignCmd and private work directory paths');
  const root = path.resolve(__dirname, '..'), plugin = path.join(root, 'plugin');
  const directory = path.join(work, 'plugin-' + randomUUID());
  const input = path.join(directory, 'input'), signed = path.join(directory, 'signed');
  await fs.mkdir(input, { recursive: true }); await fs.mkdir(signed);
  const payload = ['index.html', 'style.css', 'icon.png', 'panel.js', 'queue.cjs', 'insert-whole.jsfl', 'README.md', 'CSXS/manifest.xml'];
  // The signing tool creates mimetype itself. install.ps1 is an outer installer.
  for (const file of payload) {
    await fs.mkdir(path.dirname(path.join(input, file)), { recursive: true });
    await fs.copyFile(path.join(plugin, file), path.join(input, file));
  }
  const password = randomBytes(32).toString('hex'), certificate = path.join(directory, 'private.p12'), zxp = path.join(directory, 'receiver.zxp');
  const invoke = args => {
    try { return execFileSync(tool, args, { cwd: directory, encoding: 'utf8', windowsHide: true }); }
    catch (error) { throw new Error('Adobe signing tool failed: ' + String(error.stdout || error.stderr || 'unknown error')); }
  };
  invoke(['-selfSignedCert', 'CN', 'Local', 'AnShelf', 'AnShelf Local CEP', password, certificate, '-validityDays', '3650']);
  invoke(['-sign', input, zxp, certificate, password]);
  const archive = await JSZip.loadAsync(await fs.readFile(zxp), { checkCRC32: true });
  for (const [name, entry] of Object.entries(archive.files)) {
    if (entry.dir) continue;
    if (!payload.includes(name) && !['mimetype', 'META-INF/signatures.xml'].includes(name)) throw new Error('Unexpected signed runtime entry');
    await fs.mkdir(path.dirname(path.join(signed, name)), { recursive: true });
    await fs.writeFile(path.join(signed, name), await entry.async('nodebuffer'));
  }
  const verification = invoke(['-verify', signed]);
  if (!verification.includes('Signature verified successfully')) throw new Error('Signature was not verified');
  for (const file of payload) {
    if (!(await fs.readFile(path.join(signed, file))).equals(await fs.readFile(path.join(plugin, file)))) throw new Error('Signed payload changed');
  }
  await fs.mkdir(path.join(plugin, 'META-INF'), { recursive: true });
  for (const file of ['mimetype', 'META-INF/signatures.xml']) await fs.copyFile(path.join(signed, file), path.join(plugin, file));
  console.log(JSON.stringify({ signedRuntime: signed, signatureVerified: true, runtimeFiles: payload.length + 2, privateCertificateDelivered: false }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
