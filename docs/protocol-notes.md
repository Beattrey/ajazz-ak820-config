# AJAZZ AK820 Pro — Protocol Notes

These are the concrete byte-level layouts and transport details for the AJAZZ
AK820 Pro keyboard's vendor HID protocol (time sync + 128×128 RGB565 TFT
image/GIF upload), extracted from three reference implementations.

Every value below is verified against a specific file:line in one of the three
source repositories. Where source disagrees with source, the disagreement is
documented in the cross-check section so downstream tasks can decide which
variant to implement and test against real hardware.

## Hardware verification (revision PID 0x800A)

The protocol below is derived from the three reference implementations. The
following items were **additionally verified directly over WebHID** on a
physical Ajazz AK820 Pro that enumerates as USB product `AK820`, VID `0x0C45`,
**PID `0x800A`** (a newer revision than the `0x8009` the references target),
running on macOS + Chromium:

- Vendor interfaces present and openable: control usage page **`0xFF13`**
  (64-byte reports, report ID 0) and data usage page **`0xFF68`** (declared
  **4096-byte** output report, report ID 0). This matches the `CHUNK_SIZE`
  and `PACKET_LENGTH` used below.
- Time sync (`START → TIME_PREAMBLE → TIME_DATA → SAVE 0x02`) accepted; the TFT
  clock updated. The GET-feature handshake returns 64 bytes on this unit.
- Static image: `IMAGE_CFG` sub `0x02`, 9×4096-byte chunks, per-chunk ACK,
  `FINISH 0xF0`. Per-chunk ACK observed as `01 5A 02 00 00 00 00 00 …`. Image
  displayed and persisted across a power-cycle.
- Animated image: 256-byte frame header, `IMAGE_CFG` sub `0x03`, 4096-byte
  chunks, per-chunk ACK, `SAVE 0x02` (no FINISH). A real 18-frame GIF (145
  chunks) displayed and persisted across a power-cycle.

Everything **not** in the list above remains reference-derived and is not
independently confirmed on this revision. Behaviour on other PIDs/revisions is
untested.

## Sources

- **gohv/EPOMAKER-Ajazz-AK820-Pro** (Rust) — `git HEAD = 156be82` — primary
  reference for time sync and static-image upload on AK820 Pro directly.
  Files used: `src/protocol.rs`, `src/usb.rs`, `src/device.rs`,
  `src/hidraw.rs`, `src/lcd.rs`, `99-ak820.rules`.
- **aar-rafi/aks075-linux** (Python + Ghidra-decompiled C) — `git HEAD = 79ba5de`
  — primary reference for image/GIF (sibling AKS075, same MCU family,
  same 128×128 TFT, same OEM/Sonix firmware). Files used: `aks075/protocol.py`,
  `aks075/image.py`, `aks075/device.py`, `docs/protocol.md`,
  `99-ajazz-aks075.rules`.
- **TaxMachine/ajazz-keyboard-software-linux** (C++) — `git HEAD = b73b02b`
  — cross-check for AK820 Pro control reports. Files used:
  `src/keyboards/ak820pro.cpp`, `src/keyboards/ak820pro.hpp`,
  `src/keyboards/keyboarddefs.hpp`.

## Device identification

| Field | Value | Source |
|---|---|---|
| Vendor ID (USB VID) | `0x0C45` (Microdia/Sonix) | `keyboarddefs.hpp:10`; `gohv/protocol.rs:4`; `aks075/device.py:7`; `99-ak820.rules:12` |
| Product ID — wired USB | `0x8009` | `keyboarddefs.hpp:11`; `gohv/protocol.rs:5`; `aks075/device.py:8`; `99-ak820.rules:12` |
| Product ID — 2.4 GHz dongle | `0xFEFE` | `aks075/device.py:9`; `99-ajazz-aks075.rules:4` (sibling keyboard; **NOT confirmed in source for AK820 Pro** — needs hardware verification) |
| Product ID — Bluetooth | NOT FOUND in source — needs hardware verification (no Bluetooth PID appears in any of the three repos for either AK820 Pro or AKS075) |
| Control HID interface number | `3` | `gohv/usb.rs:12` (`const CONTROL_INTERFACE: u8 = 3`); `gohv/device.rs:11` (`const CONTROL_INTERFACE: i32 = 3`); confirmed in aks075/docs/protocol.md table |
| Data HID interface number | `2` | `gohv/usb.rs:13` (`const DATA_INTERFACE: u8 = 2`); aks075/docs/protocol.md table |
| Data interface interrupt-OUT endpoint | `0x03` (EP3 OUT on interface 2) | `gohv/usb.rs:14` |
| Control interface HID usage page (for WebHID filter / disambiguation) | `0xFF13` | `aks075/device.py:12` (`USAGE_PAGE_CONTROL = 0xFF13`); confirmed in `aks075/docs/protocol.md` table |
| Data interface HID usage page (for WebHID filter / disambiguation) | `0xFF68` | `aks075/device.py:13` (`USAGE_PAGE_DATA = 0xFF68`); confirmed in `aks075/docs/protocol.md` table |
| Standard 64-byte feature-report packet length (`PACKET_LENGTH`) | `64` | `gohv/protocol.rs:7`; `keyboarddefs.hpp:19` |
| Feature-report "control" report ID used in `_cmd_packet` byte 0 | `0x04` | `gohv/protocol.rs:8` (`REPORT_ID = 0x04`); `keyboarddefs.hpp:13` (`COMMAND_PREFIX = 0x04`); `aks075/protocol.py:26` |

### Critical caveat about "report ID"

The three references disagree subtly about whether the leading `0x04` is a
proper HID report ID or just the first payload byte:

