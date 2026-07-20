# How the AK820 Pro configurator works

## Hardware overview

The AK820 Pro's 0.85" TFT is a 128 × 128 GC9107-driven panel attached to a
Sonix SN32F299 MCU. It exposes two vendor-specific HID interfaces that the
browser can reach through WebHID:

- **Control interface** — usage page `0xFF13`, interface `3`. Carries 64-byte
  feature reports that select the operation (START, IMAGE_CFG, SAVE) and
  provide metadata such as chunk counts.
- **Data interface** — usage page `0xFF68`, interface `2`. Carries the actual
  image payload as 4096-byte output reports. The firmware expects an ACK input
  report after every chunk; without it, flash writes are dropped.

Both interfaces are only available while the keyboard is in **wired USB-C
mode**. Bluetooth and the 2.4 GHz dongle do not expose the vendor HID
endpoints used for screen control.

## RGB lighting transaction

Lighting uses the control interface only. A complete update is four 64-byte
feature reports: START (`0x04 0x18`), MODE_PREAMBLE (`0x04 0x13`), MODE_DATA,
and FINISH (`0x04 0xF0`). MODE_DATA starts with the effective effect number
rather than the `0x04` control prefix.

The firmware accepts GET-feature handshakes for the three `0x04` control
reports. It does not accept the same read after MODE_DATA. The browser operation
branches on the logical report ID and skips that read for mode data. Lighting
presets are browser-local saved `LightingConfig` objects; applying one runs this
same hardware transaction.

The verified packet controls a whole-keyboard effect, color, brightness, speed,
rainbow flag, and supported direction. It does not provide a verified per-key
color map. The virtual keyboard is consequently a whole-board preview.

Off is sent as SingleOn with brightness and speed zero. Static is sent as Breath
with speed zero. Brightness and speed are levels 0 through 5. The references
disagree on the numeric Up/Down mapping, so that remains a hardware check.

## Lighting sleep transaction

Sleep timeout uses START, SLEEP_PREAMBLE (`0x04 0x17 0x01`), then an unnumbered
data packet. Its byte-8 enum is never = 0, one minute = 1, five minutes = 2, and
thirty minutes = 3. The unnumbered sleep-data packet must not receive a
GET-feature handshake.

## Image format on the wire

The TFT has no alpha channel. Every frame is encoded as **RGB565
little-endian**, row-major, with no row padding:

- 5 bits red, 6 bits green, 5 bits blue.
- Pixel formula: `((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)`.
- Stored as `[low_byte, high_byte]` per pixel.
- Total frame size: `128 * 128 * 2 = 32768` bytes.

## Browser-side image pipeline

Before any bytes reach the keyboard, the browser processes the source file
entirely locally:

1. **Decode** — `createImageBitmap` (static) or `gifuct-js` (animated GIF)
   produces raw RGBA pixels.
2. **Resize** — `containResizeRgba` scales the complete source into 128 × 128
   while preserving aspect ratio. No cropping is performed; the entire source
   remains visible.
3. **Background fill** — Opaque images get their unused space filled with the
   dominant displayed color. The color is selected from 5-bit RGB histogram
   buckets so JPEG noise and near-identical shades are grouped together.
   Transparent sources skip this step; transparent pixels resolve to black at
   the RGB565 conversion boundary.
4. **Convert** — `rgb888ToRgb565` maps each RGBA pixel to its 16-bit RGB565
   little-endian representation.

For animated GIFs, step 1 also includes per-frame compositing that honors GIF
disposal methods (keep canvas, restore background, restore previous) and
skips transparent pixels so placeholder RGB values do not leak into the
output.

## Transport protocol (AKS075 / Windows-driver framing)

The working framing was derived from USB capture of the official Windows driver
(`DeviceDriver.exe`), decompiled via Ghidra, and confirmed by the
`aar-rafi/aks075-linux` project. The legacy gohv-style static path (no
header, `FINISH` = `0xF0`) produces a brief flash followed by white because
`0xF0` resets the TFT player state instead of committing the image.

A complete static or animated upload follows this sequence:

### 1. START — `04 18 00 ... 00` (byte 7 = `0x00`)

Opens the image-transfer state machine. The enable flag is **zero** for image
transfers (time sync uses `0x01`).

### 2. IMAGE_CFG — `04 72 03 ...` (sub-command = `0x03`, bytes 8-9 = chunk count)

