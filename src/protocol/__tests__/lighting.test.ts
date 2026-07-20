import { describe, expect, test } from "vitest";
import {
  buildLightingDataReport,
  buildLightingModePreambleReport,
  LightingDirection,
  LightingMode,
  type LightingConfig,
} from "../lighting";

const DEFAULT_CONFIG: LightingConfig = {
  mode: LightingMode.Rolling,
  color: { red: 0x12, green: 0x34, blue: 0x56 },
  rainbow: true,
  brightness: 5,
  speed: 3,
  direction: LightingDirection.Right,
};

describe("buildLightingModePreambleReport", () => {
  test("builds the byte-exact 0x13 control report", () => {
    const report = buildLightingModePreambleReport();

    expect(report.reportId).toBe(0x04);
    expect(report.bytes).toHaveLength(63);
    expect(Array.from(report.bytes)).toEqual([0x13, 0, 0, 0, 0, 0, 0, 1, ...Array(55).fill(0)]);
  });
});

describe("buildLightingDataReport", () => {
  test("builds a byte-exact normal effect report", () => {
    const report = buildLightingDataReport(DEFAULT_CONFIG);

    expect(report.reportId).toBe(LightingMode.Rolling);
    expect(report.bytes).toHaveLength(63);
    expect(Array.from(report.bytes)).toEqual([
      0x12,
      0x34,
      0x56,
      0,
      0,
      0,
      0,
      1,
      5,
      3,
      LightingDirection.Right,
      0,
      0,
      0x55,
      0xaa,
      ...Array(48).fill(0),
    ]);
  });

  test("encodes static as firmware breath mode with speed zero", () => {
    const report = buildLightingDataReport({
      ...DEFAULT_CONFIG,
      mode: LightingMode.Static,
      rainbow: false,
    });

    expect(report.reportId).toBe(LightingMode.Breath);
    expect(report.bytes[8]).toBe(5);
    expect(report.bytes[9]).toBe(0);
  });

  test("encodes off as firmware single-on mode with brightness and speed zero", () => {
    const report = buildLightingDataReport({ ...DEFAULT_CONFIG, mode: LightingMode.Off });

    expect(report.reportId).toBe(LightingMode.SingleOn);
    expect(report.bytes[8]).toBe(0);
    expect(report.bytes[9]).toBe(0);
  });

  test.each([0, 5] as const)("accepts boundary lighting level %i", (level) => {
    const report = buildLightingDataReport({
      ...DEFAULT_CONFIG,
      brightness: level,
      speed: level,
    });

    expect(report.bytes[8]).toBe(level);
    expect(report.bytes[9]).toBe(level);
  });

  test.each([
    ["brightness", -1],
    ["brightness", 6],
    ["brightness", 1.5],
    ["speed", -1],
    ["speed", 6],
    ["speed", 1.5],
  ] as const)("rejects invalid %s value %s", (field, value) => {
    expect(() =>
      buildLightingDataReport({ ...DEFAULT_CONFIG, [field]: value } as LightingConfig),
    ).toThrow(new RegExp(field));
  });

  test.each([
    { red: -1, green: 0, blue: 0 },
    { red: 0, green: 256, blue: 0 },
    { red: 0, green: 0, blue: 1.5 },
  ])("rejects invalid RGB color $red/$green/$blue", (color) => {
    expect(() => buildLightingDataReport({ ...DEFAULT_CONFIG, color })).toThrow(/\[0, 255\]/);
  });

  test("rejects unknown modes and directions at runtime", () => {
    expect(() =>
      buildLightingDataReport({ ...DEFAULT_CONFIG, mode: 0x14 as LightingMode }),
    ).toThrow(/mode/);
    expect(() =>
      buildLightingDataReport({ ...DEFAULT_CONFIG, direction: 4 as LightingDirection }),
    ).toThrow(/direction/);
  });
});
