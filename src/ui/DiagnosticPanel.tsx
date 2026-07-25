import { useEffect, useState } from "react";
import type { WebHIDDeviceController } from "../device/webhid-controller";
import { buildTimeSyncReports } from "../protocol/time";
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
} from "../protocol/image";
import { rgb888ToRgb565 } from "../image/rgb565";
import { generateTestPatternRgba, generateTwoFrameAnimation } from "../image/test-pattern";
import { SCREEN_WIDTH, SCREEN_HEIGHT, CHUNK_SIZE } from "../protocol/constants";
import type { ReportMessage } from "../protocol/types";
import { uploadStaticImage, uploadAnimatedImage } from "../operations";
import { setVerboseLogging, isVerboseLogging } from "../log";

/**
 * Advanced / Diagnostics panel (collapsed by default).
 *
 * Read-only / dry-run tools print to the DevTools Console and send nothing:
 *  - "Diagnostic read" issues one GET_REPORT (read only).
 *  - "Dry-run …" builds packets/payloads in RAM and prints them without ever
 *    calling sendFeatureReport / sendReport.
 *
 * The two SAFE-upload buttons DO send, but only a locally generated test
 * pattern / animation (never a user file) through the validated upload paths —
 * useful to probe a new PID/revision before sending real content.
 *
 * The verbose-logging toggle enables per-chunk / handshake / descriptor detail
 * in the protocol layer. It never changes protocol behaviour.
 */

const hex = (n: number) => `0x${n.toString(16).padStart(2, "0")}`;

/** Reconstruct the exact 64-byte on-wire buffer (lead byte + 63-byte payload). */
function toWire(report: ReportMessage): Uint8Array {
  const wire = new Uint8Array(report.bytes.byteLength + 1);
  wire[0] = report.reportId;
  wire.set(report.bytes, 1);
  return wire;
}

function dumpHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
}

/** Identify a control/time packet from its on-wire lead + command bytes. */
function identify(wire: Uint8Array): string {
  if (wire[0] === 0x00) return "TIME_DATA (report-id-as-payload 0x00, magic 0x5A)";
  if (wire[0] === 0x04) {
    switch (wire[1]) {
      case 0x18:
        return `START (CMD 0x18, enable@byte8=${hex(wire[8])})`;
      case 0x28:
        return "TIME_PREAMBLE / TIME_CFG (CMD 0x28)";
      case 0x02:
        return "SAVE (CMD 0x02, commit to flash)";
      default:
        return `UNKNOWN control command ${hex(wire[1])}`;
    }
  }
  return `UNKNOWN lead byte ${hex(wire[0])}`;
}

// What operations.syncTime() does AFTER each packet — kept in sync with
// src/operations.ts so the dry-run faithfully describes the real flow.
const POST_ACTION = [
  "→ sleep 50 ms (no read)",
  "→ receiveFeatureReport(0)  [read-only handshake]",
  "→ sleep 50 ms (no read)",
  "→ receiveFeatureReport(0)  [read-only handshake] + sleep 100 ms",
];

