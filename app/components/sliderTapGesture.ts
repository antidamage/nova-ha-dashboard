/**
 * Tap-versus-drag for the slider primitives.
 *
 * Every Dot control used to move its value the instant a pointer landed, which
 * left no gesture free for "I want to type this number instead". A tap now
 * opens the numeric-entry popover, so the value change a press used to make is
 * *deferred* until the gesture is known to be a drag.
 *
 * A gesture is a tap only while both hold: it has moved less than
 * TAP_MOVE_THRESHOLD_PX, and less than TAP_MAX_MS have passed. The timer is why
 * a press-and-hold that never moves still drags — holding still on a slider
 * reads as "grab", not "type", and without it a slow deliberate drag would open
 * a popover mid-gesture.
 */

export const TAP_MOVE_THRESHOLD_PX = 5;
export const TAP_MAX_MS = 400;

type PointerLike = { clientX: number; clientY: number };

export type SliderTapGesture = {
  /** Viewport coordinates of the press, used to apply the deferred jump. */
  readonly clientX: number;
  readonly clientY: number;
  /** True once the gesture has been promoted to a drag. */
  promoted: boolean;
  timer: ReturnType<typeof setTimeout> | null;
};

/**
 * Starts tracking a press. `promote` runs at most once — either from
 * {@link observeTap} when the pointer moves far enough, or from the hold timer.
 * It is where the caller applies the value change it deferred.
 */
export function beginTap(event: PointerLike, promote: () => void): SliderTapGesture {
  const gesture: SliderTapGesture = {
    clientX: event.clientX,
    clientY: event.clientY,
    promoted: false,
    timer: null,
  };

  gesture.timer = setTimeout(() => {
    gesture.timer = null;
    if (gesture.promoted) return;
    gesture.promoted = true;
    promote();
  }, TAP_MAX_MS);

  return gesture;
}

/**
 * Feeds a pointer move in. Returns true once the gesture is a drag — callers
 * should ignore moves until it does, because the press has not been applied
 * yet and dragging from an unseeded accumulator jumps to nonsense.
 */
export function observeTap(gesture: SliderTapGesture | null, event: PointerLike, promote: () => void) {
  if (!gesture) return false;
  if (gesture.promoted) return true;

  const moved = Math.hypot(event.clientX - gesture.clientX, event.clientY - gesture.clientY);
  if (moved < TAP_MOVE_THRESHOLD_PX) return false;

  cancelTapTimer(gesture);
  gesture.promoted = true;
  promote();
  return true;
}

/** Promotes immediately, for a control that has opted out of numeric entry. */
export function promoteTap(gesture: SliderTapGesture | null, promote: () => void) {
  if (!gesture || gesture.promoted) return;
  cancelTapTimer(gesture);
  gesture.promoted = true;
  promote();
}

/** True when the press ended without ever becoming a drag. */
export function endedAsTap(gesture: SliderTapGesture | null) {
  if (!gesture) return false;
  cancelTapTimer(gesture);
  return !gesture.promoted;
}

export function cancelTapTimer(gesture: SliderTapGesture | null) {
  if (gesture?.timer != null) {
    clearTimeout(gesture.timer);
    gesture.timer = null;
  }
}
