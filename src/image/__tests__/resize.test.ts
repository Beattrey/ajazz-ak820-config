import { describe, expect, test } from "vitest";
import { calculateContainRect, containResizeRgba, findDominantColor } from "../resize";

function solidRgba(
  width: number,
  height: number,
  color: readonly [number, number, number, number],
) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < rgba.length; i += 4) rgba.set(color, i);
  return rgba;
}

function rgbaAt(buffer: Uint8ClampedArray, width: number, x: number, y: number): number[] {
  const offset = (y * width + x) * 4;
  return [...buffer.slice(offset, offset + 4)];
}

describe("contain image resize", () => {
  test("groups nearby shades and ignores transparent pixels when choosing the dominant color", () => {
    const pixels = new Uint8ClampedArray([
      241, 10, 10, 255, 242, 11, 11, 255, 243, 12, 12, 255, 244, 13, 13, 255, 0, 0, 255, 255, 0, 0,
      255, 255, 0, 255, 0, 0,
    ]);

    expect(findDominantColor(pixels, 7, 1)).toEqual([243, 12, 12]);
  });

  test("keeps padding black when the source contains transparency", () => {
    const source = solidRgba(50, 100, [255, 0, 0, 255]);
    source[3] = 0;

    const resized = containResizeRgba(source, 50, 100, 128, 128);

    expect(rgbaAt(resized, 128, 0, 64)).toEqual([0, 0, 0, 255]);
    expect(rgbaAt(resized, 128, 64, 64)).toEqual([255, 0, 0, 255]);
  });

  test("centers portrait images with dominant-color side padding", () => {
    expect(calculateContainRect(50, 100, 128, 128)).toEqual({
      x: 32,
      y: 0,
      width: 64,
      height: 128,
      scale: 1.28,
    });

    const resized = containResizeRgba(solidRgba(50, 100, [255, 0, 0, 255]), 50, 100, 128, 128);
    expect(rgbaAt(resized, 128, 0, 64)).toEqual([255, 0, 0, 255]);
    expect(rgbaAt(resized, 128, 32, 64)).toEqual([255, 0, 0, 255]);
    expect(rgbaAt(resized, 128, 95, 64)).toEqual([255, 0, 0, 255]);
    expect(rgbaAt(resized, 128, 127, 64)).toEqual([255, 0, 0, 255]);
  });

  test("centers landscape images with dominant-color top and bottom padding", () => {
    const resized = containResizeRgba(solidRgba(100, 50, [0, 0, 255, 255]), 100, 50, 128, 128);
    expect(rgbaAt(resized, 128, 64, 0)).toEqual([0, 0, 255, 255]);
    expect(rgbaAt(resized, 128, 64, 32)).toEqual([0, 0, 255, 255]);
    expect(rgbaAt(resized, 128, 64, 95)).toEqual([0, 0, 255, 255]);
    expect(rgbaAt(resized, 128, 64, 127)).toEqual([0, 0, 255, 255]);
  });
});