Tells the firmware to expect image data. Sub-command `0x03` selects the
AKS075/Windows-driver parser; `0x02` selects the gohv path, which does not
persist reliably on AK820 Pro firmware. Bytes 8-9 encode the total chunk count
as uint16 little-endian.

### 3. Data chunks — 4096-byte output reports on interface 2

Each chunk is sent with `sendReport(reportId = 0, bytes)`. The firmware sends
an ACK input report after every chunk; the host reads it back with a 300 ms
timeout before sending the next chunk. Without this read-back, flash writes
are silently dropped.

The payload layout depends on whether the upload is static or animated:

#### Static image payload

```
[256-byte frame header] + [32768 bytes RGB565 pixel data] + [0xFF padding]
```

The 256-byte header is required even for a single frame. Without it, the
firmware reads the first 256 bytes of pixel data as metadata and corrupts its
parser state.

| Header offset | Field | Value (static) |
|---|---|---|
| 0 | frame count | `0x01` |
| 1 | frame-0 delay | `0x00` (delay / 2; 0 means "static") |
| 2 – 255 | padding | `0xFF` |

Total payload size: `256 + 32768 = 33024` bytes.
Chunk count: `ceil(33024 / 4096) = 9`.

#### Animated image payload

```
[256-byte frame header] + [N * 32768 bytes RGB565 pixel data] + [0xFF padding]
```

Frames are concatenated back-to-back with no per-frame separator.

| Header offset | Field | Value (animated) |
|---|---|---|
| 0 | frame count | `N` (1 – 255) |
| 1 | frame-0 delay | `max(1, delay_ms_0 / 2)`, capped at 255 |
| 2 | frame-1 delay | `max(1, delay_ms_1 / 2)`, capped at 255 |
| ... | ... | ... |
| N | frame-(N-1) delay | `max(1, delay_ms_{N-1} / 2)`, capped at 255 |
| N+1 – 255 | padding | `0xFF` |

Total payload size: `256 + N * 32768` bytes.
Chunk count: `ceil((256 + N * 32768) / 4096)`.

### 4. SAVE — `04 02 00 ... 00` (byte 7 = `0x00`)

Commits the uploaded image to the keyboard's on-board flash. There is **no
enable flag** in the SAVE packet for image transfers. The legacy `FINISH`
command (`0xF0`) resets the TFT player state and must not be used after image
uploads.

## Timing and handshakes

The firmware requires short sleeps between control-channel feature reports
and expects the host to read back ACKs from the data channel after every
chunk. The current implementation uses:

- **50 ms** inter-packet delay between feature reports.
- **100 ms** post-SAVE delay before declaring success.
- **300 ms** ACK timeout per data chunk.

These values are derived from the reference implementations (`aks075-linux`
uses ~40 ms between feature reports; `gohv` uses 10 ms with 100 ms after
SAVE).

## WebHID adaptation

The three reference implementations disagree on whether the leading `0x04` in
control packets is a HID report ID or the first payload byte. The
`aks075-linux` project explicitly documents that the actual HID report ID is
`0x00` and `0x04` is the first payload byte. This codebase follows that
convention:

```typescript
// ReportMessage stores the payload bytes (starting with 0x04).
// WebHIDDeviceController.toUnnumberedWire prepends reportId = 0x00 for
// feature reports, and sends data reports with reportId = 0.
```

For data-interface output reports, the code sends `reportId = 0` with the raw
4096-byte chunk. WebHID dispatches these as interrupt OUT reports
automatically.

## Why the gohv static path fails

The gohv Rust project was the only reference that targeted AK820 Pro directly
for image upload, but its framing differs from the Windows driver in four
critical ways:

| Aspect | gohv (broken) | AKS075 / Windows (working) |
|---|---|---|
| START byte 7 | `0x01` | `0x00` |
| IMAGE_CFG sub-command | `0x02` | `0x03` |
| 256-byte frame header | absent | present (frame_count = 1) |
| Termination | `FINISH` (`0xF0`) | `SAVE` (`0x02`) |

The `FINISH` command restarts the TFT player rather than committing the
buffer, which is why the image flashes for a split second and then the
display reverts to white or the default animation. The animated path in this
codebase already uses the correct framing; the static path was the only
remaining user of the legacy gohv framing.
