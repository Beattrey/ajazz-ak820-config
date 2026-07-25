import { describe, expect, test } from "vitest";
import { MockDeviceController } from "../device/mock-controller";
import { syncTime, uploadStaticImage, uploadAnimatedImage } from "../operations";
import { RGB565_FRAME_BYTES } from "../protocol/constants";
import { generateTwoFrameAnimation } from "../image/test-pattern";
import { buildFrameHeader, buildAnimatedDataChunks } from "../protocol/image";

describe("syncTime", () => {
  test("sends exactly 4 feature reports (START, TIME_PREAMBLE, TIME_DATA, SAVE)", async () => {
    const ctrl = new MockDeviceController();
    await ctrl.connect();
    await syncTime(ctrl, new Date("2026-05-16T14:30:45"));
    expect(ctrl.sent).toHaveLength(4);
    for (const s of ctrl.sent) {
      expect(s.kind).toBe("feature");
    }
    // Report IDs: control packets use 0x04, TIME_DATA uses 0x00.
    expect(ctrl.sent[0].reportId).toBe(0x04);
    expect(ctrl.sent[1].reportId).toBe(0x04);
    expect(ctrl.sent[2].reportId).toBe(0x00);
    expect(ctrl.sent[3].reportId).toBe(0x04);
  });

  test("throws on invalid date", async () => {
    const ctrl = new MockDeviceController();
    await ctrl.connect();
    await expect(syncTime(ctrl, new Date("not-a-date"))).rejects.toThrow(/invalid date/i);
  });
});

describe("uploadStaticImage", () => {
  test("sends START + CFG + 9 chunks of 4096 + FINISH", async () => {
    const ctrl = new MockDeviceController();
    await ctrl.connect();
    const buf = new Uint8Array(RGB565_FRAME_BYTES);
    const progress: number[] = [];

    await uploadStaticImage(ctrl, buf, (p) => progress.push(p));

    // 9 chunks of 4096 bytes per frame.
    // Sequence: START + CFG + 9 chunks + FINISH = 12 reports.
    expect(ctrl.sent).toHaveLength(12);

    expect(ctrl.sent[0].kind).toBe("feature");
    expect(ctrl.sent[1].kind).toBe("feature");
    for (let i = 0; i < 9; i++) {
      expect(ctrl.sent[2 + i].kind).toBe("output");
      expect(ctrl.sent[2 + i].reportId).toBe(0);
      expect(ctrl.sent[2 + i].bytes.byteLength).toBe(4096);
    }
    expect(ctrl.sent[11].kind).toBe("feature");
    expect(ctrl.sent[11].bytes[0]).toBe(0xf0);

    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(1);
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]);
    }
  });

  test("rejects wrong-sized buffer", async () => {
    const ctrl = new MockDeviceController();
    await ctrl.connect();
    await expect(
      uploadStaticImage(ctrl, new Uint8Array(100), () => {}),
    ).rejects.toThrow(/32768/);
  });

  test("fail-fast: a missing ACK aborts — no further chunk, no FINISH", async () => {
    const ctrl = new MockDeviceController();
    await ctrl.connect();
    ctrl.waitForDataInputReport = async () => null; // force ACK timeout
    await expect(
      uploadStaticImage(ctrl, new Uint8Array(RGB565_FRAME_BYTES), () => {}),
    ).rejects.toThrow(/aborted/i);
    // START + CFG were sent, then exactly ONE chunk, then abort.
    expect(ctrl.sent.filter((s) => s.kind === "output")).toHaveLength(1);
    // No FINISH (0xF0) was ever sent.
    expect(ctrl.sent.some((s) => s.kind === "feature" && s.bytes[0] === 0xf0)).toBe(false);
  });
});

