// Harness for the glide suites. Deliberately not a `*.test.*` file: vitest
// collects those by glob, and a helper must not be collected as a suite.
//
// Every helper here reads the ring's **drawn** position back out of the DOM —
// the thumb's own SVG path, or the well's arc — so a suite built on it measures
// what the eye sees rather than what the ring was handed
// (specs/color-encoder.md, "A step glides, it never snaps").
import { act, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, vi } from "vitest";
import { type RotaryEncoderRing } from "../../RotaryEncoder";
import { ARC_END, ARC_START, fractionAt, ringGeometry } from "../../rotaryEncoderGeometry";
import { RING_GLIDE_DEG_PER_SEC } from "./constants";
import { Dial, at } from "./RotaryEncoder.fixtures";

/** The dial a suite renders is a plain 200px one: one ring, no title. */
export const geometry = ringGeometry(200, 1);
export const radius = geometry.radii[0];
export const half = geometry.thumbHalfAngle[0];
export const sweep = ARC_END - ARC_START;
/** Where a stop sits, as the angle to press at: 0 is the start, 1 the end. */
export const angleOf = (fraction: number) => ARC_START + half + fraction * (ARC_END - ARC_START - 2 * half);

/** Fractions a four-stop selector sits at: 1/3 is the second stop, 2/3 the third. */
export const DRY = 1 / 3;
export const FAN = 2 / 3;
/** How far the thumb gets in one 60Hz frame, as a fraction of the arc. */
export const FRAME_TRAVEL = (RING_GLIDE_DEG_PER_SEC / sweep) * 0.016;

/** The glide's clock, a frame per 16ms; the first frame only starts it. */
export function useGlideClock() {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });
}

export function ringsSvg(container: HTMLElement) {
  const svg = container.querySelector("svg.rotary-encoder-rings");
  if (!svg) throw new Error("no rings drawn");
  return svg;
}

/** Runs the glide's clock: a frame per 16ms, the first of which only starts it. */
export function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** The dial's centre in SVG units, and its ring geometry, read from the markup. */
export function dialGeometry(container: HTMLElement) {
  const svg = ringsSvg(container);
  const viewBox = (svg.getAttribute("viewBox") ?? "").split(/\s+/).map(Number);
  const count = svg.querySelectorAll("[data-ring-index]").length;
  return { centre: (viewBox[2] || geometry.footprint) / 2, rings: ringGeometry(200, count) };
}

/** The drawn fraction of a ring, from the middle of its thumb's own little arc. */
export function drawnFractionAt(container: HTMLElement, index = 0, end: number = ARC_END) {
  const { centre, rings } = dialGeometry(container);
  const path = ringsSvg(container).querySelector(`[data-ring-index="${index}"] .rotary-encoder-thumb-body`);
  const numbers = (path?.getAttribute("d") ?? "").match(/-?[\d.]+/g)?.map(Number);
  if (!numbers || numbers.length < 9) throw new Error(`no thumb arc on ring ${index}`);
  const angleOfPoint = (x: number, y: number) => (Math.atan2(x - centre, -(y - centre)) * 180) / Math.PI;
  const middle = (angleOfPoint(numbers[0], numbers[1]) + angleOfPoint(numbers[7], numbers[8])) / 2;
  return fractionAt(middle, rings.thumbHalfAngle[index], end);
}

/** The fraction the thumb of ring 0 is actually drawn at. */
export function drawnFraction(container: HTMLElement) {
  return drawnFractionAt(container, 0);
}

/**
 * The arc the ring actually drew, in degrees — the well path runs ARC_START to
 * the fitted end, so a ring shortened to fit its label reports less than 270.
 */
export function sweepOf(container: HTMLElement) {
  const { centre } = dialGeometry(container);
  const well = ringsSvg(container).querySelector(".rotary-encoder-well");
  const numbers = (well?.getAttribute("d") ?? "").match(/-?[\d.]+/g)?.map(Number);
  if (!numbers || numbers.length < 9) throw new Error(`no well arc: ${well?.getAttribute("d")}`);
  const angleOfPoint = (x: number, y: number) => (Math.atan2(x - centre, -(y - centre)) * 180) / Math.PI;
  return Math.max(angleOfPoint(numbers[0], numbers[1]), angleOfPoint(numbers[7], numbers[8])) - ARC_START;
}

/**
 * jsdom lays nothing out, so the component's text measuring returns 0 and no
 * ring is ever shortened. Stubbing the width makes a long label pull its ring's
 * end back, which is the case `ringSweep` exists for. jsdom implements no
 * SVGTextElement, so the stub goes on the base class the probe actually is.
 */
export function stubTextWidth(pxPerCharacter: number) {
  const proto = (window.SVGTextElement ?? window.SVGElement)?.prototype as unknown as Record<string, unknown> | undefined;
  if (!proto) throw new Error("no SVG element class in this environment");
  proto.getComputedTextLength = function measured(this: SVGElement) {
    return (this.textContent ?? "").length * pxPerCharacter;
  };
  return () => {
    delete proto.getComputedTextLength;
  };
}

/** Presses at the start of the arc and drags to `fraction` in one sample. */
export function dragTo(container: HTMLElement, fraction: number) {
  const svg = ringsSvg(container);
  fireEvent.pointerDown(svg, { buttons: 1, pointerId: 1, ...at(radius, angleOf(0)) });
  if (fraction !== 0) fireEvent.pointerMove(svg, { buttons: 1, pointerId: 1, ...at(radius, angleOf(fraction)) });
  return svg;
}

/** A controlled stepping ring that echoes what it is given, as the knobs do. */
export function SteppedDial({ onChange, kind, step, min = 0, max = 3, glide }: {
  onChange: (value: number) => void;
  kind?: "selector";
  step?: number;
  min?: number;
  max?: number;
  glide?: boolean;
}) {
  const [value, setValue] = useState(min);
  const ring: RotaryEncoderRing = {
    id: "mode",
    label: "Mode",
    kind,
    value,
    min,
    max,
    step,
    glide,
    valueText: (live) => `${Math.round(live)}`,
    valueTextWidest: `${max}`,
    onChange: (next) => {
      onChange(next);
      setValue(next);
    },
  };
  return <Dial rings={[ring]} />;
}

/** One dial carrying two stepping rings: the Mode and Fan shape. */
export function TwoRingDial({ onChange }: { onChange: () => void }) {
  const [mode, setMode] = useState(0);
  const [fan, setFan] = useState(0);
  const rings: RotaryEncoderRing[] = [
    {
      id: "mode", label: "Mode", kind: "selector", value: mode, min: 0, max: 3, step: 1,
      onChange: (next) => { onChange(); setMode(next); },
    },
    {
      id: "fan", label: "Fan", value: fan, min: 0, max: 6, step: 1,
      onChange: (next) => { onChange(); setFan(next); },
    },
  ];
  return <Dial rings={rings} />;
}
