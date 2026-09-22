export type OrbTimer = {
  id: string;
  icon: string;
  label: string;
  durationMs: number;
  startedAt: number;
  endsAt: number;
  completedAt: number | null;
  dismissedAt: number | null;
  /**
   * Whether the timer's own clock completes it. A timer whose end is decided by
   * its driver — the washing machine's — sets this false and is completed by
   * that driver instead, so no screen can flash "Done" for a wash that is still
   * running (specs/power-meters.md, "The wash's timer").
   */
  autoComplete: boolean;
};
export const TIMER_SOUND_REPEAT_MS = 30_000;
export const TIMER_SOUND_WINDOW_MS = 300_000;
export function timerSoundSlot(timer: OrbTimer | null, now: number): number | null {
  if (!timer || timer.completedAt === null || timer.dismissedAt !== null) return null;
  const elapsed = now - timer.completedAt;
  return elapsed >= 0 && elapsed < TIMER_SOUND_WINDOW_MS ? Math.floor(elapsed / TIMER_SOUND_REPEAT_MS) : null;
}
/** Done when the timer's own clock says so, or when its driver completed it. */
export function timerIsDone(timer: OrbTimer, now: number): boolean {
  return timer.completedAt !== null || (timer.autoComplete && now >= timer.endsAt);
}
export function completeTimer(timer: OrbTimer | null, now: number): OrbTimer | null {
  return timer && timer.autoComplete && timer.completedAt === null && timer.dismissedAt === null && now >= timer.endsAt
    ? { ...timer, completedAt: timer.endsAt } : timer;
}
export function timerRemaining(timer: OrbTimer, now: number): number {
  return Math.max(0, timer.endsAt - now);
}
export function countdownText(ms: number): string {
  const seconds = Math.ceil(Math.abs(ms) / 1000);
  const minutes = Math.floor(seconds / 60);
  const sign = ms < 0 ? "+" : "";
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${sign}${hours}:${String(minutes % 60).padStart(2, "0")}`;
  }
  return `${sign}${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
