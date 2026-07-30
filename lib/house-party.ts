export type HousePartyHueMode = "follow" | "complement";
export type HousePartyBrightnessMode = "follow" | "oppose" | "ignore";

const HA_LIGHT_TRANSITION_FEATURE = 32;
export const HOUSE_PARTY_NATIVE_TRANSITION_SECONDS = 0.4;

export function housePartyNativeTransitionSeconds(
  supportedFeatures: unknown,
  requestedSeconds = HOUSE_PARTY_NATIVE_TRANSITION_SECONDS,
) {
  const features = Number(supportedFeatures);
  const duration = Number(requestedSeconds);
  return Number.isFinite(features) && (features & HA_LIGHT_TRANSITION_FEATURE) !== 0
    && Number.isFinite(duration)
    ? Math.max(0.08, Math.min(2, duration))
    : undefined;
}

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function complementRgb(rgb: [number, number, number]): [number, number, number] {
  const [r, g, b] = rgb.map((value) => clampByte(value) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return [clampByte((1 - r) * 255), clampByte((1 - g) * 255), clampByte((1 - b) * 255)];
  let hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  hue = (hue * 60 + 180 + 360) % 360;
  const saturation = max === 0 ? 0 : delta / max;
  const chroma = max * saturation;
  const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
  const m = max - chroma;
  const [rr, gg, bb] = hue < 60 ? [chroma, x, 0]
    : hue < 120 ? [x, chroma, 0]
      : hue < 180 ? [0, chroma, x]
        : hue < 240 ? [0, x, chroma]
          : hue < 300 ? [x, 0, chroma]
            : [chroma, 0, x];
  return [clampByte((rr + m) * 255), clampByte((gg + m) * 255), clampByte((bb + m) * 255)];
}

export function randomHueOffsetRgb(
  rgb: [number, number, number],
  maximumOffsetDegrees: number,
  random: () => number = Math.random,
): [number, number, number] {
  const range = Math.max(0, Math.min(180, Number(maximumOffsetDegrees) || 0));
  if (range === 0) return rgb.map(clampByte) as [number, number, number];
  const [r, g, b] = rgb.map((value) => clampByte(value) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return rgb.map(clampByte) as [number, number, number];
  let hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  const saturation = max === 0 ? 0 : delta / max;
  const offset = (Math.max(0, Math.min(1, random())) * 2 - 1) * range;
  const rotated = (hue + offset + 360) % 360;
  const chroma = max * saturation;
  const x = chroma * (1 - Math.abs((rotated / 60) % 2 - 1));
  const m = max - chroma;
  const [rr, gg, bb] = rotated < 60 ? [chroma, x, 0]
    : rotated < 120 ? [x, chroma, 0]
      : rotated < 180 ? [0, chroma, x]
        : rotated < 240 ? [0, x, chroma]
          : rotated < 300 ? [x, 0, chroma]
            : [chroma, 0, x];
  return [clampByte((rr + m) * 255), clampByte((gg + m) * 255), clampByte((bb + m) * 255)];
}

export function resolveHousePartyFrame(input: {
  peakRgb: [number, number, number];
  peakBrightnessPct: number;
  cloudPeakBrightnessPct?: number;
  transitionSeconds?: number;
  hueMode: HousePartyHueMode;
  brightnessMode: HousePartyBrightnessMode;
}) {
  const peak = Math.max(5, Math.min(100, Math.round(input.peakBrightnessPct)));
  const cloudPeak = typeof input.cloudPeakBrightnessPct === "number"
    ? Math.max(5, Math.min(100, Math.round(input.cloudPeakBrightnessPct)))
    : undefined;
  const resolveBrightness = (value: number) => input.brightnessMode === "oppose" ? 105 - value : value;
  return {
    rgb: input.hueMode === "complement" ? complementRgb(input.peakRgb) : input.peakRgb.map(clampByte) as [number, number, number],
    ...(typeof input.transitionSeconds === "number" && Number.isFinite(input.transitionSeconds)
      ? { transitionSeconds: Math.max(0.08, Math.min(2, input.transitionSeconds)) }
      : {}),
    brightnessPct: input.brightnessMode === "ignore"
      ? undefined
      : resolveBrightness(peak),
    ...(cloudPeak !== undefined && input.brightnessMode !== "ignore"
      ? { cloudBrightnessPct: resolveBrightness(cloudPeak) }
      : {}),
  };
}
