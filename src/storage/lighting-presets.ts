import type { LightingConfig } from "../protocol/lighting";

export const LIGHTING_PRESETS_STORAGE_KEY = "ajazz-ak820-lighting-presets";
export const LIGHTING_PRESETS_VERSION = 1;

export type LightingPreset = {
  id: string;
  name: string;
  config: LightingConfig;
};

type StoredPresets = {
  version: typeof LIGHTING_PRESETS_VERSION;
  presets: LightingPreset[];
};

export function loadLightingPresets(storage: Storage = localStorage): LightingPreset[] {
  try {
    const raw = storage.getItem(LIGHTING_PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== LIGHTING_PRESETS_VERSION) return [];
    if (!Array.isArray(parsed.presets)) return [];
    return parsed.presets.filter(isLightingPreset);
  } catch {
    return [];
  }
}

export function saveLightingPresets(
  presets: readonly LightingPreset[],
  storage: Storage = localStorage,
): void {
  if (!presets.every(isLightingPreset)) {
    throw new Error("Cannot save invalid lighting presets");
  }
  const stored: StoredPresets = { version: LIGHTING_PRESETS_VERSION, presets: [...presets] };
  storage.setItem(LIGHTING_PRESETS_STORAGE_KEY, JSON.stringify(stored));
}

function isLightingPreset(value: unknown): value is LightingPreset {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    isLightingConfig(value.config)
  );
}

function isLightingConfig(value: unknown): value is LightingConfig {
  if (!isRecord(value) || !isRecord(value.color)) return false;
  return (
    isIntegerBetween(value.mode, 0, 0x13) &&
    isIntegerBetween(value.color.red, 0, 255) &&
    isIntegerBetween(value.color.green, 0, 255) &&
    isIntegerBetween(value.color.blue, 0, 255) &&
    typeof value.rainbow === "boolean" &&
    isIntegerBetween(value.brightness, 0, 5) &&
    isIntegerBetween(value.speed, 0, 5) &&
    isIntegerBetween(value.direction, 0, 3)
  );
}

function isIntegerBetween(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
