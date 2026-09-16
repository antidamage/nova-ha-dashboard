import { normalizeGlyph, type ReminderGlyph } from "./reminder-glyph";
export type TimerIcon = { id: string; label: string; glyph: ReminderGlyph };
export const DEFAULT_TIMER_ICONS: TimerIcon[] = [{ id: "timer", label: "Countdown", glyph: { kind: "phosphor", id: "timer" } }];
export function normalizeTimerIcons(value: unknown): TimerIcon[] {
  if (!Array.isArray(value)) return DEFAULT_TIMER_ICONS;
  const ids = new Set<string>();
  const icons = value.slice(0, 24).flatMap((entry) => {
    const glyph = normalizeGlyph(entry?.glyph);
    if (!glyph || typeof entry.id !== "string" || ids.has(entry.id) || typeof entry.label !== "string" || !entry.label.trim()) return [];
    ids.add(entry.id);
    return [{ id: entry.id.slice(0, 100), label: entry.label.trim().slice(0, 80), glyph }];
  });
  return icons.length ? icons : DEFAULT_TIMER_ICONS;
}
export function timerIconCode(glyph: ReminderGlyph) { return glyph.kind === "text" ? `text:${glyph.value}` : glyph.id; }
