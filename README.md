# AJAZZ AK820 Pro Web Configurator

A browser-based tool to configure the AJAZZ AK820 Pro mechanical keyboard. Syncs system time and uploads static or animated images to the keyboard's 128×128 TFT screen via WebHID — no native install required.

**Live:** <https://beattrey.github.io/ajazz-ak820-config/>

## Requirements

- **Browser**: Chrome / Edge / Opera / Arc (any Chromium ≥ 89). Safari and Firefox are not supported — they do not implement WebHID.
- **Connection**: USB-C in **wired** mode. The keyboard's vendor HID interface (used for time sync and image upload) is only exposed over USB; Bluetooth and the 2.4 GHz dongle do not expose it.
- **OS**: any — Chrome's WebHID works the same on macOS, Linux, and Windows.

## Usage

1. Plug the keyboard in via USB-C and set its mode switch to **wired**.
2. Open <https://beattrey.github.io/ajazz-ak820-config/> in Chrome or Edge.
3. Click **Connect keyboard** and grant permission in the device picker.
4. Use the **Time** and **Image** panels.

## Status

Implemented:

- System time sync to the TFT clock.
- Static image upload — PNG / JPEG / WebP.
- Animated GIF upload — alpha-aware compositing, GIF disposal methods 0/1/2/3 honored.

Not implemented:

- Key remapping
- RGB lighting profiles
- Macro recording

## Tested hardware

This support was **physically tested** on a real unit:

- **Keyboard**: Ajazz AK820 Pro (USB product string `AK820`)
- **USB VID / PID**: `0x0C45` / `0x800A`
- **Environment**: macOS + Chromium (WebHID)

`0x800A` is a newer hardware/firmware revision that enumerates with a different
product ID than the previously known `0x8009` while exposing the same vendor HID
interfaces. It was added to the device picker so Chrome offers it.

**Hardware-verified on this unit** (observed directly over WebHID):

| Item | Value |
|---|---|
| Control interface usage page | `0xFF13`, 64-byte reports, report ID 0 |
| Data interface usage page | `0xFF68`, 4096-byte output report, report ID 0 |
| Per-chunk ACK | `01 5A 02 00 00 00 00 00 …` |
| Static upload | 128×128 RGB565 LE, `IMAGE_CFG` sub `0x02`, 9×4096-byte chunks, per-chunk ACK, `FINISH 0xF0`; image persists across power-cycle |
| Animated upload | 256-byte frame header, RGB565 LE frames, `IMAGE_CFG` sub `0x03`, 4096-byte chunks, per-chunk ACK, `SAVE 0x02` (no FINISH); a real 18-frame GIF (145 chunks) persisted across power-cycle |

**Revision-specific**: on this unit, `Fn + Del` toggles the TFT between the
default screen and the custom image/GIF. This shortcut may differ by hardware
revision or manual.

The byte-level protocol itself is **derived from the reference implementations**
cited in [`docs/protocol-notes.md`](docs/protocol-notes.md) (gohv, aks075-linux,
TaxMachine); this contribution verifies it against the `0x800A` revision and adds
device-picker support, safer ACK handling, and image/GIF preprocessing. Behaviour
on other revisions or PIDs is **not** claimed as tested.

## Limits

- Static image: PNG / JPEG / WebP, up to **10 MB**.
- Animated GIF: up to **20 MB**, max **2048 × 2048 px**, max **20 frames**, total decoded patch pixels ≤ 50 M.
- All images are center-cropped and downscaled to 128 × 128 (the TFT's native resolution).

## Security

This page talks to your keyboard via WebHID. Chrome grants the permission **persistently** until you revoke it at `chrome://settings/content/hid`. The page makes no network requests — image processing and HID transport happen entirely in the browser.

The bundle ships with a strict Content-Security-Policy: no inline scripts, no third-party origins, no framing, no form submission.

## Development

```bash
npm install
npm run dev      # opens http://localhost:5173/ajazz-ak820-config/
npm run test     # unit + component tests
npm run build    # production build
```

## Architecture

- `src/protocol/` — pure byte-builder functions; fully unit-tested against byte-level fixtures.
- `src/image/` — File → RGB565 buffer transformations (static and animated).
- `src/device/` — WebHID-backed `DeviceController` plus a `MockDeviceController` for tests.
- `src/ui/` — React panels (Connect, TimeSync, Image).
- `src/operations.ts` — high-level orchestration (`syncTime`, `uploadStaticImage`, `uploadAnimatedImage`).

See [`docs/protocol-notes.md`](docs/protocol-notes.md) for byte-level protocol details and [`docs/manual-test.md`](docs/manual-test.md) for the hardware test plan.

## Credits

Protocol details derived from these reverse-engineering projects:

- [gohv/EPOMAKER-Ajazz-AK820-Pro](https://github.com/gohv/EPOMAKER-Ajazz-AK820-Pro) — time sync, AK820-Pro-specific.
- [aar-rafi/aks075-linux](https://github.com/aar-rafi/aks075-linux) — image upload, AKS075 sibling keyboard.
- [TaxMachine/ajazz-keyboard-software-linux](https://github.com/TaxMachine/ajazz-keyboard-software-linux) — AK820 Pro cross-check.

## License

MIT — see [LICENSE](LICENSE).
