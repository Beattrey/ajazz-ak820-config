import { parseGIF, decompressFrames } from "gifuct-js";
import { rgb888ToRgb565 } from "./rgb565";
import { SCREEN_WIDTH, SCREEN_HEIGHT } from "../protocol/constants";
import type { ResizeMode } from "./static";

export type AnimatedImage = {
  frames: Uint8Array[];
  delaysMs: number[];
  sourceWidth: number;
  sourceHeight: number;
  mode: ResizeMode;
};

export type DecodedGifFrame = {
  dims: { left: number; top: number; width: number; height: number };
  patch: Uint8ClampedArray;
  disposalType: number;
  delay: number;
  transparentIndex?: number;
};

export type RasterizedFrame = {
  rgba: Uint8ClampedArray;
  delayMs: number;
};

/**
 * Compose a sequence of GIF frame patches onto a persistent full-canvas
 * RGBA buffer and emit a snapshot per frame, honoring per-pixel
 * transparency and GIF disposal methods.
 *
 * Disposal: 0/1 keep canvas, 2 restores prev frame's rect to background,
 * 3 restores to canvas state before prev frame was drawn.
 *
 * Why: gifuct-js's `patch` stores transparent pixels with alpha=0 but RGB
 * equal to colorTable[transparentIndex] (not zero). A 4-byte bulk copy
 * overwrites the previous frame's RGB with that placeholder, which then
 * renders as a solid blocky color in the RGB565 output. Spec-correct
 * compositing skips alpha=0 pixels entirely.
 */
export function* rasterizeGifFrames(
  decoded: readonly DecodedGifFrame[],
  canvasWidth: number,
  canvasHeight: number,
  backgroundRgba: readonly [number, number, number, number],
): Generator<RasterizedFrame, void, undefined> {
  const composite = new Uint8ClampedArray(canvasWidth * canvasHeight * 4);

  let prevDisposal = 0;
  let prevDims: DecodedGifFrame["dims"] | null = null;
  let prevSnapshot: Uint8ClampedArray | null = null;

  for (const frame of decoded) {
    if (prevDisposal === 2 && prevDims) {
      fillRect(composite, canvasWidth, prevDims, backgroundRgba);
    } else if (prevDisposal === 3 && prevSnapshot) {
      composite.set(prevSnapshot);
    }

    prevSnapshot =
      frame.disposalType === 3 ? new Uint8ClampedArray(composite) : null;

    const { left, top, width, height } = frame.dims;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const srcIdx = (y * width + x) * 4;
        if (frame.patch[srcIdx + 3] === 0) continue;
        const dstIdx = ((top + y) * canvasWidth + (left + x)) * 4;
        composite[dstIdx] = frame.patch[srcIdx];
        composite[dstIdx + 1] = frame.patch[srcIdx + 1];
        composite[dstIdx + 2] = frame.patch[srcIdx + 2];
        composite[dstIdx + 3] = 255;
      }
    }

    // Yield a fresh copy so the caller can hold the buffer past the next
    // iteration; streaming consumers (production path) drop the reference
    // immediately and GC reclaims before the next yield, keeping peak
    // memory at ~3 * canvas_pixels regardless of frame count.
    yield {
      rgba: new Uint8ClampedArray(composite),
      delayMs: frame.delay > 0 ? frame.delay : 100,
    };

    prevDisposal = frame.disposalType ?? 0;
    prevDims = frame.dims;
  }
}

function fillRect(
  buffer: Uint8ClampedArray,
  bufferWidth: number,
  rect: { left: number; top: number; width: number; height: number },
  color: readonly [number, number, number, number],
): void {
  for (let y = 0; y < rect.height; y++) {
    for (let x = 0; x < rect.width; x++) {
      const idx = ((rect.top + y) * bufferWidth + (rect.left + x)) * 4;
      buffer[idx] = color[0];
      buffer[idx + 1] = color[1];
      buffer[idx + 2] = color[2];
      buffer[idx + 3] = color[3];
    }
  }
}

/**
 * Nearest-neighbour resize from a source RGBA buffer to SCREEN_WIDTH ×
 * SCREEN_HEIGHT RGBA, preserving aspect ratio.
 *
 *  - "cover":   scale to fill, center-crop the overflow (clamp to edge).
 *  - "contain": scale to fit entirely, black letterbox bars fill the rest.
 *
 * Neither mode stretches. This avoids canvas-to-canvas drawImage, which is
 * broken in the jsdom + node-canvas test environment (node-canvas drawImage
 * only accepts a real Canvas / Image, not the OffscreenCanvas polyfill).
 */
