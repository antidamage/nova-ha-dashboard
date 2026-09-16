/** Shapes for RotaryEncoder and its ring geometry. Types only. */
import type { ReactNode } from "react";

export type RingGeometry = {
  /** Knob diameter. */
  size: number;
  /** Radius of the dial's own footprint (`--re-outer / 2`). */
  dialRadius: number;
  /** The knob disc itself, inside the colour ring and bevel. */
  knobRadius: number;
  /** Label font size: the channel caption's rule. */
  font: number;
  pitch: number;
  track: number;
  gap: number;
  /** Height of the title's band, or 0 when the dial has no title. */
  titleBand: number;
  /** Centreline radius of the title arc; meaningless when `titleBand` is 0. */
  titleRadius: number;
  /** Width and height of the title arc's own SVG. */
  titleFootprint: number;
  /** Centreline radius of each ring, innermost first. */
  radii: number[];
  /** Half the thumb's angular length on each ring, in degrees. */
  thumbHalfAngle: number[];
  /** Width and height of the whole control. */
  footprint: number;
};

export type RingDrag = {
  /** The end the value is held at after the pointer entered the gap. */
  pinned: "min" | "max" | null;
  /** Last value fraction, 0–1. */
  t: number;
};

export type EncoderLed = {
  id: string;
  /** Spoken name for the value the light selects. */
  label: string;
  /** A light the tap cycle steps over (an unsupported mode, say). */
  skip?: boolean;
};

export type EncoderRange = {
  min: number;
  max: number;
  step?: number;
  /** No ends: the value wraps and the knob turns forever (hue). */
  wrap?: boolean;
};

export type RotaryEncoderRingKind = "slider" | "selector" | "toggle";

export type RotaryEncoderRing = {
  id: string;
  label: string;
  kind?: RotaryEncoderRingKind;
  value: number;
  min?: number;
  max?: number;
  /** Snaps the value; also the keyboard step. Selectors always step by 1. */
  step?: number;
  disabled?: boolean;
  /**
   * Folds the ring away with the tuck-away animation and takes it out of reach
   * — for a ring that does not apply in the dial's current state, rather than
   * one that is merely unusable (`disabled`, which stays visible and dimmed).
   * A hidden ring keeps its place in the stack, so the rings that remain do not
   * shuffle inwards and change radius (specs/temperature-encoder.md).
   */
  hidden?: boolean;
  /**
   * Drawn right-aligned at the ring's end. Omitted rings show their label only.
   * Pass a function to have the reading follow the thumb through a drag: it is
   * called with the ring's live value, so the text keeps up without the caller
   * hearing about — or sending — anything before the release. Give
   * `valueTextWidest` alongside it, or the ring's length will jump as the
   * reading changes.
   */
  valueText?: string | ((value: number) => string);
  /** The widest value this ring can ever show, so its length never jumps. */
  valueTextWidest?: string;
  onValueTap?: (anchor: HTMLElement) => void;
  /** Never shortened and never carries a value: the stops stay symmetric. */
  symmetric?: boolean;
  /** `selector` and `toggle`: the whole track's fill, or null for an empty well. */
  fill?: string | null;
  /** Fires continuously while dragging — the preview boundary. */
  onChange: (value: number) => void;
  /** Fires once per gesture — the persistence boundary. */
  onCommit?: (value: number) => void;
};

export type RotaryEncoderProps = {
  ariaLabel?: string;
  ariaValueText?: string;
  className?: string;
  /** Extra class on the root, for a wrapper's own CSS. */
  variantClassName?: string;
  demoTooltip?: string;
  demoTooltipTitle?: string;
  disabled?: boolean;
  /** Lights across the knob's centre; a tap cycles them. */
  leds: EncoderLed[];
  activeLed?: string;
  defaultLed?: string;
  onActiveLedChange?: (id: string) => void;
  /**
   * The dial's name, curved around the outside of the knob along the top
   * (specs/color-encoder.md, "The title arcs over the knob"). It claims a band
   * between the knob and the innermost slider ring, and names the dial.
   */
  title?: string;
  /** Extra classes for the title arc's text. */
  titleClassName?: string;
  /**
   * Text printed on the knob face above the lights, cut with "..." to fit. A
   * readout, not a name — the temperature knob's target degrees. The name goes
   * on `title`.
   */
  faceTop?: string;
  /** Text on the knob below the lights. */
  faceBottom?: string;
  /** Extra classes for those two slots. */
  faceTopClassName?: string;
  faceBottomClassName?: string;
  /** The value's colour: the ring's default paint, its fill and its glow. */
  color?: string;
  /** Paints the colour ring with something richer than `color` (a gradient). */
  ringPaint?: string;
  /** Draws the alpha checkerboard under the ring paint. */
  checker?: boolean;
  /** The ring's glow, as a box-shadow. */
  glow?: string;
  /**
   * Light/dark treatment for the knob. Omitted, the base follows the device
   * theme's knob-skin setting (published on `<html data-knob-skin>` by
   * applyDeviceTheme), which is what every knob should do; pass it only to pin
   * a dial to one skin regardless of the setting, as the config preview does.
   */
  knobSkin?: "auto" | "dark" | "light";
  /**
   * Names every light underneath it, silkscreen fashion, etched like the
   * caption. For a dial whose lights are a set of modes you pick between, where
   * the colour knob's single caption — which only ever names the lit one — is
   * not enough (Adeline, 2026-09-12).
   */
  ledLabels?: boolean;
  /** Up to five slider rings, innermost first. */
  rings?: RotaryEncoderRing[];
  /** Units of value per degree turned. Defaults to the range over its sweep. */
  sensitivity?: number;
  /** Knob diameter in px, clamped to `minSize`–200. */
  size?: number;
  minSize?: number;
  value: number;
  range: EncoderRange;
  onChange: (value: number) => void;
  onCommit?: (value: number) => void;
  /** Whether a pointer is down on the knob: a wrapper holding its own value
   *  needs this to know when a drag owns it. */
  onPressedChange?: (pressed: boolean) => void;
  /** Locks the dial after this long without input, and floats its rings. */
  tuckAfterMs?: number;
  onLockChange?: (locked: boolean) => void;
  /** Extra nodes inside the dial, above the knob face (a wrapper's own layers). */
  children?: ReactNode;
};

export type RingPress = {
  index: number;
  drag: RingDrag;
  /** Value before the press, so release can tell whether anything changed. */
  start: number;
  at: number;
  x: number;
  y: number;
  travel: number;
};
