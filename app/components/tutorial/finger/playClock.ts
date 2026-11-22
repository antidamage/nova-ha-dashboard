/**
 * The finger script's clock (specs/tutorial-mode.md, "Pause and Resume"):
 * real time less every paused stretch, so a pause freezes the finger where it
 * is and Resume carries on from the same point. `now` is injectable for tests.
 */
export class PlayClock {
  private pausedAt: number | null = null;
  private held = 0;

  constructor(private readonly real: () => number = () => performance.now()) {}

  now() {
    return (this.pausedAt ?? this.real()) - this.held;
  }

  get paused() {
    return this.pausedAt !== null;
  }

  pause() {
    this.pausedAt ??= this.real();
  }

  resume() {
    if (this.pausedAt === null) return;
    this.held += this.real() - this.pausedAt;
    this.pausedAt = null;
  }
}
