import { rgb888ToRgb565 } from "./rgb565";
import { SCREEN_WIDTH, SCREEN_HEIGHT } from "../protocol/constants";

/**
 * Generates a simple RGBA test pattern for dry-run / protocol verification:
 * a black background with a centered white square. Pure computation, no device
 * I/O and no canvas — safe to run without a connected keyboard.
 *
 * Returned buffer is width*height*4 bytes (RGBA, 8 bits/channel), i.e. exactly
 * the shape `rgb888ToRgb565` expects, so the dry-run exercises the real
 * conversion + chunking pipeline.
 */
export function generateTestPatternRgba(
  width: number,
  height: number,
  squareSize: number,
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(width * height * 4);
  const x0 = Math.floor((width - squareSize) / 2);
  const y0 = Math.floor((height - squareSize) / 2);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const inSquare = x >= x0 && x < x0 + squareSize && y >= y0 && y < y0 + squareSize;
      const v = inSquare ? 255 : 0;
      rgba[i] = v; // R
      rgba[i + 1] = v; // G
      rgba[i + 2] = v; // B
      rgba[i + 3] = 255; // A
    }
  }
  return rgba;
}

/**
 * Two-frame SAFE animation for dry-run / protocol verification:
 * frame 0 = fully black, frame 1 = fully white, 200 ms each. Returns RGB565
 * little-endian frames (32768 bytes each) — exactly the shape that
 * uploadAnimatedImage / buildAnimatedDataChunks expect. Pure computation,
 * no device I/O. Reuses the validated rgb888ToRgb565 converter.
 */
export function generateTwoFrameAnimation(): { frames: Uint8Array[]; delaysMs: number[] } {
  const px = SCREEN_WIDTH * SCREEN_HEIGHT;
  const black = new Uint8ClampedArray(px * 4);
  const white = new Uint8ClampedArray(px * 4);
  for (let i = 0; i < px; i++) {
    black[i * 4 + 3] = 255; // opaque black (RGB 0,0,0)
    white[i * 4] = 255;
    white[i * 4 + 1] = 255;
    white[i * 4 + 2] = 255;
    white[i * 4 + 3] = 255;
  }
  return {
    frames: [
      rgb888ToRgb565(black, SCREEN_WIDTH, SCREEN_HEIGHT, "le"),
      rgb888ToRgb565(white, SCREEN_WIDTH, SCREEN_HEIGHT, "le"),
    ],
    delaysMs: [200, 200],
  };
}