export function DiagnosticPanel({ controller }: { controller: WebHIDDeviceController }) {
  const [connected, setConnected] = useState(controller.isConnected());
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [verbose, setVerbose] = useState(isVerboseLogging());

  useEffect(() => controller.onDisconnect(() => setConnected(false)), [controller]);
  useEffect(() => {
    const id = setInterval(() => setConnected(controller.isConnected()), 250);
    return () => clearInterval(id);
  }, [controller]);

  const onToggleVerbose = (on: boolean) => {
    setVerbose(on);
    setVerboseLogging(on);
  };

  // SAFE uploads: send ONLY a locally generated pattern through the validated
  // upload path. Guarded against double-click / concurrent transfers.
  const onUploadSafePattern = async () => {
    if (busy) return;
    setBusy(true);
    setStatus("Uploading SAFE test pattern…");
    try {
      const rgba = generateTestPatternRgba(SCREEN_WIDTH, SCREEN_HEIGHT, 32);
      const rgb565 = rgb888ToRgb565(rgba, SCREEN_WIDTH, SCREEN_HEIGHT, "le");
      await uploadStaticImage(controller, rgb565, () => {});
      setStatus("SAFE test pattern uploaded");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const onUploadSafeAnimation = async () => {
    if (busy) return;
    setBusy(true);
    setStatus("Uploading SAFE animation…");
    try {
      const { frames, delaysMs } = generateTwoFrameAnimation();
      await uploadAnimatedImage(controller, frames, delaysMs, () => {});
      setStatus("SAFE animation uploaded");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const onDiagnosticRead = async () => {
    setStatus("Reading…");
    // eslint-disable-next-line no-console
    console.log("[Diag] --- Diagnostic READ (GET_REPORT, read-only) on control 0xFF13 ---");
    try {
      const dv = await controller.diagnosticReadFeatureReport(0);
      const bytes = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
      // eslint-disable-next-line no-console
      console.log(`[Diag] read OK — length=${dv.byteLength} bytes`);
      // eslint-disable-next-line no-console
      console.log(`[Diag] bytes: ${dumpHex(bytes)}`);
      setStatus(`Read OK — ${dv.byteLength} bytes (see Console)`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[Diag] read returned an error / STALL (non-fatal):", e);
      setStatus(`Read error / STALL: ${e instanceof Error ? e.message : String(e)} (see Console)`);
    }
  };

  const onDryRun = () => {
    // Builds the real packets via the real builder, but NEVER sends them.
    const now = new Date();
    const reports = buildTimeSyncReports(now);
    const names = ["① START", "② TIME_PREAMBLE", "③ TIME_DATA", "④ SAVE"];
    // eslint-disable-next-line no-console
    console.log(
      `[Diag] === DRY-RUN syncTime(${now.toString()}) — NOTHING IS SENT ===`,
    );
    reports.forEach((r, i) => {
      const wire = toWire(r);
      // eslint-disable-next-line no-console
      console.log(
        `[Diag] ${names[i]}  ReportMessage.reportId=${hex(r.reportId)} ` +
          `(lead byte) → WebHID call would be sendFeatureReport(0, <${wire.byteLength}B>)`,
      );
      // eslint-disable-next-line no-console
      console.log(`[Diag]    identified: ${identify(wire)}`);
      // eslint-disable-next-line no-console
      console.log(`[Diag]    on-wire ${wire.byteLength} bytes: ${dumpHex(wire)}`);
      // eslint-disable-next-line no-console
      console.log(`[Diag]    after this packet syncTime would: ${POST_ACTION[i]}`);
    });
    // eslint-disable-next-line no-console
    console.log(
      "[Diag] DRY-RUN complete. No sendFeatureReport / sendReport / SAVE was called.",
    );
    setStatus("Dry-run printed to Console — nothing was sent");
  };

  const onDryRunImage = () => {
    // Runs the REAL conversion + chunking pipeline in RAM, sends NOTHING.
    // Source is generated at 128x128 so there is no resize step (the cover/crop
    // resize in processStaticImage only applies to user-supplied files).
    const rgba = generateTestPatternRgba(SCREEN_WIDTH, SCREEN_HEIGHT, 32);
    // eslint-disable-next-line no-console
    console.log(
      `[ImgDry] === DRY-RUN static image — NOTHING IS SENT ===`,
    );
    // eslint-disable-next-line no-console
    console.log(
      `[ImgDry] source: ${SCREEN_WIDTH}x${SCREEN_HEIGHT} RGBA = ${rgba.length} bytes ` +
        `(black bg + 32x32 white centre square; already 128x128 → no resize)`,
    );

    // Real RGB565 conversion (little-endian, exactly what the upload path uses).
    const rgb565 = rgb888ToRgb565(rgba, SCREEN_WIDTH, SCREEN_HEIGHT, "le");
    const centreIdx = ((SCREEN_HEIGHT / 2) * SCREEN_WIDTH + SCREEN_WIDTH / 2) * 2;
    // eslint-disable-next-line no-console
    console.log(
      `[ImgDry] RGB565 (LE) buffer: ${rgb565.length} bytes; ` +
        `pixel[0] (black) = ${hex(rgb565[0])} ${hex(rgb565[1])}; ` +
        `centre pixel (white) = ${hex(rgb565[centreIdx])} ${hex(rgb565[centreIdx + 1])} (expect ff ff)`,
    );

    // Real chunker (static / gohv framing: no 256-byte header).
    const chunks = buildImageDataChunks([rgb565], undefined);
    const total = chunks.reduce((a, c) => a + c.byteLength, 0);
    const allExact = chunks.every((c) => c.byteLength === CHUNK_SIZE);
    // eslint-disable-next-line no-console
    console.log(
      `[ImgDry] chunks: ${chunks.length} × ${CHUNK_SIZE} B = ${total} B total; ` +
        `every chunk exactly ${CHUNK_SIZE}? ${allExact}`,
    );
    const last = chunks[chunks.length - 1];
    // eslint-disable-next-line no-console
    console.log(`[ImgDry]   chunk 1 first 8 bytes: ${dumpHex(chunks[0].subarray(0, 8))}`);
    // eslint-disable-next-line no-console
    console.log(
      `[ImgDry]   final chunk last 8 bytes: ${dumpHex(last.subarray(last.byteLength - 8))} (expect ff… padding)`,
    );

    // Control command sequence — BUILT ONLY, not sent.
    const startR = buildImageStartReport();
    const cfgR = buildImageCfgReport(chunks.length);
    const finishR = buildImageFinishReport();
    // eslint-disable-next-line no-console
    console.log(`[ImgDry] CONTROL 0xFF13 sequence that WOULD be sent (nothing sent):`);
    // eslint-disable-next-line no-console
    console.log(`[ImgDry]   START    : ${dumpHex(toWire(startR))}`);
    // eslint-disable-next-line no-console
    console.log(
      `[ImgDry]   IMAGE_CFG: ${dumpHex(toWire(cfgR))}  (chunkCount=${chunks.length} at wire bytes 8-9, sub-cmd=0x02 gohv)`,
    );
    // eslint-disable-next-line no-console
    console.log(
      `[ImgDry]   then ${chunks.length} DATA chunks on 0xFF68 (reportId 0), each awaiting one ACK input report`,
    );
    // eslint-disable-next-line no-console
    console.log(`[ImgDry]   FINISH   : ${dumpHex(toWire(finishR))}  (0xF0)`);
    // eslint-disable-next-line no-console
    console.log(
      `[ImgDry] framing = gohv (START enable=1, sub=0x02, NO 256B header, FINISH 0xF0). NOTHING WAS SENT.`,
    );
    setStatus("Image dry-run printed to Console — nothing was sent");
  };

  const onDryRunAnimation = () => {
    // Builds the REAL animated payload in RAM, sends NOTHING.
    const { frames, delaysMs } = generateTwoFrameAnimation();
    // eslint-disable-next-line no-console
    console.log("[AnimDry] === DRY-RUN SAFE animation — NOTHING IS SENT ===");
    // eslint-disable-next-line no-console
    console.log(`[AnimDry] frame count: ${frames.length}`);
    // eslint-disable-next-line no-console
    console.log(`[AnimDry] delays ms: [${delaysMs.join(", ")}]`);
    const encoded = delaysMs.map((d) => Math.min(255, Math.max(1, Math.floor(d / 2))));
    // eslint-disable-next-line no-console
    console.log(`[AnimDry] delays encoded: [${encoded.map(hex).join(", ")}]`);

    const header = buildFrameHeader(frames.length, delaysMs);
    // eslint-disable-next-line no-console
    console.log(`[AnimDry] header first 16 bytes: ${dumpHex(header.subarray(0, 16))}`);
    // eslint-disable-next-line no-console
    console.log(`[AnimDry] header size: ${header.length} B`);
    // eslint-disable-next-line no-console
    console.log(`[AnimDry] frame RGB565 size: ${frames[0].byteLength} B`);
    const pixelPayload = frames.length * frames[0].byteLength;
    // eslint-disable-next-line no-console
    console.log(`[AnimDry] pixel payload: ${pixelPayload} B`);
    // eslint-disable-next-line no-console
    console.log(`[AnimDry] payload before padding: ${header.length + pixelPayload} B`);

    const chunks = buildAnimatedDataChunks(frames, delaysMs);
    const total = chunks.reduce((a, c) => a + c.byteLength, 0);
    // eslint-disable-next-line no-console
    console.log(`[AnimDry] padded size: ${total} B`);
    // eslint-disable-next-line no-console
    console.log(`[AnimDry] chunk count: ${chunks.length}`);
    // eslint-disable-next-line no-console
    console.log(
      `[AnimDry] every chunk exactly ${CHUNK_SIZE}: ${chunks.every((c) => c.byteLength === CHUNK_SIZE)}`,
    );
    // eslint-disable-next-line no-console
    console.log(`[AnimDry] first bytes chunk 1: ${dumpHex(chunks[0].subarray(0, 16))}`);
    const last = chunks[chunks.length - 1];
    // eslint-disable-next-line no-console
    console.log(`[AnimDry] last bytes final chunk: ${dumpHex(last.subarray(last.byteLength - 8))}`);

    // Control reports — BUILT ONLY, not sent.
    // eslint-disable-next-line no-console
    console.log(
      `[AnimDry] START    : ${dumpHex(toWire(buildAnimatedStartReport()))}  (enable=false)`,
    );
    // eslint-disable-next-line no-console
    console.log(
      `[AnimDry] IMAGE_CFG: ${dumpHex(toWire(buildAnimatedCfgReport(chunks.length)))}  (sub=0x03, chunkCount=${chunks.length})`,
    );
    // eslint-disable-next-line no-console
    console.log(
      `[AnimDry] SAVE     : ${dumpHex(toWire(buildAnimatedSaveReport()))}  (0x02, NO FINISH 0xF0)`,
    );
    // eslint-disable-next-line no-console
    console.log("[AnimDry] NOTHING WAS SENT.");
    setStatus("Animation dry-run printed to Console — nothing was sent");
  };

  return (
    <section className="panel">
      <details>
        <summary style={{ cursor: "pointer", fontWeight: "bold" }}>Advanced / Diagnostics</summary>
        <p>
          <label>
            <input
              type="checkbox"
              checked={verbose}
              onChange={(e) => onToggleVerbose(e.target.checked)}
            />{" "}
            Verbose protocol logging (per-chunk / handshake / descriptor detail)
          </label>
        </p>

        <h3>Read-only / dry-run (nothing is sent)</h3>
        <button onClick={onDiagnosticRead} disabled={!connected || busy}>
          Diagnostic read (read-only)
        </button>{" "}
        <button onClick={onDryRun} disabled={busy}>
          Dry-run Sync Time
        </button>{" "}
        <button onClick={onDryRunImage} disabled={busy}>
          Dry-run Static Image
        </button>{" "}
        <button onClick={onDryRunAnimation} disabled={busy}>
          Dry-run SAFE animation
        </button>

        <h3 style={{ marginTop: "0.75rem" }}>SAFE test uploads (local pattern only)</h3>
        <button onClick={onUploadSafePattern} disabled={!connected || busy}>
          Upload SAFE test pattern
        </button>{" "}
        <button onClick={onUploadSafeAnimation} disabled={!connected || busy}>
          Upload SAFE animation
        </button>

        {status && <p>{status}</p>}
      </details>
    </section>
  );
}
