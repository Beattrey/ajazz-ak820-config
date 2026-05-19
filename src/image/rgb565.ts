export type Endianness = "le" | "be";

export function rgb888ToRgb565(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  endian: Endianness,
): Uint8Array {
  const pixelCount = width * height;
  if (rgba.length !== pixelCount * 4) {
    throw new Error(
      `rgb888ToRgb565: rgba length ${rgba.length} does not match ${width}x${height}*4`,
    );
  }
  const out = new Uint8Array(pixelCount * 2);
  for (let i = 0; i < pixelCount; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const v = ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3);
    if (endian === "le") {
      out[i * 2] = v & 0xff;
      out[i * 2 + 1] = (v >> 8) & 0xff;
    } else {
      out[i * 2] = (v >> 8) & 0xff;
      out[i * 2 + 1] = v & 0xff;
    }
  }
  return out;
}
