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

describe("processStaticImage", () => {
  test("solid-red 200x100 PNG → 32768-byte buffer of 0x00 0xF8 pixels", async () => {
    const pngBytes = makeSolidColorPng(200, 100, 255, 0, 0);
    const file = new File([pngBytes], "red.png", { type: "image/png" });

    const out = await processStaticImage(file);

    expect(out.byteLength).toBe(RGB565_FRAME_BYTES);
    // Every pixel should be (255, 0, 0) → RGB565 little-endian = 0x00, 0xF8.
    for (let i = 0; i < out.byteLength; i += 2) {
      expect(out[i]).toBe(0x00);
      expect(out[i + 1]).toBe(0xf8);
    }
  });

  test("output is always 128x128*2 bytes regardless of input dimensions", async () => {
    const pngBytes = makeSolidColorPng(1000, 50, 0, 255, 0);
    const file = new File([pngBytes], "green.png", { type: "image/png" });

    const out = await processStaticImage(file);

    expect(out.byteLength).toBe(SCREEN_WIDTH * SCREEN_HEIGHT * 2);
  });

  test("rejects unsupported MIME type", async () => {
    const file = new File([new Uint8Array(10)], "bad.txt", { type: "text/plain" });
    await expect(processStaticImage(file)).rejects.toThrow(/unsupported/i);
  });

  test("rejects files larger than 10 MB", async () => {
    // 11 MB of zero-filled bytes — no need to actually be a valid PNG, the
    // size check runs before any decoding.
    const big = new Uint8Array(11 * 1024 * 1024);
    const file = new File([big], "huge.png", { type: "image/png" });
    await expect(processStaticImage(file)).rejects.toThrow(/too large/i);
  });
});
