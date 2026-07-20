import { createCanvas } from "canvas";
import { describe, expect, test } from "vitest";
import { RGB565_FRAME_BYTES, SCREEN_HEIGHT, SCREEN_WIDTH } from "../../protocol/constants";
import { processStaticImage } from "../static";

function makeSolidColorPng(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
): Uint8Array {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fillRect(0, 0, width, height);
  return new Uint8Array(canvas.toBuffer("image/png"));
}

function makePortraitEdgeMarkerPng(): Uint8Array {
  const canvas = createCanvas(50, 100);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgb(0,255,0)";
  ctx.fillRect(0, 0, 50, 100);
  ctx.fillStyle = "rgb(255,0,0)";
  ctx.fillRect(0, 0, 50, 10);
  ctx.fillStyle = "rgb(0,0,255)";
  ctx.fillRect(0, 90, 50, 10);
  return new Uint8Array(canvas.toBuffer("image/png"));
}

function makeTransparentPortraitPng(): Uint8Array {
  const canvas = createCanvas(50, 100);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgb(255,0,0)";
  ctx.fillRect(10, 10, 30, 80);
  return new Uint8Array(canvas.toBuffer("image/png"));
}

function rgb565At(buffer: Uint8Array, x: number, y: number): number {
  const offset = (y * SCREEN_WIDTH + x) * 2;
  return (buffer[offset + 1] << 8) | buffer[offset];
}

describe("processStaticImage", () => {
  test("solid-red 200x100 PNG uses red for its fitted padding", async () => {
    const pngBytes = makeSolidColorPng(200, 100, 255, 0, 0);
    const file = new File([pngBytes], "red.png", { type: "image/png" });

    const out = await processStaticImage(file);

    expect(out.byteLength).toBe(RGB565_FRAME_BYTES);
    expect(rgb565At(out, 64, 0)).toBe(0xf800);
    expect(rgb565At(out, 64, 32)).toBe(0xf800);
    expect(rgb565At(out, 64, 95)).toBe(0xf800);
    expect(rgb565At(out, 64, 127)).toBe(0xf800);
  });

  test("output is always 128x128*2 bytes regardless of input dimensions", async () => {
    const pngBytes = makeSolidColorPng(1000, 50, 0, 255, 0);
    const file = new File([pngBytes], "green.png", { type: "image/png" });

    const out = await processStaticImage(file);

    expect(out.byteLength).toBe(SCREEN_WIDTH * SCREEN_HEIGHT * 2);
  });

  test("fits a portrait image without cropping its top or bottom edges", async () => {
    const pngBytes = makePortraitEdgeMarkerPng();
    const file = new File([pngBytes], "portrait.png", { type: "image/png" });

    const out = await processStaticImage(file);

    expect(rgb565At(out, 64, 2)).toBe(0xf800); // red top edge retained
    expect(rgb565At(out, 64, 125)).toBe(0x001f); // blue bottom edge retained
    expect(rgb565At(out, 2, 64)).toBe(0x07e0); // dominant green side padding
  });

  test("does not apply dominant-color padding to a transparent image", async () => {
    const pngBytes = makeTransparentPortraitPng();
    const file = new File([pngBytes], "transparent.png", { type: "image/png" });

    const out = await processStaticImage(file);

    expect(rgb565At(out, 2, 64)).toBe(0x0000);
    expect(rgb565At(out, 64, 64)).toBe(0xf800);
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
