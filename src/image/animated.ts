import { decompressFrames, parseGIF } from "gifuct-js";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../protocol/constants";
import { containResizeRgba } from "./resize";
import { rgb888ToRgb565 } from "./rgb565";

export type AnimatedImage = {
  frames: Uint8Array[];
  delaysMs: number[];
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

    prevSnapshot = frame.disposalType === 3 ? new Uint8ClampedArray(composite) : null;

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

// Bounds against decompression-bomb GIFs. With streaming rasterization,
// the dominant memory factor is gifuct-js's decompressFrames step which
// holds *every* frame's RGBA patch simultaneously (sum of per-frame
// descriptor.width × height). 50M patch pixels ≈ 200 MB during that step,
// freed once we start streaming.
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_GIF_DIMENSION = 2048;
const MAX_GIF_FRAMES = 256;
const MAX_PATCH_PIXELS = 50_000_000;

type WebPInfo = {
  animated: boolean;
  width?: number;
  height?: number;
  frameCount: number;
};

type DecodedWebPFrame = {
  image: CanvasImageSource & {
    displayWidth: number;
    displayHeight: number;
    duration: number | null;
    close(): void;
  };
};

type BrowserImageDecoder = {
  tracks: {
    ready: Promise<void>;
    selectedTrack: { frameCount: number } | null;
  };
  decode(options: { frameIndex: number; completeFramesOnly: boolean }): Promise<DecodedWebPFrame>;
  close(): void;
};

type BrowserImageDecoderConstructor = new (options: {
  data: ArrayBuffer;
  type: string;
}) => BrowserImageDecoder;

/** Inspect the WebP RIFF container without decoding its potentially large pixels. */
export function inspectWebP(data: ArrayBuffer): WebPInfo {
  const bytes = new Uint8Array(data);
  const view = new DataView(data);
  const fourCc = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (bytes.length < 12 || fourCc(0) !== "RIFF" || fourCc(8) !== "WEBP") {
    throw new Error("processAnimatedImage: invalid WebP container");
  }

  let animated = false;
  let frameCount = 0;
  let width: number | undefined;
  let height: number | undefined;
  for (let offset = 12; offset + 8 <= bytes.length; ) {
    const kind = fourCc(offset);
    const size = view.getUint32(offset + 4, true);
    const payload = offset + 8;
    if (payload + size > bytes.length) {
      throw new Error("processAnimatedImage: truncated WebP chunk");
    }
    if (kind === "VP8X" && size >= 10) {
      animated ||= (bytes[payload] & 0x02) !== 0;
      width = 1 + bytes[payload + 4] + (bytes[payload + 5] << 8) + (bytes[payload + 6] << 16);
      height =
        1 + bytes[payload + 7] + (bytes[payload + 8] << 8) + (bytes[payload + 9] << 16);
    } else if (kind === "ANIM") {
      animated = true;
    } else if (kind === "ANMF") {
      animated = true;
      frameCount++;
    }
    offset = payload + size + (size & 1);
  }
  return { animated, width, height, frameCount };
}

export async function isAnimatedWebP(file: File): Promise<boolean> {
  if (file.type !== "image/webp") return false;
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(
      `processAnimatedImage: file too large (${file.size} bytes, max ${MAX_FILE_SIZE})`,
    );
  }
  return inspectWebP(await file.arrayBuffer()).animated;
}

export async function processAnimatedImage(file: File): Promise<AnimatedImage> {
  if (file.type !== "image/gif" && file.type !== "image/webp") {
    throw new Error(`processAnimatedImage: expected image/gif or image/webp, got ${file.type}`);
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(
      `processAnimatedImage: file too large (${file.size} bytes, max ${MAX_FILE_SIZE})`,
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  if (file.type === "image/webp") return processAnimatedWebP(arrayBuffer);

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
    throw new Error(`processAnimatedImage: ${frameCount} frames exceed max ${MAX_GIF_FRAMES}`);
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
    const resized = containResizeRgba(
      rgba,
      gif.lsd.width,
      gif.lsd.height,
      SCREEN_WIDTH,
      SCREEN_HEIGHT,
    );
    frames.push(rgb888ToRgb565(resized, SCREEN_WIDTH, SCREEN_HEIGHT, "le"));
    delaysMs.push(delayMs);
  }

  return { frames, delaysMs };
}

async function processAnimatedWebP(arrayBuffer: ArrayBuffer): Promise<AnimatedImage> {
  const info = inspectWebP(arrayBuffer);
  if (!info.animated) throw new Error("processAnimatedImage: WebP is not animated");
  if (
    (info.width !== undefined && info.width > MAX_GIF_DIMENSION) ||
    (info.height !== undefined && info.height > MAX_GIF_DIMENSION)
  ) {
    throw new Error(
      `processAnimatedImage: canvas ${info.width}x${info.height} exceeds max ${MAX_GIF_DIMENSION}`,
    );
  }
  if (info.frameCount === 0) throw new Error("processAnimatedImage: WebP has no frames");
  if (info.frameCount > MAX_GIF_FRAMES) {
    throw new Error(`processAnimatedImage: ${info.frameCount} frames exceed max ${MAX_GIF_FRAMES}`);
  }

  const ImageDecoderClass = (globalThis as unknown as { ImageDecoder?: BrowserImageDecoderConstructor })
    .ImageDecoder;
  if (!ImageDecoderClass) {
    throw new Error("Animated WebP requires a browser with the WebCodecs ImageDecoder API");
  }

  const decoder = new ImageDecoderClass({ data: arrayBuffer, type: "image/webp" });
  const frames: Uint8Array[] = [];
  const delaysMs: number[] = [];
  try {
    await decoder.tracks.ready;
    const decoderFrameCount = decoder.tracks.selectedTrack?.frameCount ?? 0;
    if (decoderFrameCount === 0) throw new Error("processAnimatedImage: WebP has no frames");
    if (decoderFrameCount > MAX_GIF_FRAMES) {
      throw new Error(
        `processAnimatedImage: ${decoderFrameCount} frames exceed max ${MAX_GIF_FRAMES}`,
      );
    }

    for (let frameIndex = 0; frameIndex < decoderFrameCount; frameIndex++) {
      const { image } = await decoder.decode({ frameIndex, completeFramesOnly: true });
      try {
        const width = image.displayWidth;
        const height = image.displayHeight;
        if (width > MAX_GIF_DIMENSION || height > MAX_GIF_DIMENSION) {
          throw new Error(
            `processAnimatedImage: decoded frame ${width}x${height} exceeds max ${MAX_GIF_DIMENSION}`,
          );
        }
        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D | null;
        if (!ctx) throw new Error("processAnimatedImage: 2D context unavailable");
        ctx.drawImage(image, 0, 0);
        const rgba = ctx.getImageData(0, 0, width, height).data;
        const resized = containResizeRgba(rgba, width, height, SCREEN_WIDTH, SCREEN_HEIGHT);
        frames.push(rgb888ToRgb565(resized, SCREEN_WIDTH, SCREEN_HEIGHT, "le"));
        delaysMs.push(image.duration && image.duration > 0 ? image.duration / 1000 : 100);
      } finally {
        image.close();
      }
    }
  } finally {
    decoder.close();
  }
  return { frames, delaysMs };
}
