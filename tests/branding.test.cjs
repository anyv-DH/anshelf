const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const paths = source => [...source.matchAll(/<path\s+d="([^"]+)"\s*\/>/g)].map(match => match[1]);

test('desktop and interface use the same supplied monogram geometry without active or remote SVG content', async () => {
  const mark = await fs.readFile(path.join(root, 'ui/brand-anan.svg'), 'utf8');
  const icon = await fs.readFile(path.join(root, 'desktop/icon.svg'), 'utf8');
  assert.equal(paths(mark).length, 2);
  assert.deepEqual(paths(icon), paths(mark));
  assert.match(mark, /viewBox="29 815 2696 1153"/);
  for (const source of [mark, icon]) assert.doesNotMatch(source, /<(?:script|image|foreignObject|metadata)\b|(?:href|onload)\s*=/i);
});

test('Windows logo contains real 16 through 256 pixel icon frames and a 512 pixel PNG', async () => {
  const ico = await fs.readFile(path.join(root, 'desktop/icon.ico'));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 7);
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  for (const [index, size] of sizes.entries()) {
    const entry = 6 + index * 16;
    assert.equal(ico[entry] || 256, size);
    assert.equal(ico[entry + 1] || 256, size);
    const count = ico.readUInt32LE(entry + 8), offset = ico.readUInt32LE(entry + 12);
    assert.ok(offset + count <= ico.length);
    const frame = ico.subarray(offset, offset + count);
    assert.equal(frame.subarray(1, 4).toString(), 'PNG');
    assert.equal(frame.readUInt32BE(16), size);
    assert.equal(frame.readUInt32BE(20), size);
  }
  const png = await fs.readFile(path.join(root, 'desktop/icon.png'));
  assert.equal(png.readUInt32BE(16), 512);
  assert.equal(png.readUInt32BE(20), 512);
});
