import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  clampForContrast,
  extractHighlightColor,
  highlightColorForAsset,
  highlightFromPixels,
  hslToRgb,
  rgbToHex,
  rgbToHsl,
} from "./wallpaper-color";

/** A PNG of `width x height` filled from a per-pixel callback. */
async function png(width: number, height: number, pixel: (x: number, y: number) => [number, number, number]) {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(x, y);
      const offset = (y * width + x) * 3;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
    }
  }
  return sharp(raw, { raw: { channels: 3, height, width } }).png().toBuffer();
}

function rawPixels(colors: Array<[number, number, number]>) {
  const buffer = Buffer.alloc(colors.length * 3);
  colors.forEach(([r, g, b], index) => {
    buffer[index * 3] = r;
    buffer[index * 3 + 1] = g;
    buffer[index * 3 + 2] = b;
  });
  return buffer;
}

describe("colour space helpers", () => {
  it("round-trips primaries through HSL", () => {
    for (const [r, g, b] of [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [18, 52, 86],
      [200, 130, 40],
    ] as const) {
      const { h, l, s } = rgbToHsl(r, g, b);
      expect(hslToRgb(h, s, l)).toEqual({ b, g, r });
    }
  });

  it("formats hex as uppercase six digits", () => {
    expect(rgbToHex({ b: 4, g: 2, r: 0 })).toBe("#000204");
    expect(rgbToHex({ b: 255, g: 171, r: 255 })).toBe("#FFABFF");
  });
});

describe("highlightFromPixels", () => {
  it("finds a solid colour", () => {
    const result = highlightFromPixels(rawPixels(Array(64).fill([200, 60, 60])), 3);
    expect(result.fallback).toBe(false);
    expect(result.hex).toBe("#C83C3C");
  });

  it("prefers a vivid minority over a dull majority", () => {
    // 90% muddy olive, 10% vivid magenta. "Most common" would pick the olive.
    const pixels: Array<[number, number, number]> = [
      ...Array(90).fill([104, 100, 70] as [number, number, number]),
      ...Array(10).fill([230, 20, 200] as [number, number, number]),
    ];
    const result = highlightFromPixels(rawPixels(pixels), 3);
    const { h } = result.hsl;
    // Magenta sits near 310 degrees; olive near 55.
    expect(h).toBeGreaterThan(280);
    expect(h).toBeLessThan(340);
  });

  it("does not let a single vivid speck beat a large saturated region", () => {
    const pixels: Array<[number, number, number]> = [
      ...Array(200).fill([40, 120, 220] as [number, number, number]), // blue
      [255, 0, 0], // one red pixel
    ];
    const { hsl } = highlightFromPixels(rawPixels(pixels), 3);
    expect(hsl.h).toBeGreaterThan(190);
    expect(hsl.h).toBeLessThan(240);
  });

  it("averages hue circularly so reds straddling 0 do not become cyan", () => {
    // Hues at 358 and 2 degrees. An arithmetic mean would give 180 (cyan).
    const pixels: Array<[number, number, number]> = [
      ...Array(50).fill([204, 51, 61] as [number, number, number]),
      ...Array(50).fill([204, 61, 51] as [number, number, number]),
    ];
    const { hsl } = highlightFromPixels(rawPixels(pixels), 3);
    expect(hsl.h > 350 || hsl.h < 10).toBe(true);
  });

  it("falls back to achromatic grey when nothing survives the gates", () => {
    const pixels: Array<[number, number, number]> = Array(64).fill([128, 128, 128]);
    const result = highlightFromPixels(rawPixels(pixels), 3);
    expect(result.fallback).toBe(true);
    expect(result.hsl.s).toBe(0);
    expect(result.hsl.l).toBeCloseTo(128 / 255, 2);
  });

  it("ignores near-black and near-white pixels", () => {
    // A saturated but near-black navy plus mostly white: nothing should pass.
    const pixels: Array<[number, number, number]> = [
      ...Array(20).fill([0, 0, 20] as [number, number, number]),
      ...Array(80).fill([252, 252, 254] as [number, number, number]),
    ];
    expect(highlightFromPixels(rawPixels(pixels), 3).fallback).toBe(true);
  });

  it("handles an empty buffer without dividing by zero", () => {
    const result = highlightFromPixels(Buffer.alloc(0), 3);
    expect(result.fallback).toBe(true);
    expect(Number.isFinite(result.hsl.l)).toBe(true);
  });
});

