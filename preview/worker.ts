/* Copyright (c) 2026 安屿动画. Licensed under Apache-2.0; see NOTICE. */
import { FLAParser } from '../vendor/fla-viewer/fla-parser';
import { FLARenderer } from '../vendor/fla-viewer/renderer';
import { createPlan, alphaBounds, unionBounds, cropGeometry, animationFrameLimit, MAX_TOTAL_PIXELS } from './animation-plan.cjs';
import { createGIF } from './gif-encoder.cjs';
import { normalizePreviewResolution, previewSide } from '../core/preview-resolution.cjs';

type PreviewInput = { bytes: number[] | Uint8Array; animate?: boolean; warning?: string; previewResolution?: number | null };
type Bounds = { left: number; top: number; right: number; bottom: number };
type Sample = { tick: number; delay: number };
declare global {
  interface Window {
    previewWorker?: { input(): Promise<PreviewInput>; checkpoint?(result: unknown): void; done(result: unknown): void };
    renderPreview: (input: PreviewInput | number[], options?: { animate?: boolean; budgetMs?: number; previewResolution?: number | null }) => Promise<unknown>;
  }
}

function crop(stage: HTMLCanvasElement, bounds: Bounds, maxSide: number): HTMLCanvasElement {
  const geometry = cropGeometry(bounds, maxSide);
  const canvas = document.createElement('canvas');
  canvas.width = geometry.width; canvas.height = geometry.height;
  canvas.getContext('2d')!.drawImage(stage, geometry.left, geometry.top, geometry.sourceWidth, geometry.sourceHeight,
    geometry.padding, geometry.padding, geometry.drawWidth, geometry.drawHeight);
  return canvas;
}

function base64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let index = 0; index < bytes.length; index += 0x8000) chunks.push(String.fromCharCode(...bytes.subarray(index, index + 0x8000)));
  return btoa(chunks.join(''));
}

function samePixels(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return false;
  return true;
}

// Let Chromium deliver the static checkpoint before animation work starts.
const yieldFrame = () => new Promise<void>(resolve => setTimeout(resolve, 0));

