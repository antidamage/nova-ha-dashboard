"use client";

import { type KeyboardEvent, type PointerEvent, type RefObject, useCallback, useEffect, useReducer, useRef } from "react";
import { pointerAngle } from "../rotaryEncoderGeometry";
import { angleDelta, ORB_DIAL_INITIAL, orbDialDetentDeg, orbDialIndex, orbDialNextDeadline, orbDialReducer } from "./orbDialModel";

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
 * Status orb dial: tap opens, drag around the orb steps entries, 5 s idle or a
 * focus change defocuses, 10 s after the last touch returns to the first entry.
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

  const angleOf = (event: PointerEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return pointerAngle(event.clientX - (rect.left + rect.width / 2), event.clientY - (rect.top + rect.height / 2));
  };

  const tap = useCallback(() => {
    const current = stateRef.current;
    // The entry actually on show at the moment of the tap, by id.
    const shown = idsRef.current[orbDialIndex(current, idsRef.current)];
    if (shown !== undefined && shownAlerting(shown)) { dismiss(shown); dispatch({ type: "touch", now: Date.now() }); return; }
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
      dispatch({ type: "step", delta: steps, ids: idsRef.current, now: Date.now() });
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
      if (!stateRef.current.open) dispatch({ type: "open", now });
      dispatch({ type: "step", delta: event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1, ids: idsRef.current, now });
    }
  };

  return {
    open: enabled && state.open,
    index: enabled ? orbDialIndex(state, ids) : 0,
    direction: state.direction,
    handlers: enabled ? { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onKeyDown } : {},
  };
}
