// Reading the viewer from config and a request, and the checks the routes share
// (specs/private-reminders.md, sections 3 to 5).
import { readDashboardConfig } from "../dashboard-config";
import { homeUsers } from "../home-users/model";
import type { Task } from "../types";
import { canActOnTask, canSeeTask, canWriteTask, effectiveOwner, type Viewer } from "./ownership";
import { readTaskFile } from "./store";
import { resolveViewer, viewerInputsFrom } from "./viewer";

export type TaskAccess = { viewer: Viewer; legacyOwner: string; userIds: ReadonlySet<string> };

export class TaskAccessError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function readAccessFromHeaders(headers: Headers): Promise<TaskAccess> {
  const config = await readDashboardConfig();
  const userIds = new Set(homeUsers(config.dashboard.people).map((person) => person.id));
  const reminders = config.dashboard.reminders;
  const viewer = resolveViewer(viewerInputsFrom(headers), { userIds, clientViewers: reminders.clientViewers });
  return { viewer, legacyOwner: reminders.legacyOwner, userIds };
}

export function readAccess(request: Request): Promise<TaskAccess> {
  return readAccessFromHeaders(request.headers);
}

/** 404 for anything the viewer cannot write, the same as a missing id, so existence is not revealed. */
export async function requireWritableTasks(access: TaskAccess, ids: string[]): Promise<Task[]> {
  return requireTasks(access, ids, canWriteTask);
}

async function requireTasks(
  access: TaskAccess,
  ids: string[],
  allowed: (task: Task, viewer: Viewer, legacyOwner: string) => boolean,
): Promise<Task[]> {
  const all = await readTaskFile();
  return ids.map((id) => {
    const task = all.find((candidate) => candidate.id === id);
    if (!task || !allowed(task, access.viewer, access.legacyOwner)) {
      throw new TaskAccessError(404, "not-found", "Reminder not found");
    }
    return task;
  });
}

/** For complete, uncomplete, dismiss and chimed: what the viewer can act on (see `canActOnTask`). */
export async function requireActionableTask(request: Request, id: string): Promise<TaskAccess> {
  const access = await readAccess(request);
  await requireTasks(access, [id], canActOnTask);
  return access;
}

/** A reminder may only follow an anchor the viewer can write; anything else is a 404, like a missing id. */
export async function requireFollowsAnchor(access: TaskAccess, follows: unknown): Promise<void> {
  if (!follows || typeof follows !== "object") return;
  const taskId = (follows as { taskId?: unknown }).taskId;
  if (typeof taskId !== "string" || !taskId) return;
  await requireWritableTasks(access, [taskId]);
}

/** The fields a new reminder carries for its viewer. Throws the refusals in section 5. */
export function ownershipForNewTask(
  access: TaskAccess,
  body: { owner?: unknown; household?: unknown },
): { owner?: string; household?: boolean } {
  const household = body.household === true ? true : undefined;
  const { viewer } = access;
  if (viewer.kind === "user") return { owner: viewer.id, household };
  if (viewer.kind === "household") {
    throw new TaskAccessError(403, "choose-a-user", "Choose who you are to add reminders");
  }
  const owner = typeof body.owner === "string" ? body.owner.trim() : "";
  if (owner) {
    if (!access.userIds.has(owner)) throw new TaskAccessError(400, "owner-unknown", "That owner is not a home user");
    return { owner, household };
  }
  if (household) return { household };
  throw new TaskAccessError(400, "owner-required", "Say who this reminder is for (owner), or mark it household");
}

/** What a patch may change: `household` for anyone who can write it, `owner` for system only. */
export function accessPatchFor(access: TaskAccess, body: Record<string, unknown>): { owner?: string; household?: boolean } {
  const patch: { owner?: string; household?: boolean } = {};
  if (Object.prototype.hasOwnProperty.call(body, "household")) patch.household = body.household === true;
  if (access.viewer.kind === "system" && typeof body.owner === "string" && access.userIds.has(body.owner)) {
    patch.owner = body.owner;
  }
  return patch;
}

export function filterVisible(tasks: Task[], access: TaskAccess): Task[] {
  return access.viewer.kind === "system"
    ? tasks
    : tasks.filter((task) => canSeeTask(task, access.viewer, access.legacyOwner));
}

export { canSeeTask, effectiveOwner };

/** Turn a TaskAccessError into its status, anything else into the caller's fallback. */
export function accessStatus(error: unknown, fallback = 400): number {
  return error instanceof TaskAccessError ? error.status : fallback;
}