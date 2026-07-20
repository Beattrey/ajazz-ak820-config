import { describe, expect, test } from "vitest";
import { createCanvas } from "canvas";
import GIFEncoder from "gif-encoder-2";
import {
  inspectWebP,
  isAnimatedWebP,
  processAnimatedImage,
  rasterizeGifFrames,
  type DecodedGifFrame,
} from "../animated";
import { RGB565_FRAME_BYTES } from "../../protocol/constants";

function makeThreeFrameGif(): Uint8Array {
  const width = 200;
  const height = 100;
  const encoder = new GIFEncoder(width, height);
  encoder.start();
  encoder.setRepeat(0); // loop forever
  encoder.setDelay(100); // 100 ms per frame
  // Frame 0 — red
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgb(255,0,0)";
  ctx.fillRect(0, 0, width, height);
  encoder.addFrame(ctx);
  // Frame 1 — green
  ctx.fillStyle = "rgb(0,255,0)";
  ctx.fillRect(0, 0, width, height);
  encoder.addFrame(ctx);
  // Frame 2 — blue
  ctx.fillStyle = "rgb(0,0,255)";
  ctx.fillRect(0, 0, width, height);
  encoder.addFrame(ctx);
  encoder.finish();
  return new Uint8Array(encoder.out.getData());
}

function makeWebPContainer(animated: boolean, frameCount = 0): Uint8Array {
  const chunks: Array<{ kind: string; payload: Uint8Array }> = [];
  const vp8x = new Uint8Array(10);
  if (animated) vp8x[0] = 0x02;
  vp8x[4] = 1; // width = 2 (24-bit value stores width - 1)
  vp8x[7] = 1; // height = 2
  chunks.push({ kind: "VP8X", payload: vp8x });
  if (animated) {
    chunks.push({ kind: "ANIM", payload: new Uint8Array(6) });
    for (let i = 0; i < frameCount; i++) {
      chunks.push({ kind: "ANMF", payload: new Uint8Array(16) });
    }
  }
  const size = 12 + chunks.reduce((sum, chunk) => sum + 8 + chunk.payload.length, 0);
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  const write = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i);
  };
  write(0, "RIFF");
  view.setUint32(4, size - 8, true);
  write(8, "WEBP");
  let offset = 12;
  for (const chunk of chunks) {
    write(offset, chunk.kind);
    view.setUint32(offset + 4, chunk.payload.length, true);
    bytes.set(chunk.payload, offset + 8);
    offset += 8 + chunk.payload.length;
  }
  return bytes;
}

