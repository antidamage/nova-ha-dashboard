"use client";

import type { TutorialScriptId } from "../steps";
import { angleOf, PART_REST_MS, type Gesture, type Point } from "./gesture-model";

/**
 * Each step's gestures, read off the live DOM of the copy (or, for the fold,
 * the real fold) at the moment each part starts. A part is resolved lazily
 * because a ring only exists once the dial has unlocked and unfolded.
 */

export type ScriptPart = (root: HTMLElement) => Gesture[];
/** A phase caption: shown from here until the next one (specs/tutorial-mode.md). */
export type ScriptSay = { say: string };
export type ScriptEntry = ScriptPart | ScriptSay;
const say = (text: string): ScriptSay => ({ say: text });

const centreOf = (rect: DOMRect): Point => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });

function dial(root: HTMLElement) {
  const element = root.querySelector<HTMLElement>(".rotary-encoder-dial") ?? root;
  const rect = element.getBoundingClientRect();
  return { centre: centreOf(rect), radius: Math.min(rect.width, rect.height) / 2 };
}

const tapDial: ScriptPart = (root) => [{ kind: "tap", at: dial(root).centre }];

/** A turn on the knob's face, `from` → `to` degrees, well clear of its centre. */
const turn = (from: number, to: number): ScriptPart => (root) => {
  const { centre, radius } = dial(root);
  return [{ kind: "arc", centre, radius: radius * 0.62, fromDeg: from, toDeg: to }];
};

const rest = (ms: number): ScriptPart => () => [{ kind: "rest", ms }];

/** The ring layer the copy's dial portalled to the body, or the copy itself. */
function ringHost(root: HTMLElement) {
  return document.querySelector<HTMLElement>(".rotary-encoder-ring-layer[data-portal-tag='tutorial']") ?? root;
}

/** Drags a ring's thumb `sweep` degrees along its ring. */
const ringDrag = (ringId: string, sweep: number): ScriptPart => (root) => {
  const hotspot = ringHost(root).querySelector<SVGPathElement>(`[data-ring-id="${ringId}"] [data-thumb-hotspot]`);
  if (!hotspot) return [];
  const { centre } = dial(root);
  const thumb = centreOf(hotspot.getBoundingClientRect());
  const radius = Math.hypot(thumb.x - centre.x, thumb.y - centre.y);
  const from = angleOf(centre, thumb);
  // Rings run 7:30 → 4:30 over the top (225° → 495°); keep the sweep inside.
  const unwrapped = from < 180 ? from + 360 : from;
  const to = Math.max(228, Math.min(492, unwrapped + sweep));
  return [{ kind: "arc", centre, radius, fromDeg: unwrapped, toDeg: to }];
};

/** A tap on a toggle ring's track: it has no thumb. */
const ringTap = (ringId: string): ScriptPart => (root) => {
  const well = ringHost(root).querySelector<SVGPathElement>(`[data-ring-id="${ringId}"] .rotary-encoder-well`);
  const matrix = well?.getScreenCTM?.();
  if (!well || !matrix || typeof well.getTotalLength !== "function") return [];
  const local = well.getPointAtLength(well.getTotalLength() * 0.5);
  const at = new DOMPoint(local.x, local.y).matrixTransform(matrix);
  return [{ kind: "tap", at: { x: at.x, y: at.y } }];
};


function orb(root: HTMLElement) {
  const host = root.querySelector<HTMLElement>(".tutorial-orb-host") ?? root;
  const rect = host.getBoundingClientRect();
  return { centre: centreOf(rect), radius: Math.min(rect.width, rect.height) / 2 };
}

const tapOrb: ScriptPart = (root) => [{ kind: "tap", at: orb(root).centre }];
export const turnOrb = (from: number, to: number): ScriptPart => (root) => {
  const { centre, radius } = orb(root);
  return [{ kind: "arc", centre, radius: radius * 0.55, fromDeg: from, toDeg: to }];
};

/** Presses the fold leaves to the control under them (advancedFoldBand.ts). */
const FOLD_OWN_DRAG = "button, a[href], input, select, textarea, [role=slider], [role=switch], [role=button], [data-nova-no-drag-scroll]";

/**
 * Where a pull can start: a point on the divider line, inside the viewport and
 * above the tour's bar, that is not on a control (a drag that starts on one
 * belongs to it, not the fold).
 */
