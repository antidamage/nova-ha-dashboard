// Sole owner of the notification file: path, write queue and reads/writes.
// Notifications are small and short-lived, so the whole list is rewritten on
// every change (same atomic temp-file rename as the task store).
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { publishNotification, publishNotificationDismiss } from "../dashboard-events";
import { activeNotifications, notificationFromInput } from "./model";
import type { DashboardNotification, NotificationFile } from "./types";

export const NOTIFICATIONS_PATH =
  process.env.NOVA_DASHBOARD_NOTIFICATIONS ?? path.join(process.cwd(), "data", "dashboard-notifications.json");

let writeQueue = Promise.resolve();

async function readFileList(): Promise<DashboardNotification[]> {
  try {
    const data = JSON.parse(await readFile(NOTIFICATIONS_PATH, "utf8")) as NotificationFile;
    return Array.isArray(data.notifications) ? data.notifications : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return [];
    throw error;
  }
}

async function writeFileList(list: DashboardNotification[]): Promise<void> {
  await mkdir(path.dirname(NOTIFICATIONS_PATH), { recursive: true });
  const tempPath = `${NOTIFICATIONS_PATH}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify({ notifications: list }, null, 2)}\n`, "utf8");
  await rename(tempPath, NOTIFICATIONS_PATH);
}

async function mutate<T>(
  mutator: (list: DashboardNotification[]) => { list: DashboardNotification[]; result: T },
): Promise<T> {
  let result!: T;
  const run = writeQueue.then(async () => {
    const mutation = mutator(activeNotifications(await readFileList()));
    result = mutation.result;
    await writeFileList(mutation.list);
  });
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  await run;
  return result;
}

export async function readNotifications(): Promise<DashboardNotification[]> {
  await writeQueue;
  return activeNotifications(await readFileList());
}

export async function createNotification(
  input: unknown,
): Promise<{ ok: true; notification: DashboardNotification } | { ok: false; error: string }> {
  const parsed = notificationFromInput(input);
  if (!parsed.ok) return parsed;
  const evicted = await mutate((list) => {
    const next = activeNotifications([...list, parsed.notification]);
    return { list: next, result: list.filter((entry) => !next.some((kept) => kept.id === entry.id)) };
  });
  publishNotification(parsed.notification);
  for (const entry of evicted) publishNotificationDismiss(entry.id);
  return parsed;
}

export async function dismissNotification(id: string): Promise<boolean> {
  const removed = await mutate((list) => {
    const next = list.filter((entry) => entry.id !== id);
    return { list: next, result: next.length !== list.length };
  });
  if (removed) publishNotificationDismiss(id);
  return removed;
}

export async function dismissAllNotifications(): Promise<string[]> {
  const ids = await mutate((list) => ({ list: [], result: list.map((entry) => entry.id) }));
  for (const id of ids) publishNotificationDismiss(id);
  return ids;
}
