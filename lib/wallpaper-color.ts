import sharp from "sharp";

/**
 * The dominant *highlight* colour of a wallpaper.
 *
 * Highlight, not "most common": the largest colour cluster in a photograph is
 * usually a sky, a wall, or a vignette, which is a poor accent. The rule here
 * scores hue buckets by `count x meanSaturation`, so a big dull region cannot
 * win on size alone and a three-pixel speck cannot win on vividness alone.
 *
 * See `specs/desktop-theme-app-actions.md` for the rule and its thresholds.
 */
export type HighlightColor = {
  // True when the image had no colour to find - a greyscale or black-and-white
  // wallpaper. The result is then an achromatic grey at the image's mean
  // lightness rather than an error, and a caller that wants to skip acting on
  // one can see that it did.
  fallback: boolean;
  hex: string;
  hsl: { h: number; l: number; s: number };
  rgb: { b: number; g: number; r: number };
};

// The image is downscaled to this edge before analysis. The downscale *is* the
// averaging step - there is no separate blur - and it is what keeps extraction
// cheap enough to run on the sync path.
const WORK_EDGE = 96;

// Exclusion gates. A pixel outside any of these contributes nothing.
const MIN_SATURATION = 0.2;
const MIN_LIGHTNESS = 0.12;
const MAX_LIGHTNESS = 0.88;

const HUE_BUCKETS = 36;

// The legibility band for `clampForContrast`. Outside it a Windows Terminal
// tab is either a black smear or washes out against the title bar.
const CONTRAST_MIN_LIGHTNESS = 0.3;
const CONTRAST_MAX_LIGHTNESS = 0.7;

const CACHE_LIMIT = 16;

type Bucket = {
  // Circular accumulation, so a bucket straddling 0 degrees does not average
  // out to cyan.
  cos: number;
  count: number;
  lightness: number;
  saturation: number;
  sin: number;
};

export function rgbToHsl(r: number, g: number, b: number) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) {
    return { h: 0, l, s: 0 };
  }
  const s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let h: number;
  if (max === rn) {
    h = ((gn - bn) / delta) % 6;
  } else if (max === gn) {
    h = (bn - rn) / delta + 2;
  } else {
    h = (rn - gn) / delta + 4;
  }
  h *= 60;
  if (h < 0) {
    h += 360;
  }
  return { h, l, s };
}

export function hslToRgb(h: number, s: number, l: number) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = l - c / 2;
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (hp < 1) {
    [rp, gp, bp] = [c, x, 0];
  } else if (hp < 2) {
    [rp, gp, bp] = [x, c, 0];
  } else if (hp < 3) {
    [rp, gp, bp] = [0, c, x];
  } else if (hp < 4) {
    [rp, gp, bp] = [0, x, c];
  } else if (hp < 5) {
    [rp, gp, bp] = [x, 0, c];
  } else {
    [rp, gp, bp] = [c, 0, x];
  }
  return {
    b: Math.round((bp + m) * 255),
    g: Math.round((gp + m) * 255),
    r: Math.round((rp + m) * 255),
  };
}

export function rgbToHex(rgb: { b: number; g: number; r: number }) {
  const part = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0").toUpperCase();
  return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`;
}

function fromHsl(h: number, s: number, l: number, fallback: boolean): HighlightColor {
  const rgb = hslToRgb(h, s, l);
  return { fallback, hex: rgbToHex(rgb), hsl: { h, l, s }, rgb };
}

/**
 * Pull a colour's lightness into the legible band, preserving hue and
 * saturation. Hue is never rotated and saturation is never boosted: an
 * accurate muted colour beats an invented vivid one.
 */
export function clampForContrast(color: HighlightColor): HighlightColor {
  const { h, l, s } = color.hsl;
  const clamped = Math.min(CONTRAST_MAX_LIGHTNESS, Math.max(CONTRAST_MIN_LIGHTNESS, l));
  if (clamped === l) {
    return color;
  }
  return fromHsl(h, s, clamped, color.fallback);
}

/**
 * Analyse raw RGB pixels. Split out from `extractHighlightColor` so the rule
 * can be tested without going through an encoder.
 */
export function highlightFromPixels(pixels: Uint8Array | Buffer, channels: number): HighlightColor {
  const buckets: Bucket[] = Array.from({ length: HUE_BUCKETS }, () => ({
    cos: 0,
    count: 0,
    lightness: 0,
    saturation: 0,
    sin: 0,
  }));
  let totalLightness = 0;
  let totalPixels = 0;

  for (let i = 0; i + channels - 1 < pixels.length; i += channels) {
    const { h, l, s } = rgbToHsl(pixels[i], pixels[i + 1], pixels[i + 2]);
    totalLightness += l;
    totalPixels += 1;
    if (s < MIN_SATURATION || l < MIN_LIGHTNESS || l > MAX_LIGHTNESS) {
      continue;
    }
    const bucket = buckets[Math.min(HUE_BUCKETS - 1, Math.floor((h / 360) * HUE_BUCKETS))];
    const radians = (h * Math.PI) / 180;
    bucket.cos += Math.cos(radians);
    bucket.count += 1;
    bucket.lightness += l;
    bucket.saturation += s;
    bucket.sin += Math.sin(radians);
  }

  let winner: Bucket | null = null;
  let best = 0;
  for (const bucket of buckets) {
    if (bucket.count === 0) {
      continue;
    }
    // count x meanSaturation, which the running sum already is. Weighting by
    // count alone picks the dull majority; by saturation alone picks a stray
    // three-pixel speck.
    const score = bucket.count * (bucket.saturation / bucket.count);
    if (score > best) {
      best = score;
      winner = bucket;
    }
  }

  if (!winner) {
    // Greyscale, pure black, or pure white. A grey tab on a grey wallpaper is
    // the right answer, so this is a result rather than an error.
    const meanLightness = totalPixels > 0 ? totalLightness / totalPixels : 0.5;
    return fromHsl(0, 0, meanLightness, true);
  }

  let hue = (Math.atan2(winner.sin / winner.count, winner.cos / winner.count) * 180) / Math.PI;
  if (hue < 0) {
    hue += 360;
  }
  return fromHsl(hue, winner.saturation / winner.count, winner.lightness / winner.count, false);
}

export async function extractHighlightColor(data: Buffer): Promise<HighlightColor> {
  const { data: pixels, info } = await sharp(data)
    .resize(WORK_EDGE, WORK_EDGE, { fit: "inside" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return highlightFromPixels(pixels, info.channels);
}

// Keyed on asset identity. The bound matters: this must never pin decoded
// pixels or several wallpapers' worth of buffers, so only the small result is
// held, and only for the most recent handful of assets.
const cache = new Map<string, HighlightColor>();

export async function highlightColorForAsset(
  asset: { id: string; updatedAt: string },
  data: Buffer,
): Promise<HighlightColor> {
  const key = `${asset.id}:${asset.updatedAt}`;
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }
  const color = await extractHighlightColor(data);
  cache.set(key, color);
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (oldest.done) {
      break;
    }
    cache.delete(oldest.value);
  }
  return color;
}
