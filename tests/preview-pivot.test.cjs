/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const { buildSync } = require('esbuild');

// Bundle the real renderer so these regressions exercise every classic-tween
// consumer without requiring a browser just to check affine geometry.
const { outputFiles } = buildSync({
  entryPoints: [path.join(__dirname, '../vendor/fla-viewer/renderer.ts')],
  bundle: true, platform: 'node', format: 'cjs', write: false,
});
const moduleOutput = { exports: {} };
vm.runInNewContext(outputFiles[0].text, { module: moduleOutput, exports: moduleOutput.exports, require, console });
const { FLARenderer } = moduleOutput.exports;

function instance(matrix = { a: 1, b: 0, c: 0, d: 1, tx: 3.95, ty: 0.85 }, point = { x: 54.7, y: 54 }) {
  return { type: 'symbol', libraryItemName: 'rotating-shape', symbolType: 'graphic', loop: 'loop', matrix, transformationPoint: point };
}
function worldPoint(matrix, point) {
  return { x: matrix.a * point.x + matrix.c * point.y + matrix.tx, y: matrix.b * point.x + matrix.d * point.y + matrix.ty };
}
function near(actual, expected, label = 'point') {
  for (const key of Object.keys(expected)) assert.ok(Math.abs(actual[key] - expected[key]) < 1e-7, `${label}.${key}: expected ${expected[key]}, got ${actual[key]}`);
}
function renderer() {
  const value = Object.create(FLARenderer.prototype);
  value.rigMatrixCache = new WeakMap();
  return value;
}
const spin = { motionTweenRotate: 'cw', motionTweenRotateTimes: 3 };

test('classic spin keeps an off-origin transformation point still throughout three full turns', () => {
  const source = instance(), value = renderer();
  let rendered;
  value.renderDisplayElement = element => { rendered = element; };
  const center = worldPoint(source.matrix, source.transformationPoint);
  for (const progress of [0, 1 / 12, 1 / 6, 0.25, 0.5, 0.75, 1]) {
    value.renderDisplayElementWithTween(source, source, progress, 0, 0, spin);
    near(worldPoint(rendered.matrix, source.transformationPoint), center, `center at ${progress}`);
    near({ x: rendered.matrix.a, y: rendered.matrix.b }, { x: Math.cos(progress * 6 * Math.PI), y: Math.sin(progress * 6 * Math.PI) }, 'rotation');
  }
  assert.deepEqual(source.matrix, { a: 1, b: 0, c: 0, d: 1, tx: 3.95, ty: 0.85 });
});

test('pivot correction preserves the authored center movement and scale rather than freezing all motion', () => {
  const start = instance(), end = instance({ a: 0, b: 2, c: -2, d: 0, tx: 235, ty: 40 });
  const value = renderer();
  let rendered;
  value.renderDisplayElement = element => { rendered = element; };
  const from = worldPoint(start.matrix, start.transformationPoint), to = worldPoint(end.matrix, end.transformationPoint);
  for (const progress of [0, 0.25, 0.5, 1]) {
    value.renderDisplayElementWithTween(start, end, progress, 0, 0, {});
    near(worldPoint(rendered.matrix, start.transformationPoint), { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress });
    assert.ok(Math.abs(Math.hypot(rendered.matrix.a, rendered.matrix.b) - (1 + progress)) < 1e-7);
  }
});

test('mask, camera and rig-parent sampling use the same stationary pivot as visible content', () => {
  const source = instance();
  const frame = { index: 0, duration: 18, elements: [source], tweenType: 'motion', ...spin };
  const end = { index: 18, duration: 1, elements: [source] };
  const layer = { frames: [frame, end], layerType: 'normal', visible: true };
  const value = renderer(), center = worldPoint(source.matrix, source.transformationPoint);
  let mask;
  value.addElementToMaskPath = element => { mask = element; };
  value.addLayerToMaskPath(layer, 3, {}, {}, 0);
  near(worldPoint(mask.matrix, source.transformationPoint), center, 'mask');
  near(worldPoint(value.getCameraElement(layer, 3).matrix, source.transformationPoint), center, 'camera');
  near(worldPoint(value.getRigLayerWorldMatrix([layer], 0, 3), source.transformationPoint), center, 'rig');
});

test('a symbol with an origin pivot retains the ordinary translation path', () => {
  const value = renderer(), start = instance(undefined, { x: 0, y: 0 });
  const end = instance({ a: 0, b: 1, c: -1, d: 0, tx: 100, ty: 200 }, { x: 0, y: 0 });
  let rendered;
  value.renderDisplayElement = element => { rendered = element; };
  value.renderDisplayElementWithTween(start, end, 0.5, 0, 0, {});
  near({ x: rendered.matrix.tx, y: rendered.matrix.ty }, { x: 51.975, y: 100.425 });
});
