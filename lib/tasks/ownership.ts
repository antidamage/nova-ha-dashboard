// Who may see and write a reminder (specs/private-reminders.md, sections 3 and 5).
// The two rules, and nothing else, so every route and stream asks the same thing.
import { normalizeReminderKey } from "../reminder-glyph";
import type { Task } from "../types";
import { washReminder } from "../wash-reminder";

/**
 * Who is asking. `system` is an agent, script or server (it sees everything);
 * `household` is a device with no chosen user or on the everyone view; `user` is
 * a device set to one home user. Self-declared, not authenticated (spec section 1).
 */
export type Viewer = { kind: "system" } | { kind: "household" } | { kind: "user"; id: string };

export const SYSTEM_VIEWER: Viewer = { kind: "system" };
export const HOUSEHOLD_VIEWER: Viewer = { kind: "household" };

/** Visible to everyone: ticked Household, or a washing reminder (by rule). */
export function isHouseholdTask(task: Pick<Task, "household" | "moduleData">): boolean {
  return task.household === true || Boolean(washReminder(task as Task));
}

/**
 * The owner a reminder is read as. A legacy reminder (no owner, not household)
 * is read as `legacyOwner` when one is configured, so nobody else sees it before
 * it is moved; with none configured it has no owner and only system sees it.
 */
export function effectiveOwner(task: Task, legacyOwner = ""): string | null {
  if (task.owner) return task.owner;
  if (isHouseholdTask(task)) return null;
  return legacyOwner || null;
}

export function canSeeTask(task: Task, viewer: Viewer, legacyOwner = ""): boolean {
  if (viewer.kind === "system") return true;
  if (isHouseholdTask(task)) return true;
  if (viewer.kind === "household") return false;
  return effectiveOwner(task, legacyOwner) === viewer.id;
}

/** Editing or deleting follows seeing: a household reminder is writable by any user, a private one by its owner. The household view edits nothing. */
export function canWriteTask(task: Task, viewer: Viewer, legacyOwner = ""): boolean {
  if (viewer.kind === "household") return false;
  return canSeeTask(task, viewer, legacyOwner);
}

/**
 * Completing, dismissing and claiming the chime of a reminder it can see. The
 * household view may do this for the household and washing reminders it is shown
 * (a wash-done alert must be dismissable on a device with no chosen user), but
 * never edits or deletes them, and never touches a private one.
 */
export function canActOnTask(task: Task, viewer: Viewer, legacyOwner = ""): boolean {
  if (viewer.kind === "household") return isHouseholdTask(task);
  return canSeeTask(task, viewer, legacyOwner);
}

export function visibleTasks(tasks: Task[], viewer: Viewer, legacyOwner = ""): Task[] {
  return viewer.kind === "system" ? tasks : tasks.filter((task) => canSeeTask(task, viewer, legacyOwner));
}

/**
 * The icon roster is keyed on the reminder name, so a viewer gets only the entries
 * whose name matches a reminder they can see: another user's names are never sent.
 */
export function visibleRosterEntries<T extends { key: string }>(
  entries: T[],
  tasks: Task[],
  viewer: Viewer,
  legacyOwner = "",
): T[] {
  if (viewer.kind === "system") return entries;
  const keys = new Set(visibleTasks(tasks, viewer, legacyOwner).map((task) => normalizeReminderKey(task.name ?? "")));
  return entries.filter((entry) => keys.has(entry.key));
}

/** A cache key for per-viewer stream payloads. */
export function viewerKey(viewer: Viewer): string {
  return viewer.kind === "user" ? `user:${viewer.id}` : viewer.kind;
}