function pullStart(fold: HTMLElement, vertical: boolean): Point | null {
  const line = (fold.querySelector<HTMLElement>(".advanced-fold-divider") ?? fold).getBoundingClientRect();
  const bottom = Math.min(line.bottom, window.innerHeight - 96);
  const top = Math.max(line.top, 24);
  const candidates = Array.from({ length: 9 }, (_, index) => {
    const share = (index + 1) / 10;
    return vertical
      ? { x: line.left + line.width * share, y: Math.min(Math.max(line.top + line.height / 2, top), bottom) }
      : { x: line.left + line.width / 2, y: top + (bottom - top) * share };
  });
  return candidates.find((point) => {
    const hit = document.elementsFromPoint?.(point.x, point.y).find((element) => fold.contains(element));
    return hit && !hit.closest(FOLD_OWN_DRAG);
  }) ?? null;
}

/** The fold's pull: from its divider toward Advanced. */
const foldPull: ScriptPart = (fold) => {
  const foldRect = fold.getBoundingClientRect();
  const vertical = fold.dataset.axis !== "x";
  const distance = Math.min(260, (vertical ? foldRect.height : foldRect.width) * 0.6);
  if (fold.dataset.tutorialOffset === undefined) {
    fold.dataset.tutorialOffset = String(vertical ? fold.scrollTop : fold.scrollLeft);
  }
  const begin = pullStart(fold, vertical);
  // Nowhere clear to start: no press at all, rather than one on a real control.
  if (!begin) return [];
  const end = vertical ? { x: begin.x, y: begin.y - distance } : { x: begin.x - distance, y: begin.y };
  return [{ kind: "drag", path: [begin, end] }];
};

/**
 * Closing is never a second drag: once open, a drag could start on a control
 * in the Advanced area, and nothing in there is the tour's to touch. Scrolling
 * the fold back to its closed offset is the fold's own re-lock
 * (specs/advanced-fold.md).
 */
export function closeFold(fold: HTMLElement) {
  const offset = Number(fold.dataset.tutorialOffset ?? 0);
  delete fold.dataset.tutorialOffset;
  if (fold.dataset.open !== "true") return;
  if (fold.dataset.axis === "x") fold.scrollLeft = offset;
  else fold.scrollTop = offset;
  fold.dispatchEvent(new Event("scroll"));
}

const foldClose: ScriptPart = (fold) => {
  closeFold(fold);
  return [{ kind: "rest", ms: PART_REST_MS }];
};

export const SCRIPT_PARTS: Record<TutorialScriptId, ScriptEntry[]> = {
  none: [],
  lights: [
    say("Here's how you select a mode: tap to cycle through brightness, hue and saturation."),
    rest(300), tapDial, rest(500), tapDial, rest(500), tapDial, rest(700),
    say("Here's how to adjust one: turn the knob, from wherever you grab it."),
    turn(-60, 70), rest(300), turn(70, -40), rest(600),
    say("Change modes with a tap, then turn to set the hue."),
    tapDial, rest(400), turn(0, 150),
  ],
  aircon: [
    say("Climate knobs lock when idle. One tap unlocks it."),
    tapDial, rest(900),
    say("Here's how you select a mode: tap to cycle Auto, Manual and Off."),
    tapDial, rest(500), tapDial, rest(500), tapDial, rest(700),
    say("Here's how to adjust one: turn to set the target, up and down."),
    turn(-30, 50), rest(300), turn(50, -10), rest(600),
    say("In Manual each ring sets one thing: drag it by its thumb."),
    tapDial, rest(900), ringDrag("fan", 70), ringDrag("mode", 45), ringTap("fresh"), rest(400), ringDrag("timer", 80),
  ],
  "orb-dial": [
    say("The orb shows what's running, like this wash. Tap to open it."),
    tapOrb, rest(900),
    say("With it open, a tap turns the wash's finish alert off, and on again."),
    tapOrb, rest(1200), tapOrb, rest(900),
  ],
  "fold-open": [foldPull, rest(1800), foldClose],
};

/** The fold step drives the real fold with mouse events; the rest drive copies. */
export const scriptMode = (id: TutorialScriptId) => (id === "fold-open" ? "mouse" : "pointer");
