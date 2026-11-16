/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function readTheme(name) {
  const css = readFileSync(new URL('./themes.css', import.meta.url), 'utf8');
  const block = css.match(new RegExp(`:root\\[data-theme="${name}"\\]\\s*\\{([^}]+)\\}`));
  assert.ok(block, `${name} has a complete theme definition`);
  const tokens = Object.fromEntries([...block[1].matchAll(/(--[\w-]+)\s*:\s*(#[\da-f]{6,8})\s*;/gi)].map(([, key, value]) => [key, value]));
  return { tokens, scheme: block[1].match(/color-scheme\s*:\s*(light|dark)\s*;/)?.[1] };
}

function luminance(hex) {
  assert.match(hex, /^#[\da-f]{6}$/i, 'contrast checks require an opaque color');
  const rgb = hex.slice(1).match(/../g).map(channel => parseInt(channel, 16) / 255);
  const [r, g, b] = rgb.map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function assertReadable(tokens, foreground, background) {
  const first = luminance(tokens[foreground]);
  const second = luminance(tokens[background]);
  const ratio = (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
  assert.ok(ratio >= 4.5, `${foreground} on ${background}: ${ratio.toFixed(2)}:1 must reach 4.5:1`);
}

for (const [name, scheme] of [['paper', 'light'], ['slate', 'dark'], ['sage', 'light'], ['bluewhite', 'light']]) {
  test(`${name} defines the full native and renderer palette`, () => {
    const theme = readTheme(name);
    assert.equal(theme.scheme, scheme);
    for (const token of ['bg', 'sidebar', 'surface', 'surface-2', 'surface-3', 'ink', 'muted', 'faint', 'line', 'violet', 'accent', 'accent-ink', 'accent-soft', 'green', 'danger', 'hover', 'checker', 'checker-line', 'shadow', 'brand-start', 'brand-end', 'success-soft', 'error-soft', 'scrollbar', 'scrollbar-hover']) {
      assert.ok(theme.tokens[`--${token}`], `${name} defines --${token}`);
    }
  });

  test(`${name} keeps body, secondary and hint text readable on every solid panel`, () => {
    const { tokens } = readTheme(name);
    for (const foreground of ['--ink', '--muted', '--faint']) {
      for (const background of ['--bg', '--sidebar', '--surface', '--surface-2', '--surface-3', '--checker']) {
        assertReadable(tokens, foreground, background);
      }
    }
  });

  test(`${name} keeps actions, connection and error messages readable`, () => {
    const { tokens } = readTheme(name);
    assertReadable(tokens, '--accent-ink', '--accent');
    for (const background of ['--bg', '--surface', '--accent-soft']) {
      assertReadable(tokens, '--violet', background);
    }
    for (const background of ['--bg', '--surface', '--success-soft']) {
      assertReadable(tokens, '--green', background);
    }
    for (const background of ['--bg', '--surface', '--error-soft']) {
      assertReadable(tokens, '--danger', background);
    }
  });
}

test('blue-white reference palette keeps the white canvas and pale category area with a blue accent', () => {
  const { tokens } = readTheme('bluewhite');
  assert.equal(tokens['--bg'], '#ffffff');
  assert.equal(tokens['--surface'], '#ffffff');
  assert.equal(tokens['--surface-2'], '#f7f8fa');
  assert.equal(tokens['--reference-blue'], '#409eff');
});
