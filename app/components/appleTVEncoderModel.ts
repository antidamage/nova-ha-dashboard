/**
 * The amp dial's colour and level maths: the blue-green ring, its glow and the
 * reading it shows.
 *
 * The dial is the placeholder for the IR emitter that will drive the amplifier
 * (alex, 2026-09-22); nothing here talks to a device. The playlist presets
 * it opens live in `lib/apple-tv/playlists.ts`.
 */

/** The dial's name: it sits on the title arc and names the control. */
export const APPLE_TV_TITLE = "Apple TV";

export const VOLUME_MIN = 0;
export const VOLUME_MAX = 100;
export const VOLUME_STEP = 1;

/** The widest reading the ring can show, so its length never changes. */
export const VOLUME_WIDEST = `${VOLUME_MAX}%`;

/**
 * The ring takes the status orb's colour ring colour, `--cyber-line` (alex,
 * 2026-11-05; it was a fixed blue-green before). It follows the theme, so there
 * is no ramp here: the ring is that one colour at every level.
 */
export const VOLUME_RING_COLOUR = "var(--cyber-line)";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/** The volume as the dial and the presets use it: a whole 0–100 percent. */
export function clampVolume(value: number) {
  if (!Number.isFinite(value)) return VOLUME_MIN;
  return clamp(Math.round(value), VOLUME_MIN, VOLUME_MAX);
}

/** The dial's face reading: `42%`. */
export function volumeLevelText(volume: number) {
  return `${clampVolume(volume)}%`;
}

/** The single colour the dial's ring, fill, index and glow are keyed to. */
export function volumeColour() {
  return VOLUME_RING_COLOUR;
}

/**
 * The ring's glow: the colour dial's full-glow figures, scaled by the level and
 * gone entirely while muted — a muted amplifier is not lighting anything up.
 *
 * The channels are the theme's `--cyber-line-rgb`, so the glow matches the ring.
 */
export function volumeGlow(volume: number, size: number, muted: boolean) {
  const level = clamp(clampVolume(volume) / VOLUME_MAX, 0, 1);
  if (muted || level <= 0) return "0 0 0 rgba(0, 0, 0, 0)";
  return `0 0 ${(size * 0.12 * level).toFixed(1)}px ${(size * 0.012 * level).toFixed(1)}px rgb(var(--cyber-line-rgb) / ${(0.62 * level).toFixed(3)})`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((part) => part + part).join("") : value;
  return [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16)) as [number, number, number];
}
