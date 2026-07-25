import { describe, expect, test } from "vitest";
import {
  AJAZZ_VENDOR_ID,
  AK820_PRO_PRODUCT_IDS,
  SCREEN_WIDTH,
  SCREEN_HEIGHT,
  CHUNK_SIZE,
  RGB565_FRAME_BYTES,
  CONTROL_INTERFACE_NUMBER,
  CONTROL_USAGE_PAGE,
  PACKET_LENGTH,
} from "../constants";

describe("protocol constants", () => {
  test("vendor ID is Microdia/Sonix (0x0C45)", () => {
    expect(AJAZZ_VENDOR_ID).toBe(0x0c45);
  });

  test("product IDs includes the confirmed wired PID 0x8009", () => {
    expect(AK820_PRO_PRODUCT_IDS).toContain(0x8009);
    expect(AK820_PRO_PRODUCT_IDS.length).toBeGreaterThan(0);
  });

  test("product IDs includes the 0x800A revision (hardware-verified)", () => {
    // The newer AK820 Pro revision enumerates as PID 0x800A; it must be in the
    // requestDevice whitelist so Chrome's picker offers it.
    expect(AK820_PRO_PRODUCT_IDS).toContain(0x800a);
  });

  test("screen is 128x128", () => {
    expect(SCREEN_WIDTH).toBe(128);
    expect(SCREEN_HEIGHT).toBe(128);
  });

  test("RGB565 frame bytes = 32768", () => {
    expect(RGB565_FRAME_BYTES).toBe(128 * 128 * 2);
  });

  test("chunk size is 4096 (WebHID rejected 4123)", () => {
    expect(CHUNK_SIZE).toBe(4096);
  });

  test("control interface is 3, usage page 0xFF13", () => {
    expect(CONTROL_INTERFACE_NUMBER).toBe(3);
    expect(CONTROL_USAGE_PAGE).toBe(0xff13);
  });

  test("packet length is 64 bytes", () => {
    expect(PACKET_LENGTH).toBe(64);
  });
});
