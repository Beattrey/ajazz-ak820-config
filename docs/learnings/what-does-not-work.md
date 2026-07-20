# What does not work

## What cannot be validated without the physical keyboard

Automated tests prove packet bytes and ordering but cannot prove that a
particular firmware revision accepts them. A wired USB-C hardware run is still
required for effects, Off/Static normalization, persistence, sleep timing, and
Up/Down direction. Bluetooth and 2.4 GHz are not substitutes because the
required vendor interfaces are not confirmed there.

Per-key RGB editing is not exposed. The AK820-Pro-specific references document
built-in whole-board modes but no verified per-key packet layout. Presenting
clickable keys as individually programmable would be misleading and unsafe.

## GET_FEATURE after lighting mode data

The lighting mode-data packet uses the effect number as its leading byte rather
than the `0x04` control prefix. Issuing the usual GET-feature handshake after
this packet can abort the keyboard firmware's lighting transaction. Handshake
reads are limited to the START, MODE_PREAMBLE, and FINISH control packets. The
same rule excludes the sleep-data packet from handshake reads.

## Uncontained virtual-keyboard intrinsic width

A fixed minimum row width initially made the preview awkward on mobile. The
narrow-layout rule now gives the preview an explicit viewport-derived width so
it scrolls internally; panels and controls explicitly allow shrinking. Desktop
uses a smaller minimum row width so the entire board remains visible.

## Legacy static-image framing

The gohv-style static path does not persist reliably on AK820 Pro firmware. Its
`START` enable flag, `IMAGE_CFG` sub-command `0x02`, headerless pixel stream, and
`FINISH` (`0xF0`) termination can produce a brief image followed by white or the
default animation. `FINISH` resets player state instead of committing the image.

## Cover cropping

Scaling with `cover` and center-cropping fills the square TFT but discards source
content. Portrait images lose their top and bottom; landscape images lose their
left and right. Solid-color resize tests do not reveal this failure, so edge
marker tests are required.

## Unconditional dominant-color padding

Applying dominant-color padding to every source gives transparent PNGs and GIFs
an unwanted colored surround. Transparency must be detected from actual alpha
values, not merely from the MIME type: PNG and WebP can be either opaque or
transparent. True transparency cannot be uploaded because RGB565 has no alpha;
it is flattened to black at the final conversion boundary.