- **gohv** treats `0x04` as the HID report ID and writes it as `data[0]` of a
  64-byte buffer; it then calls `hid_send_feature_report` with that 64-byte
  buffer. (`gohv/protocol.rs:34`, `gohv/protocol.rs:8`.)
- **TaxMachine** also treats `0x04` as the leading byte of a 64-byte buffer
  passed to `hid_send_feature_report` (`ak820pro.cpp:17`).
- **aks075** explicitly notes that the *actual HID report ID is `0x00`* and
  `0x04` is the first **payload** byte. `aks075/device.py:177-179` builds a
  65-byte buffer `[0x00, ...64 bytes...]` for the `HIDIOCSFEATURE` ioctl.
  `aks075/protocol.py:26` comment: `pkt[0] = 0x04  # Command prefix (first
  DATA byte, not HID report ID)`. The aks075 protocol doc states "The HID
  report ID is always `0x00` (prepended by the OS, not by user code)."

**Implication for WebHID:** `device.sendFeatureReport(reportId, data)` takes
the report ID separately. We should pass `reportId = 0x00` and a 64-byte
`Uint8Array` whose first byte is `0x04`. (See cross-check notes below.)

### Time-data packet uses a different report ID

The time **data** packet (not the preamble) explicitly uses byte 0 = `0x00`,
not `0x04` — see Time Sync section below. In WebHID terms that's
`sendFeatureReport(0x00, payload)` where `payload[0] = 0x01`, `payload[1] =
0x5A`, etc.

## Time sync (Feature 1)

### Sequence

Four feature reports in order, each followed by a brief delay (~40 ms in
aks075; 10 ms inter-packet in gohv with 100 ms after `SAVE`):

1. **START** — `[04 18 00 ... 00 (byte8=01) 00 ... 00]`
2. **TIME_PREAMBLE** (a.k.a. TIME_CFG) — `[04 28 00 ... 00 (byte8=01) 00 ... 00]`
3. **TIME_DATA** — 64-byte payload starting with `00 01 5A YY MM DD HH mm ss 00 04 ... AA 55`
4. **SAVE** — `[04 02 00 ... 00]` (no enable flag at byte 8)

A GET-feature-report handshake (any short read) is issued after each SET in
gohv and aks075. The handshake is non-fatal — failures are ignored.

### Packet 1 — START (preamble)

| Offset | Length | Field | Encoding | Notes |
|---|---|---|---|---|
| 0 | 1 | command prefix | `0x04` fixed | First payload byte; HID report ID is `0x00`. |
| 1 | 1 | command | `0x18` fixed (`CMD_START`) | |
| 2 | 1 | sub-command | `0x00` | |
| 3 – 7 | 5 | padding | `0x00` × 5 | |
| 8 | 1 | enable flag | `0x01` | Marks "start" as enabled. |
| 9 – 63 | 55 | padding | `0x00` × 55 | |

Source: `gohv/protocol.rs:32-43` (`control_packet` + `start_packet`);
`aks075/protocol.py:19-31`, `:60-62`.

### Packet 2 — TIME_PREAMBLE / TIME_CFG

| Offset | Length | Field | Encoding | Notes |
|---|---|---|---|---|
| 0 | 1 | command prefix | `0x04` fixed | |
| 1 | 1 | command | `0x28` fixed (`CMD_TIME`) | |
| 2 | 1 | sub-command | `0x00` | |
| 3 – 7 | 5 | padding | `0x00` × 5 | |
| 8 | 1 | enable flag | `0x01` | |
| 9 – 63 | 55 | padding | `0x00` × 55 | |

Source: `gohv/protocol.rs:24, :241-243` (`CMD_TIME = 0x28`,
`time_preamble_packet`); `aks075/protocol.py:67`.

### Packet 3 — TIME_DATA

This is the data packet itself. **Report ID is `0x00`, not `0x04`.**

| Offset | Length | Field | Encoding | Notes |
|---|---|---|---|---|
| 0 | 1 | byte0 / report-ID-as-payload | `0x00` fixed | gohv comment line 256: "report ID"; aks075 line 74: "Report ID for data packets". |
| 1 | 1 | fixed | `0x01` fixed | |
| 2 | 1 | magic marker | `0x5A` fixed | |
| 3 | 1 | year | `uint8`, value = `year - 2000` | E.g. 2026 → `0x1A` (=26). `gohv/protocol.rs:259`: `(year.saturating_sub(2000)) as u8`. `aks075/protocol.py:77`: `dt.year - 2000`. |
| 4 | 1 | month | `uint8`, 1–12 | Binary, NOT BCD. |
| 5 | 1 | day | `uint8`, 1–31 | Binary. |
| 6 | 1 | hour | `uint8`, 0–23 | Binary, 24-hour. |
| 7 | 1 | minute | `uint8`, 0–59 | Binary. |
| 8 | 1 | second | `uint8`, 0–59 | Binary. |
| 9 | 1 | padding | `0x00` | |
| 10 | 1 | fixed | `0x04` | gohv comment: "fixed". |
| 11 – 61 | 51 | padding | `0x00` × 51 | |
| 62 | 1 | trailer hi byte | `0xAA` fixed | Magic trailer byte 1. |
| 63 | 1 | trailer lo byte | `0x55` fixed | Magic trailer byte 2. |

Source: `gohv/protocol.rs:249-270`; `aks075/protocol.py:73-87`.

**Concrete worked example** (for byte-exact unit-test verification —
2026-05-16 14:30:45):

```
offset:  0  1  2  3  4  5  6  7  8  9 10  ...  62 63
bytes:  00 01 5A 1A 05 10 0E 1E 2D 00 04  ...  AA 55
```

(0x1A = 26, 0x05 = May, 0x10 = day 16, 0x0E = hour 14, 0x1E = minute 30,
0x2D = second 45. Bytes 11–61 are all zero.)

