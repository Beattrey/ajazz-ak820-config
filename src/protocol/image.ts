import { CHUNK_SIZE, CHUNKS_PER_FRAME } from "./constants";
import type { ReportMessage } from "./types";

// gohv framing (AK820-Pro-empirical). Differs from the AKS075/Windows-driver
// framing in four places: START enable=1 (not 0), IMAGE_CFG sub=0x02
// (not 0x03), transfer terminates with FINISH (0xF0) instead of SAVE (0x02),
// and there is NO 256-byte frame header — payload is pure RGB565 pixel data.
const CONTROL_LEAD = 0x04;
const CMD_START = 0x18;
const CMD_IMAGE = 0x72;
const CMD_FINISH = 0xf0;
const IMAGE_CFG_SUBCOMMAND = 0x02;
const PAYLOAD_LENGTH = 63; // 64-byte packet minus reportId byte
const RGB565_FRAME_BYTES = 128 * 128 * 2; // 32768

export function buildImageStartReport(): ReportMessage {
  const bytes = new Uint8Array(PAYLOAD_LENGTH);
  bytes[0] = CMD_START;
  bytes[7] = 0x01; // enable flag = 1 in gohv (vs 0 in aks075)
  return { reportId: CONTROL_LEAD, bytes };
}

export function buildImageCfgReport(chunkCount: number): ReportMessage {
  if (!Number.isInteger(chunkCount) || chunkCount < 1 || chunkCount > 0xffff) {
    throw new Error(
      `buildImageCfgReport: chunk count must be a uint16 in [1, 0xFFFF], got ${chunkCount}`,
    );
  }
  const bytes = new Uint8Array(PAYLOAD_LENGTH);
  bytes[0] = CMD_IMAGE;
  bytes[1] = IMAGE_CFG_SUBCOMMAND;
  bytes[7] = chunkCount & 0xff;
  bytes[8] = (chunkCount >> 8) & 0xff;
  return { reportId: CONTROL_LEAD, bytes };
}

export function buildImageFinishReport(): ReportMessage {
  const bytes = new Uint8Array(PAYLOAD_LENGTH);
  bytes[0] = CMD_FINISH;
  bytes[7] = 0x01; // enable=1 per gohv source
  return { reportId: CONTROL_LEAD, bytes };
}

export function buildImageDataChunks(
  frames: readonly Uint8Array[],
  delaysMs?: readonly number[],
): Uint8Array[] {
  if (frames.length < 1) {
    throw new Error("buildImageDataChunks: at least one frame required");
  }
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].byteLength !== RGB565_FRAME_BYTES) {
      throw new Error(
        `buildImageDataChunks: frame ${i} is ${frames[i].byteLength} bytes, expected ${RGB565_FRAME_BYTES}`,
      );
    }
  }
  if (delaysMs && delaysMs.length !== frames.length) {
    throw new Error(
      `buildImageDataChunks: delay count ${delaysMs.length} does not match frame count ${frames.length}`,
    );
  }

  // gohv framing: pure pixel data with NO 256-byte header. Each frame is
  // allocated exactly CHUNKS_PER_FRAME * CHUNK_SIZE bytes of buffer space —
  // 32768 bytes of RGB565 pixel data followed by 0xFF padding to the chunk
  // boundary. Frames concatenated back-to-back; chunkCount = N * CHUNKS_PER_FRAME.
  //
  // Animated GIFs lose their per-frame delays in this framing — gohv only
  // demonstrates static. AK820 Pro firmware's animated handling is unknown.
  const bytesPerFrame = CHUNKS_PER_FRAME * CHUNK_SIZE;
  const chunkCount = frames.length * CHUNKS_PER_FRAME;
  const totalSize = chunkCount * CHUNK_SIZE;

  const payload = new Uint8Array(totalSize).fill(0xff);
  for (let f = 0; f < frames.length; f++) {
    payload.set(frames[f], f * bytesPerFrame);
    // bytes [f*bytesPerFrame + 32768, (f+1)*bytesPerFrame) stay 0xFF.
  }

  const chunks: Uint8Array[] = [];
  for (let i = 0; i < chunkCount; i++) {
    chunks.push(payload.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
  }
  return chunks;
}

