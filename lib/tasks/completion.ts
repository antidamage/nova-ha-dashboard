// Chime bookkeeping and undoing a completion. completeTask and dismissTaskAlert
// are in store.ts (see the note there).
import { emitModuleEvent } from "../modules/runtime/hooks";
import type { Task } from "../types";
import { alertSessionKey } from "./schedule-model";
import { mutateTasks, pruneUndoJournal, undoJournal } from "./store";

/**
 * Record that this occurrence's chime has been played, so no other screen and
 * no later page load plays it again.
 *
 * Separate from `dismissTaskAlert` because the two are genuinely different
 * events: the banner may still be up, waiting to be tapped, long after the
 * sound has had its say. Idempotent -- concurrent screens racing to claim the
 * same occurrence all converge on the same key.
 */
export async function markTaskAlertChimed(id: string): Promise<Task> {
  return mutateTasks((tasks) => {
    const index = tasks.findIndex((candidate) => candidate.id === id);
    if (index < 0) {
      throw new Error("Reminder not found");
    }

    const current = tasks[index];
    const chimed: Task = { ...current, alertChimedFor: alertSessionKey(current) };

    return {
      tasks: tasks.map((candidate) => (candidate.id === id ? chimed : candidate)),
      result: chimed,
    };
  });
}

/**
 * Restore the pre-completion snapshot recorded by `completeTask`.
 *
 * Caveat worth knowing: a repeating task that HAS an end rolls itself forward
 * whenever it lapses, independently of completion, so restoring one will
 * simply roll forward again on the next read. Undo is meaningful for the
 * reminders it is actually offered on — end-less reminders and iCloud mirrors,
 * neither of which self-roll.
 */
export async function uncompleteTask(id: string, windowMs: number): Promise<Task> {
  const nowMs = Date.now();
  pruneUndoJournal(nowMs, windowMs);

  const record = undoJournal.get(id);
  if (!record) {
    throw new Error("That completion can no longer be undone");
  }

  const restored = await mutateTasks((tasks) => {
    const exists = tasks.some((candidate) => candidate.id === id);
    const followersById = new Map(record.followers.map((follower) => [follower.id, follower]));

    // The task is normally still present (completion mutates in place), but
    // a concurrent delete or an iCloud resync could have removed it; putting
    // the snapshot back is the honest interpretation of "undo" either way.
    const withRestoredFollowers = tasks.map((candidate) => followersById.get(candidate.id) ?? candidate);

    return {
      tasks: exists
        ? withRestoredFollowers.map((candidate) => (candidate.id === id ? record.task : candidate))
        : [...withRestoredFollowers, record.task],
      result: record.task,
    };
  });

  undoJournal.delete(id);
  emitModuleEvent({
    id: "reminder.uncompleted",
    at: new Date().toISOString(),
    source: "server",
    task: { id, name: restored.name, moduleData: restored.moduleData },
  });
  return restored;
}
