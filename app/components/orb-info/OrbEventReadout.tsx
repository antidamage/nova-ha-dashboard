"use client";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { ReminderGlyphMark } from "../reminders/icon-registry";
export function OrbEventIcon({ icon }: { icon: string }) {
  return <ReminderGlyphMark glyph={icon.startsWith("text:") ? { kind: "text", value: icon.slice(5) } : { kind: "phosphor", id: icon }} />;
}
/** Last ten seconds of a countdown pulse the ring out and back in, once a second. */
export const COUNTDOWN_RING_PULSE_MS = 10_000;
export function CountdownRing({ fraction, remainingMs }: { fraction: number; remainingMs?: number }) {
  const remaining = Math.max(0, Math.min(1, fraction));
  const pulsing = remainingMs !== undefined && remainingMs > 0 && remainingMs <= COUNTDOWN_RING_PULSE_MS;
  return <svg className={`orb-countdown-ring${pulsing ? " orb-countdown-ring-pulsing" : ""}`} viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r="46" pathLength="1" fill="none" stroke="currentColor" strokeWidth="4"
      strokeDasharray={`${remaining} 1`} transform="rotate(-90 50 50)" />
  </svg>;
}
/** Shrinks longer strings so icon + text readouts fit the orb face at every size. */
export function orbTextFit(text: string): number {
  return Math.max(0.45, Math.min(1, 4.5 / Math.max(1, [...text].length)));
}
export function OrbEventReadout({ icon, fraction, remainingMs, text }: { icon: string; fraction?: number; remainingMs?: number; text: string }) {
  return <span className="orb-event-readout"><span className="orb-event-icon">
    <OrbEventIcon icon={icon} />{fraction !== undefined && <CountdownRing fraction={fraction} remainingMs={remainingMs} />}
  </span><span className="orb-event-text" style={{ "--orb-text-fit": orbTextFit(text) } as CSSProperties}>{text}</span></span>;
}
type ReadoutItem = { entry: { id: string }; output: { icon?: string; countdownFraction?: number; remainingMs?: number }; text: string };
function ReadoutBody({ item }: { item: ReadoutItem }) {
  return item.output.icon
    ? <OrbEventReadout icon={item.output.icon} fraction={item.output.countdownFraction} remainingMs={item.output.remainingMs} text={item.text} />
    : <>{item.text}</>;
}
/**
 * The stack readout: the item on show, sliding in the turn direction (about
 * 220 ms, ease-out) inside a soft-edged mask when the dial moves.
 */
export function OrbStackReadout({ item, index, direction }: { item: ReadoutItem; index: number; direction: 1 | -1 }) {
  const [previous, setPrevious] = useState<{ item: ReadoutItem; index: number } | null>(null);
  const shown = useRef({ item, index });
  useEffect(() => {
    if (shown.current.index === index) { shown.current = { item, index }; return; }
    setPrevious(shown.current);
    shown.current = { item, index };
  }, [item, index]);
  // Separate from the effect above: the item object is new on every tick.
  useEffect(() => {
    if (!previous) return;
    const id = window.setTimeout(() => setPrevious(null), 260);
    return () => window.clearTimeout(id);
  }, [previous]);
  return <span className="orb-stack-viewport" data-orb-stack-index={index} data-orb-entry-id={item.entry.id}>
    {previous && <span key={`out-${previous.index}`} className={`orb-stack-slide orb-stack-out-${direction > 0 ? "next" : "prev"}`} aria-hidden="true"><ReadoutBody item={previous.item} /></span>}
    <span key={`in-${index}`} className={`orb-stack-slide${previous ? ` orb-stack-in-${direction > 0 ? "next" : "prev"}` : ""}`}><ReadoutBody item={item} /></span>
  </span>;
}
