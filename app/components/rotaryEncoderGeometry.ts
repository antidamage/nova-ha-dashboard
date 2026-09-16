/**
 * Ring geometry and pointer maths for RotaryEncoder — facade. The body lives in
 * controls/rotary/geometry-model.ts and ring-drag-model.ts, its constants in controls/rotary/constants.ts
 * and its shapes in controls/rotary/types.ts (specs/agent-token-footprint.md §3.3).
 */
export {
  ARC_END,
  ARC_MIN_SPAN,
  ARC_SPAN,
  ARC_START,
  LABEL_VALUE_CLEARANCE,
  RING_LIMIT,
  THUMB_LENGTH,
  THUMB_THICKNESS,
  TITLE_END_CLEARANCE,
} from "./controls/rotary/constants";
export type { RingDrag, RingGeometry } from "./controls/rotary/types";
export {
  arcPath,
  captionFont,
  fractionAt,
  gapLength,
  gapSpan,
  labelPath,
  labelRoom,
  onArc,
  pointerAngle,
  polar,
  ringAt,
  ringEndFor,
  ringGeometry,
  ringLabelFont,
  thumbAngle,
  titlePath,
  titleRoom,
} from "./controls/rotary/geometry-model";
export { dragStep, fractionOf, valueAt } from "./controls/rotary/ring-drag-model";