### Packet 4 — SAVE

| Offset | Length | Field | Encoding | Notes |
|---|---|---|---|---|
| 0 | 1 | command prefix | `0x04` fixed | |
| 1 | 1 | command | `0x02` fixed (`CMD_SAVE`) | |
| 2 | 1 | sub-command | `0x00` | |
| 3 – 7 | 5 | padding | `0x00` × 5 | |
| 8 | 1 | enable flag | `0x00` | **No enable flag** — gohv passes `byte8=0x00` (`control_packet(CMD_SAVE, 0x00, 0x00)`), aks075 passes `enable=False`. |
| 9 – 63 | 55 | padding | `0x00` × 55 | |

Source: `gohv/protocol.rs:245-247`; `aks075/protocol.py:93`.

### Source code excerpts

**gohv `time_data_packet` (Rust)** — `src/protocol.rs:249-270`:

```rust
/// Build the 64-byte time data packet.
/// Report ID is 0x00 (not 0x04), with magic byte 0x5A.
pub fn time_data_packet(
    year: u16, month: u8, day: u8,
    hour: u8, minute: u8, second: u8,
) -> [u8; PACKET_LENGTH] {
    let mut pkt = [0u8; PACKET_LENGTH];
    pkt[0] = 0x00;                      // report ID
    pkt[1] = 0x01;                      // fixed
    pkt[2] = 0x5A;                      // magic marker
    pkt[3] = (year.saturating_sub(2000)) as u8;
    pkt[4] = month;
    pkt[5] = day;
    pkt[6] = hour;
    pkt[7] = minute;
    pkt[8] = second;
    pkt[9] = 0x00;
    pkt[10] = 0x04;                     // fixed
    pkt[PACKET_LENGTH - 2] = DELIMITER_HI; // 0xAA at byte 62
    pkt[PACKET_LENGTH - 1] = DELIMITER_LO; // 0x55 at byte 63
    pkt
}
```

**gohv `set_time` transaction (Rust)** — `src/usb.rs:232-245`:

```rust
/// Sync the keyboard's internal clock to the given time.
/// Protocol: START → TIME_CONFIGURE → TIME_DATA → SAVE
pub fn set_time(
    &self,
    year: u16, month: u8, day: u8,
    hour: u8, minute: u8, second: u8,
) -> Result<()> {
    self.send_feature(&start_packet())?;
    self.send_feature(&time_preamble_packet())?;
    self.send_feature(&time_data_packet(year, month, day, hour, minute, second))?;
    self.send_feature(&save_packet())?;
    std::thread::sleep(Duration::from_millis(100));
    Ok(())
}
```

**aks075 `time_sync` (Python)** — `aks075/protocol.py:43-97` (abridged):

```python
def time_sync(device, dt=None):
    if dt is None:
        dt = datetime.now()
    # Step 1: START
    device.send_feature_report(_cmd_packet(0x18))
    time.sleep(CMD_DELAY)
    # Step 2: TIME_CFG
    device.send_feature_report(_cmd_packet(0x28))
    _handshake(device)
    # Step 3: TIME_DATA
    data = bytearray(64)
    data[0] = 0x00   # Report ID for data packets
    data[1] = 0x01
    data[2] = 0x5A   # Time sync marker
    data[3] = dt.year - 2000
    data[4] = dt.month
    data[5] = dt.day
    data[6] = dt.hour
    data[7] = dt.minute
    data[8] = dt.second
    data[9] = 0x00
    data[10] = 0x04
    data[62] = 0xAA
    data[63] = 0x55
    device.send_feature_report(data)
    time.sleep(CMD_DELAY)
    # Step 4: SAVE
    device.send_feature_report(_cmd_packet(0x02, enable=False))
    _handshake(device)
```

## Static image upload (Feature 2a)

There are **two distinct framings** in the references. Both target the same
hardware family, but they were reverse-engineered against slightly different
firmware behaviours. Spec details for each are below, plus an explicit
cross-check section.

### AKS075 / Windows-driver framing (preferred for AK820 Pro implementation)

This is the canonical framing produced by the official Windows driver
(reverse-engineered byte-by-byte from `DeviceDriver.exe` via Ghidra and
confirmed by USB capture). It is documented as the authoritative protocol in
`aks075/docs/protocol.md` and implemented in `aks075/protocol.py:122-181`.

**Sequence:** `START → IMAGE_CFG → DATA chunks (with per-chunk ACK) → SAVE`
(NO `FINISH` packet — sending `04 F0` after image upload was observed to
break persistence on AKS075.)

#### START packet (feature report on control interface)

Same layout as time-sync START **except byte 8 enable flag is `0x00`**:

| Offset | Length | Field | Value | Notes |
|---|---|---|---|---|
| 0 | 1 | command prefix | `0x04` | |
| 1 | 1 | command | `0x18` | `CMD_START` |
| 2 | 1 | sub-command | `0x00` | |
| 3 – 7 | 5 | padding | `0x00` × 5 | |
| 8 | 1 | enable | `0x00` | aks075 explicitly uses `enable=False`: `aks075/protocol.py:146`. (gohv sends `0x01` here; see cross-check.) |
| 9 – 63 | 55 | padding | `0x00` × 55 | |

Source: `aks075/protocol.py:144-148`.

#### IMAGE_CFG packet (feature report on control interface)

| Offset | Length | Field | Value | Notes |
|---|---|---|---|---|
| 0 | 1 | command prefix | `0x04` | |
| 1 | 1 | command | `0x72` | `CMD_IMAGE` |
| 2 | 1 | sub-command | `0x03` | Confirmed `0x03` from USB capture (`aks075/protocol.py:155`); **gohv uses `0x02` here** — see cross-check. |
| 3 – 7 | 5 | padding | `0x00` × 5 | |
| 8 | 1 | chunk count lo | `total_chunks & 0xFF` | uint16 LE |
| 9 | 1 | chunk count hi | `(total_chunks >> 8) & 0xFF` | uint16 LE |
| 10 – 63 | 54 | padding | `0x00` × 54 | |