describe("processAnimatedImage", () => {
  test("3-frame R/G/B GIF → 3 frames, each 32768 bytes, ~100 ms delays", async () => {
    const gifBytes = makeThreeFrameGif();
    const file = new File([gifBytes], "rgb.gif", { type: "image/gif" });

    const out = await processAnimatedImage(file);

    expect(out.frames).toHaveLength(3);
    for (const frame of out.frames) {
      expect(frame.byteLength).toBe(RGB565_FRAME_BYTES);
    }
    expect(out.delaysMs).toHaveLength(3);
    for (const ms of out.delaysMs) {
      // GIFs encode delays in 1/100 second units, so 100ms requested may
      // round-trip to anywhere in 90-110ms. Be lenient.
      expect(ms).toBeGreaterThanOrEqual(80);
      expect(ms).toBeLessThanOrEqual(120);
    }
  });

  test("each frame is predominantly its expected color (RGB565)", async () => {
    const gifBytes = makeThreeFrameGif();
    const file = new File([gifBytes], "rgb.gif", { type: "image/gif" });

    const out = await processAnimatedImage(file);

    // Helper: read RGB565 little-endian at byte offset i*2.
    const pickColor = (frame: Uint8Array, i: number) => {
      const lo = frame[i * 2];
      const hi = frame[i * 2 + 1];
      const v = (hi << 8) | lo;
      return {
        r: (v >> 11) & 0x1f,
        g: (v >> 5) & 0x3f,
        b: v & 0x1f,
      };
    };

    // Center pixel of each frame.
    const centerIdx = 128 * 64 + 64;
    const c0 = pickColor(out.frames[0], centerIdx);
    const c1 = pickColor(out.frames[1], centerIdx);
    const c2 = pickColor(out.frames[2], centerIdx);

    // GIF quantization may shift colors slightly; check dominance.
    expect(c0.r).toBeGreaterThan(c0.g);
    expect(c0.r).toBeGreaterThan(c0.b);
    expect(c1.g).toBeGreaterThan(c1.r);
    expect(c1.g).toBeGreaterThan(c1.b);
    expect(c2.b).toBeGreaterThan(c2.r);
    expect(c2.b).toBeGreaterThan(c2.g);
  });

  test("rejects MIME types other than GIF and WebP", async () => {
    const file = new File([new Uint8Array(10)], "bad.png", { type: "image/png" });
    await expect(processAnimatedImage(file)).rejects.toThrow(/gif/i);
  });

  test("rejects files larger than 20 MB", async () => {
    const big = new Uint8Array(21 * 1024 * 1024);
    const file = new File([big], "huge.gif", { type: "image/gif" });
    await expect(processAnimatedImage(file)).rejects.toThrow(/too large/i);
  });

  test("decodes every animated WebP frame and converts microsecond durations", async () => {
    const webpBytes = makeWebPContainer(true, 2);
    const file = new File([webpBytes], "rgb.webp", { type: "image/webp" });
    const originalDecoder = (globalThis as unknown as { ImageDecoder?: unknown }).ImageDecoder;

    class FakeImageDecoder {
      tracks = { ready: Promise.resolve(), selectedTrack: { frameCount: 2 } };
      async decode({ frameIndex }: { frameIndex: number }) {
        const canvas = createCanvas(2, 2);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = frameIndex === 0 ? "red" : "blue";
        ctx.fillRect(0, 0, 2, 2);
        return {
          image: Object.assign(canvas, {
            displayWidth: 2,
            displayHeight: 2,
            duration: frameIndex === 0 ? 50_000 : 120_000,
            close() {},
          }),
        };
      }
      close() {}
    }

    Object.defineProperty(globalThis, "ImageDecoder", {
      configurable: true,
      value: FakeImageDecoder,
    });
    try {
      const out = await processAnimatedImage(file);
      expect(out.frames).toHaveLength(2);
      for (const frame of out.frames) expect(frame.byteLength).toBe(RGB565_FRAME_BYTES);
      // Center pixels retain each decoded frame's color after RGB565 conversion.
      const centerOffset = (128 * 64 + 64) * 2;
      expect((out.frames[0][centerOffset + 1] << 8) | out.frames[0][centerOffset]).toBe(0xf800);
      expect((out.frames[1][centerOffset + 1] << 8) | out.frames[1][centerOffset]).toBe(0x001f);
      expect(out.delaysMs).toEqual([50, 120]);
    } finally {
      Object.defineProperty(globalThis, "ImageDecoder", {
        configurable: true,
        value: originalDecoder,
      });
    }
  });

  test("reports a clear error when animated WebP decoding is unavailable", async () => {
    const file = new File([makeWebPContainer(true, 1)], "animated.webp", {
      type: "image/webp",
    });
    const originalDecoder = (globalThis as unknown as { ImageDecoder?: unknown }).ImageDecoder;
    Object.defineProperty(globalThis, "ImageDecoder", { configurable: true, value: undefined });
    try {
      await expect(processAnimatedImage(file)).rejects.toThrow(/WebCodecs ImageDecoder/i);
    } finally {
      Object.defineProperty(globalThis, "ImageDecoder", {
        configurable: true,
        value: originalDecoder,
      });
    }
  });

  test("rejects animated WebP frame counts above the safety limit before decoding", async () => {
    const file = new File([makeWebPContainer(true, 257)], "too-many.webp", {
      type: "image/webp",
    });
    await expect(processAnimatedImage(file)).rejects.toThrow(/257 frames exceed max 256/i);
  });
});

describe("WebP container inspection", () => {
  test("distinguishes static and animated WebP and counts animation frames", async () => {
    const animated = makeWebPContainer(true, 3);
    expect(inspectWebP(animated.buffer)).toEqual({
      animated: true,
      width: 2,
      height: 2,
      frameCount: 3,
    });
    const animatedFile = new File([animated], "animated.webp", { type: "image/webp" });
    expect(await isAnimatedWebP(animatedFile)).toBe(true);
    const staticFile = new File([makeWebPContainer(false)], "still.webp", { type: "image/webp" });
    expect(await isAnimatedWebP(staticFile)).toBe(false);
  });

  test("rejects invalid and truncated WebP containers", () => {
    expect(() => inspectWebP(new ArrayBuffer(12))).toThrow(/invalid WebP/i);

    const truncated = makeWebPContainer(true, 1);
    const truncatedView = truncated.slice(0, truncated.length - 1);
    expect(() => inspectWebP(truncatedView.buffer)).toThrow(/truncated WebP/i);
  });
});

