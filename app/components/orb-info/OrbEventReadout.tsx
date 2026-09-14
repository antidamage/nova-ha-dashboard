"use client";
import { ReminderGlyphMark } from "../reminders/icon-registry";
export function OrbEventIcon({ icon }: { icon: string }) {
  return <ReminderGlyphMark glyph={icon.startsWith("text:") ? { kind: "text", value: icon.slice(5) } : { kind: "phosphor", id: icon }} />;
}
export function CountdownRing({ fraction }: { fraction: number }) {
  const remaining = Math.max(0, Math.min(1, fraction));
  return <svg className="orb-countdown-ring" viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r="46" pathLength="1" fill="none" stroke="currentColor" strokeWidth="4"
      strokeDasharray={`${remaining} 1`} transform="rotate(-90 50 50)" />
  </svg>;
}
export function OrbEventReadout({ icon, fraction, text }: { icon: string; fraction?: number; text: string }) {
  return <span className="orb-event-readout"><span className="orb-event-icon">
    <OrbEventIcon icon={icon} />{fraction !== undefined && <CountdownRing fraction={fraction} />}
  </span><span>{text}</span></span>;
}
