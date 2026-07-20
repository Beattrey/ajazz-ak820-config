# Lighting and sleep

[Learning index](README.md)

## Lighting transaction

A complete lighting update uses four 64-byte feature reports on the control
interface:

1. START (`0x04 0x18`)
2. MODE_PREAMBLE (`0x04 0x13`)
3. MODE_DATA, whose first byte is the effective effect number
4. FINISH (`0x04 0xF0`)

GET-feature handshakes occur after the three `0x04` control reports only. There
must be no read after MODE_DATA. The rationale and transport rule live in
[Hardware and transport](hardware-and-transport.md#handshake-rule).

## Configuration semantics

The verified packet controls a whole-keyboard effect, color, brightness, speed,
rainbow flag, and supported direction. It does not expose a verified per-key
color map, so clickable per-key RGB editing would be misleading.

- Brightness and speed are levels 0 through 5.
- Off is transmitted as SingleOn with brightness and speed zero.
- Static is transmitted as Breath with speed zero.
- Direction is shown only for effects with known direction support.
- Reference sources disagree on numeric Up/Down mapping; physical confirmation
  remains required.

## Sleep transaction

Sleep uses START, SLEEP_PREAMBLE (`0x04 0x17 0x01`), and an unnumbered data
packet. Byte 8 of the data packet is:

| Setting | Value |
|---|---|
| Never | `0` |
| 1 minute | `1` |
| 5 minutes | `2` |
| 30 minutes | `3` |

The unnumbered data packet must not receive a GET-feature handshake.

## Presets and preview

Presets are versioned, browser-local `LightingConfig` objects supporting save,
load, rename, delete, and apply. Applying a preset runs the same four-report
transaction as direct controls.

The virtual keyboard previews whole-board behavior only. It reacts to color,
brightness, Off, Rainbow, Breath, and representative animation classes without
claiming unverified per-key programmability.

## What failed

Treating MODE_DATA like a normal `0x04` control report and reading a feature
response afterward can terminate the update. The fix is report-aware
handshaking, not additional delay or retry logic.

## Remaining hardware checks

- Confirm Off and Static normalization on the LEDs.
- Confirm Up/Down direction.
- Confirm persistence across reconnect and power cycle.
- Confirm sleep timing and wake behavior.

The full checklist is in [Validation](validation.md#hardware-release-checklist).
