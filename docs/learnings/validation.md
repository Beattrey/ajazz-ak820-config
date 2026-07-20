# Validation record

Validated on 2026-07-20 from the repository working tree.

## Automated checks

| Check | Result |
|---|---|
| `npm test` | Pass — 18 files, 110 tests |
| `npm run build` | Pass — TypeScript and Vite production bundle |
| `npm run lint` | Pass — 46 files, no findings |
| Desktop render | Pass — Chrome, 1280 × 1000 |
| Narrow render | Pass at Chrome's minimum layout viewport; 600 px breakpoint active |

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
