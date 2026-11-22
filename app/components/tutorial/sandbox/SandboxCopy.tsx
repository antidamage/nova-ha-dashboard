"use client";

import { type CSSProperties, forwardRef, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { NovaAvatarTheme } from "../../avatarThemeModel";
import type { Hsva } from "../../colorEncoderModel";
import { RingPortalTagContext } from "../../controls/rotary/ringPortalTag";
import { LightEncoder } from "../../LightEncoder";
import { DemoTemperatureDial } from "../../TemperatureEncoderDemo";
import type { TutorialCopyKind, TutorialStep } from "../steps";
import { dialOf } from "../targets";
import { useTrackedRect } from "../useTrackedRect";
import { SandboxOrb } from "./SandboxOrb";

/** Fixed starting values: copies take nothing from live or simulated state. */
const LIGHT_START: Hsva = { h: 36, s: 55, v: 62, a: 1 };

function LightCopy({ size }: { size: number }) {
  const [value, setValue] = useState(LIGHT_START);
  return <LightEncoder ariaLabel="Demo light" label="Lights" size={size} value={value} onChange={setValue} />;
}

const clampSize = (size: number) => Math.round(Math.max(50, Math.min(200, size)));

/** A knob's own size, `--re-size` on its root: the dial box is larger. */
function knobSize(target: HTMLElement): number | null {
  const root = target.matches(".rotary-encoder") ? target : target.querySelector(".rotary-encoder");
  if (!root) return null;
  const value = parseFloat(getComputedStyle(root).getPropertyValue("--re-size"));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Hides the real control while the copy covers it: no doubled edge, no live
 * number showing through, nothing in the focus order (specs/tutorial-mode.md).
 */
function useHideReal(target: HTMLElement | null) {
  useEffect(() => {
    if (!target) return;
    const visibility = target.style.visibility;
    const wasInert = target.inert;
    target.style.visibility = "hidden";
    target.inert = true;
    target.dataset.tutorialCovered = "true";
    return () => {
      target.style.visibility = visibility;
      target.inert = wasInert;
      delete target.dataset.tutorialCovered;
    };
  }, [target]);
}

type Props = {
  kind: Exclude<TutorialCopyKind, null>;
  target: HTMLElement;
  step: TutorialStep;
  avatar: NovaAvatarTheme;
  /** Bumped to remount the copy at its starting state. */
  resetKey: number;
  /** The aircon layer view's example: start in Manual, every ring showing. A prop on the copy only. */
  manual?: boolean;
};

/**
 * Mounts a deviceless copy over the real control: knobs line their dial's
 * centre up with the real dial's, the orb its box.
 */
export const SandboxCopy = forwardRef<HTMLDivElement, Props>(function SandboxCopy({ kind, target, step, avatar, resetKey, manual }, ref) {
  const anchor = kind === "light" || kind === "aircon" ? dialOf(target) ?? target : target;
  const rect = useTrackedRect(anchor);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  useHideReal(target);

  const size = clampSize(knobSize(target) ?? rect?.width ?? 120);
  const centred = kind === "light" || kind === "aircon";

  // Where the copy's own anchor sits inside the copy, so it can be laid on the
  // real one. Re-measured when the size or the copy changes.
  useLayoutEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    const own = centred ? inner.querySelector(".rotary-encoder-dial") : inner.firstElementChild;
    if (!own) return;
    const box = inner.getBoundingClientRect();
    const mine = own.getBoundingClientRect();
    const next = centred
      ? { x: mine.left - box.left + mine.width / 2, y: mine.top - box.top + mine.height / 2 }
      : { x: mine.left - box.left, y: mine.top - box.top };
    setOffset((held) => (Math.abs(held.x - next.x) < 0.5 && Math.abs(held.y - next.y) < 0.5 ? held : next));
  }, [centred, kind, resetKey, size]);

  if (!rect) return null;
  const left = centred ? rect.left + rect.width / 2 - offset.x : rect.left - offset.x;
  const top = centred ? rect.top + rect.height / 2 - offset.y : rect.top - offset.y;
  const style = {
    transform: `translate3d(${left.toFixed(1)}px, ${top.toFixed(1)}px, 0)`,
  } as CSSProperties;

  return (
    <div ref={ref} className="tutorial-copy" data-tutorial-ui="" data-tutorial-copy={kind} style={style}>
      <span className="tutorial-copy-tag rect-envelope-tag">DEMO</span>
      <RingPortalTagContext.Provider value="tutorial">
        <div ref={innerRef} key={resetKey} className="tutorial-copy-inner">
          {kind === "light" ? <LightCopy size={size} /> : null}
          {kind === "aircon" ? (
            <DemoTemperatureDial id="tutorial" size={size} startMode={manual ? "manual" : step.aircon?.mode ?? "auto"} target={22} room={21.4} />
          ) : null}
          {kind === "orb" ? <SandboxOrb size={Math.round(rect.width)} avatar={avatar} /> : null}
        </div>
      </RingPortalTagContext.Provider>
    </div>
  );
});
