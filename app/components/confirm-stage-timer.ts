"use client";

import { useEffect, useState } from "react";

/**
 * Per-stage timing for `ConfirmDialog` (specs/system-power-controls.md, the
 * Computers panel's Shut down): the confirm button is locked for `armDelayMs`
 * after a stage opens, then live for `expireMs`, then the stage expires.
 *
 *   ready    untimed: confirm is available indefinitely (every other dialog)
 *   locked   confirm ignored, counting down to live
 *   live     confirm accepted, counting down to expiry
 *   expired  confirm ignored; the dialog shows its timeout line and closes
 *
 * The phase belongs to one stage of one opening. A stage that has not had its
 * timers started yet - the very render it first appears in - reads as locked
 * (or live, with no lock), never as the previous stage's phase. That is what
 * stops a fast double tap from confirming stage 2 before its lock begins.
 */
export type StagePhase = "ready" | "locked" | "live" | "expired";

type TimerState = { key: number | null; phase: StagePhase; startedAt: number };

const TICK_MS = 200;

function firstPhase(armDelayMs: number, expireMs: number): StagePhase {
  if (armDelayMs > 0) {
    return "locked";
  }
  return expireMs > 0 ? "live" : "ready";
}

export function useStageTimer({
  armDelayMs = 0,
  expireMs = 0,
  running,
  stageKey,
}: {
  armDelayMs?: number;
  expireMs?: number;
  /** The dialog is open and showing a stage. */
  running: boolean;
  /** Changes whenever a new stage is shown. */
  stageKey: number;
}) {
  const timed = armDelayMs > 0 || expireMs > 0;
  const [state, setState] = useState<TimerState>({ key: null, phase: "ready", startedAt: 0 });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running || !timed) {
      // Forget the last opening, so the next one starts from its first phase.
      setState({ key: null, phase: "ready", startedAt: 0 });
      return;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    const enter = (phase: StagePhase) => {
      const startedAt = Date.now();
      setState({ key: stageKey, phase, startedAt });
      setNow(startedAt);
      if (phase === "live") {
        timers.push(setTimeout(() => enter("expired"), expireMs));
      }
    };
    if (armDelayMs > 0) {
      enter("locked");
      timers.push(setTimeout(() => enter(expireMs > 0 ? "live" : "ready"), armDelayMs));
    } else {
      enter("live");
    }
    const tick = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => {
      timers.forEach(clearTimeout);
      clearInterval(tick);
    };
  }, [armDelayMs, expireMs, running, stageKey, timed]);

  if (!timed) {
    return { phase: "ready" as StagePhase, secondsLeft: 0, fractionLeft: 1 };
  }
  const current = state.key === stageKey;
  const phase = current ? state.phase : firstPhase(armDelayMs, expireMs);
  const span = phase === "locked" ? armDelayMs : phase === "live" ? expireMs : 0;
  const elapsed = current ? Math.max(0, now - state.startedAt) : 0;
  const remaining = Math.max(0, span - elapsed);
  return {
    phase,
    secondsLeft: span ? Math.max(1, Math.ceil(remaining / 1000)) : 0,
    fractionLeft: span ? remaining / span : 0,
  };
}
