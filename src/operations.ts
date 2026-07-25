import { buildTimeSyncReports } from "./protocol/time";
import {
  buildImageStartReport,
  buildImageCfgReport,
  buildImageFinishReport,
  buildImageDataChunks,
  buildAnimatedStartReport,
  buildAnimatedCfgReport,
  buildAnimatedSaveReport,
  buildAnimatedDataChunks,
} from "./protocol/image";
import { RGB565_FRAME_BYTES } from "./protocol/constants";
import { DeviceFailure } from "./device/errors";
import type { DeviceController } from "./device/types";
import { logInfo, logVerbose, logError } from "./log";

export type ProgressCallback = (fraction: number) => void;

// Inter-packet delays observed in reference implementations: ~40ms in
// aks075-linux between feature reports, 10ms in gohv with 100ms after SAVE.
// Without these the firmware appears to drop later packets even though the
// transport accepts them.
const INTER_PACKET_DELAY_MS = 50;
const POST_SAVE_DELAY_MS = 100;
const CHUNK_ACK_TIMEOUT_MS = 300;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Hex dump of the first `n` bytes of a report — verbose diagnostics only.
function dumpFirst(dv: DataView | null, n = 8): string {
  if (!dv) return "—";
  const len = Math.min(n, dv.byteLength);
  const parts: string[] = [];
  for (let k = 0; k < len; k++) parts.push(dv.getUint8(k).toString(16).padStart(2, "0"));
  return parts.join(" ");
}

function describeHandshake(dv: DataView | null): string {
  return dv ? `${dv.byteLength}B [${dumpFirst(dv)}]` : "null (STALL / no data — non-fatal)";
}

export async function syncTime(ctrl: DeviceController, date: Date): Promise<void> {
  // buildTimeSyncReports throws on invalid date.
  const [start, preamble, data, save] = buildTimeSyncReports(date);

  // Sequence mirrors aks075 driver: short sleeps after START and TIME_DATA,
  // handshake reads after TIME_PREAMBLE (TIME_CFG) and SAVE. The handshake is
  // what the firmware appears to wait on before processing the next SET.
  let phase = "init";
  try {
    phase = "START";
    logVerbose("[Sync] START");
    await ctrl.sendFeatureReport(start);
    await sleep(INTER_PACKET_DELAY_MS);

    phase = "TIME_PREAMBLE";
    logVerbose("[Sync] TIME_PREAMBLE");
    await ctrl.sendFeatureReport(preamble);
    logVerbose(`[Sync] handshake: ${describeHandshake(await ctrl.receiveFeatureReport(0))}`);

    phase = "TIME_DATA";
    logVerbose("[Sync] TIME_DATA");
    await ctrl.sendFeatureReport(data);
    await sleep(INTER_PACKET_DELAY_MS);

    phase = "SAVE";
    logVerbose("[Sync] SAVE");
    await ctrl.sendFeatureReport(save);
    logVerbose(`[Sync] handshake: ${describeHandshake(await ctrl.receiveFeatureReport(0))}`);
    await sleep(POST_SAVE_DELAY_MS);

    logInfo("[Sync] Time synced");
  } catch (e) {
    logError(`[Sync] failed at phase: ${phase}`, e);
    throw e;
  }
}

