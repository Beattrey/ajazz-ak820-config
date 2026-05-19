# Manual Test Plan — AK820 Pro Configurator

Run with the real keyboard plugged in via USB-C (wired mode preferred for first test).

## Pre-flight

- Browser: Chrome stable (>= 134) or Edge stable.
- Keyboard: AJAZZ AK820 Pro, plugged in via USB-C, **wired mode** switch.
- Dev server running (`npm run dev`) and page open at `http://localhost:5173/ajazz-ak820-config/`.

## Tests

### T1 — Connection

1. Click **Connect keyboard**.
2. WebHID picker appears; select "AJAZZ AK820 Pro" (or equivalent label).
3. UI shows "Status: Connected".

Pass criteria: no error toast, panels become enabled.

### T2 — Time sync

1. Click **Sync now** in the Time panel.
2. Observe the TFT screen.

Pass criteria: TFT clock updates to host system time within ~1 minute.

### T3 — Static image

1. Pick a PNG file ~512×512.
2. Confirm the preview canvas shows the cropped 128×128 version.
3. Click **Upload to keyboard**.
4. Observe TFT.

Pass criteria: progress bar advances to 100%, image appears on TFT (orientation, colors, aspect should match preview).

### T4 — Static image — non-square

1. Pick a PNG that is 1000×400 (wide).
2. Verify preview is a center-cropped square.
3. Upload.

Pass criteria: TFT shows the same crop as preview.

### T5 — Animated GIF

1. Pick a small GIF (~3-10 frames).
2. Preview shows first frame.
3. Upload.

Pass criteria: TFT animates with timings approximately matching the GIF.

### T6 — Disconnect mid-upload

1. Start uploading a GIF (T5).
2. Unplug USB during upload.
3. UI shows error, progress halts.
4. Re-plug, click Connect, retry upload.

Pass criteria: app recovers cleanly; second upload succeeds.

### T7 — Re-visit

1. Close the tab.
2. Reopen the URL.
3. Click Connect.

Pass criteria: no permission re-prompt (origin-scoped permission persists).

## Known protocol risks

The protocol byte layouts in `src/protocol/image.ts` use the AKS075/Windows-driver framing (sub-command `0x03`, 4096-byte chunks, 256-byte frame header). If T3/T4/T5 fail, the alternative gohv/AK820-Pro framing is documented in `docs/protocol-notes.md` under "gohv / AK820 Pro alternate framing" (sub-command `0x02`, 4123-byte chunks, no 256-byte header, plus a `FINISH` packet `04 F0` at the end). Adjusting `src/protocol/image.ts` to that framing requires updating the corresponding fixture in `src/protocol/__tests__/`.

If T2 fails, the time-sync layout is unambiguous across all three reference repos — first check WebHID permission and that the keyboard is in wired mode, not the keyboard protocol.
