/**
 * The finger's gestures as a timeline (specs/tutorial-mode.md, "The finger").
 * Pure: a list of gestures in screen coordinates compiles to timed samples the
 * driver replays, so pacing is tested without a DOM or a clock.
 */

export type Point = { x: number; y: number };

/** Angles are screen degrees clockwise from 12 o'clock. */
export type Gesture =
  | { kind: "tap"; at: Point; holdMs?: number }
  | { kind: "drag"; path: Point[] }
  | { kind: "arc"; centre: Point; radius: number; fromDeg: number; toDeg: number }
  | { kind: "rest"; ms: number };

export type Sample = {
  t: number;
  x: number;
  y: number;
  pressed: boolean;
  /** Set on the sample where the press starts or ends. */
  edge?: "down" | "up";
};

/** "Slowly": a pressed drag moves at about 60px per second. */
export const DRAG_PX_PER_SEC = 60;
/** Unpressed travel between gestures is quicker, but still easy to follow. */
export const TRAVEL_PX_PER_SEC = 320;
/** A tap is 300ms down: inside the dial's 60–400ms unlock window. */
export const TAP_HOLD_MS = 300;
/** The rest between the parts of one gesture script. */
export const PART_REST_MS = 600;
export const FRAME_MS = 16;

export function pointOnArc(centre: Point, radius: number, deg: number): Point {
  const rad = (deg * Math.PI) / 180;
  return { x: centre.x + radius * Math.sin(rad), y: centre.y - radius * Math.cos(rad) };
}

/** Screen degrees (clockwise from 12) of `point` about `centre`, 0–360. */
export function angleOf(centre: Point, point: Point): number {
  const deg = (Math.atan2(point.x - centre.x, centre.y - point.y) * 180) / Math.PI;
  return (deg + 360) % 360;
}

const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

function pathOf(gesture: Gesture): Point[] {
  switch (gesture.kind) {
    case "tap":
      return [gesture.at];
    case "drag":
      return gesture.path;
    case "arc": {
      const sweep = gesture.toDeg - gesture.fromDeg;
      const steps = Math.max(2, Math.ceil(Math.abs(sweep) / 3));
      return Array.from({ length: steps + 1 }, (_, index) =>
        pointOnArc(gesture.centre, gesture.radius, gesture.fromDeg + (sweep * index) / steps));
    }
    case "rest":
      return [];
  }
}

/** Samples along a polyline at `speed`, one per frame, starting at `t`. */
function walk(points: Point[], t: number, speed: number, pressed: boolean): Sample[] {
  const out: Sample[] = [];
  let clock = t;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const length = distance(from, to);
    const duration = (length / speed) * 1000;
    const frames = Math.max(1, Math.ceil(duration / FRAME_MS));
    for (let frame = 1; frame <= frames; frame += 1) {
      const share = frame / frames;
      out.push({ t: clock + duration * share, x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share, pressed });
    }
    clock += duration;
  }
  return out;
}

/**
 * Compiles a script into samples. The finger starts at `start`, travels
 * unpressed to each gesture, presses, moves, releases, and rests
 * `PART_REST_MS` before the next gesture.
 */
export function compileGestures(gestures: readonly Gesture[], start: Point): Sample[] {
  const samples: Sample[] = [{ t: 0, x: start.x, y: start.y, pressed: false }];
  const last = () => samples[samples.length - 1];
  for (const gesture of gestures) {
    if (gesture.kind === "rest") {
      const at = last();
      samples.push({ t: at.t + gesture.ms, x: at.x, y: at.y, pressed: false });
      continue;
    }
    const path = pathOf(gesture);
    if (path.length === 0) continue;
    const at = last();
    samples.push(...walk([{ x: at.x, y: at.y }, path[0]], at.t, TRAVEL_PX_PER_SEC, false));
    const down = last();
    samples.push({ t: down.t + FRAME_MS, x: path[0].x, y: path[0].y, pressed: true, edge: "down" });
    if (gesture.kind === "tap") {
      const pressed = last();
      samples.push({ t: pressed.t + (gesture.holdMs ?? TAP_HOLD_MS), x: path[0].x, y: path[0].y, pressed: false, edge: "up" });
    } else {
      samples.push(...walk(path, last().t, DRAG_PX_PER_SEC, true));
      const end = last();
      samples.push({ t: end.t + FRAME_MS, x: end.x, y: end.y, pressed: false, edge: "up" });
    }
    const released = last();
    samples.push({ t: released.t + PART_REST_MS, x: released.x, y: released.y, pressed: false });
  }
  return samples;
}

/** The sample in force at time `t` (the last one at or before it). */
export function sampleAt(samples: readonly Sample[], t: number): number {
  let low = 0;
  let high = samples.length - 1;
  if (high < 0 || t < samples[0].t) return -1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (samples[mid].t <= t) low = mid;
    else high = mid - 1;
  }
  return low;
}

export function durationOf(samples: readonly Sample[]): number {
  return samples.length ? samples[samples.length - 1].t : 0;
}
