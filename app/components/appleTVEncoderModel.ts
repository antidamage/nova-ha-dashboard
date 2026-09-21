/**
 * The amp dial's colour and level maths: the blue-green ring, its glow and the
 * reading it shows.
 *
 * The dial is the placeholder for the IR emitter that will drive the amplifier
 * (Adeline, 2026-09-22); nothing here talks to a device. The playlist presets
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
 * Blue-green (Adeline, 2026-09-22), one family of three so the ring can carry
 * the usual subtle gradient rather than a flat colour: a deep teal at the dark
 * end, the blue-green in the middle and a pale mint at the top.
 */
export const VOLUME_RING_DEEP = "#0e7f7a";
export const VOLUME_RING_MID = "#1fc9a6";
export const VOLUME_RING_PALE = "#6ef0cf";

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

/**
 * The ring's paint. A conic gradient runs clockwise from 12 o'clock, the dial's
 * own convention; it carries the same three blue-greens at every level, with
 * the pale stop's angle opening up as the volume rises — the usual subtle
 * gradient shift, and a quiet read of the level under the knob.
 */
export function volumeRingPaint(volume: number, _size: number) {
  const level = clamp(clampVolume(volume) / VOLUME_MAX, 0, 1);
  // The gradient never collapses onto one colour: even at zero the shift is a
  // quarter turn.
  const shift = 90 + 180 * level;
  return [
    "conic-gradient(from 0deg",
    `${VOLUME_RING_DEEP} 0deg`,
    `${VOLUME_RING_MID} ${shift.toFixed(2)}deg`,
    `${VOLUME_RING_PALE} 360deg)`,
  ].join(", ");
}

/** The single colour the dial's fill, index and glow are keyed to. */
export function volumeColour(volume: number) {
  const level = clamp(clampVolume(volume) / VOLUME_MAX, 0, 1);
  if (level <= 0.5) return mixHex(VOLUME_RING_DEEP, VOLUME_RING_MID, level * 2);
  return mixHex(VOLUME_RING_MID, VOLUME_RING_PALE, (level - 0.5) * 2);
}

/**
 * The ring's glow: the colour dial's full-glow figures, scaled by the level and
 * gone entirely while muted — a muted amplifier is not lighting anything up.
 */
export function volumeGlow(volume: number, size: number, muted: boolean) {
  const level = clamp(clampVolume(volume) / VOLUME_MAX, 0, 1);
  if (muted || level <= 0) return "0 0 0 rgba(0, 0, 0, 0)";
  const rgb = hexToRgb(volumeColour(volume)).join(", ");
  return `0 0 ${(size * 0.12 * level).toFixed(1)}px ${(size * 0.012 * level).toFixed(1)}px rgba(${rgb}, ${(0.62 * level).toFixed(3)})`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((part) => part + part).join("") : value;
  return [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16)) as [number, number, number];
}

/** `rgb(...)`, the form `--re-color` is read back as. */
export function mixHex(from: string, to: string, t: number) {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const channel = (index: number) => Math.round(a[index] + (b[index] - a[index]) * clamp(t, 0, 1));
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}
