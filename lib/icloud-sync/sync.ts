// The sync pass: fetch from CalDAV, rebuild the mirrored tasks, record status.
// The only file in the package importing lib/dashboard-events or lib/tasks, so
// the existing dashboard-events > icloud-sync > tasks cycles keep one edge each.
import { createDAVClient } from "tsdav";
import { publishDashboardError } from "../dashboard-events";
import { isIcloudEnabled, logIcloudDisabledOnce, readIcloudConfig } from "../icloud-config";
import { readTasks, writeTasks } from "../tasks";
import type { Task } from "../types";
import { TODO_FILTERS } from "./constants";
import { shouldSkipIcloudTodoTask, tasksFromCalendarObject } from "./ical-model";
import {
  allowedByName,
  displayName,
  errorMessage,
  isAuthFailure,
  localTaskMatchesReminder,
  mirrorKey,
  supportsComponent,
  taskChanged,
} from "./mirror-model";
import { setStatus, store } from "./store";
import type { IcloudSyncResult } from "./types";

export async function syncIcloud(): Promise<IcloudSyncResult> {
  const config = readIcloudConfig();
  if (!isIcloudEnabled(config)) {
    logIcloudDisabledOnce();
    setStatus({
      enabled: false,
      calendars: [],
      reminders: [],
      authBackoffUntil: undefined,
      lastError: undefined,
    });
    return { added: 0, linkedLocal: 0, updated: 0, removed: 0 };
  }

  if (store.syncing) {
    return { added: 0, linkedLocal: 0, updated: 0, removed: 0 };
  }

  store.syncing = true;
  setStatus({ enabled: true });

  try {
    const windowStart = new Date();
    const windowEnd = new Date(windowStart.getTime() + config.syncDays * 24 * 60 * 60 * 1000);
    const client = await createDAVClient({
      serverUrl: config.caldavUrl,
      credentials: {
        username: config.username ?? undefined,
        password: config.appPassword ?? undefined,
      },
      authMethod: "Basic",
      defaultAccountType: "caldav",
    });
    const calendars = await client.fetchCalendars();
    const eventCalendars = calendars.filter((calendar) => {
      const name = displayName(calendar);
      return supportsComponent(calendar, "VEVENT") && allowedByName(name, config.calendars);
    });
    const reminderCalendars = calendars.filter((calendar) => {
      const name = displayName(calendar);
      return supportsComponent(calendar, "VTODO") && allowedByName(name, config.reminders);
    });
    const candidatesByKey = new Map<string, Task>();

    for (const calendar of eventCalendars) {
      const name = displayName(calendar);
      const objects = await client.fetchCalendarObjects({
        calendar,
        timeRange: {
          start: windowStart.toISOString(),
          end: windowEnd.toISOString(),
        },
        expand: true,
      });

      for (const object of objects) {
        for (const task of tasksFromCalendarObject(
          object,
          calendar,
          name,
          windowStart,
          windowEnd,
          config.defaultReminderDurationMs,
        )) {
          candidatesByKey.set(mirrorKey(task), task);
        }
      }
    }

    for (const calendar of reminderCalendars) {
      const name = displayName(calendar);
      const objects = await client.fetchCalendarObjects({
        calendar,
        filters: TODO_FILTERS,
      });

      for (const object of objects) {
        for (const task of tasksFromCalendarObject(
          object,
          calendar,
          name,
          windowStart,
          windowEnd,
          config.defaultReminderDurationMs,
        )) {
          if (!shouldSkipIcloudTodoTask(task)) {
            candidatesByKey.set(mirrorKey(task), task);
          }
        }
      }
    }

    const current = await readTasks();
    const reminderCandidates = [...candidatesByKey.values()].filter((task) => task.source === "icloud-reminders");
    const localTasks = current.filter((task) =>
      task.source === "local" && !reminderCandidates.some((candidate) => localTaskMatchesReminder(task, candidate)),
    );
    const linkedLocal = current.filter((task) => task.source === "local").length - localTasks.length;
    const mirroredTasks = current.filter((task) => task.source !== "local");
    const mirroredByKey = new Map(mirroredTasks.map((task) => [mirrorKey(task), task]));
    const nextMirroredTasks: Task[] = [];
    let added = 0;
    let updated = 0;

    for (const [key, candidate] of candidatesByKey) {
      const existing = mirroredByKey.get(key);
      if (!existing) {
        added += 1;
        nextMirroredTasks.push(candidate);
        continue;
      }

      if (taskChanged(existing, candidate)) {
        updated += 1;
        nextMirroredTasks.push({
          ...candidate,
          createdAt: existing.createdAt,
          // Dashboard-local state, not upstream state: an edit in iCloud must
          // not silently turn off a module's per-reminder settings.
          moduleData: existing.moduleData,
        });
        continue;
      }

      nextMirroredTasks.push({
        ...candidate,
        createdAt: existing.createdAt,
        dismissedAt: existing.dismissedAt,
        alertDismissedAt: existing.alertDismissedAt,
        alertDismissedFor: existing.alertDismissedFor,
        alertChimedFor: existing.alertChimedFor,
        annoy: existing.annoy,
        moduleData: existing.moduleData,
      });
    }

    const removed = mirroredTasks.filter((task) => !candidatesByKey.has(mirrorKey(task))).length;
    await writeTasks([...localTasks, ...nextMirroredTasks]);
    const calendarNames = eventCalendars.map(displayName);
    const reminderNames = reminderCalendars.map(displayName);

    setStatus({
      enabled: true,
      lastSyncAt: new Date().toISOString(),
      lastError: undefined,
      authBackoffUntil: undefined,
      calendars: calendarNames,
      reminders: reminderNames,
    });

    return { added, linkedLocal, updated, removed };
  } catch (error) {
    const message = errorMessage(error);
    const authFailure = isAuthFailure(error);
    const authBackoffUntil = authFailure ? new Date(Date.now() + config.authBackoffMs).toISOString() : undefined;
    setStatus({
      enabled: true,
      lastError: message,
      authBackoffUntil,
    });

    if (authFailure) {
      publishDashboardError("iCloud authentication failed. Check the app-specific password.");
    }

    throw error;
  } finally {
    store.syncing = false;
  }
}
