import { useRef, useState } from "react";
import { useDeviceSession } from "../device/DeviceSession";
import { processStaticImage } from "../image/static";
import { processAnimatedImage } from "../image/animated";
import { uploadStaticImage, uploadAnimatedImage } from "../operations";
import { SCREEN_WIDTH, SCREEN_HEIGHT } from "../protocol/constants";

type Prepared =
  | { kind: "static"; buffer: Uint8Array }
  | { kind: "animated"; frames: Uint8Array[]; delaysMs: number[] };

export function ImagePanel() {
  const { controller, connected, activeOperation, runOperation } = useDeviceSession();
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

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
        await runOperation("image upload", () =>
          uploadStaticImage(controller, prepared.buffer, setProgress),
        );
      } else {
        await runOperation("image upload", () =>
          uploadAnimatedImage(controller, prepared.frames, prepared.delaysMs, setProgress),
        );
      }
      setStatus("Uploaded");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Upload failed");
    }
  };

  return (
    <section className="panel display-panel">
      <div className="display-preview">
        <canvas
          ref={canvasRef}
          width={SCREEN_WIDTH}
          height={SCREEN_HEIGHT}
          aria-label="Keyboard display image preview"
        />
        {!prepared && <p>Choose an image to preview it on the keyboard display.</p>}
      </div>
      <div className="display-controls">
        <div>
          <h3>Display image</h3>
          <p>PNG, JPEG, WebP or GIF. Images are resized to the keyboard's square TFT display.</p>
        </div>
        <label className="file-control">
          Choose image
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            disabled={!connected || activeOperation !== null}
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
        </label>
        <button
          type="button"
          className="primary-action"
          disabled={!connected || !prepared || activeOperation !== null}
          onClick={onUpload}
        >
          Upload to keyboard
        </button>
        {progress > 0 && progress < 1 && <progress value={progress} max={1} />}
        {status && <p role="status">{status}</p>}
      </div>
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
