"use client";
import { type PointerEvent as ReactPointerEvent, useCallback, useRef, useState } from "react";
import { RotaryEncoder } from "./RotaryEncoder";
import { useNumericEntry } from "./NumericEntryPopover";
import { TAP_MAX_MS, TAP_MOVE_THRESHOLD_PX } from "./sliderTapGesture";
import { useOrbTimer } from "./orb-info/useOrbTimer";
import { useOrbSettings } from "./orb-info/useOrbSettings";
import { OrbEventReadout } from "./orb-info/OrbEventReadout";
import { countdownText, timerRemaining } from "../../lib/orb-timer-model";
import { timerIconCode } from "../../lib/orb-timer-settings";
import { TIMER_DIAL_STEP, TIMER_MAX_MINUTES, timerFractionToMinutes, timerMinutesToFraction } from "./timerEncoderMath";
import { playUxSound } from "./dashboard/controlSound";

/**
 * The knob sets the time and the ring round it picks the icon
 * (specs/status-orb-stack.md, "Set-timer control"). The dial carries the same
 * logarithmic duration the ring it replaced did, on the graduated detents in
 * `timerEncoderMath`, and the middle shows the minutes as they are turned. The
 * icon has no reading of its own: it changes on the face.
 */
export function TimerEncoder() {
  const { timer, now, command } = useOrbTimer();
  const { icons } = useOrbSettings();
  const [index, setIndex] = useState(0);
  const [minutes, setMinutes] = useState(0);
  const [locked, setLocked] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const dirty = useRef(false);
  /**
   * The stop the ring is on. A stored index can outrun a list that shrank under
   * an open control (a config sync lands), so it is read back through this
   * clamp, and the ring and the face both take their value from it. The list
   * itself is never empty: `normalizeTimerIcons` returns a default for anything
   * it cannot read.
   */
  const stopOf = (value: number) => Math.min(Math.max(0, Math.round(value)), Math.max(0, icons.length - 1));
  const stop = stopOf(index);
  const draft = useRef({ minutes, icon: icons[stop] });
  draft.current = { minutes, icon: icons[stop] };
  const numeric = useNumericEntry();
  const numericOpen = useRef(false);
  const active = timer && timer.dismissedAt === null ? timer : null;
  const current = useRef(active); current.current = active;
  const commit = useCallback(() => {
    if (!dirty.current || numericOpen.current) return;
    dirty.current = false;
    const { minutes, icon } = draft.current;
    // A drag to zero cancels, and cancellation is always silent
    // (specs/status-orb-stack.md, specs/ux-sounds.md).
    if (minutes > 0) playUxSound("timerSet");
    void command({ command: "set", durationMs: minutes * 60_000, icon: timerIconCode(icon.glyph), label: icon.label })
      .then(() => setError(null)).catch((error) => { dirty.current = true; setError(error.message); });
  }, [command]);
  const onLockChange = useCallback((value: boolean) => {
    setLocked(value);
    if (value) commit();
    else {
      setMinutes(current.current ? timerRemaining(current.current, Date.now()) / 60_000 : 0);
      dirty.current = false;
    }
  }, [commit]);
  const changeMinutes = (value: number) => { dirty.current = true; draft.current.minutes = value; setMinutes(value); };
  const changeIcon = (value: number) => { dirty.current = true; setIndex(stopOf(value)); };
  const openNumeric = (anchor: HTMLElement) => {
    numericOpen.current = true;
    numeric.open({ anchor, anchorOffsetX: anchor.clientWidth / 2, label: "Timer minutes", min: 0, max: TIMER_MAX_MINUTES, step: 1 / 60,
      value: minutes, hint: "0 = Off; up to 480 minutes", onCommit: changeMinutes, onClose: () => { numericOpen.current = false; commit(); } });
  };
  /**
   * Exact minutes, typed rather than turned: a tap on the knob opens the field,
   * as a tap on the old ring's reading did. Only a press that lands on the knob
   * counts — the rings are portalled but still bubble through this panel in
   * React's tree, so a ring's own tap would otherwise open the field too. The
   * press that unlocks the control is that gesture, not this one, so a locked
   * dial is never asked to type.
   */
  const press = useRef<{ x: number; y: number; at: number } | null>(null);
  const dialPress = {
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
      const onKnob = event.target instanceof Element && event.target.closest(".rotary-encoder-dial") !== null;
      press.current = !locked && onKnob ? { x: event.clientX, y: event.clientY, at: Date.now() } : null;
    },
    onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => {
      const from = press.current;
      press.current = null;
      if (!from) return;
      if (Math.abs(event.clientX - from.x) + Math.abs(event.clientY - from.y) >= TAP_MOVE_THRESHOLD_PX) return;
      if (Date.now() - from.at > TAP_MAX_MS) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLElement>(".rotary-encoder") : null;
      if (anchor) openNumeric(anchor);
    },
    onPointerCancel: () => { press.current = null; },
  };
  const icon = locked && active ? active.icon : timerIconCode(icons[stop].glyph);
  const done = active && (active.completedAt !== null || active.endsAt <= now);
  const readout = locked && active ? done ? "Done" : countdownText(timerRemaining(active, now)) : minutes ? countdownText(minutes * 60_000) : "Off";
  /**
   * The reading is also the field's keyboard door: an empty, transparent button
   * over it, for Tab and Enter, inert while the control is locked. It is a
   * sibling of the reading rather than its wrapper on purpose — a button clips
   * its absolutely positioned descendants, and the reading's text hangs below
   * the icon's box, so wrapping it stopped the minutes drawing at all. Its
   * pointer events reach the knob through the panel behind it (below), so a
   * press here is the same gesture as a press on the knob; the opened guard
   * covers both doors, because locking leaves this button focused.
   */
  const field = <button type="button" className="timer-encoder-field" aria-label="Type the timer minutes"
    tabIndex={locked ? -1 : 0} aria-hidden={locked || undefined}
    // The dial's own Enter/Space handler calls preventDefault, which is what a
    // browser would otherwise turn into this button's click: keep the key here.
    onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); }}
    onClick={(event) => { if (!locked) openNumeric(event.currentTarget); }} />;
  return <div className="timer-encoder-panel" {...dialPress}>
    {/* The dial's value is the duration's fraction. `timerMinutesToFraction`
        keeps every duration at or above the bottom step, so the value is never
        below the range and Off is the position just under it; the drafted minutes
        are untouched, so what commits is what the face reads. */}
    <RotaryEncoder title="Timer" ariaLabel="Set household timer" ariaValueText={readout}
      size={200} leds={[]} value={timerMinutesToFraction(minutes)} range={{ min: 0, max: 1, step: TIMER_DIAL_STEP }}
      onChange={(value) => changeMinutes(timerFractionToMinutes(value))}
      color="rgb(var(--nova-alert-rgb))" tuckAfterMs={numericOpen.current ? 3600000 : 5000} onLockChange={onLockChange}
      rings={[{ id: "icon", label: "Icon", value: stop, min: 0, max: Math.max(0, icons.length - 1), step: 1, onChange: changeIcon }]}
    >
      <div className="timer-encoder-face">{field}
        <OrbEventReadout icon={icon}
          fraction={locked && active && !done ? timerRemaining(active, now) / active.durationMs : undefined}
          remainingMs={locked && active && !done ? timerRemaining(active, now) : undefined}
          text={readout} /></div>
    </RotaryEncoder>
    {numeric.element}{error && <p role="alert">{error}</p>}
  </div>;
}