For a static 128×128 image: `total_chunks = ceil((256 + 32768) / 4096) = 9`,
so bytes 8 = `0x09`, byte 9 = `0x00`.

Source: `aks075/protocol.py:151-160`; `aks075/docs/protocol.md` Step 2.

#### DATA payload (sent over interface 2, EP `0x03` OUT, as bulk 4096-byte HID output reports)

Total payload = `[256-byte frame-header] + [128*128*2 = 32768 bytes pixel data] + [0xFF padding to next 4096-byte boundary]`

That's `256 + 32768 = 33024 bytes`, padded with `0xFF` to `9 * 4096 = 36864
bytes`, sent as **nine** 4096-byte chunks.

##### 256-byte frame-header layout (always present, including static)

| Offset | Length | Field | Value | Notes |
|---|---|---|---|---|
| 0 | 1 | frame count | `uint8`, 1–255 | For static image: `0x01`. |
| 1 | 1 | frame-0 delay | `uint8`, `delay_ms / 2`, min 1 | For static: `0x00`. |
| 2 – (N) | N-1 | frame-i delay (i=1..N-1) | `uint8`, `delay_ms / 2`, min 1, max 255 | One byte per frame after frame 0. |
| (N+1) – 255 | … | padding | `0xFF` | Fill remainder of the 256-byte header. |

Source: `aks075/protocol.py:100-119` (`_build_gif_header`).

##### Per-chunk write (interface 2)

Each chunk is **exactly 4096 bytes** sent via `os.write` to the data hidraw
device (Linux strips the leading `0x00` — see "hidraw report-ID gotcha"
below). On WebHID, this is `dataDevice.sendReport(0x00, chunk4096)` — i.e.
output report on report ID `0x00`.

**There is no per-chunk header** — chunk index/sequence is implicit in order.
The device knows when transfer is done because the chunk count was sent in
IMAGE_CFG bytes 8–9.

**Per-chunk ACK read-back is required.** After each chunk write, the driver
reads back a 64-byte input report from the data interface (300 ms timeout in
the Windows driver). Without this read, data doesn't persist to flash.
Source: `aks075/protocol.py:168` (`ack = device.read_data_report(...)`);
`aks075/docs/protocol.md` lines 78-81.

The device's ACK payload looks like `01 5A 02 00 ...` (per
`aks075/docs/protocol.md:80`).

#### SAVE packet (feature report on control interface)

Same as time-sync SAVE: `[04 02 00 00 00 00 00 00 00 00 ... 00]` (byte 8 =
`0x00`, no enable flag).

Source: `aks075/protocol.py:176-178`.

#### Pixel encoding (RGB565)

- 16 bits per pixel: top 5 bits = red, middle 6 = green, bottom 5 = blue.
- Encoded as `rgb565 = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)`.
- Stored **little-endian** on the wire: `[low_byte, high_byte]` per pixel.
- **Row-major**, top-to-bottom, left-to-right.
- No row padding; total pixel data is exactly `128 * 128 * 2 = 32768 bytes`.

Source: `aks075/image.py:10-39`; `aks075/docs/protocol.md` lines 121-130;
also `gohv/protocol.rs:215-222` (`rgb565_encode` returns `pixel.to_le_bytes()`
— little-endian, same as aks075).

**Important note on aks075/image.py:10's docstring confusion:** The function
is named "rgb888_to_rgb565" with a docstring saying "big-endian byte order",
but the actual byte-write code at line 35-37 writes low byte first
(little-endian). The implemented behaviour and the `aks075/docs/protocol.md`
spec both say **little-endian**. The docstring is misleading — trust the
code.

### Source code excerpts (AKS075 framing)

`aks075/protocol.py:122-181` (static image upload):

```python
def upload_image(device, rgb565_data):
    if len(rgb565_data) != 128 * 128 * 2:
        raise ValueError(f"Expected 32768 bytes of RGB565 data, got {len(rgb565_data)}")

    CHUNK_SIZE = 4096
    # Build payload: GIF header (1 frame, static) + pixel data
    gif_header = _build_gif_header(1)
    payload = bytearray(gif_header)
    payload.extend(rgb565_data)
    # Pad to chunk boundary with 0xFF
    total_chunks = (len(payload) + CHUNK_SIZE - 1) // CHUNK_SIZE
    payload.extend(b'\xff' * (total_chunks * CHUNK_SIZE - len(payload)))

    # Step 1: START (no enable flag)
    device.send_feature_report(_cmd_packet(0x18, enable=False))
    _handshake(device)
    # Step 2: IMAGE_CFG
    img_cfg = bytearray(64)
    img_cfg[0] = 0x04
    img_cfg[1] = 0x72
    img_cfg[2] = 0x03
    img_cfg[8] = total_chunks & 0xFF
    img_cfg[9] = (total_chunks >> 8) & 0xFF
    device.send_feature_report(img_cfg)
    _handshake(device)
    # Step 3: Send data chunks with per-chunk read-back
    for chunk_idx in range(total_chunks):
        offset = chunk_idx * CHUNK_SIZE
        chunk_data = bytes(payload[offset:offset + CHUNK_SIZE])
        device.send_data_report(chunk_data)
        ack = device.read_data_report(timeout_ms=300)
    # Step 4: SAVE (no FINISH)
    device.send_feature_report(_cmd_packet(0x02, enable=False))
    _handshake(device)
