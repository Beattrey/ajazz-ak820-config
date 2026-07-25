import { rgb888ToRgb565 } from "./rgb565";
import { SCREEN_WIDTH, SCREEN_HEIGHT, RGB565_FRAME_BYTES } from "../protocol/constants";

const SUPPORTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

// Bound input to keep a single bad file from OOM-crashing the tab. A 10 MB
// PNG can already decompress to several hundred MB of RGBA; anything larger
// is almost certainly a screenshot or a decompression bomb rather than
// something intended for a 128×128 TFT.
const MAX_FILE_SIZE = 10 * 1024 * 1024;

const RGBA_BYTES = SCREEN_WIDTH * SCREEN_HEIGHT * 4;

/**
 * How to fit a non-square source image into the 128×128 TFT.
 *  - "cover":   preserve aspect ratio, scale to fill, center-crop the overflow.
 *  - "contain": preserve aspect ratio, scale to fit entirely, black letterbox
 *               bars fill the remainder.
 * Neither mode ever stretches (distorts) the image.
 */
export type ResizeMode = "cover" | "contain";

export type PreparedStaticImage = {
  /** 32768-byte RGB565 little-endian buffer — exactly what uploadStaticImage expects. */
  rgb565: Uint8Array;
  sourceWidth: number;
  sourceHeight: number;
  mode: ResizeMode;
};

/**
 * Decode `file` locally (no network), compose it onto a 128×128 black canvas
 * using the chosen resize mode, flatten any transparency over black, and
 * convert to RGB565 little-endian — the identical pixel format validated for
 * the SAFE test pattern. Everything happens in-browser.
 */
export async function processStaticImage(
  file: File,
  mode: ResizeMode = "cover",
): Promise<PreparedStaticImage> {
  if (!SUPPORTED_TYPES.has(file.type)) {
    throw new Error(`processStaticImage: unsupported MIME type ${file.type}`);
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(
      `processStaticImage: file too large (${file.size} bytes, max ${MAX_FILE_SIZE})`,
    );
  }

  // Throws if the bytes are not a decodable image.
  const bitmap = await createImageBitmap(file);
  const sw = (bitmap as unknown as { width: number }).width;
  const sh = (bitmap as unknown as { height: number }).height;
  if (!(sw > 0) || !(sh > 0)) {
    throw new Error(`processStaticImage: invalid image dimensions ${sw}x${sh}`);
  }

  const canvas = new OffscreenCanvas(SCREEN_WIDTH, SCREEN_HEIGHT);
  const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D | null;
  if (!ctx) {
    throw new Error("processStaticImage: 2D context unavailable");
  }

  // Flatten over black FIRST: transparent/semi-transparent source pixels then
  // composite (source-over) onto black, and "contain" letterbox bars are black.
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

  // cover = scale to fill (crop overflow); contain = scale to fit (letterbox).
  const scale =
    mode === "cover"
      ? Math.max(SCREEN_WIDTH / sw, SCREEN_HEIGHT / sh)
      : Math.min(SCREEN_WIDTH / sw, SCREEN_HEIGHT / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  const dx = (SCREEN_WIDTH - dw) / 2;
  const dy = (SCREEN_HEIGHT - dh) / 2;
  ctx.drawImage(bitmap as unknown as CanvasImageSource, dx, dy, dw, dh);

  const imageData = ctx.getImageData(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
  if (imageData.data.length !== RGBA_BYTES) {
    throw new Error(
      `processStaticImage: RGBA buffer is ${imageData.data.length} bytes, expected ${RGBA_BYTES}`,
    );
  }

  const rgb565 = rgb888ToRgb565(imageData.data, SCREEN_WIDTH, SCREEN_HEIGHT, "le");
  if (rgb565.byteLength !== RGB565_FRAME_BYTES) {
    throw new Error(
      `processStaticImage: RGB565 buffer is ${rgb565.byteLength} bytes, expected ${RGB565_FRAME_BYTES}`,
    );
  }

  return { rgb565, sourceWidth: sw, sourceHeight: sh, mode };
}
