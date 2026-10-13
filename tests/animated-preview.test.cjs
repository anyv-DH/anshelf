/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlan, alphaBounds, unionBounds, cropGeometry, animationFrameLimit, MAX_TOTAL_PIXELS } = require('../preview/animation-plan.cjs');
const { createGIF } = require('../preview/gif-encoder.cjs');

function timeline(count, elements, index = 0) {
  return { totalFrames: count, referenceLayers: new Set(), layers: [{ visible: true, frames: [{ index, duration: count - index, elements }] }] };
}
function doc(root, symbols = []) { return { timelines: [root], symbols: new Map(symbols), frameRate: 24 }; }
const clip = (name, type = 'movieclip', loop = 'loop') => ({ type: 'symbol', libraryItemName: name, symbolType: type, loop });

test('ordinary material keeps the one-frame preview while effect samples its timeline', () => {
  const document = doc(timeline(120, [{ type: 'shape' }]));
  assert.equal(createPlan(document, false).samples.length, 1);
  const plan = createPlan(document, true);
  assert.equal(plan.samples.length, 50);
  assert.equal(plan.samples[0].tick, 0);
  assert.equal(plan.samples.at(-1).tick, 117);
  assert.equal(plan.samples.reduce((sum, sample) => sum + sample.delay, 0), 5000);
});

test('one root frame animates nested MovieClip but not a graphic-only timeline', () => {
  const symbol = { timeline: timeline(48, [{ type: 'shape' }]) };
  assert.equal(createPlan(doc(timeline(1, [clip('spark')]), [['spark', symbol]]), true).samples.length, 20);
  assert.equal(createPlan(doc(timeline(1, [clip('spark', 'graphic')]), [['spark', symbol]]), true).samples.length, 1);
});

test('sampling excludes unrelated, hidden and recursively referenced library symbols', () => {
  const root = timeline(1, [{ type: 'shape' }]);
  root.layers.push({ visible: false, frames: [{ index: 0, elements: [clip('long')] }] });
  const document = doc(root, [['long', { timeline: timeline(5000, [clip('long')]) }]]);
  assert.equal(createPlan(document, true).samples.length, 1);
  const recursive = doc(timeline(1, [clip('loop')]), [['loop', { timeline: timeline(3, [clip('loop')]) }]]);
  assert.ok(createPlan(recursive, true).samples.length <= 60);
});

test('a later placement of the same MovieClip extends the preview independently', () => {
  const root = timeline(60, [clip('spark')]);
  root.layers[0].frames.push({ index: 48, duration: 12, elements: [clip('spark')] });
  const document = doc(root, [['spark', { timeline: timeline(48, [{ type: 'shape' }]) }]]);
  assert.equal(createPlan(document, true).endTick, 96);
});

test('animation plan bounds frame count, source ticks and duration, even for extreme FPS', () => {
  const document = doc(timeline(1000000, [{ type: 'shape' }]));
  for (const frameRate of [1, 10, 23.976, 24, 60, 1000, NaN]) {
    document.frameRate = frameRate;
    const plan = createPlan(document, true);
    assert.ok(plan.samples.length <= 60);
    assert.ok(plan.endTick - plan.startTick <= 360);
    assert.ok(plan.samples.reduce((sum, sample) => sum + sample.delay, 0) <= 6000);
    assert.equal(plan.truncated, true);
  }
});

test('scene selection finds the earliest populated visible frame and skips guides', () => {
  const root = timeline(100, [{ type: 'shape' }], 50);
  root.layers.push({ visible: true, frames: [{ index: 12, duration: 88, elements: [{ type: 'shape' }] }] });
  root.layers.push({ visible: true, layerType: 'guide', frames: [{ index: 0, elements: [{ type: 'shape' }] }] });
  assert.equal(createPlan(doc(root), true).startTick, 12);
});

