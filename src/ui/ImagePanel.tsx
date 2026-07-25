import { useEffect, useRef, useState } from "react";
import type { DeviceController } from "../device/types";
import { processStaticImage, type ResizeMode } from "../image/static";
import { processAnimatedImage } from "../image/animated";
import { uploadStaticImage, uploadAnimatedImage } from "../operations";
import { SCREEN_WIDTH, SCREEN_HEIGHT, RGB565_FRAME_BYTES } from "../protocol/constants";
import { logVerbose } from "../log";

type Prepared =
  | { kind: "static"; buffer: Uint8Array; sourceW: number; sourceH: number; mode: ResizeMode }
  | { kind: "animated"; frames: Uint8Array[]; delaysMs: number[] };

export function ImagePanel({ controller }: { controller: DeviceController }) {
  const [connected, setConnected] = useState(controller.isConnected());
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  // Guards against double-click / concurrent uploads. Disables every upload
  // control while a transfer is in flight. No automatic retry / recovery.
  const [busy, setBusy] = useState(false);
  const [resizeMode, setResizeMode] = useState<ResizeMode>("cover");
  // Keep the raw file so changing the resize mode can re-process it locally.
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => controller.onDisconnect(() => setConnected(false)), [controller]);
  useEffect(() => {
    const id = setInterval(() => setConnected(controller.isConnected()), 250);
    return () => clearInterval(id);
  }, [controller]);

  const staticValid =
    prepared?.kind === "static" && prepared.buffer.byteLength === RGB565_FRAME_BYTES;
  const gifValid =
    prepared?.kind === "animated" &&
    prepared.frames.length > 0 &&
    prepared.frames.every((f) => f.byteLength === RGB565_FRAME_BYTES);

  // Animate the GIF preview: cycle through frames honoring per-frame delays.
  useEffect(() => {
    if (prepared?.kind !== "animated") return;
    const { frames, delaysMs } = prepared;
    let idx = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      drawPreview(canvasRef.current, frames[idx]);
      const d = Math.max(20, delaysMs[idx] || 100);
      idx = (idx + 1) % frames.length;
      timer = setTimeout(tick, d);
    };
    tick();
    return () => clearTimeout(timer);
  }, [prepared]);

  const prepareStatic = async (file: File, mode: ResizeMode) => {
    const res = await processStaticImage(file, mode);
    setPrepared({
      kind: "static",
      buffer: res.rgb565,
      sourceW: res.sourceWidth,
      sourceH: res.sourceHeight,
      mode,
    });
    drawPreview(canvasRef.current, res.rgb565);
  };

  const prepareGif = async (file: File) => {
    const anim = await processAnimatedImage(file);
    setPrepared({ kind: "animated", frames: anim.frames, delaysMs: anim.delaysMs });
    drawPreview(canvasRef.current, anim.frames[0]);
  };

  const onFile = async (file: File) => {
    setStatus(null);
    setProgress(0);
    setSelectedFile(file);
    try {
      if (file.type === "image/gif") {
        await prepareGif(file);
      } else {
        await prepareStatic(file, resizeMode);
      }
    } catch (e) {
      setPrepared(null);
      setStatus(e instanceof Error ? e.message : "Failed to process file");
    }
  };

  const onModeChange = async (mode: ResizeMode) => {
    setResizeMode(mode);
    if (busy || !selectedFile || selectedFile.type === "image/gif") return;
    try {
      await prepareStatic(selectedFile, mode);
    } catch (e) {
      setPrepared(null);
      setStatus(e instanceof Error ? e.message : "Failed to process file");
    }
  };

  const onUpload = async () => {
    if (!prepared || prepared.kind !== "static" || busy || !staticValid) return;
    setBusy(true);
    setStatus("Uploading…");
    try {
      logVerbose(`[Image] source ${prepared.sourceW}x${prepared.sourceH}, mode ${prepared.mode}`);
      await uploadStaticImage(controller, prepared.buffer, setProgress);
      setStatus("Uploaded");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  const onUploadGif = async () => {
    if (!prepared || prepared.kind !== "animated" || busy || !gifValid) return;
    setBusy(true);
    setStatus("Uploading GIF…");
    try {
      await uploadAnimatedImage(controller, prepared.frames, prepared.delaysMs, setProgress);
      setStatus("GIF uploaded");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <h2>Image</h2>
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        disabled={!connected || busy}
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
      />
      <fieldset style={{ marginTop: "0.75rem", border: "1px solid #333" }} disabled={busy}>
        <legend>Aspect ratio</legend>
        <label style={{ marginRight: "1rem" }}>
          <input
            type="radio"
            name="resizeMode"
            checked={resizeMode === "cover"}
            onChange={() => onModeChange("cover")}
          />{" "}
          Crop / Cover (default)
        </label>
        <label>
          <input
            type="radio"
            name="resizeMode"
            checked={resizeMode === "contain"}
            onChange={() => onModeChange("contain")}
          />{" "}
          Fit / Contain (black bars)
        </label>
      </fieldset>
      <div style={{ marginTop: "0.75rem" }}>
        <canvas
          ref={canvasRef}
          width={SCREEN_WIDTH}
          height={SCREEN_HEIGHT}
          style={{
            width: 256,
            height: 256,
            imageRendering: "pixelated",
            border: "1px solid #333",
          }}
        />
        <p style={{ margin: "0.25rem 0 0" }}>
          Final resolution: {SCREEN_WIDTH}×{SCREEN_HEIGHT}
          {prepared?.kind === "static" && (
            <> — source {prepared.sourceW}×{prepared.sourceH}, mode {prepared.mode}</>
          )}
        </p>
      </div>
      <div style={{ marginTop: "0.75rem" }}>
        <button disabled={!connected || busy || !staticValid} onClick={onUpload}>
          Upload selected image
        </button>{" "}
        <button disabled={!connected || busy || !gifValid} onClick={onUploadGif}>
          Upload selected GIF
        </button>
      </div>
      {progress > 0 && progress < 1 && (
        <progress value={progress} max={1} style={{ width: "100%", marginTop: "0.5rem" }} />
      )}
      {status && <p>{status}</p>}
    </section>
  );
}

function drawPreview(canvas: HTMLCanvasElement | null, rgb565: Uint8Array) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const img = ctx.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
  for (let i = 0; i < SCREEN_WIDTH * SCREEN_HEIGHT; i++) {
    const lo = rgb565[i * 2];
    const hi = rgb565[i * 2 + 1];
    const v = (hi << 8) | lo;
    const r = ((v >> 11) & 0x1f) << 3;
    const g = ((v >> 5) & 0x3f) << 2;
    const b = (v & 0x1f) << 3;
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