describe("clampForContrast", () => {
  it("lifts a colour that is too dark, keeping hue and saturation", () => {
    const dark = highlightFromPixels(rawPixels(Array(16).fill([10, 40, 70])), 3);
    const clamped = clampForContrast(dark);
    expect(clamped.hsl.l).toBeCloseTo(0.3, 5);
    expect(clamped.hsl.h).toBeCloseTo(dark.hsl.h, 5);
    expect(clamped.hsl.s).toBeCloseTo(dark.hsl.s, 5);
  });

  it("pulls a colour that is too light back down", () => {
    const light = highlightFromPixels(rawPixels(Array(16).fill([230, 210, 245])), 3);
    expect(clampForContrast(light).hsl.l).toBeCloseTo(0.7, 5);
  });

  it("returns the same object when the colour is already legible", () => {
    const mid = highlightFromPixels(rawPixels(Array(16).fill([120, 80, 160])), 3);
    expect(clampForContrast(mid)).toBe(mid);
  });
});

describe("extractHighlightColor", () => {
  it("reads a solid PNG", async () => {
    const result = await extractHighlightColor(await png(32, 32, () => [30, 140, 90]));
    expect(result.fallback).toBe(false);
    // The downscale resamples, so allow a little drift rather than an exact hex.
    expect(result.rgb.g).toBeGreaterThan(result.rgb.r);
    expect(result.rgb.g).toBeGreaterThan(result.rgb.b);
  });

  it("picks the accent stripe out of a grey field", async () => {
    const image = await png(64, 64, (x) => (x < 6 ? [255, 120, 0] : [110, 110, 112]));
    const { fallback, hsl } = await extractHighlightColor(image);
    expect(fallback).toBe(false);
    expect(hsl.h).toBeGreaterThan(15);
    expect(hsl.h).toBeLessThan(45);
  });

  it("reports fallback for a greyscale gradient", async () => {
    const image = await png(64, 64, (x) => {
      const v = 40 + Math.round((x / 63) * 170);
      return [v, v, v];
    });
    expect((await extractHighlightColor(image)).fallback).toBe(true);
  });

  it("copes with an image that has an alpha channel", async () => {
    const raw = Buffer.alloc(16 * 16 * 4);
    for (let i = 0; i < 16 * 16; i += 1) {
      raw.set([200, 40, 160, 255], i * 4);
    }
    const image = await sharp(raw, { raw: { channels: 4, height: 16, width: 16 } }).png().toBuffer();
    const result = await extractHighlightColor(image);
    expect(result.fallback).toBe(false);
    expect(result.rgb.r).toBeGreaterThan(result.rgb.g);
  });
});

describe("highlightColorForAsset", () => {
  it("caches on id and updatedAt, and re-extracts when updatedAt moves", async () => {
    const red = await png(16, 16, () => [220, 30, 30]);
    const blue = await png(16, 16, () => [30, 30, 220]);
    const asset = { id: "wallpaper_cache_test", updatedAt: "2026-08-25T00:00:00.000Z" };

    const first = await highlightColorForAsset(asset, red);
    // Same key, different bytes: the cached answer must win.
    const second = await highlightColorForAsset(asset, blue);
    expect(second).toBe(first);

    const third = await highlightColorForAsset({ ...asset, updatedAt: "2026-08-25T01:00:00.000Z" }, blue);
    expect(third.rgb.b).toBeGreaterThan(third.rgb.r);
  });
});
