"use client";

import type { OrbTimer } from "../../../../lib/orb-timer-model";
import { FALLBACK_REMINDER_GLYPH, normalizeGlyph, normalizeReminderKey } from "../../../../lib/reminder-glyph";
import type { Task } from "../../../../lib/types";
import { washReminder } from "../../../../lib/wash-reminder";
import { isTaskComplete, isTaskCurrent, isTaskOverdue, taskStartMs } from "../../tasks/task-model";
import type { RosterEntry, Tile, TileOrder } from "./types";

export const TICK_MS = 1000;

/**
 * Soonest first, so the tile you are most likely to want is nearest the clock,
 * and everything already dealt with (`nextDueMs` of Infinity) collects at the
 * far end. The roster's manual order survives only as the tiebreak between
 * reminders due at the same moment.
 */
export function compareReminderTiles(left: TileOrder, right: TileOrder) {
  return left.nextDueMs - right.nextDueMs || left.order - right.order || left.key.localeCompare(right.key);
}

export function parseRoster(raw: string): RosterEntry[] {
  const payload = JSON.parse(raw) as { entries?: unknown };
  if (!Array.isArray(payload.entries)) {
    return [];
  }

  return payload.entries.flatMap((value) => {
    if (!value || typeof value !== "object") {
      return [];
    }
    const entry = value as Record<string, unknown>;
    const key = typeof entry.key === "string" ? entry.key : "";
    const glyph = normalizeGlyph(entry.glyph);
    if (!key || !glyph) {
      return [];
    }

    return [
      {
        key,
        displayName: typeof entry.displayName === "string" && entry.displayName ? entry.displayName : key,
        glyph,
        showInBar: entry.showInBar !== false,
        order: typeof entry.order === "number" ? entry.order : 0,
      },
    ];
  });
}

export type BuildTilesInput = {
  tasks: Task[];
  roster: RosterEntry[];
  nowMs: number;
  recentCompletions: Record<string, number>;
  hasWashing: boolean;
  hasTimer: boolean;
  timer: OrbTimer | null;
  maxTiles: number;
  overduePulseAfterMs: number;
};

/** The ordered, capped tile list for the bar. Pure: the bar's useMemo body, moved as is. */
export function buildReminderTiles({
  tasks,
  roster,
  nowMs,
  recentCompletions,
  hasWashing,
  hasTimer,
  timer,
  maxTiles,
  overduePulseAfterMs,
}: BuildTilesInput): Tile[] {
  // Group live reminders by the same normalised name the roster is keyed on.
  const byKey = new Map<string, Task[]>();
  for (const task of tasks) {
    if (washReminder(task)) continue;
    const key = normalizeReminderKey(task.name ?? "");
    if (!key) {
      continue;
    }
    const bucket = byKey.get(key);
    if (bucket) {
      bucket.push(task);
    } else {
      byKey.set(key, [task]);
    }
  }

  return roster
    // Icon assignments are persisted independently of reminders so a
    // recurring iCloud mirror can keep its chosen glyph across resyncs.
    // They are only presentation metadata, though: an entry without a live
    // reminder must never become a permanent, empty tile in the bar.
    .filter((entry) => entry.showInBar && byKey.has(entry.key))
    .map((entry) => {
      const candidates = (byKey.get(entry.key) ?? [])
        .filter((task) => !isTaskComplete(task))
        .sort((left, right) => taskStartMs(left) - taskStartMs(right));

      const overdue = candidates.find((task) =>
        isTaskOverdue(task, nowMs, overduePulseAfterMs),
      );
      const current = candidates.find((task) => isTaskCurrent(task, nowMs));
      const active = overdue ?? current ?? null;

      // A tile with nothing live can still be the one you just cleared, and
      // that is exactly when undo matters, so look for a recent completion
      // among every task carrying this reminder's name.
      const completed = (byKey.get(entry.key) ?? []).find(
        (task) => recentCompletions[task.id] !== undefined,
      );

      // Nothing outstanding means the tile is done for now, whether it is a
      // one-off that has been ticked off or a repeater that has rolled
      // forward past the horizon we can see. Either way it sorts to the back.
      const nextDueMs = candidates.length ? taskStartMs(candidates[0]) : Number.POSITIVE_INFINITY;

      return {
        key: entry.key,
        displayName: entry.displayName,
        glyph: entry.glyph ?? FALLBACK_REMINDER_GLYPH,
        state: overdue ? "overdue" : current ? "due" : "idle",
        taskId: active?.id ?? null,
        undoUntil: completed ? (recentCompletions[completed.id] ?? null) : null,
        nextDueMs: Number.isFinite(nextDueMs) ? nextDueMs : Number.POSITIVE_INFINITY,
        order: entry.order,
      } satisfies Tile;
    })
    .concat(tasks.filter((task) => !hasWashing && washReminder(task) && !task.dismissedAt && !task.alertDismissedAt).map((task): Tile => ({
      key: task.id, displayName: task.name, glyph: { kind: "phosphor", id: "washing-machine" },
      state: washReminder(task)?.phase === "active" ? "due" : "idle",
      taskId: washReminder(task)?.phase === "active" ? task.id : null,
      undoUntil: null, nextDueMs: taskStartMs(task), order: -1,
    })))
    .concat(!hasTimer && timer && timer.dismissedAt === null ? [{
      key: `timer-${timer.id}`, displayName: `${timer.label} timer`,
      glyph: timer.icon.startsWith("text:") ? { kind: "text" as const, value: timer.icon.slice(5) } : { kind: "phosphor" as const, id: timer.icon },
      state: timer.completedAt !== null ? "due" as const : "idle" as const,
      taskId: timer.completedAt !== null ? `timer-${timer.id}` : null, undoUntil: null, nextDueMs: timer.endsAt, order: -1,
    }] : [])
    .sort(compareReminderTiles)
    .slice(0, maxTiles);
}
