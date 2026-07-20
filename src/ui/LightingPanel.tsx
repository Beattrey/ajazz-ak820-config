import { type CSSProperties, useMemo, useState } from "react";
import { useDeviceSession } from "../device/DeviceSession";
import { setLighting, setLightingSleepTime } from "../operations";
import {
  type LightingConfig,
  LightingDirection,
  type LightingLevel,
  LightingMode,
} from "../protocol/lighting";
import { LightingSleepTime, type LightingSleepTime as SleepTime } from "../protocol/lighting-sleep";
import {
  loadLightingPresets,
  saveLightingPresets,
  type LightingPreset,
} from "../storage/lighting-presets";

const MODE_OPTIONS = [
  [LightingMode.Off, "Off"],
  [LightingMode.Static, "Static"],
  [LightingMode.SingleOn, "Single on"],
  [LightingMode.SingleOff, "Single off"],
  [LightingMode.Glittering, "Glittering"],
  [LightingMode.Falling, "Falling"],
  [LightingMode.Colourful, "Colourful"],
  [LightingMode.Breath, "Breath"],
  [LightingMode.Spectrum, "Spectrum"],
  [LightingMode.Outward, "Outward"],
  [LightingMode.Scrolling, "Scrolling"],
  [LightingMode.Rolling, "Rolling"],
  [LightingMode.Rotating, "Rotating"],
  [LightingMode.Explode, "Explode"],
  [LightingMode.Launch, "Launch"],
  [LightingMode.Ripples, "Ripples"],
  [LightingMode.Flowing, "Flowing"],
  [LightingMode.Pulsating, "Pulsating"],
  [LightingMode.Tilt, "Tilt"],
  [LightingMode.Shuttle, "Shuttle"],
] as const;

const DEFAULT_CONFIG: LightingConfig = {
  mode: LightingMode.Static,
  color: { red: 255, green: 0, blue: 0 },
  rainbow: false,
  brightness: 5,
  speed: 3,
  direction: LightingDirection.Left,
};

const KEY_ROWS = [
  [
    ["Esc"],
    ["gap-after-esc", 0.75],
    ["F1"],
    ["F2"],
    ["F3"],
    ["F4"],
    ["gap-after-f4", 0.5],
    ["F5"],
    ["F6"],
    ["F7"],
    ["F8"],
    ["gap-after-f8", 0.5],
    ["F9"],
    ["F10"],
    ["F11"],
    ["F12"],
    ["gap-before-delete", 1],
    ["Del"],
  ],
  [
    ["`"],
    ["1"],
    ["2"],
    ["3"],
    ["4"],
    ["5"],
    ["6"],
    ["7"],
    ["8"],
    ["9"],
    ["0"],
    ["-"],
    ["="],
    ["Back", 2],
    ["gap-before-pgup", 0.75],
    ["PgUp"],
  ],
  [
    ["Tab", 1.5],
    ["Q"],
    ["W"],
    ["E"],
    ["R"],
    ["T"],
    ["Y"],
    ["U"],
    ["I"],
    ["O"],
    ["P"],
    ["["],
    ["]"],
    ["\\", 1.5],
    ["gap-before-pgdn", 0.75],
    ["PgDn"],
  ],
  [
    ["Caps", 1.75],
    ["A"],
    ["S"],
    ["D"],
    ["F"],
    ["G"],
    ["H"],
    ["J"],
    ["K"],
    ["L"],
    [";"],
    ["'"],
    ["Enter", 2.25],
    ["gap-before-home", 0.75],
    ["Home"],
  ],
  [
    ["Shift", 2.25],
    ["Z"],
    ["X"],
    ["C"],
    ["V"],
    ["B"],
    ["N"],
    ["M"],
    [","],
    ["."],
    ["/"],
    ["Shift", 1.75],
    ["gap-before-up", 0.75],
    ["Up"],
    ["End"],
  ],
  [
    ["Ctrl", 1.25],
    ["Win", 1.25],
    ["Alt", 1.25],
    ["Space", 6.25],
    ["Alt Gr", 1.25],
    ["Fn", 1.25],
    ["R Ctrl", 1.25],
    ["Left"],
    ["Down"],
    ["Right"],
  ],
] as const;

