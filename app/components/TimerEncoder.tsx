"use client";
import { useCallback, useRef, useState } from "react";
import { RotaryEncoder } from "./RotaryEncoder";
import { useNumericEntry } from "./NumericEntryPopover";
import { useOrbTimer } from "./orb-info/useOrbTimer";
import { useOrbSettings } from "./orb-info/useOrbSettings";
import { OrbEventReadout } from "./orb-info/OrbEventReadout";
import { countdownText, timerRemaining } from "../../lib/orb-timer-model";
import { timerIconCode } from "../../lib/orb-timer-settings";
import { timerFractionToMinutes, timerMinutesToFraction } from "./timerEncoderMath";
import { playUxSound } from "./dashboard/controlSound";
export function TimerEncoder() {
  const { timer, now, command } = useOrbTimer();
  const { icons } = useOrbSettings();
  const [index, setIndex] = useState(0);
  const [minutes, setMinutes] = useState(0);
  const [locked, setLocked] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const dirty = useRef(false);
  const draft = useRef({ minutes, icon: icons[index % icons.length] });
  draft.current = { minutes, icon: icons[index % icons.length] };
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
  const icon = locked && active ? active.icon : timerIconCode(icons[index % icons.length].glyph);
  const done = active && (active.completedAt !== null || active.endsAt <= now);
  return <div className="timer-encoder-panel">
    <RotaryEncoder title="Timer" ariaLabel="Set household timer" size={150} leds={[]} value={index}
      range={{ min: 0, max: Math.max(1, icons.length), step: 1, wrap: true }} sensitivity={1 / 30}
      onChange={(value) => { setIndex(Math.round(value) % icons.length); dirty.current = true; }}
      color="rgb(var(--nova-alert-rgb))" tuckAfterMs={numericOpen.current ? 3600000 : 5000} onLockChange={onLockChange}
      rings={[{ id: "duration", label: "Duration", value: timerMinutesToFraction(minutes), min: 0, max: 1, step: .001,
        valueText: (value) => { const m = timerFractionToMinutes(value); return m ? `${m} min` : "Off"; }, valueTextWidest: "480 min",
        onChange: (value) => changeMinutes(timerFractionToMinutes(value)),
        onValueTap: (anchor) => { numericOpen.current = true; numeric.open({ anchor, anchorOffsetX: anchor.clientWidth / 2,
          label: "Timer minutes", min: 0, max: 480, step: 1 / 60, value: minutes, hint: "0 = Off; up to 480 minutes",
          onCommit: changeMinutes, onClose: () => { numericOpen.current = false; commit(); } }); } }]}
    >
      <div className="timer-encoder-face"><OrbEventReadout icon={icon}
        fraction={locked && active && !done ? timerRemaining(active, now) / active.durationMs : undefined}
        remainingMs={locked && active && !done ? timerRemaining(active, now) : undefined}
        text={locked && active ? done ? "Done" : countdownText(timerRemaining(active, now)) : minutes ? countdownText(minutes * 60_000) : "Off"} /></div>
    </RotaryEncoder>
    {numeric.element}{error && <p role="alert">{error}</p>}
  </div>;
}
