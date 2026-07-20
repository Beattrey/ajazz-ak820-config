# What works

## Validated application baseline

The complete automated suite passes: 18 test files and 110 tests covering
protocol builders, operation ordering, WebHID sessions, image processing,
preset storage, and React panels. TypeScript and the Vite production build pass,
and Biome reports no lint findings.

Headless Chrome rendering was inspected at 1280 × 1000 and with the narrow
layout breakpoint active. The virtual ANSI keyboard fits inside the desktop
panel and becomes a horizontally scrollable preview on narrow screens.

## Lighting and presets

Lighting uses START → MODE_PREAMBLE → MODE_DATA → FINISH. GET-feature
handshakes occur only for the `0x04` control reports. Regression tests assert
the four writes and exactly three control handshakes.

Versioned local presets support save, load, rename, delete, and apply. Applying
a preset uses the corrected lighting transaction. The virtual keyboard reacts
to RGB color, brightness, Off, Rainbow, and Breath while intentionally
previewing the verified whole-keyboard effect rather than per-key data.

## Persistent TFT uploads

AKS075/Windows-driver framing works for both static and animated uploads. A
static image is represented as one frame with delay zero in the 256-byte frame
header. Ending the transaction with `SAVE` persists the image.

## Image fitting

Aspect-preserving `contain` fitting keeps the entire source visible. Static
images and GIF frames share the same sizing geometry, so their preview and
uploaded framing agree.

Opaque images look more complete when unused space is filled with their
dominant visible color. Quantized histogram selection is stable on JPEGs where
nominally identical areas contain small compression variations.

Images with actual transparent pixels need a separate path: skip dominant-color
padding and composite transparency onto black only when producing RGB565. This
preserves the visual intent as closely as a display format without alpha allows.
