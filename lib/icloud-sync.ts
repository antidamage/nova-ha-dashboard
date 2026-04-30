import { createHash } from "crypto";
import ICAL from "ical.js";
import { createDAVClient, type DAVCalendar, type DAVObject } from "tsdav";
import { publishDashboardError } from "./dashboard-events";
import { isIcloudEnabled, logIcloudDisabledOnce, readIcloudConfig } from "./icloud-config";
import { readTasks, writeTasks } from "./tasks";
import type { Task, TaskSource } from "./types";

export type IcloudSyncResult = {
  added: number;
  updated: number;
  removed: number;
};

export type IcloudSyncStatus = {
  enabled: boolean;
  lastSyncAt?: string;
  lastError?: string;
  calendars: string[];
  reminders: string[];
  authBackoffUntil?: string;
};

type IcalTime = InstanceType<typeof ICAL.Time>;
type IcalComponent = InstanceType<typeof ICAL.Component>;

type IcloudSyncStore = {
  status: IcloudSyncStatus;
  syncing: boolean;
};

const ICLOUD_CALDAV_URL = "https://caldav.icloud.com";
const DEFAULT_REMINDER_DURATION_MS = 30 * 60 * 1000;
const AUTH_BACKOFF_MS = 60 * 60 * 1000;

const globalWithIcloudSync = globalThis as typeof globalThis & {
  __novaIcloudSync?: IcloudSyncStore;
};

const store =
  globalWithIcloudSync.__novaIcloudSync ??
  (globalWithIcloudSync.__novaIcloudSync = {
    status: {
      enabled: isIcloudEnabled(),
      calendars: [],
      reminders: [],
    },
    syncing: false,
  });

function displayName(calendar: DAVCalendar) {
  if (typeof calendar.displayName === "string" && calendar.displayName.trim()) {
    return calendar.displayName.trim();
  }

  return calendar.url.replace(/\/$/, "").split("/").pop() || calendar.url;
}

function allowedByName(name: string, allowList: string[]) {
  return !allowList.length || allowList.includes(name);
}

function supportsComponent(calendar: DAVCalendar, component: "VEVENT" | "VTODO") {
  if (!calendar.components?.length) {
    return true;
  }

  return calendar.components.some((candidate) => candidate.toUpperCase() === component);
}

function objectData(object: DAVObject) {
  if (typeof object.data === "string") {
    return object.data;
  }
  if (object.data && typeof object.data.toString === "function") {
    return object.data.toString();
  }
  return "";
}

function isIcalTime(value: unknown): value is IcalTime {
  return Boolean(value && typeof value === "object" && typeof (value as { toJSDate?: unknown }).toJSDate === "function");
}

