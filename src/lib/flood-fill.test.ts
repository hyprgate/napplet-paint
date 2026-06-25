import { describe, expect, it } from 'vitest';
import { floodFill, hexToRgba, type Rgba } from './flood-fill.js';

/** Build a solid `width`x`height` RGBA buffer filled with one color. */
function solid(width: number, height: number, color: Rgba): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = color[0];
    data[i * 4 + 1] = color[1];
    data[i * 4 + 2] = color[2];
    data[i * 4 + 3] = color[3];
  }
  return data;
}

function pixel(data: Uint8ClampedArray, width: number, x: number, y: number): Rgba {
  const o = (y * width + x) * 4;
  return [data[o]!, data[o + 1]!, data[o + 2]!, data[o + 3]!];
}

const WHITE: Rgba = [255, 255, 255, 255];
const RED: Rgba = [255, 0, 0, 255];
const BLACK: Rgba = [0, 0, 0, 255];

describe('floodFill', () => {
  it('fills an entire uniform canvas', () => {
    const data = solid(3, 3, WHITE);
    const changed = floodFill(data, 3, 3, 1, 1, RED);
    expect(changed).toBe(true);
    for (let i = 0; i < 9; i++) {
      expect(pixel(data, 3, i % 3, Math.floor(i / 3))).toEqual(RED);
    }
  });

  it('stops at a barrier and does not cross it', () => {
    // 5x1 row: white | white | black | white | white
    const data = solid(5, 1, WHITE);
    const barrier = (2 * 4);
    data[barrier] = 0; data[barrier + 1] = 0; data[barrier + 2] = 0; data[barrier + 3] = 255;

    floodFill(data, 5, 1, 0, 0, RED);

    expect(pixel(data, 5, 0, 0)).toEqual(RED);
    expect(pixel(data, 5, 1, 0)).toEqual(RED);
    expect(pixel(data, 5, 2, 0)).toEqual(BLACK); // barrier untouched
    expect(pixel(data, 5, 3, 0)).toEqual(WHITE); // other side untouched
    expect(pixel(data, 5, 4, 0)).toEqual(WHITE);
  });

  it('returns false when filling with the existing color (no infinite loop)', () => {
    const data = solid(2, 2, RED);
    expect(floodFill(data, 2, 2, 0, 0, RED)).toBe(false);
  });

  it('returns false for an out-of-bounds start point', () => {
    const data = solid(2, 2, WHITE);
    expect(floodFill(data, 2, 2, 5, 5, RED)).toBe(false);
    expect(floodFill(data, 2, 2, -1, 0, RED)).toBe(false);
  });

  it('respects tolerance when matching near-equal colors', () => {
    const data = solid(2, 1, [250, 250, 250, 255]);
    // exact match fails against pure white target sampled from pixel; fill anyway
    const changed = floodFill(data, 2, 1, 0, 0, RED, 10);
    expect(changed).toBe(true);
    expect(pixel(data, 2, 0, 0)).toEqual(RED);
    expect(pixel(data, 2, 1, 0)).toEqual(RED);
  });

  it('fills a bounded region without leaking through diagonals', () => {
    // 3x3 with a diagonal of black; 4-connected fill must not jump the diagonal.
    const data = solid(3, 3, WHITE);
    for (const [x, y] of [[2, 0], [1, 1], [0, 2]] as const) {
      const o = (y * 3 + x) * 4;
      data[o] = 0; data[o + 1] = 0; data[o + 2] = 0; data[o + 3] = 255;
    }
    floodFill(data, 3, 3, 0, 0, RED); // top-left triangle

    expect(pixel(data, 3, 0, 0)).toEqual(RED);
    expect(pixel(data, 3, 1, 0)).toEqual(RED);
    expect(pixel(data, 3, 0, 1)).toEqual(RED);
    // bottom-right triangle must stay white
    expect(pixel(data, 3, 2, 2)).toEqual(WHITE);
    expect(pixel(data, 3, 2, 1)).toEqual(WHITE);
  });
});

describe('hexToRgba', () => {
  it('parses opaque hex colors', () => {
    expect(hexToRgba('#ff0000')).toEqual([255, 0, 0, 255]);
    expect(hexToRgba('00ff00')).toEqual([0, 255, 0, 255]);
    expect(hexToRgba('#000000')).toEqual([0, 0, 0, 255]);
  });
});
