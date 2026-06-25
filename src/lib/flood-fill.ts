/**
 * Scanline flood fill over raw RGBA pixel data — the paint "fill bucket" tool.
 *
 * Operates in place on the `Uint8ClampedArray` backing a canvas `ImageData`.
 * Kept free of DOM/canvas dependencies so it is unit-testable.
 */

export type Rgba = [number, number, number, number];

function sampleColor(data: Uint8ClampedArray, offset: number): Rgba {
  return [data[offset]!, data[offset + 1]!, data[offset + 2]!, data[offset + 3]!];
}

function withinTolerance(a: Rgba, b: Rgba, tolerance: number): boolean {
  return (
    Math.abs(a[0] - b[0]) <= tolerance &&
    Math.abs(a[1] - b[1]) <= tolerance &&
    Math.abs(a[2] - b[2]) <= tolerance &&
    Math.abs(a[3] - b[3]) <= tolerance
  );
}

/**
 * Fill the contiguous region of matching color starting at (startX, startY)
 * with `fill`. Returns true if any pixel changed.
 */
export function floodFill(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  fill: Rgba,
  tolerance = 0,
): boolean {
  const x = Math.floor(startX);
  const y = Math.floor(startY);
  if (x < 0 || y < 0 || x >= width || y >= height) return false;

  const startOffset = (y * width + x) * 4;
  const target = sampleColor(data, startOffset);

  // Filling a region with its own color would loop forever and change nothing.
  if (withinTolerance(target, fill, 0)) return false;

  let changed = false;
  const stack: Array<[number, number]> = [[x, y]];

  while (stack.length > 0) {
    const [px, py] = stack.pop()!;

    // Walk left to the start of the matching span on this row.
    let left = px;
    while (left >= 0 && withinTolerance(sampleColor(data, (py * width + left) * 4), target, tolerance)) {
      left--;
    }
    left++;

    let spanAbove = false;
    let spanBelow = false;
    for (let sx = left; sx < width; sx++) {
      const offset = (py * width + sx) * 4;
      if (!withinTolerance(sampleColor(data, offset), target, tolerance)) break;

      data[offset] = fill[0];
      data[offset + 1] = fill[1];
      data[offset + 2] = fill[2];
      data[offset + 3] = fill[3];
      changed = true;

      if (py > 0) {
        const above = withinTolerance(sampleColor(data, ((py - 1) * width + sx) * 4), target, tolerance);
        if (above && !spanAbove) stack.push([sx, py - 1]);
        spanAbove = above;
      }
      if (py < height - 1) {
        const below = withinTolerance(sampleColor(data, ((py + 1) * width + sx) * 4), target, tolerance);
        if (below && !spanBelow) stack.push([sx, py + 1]);
        spanBelow = below;
      }
    }
  }

  return changed;
}

/** Parse a `#rrggbb` hex string into opaque RGBA. */
export function hexToRgba(hex: string): Rgba {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return [
    Number.isNaN(r) ? 0 : r,
    Number.isNaN(g) ? 0 : g,
    Number.isNaN(b) ? 0 : b,
    255,
  ];
}
