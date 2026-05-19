// Values sourced from docs/protocol-notes.md.

/** USB Vendor ID — Microdia/Sonix (the OEM HID chip). */
export const AJAZZ_VENDOR_ID = 0x0c45;

/**
 * Known Product IDs that the AK820 Pro may present as.
 * 0x8009 — wired USB, confirmed across all three reference repos.
 * 0xFEFE — 2.4 GHz dongle PID for the sibling AKS075; unverified for AK820 Pro,
 *          included so dongle mode users have a chance of being matched.
 */
export const AK820_PRO_PRODUCT_IDS: readonly number[] = [0x8009, 0xfefe] as const;

/** TFT screen dimensions. */
export const SCREEN_WIDTH = 128;
export const SCREEN_HEIGHT = 128;
export const RGB565_FRAME_BYTES = SCREEN_WIDTH * SCREEN_HEIGHT * 2;

/**
 * Image data chunk size for OUT transfers on the data interface.
 * gohv uses 4123 bytes (with a trailing 27-byte short packet at USB
 * level). WebHID rejected 4123 on this hardware — the data interface's
 * HID descriptor doesn't allow that report size. Falling back to 4096
 * (a multiple of the 64-byte USB packet size) and accepting we cannot
 * generate the short-packet boundary that gohv relies on.
 */
export const CHUNK_SIZE = 4096;

/**
 * Number of chunks per frame. With 4096-byte chunks, 9 × 4096 = 36864
 * gives 32768 pixel bytes + 4096 padding; 8 × 4096 = 32768 leaves no
 * padding. Keeping 9 to match gohv's per-frame buffer expectation.
 */
export const CHUNKS_PER_FRAME = 9;

/** HID interface numbers. */
export const CONTROL_INTERFACE_NUMBER = 3;
export const DATA_INTERFACE_NUMBER = 2;

/** HID usage pages used to disambiguate the AJAZZ vendor interfaces under WebHID. */
export const CONTROL_USAGE_PAGE = 0xff13;
export const DATA_USAGE_PAGE = 0xff68;

/** Standard 64-byte feature-report packet length. */
export const PACKET_LENGTH = 64;

/** Leading byte of every control-channel feature report (acts as the report ID for hidapi). */
export const CONTROL_REPORT_LEAD_BYTE = 0x04;