// --- AKS075-style animated path -------------------------------------------
//
// For animated upload AK820 Pro firmware appears to need the AKS075/Windows-
// driver convention: IMAGE_CFG sub-command 0x03, a 256-byte frame header at
// the start of the data stream carrying frame count + per-frame delays, and
// SAVE (0x02) to commit instead of FINISH (0xF0). Static still uses gohv —
// these functions live alongside the gohv set; the operations layer picks
// which to use based on whether the upload is animated.

const ANIMATED_CFG_SUB = 0x03;
const FRAME_HEADER_BYTES = 256;
const CMD_SAVE = 0x02;

export function buildAnimatedStartReport(): ReportMessage {
  const bytes = new Uint8Array(PAYLOAD_LENGTH);
  bytes[0] = CMD_START;
  // bytes[7] = 0 (AKS075 sends enable=false for image transfer)
  return { reportId: CONTROL_LEAD, bytes };
}

export function buildAnimatedCfgReport(chunkCount: number): ReportMessage {
  if (!Number.isInteger(chunkCount) || chunkCount < 1 || chunkCount > 0xffff) {
    throw new Error(
      `buildAnimatedCfgReport: chunk count must be a uint16 in [1, 0xFFFF], got ${chunkCount}`,
    );
  }
  const bytes = new Uint8Array(PAYLOAD_LENGTH);
  bytes[0] = CMD_IMAGE;
  bytes[1] = ANIMATED_CFG_SUB;
  bytes[7] = chunkCount & 0xff;
  bytes[8] = (chunkCount >> 8) & 0xff;
  return { reportId: CONTROL_LEAD, bytes };
}

export function buildAnimatedSaveReport(): ReportMessage {
  const bytes = new Uint8Array(PAYLOAD_LENGTH);
  bytes[0] = CMD_SAVE;
  // bytes[7] = 0 (AKS075 SAVE has no enable flag)
  return { reportId: CONTROL_LEAD, bytes };
}

/**
 * 256-byte AKS075 frame header.
 *
 * Byte 0  : frame count (uint8, 1–255)
 * Byte 1+i: per-frame delay (uint8, max(1, delay_ms / 2), capped at 255)
 * Remaining bytes: 0xFF padding to 256 bytes.
 */
export function buildFrameHeader(numFrames: number, delaysMs: readonly number[]): Uint8Array {
  if (!Number.isInteger(numFrames) || numFrames < 1 || numFrames > 255) {
    throw new Error(`buildFrameHeader: numFrames must be in [1, 255], got ${numFrames}`);
  }
  if (delaysMs.length !== numFrames) {
    throw new Error(
      `buildFrameHeader: frame count ${numFrames} does not match delays length ${delaysMs.length}`,
    );
  }
  const header = new Uint8Array(FRAME_HEADER_BYTES).fill(0xff);
  header[0] = numFrames;
  for (let i = 0; i < delaysMs.length; i++) {
    const halved = Math.floor(delaysMs[i] / 2);
    header[1 + i] = Math.min(255, Math.max(1, halved));
  }
  return header;
}

export function buildAnimatedDataChunks(
  frames: readonly Uint8Array[],
  delaysMs: readonly number[],
): Uint8Array[] {
  if (frames.length < 1) {
    throw new Error("buildAnimatedDataChunks: at least one frame required");
  }
  if (frames.length !== delaysMs.length) {
    throw new Error(
      `buildAnimatedDataChunks: delay count ${delaysMs.length} does not match frame count ${frames.length}`,
    );
  }
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].byteLength !== RGB565_FRAME_BYTES) {
      throw new Error(
        `buildAnimatedDataChunks: frame ${i} is ${frames[i].byteLength} bytes, expected ${RGB565_FRAME_BYTES}`,
      );
    }
  }

  const header = buildFrameHeader(frames.length, delaysMs);
  const pixelSize = frames.length * RGB565_FRAME_BYTES;
  const payloadSize = FRAME_HEADER_BYTES + pixelSize;
  const chunkCount = Math.ceil(payloadSize / CHUNK_SIZE);
  const totalSize = chunkCount * CHUNK_SIZE;

  const payload = new Uint8Array(totalSize).fill(0xff);
  payload.set(header, 0);
  let offset = FRAME_HEADER_BYTES;
  for (const frame of frames) {
    payload.set(frame, offset);
    offset += frame.byteLength;
  }
  // Bytes [offset, totalSize) stay 0xFF.

  const chunks: Uint8Array[] = [];
  for (let i = 0; i < chunkCount; i++) {
    chunks.push(payload.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
  }
  return chunks;
}