describe("uploadAnimatedImage (AKS075 path)", () => {
  test("3 frames → 25 chunks (with 256-byte header) + START + CFG + SAVE", async () => {
    const ctrl = new MockDeviceController();
    await ctrl.connect();
    const frames = [
      new Uint8Array(RGB565_FRAME_BYTES),
      new Uint8Array(RGB565_FRAME_BYTES),
      new Uint8Array(RGB565_FRAME_BYTES),
    ];
    const delaysMs = [100, 100, 100];
    const progress: number[] = [];

    await uploadAnimatedImage(ctrl, frames, delaysMs, (p) => progress.push(p));

    // AKS075 framing: 256 (header) + 3 * 32768 = 98560 → ceil/4096 = 25 chunks.
    // Sequence: START + CFG + 25 chunks + SAVE = 28 reports.
    expect(ctrl.sent).toHaveLength(28);
    // CFG uses sub-command 0x03 (AKS075) — verify byte 1.
    expect(ctrl.sent[1].bytes[1]).toBe(0x03);
    // Final packet is SAVE (0x02), not FINISH (0xF0).
    expect(ctrl.sent[27].bytes[0]).toBe(0x02);
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(1);
  });

  test("rejects mismatched frames/delays length", async () => {
    const ctrl = new MockDeviceController();
    await ctrl.connect();
    const frames = [new Uint8Array(RGB565_FRAME_BYTES)];
    await expect(
      uploadAnimatedImage(ctrl, frames, [100, 200], () => {}),
    ).rejects.toThrow(/delay/i);
  });

  test("fail-fast: a missing ACK aborts — no further chunk, no SAVE", async () => {
    const ctrl = new MockDeviceController();
    await ctrl.connect();
    ctrl.waitForDataInputReport = async () => null; // force ACK timeout
    const frames = [new Uint8Array(RGB565_FRAME_BYTES), new Uint8Array(RGB565_FRAME_BYTES)];
    await expect(
      uploadAnimatedImage(ctrl, frames, [100, 100], () => {}),
    ).rejects.toThrow(/aborted/i);
    // Exactly one chunk was sent before the abort.
    expect(ctrl.sent.filter((s) => s.kind === "output")).toHaveLength(1);
    // No SAVE (0x02) and no FINISH (0xF0) were sent.
    expect(ctrl.sent.some((s) => s.kind === "feature" && s.bytes[0] === 0x02)).toBe(false);
    expect(ctrl.sent.some((s) => s.bytes[0] === 0xf0)).toBe(false);
  });
});

describe("SAFE 2-frame animation (black + white, 200 ms)", () => {
  test("payload/header/chunk math matches expected values", () => {
    const { frames, delaysMs } = generateTwoFrameAnimation();
    expect(frames).toHaveLength(2);
    expect(delaysMs).toEqual([200, 200]);
    expect(frames[0].byteLength).toBe(32768);

    // Header: 02 64 64 FF FF ... (frame count 2, two delays of 0x64).
    const header = buildFrameHeader(frames.length, delaysMs);
    expect(header.length).toBe(256);
    expect(Array.from(header.subarray(0, 4))).toEqual([0x02, 0x64, 0x64, 0xff]);

    // 256 + 2*32768 = 65792 → padded to 17 * 4096 = 69632, all chunks 4096.
    const chunks = buildAnimatedDataChunks(frames, delaysMs);
    expect(chunks).toHaveLength(17);
    expect(chunks.every((c) => c.byteLength === 4096)).toBe(true);
    expect(chunks.reduce((a, c) => a + c.byteLength, 0)).toBe(69632);
  });

  test("upload sends START(enable=false)+CFG(sub=0x03,count=17)+17 chunks+SAVE(0x02), no FINISH", async () => {
    const ctrl = new MockDeviceController();
    await ctrl.connect();
    const { frames, delaysMs } = generateTwoFrameAnimation();

    await uploadAnimatedImage(ctrl, frames, delaysMs, () => {});

    expect(ctrl.sent).toHaveLength(20); // START + CFG + 17 chunks + SAVE
    expect(ctrl.sent[0].bytes[0]).toBe(0x18); // START
    expect(ctrl.sent[0].bytes[7]).toBe(0x00); // enable=false
    expect(ctrl.sent[1].bytes[0]).toBe(0x72); // IMAGE_CFG
    expect(ctrl.sent[1].bytes[1]).toBe(0x03); // animated sub-command
    expect(ctrl.sent[1].bytes[7]).toBe(17); // chunk count low byte
    expect(ctrl.sent.filter((s) => s.kind === "output")).toHaveLength(17);
    expect(ctrl.sent[19].bytes[0]).toBe(0x02); // SAVE
    expect(ctrl.sent.some((s) => s.bytes[0] === 0xf0)).toBe(false); // no FINISH
  });
});
