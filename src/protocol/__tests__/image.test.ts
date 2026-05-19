import { describe, expect, test } from "vitest";
import {
  buildImageStartReport,
  buildImageCfgReport,
  buildImageFinishReport,
  buildImageDataChunks,
  buildAnimatedStartReport,
  buildAnimatedCfgReport,
  buildAnimatedSaveReport,
  buildAnimatedDataChunks,
  buildFrameHeader,
} from "../image";
import { RGB565_FRAME_BYTES, CHUNK_SIZE } from "../constants";

describe("buildImageStartReport", () => {
  test("returns START control packet with enable=1 (gohv framing)", () => {
    const msg = buildImageStartReport();
    expect(msg.reportId).toBe(0x04);
    expect(msg.bytes.byteLength).toBe(63);
    expect(msg.bytes[0]).toBe(0x18); // CMD_START
    // packet byte 8 (enable flag) → bytes[7] after stripping reportId
    expect(msg.bytes[7]).toBe(0x01);
    for (let i = 1; i < 63; i++) {
      if (i === 7) continue;
      expect(msg.bytes[i]).toBe(0);
    }
  });
});

describe("buildImageCfgReport", () => {
  test("encodes chunk count as uint16 LE with gohv sub-command 0x02", () => {
    const msg = buildImageCfgReport(8);
    expect(msg.reportId).toBe(0x04);
    expect(msg.bytes.byteLength).toBe(63);
    expect(msg.bytes[0]).toBe(0x72); // CMD_IMAGE
    expect(msg.bytes[1]).toBe(0x02); // gohv sub-command (vs aks075 0x03)
    expect(msg.bytes[7]).toBe(8); // chunk count lo
    expect(msg.bytes[8]).toBe(0); // chunk count hi
  });

  test("encodes large chunk counts correctly (uint16 LE)", () => {
    const msg = buildImageCfgReport(0x0123);
    expect(msg.bytes[7]).toBe(0x23);
    expect(msg.bytes[8]).toBe(0x01);
  });

  test("rejects out-of-range chunk count", () => {
    expect(() => buildImageCfgReport(0)).toThrow(/chunk count/i);
    expect(() => buildImageCfgReport(0x10000)).toThrow(/chunk count/i);
  });
});

describe("buildImageFinishReport", () => {
  test("returns FINISH control packet (0xF0, enable=1)", () => {
    const msg = buildImageFinishReport();
    expect(msg.reportId).toBe(0x04);
    expect(msg.bytes.byteLength).toBe(63);
    expect(msg.bytes[0]).toBe(0xf0); // CMD_FINISH
    expect(msg.bytes[7]).toBe(0x01); // enable flag = 1 per gohv source
    for (let i = 1; i < 63; i++) {
      if (i === 7) continue;
      expect(msg.bytes[i]).toBe(0);
    }
  });
});

describe("buildImageDataChunks", () => {
  test("single static frame: 9 chunks of 4096 bytes each", () => {
    const frame = new Uint8Array(RGB565_FRAME_BYTES);
    const chunks = buildImageDataChunks([frame]);
    expect(chunks.length).toBe(9);
    for (const c of chunks) {
      expect(c.byteLength).toBe(CHUNK_SIZE);
    }
  });

  test("pixel data starts at byte 0 of chunk 0 (no leading header)", () => {
    const frame = new Uint8Array(RGB565_FRAME_BYTES);
    frame[0] = 0x00;
    frame[1] = 0xf8;
    const chunks = buildImageDataChunks([frame]);
    expect(chunks[0][0]).toBe(0x00);
    expect(chunks[0][1]).toBe(0xf8);
  });

  test("padding fills bytes after the 32768 pixel bytes with 0xFF", () => {
    const frame = new Uint8Array(RGB565_FRAME_BYTES); // all zero
    const chunks = buildImageDataChunks([frame]);
    // 32768 pixel bytes fill chunks 0..7 fully (7*4123=28861), and the first
    // 32768-28861=3907 bytes of chunk 7... wait, 7*4123=28861, so pixel data
    // ends at offset 32768 which falls inside chunk 7 (28861..32984). Bytes
    // beyond offset 32768 in chunk 7 should be 0xFF. Chunk 8 is entirely 0xFF.
    for (let i = 0; i < CHUNK_SIZE; i++) {
      expect(chunks[8][i]).toBe(0xff);
    }
  });

  test("multi-frame: 3 frames → 27 chunks (3 × 9 hardcoded)", () => {
    const frame = new Uint8Array(RGB565_FRAME_BYTES);
    const chunks = buildImageDataChunks([frame, frame, frame], [100, 100, 100]);
    expect(chunks.length).toBe(27);
  });

  test("each frame's pixel data lives in its own 9-chunk slot", () => {
    const f0 = new Uint8Array(RGB565_FRAME_BYTES);
    f0[0] = 0xaa;
    f0[1] = 0xbb;
    const f1 = new Uint8Array(RGB565_FRAME_BYTES);
    f1[0] = 0xcc;
    f1[1] = 0xdd;
    const chunks = buildImageDataChunks([f0, f1], [100, 100]);
    expect(chunks[0][0]).toBe(0xaa);
    expect(chunks[0][1]).toBe(0xbb);
    // Frame 1 starts at chunk 9 (9 chunks per frame).
    expect(chunks[9][0]).toBe(0xcc);
    expect(chunks[9][1]).toBe(0xdd);
  });

  test("rejects wrong-sized frame", () => {
    const frame = new Uint8Array(100);
    expect(() => buildImageDataChunks([frame])).toThrow(/32768/);
  });

  test("rejects mismatched delays length", () => {
    const frame = new Uint8Array(RGB565_FRAME_BYTES);
    expect(() => buildImageDataChunks([frame, frame], [100])).toThrow(/delay/i);
  });
});

