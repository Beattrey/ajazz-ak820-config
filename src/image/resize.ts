export type ContainRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
};

export type RgbColor = readonly [red: number, green: number, blue: number];

export function calculateContainRect(
  sourceWidth: number,
  sourceHeight: number,
  destinationWidth: number,
  destinationHeight: number,
): ContainRect {
  const scale = Math.min(destinationWidth / sourceWidth, destinationHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: (destinationWidth - width) / 2,
    y: (destinationHeight - height) / 2,
    width,
    height,
    scale,
  };
}

/**
 * Finds the dominant visible color using 5-bit RGB buckets, then returns the
 * average original color in the winning bucket. Quantization makes the result
 * stable for JPEGs and other images with small per-pixel color variations.
 */
export function findDominantColor(
  source: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  bounds: Pick<ContainRect, "x" | "y" | "width" | "height"> = {
    x: 0,
    y: 0,
    width: sourceWidth,
    height: sourceHeight,
  },
): RgbColor {
  const bucketCount = 32 * 32 * 32;
  const counts = new Uint32Array(bucketCount);
  const redSums = new Uint32Array(bucketCount);
  const greenSums = new Uint32Array(bucketCount);
  const blueSums = new Uint32Array(bucketCount);
  const startX = Math.max(0, Math.ceil(bounds.x));
  const startY = Math.max(0, Math.ceil(bounds.y));
  const endX = Math.min(sourceWidth, Math.floor(bounds.x + bounds.width));
  const endY = Math.min(sourceHeight, Math.floor(bounds.y + bounds.height));

  let dominantBucket = 0;
  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const offset = (y * sourceWidth + x) * 4;
      if (source[offset + 3] < 128) continue;
      const red = source[offset];
      const green = source[offset + 1];
      const blue = source[offset + 2];
      const bucket = ((red >> 3) << 10) | ((green >> 3) << 5) | (blue >> 3);
      counts[bucket]++;
      redSums[bucket] += red;
      greenSums[bucket] += green;
      blueSums[bucket] += blue;
      if (counts[bucket] > counts[dominantBucket]) dominantBucket = bucket;
    }
  }

  const count = counts[dominantBucket];
  if (count === 0) return [0, 0, 0];
  return [
    Math.round(redSums[dominantBucket] / count),
    Math.round(greenSums[dominantBucket] / count),
    Math.round(blueSums[dominantBucket] / count),
  ];
}

export function fillContainPadding(
  destination: Uint8ClampedArray,
  destinationWidth: number,
  destinationHeight: number,
  rect: Pick<ContainRect, "x" | "y" | "width" | "height">,
  color: RgbColor,
): void {
  for (let y = 0; y < destinationHeight; y++) {
    for (let x = 0; x < destinationWidth; x++) {
      const centerX = x + 0.5;
      const centerY = y + 0.5;
      if (
        centerX >= rect.x &&
        centerX < rect.x + rect.width &&
        centerY >= rect.y &&
        centerY < rect.y + rect.height
      ) {
        continue;
      }
      const offset = (y * destinationWidth + x) * 4;
      destination[offset] = color[0];
      destination[offset + 1] = color[1];
      destination[offset + 2] = color[2];
      destination[offset + 3] = 255;
    }
  }
}

export function containsTransparency(
  source: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  bounds: Pick<ContainRect, "x" | "y" | "width" | "height"> = {
    x: 0,
    y: 0,
    width: sourceWidth,
    height: sourceHeight,
  },
): boolean {
  const startX = Math.max(0, Math.ceil(bounds.x));
  const startY = Math.max(0, Math.ceil(bounds.y));
  const endX = Math.min(sourceWidth, Math.floor(bounds.x + bounds.width));
  const endY = Math.min(sourceHeight, Math.floor(bounds.y + bounds.height));
  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      if (source[(y * sourceWidth + x) * 4 + 3] < 255) return true;
    }
  }
  return false;
}

/** RGB565 has no alpha channel, so composite transparent pixels onto black. */
export function flattenTransparencyOntoBlack(source: Uint8ClampedArray): void {
  for (let offset = 0; offset < source.length; offset += 4) {
    const alpha = source[offset + 3];
    source[offset] = Math.round((source[offset] * alpha) / 255);
    source[offset + 1] = Math.round((source[offset + 1] * alpha) / 255);
    source[offset + 2] = Math.round((source[offset + 2] * alpha) / 255);
    source[offset + 3] = 255;
  }
}

/** Aspect-preserving nearest-neighbour resize with dominant-color padding. */
export function containResizeRgba(
  source: Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  destinationWidth: number,
  destinationHeight: number,
): Uint8ClampedArray {
  const rect = calculateContainRect(sourceWidth, sourceHeight, destinationWidth, destinationHeight);
  const destination = new Uint8ClampedArray(destinationWidth * destinationHeight * 4);
  const sourceContainsTransparency = containsTransparency(source, sourceWidth, sourceHeight);

  for (let y = 0; y < destinationHeight; y++) {
    const sourceY = Math.floor((y + 0.5 - rect.y) / rect.scale);
    if (sourceY < 0 || sourceY >= sourceHeight) continue;

    for (let x = 0; x < destinationWidth; x++) {
      const sourceX = Math.floor((x + 0.5 - rect.x) / rect.scale);
      if (sourceX < 0 || sourceX >= sourceWidth) continue;

      const sourceOffset = (sourceY * sourceWidth + sourceX) * 4;
      const destinationOffset = (y * destinationWidth + x) * 4;
      destination[destinationOffset] = source[sourceOffset];
      destination[destinationOffset + 1] = source[sourceOffset + 1];
      destination[destinationOffset + 2] = source[sourceOffset + 2];
      destination[destinationOffset + 3] = source[sourceOffset + 3];
    }
  }

  if (sourceContainsTransparency) {
    flattenTransparencyOntoBlack(destination);
  } else {
    const dominantColor = findDominantColor(destination, destinationWidth, destinationHeight, rect);
    fillContainPadding(destination, destinationWidth, destinationHeight, rect, dominantColor);
  }
  return destination;
}
