import { describe, expect, test } from "vitest";
import { rgb888ToRgb565 } from "../rgb565";

describe("rgb888ToRgb565", () => {
  test("converts pure black", () => {
    const rgba = new Uint8ClampedArray([0, 0, 0, 255]);
    const out = rgb888ToRgb565(rgba, 1, 1, "le");
    expect(Array.from(out)).toEqual([0x00, 0x00]);
  });

  test("converts pure white", () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255]);
    const out = rgb888ToRgb565(rgba, 1, 1, "le");
    expect(Array.from(out)).toEqual([0xff, 0xff]);
  });

  test("converts pure red (R=255 → top 5 bits = 0b11111)", () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 255]);
    const out = rgb888ToRgb565(rgba, 1, 1, "le");
    // RGB565 layout: RRRRR GGGGGG BBBBB = 0xF800
    // little-endian byte order: 0x00, 0xF8
    expect(Array.from(out)).toEqual([0x00, 0xf8]);
  });

  test("output size matches width * height * 2 bytes", () => {
    const pixels = 128 * 128;
    const rgba = new Uint8ClampedArray(pixels * 4);
    const out = rgb888ToRgb565(rgba, 128, 128, "le");
    expect(out.byteLength).toBe(pixels * 2);
  });
});
