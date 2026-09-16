export type TaskSource = "local" | "icloud-calendar" | "icloud-reminders";

export type TaskRepeat =
  | {
      kind: "hourly";
    }
  | {
      kind: "morning-night";
    }
  | {
      kind: "days";
      intervalDays: number;
    };

/**
 * A reminder whose schedule is derived from another reminder's completion
 * rather than from a clock interval.
 *
 * The follow-on has no cadence of its own: completing the anchor is what puts
 * it back on the board, `offsetDays` clear days later at `hour` local time. Its
 * effective cycle is therefore whatever the anchor's turns out to be, which is
 * the point — a chore that only makes sense "the evening after the injection"
 * has to move when the injection moves.
 */
export type TaskFollows = {
  /** The anchor reminder's id. */
  taskId: string;
  /** Whole days after the anchor's completion. 0 is the same day. */
  offsetDays: number;
  /** Local hour of day the follow-on lands on. */
  hour: number;
};

export type Task = {
  id: string;
  name: string;
  start: string;
  end?: string;
  createdAt: string;
  dismissedAt?: string;
  alertDismissedAt?: string;
  alertDismissedFor?: string;
  /**
   * The alert session key (see `alertSessionKey`) whose chime has already been
   * played. Shared state, not per-device: the sound is one household event, so
   * the first screen to play it marks the occurrence and every other screen --
   * and every subsequent page load, which is where this used to go wrong --
   * stays quiet. Cleared alongside `alertDismissedFor` whenever the occurrence
   * itself changes (roll-forward, completion, reschedule).
   */
  alertChimedFor?: string;
  /**
   * Keep chiming on a cadence until someone dismisses the alert. Off by
   * default: a reminder announces itself once and then lives in the icon bar.
   * Only opt a reminder in when missing it actually matters.
   */
  annoy?: boolean;
  repeat?: TaskRepeat;
  /**
   * Scheduled from another reminder's completion. Mutually exclusive with
   * `repeat` — a follow-on borrows the anchor's cadence, so giving it a second,
   * independent one would just make the two fight over `start`.
   */
  follows?: TaskFollows;
  source: TaskSource;
  sourceId?: string;
  sourceCalendar?: string;
  occurrenceDate?: string;
  readOnly?: boolean;
  /**
   * The upstream item has a recurrence rule. Local tasks carry `repeat`
   * instead; mirrored ones cannot, because `repeat` is local-only (the
   * roll-forward in tasks.ts must not fight iCloud for control of the
   * schedule). The reminder icon bar needs to know a mirrored reminder is a
   * standing chore so it can auto-join the bar, and this is that flag.
   */
  recurs?: boolean;
  /**
   * Per-module state attached to this reminder, keyed by module id — e.g.
   * `{ "discord-bot": { onDue: true, onComplete: false } }`. Modules own the
   * shape inside their own key; the dashboard only carries it, and merges by
   * module id so two modules cannot clobber each other.
   *
   * This is the generic version of "add an option to a control event" from
   * `specs/module-system.md`: reminders are the first consumer, not the only
   * intended one.
   */
  moduleData?: Record<string, unknown>;
};
