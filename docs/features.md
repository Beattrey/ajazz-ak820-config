# Feature roadmap

This roadmap extends the AJAZZ AK820 Pro configurator while preserving its
current architecture and macOS compatibility.

## Technical constraints

- The application must remain fully web-based and run in a Chromium browser on
  macOS, Windows, and Linux.
- New application code must use the existing TypeScript, React, CSS, and WebHID
  stack. Do not introduce another programming language or a native companion
  application.
- Keyboard communication must continue through browser WebHID APIs.
- Image processing, configuration, and preset storage must remain local to the
  browser. No server is required.
- Features must not depend on the Windows-only AJAZZ driver at runtime.
- Reverse-engineered protocol details may be researched from other projects,
  but their Rust, C++, or Python implementations must be reimplemented and
  tested in TypeScript rather than added as application dependencies.
- Unsupported browsers must continue to receive a clear WebHID compatibility
  message.

## RGB lighting

### Protocol foundation

- [x] Document the AK820 Pro lighting packet layout in `protocol-notes.md`.
- [x] Add TypeScript types for lighting mode, RGB color, rainbow mode,
      brightness, speed, and direction.
- [x] Add a pure packet builder for the lighting-mode preamble (`0x13`).
- [x] Add a pure packet builder for the 64-byte lighting data report.
- [x] Validate brightness and speed as discrete values from 0 through 5.
- [x] Encode the firmware-specific handling for static and off modes.
- [x] Add byte-exact unit tests for normal, boundary, static, and off packets.

### Device operation

- [x] Add a `setLighting` operation using the existing `DeviceController`.
- [x] Send the confirmed `START -> MODE -> DATA -> FINISH` transaction.
- [x] Retain the inter-packet timing and feature-report handshakes required by
      the keyboard firmware.
- [x] Add mock-controller tests for packet order, values, and transfer errors.
- [ ] Verify static red, lights off, and a rainbow effect on real hardware.
- [ ] Record whether lighting survives reload, reconnect, connection-mode
      changes, and a keyboard power cycle.

### Lighting interface

- [x] Add a React lighting panel with an effect selector, HTML color picker,
      rainbow toggle, and Apply button.
- [x] Support the keyboard's 20 known built-in lighting effects.
- [x] Add discrete brightness and speed controls with levels 0 through 5.
- [x] Show direction controls only for effects that support them:
      scrolling uses up/down; rolling, flowing, and tilt use left/right.
- [x] Disable controls while a lighting transaction is running.
- [x] Display validation, disconnection, and transfer failures in the panel.
- [x] Add React component tests for mode-dependent controls and submission.

### Browser presets

- [x] Allow a user to name and save a lighting configuration.
- [x] Store presets locally with the browser `localStorage` API.
- [x] Allow saved presets to be applied, renamed, and deleted.
- [x] Version and validate stored preset data before loading it.
- [x] Keep presets origin-local and make no network requests.

## Lighting sleep timeout

- [x] Document the sleep preamble (`0x17`) and sleep-data report.
- [x] Add TypeScript packet builders for never, 1 minute, 5 minutes, and
      30 minutes.
- [x] Add byte-exact protocol tests for all four values.
- [x] Add a `setLightingSleepTime` operation using `DeviceController`.
- [x] Add a React selector and Apply button to the lighting panel.
- [ ] Verify the one-minute setting on physical hardware.

## Shared device-operation safety

- [x] Replace independent panel busy states with a shared device-operation
      lock or shared application state.
- [x] Prevent time sync, lighting changes, sleep changes, and image uploads
      from overlapping.
- [x] Release the operation lock after success, failure, timeout, or physical
      disconnection.
- [x] Show the active operation consistently across all panels.
- [x] Add tests for rejected overlapping operations and disconnect recovery.

## Key remapping research

Key remapping is not ready for direct implementation because its AK820 Pro
packet format and physical-key indexes are not yet confirmed. Research must not
add a Windows runtime dependency to this application.

- [ ] Record the keyboard product ID, firmware version, and ANSI or ISO layout.
- [ ] Capture one-change-at-a-time USB traffic from the matching official
      driver in an isolated Windows research environment.
- [ ] Determine the command preamble, physical-key index, HID usage encoding,
      layer/profile index, save command, and any checksum.
- [ ] Create anonymized byte fixtures containing no official driver binaries.
- [ ] Reproduce one captured single-key remap with a temporary TypeScript and
      WebHID research module.
- [ ] Confirm that the mapping persists and can be restored to its original
      value.
- [ ] Document separate key-index tables for every supported ANSI and ISO
      layout; never assume that indexes are interchangeable.
- [ ] Only after hardware confirmation, add pure TypeScript packet builders,
      unit tests, and a React keyboard-layout editor.
- [ ] Provide a reset-to-default action before exposing bulk remapping.

## Macro research

Macros must remain disabled until their storage and playback protocol is
confirmed independently from ordinary key remapping.

- [ ] Capture a minimal two-keystroke macro created by the official driver.
- [ ] Identify macro slot IDs, key press/release encoding, delays, maximum
      length, assignment packets, and persistence behavior.
- [ ] Verify replay and removal through a temporary TypeScript/WebHID module.
- [ ] Define conservative length and delay limits before exposing macros in the
      UI.
- [ ] Add a React macro editor only after byte-exact fixtures and real-hardware
      restoration tests exist.
- [ ] Require an explicit confirmation before overwriting an occupied macro
      slot.

## Recommended delivery order

1. RGB protocol builders and tests.
2. Minimal RGB panel: effect, color, rainbow, and Apply.
3. Brightness, speed, and mode-aware direction controls.
4. Browser-local lighting presets.
5. Lighting sleep timeout.
6. Shared device-operation safety and recovery improvements.
7. Key-remapping protocol research and single-key proof of concept.
8. Layout-aware remapping interface.
9. Macro protocol research and, if confirmed safe, a macro interface.

Each delivery must pass TypeScript checks, unit/component tests, a production
Vite build, and the relevant real-keyboard checks in `manual-test.md` using a
Chromium browser on macOS.
