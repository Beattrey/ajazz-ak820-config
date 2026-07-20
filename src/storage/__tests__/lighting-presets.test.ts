import { beforeEach, describe, expect, test } from "vitest";
import { LightingDirection, LightingMode } from "../../protocol/lighting";
import {
  LIGHTING_PRESETS_STORAGE_KEY,
  loadLightingPresets,
  saveLightingPresets,
  type LightingPreset,
} from "../lighting-presets";

const PRESET: LightingPreset = {
  id: "preset-1",
  name: "Red static",
  config: {
    mode: LightingMode.Static,
    color: { red: 255, green: 0, blue: 0 },
    rainbow: false,
    brightness: 5,
    speed: 3,
    direction: LightingDirection.Left,
  },
};

beforeEach(() => localStorage.clear());

describe("lighting preset storage", () => {
  test("round-trips a versioned preset", () => {
    saveLightingPresets([PRESET]);
    expect(loadLightingPresets()).toEqual([PRESET]);
    expect(JSON.parse(localStorage.getItem(LIGHTING_PRESETS_STORAGE_KEY) ?? "")).toMatchObject({
      version: 1,
    });
  });

  test("rejects malformed JSON and unsupported versions", () => {
    localStorage.setItem(LIGHTING_PRESETS_STORAGE_KEY, "not json");
    expect(loadLightingPresets()).toEqual([]);
    localStorage.setItem(
      LIGHTING_PRESETS_STORAGE_KEY,
      JSON.stringify({ version: 2, presets: [PRESET] }),
    );
    expect(loadLightingPresets()).toEqual([]);
  });

  test("filters invalid entries without discarding valid presets", () => {
    localStorage.setItem(
      LIGHTING_PRESETS_STORAGE_KEY,
      JSON.stringify({ version: 1, presets: [PRESET, { id: "bad", name: "", config: {} }] }),
    );
    expect(loadLightingPresets()).toEqual([PRESET]);
  });

  test("refuses to store invalid data", () => {
    expect(() => saveLightingPresets([{ ...PRESET, name: "" }])).toThrow(/invalid/);
  });
});
