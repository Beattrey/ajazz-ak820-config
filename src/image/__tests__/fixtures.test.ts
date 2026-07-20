import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { RGB565_FRAME_BYTES } from "../../protocol/constants";
import { inspectWebP } from "../animated";
import { processStaticImage } from "../static";

const imagesDirectory = join(process.cwd(), "images");

type Baseline = {
  sourceSha256: string;
  rgb565Sha256?: string;
  webPInfo?: { animated: boolean; width: number; height: number; frameCount: number };
};

const baselines: Record<string, Baseline> = {
  "20048-2-pikachu-hd.png": {
    sourceSha256: "2ea698124dfdc2705919f72289ef2eb075fbe6382f4f68915f3549ace3e9e69c",
    rgb565Sha256: "44f11e5c703fbd3e397c88113d2c5f80b18d19a77c961fef738239e2add6ff19",
  },
  "java_duke.jpeg": {
    sourceSha256: "37de14611c8ca6097a5cfb2fd8a76c93e31b7a97b179d3408dee9e13362f303b",
    rgb565Sha256: "3fbf5183e123cc669c4bae24e07c17e8fbc051e1f4e5e0ef5c4848f72a1656b7",
  },
  "pica.webp": {
    sourceSha256: "6235cf0e460d21bbaf8644650513ddf6d00016dbbfc82a1730dc022724b2c684",
    webPInfo: { animated: true, width: 500, height: 500, frameCount: 23 },
  },
};

const mimeTypes: Record<string, string> = {
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("images regression fixtures", () => {
  test("every image has a regression baseline", async () => {
    const imageNames = (await readdir(imagesDirectory)).sort();
    expect(Object.keys(baselines).sort()).toEqual(imageNames);
  });

  test.each(Object.entries(baselines))("%s", async (name, baseline) => {
    const bytes = new Uint8Array(await readFile(join(imagesDirectory, name)));
    const mimeType = mimeTypes[extname(name).toLowerCase()];
    expect(mimeType, `unsupported fixture extension for ${name}`).toBeDefined();

    expect(sha256(bytes)).toBe(baseline.sourceSha256);
    if (baseline.rgb565Sha256) {
      const output = await processStaticImage(new File([bytes], name, { type: mimeType }));
      expect(output).toHaveLength(RGB565_FRAME_BYTES);
      expect(sha256(output)).toBe(baseline.rgb565Sha256);
    } else if (baseline.webPInfo) {
      expect(inspectWebP(bytes.buffer)).toEqual(baseline.webPInfo);
    } else {
      throw new Error(`fixture ${name} has no processed-output or WebP baseline`);
    }
  });
});
