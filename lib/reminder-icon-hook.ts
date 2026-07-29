// Fire-and-forget bridge from task writes to sigil assignment.
//
// Exists as its own module for two reasons. First, it keeps lib/tasks.ts from
// statically depending on lib/reminder-icons.ts, which pulls in the dashboard
// config reader and the iridium client — tasks.ts is loaded by the SSE layer
// and should stay cheap. Second, it makes the "never block, never throw"
// contract a single obvious place rather than a `void`+`catch` repeated at
// every call site.

import { normalizeReminderKey } from "./reminder-glyph";
import type { Task } from "./types";

export function assignReminderIcons(tasks: Pick<Task, "name" | "repeat" | "source" | "recurs">[]) {
  if (!tasks.length) {
    return;
  }

  void (async () => {
    try {
      const { ensureReminderIcons } = await import("./reminder-icons");
      await ensureReminderIcons(tasks);
    } catch (error) {
      console.error("[nova-dashboard] Reminder icon assignment failed", { error });
    }
  })();
}

/**
 * Reconcile the persisted roster against an authoritative task snapshot.
 *
 * `writeTasks` (iCloud replacement) and deletions are the only paths that
 * know the complete live set. Pruning there prevents removed reminders from
 * accumulating in the roster, while the UI still independently guards
 * against a stale entry during the short SSE ordering window.
 */
export function reconcileReminderIcons(tasks: Pick<Task, "name" | "repeat" | "source" | "recurs">[]) {
  void (async () => {
    try {
      const { ensureReminderIcons, pruneReminderIcons } = await import("./reminder-icons");
      await ensureReminderIcons(tasks);
      await pruneReminderIcons(
        new Set(
          tasks
            .map((task) => normalizeReminderKey(task.name ?? ""))
            .filter(Boolean),
        ),
      );
    } catch (error) {
      console.error("[nova-dashboard] Reminder icon reconciliation failed", { error });
    }
  })();
}