window.renderPreview = async (rawInput, options = {}) => {
  const started = performance.now();
  const budget = Math.max(0, Math.min(35000, options.budgetMs ?? 35000));
  const input: PreviewInput = Array.isArray(rawInput) ? { bytes: rawInput, animate: options.animate, previewResolution: options.previewResolution } : rawInput;
  const animate = input.animate === true || options.animate === true;
  const resolution = normalizePreviewResolution(input.previewResolution);
  const maxSide = previewSide(resolution);
  const parser = new FLAParser();
  const doc = await parser.parse(new Uint8Array(input.bytes));
  if (!doc.timelines.length) throw new Error('FLA 没有可预览的场景');
  if (!Number.isFinite(doc.width) || !Number.isFinite(doc.height) || doc.width <= 0 || doc.height <= 0) throw new Error('无效舞台尺寸');
  const stage = document.querySelector<HTMLCanvasElement>('#stage')!;
  const stageLimit = resolution ?? 1200;
  const scale = Math.min(1, stageLimit / Math.max(doc.width, doc.height));
  stage.width = Math.max(1, Math.round(doc.width * scale));
  stage.height = Math.max(1, Math.round(doc.height * scale));
  doc.backgroundColor = 'rgba(0,0,0,0)';
  const renderer = new FLARenderer(stage);
  await renderer.setDocument(doc, true);
  renderer.setPreviewScale(scale);
  const plan = createPlan(doc, animate, { maxSide, maxFrames: animationFrameLimit(maxSide) });
  renderer.setCurrentScene(plan.scene);
  renderer.resetMovieClipPlayheads();
  const ctx = stage.getContext('2d', { willReadFrequently: true })!;
  const timedOut = () => performance.now() - started >= budget;
  let bounds: Bounds | null = null;
  let poster: HTMLCanvasElement | null = null;
  let firstPixels: Uint8ClampedArray | null = null;
  let changed = false, lastTick = plan.startTick - 1;
  let result: Record<string, unknown> | null = null;
  const makeResult = () => ({
    png: poster!.toDataURL('image/png'), width: doc.width, height: doc.height,
    frames: Math.max(...doc.timelines.map(timeline => timeline.totalFrames)), frameRate: plan.frameRate,
    scene: plan.scene, frame: plan.startTick, previewFormat: 'png', previewAnimated: false,
    previewFrameCount: 1, previewDurationMs: 0, previewWarning: input.warning ?? null,
  });
  const fallback = (warning?: string) => ({ ...result!, previewWarning: warning ?? result!.previewWarning });
  const renderTo = (tick: number) => {
    while (lastTick < tick) {
      const next = ++lastTick;
      // After the root timeline ends, its last frame holds while independently
      // playing MovieClips continue. Every source tick is rendered, including
      // ticks skipped by the 10fps output, so newly placed instances start right.
      renderer.renderFrame(Math.min(next, plan.rootFrames - 1));
      renderer.advanceMovieClipPlayheads();
      if (timedOut()) throw new Error('动图生成达到时间预算，已保留静态预览');
    }
  };

  try {
    for (let index = 0; index < plan.samples.length; index++) {
      const sample: Sample = plan.samples[index];
      // The first frame is always attempted even if parsing used the budget.
      if (index === 0) {
        renderer.renderFrame(Math.min(sample.tick, plan.rootFrames - 1));
        renderer.advanceMovieClipPlayheads(); lastTick = sample.tick;
      } else renderTo(sample.tick);
      const image = ctx.getImageData(0, 0, stage.width, stage.height);
      const visible = alphaBounds(image.data, stage.width, stage.height);
      bounds = unionBounds(bounds, visible);
      if (!firstPixels) firstPixels = new Uint8ClampedArray(image.data);
      else if (!changed) changed = !samePixels(firstPixels, image.data);
      if (!poster && visible) {
        poster = crop(stage, visible, maxSide); result = makeResult();
        window.previewWorker?.checkpoint?.(result);
        await yieldFrame();
      }
      if (animate && timedOut() && result) return fallback('动图生成达到时间预算，已保留静态预览');
      if (index % 5 === 0) await yieldFrame();
    }
    if (!poster || !bounds || !result) throw new Error('舞台为空，未找到可见素材；可以使用同名预览图');
    if (!animate || plan.samples.length < 2 || !changed) return result;

    renderer.resetMovieClipPlayheads(); lastTick = plan.startTick - 1;
    const geometry = cropGeometry(bounds, maxSide);
    const frame = document.createElement('canvas');
    frame.width = geometry.width; frame.height = geometry.height;
    const frameContext = frame.getContext('2d', { willReadFrequently: true })!;
    const gif = createGIF({ maxSide, maxFrames: plan.samples.length, maxPixels: MAX_TOTAL_PIXELS });
    for (const sample of plan.samples as Sample[]) {
      renderTo(sample.tick);
      frameContext.clearRect(0, 0, frame.width, frame.height);
      frameContext.drawImage(stage, geometry.left, geometry.top, geometry.sourceWidth, geometry.sourceHeight,
        geometry.padding, geometry.padding, geometry.drawWidth, geometry.drawHeight);
      if (timedOut()) return fallback('动图生成达到时间预算，已保留静态预览');
      gif.append(frameContext.getImageData(0, 0, frame.width, frame.height).data, frame.width, frame.height, sample.delay);
      await yieldFrame();
    }
    const encoded = gif.finish();
    if (timedOut()) return fallback('动图生成达到时间预算，已保留静态预览');
    return { ...result, gif: 'data:image/gif;base64,' + base64(encoded), previewFormat: 'gif', previewAnimated: true,
      previewFrameCount: plan.samples.length, previewDurationMs: plan.samples.reduce((sum: number, sample: Sample) => sum + sample.delay, 0),
      previewWarning: [plan.truncated ? '动图仅预览开头最多 6 秒，较长素材已截取' : null,
        plan.reducedSampling ? `${maxSide === 2048 ? '2K' : maxSide + ' 像素'}动图已降低预览帧率以控制内存，保留所选分辨率` : null].filter(Boolean).join('；') || null };
  } catch (error) {
    if (result) return fallback(String((error as Error).message || error).slice(0, 300));
    throw error;
  }
};

if (window.previewWorker) window.previewWorker.input().then(input => window.renderPreview(input))
  .then(result => window.previewWorker!.done(result))
  .catch(error => window.previewWorker!.done({ error: String(error.message || error) }));