describe("rasterizeGifFrames", () => {
  // gifuct-js stores transparent pixels in `patch` with alpha=0 and RGB equal
  // to colorTable[transparentIndex] — *not* zero. A naïve 4-byte copy
  // overwrites the previous frame's RGB with that placeholder color; the
  // result on a keyboard with no alpha channel is bright blocky artifacts
  // exactly where the previous frame should show through.
  test("transparent pixels in a patch leave the previous frame untouched", () => {
    const W = 4;
    const H = 4;

    // Frame 0: solid red, fully opaque.
    const patch0 = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      patch0[i * 4] = 255;
      patch0[i * 4 + 3] = 255;
    }

    // Frame 1: top half green opaque, bottom half "transparent" — alpha=0
    // with non-zero RGB to simulate gifuct-js's placeholder behaviour.
    const patch1 = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        if (y < H / 2) {
          patch1[i + 1] = 255; // green
          patch1[i + 3] = 255;
        } else {
          patch1[i] = 123; // bogus RGB at the transparent index
          patch1[i + 2] = 200;
          patch1[i + 3] = 0;
        }
      }
    }

    const decoded: DecodedGifFrame[] = [
      {
        dims: { left: 0, top: 0, width: W, height: H },
        patch: patch0,
        disposalType: 0,
        delay: 100,
      },
      {
        dims: { left: 0, top: 0, width: W, height: H },
        patch: patch1,
        disposalType: 0,
        delay: 100,
        transparentIndex: 5,
      },
    ];

    const out = Array.from(rasterizeGifFrames(decoded, W, H, [0, 0, 0, 0]));
    const f1 = out[1].rgba;

    // Bottom-left pixel of frame 1 should retain frame 0's red, not the
    // (123, 0, 200) garbage from the transparent placeholder.
    const idx = (3 * W + 0) * 4;
    expect(f1[idx]).toBe(255);
    expect(f1[idx + 1]).toBe(0);
    expect(f1[idx + 2]).toBe(0);
  });

  // Disposal method 2 ("restore to background") is what GIFs with movement
  // use to erase the prior frame's pixels before the next frame is drawn.
  // Without it, moving sprites leave trails — the "torn animation" symptom.
  test("disposal=2 clears the prev frame's dims to background before next frame", () => {
    const W = 4;
    const H = 4;

    const opaqueRed = new Uint8ClampedArray(2 * 2 * 4);
    for (let i = 0; i < 4; i++) {
      opaqueRed[i * 4] = 255;
      opaqueRed[i * 4 + 3] = 255;
    }
    const opaqueGreen = new Uint8ClampedArray(2 * 2 * 4);
    for (let i = 0; i < 4; i++) {
      opaqueGreen[i * 4 + 1] = 255;
      opaqueGreen[i * 4 + 3] = 255;
    }

    const decoded: DecodedGifFrame[] = [
      {
        dims: { left: 0, top: 0, width: 2, height: 2 },
        patch: opaqueRed,
        disposalType: 2,
        delay: 100,
      },
      {
        dims: { left: 2, top: 2, width: 2, height: 2 },
        patch: opaqueGreen,
        disposalType: 0,
        delay: 100,
      },
    ];

    const out = Array.from(rasterizeGifFrames(decoded, W, H, [0, 0, 0, 255]));
    const f1 = out[1].rgba;

    // Top-left of frame 1 should be background (black), not lingering red.
    const topLeft = 0;
    expect(f1[topLeft]).toBe(0);
    expect(f1[topLeft + 1]).toBe(0);
    expect(f1[topLeft + 2]).toBe(0);

    // Bottom-right should be the newly-drawn green.
    const bottomRight = (3 * W + 3) * 4;
    expect(f1[bottomRight + 1]).toBe(255);
  });

  // Disposal method 3 ("restore to previous") rolls the canvas back to its
  // state before the current frame. Without handling, animations using
  // disposal=3 (rare but real) get duplicated overlays.
  test("disposal=3 restores canvas to the state before that frame was drawn", () => {
    const W = 4;
    const H = 4;

    const fullRed = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      fullRed[i * 4] = 255;
      fullRed[i * 4 + 3] = 255;
    }
    const opaqueGreen = new Uint8ClampedArray(2 * 2 * 4);
    for (let i = 0; i < 4; i++) {
      opaqueGreen[i * 4 + 1] = 255;
      opaqueGreen[i * 4 + 3] = 255;
    }
    const opaqueBlue = new Uint8ClampedArray(2 * 2 * 4);
    for (let i = 0; i < 4; i++) {
      opaqueBlue[i * 4 + 2] = 255;
      opaqueBlue[i * 4 + 3] = 255;
    }

    const decoded: DecodedGifFrame[] = [
      {
        dims: { left: 0, top: 0, width: W, height: H },
        patch: fullRed,
        disposalType: 0,
        delay: 100,
      },
      {
        dims: { left: 0, top: 0, width: 2, height: 2 },
        patch: opaqueGreen,
        disposalType: 3,
        delay: 100,
      },
      {
        dims: { left: 2, top: 2, width: 2, height: 2 },
        patch: opaqueBlue,
        disposalType: 0,
        delay: 100,
      },
    ];

    const out = Array.from(rasterizeGifFrames(decoded, W, H, [0, 0, 0, 255]));
    const f2 = out[2].rgba;

    // Top-left of frame 2 should be RED again (restored), not the green
    // that was drawn in frame 1.
    const topLeft = 0;
    expect(f2[topLeft]).toBe(255);
    expect(f2[topLeft + 1]).toBe(0);
    expect(f2[topLeft + 2]).toBe(0);

    // Bottom-right of frame 2 should be the newly-drawn blue.
    const bottomRight = (3 * W + 3) * 4;
    expect(f2[bottomRight + 2]).toBe(255);
  });
});