function resizeRgba(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  mode: ResizeMode,
): Uint8ClampedArray {
  const dstW = SCREEN_WIDTH;
  const dstH = SCREEN_HEIGHT;

  const scale =
    mode === "cover"
      ? Math.max(dstW / srcW, dstH / srcH)
      : Math.min(dstW / srcW, dstH / srcH);
  const scaledW = srcW * scale;
  const scaledH = srcH * scale;
  const offX = (dstW - scaledW) / 2;
  const offY = (dstH - scaledH) / 2;

  const dst = new Uint8ClampedArray(dstW * dstH * 4);

  for (let dy = 0; dy < dstH; dy++) {
    for (let dx = 0; dx < dstW; dx++) {
      const dstIdx = (dy * dstW + dx) * 4;
      const sx = Math.round((dx - offX) / scale);
      const sy = Math.round((dy - offY) / scale);

      if (mode === "contain" && (sx < 0 || sx >= srcW || sy < 0 || sy >= srcH)) {
        // Letterbox bar: opaque black.
        dst[dstIdx + 3] = 255;
        continue;
      }
      const cx = Math.max(0, Math.min(srcW - 1, sx));
      const cy = Math.max(0, Math.min(srcH - 1, sy));
      const srcIdx = (cy * srcW + cx) * 4;
      dst[dstIdx] = src[srcIdx];
      dst[dstIdx + 1] = src[srcIdx + 1];
      dst[dstIdx + 2] = src[srcIdx + 2];
      dst[dstIdx + 3] = src[srcIdx + 3];
    }
  }
  return dst;
}

// Bounds against decompression-bomb GIFs. With streaming rasterization,
// the dominant memory factor is gifuct-js's decompressFrames step which
// holds *every* frame's RGBA patch simultaneously (sum of per-frame
// descriptor.width × height). 50M patch pixels ≈ 200 MB during that step,
// freed once we start streaming.
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_GIF_DIMENSION = 2048;
// Conservative first-test cap: the AK820 Pro animated protocol tolerates more,
// but small/short GIFs keep the first real uploads safe and quick to verify.
const MAX_GIF_FRAMES = 20;
const MAX_PATCH_PIXELS = 50_000_000;

export async function processAnimatedImage(
  file: File,
  mode: ResizeMode = "cover",
): Promise<AnimatedImage> {
  if (file.type !== "image/gif") {
    throw new Error(`processAnimatedImage: expected image/gif, got ${file.type}`);
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(
      `processAnimatedImage: file too large (${file.size} bytes, max ${MAX_FILE_SIZE})`,
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const gif = parseGIF(arrayBuffer);

  if (gif.lsd.width > MAX_GIF_DIMENSION || gif.lsd.height > MAX_GIF_DIMENSION) {
    throw new Error(
      `processAnimatedImage: canvas ${gif.lsd.width}x${gif.lsd.height} exceeds max ${MAX_GIF_DIMENSION}`,
    );
  }

  // CRITICAL: bound per-frame descriptor dims *before* decompressFrames.
  // gifuct's LZW decoder allocates a pixel array of size
  // descriptor.width × descriptor.height per frame; a malicious GIF can
  // advertise huge per-frame dims independent of the LSD canvas and OOM
  // the tab during decompression.
  let frameCount = 0;
  let totalPatchPixels = 0;
  for (const f of gif.frames) {
    if (!("image" in f)) continue;
    const { width, height } = f.image.descriptor;
    if (width > MAX_GIF_DIMENSION || height > MAX_GIF_DIMENSION) {
      throw new Error(
        `processAnimatedImage: frame descriptor ${width}x${height} exceeds max ${MAX_GIF_DIMENSION}`,
      );
    }
    frameCount++;
    totalPatchPixels += width * height;
  }
  if (frameCount === 0) {
    throw new Error("processAnimatedImage: GIF has no frames");
  }
  if (frameCount > MAX_GIF_FRAMES) {
    throw new Error(
      `processAnimatedImage: ${frameCount} frames exceed max ${MAX_GIF_FRAMES}`,
    );
  }
  if (totalPatchPixels > MAX_PATCH_PIXELS) {
    throw new Error(
      `processAnimatedImage: total patch pixels ${totalPatchPixels} exceed max ${MAX_PATCH_PIXELS}`,
    );
  }

  const decoded = decompressFrames(gif, /* buildPatch */ true);

  // Background for disposal=2 cleanup: GCT[backgroundColorIndex] when the
  // GIF has no transparency; otherwise treat background as transparent
  // (matches browser decoder behaviour for transparent GIFs).
  const hasTransparency = decoded.some((f) => f.transparentIndex !== undefined);
  let bg: [number, number, number, number] = [0, 0, 0, 0];
  if (!hasTransparency && gif.gct && gif.gct[gif.lsd.backgroundColorIndex]) {
    const [r, g, b] = gif.gct[gif.lsd.backgroundColorIndex];
    bg = [r, g, b, 255];
  }

  const composed = rasterizeGifFrames(decoded, gif.lsd.width, gif.lsd.height, bg);

  const frames: Uint8Array[] = [];
  const delaysMs: number[] = [];

  for (const { rgba, delayMs } of composed) {
    const resized = resizeRgba(rgba, gif.lsd.width, gif.lsd.height, mode);
    frames.push(rgb888ToRgb565(resized, SCREEN_WIDTH, SCREEN_HEIGHT, "le"));
    delaysMs.push(delayMs);
  }

  return {
    frames,
    delaysMs,
    sourceWidth: gif.lsd.width,
    sourceHeight: gif.lsd.height,
    mode,
  };
}