test('fixed union crop preserves movement, handles empty frames and bounds the whole output', () => {
  const pixels = new Uint8ClampedArray(100 * 80 * 4);
  assert.equal(alphaBounds(pixels, 100, 80), null);
  pixels[(7 * 100 + 2) * 4 + 3] = 255;
  pixels[(79 * 100 + 99) * 4 + 3] = 5;
  const bounds = alphaBounds(pixels, 100, 80);
  assert.deepEqual(bounds, { left: 2, top: 7, right: 99, bottom: 79 });
  assert.deepEqual(unionBounds(null, bounds), bounds);
  assert.deepEqual(unionBounds(bounds, { left: 0, top: 0, right: 1, bottom: 1 }), { left: 0, top: 0, right: 99, bottom: 79 });
  const crop = cropGeometry({ left: 0, top: 0, right: 1199, bottom: 1199 });
  assert.equal(crop.width, 640);
  assert.equal(crop.height, 640);
  assert.ok(crop.padding > 0);
});

test('selected crop limits support 2K while lower resolutions remain bounded', () => {
  const bounds = { left: 0, top: 0, right: 4095, bottom: 2047 };
  for (const maxSide of [256, 512, 1024, 2048]) {
    const geometry = cropGeometry(bounds, maxSide);
    assert.equal(geometry.width, maxSide);
    assert.ok(geometry.height <= maxSide);
  }
});

test('2K animated plans sample the complete six seconds within a total pixel budget', () => {
  const maxFrames = animationFrameLimit(2048);
  assert.ok(maxFrames >= 2 && maxFrames < 60);
  assert.ok(maxFrames * 2048 * 2048 <= MAX_TOTAL_PIXELS);
  const document = doc(timeline(144, [{ type: 'shape' }]));
  const plan = createPlan(document, true, { maxFrames });
  assert.ok(plan.samples.length <= maxFrames);
  assert.equal(plan.samples.reduce((sum, sample) => sum + sample.delay, 0), 6000);
  assert.ok(plan.samples.at(-1).tick > 100);
  assert.equal(plan.reducedSampling, true);
});

test('GIF accepts explicit 2K dimensions but caps total encoded pixels', () => {
  const encoder = createGIF({ maxSide: 2048, maxPixels: 4096 });
  const pixels = new Uint8ClampedArray(2048 * 4);
  encoder.append(pixels, 2048, 1, 100);
  encoder.append(pixels, 2048, 1, 100);
  assert.throws(() => encoder.append(pixels, 2048, 1, 100), /像素配额/);
  const bytes = Buffer.from(encoder.finish());
  assert.equal(bytes.readUInt16LE(6), 2048);
});

test('GIF encoder writes separate frames with looping, transparent clear disposal and timing', () => {
  const gif = createGIF();
  const frame = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]);
  gif.append(frame, 2, 1, 100);
  gif.append(new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 255, 255]), 2, 1, 200);
  const bytes = Buffer.from(gif.finish());
  assert.equal(bytes.subarray(0, 6).toString(), 'GIF89a');
  assert.equal(bytes.at(-1), 0x3b);
  assert.ok(bytes.includes(Buffer.from('NETSCAPE2.0')));
  const controls = [];
  for (let i = 0; i < bytes.length - 7; i++) if (bytes[i] === 0x21 && bytes[i + 1] === 0xf9 && bytes[i + 2] === 4) controls.push(bytes.subarray(i, i + 8));
  assert.equal(controls.length, 2);
  assert.deepEqual(controls.map(control => (control[3] >> 2) & 7), [2, 2]);
  assert.deepEqual(controls.map(control => control[3] & 1), [1, 1]);
  assert.deepEqual(controls.map(control => control.readUInt16LE(4)), [10, 20]);
});

test('GIF encoder rejects invalid pixels, changing dimensions and over-limit results', () => {
  assert.throws(() => createGIF().append(new Uint8Array(4), 641, 1, 100), /尺寸/);
  assert.throws(() => createGIF().append(new Uint8Array(1), 1, 1, 100), /像素/);
  assert.throws(() => createGIF().finish(), /没有帧/);
  const gif = createGIF({ maxFrames: 1 });
  gif.append(new Uint8Array(4), 1, 1, 100);
  assert.throws(() => gif.append(new Uint8Array(4), 1, 1, 100), /帧/);
  assert.throws(() => createGIF({ maxBytes: 10 }).append(new Uint8Array(4), 1, 1, 100), /大小/);
  const dimensions = createGIF();
  dimensions.append(new Uint8Array(4), 1, 1, 100);
  assert.throws(() => dimensions.append(new Uint8Array(8), 2, 1, 100), /尺寸/);
});
