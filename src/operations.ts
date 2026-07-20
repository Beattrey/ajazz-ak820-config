import { DeviceFailure } from "./device/errors";
import type { DeviceController } from "./device/types";
import { RGB565_FRAME_BYTES } from "./protocol/constants";
import {
  buildAnimatedCfgReport,
  buildAnimatedDataChunks,
  buildAnimatedSaveReport,
  buildAnimatedStartReport,
  buildImageCfgReport,
  buildImageDataChunks,
  buildImageSaveReport,
  buildImageStartReport,
} from "./protocol/image";
import {
  buildLightingDataReport,
  buildLightingFinishReport,
  buildLightingModePreambleReport,
  buildLightingStartReport,
  type LightingConfig,
} from "./protocol/lighting";
import {
  buildLightingSleepDataReport,
  buildLightingSleepPreambleReport,
  type LightingSleepTime,
} from "./protocol/lighting-sleep";
import { buildTimeSyncReports } from "./protocol/time";

export type ProgressCallback = (fraction: number) => void;

// Inter-packet delays observed in reference implementations: ~40ms in
// aks075-linux between feature reports, 10ms in gohv with 100ms after SAVE.
// Without these the firmware appears to drop later packets even though the
// transport accepts them.
const INTER_PACKET_DELAY_MS = 50;
const POST_SAVE_DELAY_MS = 100;
const CHUNK_ACK_TIMEOUT_MS = 300;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function syncTime(ctrl: DeviceController, date: Date): Promise<void> {
  // buildTimeSyncReports throws on invalid date.
  const [start, preamble, data, save] = buildTimeSyncReports(date);

  // Sequence mirrors aks075 driver: short sleeps after START and TIME_DATA,
  // handshake reads after TIME_PREAMBLE (TIME_CFG) and SAVE. The handshake
  // is what the firmware appears to wait on before processing the next SET.
  await ctrl.sendFeatureReport(start);
  await sleep(INTER_PACKET_DELAY_MS);

  await ctrl.sendFeatureReport(preamble);
  await ctrl.receiveFeatureReport(0);

  await ctrl.sendFeatureReport(data);
  await sleep(INTER_PACKET_DELAY_MS);

  await ctrl.sendFeatureReport(save);
  await ctrl.receiveFeatureReport(0);
  await sleep(POST_SAVE_DELAY_MS);
}

export async function setLighting(ctrl: DeviceController, config: LightingConfig): Promise<void> {
  const reports = [
    buildLightingStartReport(),
    buildLightingModePreambleReport(),
    buildLightingDataReport(config),
    buildLightingFinishReport(),
  ];

  for (const report of reports) {
    await ctrl.sendFeatureReport(report);
    // The keyboard only supports GET_FEATURE for 0x04 control packets.
    // Reading after the mode-specific data packet can abort its state machine.
    if (report.reportId === 0x04) await ctrl.receiveFeatureReport(0);
    await sleep(INTER_PACKET_DELAY_MS);
  }
  await sleep(POST_SAVE_DELAY_MS);
}

export async function setLightingSleepTime(
  ctrl: DeviceController,
  sleepTime: LightingSleepTime,
): Promise<void> {
  const reports = [
    buildLightingStartReport(),
    buildLightingSleepPreambleReport(),
    buildLightingSleepDataReport(sleepTime),
  ];

  for (const report of reports) {
    await ctrl.sendFeatureReport(report);
    if (report.reportId === 0x04) await ctrl.receiveFeatureReport(0);
    await sleep(INTER_PACKET_DELAY_MS);
  }
  await sleep(POST_SAVE_DELAY_MS);
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

  // Static path — AKS075 framing used by the Windows driver.
  // START(byte7=0) → IMAGE_CFG(sub=0x03) → header + pixels → SAVE(0x02)
  const chunks = buildImageDataChunks([rgb565], undefined);
  onProgress(0);

  await ctrl.sendFeatureReport(buildImageStartReport());
  await ctrl.receiveFeatureReport(0);

  await ctrl.sendFeatureReport(buildImageCfgReport(chunks.length));
  await ctrl.receiveFeatureReport(0);

  for (let i = 0; i < chunks.length; i++) {
    await ctrl.sendReport({ reportId: 0, bytes: chunks[i] });
    await ctrl.waitForDataInputReport(CHUNK_ACK_TIMEOUT_MS);
    onProgress((i + 1) / chunks.length);
  }

  await sleep(INTER_PACKET_DELAY_MS);
  await ctrl.sendFeatureReport(buildImageSaveReport());
  await ctrl.receiveFeatureReport(0);
  await sleep(POST_SAVE_DELAY_MS);
  onProgress(1);
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
  // SAVE termination. AK820 Pro firmware appears to need this convention to
  // know "this is N frames with delays X,Y,Z" rather than treating the data
  // as one big static blob.
  const chunks = buildAnimatedDataChunks(frames, delaysMs);
  onProgress(0);

  await ctrl.sendFeatureReport(buildAnimatedStartReport());
  await ctrl.receiveFeatureReport(0);

  await ctrl.sendFeatureReport(buildAnimatedCfgReport(chunks.length));
  await ctrl.receiveFeatureReport(0);

  for (let i = 0; i < chunks.length; i++) {
    await ctrl.sendReport({ reportId: 0, bytes: chunks[i] });
    await ctrl.waitForDataInputReport(CHUNK_ACK_TIMEOUT_MS);
    onProgress((i + 1) / chunks.length);
  }

  await sleep(INTER_PACKET_DELAY_MS);
  await ctrl.sendFeatureReport(buildAnimatedSaveReport());
  await ctrl.receiveFeatureReport(0);
  await sleep(POST_SAVE_DELAY_MS);
  onProgress(1);
}