export function LightingPanel() {
  const { controller, connected, activeOperation, runOperation } = useDeviceSession();
  const [config, setConfig] = useState<LightingConfig>(DEFAULT_CONFIG);
  const [sleepTime, setSleepTime] = useState<SleepTime>(LightingSleepTime.Never);
  const [status, setStatus] = useState<string | null>(null);
  const [presets, setPresets] = useState<LightingPreset[]>(() => loadLightingPresets());
  const [selectedPresetId, setSelectedPresetId] = useState("");
  const [presetName, setPresetName] = useState("");
  const selectedPreset = presets.find((preset) => preset.id === selectedPresetId) ?? null;
  const directionOptions = useMemo(() => directionsForMode(config.mode), [config.mode]);
  const busy = activeOperation !== null;
  const applyingLighting = activeOperation === "lighting";

  const updateConfig = <K extends keyof LightingConfig>(key: K, value: LightingConfig[K]) =>
    setConfig((current) => ({ ...current, [key]: value }));

  const changeMode = (mode: LightingMode) => {
    const supportedDirections = directionsForMode(mode);
    setConfig((current) => ({
      ...current,
      mode,
      direction: supportedDirections[0]?.[0] ?? current.direction,
    }));
  };

  const applyLighting = async (value: LightingConfig = config) => {
    setStatus("Applying lighting…");
    try {
      await runOperation("lighting", () => setLighting(controller, value));
      setStatus("Lighting applied");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Lighting update failed");
    }
  };

  const applySleep = async () => {
    setStatus("Applying sleep timeout…");
    try {
      await runOperation("lighting sleep", () => setLightingSleepTime(controller, sleepTime));
      setStatus("Sleep timeout applied");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Sleep timeout update failed");
    }
  };

  const persist = (next: LightingPreset[], success: string) => {
    try {
      saveLightingPresets(next);
      setPresets(next);
      setStatus(success);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save presets");
    }
  };

  const savePreset = () => {
    const name = presetName.trim();
    if (!name) {
      setStatus("Enter a preset name.");
      return;
    }
    const id = globalThis.crypto?.randomUUID?.() ?? `preset-${Date.now()}`;
    const preset = { id, name, config };
    persist([...presets, preset], "Preset saved");
    setSelectedPresetId(id);
  };

  const renamePreset = () => {
    if (!selectedPreset) return;
    const name = presetName.trim();
    if (!name) {
      setStatus("Enter a preset name.");
      return;
    }
    persist(
      presets.map((preset) => (preset.id === selectedPreset.id ? { ...preset, name } : preset)),
      "Preset renamed",
    );
  };

  const deletePreset = () => {
    if (!selectedPreset) return;
    persist(
      presets.filter((preset) => preset.id !== selectedPreset.id),
      "Preset deleted",
    );
    setSelectedPresetId("");
    setPresetName("");
  };

  const selectPreset = (id: string) => {
    setSelectedPresetId(id);
    const preset = presets.find((item) => item.id === id);
    if (preset) {
      setConfig(preset.config);
      setPresetName(preset.name);
    }
  };

  return (
    <section className="panel lighting-panel">
      <KeyboardPreview config={config} />
      <div className="lighting-editor">
        <fieldset className="lighting-controls" disabled={busy}>
          <label className="control-effect">
            Effect
            <select
              aria-label="Lighting effect"
              value={config.mode}
              onChange={(event) => changeMode(Number(event.target.value) as LightingMode)}
            >
              {MODE_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="control-color">
            Color
            <input
              aria-label="Lighting color"
              type="color"
              value={rgbToHex(config.color)}
              onChange={(event) => updateConfig("color", hexToRgb(event.target.value))}
            />
          </label>
          <label className="checkbox-label control-rainbow">
            <input
              type="checkbox"
              checked={config.rainbow}
              onChange={(event) => updateConfig("rainbow", event.target.checked)}
            />
            Rainbow
          </label>
          <LevelSelect
            label="Brightness"
            value={config.brightness}
            onChange={(value) => updateConfig("brightness", value)}
          />
          <LevelSelect
            label="Speed"
            value={config.speed}
            onChange={(value) => updateConfig("speed", value)}
          />
          {directionOptions.length > 0 && (
            <label>
              Direction
              <select
                aria-label="Direction"
                value={config.direction}
                onChange={(event) =>
                  updateConfig("direction", Number(event.target.value) as LightingDirection)
                }
              >
                {directionOptions.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            className="primary-action"
            disabled={!connected || busy}
            aria-busy={applyingLighting}
            onClick={() => applyLighting()}
          >
            {applyingLighting ? "Applying lighting…" : "Apply lighting"}
          </button>
        </fieldset>
        {status && (
          <p className="lighting-feedback" role="status" aria-live="polite">
            {status}
          </p>
        )}

        <div className="subsection presets-section">
          <h3>Presets</h3>
          <label>
            Saved preset
            <select
              aria-label="Saved preset"
              value={selectedPresetId}
              onChange={(event) => selectPreset(event.target.value)}
            >
              <option value="">Select a preset</option>
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Preset name
            <input
              aria-label="Preset name"
              value={presetName}
              onChange={(event) => setPresetName(event.target.value)}
            />
          </label>
          <div className="button-row">
            <button type="button" onClick={savePreset}>
              Save new
            </button>
            <button type="button" disabled={!selectedPreset} onClick={renamePreset}>
              Rename
            </button>
            <button type="button" disabled={!selectedPreset} onClick={deletePreset}>
              Delete
            </button>
            <button
              type="button"
              disabled={!connected || busy || !selectedPreset}
              onClick={() => selectedPreset && applyLighting(selectedPreset.config)}
            >
              {applyingLighting ? "Applying preset…" : "Apply preset"}
            </button>
          </div>
        </div>

        <div className="subsection sleep-section">
          <h3>Sleep timeout</h3>
          <label>
            Turn lighting off after
            <select
              aria-label="Lighting sleep timeout"
              value={sleepTime}
              disabled={busy}
              onChange={(event) => setSleepTime(Number(event.target.value) as SleepTime)}
            >
              <option value={LightingSleepTime.Never}>Never</option>
              <option value={LightingSleepTime.OneMinute}>1 minute</option>
              <option value={LightingSleepTime.FiveMinutes}>5 minutes</option>
              <option value={LightingSleepTime.ThirtyMinutes}>30 minutes</option>
            </select>
          </label>
          <button type="button" disabled={!connected || busy} onClick={applySleep}>
            Apply sleep timeout
          </button>
        </div>
      </div>
    </section>
  );
}

function KeyboardPreview({ config }: { config: LightingConfig }) {
  const color = rgbToHex(config.color);
  const effectClass = previewEffectClass(config.mode);
  const reverse =
    config.direction === LightingDirection.Right || config.direction === LightingDirection.Down;
  const previewStyle = {
    "--key-light": color,
    "--key-brightness": config.mode === LightingMode.Off ? 0 : config.brightness / 5,
    "--effect-speed": `${1.8 - config.speed * 0.22}s`,
  } as CSSProperties;

  return (
    <div
      role="img"
      className={`keyboard-preview ${effectClass}${config.rainbow ? " is-rainbow" : ""}${reverse ? " is-reversed" : ""}`}
      style={previewStyle}
      aria-label={`Virtual AK820 Pro lighting preview, ${MODE_OPTIONS.find(([mode]) => mode === config.mode)?.[1] ?? "unknown"} effect, ${color}`}
    >
      <div className="keyboard-preview-header">
        <span>AK820 PRO</span>
        <span className="keyboard-screen">RGB</span>
        <span className="keyboard-knob" aria-hidden="true" />
      </div>
      <div className="keyboard-keys" aria-hidden="true">
        {KEY_ROWS.map((row, rowIndex) => (
          <div className="keyboard-row" key={row.map(([label]) => label).join("-")}>
            {row.map(([label, width = 1], columnIndex) => (
              <span
                className={label.startsWith("gap-") ? "keyboard-spacer" : "keyboard-key"}
                style={
                  {
                    flexGrow: width,
                    "--key-index": columnIndex,
                    "--row-index": rowIndex,
                    "--distance": Math.abs(columnIndex - 6.5) + Math.abs(rowIndex - 2.5),
                  } as CSSProperties
                }
                key={`${label}-${width}`}
              >
                {label.startsWith("gap-") ? "" : label}
              </span>
            ))}
          </div>
        ))}
      </div>
      <p>Whole-keyboard preview · changes are sent only when you press Apply lighting.</p>
    </div>
  );
}

function previewEffectClass(mode: LightingMode): string {
  if (mode === LightingMode.Off || mode === LightingMode.Static) return "is-static";
  if (mode === LightingMode.Breath || mode === LightingMode.Pulsating) return "is-breathing";
  if (mode === LightingMode.Glittering) return "is-glittering";
  if (mode === LightingMode.Colourful || mode === LightingMode.Spectrum) return "is-rainbow";
  if (
    mode === LightingMode.Outward ||
    mode === LightingMode.Explode ||
    mode === LightingMode.Ripples
  ) {
    return "is-radial";
  }
  if (mode === LightingMode.Falling) return "is-falling";
  if (mode === LightingMode.SingleOn || mode === LightingMode.SingleOff) return "is-reactive";
  if (mode === LightingMode.Scrolling) return "is-scrolling";
  return "is-wave";
}

function LevelSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: LightingLevel;
  onChange(value: LightingLevel): void;
}) {
  return (
    <label className="range-control">
      <span>
        {label}
        <span className="range-value" aria-hidden="true">
          {value}
        </span>
      </span>
      <input
        aria-label={label}
        type="range"
        min={0}
        max={5}
        step={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value) as LightingLevel)}
      />
    </label>
  );
}

function directionsForMode(mode: LightingMode): readonly (readonly [LightingDirection, string])[] {
  if (mode === LightingMode.Scrolling) {
    return [
      [LightingDirection.Up, "Up"],
      [LightingDirection.Down, "Down"],
    ];
  }
  if (
    mode === LightingMode.Rolling ||
    mode === LightingMode.Flowing ||
    mode === LightingMode.Tilt
  ) {
    return [
      [LightingDirection.Left, "Left"],
      [LightingDirection.Right, "Right"],
    ];
  }
  return [];
}

function rgbToHex(color: LightingConfig["color"]): string {
  return `#${[color.red, color.green, color.blue]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

function hexToRgb(hex: string): LightingConfig["color"] {
  return {
    red: Number.parseInt(hex.slice(1, 3), 16),
    green: Number.parseInt(hex.slice(3, 5), 16),
    blue: Number.parseInt(hex.slice(5, 7), 16),
  };
}
