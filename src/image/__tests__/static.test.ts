import { describe, expect, test } from "vitest";
import { createCanvas } from "canvas";
import { processStaticImage } from "../static";
import { RGB565_FRAME_BYTES, SCREEN_WIDTH, SCREEN_HEIGHT } from "../../protocol/constants";

function makeSolidColorPng(width: number, height: number, r: number, g: number, b: number): Uint8Array {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fillRect(0, 0, width, height);
  return new Uint8Array(canvas.toBuffer("image/png"));
}

// Fully transparent (alpha 0) RGBA PNG — leaves the canvas untouched so the
// black flatten background shows through.
function makeTransparentPng(width: number, height: number): Uint8Array {
  const canvas = createCanvas(width, height);
  // Do not draw anything: canvas starts fully transparent.
  return new Uint8Array(canvas.toBuffer("image/png"));
}

// Read the RGB565 little-endian value at pixel (x, y).
function pixelAt(buf: Uint8Array, x: number, y: number): number {
  const i = (y * SCREEN_WIDTH + x) * 2;
  return buf[i] | (buf[i + 1] << 8);
}

const RED565 = 0xf800; // (255,0,0) in RGB565
const BLACK565 = 0x0000;

describe("processStaticImage", () => {
  test("solid-red 200x100 PNG (cover) → 32768-byte buffer of 0x00 0xF8 pixels", async () => {
    const pngBytes = makeSolidColorPng(200, 100, 255, 0, 0);
    const file = new File([pngBytes], "red.png", { type: "image/png" });

    const { rgb565, sourceWidth, sourceHeight, mode } = await processStaticImage(file);

    expect(rgb565.byteLength).toBe(RGB565_FRAME_BYTES);
    expect(sourceWidth).toBe(200);
    expect(sourceHeight).toBe(100);
    expect(mode).toBe("cover");
    // Cover fills the whole canvas → every pixel is red (0x00, 0xF8 LE).
    for (let i = 0; i < rgb565.byteLength; i += 2) {
      expect(rgb565[i]).toBe(0x00);
      expect(rgb565[i + 1]).toBe(0xf8);
    }
  });

  test("output is always 128x128*2 bytes regardless of input dimensions", async () => {
    const pngBytes = makeSolidColorPng(1000, 50, 0, 255, 0);
    const file = new File([pngBytes], "green.png", { type: "image/png" });

    const { rgb565 } = await processStaticImage(file);

    expect(rgb565.byteLength).toBe(SCREEN_WIDTH * SCREEN_HEIGHT * 2);
  });

  test("always produces exactly 32768 bytes = 9 chunks × 4096 minus padding math", async () => {
    const { rgb565 } = await processStaticImage(
      new File([makeSolidColorPng(64, 64, 10, 20, 30)], "s.png", { type: "image/png" }),
    );
    expect(rgb565.byteLength).toBe(32768);
    // 32768 pixel bytes + 256-ish? No header in gohv static path: 32768 → padded
    // to 9*4096 = 36864 by buildImageDataChunks (covered in operations tests).
  });

  test("square image: cover and contain both fill fully (no bars)", async () => {
    const png = makeSolidColorPng(100, 100, 255, 0, 0);
    const cover = await processStaticImage(new File([png], "sq.png", { type: "image/png" }), "cover");
    const contain = await processStaticImage(new File([png], "sq.png", { type: "image/png" }), "contain");
    // Corners are red in both modes (square scales to exactly 128×128).
    expect(pixelAt(cover.rgb565, 0, 0)).toBe(RED565);
    expect(pixelAt(cover.rgb565, 127, 127)).toBe(RED565);
    expect(pixelAt(contain.rgb565, 0, 0)).toBe(RED565);
    expect(pixelAt(contain.rgb565, 127, 127)).toBe(RED565);
  });

  test("horizontal image contain: black bars top and bottom, red band in the middle", async () => {
    // 200x100 → contain scale = min(0.64, 1.28) = 0.64 → 128x64, centered dy=32.
    const png = makeSolidColorPng(200, 100, 255, 0, 0);
    const { rgb565 } = await processStaticImage(
      new File([png], "h.png", { type: "image/png" }),
      "contain",
    );
    expect(pixelAt(rgb565, 64, 0)).toBe(BLACK565); // top bar
    expect(pixelAt(rgb565, 64, 127)).toBe(BLACK565); // bottom bar
    expect(pixelAt(rgb565, 64, 64)).toBe(RED565); // centre band
  });

  test("horizontal image cover: fills fully, no black bars", async () => {
    const png = makeSolidColorPng(200, 100, 255, 0, 0);
    const { rgb565 } = await processStaticImage(
      new File([png], "h.png", { type: "image/png" }),
      "cover",
    );
    expect(pixelAt(rgb565, 64, 0)).toBe(RED565);
    expect(pixelAt(rgb565, 64, 127)).toBe(RED565);
  });

  test("vertical image contain: black bars left and right, red band in the middle", async () => {
    // 100x200 → contain scale = min(1.28, 0.64) = 0.64 → 64x128, centered dx=32.
    const png = makeSolidColorPng(100, 200, 255, 0, 0);
    const { rgb565 } = await processStaticImage(
      new File([png], "v.png", { type: "image/png" }),
      "contain",
    );
    expect(pixelAt(rgb565, 0, 64)).toBe(BLACK565); // left bar
    expect(pixelAt(rgb565, 127, 64)).toBe(BLACK565); // right bar
    expect(pixelAt(rgb565, 64, 64)).toBe(RED565); // centre band
  });

  test("vertical image cover: fills fully, no black bars", async () => {
    const png = makeSolidColorPng(100, 200, 255, 0, 0);
    const { rgb565 } = await processStaticImage(
      new File([png], "v.png", { type: "image/png" }),
      "cover",
    );
    expect(pixelAt(rgb565, 0, 64)).toBe(RED565);
    expect(pixelAt(rgb565, 127, 64)).toBe(RED565);
  });

  test("transparent PNG is flattened onto black (all pixels black, none left transparent)", async () => {
    const png = makeTransparentPng(128, 128);
    const { rgb565 } = await processStaticImage(
      new File([png], "t.png", { type: "image/png" }),
      "cover",
    );
    expect(rgb565.byteLength).toBe(RGB565_FRAME_BYTES);
    for (let i = 0; i < rgb565.byteLength; i += 2) {
      expect(rgb565[i]).toBe(0x00);
      expect(rgb565[i + 1]).toBe(0x00);
    }
  });

  test("rejects unsupported MIME type", async () => {
    const file = new File([new Uint8Array(10)], "bad.txt", { type: "text/plain" });
    await expect(processStaticImage(file)).rejects.toThrow(/unsupported/i);
  });

  test("rejects files larger than 10 MB", async () => {
    const big = new Uint8Array(11 * 1024 * 1024);
    const file = new File([big], "huge.png", { type: "image/png" });
    await expect(processStaticImage(file)).rejects.toThrow(/too large/i);
  });
});