export async function uploadStaticImage(
  ctrl: DeviceController,
  rgb565: Uint8Array,
  onProgress: ProgressCallback,
): Promise<void> {
  if (rgb565.byteLength !== RGB565_FRAME_BYTES) {
    throw new DeviceFailure({
      kind: "validation",
      message: `Image buffer must be ${RGB565_FRAME_BYTES} bytes, got ${rgb565.byteLength}`,
    });
  }

  // Static path — gohv framing (proven working on AK820 Pro):
  // START(byte8=1) -> IMAGE_CFG(sub=0x02) -> 9 chunks of 4096 -> FINISH(0xF0).
  const chunks = buildImageDataChunks([rgb565], undefined);
  onProgress(0);
  logInfo(`[Image] upload started (${chunks.length} chunks)`);

  let phase = "init";
  try {
    phase = "START";
    await ctrl.sendFeatureReport(buildImageStartReport());
    logVerbose(`[Image] START handshake: ${describeHandshake(await ctrl.receiveFeatureReport(0))}`);

    phase = "IMAGE_CFG";
    await ctrl.sendFeatureReport(buildImageCfgReport(chunks.length));
    logVerbose(`[Image] CFG handshake: ${describeHandshake(await ctrl.receiveFeatureReport(0))}`);

    for (let i = 0; i < chunks.length; i++) {
      phase = `chunk ${i + 1}/${chunks.length}`;
      await ctrl.sendReport({ reportId: 0, bytes: chunks[i] });
      // FAIL-FAST: a missing ACK aborts the whole transfer. No further chunk
      // and no FINISH are sent. Presence check only (ack !== null): no
      // reference implementation validates specific ACK bytes.
      const ack = await ctrl.waitForDataInputReport(CHUNK_ACK_TIMEOUT_MS);
      if (!ack) {
        logError(`[Image] ACK timeout at chunk ${i + 1}/${chunks.length} — aborting (no FINISH)`);
        throw new DeviceFailure({
          kind: "validation",
          message: `Upload aborted: no ACK for chunk ${i + 1}/${chunks.length} within ${CHUNK_ACK_TIMEOUT_MS} ms`,
        });
      }
      logVerbose(`[Image] chunk ${i + 1}/${chunks.length} ACK ${ack.byteLength}B [${dumpFirst(ack)}]`);
      onProgress((i + 1) / chunks.length);
    }

    phase = "FINISH";
    await sleep(INTER_PACKET_DELAY_MS);
    await ctrl.sendFeatureReport(buildImageFinishReport());
    logVerbose(`[Image] FINISH handshake: ${describeHandshake(await ctrl.receiveFeatureReport(0))}`);
    await sleep(POST_SAVE_DELAY_MS);

    logInfo("[Image] upload completed");
    onProgress(1);
  } catch (e) {
    logError(`[Image] upload failed at phase: ${phase}`, e);
    throw e;
  }
}

export async function uploadAnimatedImage(
  ctrl: DeviceController,
  frames: readonly Uint8Array[],
  delaysMs: readonly number[],
  onProgress: ProgressCallback,
): Promise<void> {
  if (frames.length !== delaysMs.length) {
    throw new DeviceFailure({
      kind: "validation",
      message: `Frame count ${frames.length} does not match delays length ${delaysMs.length}`,
    });
  }

  // Animated path — AKS075 framing: 256-byte frame header at start, sub=0x03,
  // SAVE termination (no FINISH). START enable=false -> IMAGE_CFG(sub=0x03) ->
  // chunks of 4096 + per-chunk ACK -> SAVE(0x02).
  const chunks = buildAnimatedDataChunks(frames, delaysMs);
  onProgress(0);
  logInfo(`[Anim] upload started (${frames.length} frames, ${chunks.length} chunks)`);

  let phase = "init";
  try {
    phase = "START";
    await ctrl.sendFeatureReport(buildAnimatedStartReport());
    logVerbose(`[Anim] START handshake: ${describeHandshake(await ctrl.receiveFeatureReport(0))}`);

    phase = "IMAGE_CFG";
    await ctrl.sendFeatureReport(buildAnimatedCfgReport(chunks.length));
    logVerbose(`[Anim] CFG handshake: ${describeHandshake(await ctrl.receiveFeatureReport(0))}`);

    for (let i = 0; i < chunks.length; i++) {
      phase = `chunk ${i + 1}/${chunks.length}`;
      await ctrl.sendReport({ reportId: 0, bytes: chunks[i] });
      // FAIL-FAST: a missing ACK aborts. No further chunk and no SAVE.
      const ack = await ctrl.waitForDataInputReport(CHUNK_ACK_TIMEOUT_MS);
      if (!ack) {
        logError(`[Anim] ACK timeout at chunk ${i + 1}/${chunks.length} — aborting (no SAVE)`);
        throw new DeviceFailure({
          kind: "validation",
          message: `Animated upload aborted: no ACK for chunk ${i + 1}/${chunks.length} within ${CHUNK_ACK_TIMEOUT_MS} ms`,
        });
      }
      logVerbose(`[Anim] chunk ${i + 1}/${chunks.length} ACK ${ack.byteLength}B [${dumpFirst(ack)}]`);
      onProgress((i + 1) / chunks.length);
    }

    phase = "SAVE";
    await sleep(INTER_PACKET_DELAY_MS);
    await ctrl.sendFeatureReport(buildAnimatedSaveReport());
    logVerbose(`[Anim] SAVE handshake: ${describeHandshake(await ctrl.receiveFeatureReport(0))}`);
    await sleep(POST_SAVE_DELAY_MS);

    logInfo("[Anim] upload completed");
    onProgress(1);
  } catch (e) {
    logError(`[Anim] upload failed at phase: ${phase}`, e);
    throw e;
  }
}
