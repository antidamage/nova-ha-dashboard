"use client";

import { type KeyboardEvent, type PointerEvent, type RefObject, useCallback, useEffect, useReducer, useRef } from "react";
import { pointerAngle } from "../rotaryEncoderGeometry";
import { playUxSound } from "../dashboard/controlSound";
import { angleDelta, clampIndex, ORB_DIAL_INITIAL, orbDialDetentDeg, orbDialIndex, orbDialNextDeadline, orbDialReducer } from "./orbDialModel";

const TAP_SLOP_PX = 8;

type Options = {
  enabled: boolean;
  /** Entry ids of the ordered stack, top first. */
  ids: readonly string[];
  hostRef: RefObject<HTMLElement | null>;
  /** True when that entry is alerting: a tap dismisses instead of opening. */
  shownAlerting: (id: string) => boolean;
  dismiss: (id: string) => void;
};

/**
 * Status orb dial: tap opens, drag around the orb steps entries, and 5 s idle
 * or a focus change defocuses — which also reverts to the preferred display
 * order at once (specs/status-orb-stack.md).
 * Drag maths reuse RotaryEncoder's `pointerAngle` (relative sweep).
 */
export function useOrbDial({ enabled, ids, hostRef, shownAlerting, dismiss }: Options) {
  const count = ids.length;
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const [state, dispatch] = useReducer(orbDialReducer, ORB_DIAL_INITIAL);
  const drag = useRef<{ id: number; x: number; y: number; angle: number; sweep: number; moved: boolean } | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Timed transitions: one timeout at the next deadline.
  useEffect(() => {
    const deadline = orbDialNextDeadline(state);
    if (deadline === null) return;
    const id = window.setTimeout(() => dispatch({ type: "tick", now: Date.now() }), Math.max(0, deadline - Date.now()));
    return () => window.clearTimeout(id);
  }, [state]);

  // Focus moving elsewhere closes the dial: a tap outside, another control
  // taking focus, or the page being hidden.
  useEffect(() => {
    if (!state.open) return;
    const outside = (event: Event) => {
      const host = hostRef.current;
      if (host && event.target instanceof Node && !host.contains(event.target)) dispatch({ type: "close" });
    };
    const hidden = () => { if (document.hidden) dispatch({ type: "close" }); };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside, true);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside, true);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [state.open, hostRef]);

  useEffect(() => { if (!enabled) dispatch({ type: "close" }); }, [enabled]);

  // iOS Safari still pans the page from a touch on the fixed-position orb
  // despite `touch-action: none`, and React's touch listeners are passive, so a
  // native non-passive touchmove is what actually holds the page still. Any
  // touch that lands on the orb blocks panning for the whole gesture
  // (specs/status-orb-stack.md, "The dial never drags the page").
  useEffect(() => {
    const host = hostRef.current;
    if (!enabled || !host) return;
    const hold = (event: TouchEvent) => { if (event.cancelable) event.preventDefault(); };
    host.addEventListener("touchmove", hold, { passive: false });
    return () => host.removeEventListener("touchmove", hold);
  }, [enabled, hostRef]);

  // Re-lock sound: every close after an open, however it happened (idle
  // timeout, outside tap, focus loss, page hidden, Escape).
  const wasOpenRef = useRef(state.open);
  useEffect(() => {
    if (wasOpenRef.current && !state.open) playUxSound("lockDial");
    wasOpenRef.current = state.open;
  }, [state.open]);

  const angleOf = (event: PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return pointerAngle(event.clientX - (rect.left + rect.width / 2), event.clientY - (rect.top + rect.height / 2));
  };

  const tap = useCallback(() => {
    const current = stateRef.current;
    // The entry actually on show at the moment of the tap, by id.
    const shown = idsRef.current[orbDialIndex(current, idsRef.current)];
    if (shown !== undefined && shownAlerting(shown)) { dismiss(shown); dispatch({ type: "touch", now: Date.now() }); return; }
    if (!current.open) playUxSound("unlockDial");
    dispatch({ type: current.open ? "touch" : "open", now: Date.now() });
  }, [dismiss, shownAlerting]);

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (!enabled || (event.pointerType === "mouse" && event.button !== 0)) return;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, angle: angleOf(event), sweep: 0, moved: false };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* synthetic events */ }
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const active = drag.current;
    if (!active || active.id !== event.pointerId) return;
    if (!active.moved && Math.hypot(event.clientX - active.x, event.clientY - active.y) < TAP_SLOP_PX) return;
    active.moved = true;
    if (!stateRef.current.open) return;
    const angle = angleOf(event);
    active.sweep += angleDelta(active.angle, angle);
    active.angle = angle;
    const detent = orbDialDetentDeg(count);
    const steps = Math.trunc(active.sweep / detent);
    if (steps !== 0) {
      active.sweep -= steps * detent;
      const before = orbDialIndex(stateRef.current, idsRef.current);
      dispatch({ type: "step", delta: steps, ids: idsRef.current, now: Date.now() });
      // Only a detent that actually moves the stack clicks; grinding against
      // either end is silent (specs/ux-sounds.md).
      const after = clampIndex(before + Math.trunc(steps), idsRef.current.length);
      if (after !== before) playUxSound("dialClick");
    } else dispatch({ type: "touch", now: Date.now() });
    event.preventDefault();
  };
  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    const active = drag.current;
    if (!active || active.id !== event.pointerId) return;
    drag.current = null;
    if (!active.moved) tap();
    else dispatch({ type: "touch", now: Date.now() });
  };
  const onPointerCancel = () => { drag.current = null; };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!enabled) return;
    const now = Date.now();
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); tap(); }
    else if (event.key === "Escape") { if (stateRef.current.open) { event.preventDefault(); dispatch({ type: "close" }); } }
    else if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      if (!stateRef.current.open) { playUxSound("unlockDial"); dispatch({ type: "open", now }); }
      const before = orbDialIndex(stateRef.current, idsRef.current);
      const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
      dispatch({ type: "step", delta, ids: idsRef.current, now });
      if (clampIndex(before + delta, idsRef.current.length) !== before) playUxSound("dialClick");
    }
  };

  return {
    open: enabled && state.open,
    index: enabled ? orbDialIndex(state, ids) : 0,
    direction: state.direction,
    handlers: enabled ? { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onKeyDown } : {},
  };
}
