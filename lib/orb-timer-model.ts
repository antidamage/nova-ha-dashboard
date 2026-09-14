export type OrbTimer = {
  id: string;
  icon: string;
  label: string;
  durationMs: number;
  startedAt: number;
  endsAt: number;
  completedAt: number | null;
  dismissedAt: number | null;
};
export const TIMER_SOUND_REPEAT_MS = 30_000;
export const TIMER_SOUND_WINDOW_MS = 300_000;
export function timerSoundSlot(timer: OrbTimer | null, now: number): number | null {
  if (!timer || timer.completedAt === null || timer.dismissedAt !== null) return null;
  const elapsed = now - timer.completedAt;
  return elapsed >= 0 && elapsed < TIMER_SOUND_WINDOW_MS ? Math.floor(elapsed / TIMER_SOUND_REPEAT_MS) : null;
}
export function completeTimer(timer: OrbTimer | null, now: number): OrbTimer | null {
  return timer && timer.completedAt === null && timer.dismissedAt === null && now >= timer.endsAt
    ? { ...timer, completedAt: timer.endsAt } : timer;
}
export function timerRemaining(timer: OrbTimer, now: number): number {
  return Math.max(0, timer.endsAt - now);
}
export function countdownText(ms: number): string {
  const seconds = Math.ceil(Math.abs(ms) / 1000);
  return `${ms < 0 ? "+" : ""}${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
