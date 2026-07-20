import { describe, expect, test } from "vitest";
import {
  buildLightingSleepDataReport,
  buildLightingSleepPreambleReport,
  LightingSleepTime,
} from "../lighting-sleep";

describe("lighting sleep reports", () => {
  test("builds the byte-exact 0x17 preamble", () => {
    const report = buildLightingSleepPreambleReport();
    expect(report.reportId).toBe(0x04);
    expect(Array.from(report.bytes)).toEqual([
      0x17,
      0x01,
      0,
      0,
      0,
      0,
      0,
      0x01,
      ...Array(55).fill(0),
    ]);
  });

  test.each([
    ["never", LightingSleepTime.Never],
    ["one minute", LightingSleepTime.OneMinute],
    ["five minutes", LightingSleepTime.FiveMinutes],
    ["thirty minutes", LightingSleepTime.ThirtyMinutes],
  ])("builds byte-exact %s data", (_name, sleepTime) => {
    const report = buildLightingSleepDataReport(sleepTime);
    const expected = new Uint8Array(63);
    expected[7] = sleepTime;
    expected[61] = 0xaa;
    expected[62] = 0x55;
    expect(report.reportId).toBe(0);
    expect(report.bytes).toEqual(expected);
  });

  test("rejects unknown sleep values", () => {
    expect(() => buildLightingSleepDataReport(4 as LightingSleepTime)).toThrow(/sleep time/);
  });
});
