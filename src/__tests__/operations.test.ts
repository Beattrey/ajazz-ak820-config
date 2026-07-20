import { describe, expect, test } from "vitest";
import { MockDeviceController } from "../device/mock-controller";
import {
  setLighting,
  setLightingSleepTime,
  syncTime,
  uploadAnimatedImage,
  uploadStaticImage,
} from "../operations";
import { RGB565_FRAME_BYTES } from "../protocol/constants";
import { LightingDirection, LightingMode } from "../protocol/lighting";
import { LightingSleepTime } from "../protocol/lighting-sleep";

const LIGHTING_CONFIG = {
  mode: LightingMode.Static,
  color: { red: 255, green: 0, blue: 0 },
  rainbow: false,
  brightness: 5 as const,
  speed: 2 as const,
  direction: LightingDirection.Left,
};

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

describe("setLighting", () => {
  test("sends START, MODE, normalized DATA, and FINISH in order", async () => {
    const ctrl = new MockDeviceController();
    await ctrl.connect();

    await setLighting(ctrl, LIGHTING_CONFIG);

    expect(ctrl.sent).toHaveLength(4);
    expect(ctrl.sent.map((report) => report.kind)).toEqual([
      "feature",
      "feature",
      "feature",
      "feature",
    ]);
    expect(ctrl.sent.map((report) => report.reportId)).toEqual([0x04, 0x04, 0x07, 0x04]);
    expect(ctrl.sent.map((report) => report.bytes[0])).toEqual([0x18, 0x13, 0xff, 0xf0]);
    expect(ctrl.receivedFeatureReportIds).toEqual([0, 0, 0]);
  });

  test("stops the transaction and exposes a transfer failure", async () => {
    const ctrl = new MockDeviceController({ failSendAt: 3 });
    await ctrl.connect();

    await expect(setLighting(ctrl, LIGHTING_CONFIG)).rejects.toMatchObject({
      name: "DeviceFailure",
      error: { kind: "transfer-failed", reportId: LightingMode.Breath },
    });
    expect(ctrl.sent).toHaveLength(2);
  });
});

describe("setLightingSleepTime", () => {
  test("sends START, SLEEP preamble, and sleep data", async () => {
    const ctrl = new MockDeviceController();
    await ctrl.connect();

    await setLightingSleepTime(ctrl, LightingSleepTime.FiveMinutes);

    expect(ctrl.sent).toHaveLength(3);
    expect(ctrl.sent.map((report) => report.reportId)).toEqual([0x04, 0x04, 0x00]);
    expect(ctrl.sent[0].bytes[0]).toBe(0x18);
    expect(ctrl.sent[1].bytes.slice(0, 2)).toEqual(new Uint8Array([0x17, 0x01]));
    expect(ctrl.sent[2].bytes[7]).toBe(LightingSleepTime.FiveMinutes);
    expect(ctrl.receivedFeatureReportIds).toEqual([0, 0]);
  });
});

describe("uploadStaticImage", () => {
  test("sends START + CFG + 9 chunks of 4096 + SAVE", async () => {
    const ctrl = new MockDeviceController();
    await ctrl.connect();
    const buf = new Uint8Array(RGB565_FRAME_BYTES);
    const progress: number[] = [];

    await uploadStaticImage(ctrl, buf, (p) => progress.push(p));

    // 9 chunks of 4096 bytes per frame.
    // Sequence: START + CFG + 9 chunks + SAVE = 12 reports.
    expect(ctrl.sent).toHaveLength(12);

    expect(ctrl.sent[0].kind).toBe("feature");
    expect(ctrl.sent[1].kind).toBe("feature");
    expect(ctrl.sent[0].bytes[7]).toBe(0x00);
    expect(ctrl.sent[1].bytes[1]).toBe(0x03);
    for (let i = 0; i < 9; i++) {
      expect(ctrl.sent[2 + i].kind).toBe("output");
      expect(ctrl.sent[2 + i].reportId).toBe(0);
      expect(ctrl.sent[2 + i].bytes.byteLength).toBe(4096);
    }
    expect(ctrl.sent[2].bytes[0]).toBe(0x01);
    expect(ctrl.sent[2].bytes[1]).toBe(0x00);
    expect(ctrl.sent[2].bytes[2]).toBe(0xff);
    expect(ctrl.sent[11].kind).toBe("feature");
    expect(ctrl.sent[11].bytes[0]).toBe(0x02);
    expect(ctrl.sent[11].bytes[7]).toBe(0x00);

    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(1);
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]);
    }
  });

  test("rejects wrong-sized buffer", async () => {
    const ctrl = new MockDeviceController();
    await ctrl.connect();
    await expect(uploadStaticImage(ctrl, new Uint8Array(100), () => {})).rejects.toThrow(/32768/);
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
    await expect(uploadAnimatedImage(ctrl, frames, [100, 200], () => {})).rejects.toThrow(/delay/i);
  });
});