function propertyText(component: IcalComponent, name: string) {
  const value = component.getFirstPropertyValue(name);
  return typeof value === "string" ? value.trim() : "";
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function occurrenceDateFromTime(time: IcalTime) {
  return `${time.year}-${pad(time.month)}-${pad(time.day)}`;
}

function taskIdFor(source: TaskSource, sourceId: string, occurrenceDate: string) {
  const hash = createHash("sha1").update(`${source}|${sourceId}|${occurrenceDate}`).digest("hex").slice(0, 20);
  return `${source}-${hash}`;
}

function withinWindow(start: Date, end: Date, windowStart: Date, windowEnd: Date) {
  return start.getTime() < windowEnd.getTime() && end.getTime() > windowStart.getTime();
}

function eventTask(
  event: InstanceType<typeof ICAL.Event>,
  sourceId: string,
  sourceCalendar: string,
  startTime: IcalTime,
  endTime: IcalTime,
  windowStart: Date,
  windowEnd: Date,
): Task | null {
  if (startTime.isDate || endTime.isDate) {
    return null;
  }

  const start = startTime.toJSDate();
  const end = endTime.toJSDate();
  if (end.getTime() <= start.getTime() || !withinWindow(start, end, windowStart, windowEnd)) {
    return null;
  }

  const occurrenceDate = occurrenceDateFromTime(startTime);

  return {
    id: taskIdFor("icloud-calendar", sourceId, occurrenceDate),
    name: event.summary?.trim() || "Untitled event",
    start: start.toISOString(),
    end: end.toISOString(),
    createdAt: new Date().toISOString(),
    source: "icloud-calendar",
    sourceId,
    sourceCalendar,
    occurrenceDate,
    readOnly: true,
  };
}

function tasksFromEventComponent(
  component: IcalComponent,
  fallbackSourceId: string,
  sourceCalendar: string,
  windowStart: Date,
  windowEnd: Date,
) {
  const event = new ICAL.Event(component);
  if (event.isRecurrenceException()) {
    return [];
  }

  const sourceId = event.uid || fallbackSourceId;
  if (!event.isRecurring()) {
    const task = eventTask(event, sourceId, sourceCalendar, event.startDate, event.endDate, windowStart, windowEnd);
    return task ? [task] : [];
  }

  const tasks: Task[] = [];
  const iterator = event.iterator(ICAL.Time.fromJSDate(windowStart, true));
  let occurrence = iterator.next();
  let safety = 0;

  while (occurrence && safety < 1000) {
    safety += 1;
    const details = event.getOccurrenceDetails(occurrence) as { startDate: IcalTime; endDate: IcalTime };
    const startDate = details.startDate.toJSDate();

    if (startDate.getTime() >= windowEnd.getTime()) {
      break;
    }

    const task = eventTask(event, sourceId, sourceCalendar, details.startDate, details.endDate, windowStart, windowEnd);
    if (task) {
      tasks.push(task);
    }

    occurrence = iterator.next();
  }

  return tasks;
}

function taskFromTodoComponent(
  component: IcalComponent,
  fallbackSourceId: string,
  sourceCalendar: string,
  windowStart: Date,
  windowEnd: Date,
) {
  const status = propertyText(component, "status").toUpperCase();
  if (status === "COMPLETED") {
    return null;
  }

  const dueValue = component.getFirstPropertyValue("due");
  if (!isIcalTime(dueValue) || dueValue.isDate) {
    return null;
  }

  const dtStartValue = component.getFirstPropertyValue("dtstart");
  const start = isIcalTime(dtStartValue) && !dtStartValue.isDate ? dtStartValue.toJSDate() : dueValue.toJSDate();
  const end = isIcalTime(dtStartValue) && !dtStartValue.isDate
    ? dueValue.toJSDate()
    : new Date(start.getTime() + DEFAULT_REMINDER_DURATION_MS);

  if (end.getTime() <= start.getTime() || !withinWindow(start, end, windowStart, windowEnd)) {
    return null;
  }

  const sourceId = propertyText(component, "uid") || fallbackSourceId;
  const occurrenceDate = occurrenceDateFromTime(dueValue);

  return {
    id: taskIdFor("icloud-reminders", sourceId, occurrenceDate),
    name: propertyText(component, "summary") || "Untitled reminder",
    start: start.toISOString(),
    end: end.toISOString(),
    createdAt: new Date().toISOString(),
    source: "icloud-reminders",
    sourceId,
    sourceCalendar,
    occurrenceDate,
    readOnly: true,
  } satisfies Task;
}

function tasksFromCalendarObject(
  object: DAVObject,
  calendar: DAVCalendar,
  sourceCalendar: string,
  windowStart: Date,
  windowEnd: Date,
) {
  const data = objectData(object);
  if (!data.trim()) {
    return [];
  }

  const component = ICAL.Component.fromString(data);
  const fallbackSourceId = object.url || `${calendar.url}:${createHash("sha1").update(data).digest("hex").slice(0, 12)}`;
  const eventTasks = component
    .getAllSubcomponents("vevent")
    .flatMap((eventComponent) =>
      tasksFromEventComponent(eventComponent, fallbackSourceId, sourceCalendar, windowStart, windowEnd),
    );
  const todoTasks = component
    .getAllSubcomponents("vtodo")
    .flatMap((todoComponent) => {
      const task = taskFromTodoComponent(todoComponent, fallbackSourceId, sourceCalendar, windowStart, windowEnd);
      return task ? [task] : [];
    });

  return [...eventTasks, ...todoTasks];
}

function mirrorKey(task: Task) {
  return `${task.source}|${task.sourceId ?? task.id}|${task.occurrenceDate ?? task.start.slice(0, 10)}`;
}

function taskChanged(left: Task, right: Task) {
  return left.name !== right.name || left.start !== right.start || left.end !== right.end || left.sourceCalendar !== right.sourceCalendar;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "iCloud sync failed";
}

function isAuthFailure(error: unknown) {
  const text = errorMessage(error).toLowerCase();
  return text.includes("401") || text.includes("403") || text.includes("unauthorized") || text.includes("forbidden");
}

function setStatus(next: Partial<IcloudSyncStatus>) {
  store.status = {
    ...store.status,
    ...next,
  };
}

export function getIcloudSyncStatus(): IcloudSyncStatus {
  const config = readIcloudConfig();
  if (!config.enabled) {
    setStatus({
      enabled: false,
      authBackoffUntil: undefined,
      lastError: undefined,
    });
  } else {
    setStatus({ enabled: true });
  }

  return { ...store.status };
}

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
    return { added: 0, updated: 0, removed: 0 };
  }

  if (store.syncing) {
    return { added: 0, updated: 0, removed: 0 };
  }

  store.syncing = true;
  setStatus({ enabled: true });

  try {
    const windowStart = new Date();
    const windowEnd = new Date(windowStart.getTime() + config.syncDays * 24 * 60 * 60 * 1000);
    const client = await createDAVClient({
      serverUrl: ICLOUD_CALDAV_URL,
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

    for (const calendar of [...eventCalendars, ...reminderCalendars]) {
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
        for (const task of tasksFromCalendarObject(object, calendar, name, windowStart, windowEnd)) {
          candidatesByKey.set(mirrorKey(task), task);
        }
      }
    }

    const current = await readTasks();
    const localTasks = current.filter((task) => task.source === "local");
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
        });
        continue;
      }

      nextMirroredTasks.push({
        ...candidate,
        createdAt: existing.createdAt,
        dismissedAt: existing.dismissedAt,
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

    return { added, updated, removed };
  } catch (error) {
    const message = errorMessage(error);
    const authFailure = isAuthFailure(error);
    const authBackoffUntil = authFailure ? new Date(Date.now() + AUTH_BACKOFF_MS).toISOString() : undefined;
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
