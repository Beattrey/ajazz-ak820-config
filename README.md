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

Also implemented:

- RGB lighting effects, color, brightness, speed, rainbow, and direction.
- A responsive virtual AK820 Pro keyboard that previews the selected whole-board lighting.
- Browser-local lighting presets.
- Lighting sleep timeout.
- Shared device-operation locking across time, image, and lighting actions.

Not implemented: key remapping and macro recording; their device protocols
still require hardware capture and safe restoration research.

## Limits

- Static image: PNG / JPEG / WebP, up to **10 MB**.
- Animated GIF: up to **20 MB**, max **2048 × 2048 px**, max **256 frames**, total decoded patch pixels ≤ 50 M.
- All images are aspect-fitted to 128 × 128. Opaque images use dominant-color padding; images containing transparency use black because RGB565 has no alpha channel.

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
- `src/ui/` — React panels (Connect, TimeSync, Lighting, Image).
- `src/storage/` — versioned browser-local lighting preset persistence.
- `src/operations.ts` — high-level time, lighting, sleep, and image orchestration.

See [`docs/protocol-notes.md`](docs/protocol-notes.md) for byte-level protocol details and [`docs/manual-test.md`](docs/manual-test.md) for the hardware test plan.

## Credits

Protocol details derived from these reverse-engineering projects:

- [gohv/EPOMAKER-Ajazz-AK820-Pro](https://github.com/gohv/EPOMAKER-Ajazz-AK820-Pro) — time sync, AK820-Pro-specific.
- [aar-rafi/aks075-linux](https://github.com/aar-rafi/aks075-linux) — image upload, AKS075 sibling keyboard.
- [TaxMachine/ajazz-keyboard-software-linux](https://github.com/TaxMachine/ajazz-keyboard-software-linux) — AK820 Pro cross-check.

## License

MIT — see [LICENSE](LICENSE).