```

`aks075/protocol.py:100-119` (frame-header builder):

```python
def _build_gif_header(num_frames, delays_ms=None):
    """Build the 256-byte GIF header for the AKS075.
    From decompiled driver (FUN_00422b50):
      Byte 0:   frame count (uint8)
      Byte 1+i: per-frame delay (uint8, value = delay_ms / 2, min 1)
      Remaining: 0xFF padding
    """
    header = bytearray(b'\xff' * 256)
    header[0] = num_frames & 0xFF
    if delays_ms:
        for i, delay in enumerate(delays_ms):
            if 1 + i < 256:
                val = max(1, delay // 2)
                header[1 + i] = min(val, 255)
    else:
        header[1] = 0x00  # Static image: delay = 0
    return bytes(header)
```

### gohv / AK820 Pro alternate framing

gohv's `upload_image` on AK820 Pro uses a different framing — likely the
result of partial reverse-engineering before the Windows driver was fully
decoded. Recording it because gohv is the only project that has actually
shipped LCD upload code targeting AK820 Pro:

**Sequence:** `START → IMAGE_PREAMBLE → 9 chunks via interrupt OUT on
interface 2 EP 0x03 → FINISH`

(Note: includes `FINISH` `04 F0`, which the aks075 docs say breaks
persistence on AKS075. Whether this is required on AK820 Pro is an open
question — gohv ships and works on AK820 Pro.)

#### START — `[04 18 00 ... 00 byte8=01 ...]`

Same layout as time-sync START. **Byte 8 = `0x01`** (gohv uses
`control_packet(CMD_START, 0x00, 0x01)` from `gohv/protocol.rs:42`).

#### IMAGE_PREAMBLE — `[04 72 02 00 00 00 00 00 09 00 ...]`

| Offset | Length | Field | Value | Notes |
|---|---|---|---|---|
| 0 | 1 | command prefix | `0x04` | |
| 1 | 1 | command | `0x72` (`CMD_IMAGE`) | |
| 2 | 1 | sub-command | **`0x02`** | gohv uses `0x02` (`gohv/protocol.rs:58`: `control_packet(CMD_IMAGE, 0x02, 0x09)`) — **differs from aks075's `0x03`**. |
| 3 – 7 | 5 | padding | `0x00` × 5 | |
| 8 | 1 | chunk count | `0x09` | Hard-coded constant (9 chunks); not parameterized. |
| 9 – 63 | 55 | padding | `0x00` × 55 | |

Source: `gohv/protocol.rs:57-59`.

#### Data payload (sent over interface 2, EP `0x03` OUT, via interrupt writes)

- Total = 9 chunks × **4123 bytes** = 37107 bytes.
- Pixel data is exactly the 32768 bytes of RGB565 (little-endian, row-major,
  no preceding 256-byte frame header).
- The remaining `37107 − 32768 = 4339` bytes are `0xFF` padding (split across
  the trailing chunks).
- **No per-chunk read-back** — gohv just writes chunks back-to-back with a
  50 ms inter-chunk delay (`gohv/usb.rs:216`).
- Each 4123-byte chunk is broken into **64-byte interrupt packets** plus a
  final **27-byte short packet** (`4123 = 64 * 64 + 27`). The short packet
  delimits the chunk boundary at USB transport level.

Source: `gohv/protocol.rs:11-12` (`IMAGE_CHUNK_SIZE = 4123`,
`IMAGE_NUM_CHUNKS = 9`); `gohv/protocol.rs:226-239` (`split_image_data`);
`gohv/usb.rs:198-217`.

#### FINISH — `[04 F0 00 ... 00 byte8=01 ...]`

| Offset | Length | Field | Value | Notes |
|---|---|---|---|---|
| 0 | 1 | command prefix | `0x04` | |
| 1 | 1 | command | `0xF0` (`CMD_FINISH`) | |
| 2 – 7 | 6 | padding | `0x00` × 6 | |
| 8 | 1 | enable | `0x01` | |
| 9 – 63 | 55 | padding | `0x00` × 55 | |

Source: `gohv/protocol.rs:45-47`, line 20 (`CMD_FINISH = 0xF0`).

### Source code excerpts (gohv framing)

`gohv/src/usb.rs:181-230` (`upload_image`):

```rust
pub fn upload_image(&mut self, rgb565_data: &[u8]) -> Result<()> {
    assert_eq!(rgb565_data.len(), LCD_DATA_SIZE, "Image must be {} bytes", LCD_DATA_SIZE);
    let need_release = !self.data_iface_claimed;
    if need_release { self.claim_data_interface()?; }

    // Transaction: START → IMAGE_PREAMBLE → 9 chunks via interrupt OUT → FINISH
    self.send_feature(&start_packet())?;
    self.send_feature(&image_preamble_packet())?;

    // Split into 9 chunks of 4123 bytes (padded with 0xFF).
    // Each chunk is sent as 64-byte interrupt packets; the last packet of
    // each chunk is 27 bytes (short packet = chunk boundary delimiter).
    let chunks = split_image_data(rgb565_data);
    for (ci, chunk) in chunks.iter().enumerate() {
        for pkt in chunk.chunks(PACKET_LENGTH) {
            self.handle.write_interrupt(DATA_EP_OUT, pkt, TIMEOUT)?;
        }
        std::thread::sleep(Duration::from_millis(50));
    }

    self.send_feature(&finish_packet())?;
    // ...release / re-attach kernel driver...
    Ok(())
}
```

`gohv/src/protocol.rs:11-16, :226-239` (chunk constants + splitter):

```rust
pub const IMAGE_CHUNK_SIZE: usize = 4123;
pub const IMAGE_NUM_CHUNKS: usize = 9;
pub const LCD_WIDTH: u32 = 128;
pub const LCD_HEIGHT: u32 = 128;
pub const LCD_PIXELS: usize = (LCD_WIDTH * LCD_HEIGHT) as usize;
pub const LCD_DATA_SIZE: usize = LCD_PIXELS * 2; // RGB565 = 2 bytes per pixel

pub fn split_image_data(data: &[u8]) -> Vec<Vec<u8>> {
    let mut chunks = Vec::with_capacity(IMAGE_NUM_CHUNKS);
    for i in 0..IMAGE_NUM_CHUNKS {
        let start = i * IMAGE_CHUNK_SIZE;
        let mut chunk = vec![0xFFu8; IMAGE_CHUNK_SIZE];
        if start < data.len() {
            let end = (start + IMAGE_CHUNK_SIZE).min(data.len());
            let copy_len = end - start;
            chunk[..copy_len].copy_from_slice(&data[start..end]);
        }
        chunks.push(chunk);
    }
    chunks
}
```

## Animated GIF upload (Feature 2b)

Only the AKS075 reference implements animated upload. The framing is
identical to static, with three differences in the frame-header bytes 0..N
and one in payload length:

### Additional / modified header fields vs static

| Offset (within 256-byte frame header) | Length | Field | Encoding |
|---|---|---|---|
| 0 | 1 | frame count | `uint8`, 1–255. For animated: `N` (number of frames). |
| 1 | 1 | frame-0 delay | `uint8`, `max(1, delay_ms_0 // 2)`, capped at `255` |
| 2 | 1 | frame-1 delay | `uint8`, `max(1, delay_ms_1 // 2)`, capped at `255` |
| ... | ... | ... | ... |
| `N` | 1 | frame-(N-1) delay | `uint8`, `max(1, delay_ms_{N-1} // 2)`, capped at `255` |
| `N+1` – 255 | (255 − N) | padding | `0xFF` |

### Per-frame delay encoding

- **Unit:** **2 ms per increment** (i.e. `header_byte = delay_ms / 2`).
- **Range:** 1 (= 2 ms) to 255 (= 510 ms). Minimum is 1; the encoder clamps
  `delay_ms < 2` up to 1.
- **Width:** `uint8` (single byte per frame).
- **Endianness:** N/A (single byte).

Source: `aks075/protocol.py:111-115`:
```python
val = max(1, delay // 2)
header[1 + i] = min(val, 255)
```

`aks075/docs/protocol.md:99-118` confirms this and gives the worked
example: a 12-frame GIF at 50 ms each = `[0C 19 19 ... 19 FF FF ...]` where
`0x0C = 12` and `0x19 = 25 = 50 / 2`.

### Frame data layout

- Frames are sent **contiguously, back-to-back**, with **no per-frame
  separator** or per-frame header.
- Total pixel data = `N * 32768` bytes.
- Full payload = `256 (frame-header) + N * 32768 (frames) + 0xFF padding to
  next 4096-byte boundary`.
- `total_chunks = ceil((256 + N * 32768) / 4096)`, which is what's written
  into IMAGE_CFG bytes 8–9 (uint16 LE).

Source: `aks075/protocol.py:184-251` (`upload_gif`).

### Observed size limits

| Limit | Value | Source |
|---|---|---|
| Max frame count | **255** (uint8 in header byte 0) | `aks075/protocol.py:195-196` (raises if `>255`); `aks075/image.py:123-126` (truncates to 255). |
| Max delay per frame | **510 ms** (header byte clamped to 255) | `aks075/protocol.py:115`. |
| Min delay per frame | **2 ms** (header byte clamped to ≥1) | `aks075/protocol.py:114`. |
| Total byte cap | No explicit cap visible in source. `total_chunks` is sent as uint16 LE in IMAGE_CFG, so the theoretical ceiling is `65535 * 4096 ≈ 268 MB`. The real cap is the AKS075's `PY25Q128HA 16 MB SPI flash` (`aks075/docs/protocol.md:14`); at `N * 32768` bytes for pixel data, that's ~511 frames-worth, but the 255-frame uint8 limit dominates. |

### Source code excerpt

`aks075/protocol.py:184-251` (`upload_gif`):

```python
def upload_gif(device, frames_rgb565, delays_ms):
    num_frames = len(frames_rgb565)
    if num_frames == 0:
        raise ValueError("No frames provided")
    if num_frames > 255:
        raise ValueError(f"Too many frames: {num_frames} (max 255)")
    if len(delays_ms) != num_frames:
        raise ValueError("Number of delays must match number of frames")

    frame_size = 128 * 128 * 2
    CHUNK_SIZE = 4096

    # Build complete payload: header + all frames
    gif_header = _build_gif_header(num_frames, delays_ms)
    payload = bytearray(gif_header)
    for frame in frames_rgb565:
        if len(frame) != frame_size:
            raise ValueError(f"Frame must be {frame_size} bytes, got {len(frame)}")
        payload.extend(frame)

    # Pad to chunk boundary with 0xFF
    total_chunks = (len(payload) + CHUNK_SIZE - 1) // CHUNK_SIZE
    payload.extend(b'\xff' * (total_chunks * CHUNK_SIZE - len(payload)))

    # Step 1: START (no enable flag - confirmed by USB capture)
    device.send_feature_report(_cmd_packet(0x18, enable=False))
    _handshake(device)
    # Step 2: IMAGE_CFG (sub=0x03, chunk count LE in bytes 8-9)
    img_cfg = bytearray(64)
    img_cfg[0] = 0x04
    img_cfg[1] = 0x72
    img_cfg[2] = 0x03
    img_cfg[8] = total_chunks & 0xFF
    img_cfg[9] = (total_chunks >> 8) & 0xFF
    device.send_feature_report(img_cfg)
    _handshake(device)
    # Step 3: Send data chunks with per-chunk read-back
    for chunk_idx in range(total_chunks):
        offset = chunk_idx * CHUNK_SIZE
        chunk_data = bytes(payload[offset:offset + CHUNK_SIZE])
        device.send_data_report(chunk_data)
        ack = device.read_data_report(timeout_ms=300)
    # Step 4: SAVE (no FINISH)
    device.send_feature_report(_cmd_packet(0x02, enable=False))
    _handshake(device)
```

## Cross-check notes (TaxMachine vs gohv vs AKS075)

### Common ground (all three agree)

- VID `0x0C45`, AK820 Pro / AKS075 wired PID `0x8009`.
- 64-byte feature reports, leading payload byte `0x04`, with the actual HID
  report ID separate (gohv treats `0x04` as the report ID for hidapi, but
  aks075 confirms the report ID is `0x00` per the device's HID descriptor).
- Control interface is interface number **3**.
- Image data interface is interface number **2**, OUT endpoint **`0x03`**.
- Image data is 128×128 RGB565, little-endian, row-major, 32768 bytes.
- Lighting-mode packet trailer is `0xAA 0x55` at bytes 14–15 (TaxMachine
  `ak820pro.hpp:30` `uint16_t delimiter = 0xaa55`; gohv `protocol.rs:209-210`
  writes `DELIMITER_LO=0x55` at byte 14, `DELIMITER_HI=0xAA` at byte 15 —
  same wire bytes, written in LE order).
- Time-sync packet trailer is `0xAA 0x55` at bytes 62–63 (gohv +
  aks075 both confirm).
- Sleep-data packet trailer is `0xAA 0x55` at bytes 62–63 (gohv
  `protocol.rs:276-277`; TaxMachine `ak820pro.cpp:160-161`).

### Disagreements

| Aspect | gohv (AK820 Pro) | aks075 (sibling) | TaxMachine (AK820 Pro) | Resolution |
|---|---|---|---|---|
| Whether `0x04` is the HID report ID or first payload byte | Treats as report ID (hidapi `send_feature_report` with `data[0]=0x04`) | Explicitly says report ID is `0x00`, `0x04` is first payload byte; ioctl gets a 65-byte buffer `[0x00, 0x04, ...]` | Treats as report ID (hidapi `hid_send_feature_report` with `data[0]=0x04`) | **For WebHID**: use `device.sendFeatureReport(0x00, payloadOf64Bytes)`. WebHID's `reportId=0` matches "no report ID" devices, and the `0x04` then becomes the first data byte — equivalent to what hidapi does internally when given a `0x04`-prefixed buffer with no declared report ID. We should verify with hardware. |
| START byte 8 for image upload | `0x01` (`control_packet(CMD_START, 0x00, 0x01)` — `gohv/protocol.rs:42`) | `0x00` (`_cmd_packet(0x18, enable=False)` — `aks075/protocol.py:146`) | Same as gohv: `0x01` (`ak820pro.cpp:17`) | **Try gohv's `0x01` first on AK820 Pro** since two AK820-Pro-specific references agree; fall back to AKS075's `0x00` only if device rejects. |
| IMAGE_CFG byte 2 (sub-command) | `0x02` | `0x03` (confirmed by Wireshark USB capture against the official Windows driver) | (Image upload is TODO in TaxMachine — not implemented) | **Use `0x03`** — aks075 has the firmer evidence (USB capture of vendor's own driver). Test against hardware. |
| Trailing `FINISH` `04 F0` after image upload | Yes (`gohv/usb.rs:219`) | No — aks075 docs explicitly warn this **breaks persistence** | (N/A — image upload is TODO) | **Open question.** gohv's code ships and works on AK820 Pro according to its README, so `FINISH` may not break AK820 Pro the way it breaks AKS075. Try without `FINISH` first; if persistence fails, add it. |
| Per-chunk ACK read-back | No (just a 50 ms sleep) | Yes (300 ms timeout read after every chunk) | (N/A) | **Use ACK** — aks075's USB-capture-driven decision is stronger evidence. The driver waits because flash writes need to settle. |
| Pre-pended 256-byte frame header to image data | No (gohv just sends 32768 bytes of pixels + 0xFF padding) | Yes (always, even for static images) | (N/A) | **Use the 256-byte header.** It's required to set `frame_count = 1` for static images so the firmware doesn't treat the buffer as an animation. |
| Chunk size | 4123 bytes × 9 chunks (37107 total) | 4096 bytes × 9 chunks (36864 total) | (Defines `IMAGE_CHUNK_SIZE = 4123` in `keyboarddefs.hpp:21` but never actually uses it — image upload TODO) | **Use 4096-byte chunks** — that aligns with the USB-captured Windows driver behaviour and the AKS075 OUT-report size. The gohv `4123` is empirically derived and likely accommodates trailing 27-byte short packets used as boundary markers; the official driver uses clean 4096-byte chunks. |
| Inter-chunk delay | 50 ms | None explicit; relies on 300 ms ACK timeout as natural pacing | (N/A) | The ACK round-trip provides natural pacing; explicit delay probably unnecessary. |
| Image transport on interface 2 | `write_interrupt` (libusb) on EP `0x03` OUT | `os.write` to hidraw on the data interface (kernel maps to interrupt OUT) | (N/A) | **For WebHID:** `dataDevice.sendReport(0x00, chunk)` on the data-interface HIDDevice — WebHID dispatches output reports via interrupt OUT automatically. |
| Sleep packet vs Lighting packet trailer | `0xAA 0x55` at bytes 62–63 (sleep) / bytes 14–15 (lighting mode) — see `gohv/protocol.rs:209, :276` | (sibling, but lighting also uses `0xaa55` delimiter — same family) | Same as gohv: `data[14] = 0xAA, data[15] = 0x55` for lighting (via `uint16_t delimiter = 0xaa55` LE); `data[62] = 0xaa, data[63] = 0x55` for sleep (`ak820pro.cpp:160-161`) | Confirmed across all three. |

### Linux-specific gotchas (relevant for behaviour but NOT for our WebHID code)

- **Linux hidraw strips leading `0x00`**: documented at length in
  `aks075/docs/protocol.md:144-154`. This is a hidraw quirk only; WebHID
  doesn't have this issue because the reportId parameter is separate from
  the data payload.
- **kernel HID driver detach**: gohv detaches the kernel driver on both
  interfaces 2 and 3 (`gohv/usb.rs:55-58, :75-78`) because hid-generic
  swallows feature reports. WebHID handles this automatically — the browser
  takes exclusive control of the matched HIDDevice.

## Lighting-mode reference (relevant only as cross-check on the trailer)

Not directly needed for time-sync / image upload, but documented here because
it confirms the `0xAA 0x55` trailer convention.

The lighting-mode data packet (`gohv/protocol.rs:188-212`, TaxMachine
`ak820pro.cpp:79-124`) uses **byte 0 as the report ID = the lighting-mode
value itself** (not `0x04`). Sub-fields:

| Offset | Length | Field |
|---|---|---|
| 0 | 1 | mode (= report ID; values 0x00..=0x13, see `LightingMode` enum) |
| 1 | 1 | red |
| 2 | 1 | green |
| 3 | 1 | blue |
| 4 – 7 | 4 | padding |
| 8 | 1 | rainbow (bool, 0/1) |
| 9 | 1 | brightness (0–5) |
| 10 | 1 | speed (0–5) |
| 11 | 1 | direction (0=Left, 1=Down, 2=Up, 3=Right per gohv; 0=LEFT, 1=UP, 2=DOWN, 3=RIGHT per TaxMachine — **these disagree, but we don't need lighting control for our scope**) |
| 12 – 13 | 2 | padding |
| 14 | 1 | `0x55` |
| 15 | 1 | `0xAA` |
| 16 – 63 | 48 | padding |

This is **out of scope** for our WebHID configurator (time + image only),
but confirms the `0xAA 0x55` trailer convention used in time-sync.

## Known unknowns (verify against real hardware before shipping)

Each item lists what was searched and why it couldn't be resolved from source
alone.

1. **Bluetooth Product ID (if any).** Spec section 0 names a Bluetooth mode;
   no Bluetooth PID is named in any of the three source repos. Searched:
   `aks075/device.py:7-9`, `gohv/protocol.rs:4-5`, all `.rules` files,
   `keyboarddefs.hpp`. The aks075 reverse-engineering doc (`docs/protocol.md`
   table at lines 11-16) lists only wired `0x8009` and 2.4G `0xFEFE`.
   *Resolution:* connect AK820 Pro via Bluetooth and read the PID from the
   OS HID device list (`lsusb` won't show it; macOS "About This Mac → System
   Report → Bluetooth" will). Or: ship the WebHID device filter with only
   wired + 2.4G PIDs and discover the BT PID empirically.

2. **2.4 GHz dongle PID for AK820 Pro specifically.** AKS075's dongle is
   `0xFEFE`; whether AK820 Pro's dongle uses the same is unconfirmed. Source:
   `aks075/device.py:9` only.

3. **Whether AK820 Pro tolerates the `04 F0` FINISH packet after image
   upload.** gohv ships it (`gohv/usb.rs:219`); AKS075 docs warn it breaks
   persistence on AKS075. Resolution requires uploading an image to AK820 Pro
   in two trials and power-cycling between to check persistence.

4. **Whether AK820 Pro's image-upload framing matches AKS075's (4096-byte
   chunks + 256-byte frame header + ACK + sub=`0x03`) or gohv's (4123-byte
   chunks + no header + no ACK + sub=`0x02`).** Recommended: implement
   AKS075's framing first (it's the more rigorously reverse-engineered one)
   and fall back to gohv's if the device misbehaves.

5. **Whether the `0x04` first-payload-byte must be passed as `reportId` in
   WebHID, or as `payload[0]` with `reportId=0`.** All three references
   target hidapi/hidraw, which has the report-ID handling fused into the
   buffer. WebHID separates them. Spec-correct answer (per
   `aks075/device.py:177-179` and `aks075/docs/protocol.md:43`) is
   `reportId=0`, `payload[0]=0x04`. Verify empirically on Chrome's WebHID
   trace.

6. **The 0x5A byte at offset 2 of TIME_DATA**: documented as "Time sync
   marker" / "magic marker" in both gohv and aks075, with no further
   semantics. If the firmware actually uses it as a discriminator (e.g.
   different magic for time vs. other data packets), changing it would
   silently break. No source decodes the firmware's parser, so this is a
   guess based on observed working bytes. *Risk: low — both references agree
   on the literal value.*

7. **Whether AK820 Pro's HID descriptor declares any report IDs for the
   control interface.** AKS075's descriptor explicitly has none
   (`aks075/device.py:175`). AK820 Pro's was not parsed in source. Resolution:
   read the descriptor via WebHID `device.collections` or
   `chrome://device-log`.

8. **GET-feature handshake behaviour on AK820 Pro.** gohv treats the read as
   "best-effort, ignore errors" (`gohv/usb.rs:117-135`,
   `gohv/hidraw.rs:119-130`). aks075 does the same. Whether the device
   actually responds with meaningful data, or just clears the EP0 STALL, is
   unknown from source. WebHID's `receiveFeatureReport` will resolve the
   promise once the read completes; we can log the bytes for diagnostic
   value, but we should not depend on the response payload.
