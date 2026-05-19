import { Canvas, Image, createCanvas, loadImage, type CanvasRenderingContext2D as NodeCRC } from "canvas";

class OffscreenCanvasPolyfill {
  width: number;
  height: number;
  private canvas: Canvas;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.canvas = createCanvas(width, height);
  }
  getContext(contextId: "2d") {
    if (contextId !== "2d") return null;
    return this.canvas.getContext("2d") as unknown as NodeCRC;
  }
}

(globalThis as unknown as { OffscreenCanvas: typeof OffscreenCanvasPolyfill }).OffscreenCanvas =
  OffscreenCanvasPolyfill;

// jsdom's Blob/File don't implement arrayBuffer().
// jsdom wraps Blob data behind a Symbol("impl") property whose ._buffer holds the raw Buffer.
// Patch Blob.prototype.arrayBuffer to reach through that internal symbol.
if (!globalThis.Blob.prototype.arrayBuffer) {
  globalThis.Blob.prototype.arrayBuffer = async function (): Promise<ArrayBuffer> {
    // Find the jsdom impl symbol (there is exactly one Symbol key on jsdom objects)
    const syms = Object.getOwnPropertySymbols(this) as symbol[];
    for (const sym of syms) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const impl = (this as unknown as Record<symbol, unknown>)[sym] as Record<string, unknown> | null;
      if (impl && typeof impl === "object" && impl._buffer instanceof Buffer) {
        const nodeBuf: Buffer = impl._buffer as Buffer;
        // Copy into a plain ArrayBuffer so callers get a detached view
        const ab = new ArrayBuffer(nodeBuf.byteLength);
        new Uint8Array(ab).set(new Uint8Array(nodeBuf));
        return ab;
      }
    }
    return new ArrayBuffer(0);
  };
}

(globalThis as unknown as {
  createImageBitmap: (source: Blob) => Promise<Image>;
}).createImageBitmap = async (source: Blob): Promise<Image> => {
  const buf = Buffer.from(await source.arrayBuffer());
  return await loadImage(buf);
};
