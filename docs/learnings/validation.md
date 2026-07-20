# Validation record

[Learning index](README.md)

Validated on 2026-07-20 from the repository working tree.

## Automated checks

| Check | Result |
|---|---|
| `npm test` | Pass — 19 files, 115 tests |
| `npm run build` | Pass — TypeScript and Vite production bundle |
| `npm run lint` | Pass — 47 files, no errors |
| Desktop render | Pass — Chrome, 1440 × 1000 and large-screen mode at 1728 × 1100 |
| Narrow render | Responsive stacking checked at 390 × 844; cascade defects corrected |

The suite locks four lighting writes, three control-only GET-feature
handshakes, and no read after MODE_DATA. Sleep similarly performs no read after
its unnumbered data packet.

## Evidence boundary

This validates source, serialized packets, browser behavior, and layout. It is
not a substitute for observing the LEDs and TFT. Remaining physical checks are
in `docs/manual-test.md` and require wired USB-C mode.

## Hardware release checklist

- Apply Static red and confirm a steady whole-board result.
- Apply Off, Spectrum/Rainbow, and an animated directional mode.
- Confirm Up and Down match physical movement.
- Save, reload, and reapply a local preset.
- Confirm lighting across reconnect and power cycle.
- Confirm one-minute sleep and wake behavior.
- Re-run time sync and static/animated TFT uploads for shared-interface regressions.
