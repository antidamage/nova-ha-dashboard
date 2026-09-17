// RainViewer's dBZ-to-colour ramp, and the reverse lookup (packed rgba ->
// normalised intensity) used to recolour a tile with a custom palette. Single
// cohesive data table (specs/agent-token-footprint.md §2 criterion 1) — the
// table and its derived lookups stay together rather than being split apart.

import { clamp } from "./tile-model";

export const RADAR_COLOR_TABLE = [
  { dbz: -10, rgba: "#63615914" },
  { dbz: -9, rgba: "#66635a19" },
  { dbz: -8, rgba: "#69665c1e" },
  { dbz: -7, rgba: "#6c685d24" },
  { dbz: -6, rgba: "#6f6b5f29" },
  { dbz: -5, rgba: "#726e612e" },
  { dbz: -4, rgba: "#75706234" },
  { dbz: -3, rgba: "#78736439" },
  { dbz: -2, rgba: "#7c75653e" },
  { dbz: -1, rgba: "#7f786744" },
  { dbz: 0, rgba: "#827b6949" },
  { dbz: 1, rgba: "#857d6a4e" },
  { dbz: 2, rgba: "#88806c54" },
  { dbz: 3, rgba: "#8b826d59" },
  { dbz: 4, rgba: "#8e856f5e" },
  { dbz: 5, rgba: "#92887164" },
  { dbz: 6, rgba: "#9e93756e" },
  { dbz: 7, rgba: "#aa9e7978" },
  { dbz: 8, rgba: "#b6a97e82" },
  { dbz: 9, rgba: "#c2b4828c" },
  { dbz: 10, rgba: "#cec08796" },
  { dbz: 11, rgba: "#d2c48ba0" },
  { dbz: 12, rgba: "#d6c88faa" },
  { dbz: 13, rgba: "#dacc93b4" },
  { dbz: 14, rgba: "#ded097be" },
  { dbz: 15, rgba: "#88ddeeff" },
  { dbz: 16, rgba: "#6cd1ebff" },
  { dbz: 17, rgba: "#51c5e8ff" },
  { dbz: 18, rgba: "#36bae5ff" },
  { dbz: 19, rgba: "#1baee2ff" },
  { dbz: 20, rgba: "#00a3e0ff" },
  { dbz: 21, rgba: "#009ad5ff" },
  { dbz: 22, rgba: "#0091caff" },
  { dbz: 23, rgba: "#0088bfff" },
  { dbz: 24, rgba: "#007fb4ff" },
  { dbz: 25, rgba: "#0077aaff" },
  { dbz: 26, rgba: "#0070a3ff" },
  { dbz: 27, rgba: "#00699cff" },
  { dbz: 28, rgba: "#006295ff" },
  { dbz: 29, rgba: "#005b8eff" },
  { dbz: 30, rgba: "#005588ff" },
  { dbz: 31, rgba: "#005180ff" },
  { dbz: 32, rgba: "#004e78ff" },
  { dbz: 33, rgba: "#004a70ff" },
  { dbz: 34, rgba: "#004768ff" },
  { dbz: 35, rgba: "#ffee00ff" },
  { dbz: 36, rgba: "#ffe000ff" },
  { dbz: 37, rgba: "#ffd200ff" },
  { dbz: 38, rgba: "#ffc500ff" },
  { dbz: 39, rgba: "#ffb700ff" },
  { dbz: 40, rgba: "#ffaa00ff" },
  { dbz: 41, rgba: "#ff9f00ff" },
  { dbz: 42, rgba: "#ff9500ff" },
  { dbz: 43, rgba: "#ff8b00ff" },
  { dbz: 44, rgba: "#ff8100ff" },
  { dbz: 45, rgba: "#ff4400ff" },
  { dbz: 46, rgba: "#f23600ff" },
  { dbz: 47, rgba: "#e62800ff" },
  { dbz: 48, rgba: "#d91b00ff" },
  { dbz: 49, rgba: "#cd0d00ff" },
  { dbz: 50, rgba: "#c10000ff" },
  { dbz: 51, rgba: "#a80000ff" },
  { dbz: 52, rgba: "#8f0000ff" },
  { dbz: 53, rgba: "#760000ff" },
  { dbz: 54, rgba: "#5d0000ff" },
  { dbz: 55, rgba: "#ffaaffff" },
  { dbz: 56, rgba: "#ff9fffff" },
  { dbz: 57, rgba: "#ff95ffff" },
  { dbz: 58, rgba: "#ff8bffff" },
  { dbz: 59, rgba: "#ff81ffff" },
  { dbz: 60, rgba: "#ff77ffff" },
  { dbz: 61, rgba: "#ff6cffff" },
  { dbz: 62, rgba: "#ff62ffff" },
  { dbz: 63, rgba: "#ff58ffff" },
  { dbz: 64, rgba: "#ff4effff" },
  { dbz: 65, rgba: "#ffffffff" },
  { dbz: 75, rgba: "#00ff00ff" },
] as const;

function hexToChannels(value: string) {
  const hex = value.replace("#", "");
  return {
    a: Number.parseInt(hex.slice(6, 8), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    r: Number.parseInt(hex.slice(0, 2), 16),
  };
}

function packRgba(r: number, g: number, b: number, a: number) {
  return (((r << 24) | (g << 16) | (b << 8) | a) >>> 0);
}

function normalizeRadarIntensity(dbz: number) {
  return clamp((Math.min(dbz, 65) + 10) / 75, 0, 1);
}

const radarPaletteStops = RADAR_COLOR_TABLE.map(({ dbz, rgba }) => {
  const channels = hexToChannels(rgba);
  return {
    ...channels,
    intensity: normalizeRadarIntensity(dbz),
    packed: packRgba(channels.r, channels.g, channels.b, channels.a),
  };
});

const radarIntensityByPackedRgba = new Map(radarPaletteStops.map((stop) => [stop.packed, stop.intensity]));

export function radarIntensityForPixel(r: number, g: number, b: number, a: number) {
  if (a === 0) {
    return 0;
  }

  const exact = radarIntensityByPackedRgba.get(packRgba(r, g, b, a));
  if (exact !== undefined) {
    return exact;
  }

  let bestDistance = Number.POSITIVE_INFINITY;
  let bestIntensity = clamp(a / 255, 0, 1);

  for (const stop of radarPaletteStops) {
    const dr = r - stop.r;
    const dg = g - stop.g;
    const db = b - stop.b;
    const da = a - stop.a;
    const distance = dr * dr + dg * dg + db * db + da * da * 0.25;

    if (distance < bestDistance) {
      bestDistance = distance;
      bestIntensity = stop.intensity;
    }
  }

  return bestIntensity;
}
