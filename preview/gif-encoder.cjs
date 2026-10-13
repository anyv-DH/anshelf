/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
const { GIFEncoder, quantize, applyPalette } = require('gifenc');

const MAX_BYTES = 32 * 1024 * 1024;
const MAX_FRAMES = 60;
const MAX_SIDE = 2048;
const MAX_TOTAL_PIXELS = 24 * 1024 * 1024;

function createGIF({ maxBytes = MAX_BYTES, maxFrames = MAX_FRAMES, maxSide = 640, maxPixels = MAX_TOTAL_PIXELS } = {}) {
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_BYTES || !Number.isInteger(maxFrames) || maxFrames < 1 || maxFrames > MAX_FRAMES
    || !Number.isInteger(maxSide) || maxSide < 1 || maxSide > MAX_SIDE || !Number.isInteger(maxPixels) || maxPixels < 1 || maxPixels > MAX_TOTAL_PIXELS) throw new Error('GIF 配额无效');
  const encoder = GIFEncoder();
  let count = 0, totalPixels = 0, dimensions = null, finished = false;
  return {
    append(rgba, width, height, delay) {
      if (finished) throw new Error('GIF 已完成');
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > maxSide || height > maxSide
        || (dimensions && (dimensions.width !== width || dimensions.height !== height))) throw new Error('GIF 尺寸无效');
      if (!(rgba instanceof Uint8Array || rgba instanceof Uint8ClampedArray) || rgba.length !== width * height * 4) throw new Error('GIF 像素数据无效');
      if (!Number.isFinite(delay) || delay < 20 || delay > 6000) throw new Error('GIF 帧间隔无效');
      if (count >= maxFrames) throw new Error('GIF 帧数超过配额');
      if (totalPixels + width * height > maxPixels) throw new Error('GIF 像素配额超过限制');
      const colors = quantize(rgba, 255, { format: 'rgb565' });
      const mapped = applyPalette(rgba, colors, 'rgb565');
      // Reserve index zero for transparency. Full-frame clear disposal prevents
      // old particles/poses from persisting after they disappear.
      const indexed = new Uint8Array(mapped.length);
      for (let i = 0; i < indexed.length; i++) indexed[i] = rgba[i * 4 + 3] <= 16 ? 0 : mapped[i] + 1;
      encoder.writeFrame(indexed, width, height, {
        palette: [[0, 0, 0], ...colors], delay, repeat: 0,
        transparent: true, transparentIndex: 0, dispose: 2,
      });
      dimensions = { width, height }; count++; totalPixels += width * height;
      if (encoder.bytesView().length > maxBytes) throw new Error('GIF 大小超过配额');
    },
    finish() {
      if (!count) throw new Error('GIF 没有帧');
      if (!finished) { encoder.finish(); finished = true; }
      const bytes = encoder.bytesView();
      if (bytes.length > maxBytes) throw new Error('GIF 大小超过配额');
      return bytes;
    },
  };
}

module.exports = { createGIF, MAX_BYTES, MAX_FRAMES };
