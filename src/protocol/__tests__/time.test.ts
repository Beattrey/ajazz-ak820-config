import { describe, expect, test } from "vitest";
import { buildTimeSyncReports } from "../time";
import fixture from "./fixtures/time-2026-05-16.json" with { type: "json" };

describe("buildTimeSyncReports", () => {
  test("encodes 2026-05-16T14:30:45 as the 4-packet reference sequence", () => {
    const date = new Date(fixture.input.iso);
    const reports = buildTimeSyncReports(date);

    expect(reports).toHaveLength(4);
    for (let i = 0; i < 4; i++) {
      expect(reports[i].reportId).toBe(fixture.expected[i].reportId);
      expect(Array.from(reports[i].bytes)).toEqual(fixture.expected[i].bytes);
    }
  });

  test("throws on Invalid Date", () => {
    const invalid = new Date("not a date");
    expect(() => buildTimeSyncReports(invalid)).toThrow(/invalid date/i);
  });

  test("year - 2000 wraps as expected", () => {
    const date = new Date("2030-12-31T23:59:59");
    const reports = buildTimeSyncReports(date);
    // TIME_DATA is reports[2]; bytes[2] is year-2000.
    expect(reports[2].bytes[2]).toBe(30);
    expect(reports[2].bytes[3]).toBe(12);
    expect(reports[2].bytes[4]).toBe(31);
    expect(reports[2].bytes[5]).toBe(23);
    expect(reports[2].bytes[6]).toBe(59);
    expect(reports[2].bytes[7]).toBe(59);
  });
});
