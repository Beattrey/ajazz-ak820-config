import { useEffect, useRef, useState } from "react";
import type { DeviceController } from "../device/types";
import { processStaticImage } from "../image/static";
import { processAnimatedImage } from "../image/animated";
import { uploadStaticImage, uploadAnimatedImage } from "../operations";
import { SCREEN_WIDTH, SCREEN_HEIGHT } from "../protocol/constants";

type Prepared =
  | { kind: "static"; buffer: Uint8Array }
  | { kind: "animated"; frames: Uint8Array[]; delaysMs: number[] };

export function ImagePanel({ controller }: { controller: DeviceController }) {
  const [connected, setConnected] = useState(controller.isConnected());
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => controller.onDisconnect(() => setConnected(false)), [controller]);
  useEffect(() => {
    const id = setInterval(() => setConnected(controller.isConnected()), 250);
    return () => clearInterval(id);
  }, [controller]);

  const onFile = async (file: File) => {
    setStatus(null);
    setProgress(0);
    try {
      if (file.type === "image/gif") {
        const anim = await processAnimatedImage(file);
        setPrepared({ kind: "animated", frames: anim.frames, delaysMs: anim.delaysMs });
        drawPreview(canvasRef.current, anim.frames[0]);
      } else {
        const buf = await processStaticImage(file);
        setPrepared({ kind: "static", buffer: buf });
        drawPreview(canvasRef.current, buf);
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to process file");
    }
  };

  const onUpload = async () => {
    if (!prepared) return;
    setStatus("Uploading…");
    try {
      if (prepared.kind === "static") {
        await uploadStaticImage(controller, prepared.buffer, setProgress);
      } else {
        await uploadAnimatedImage(controller, prepared.frames, prepared.delaysMs, setProgress);
      }
      setStatus("Uploaded");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Upload failed");
    }
  };

  return (
    <section className="panel">
      <h2>Image</h2>
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        disabled={!connected}
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
      />
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
      </div>
      <div style={{ marginTop: "0.75rem" }}>
        <button disabled={!connected || !prepared} onClick={onUpload}>
          Upload to keyboard
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
