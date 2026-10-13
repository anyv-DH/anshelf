/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const fs = require('node:fs/promises');
const path = require('node:path');

const bundledDemoFolder = path.resolve(__dirname, '../demo');
const demoNames = [
  '暮紫 · 长剑.fla',
  '森语 · 战斧.fla',
  '星辉 · 盾牌.fla',
  '风行 · 长弓.fla',
  '月白 · 法杖.fla',
  '冒险者 · 人物.fla',
];

// These samples were created and saved by Animate 23's native document API.
// Copy the bundled files rather than constructing an incomplete FLA container.
async function generateDemo(folder = bundledDemoFolder) {
  const destination = path.resolve(folder);
  if (destination.toLowerCase() === bundledDemoFolder.toLowerCase()) return destination;
  await fs.mkdir(destination, { recursive: true });
  for (const name of demoNames) {
    await fs.copyFile(path.join(bundledDemoFolder, name), path.join(destination, name));
  }
  return destination;
}

if (require.main === module) {
  generateDemo().then(folder => console.log(folder)).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { generateDemo };
