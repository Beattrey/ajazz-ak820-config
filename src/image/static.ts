import { rgb888ToRgb565 } from "./rgb565";
import { SCREEN_WIDTH, SCREEN_HEIGHT } from "../protocol/constants";

const SUPPORTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

// Bound input to keep a single bad file from OOM-crashing the tab. A 10 MB
// PNG can already decompress to several hundred MB of RGBA; anything larger
// is almost certainly a screenshot or a decompression bomb rather than
// something intended for a 128×128 TFT.
const MAX_FILE_SIZE = 10 * 1024 * 1024;

export async function processStaticImage(file: File): Promise<Uint8Array> {
  if (!SUPPORTED_TYPES.has(file.type)) {
    throw new Error(`processStaticImage: unsupported MIME type ${file.type}`);
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(
      `processStaticImage: file too large (${file.size} bytes, max ${MAX_FILE_SIZE})`,
    );
  }

  const bitmap = await createImageBitmap(file);
  const canvas = new OffscreenCanvas(SCREEN_WIDTH, SCREEN_HEIGHT);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("processStaticImage: 2D context unavailable");
  }

  // Cover + center crop: scale so the shorter side fills the canvas,
  // then center the longer side.
  const sw = (bitmap as unknown as { width: number }).width;
  const sh = (bitmap as unknown as { height: number }).height;
  const scale = Math.max(SCREEN_WIDTH / sw, SCREEN_HEIGHT / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  const dx = (SCREEN_WIDTH - dw) / 2;
  const dy = (SCREEN_HEIGHT - dh) / 2;
  (ctx as unknown as CanvasRenderingContext2D).drawImage(
    bitmap as unknown as CanvasImageSource,
    dx,
    dy,
    dw,
    dh,
  );

  const imageData = (ctx as unknown as CanvasRenderingContext2D).getImageData(
    0,
    0,
    SCREEN_WIDTH,
    SCREEN_HEIGHT,
  );
  return rgb888ToRgb565(imageData.data, SCREEN_WIDTH, SCREEN_HEIGHT, "le");
}