// --- AKS075 animated path ---------------------------------------------------

describe("buildAnimatedStartReport", () => {
  test("returns START control packet with enable=0 (AKS075)", () => {
    const msg = buildAnimatedStartReport();
    expect(msg.reportId).toBe(0x04);
    expect(msg.bytes[0]).toBe(0x18);
    expect(msg.bytes[7]).toBe(0x00);
  });
});

describe("buildAnimatedCfgReport", () => {
  test("uses sub-command 0x03 (AKS075)", () => {
    const msg = buildAnimatedCfgReport(25);
    expect(msg.bytes[0]).toBe(0x72);
    expect(msg.bytes[1]).toBe(0x03);
    expect(msg.bytes[7]).toBe(25);
    expect(msg.bytes[8]).toBe(0);
  });
});

describe("buildAnimatedSaveReport", () => {
  test("returns SAVE (0x02) with no enable flag", () => {
    const msg = buildAnimatedSaveReport();
    expect(msg.bytes[0]).toBe(0x02);
    expect(msg.bytes[7]).toBe(0x00);
  });
});

describe("buildFrameHeader", () => {
  test("encodes frame count and per-frame delays/2, rest 0xFF", () => {
    const h = buildFrameHeader(3, [100, 200, 50]);
    expect(h.byteLength).toBe(256);
    expect(h[0]).toBe(3);
    expect(h[1]).toBe(50); // 100/2
    expect(h[2]).toBe(100); // 200/2
    expect(h[3]).toBe(25); // 50/2
    for (let i = 4; i < 256; i++) {
      expect(h[i]).toBe(0xff);
    }
  });

  test("clamps delay/2 to min 1, max 255", () => {
    const h = buildFrameHeader(2, [1, 600]);
    expect(h[1]).toBe(1); // max(1, floor(1/2)) = 1
    expect(h[2]).toBe(255); // min(255, 300) = 255
  });

  test("rejects mismatched delays length", () => {
    expect(() => buildFrameHeader(3, [100, 200])).toThrow(/frame/i);
  });
});

describe("buildAnimatedDataChunks", () => {
  test("3 frames → 25 chunks (256 + 3*32768 = 98560, ceil/4096=25)", () => {
    const frame = new Uint8Array(RGB565_FRAME_BYTES);
    const chunks = buildAnimatedDataChunks([frame, frame, frame], [100, 100, 100]);
    expect(chunks.length).toBe(25);
    for (const c of chunks) {
      expect(c.byteLength).toBe(CHUNK_SIZE);
    }
  });

  test("256-byte frame header is at the start of chunk 0", () => {
    const frame = new Uint8Array(RGB565_FRAME_BYTES);
    const chunks = buildAnimatedDataChunks([frame, frame], [100, 200]);
    expect(chunks[0][0]).toBe(2); // frame count
    expect(chunks[0][1]).toBe(50); // 100/2
    expect(chunks[0][2]).toBe(100); // 200/2
    for (let i = 3; i < 256; i++) {
      expect(chunks[0][i]).toBe(0xff);
    }
  });

  test("rejects wrong-sized frame", () => {
    const frame = new Uint8Array(100);
    expect(() => buildAnimatedDataChunks([frame], [100])).toThrow(/32768/);
  });
});
