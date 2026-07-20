# Display images

[Learning index](README.md)

## Screen format

The TFT is 128 × 128 and has no alpha channel. Every frame is RGB565
little-endian, row-major, with no row padding:

```text
pixel = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)
bytes = [low_byte, high_byte]
frame size = 128 × 128 × 2 = 32768 bytes
```

## Browser image pipeline

All processing happens locally in the browser:

1. Decode static images with `createImageBitmap`, animated GIFs with
   `gifuct-js`, or animated WebPs frame-by-frame with WebCodecs `ImageDecoder`.
2. Resize with `containResizeRgba`, preserving the complete source without
   cropping.
3. Fill unused space for opaque sources using the dominant displayed color.
   The quantized 5-bit RGB histogram groups JPEG noise and similar shades.
4. Skip dominant-color fill when actual transparent pixels exist; flatten
   transparency to black only at the RGB565 conversion boundary.
5. Convert the composed RGBA frame to RGB565 little-endian.

GIF compositing honors keep-canvas, restore-background, and restore-previous
disposal methods. Transparent pixels do not overwrite prior canvas content.

## Upload protocol

The working AKS075/Windows-driver sequence is:

1. START: `04 18 00 ...`, with byte 7 equal to `0x00`.
2. IMAGE_CFG: `04 72 03 ...`, with uint16 little-endian chunk count in bytes
   8–9.
3. 4096-byte data-interface chunks, each followed by an ACK read.
4. SAVE: `04 02 00 ...`, with byte 7 equal to `0x00`.

### Payload framing

Every payload begins with a 256-byte frame header, including static images:

```text
[256-byte header] + [N × 32768-byte RGB565 frames] + [0xFF chunk padding]
```

Header byte 0 is frame count (`1–255`). Bytes 1 through N contain frame delays
as `delay_ms / 2`, clamped to `1–255`; static frame delay is `0`. Remaining
header bytes are `0xFF`.

A static payload is 33024 bytes and requires nine 4096-byte chunks. Animated
frames follow back-to-back without separators. Chunk count is
`ceil((256 + N × 32768) / 4096)`.

See [Hardware and transport](hardware-and-transport.md) for interface and ACK
handling.

## Failed approaches

### Legacy gohv framing

The gohv-style static path does not persist reliably:

| Aspect | Legacy path | Working path |
|---|---|---|
| START byte 7 | `0x01` | `0x00` |
| IMAGE_CFG sub-command | `0x02` | `0x03` |
| Frame header | absent | required, even for one frame |
| Termination | FINISH (`0xF0`) | SAVE (`0x02`) |

FINISH resets player state rather than committing the image, causing a brief
flash followed by white or the default animation. Missing the header makes the
firmware interpret initial pixel bytes as metadata.

### Cover cropping

`cover` fills the TFT but discards portrait tops/bottoms or landscape sides.
Solid-color tests cannot detect this; edge-marker tests are necessary.

### Unconditional dominant-color fill

Filling all sources adds an unwanted surround to transparent PNGs and GIFs.
Transparency must be detected from pixel alpha, not MIME type, because PNG and
WebP may be opaque or transparent.
