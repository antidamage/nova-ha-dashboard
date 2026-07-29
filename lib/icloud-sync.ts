import { createHash } from "crypto";
import ICAL from "ical.js";
import { createDAVClient, type DAVCalendar, type DAVObject } from "tsdav";
import { publishDashboardError } from "./dashboard-events";
import { isIcloudEnabled, logIcloudDisabledOnce, readIcloudConfig } from "./icloud-config";
import { readTasks, writeTasks } from "./tasks";
import type { Task, TaskSource } from "./types";

export type IcloudSyncResult = {
  added: number;
  linkedLocal: number;
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
const DEFAULT_DATE_ONLY_REMINDER_HOUR = 9;
const TODO_FILTERS = [
  {
    "comp-filter": {
      _attributes: {
        name: "VCALENDAR",
      },
      "comp-filter": {
        _attributes: {
          name: "VTODO",
        },
      },
    },
  },
] as const;

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
  if (allowList.some((item) => ["__none__", "none"].includes(item.trim().toLowerCase()))) {
    return false;
  }
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

function zonedDateToUtcDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone = "Pacific/Auckland",
) {
  let utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  const targetUtcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const formatter = new Intl.DateTimeFormat("en-NZ", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone,
    year: "numeric",
  });

  for (let index = 0; index < 3; index += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(utcDate).map((part) => [part.type, part.value]));
    const actualUtcMs = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
      0,
    );
    const nextUtcDate = new Date(utcDate.getTime() + (targetUtcMs - actualUtcMs));
    if (Math.abs(nextUtcDate.getTime() - utcDate.getTime()) < 1000) {
      return nextUtcDate;
    }
    utcDate = nextUtcDate;
  }

  return utcDate;
}

function taskIdFor(source: TaskSource, sourceId: string, occurrenceDate: string) {
  const hash = createHash("sha1").update(`${source}|${sourceId}|${occurrenceDate}`).digest("hex").slice(0, 20);
  return `${source}-${hash}`;
}

function withinWindow(start: Date, end: Date, windowStart: Date, windowEnd: Date) {
  return start.getTime() < windowEnd.getTime() && end.getTime() > windowStart.getTime();
}

function addMonthsPreservingDay(date: Date, months: number) {
  const next = new Date(date);
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}

function nextRecurringDate(start: Date, ruleValue: unknown, windowStart: Date) {
  const rule = String(ruleValue ?? "");
  if (!rule || start.getTime() >= windowStart.getTime()) {
    return start;
  }

  const parts = Object.fromEntries(rule.split(";").map((part) => {
    const [key, value] = part.split("=");
    return [key?.toUpperCase(), value?.toUpperCase()];
  }));
  const interval = Math.max(1, Math.round(Number(parts.INTERVAL ?? 1)) || 1);
  let next = new Date(start);
  let safety = 0;

  while (next.getTime() < windowStart.getTime() && safety < 2000) {
    safety += 1;
    if (parts.FREQ === "DAILY") {
      next = new Date(next.getTime() + interval * 24 * 60 * 60 * 1000);
    } else if (parts.FREQ === "WEEKLY") {
      next = new Date(next.getTime() + interval * 7 * 24 * 60 * 60 * 1000);
    } else if (parts.FREQ === "MONTHLY") {
      next = addMonthsPreservingDay(next, interval);
    } else if (parts.FREQ === "YEARLY") {
      next = addMonthsPreservingDay(next, interval * 12);
    } else {
      return start;
    }
  }

  return next;
}

function dateKeyFromDate(date: Date) {
  return date.toISOString().slice(0, 10);
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
  defaultReminderDurationMs = DEFAULT_REMINDER_DURATION_MS,
) {
  const status = propertyText(component, "status").toUpperCase();
  if (status === "COMPLETED") {
    return null;
  }

  const dueValue = component.getFirstPropertyValue("due");
  if (!isIcalTime(dueValue)) {
    return null;
  }

  const dtStartValue = component.getFirstPropertyValue("dtstart");
  const rawStart = isIcalTime(dtStartValue) && !dtStartValue.isDate
    ? dtStartValue.toJSDate()
    : dueValue.isDate
      ? zonedDateToUtcDate(dueValue.year, dueValue.month, dueValue.day, DEFAULT_DATE_ONLY_REMINDER_HOUR, 0)
      : dueValue.toJSDate();
  const rawEnd = isIcalTime(dtStartValue) && !dtStartValue.isDate && dueValue.toJSDate().getTime() > rawStart.getTime()
    ? dueValue.toJSDate()
    : new Date(rawStart.getTime() + defaultReminderDurationMs);
  const rrule = component.getFirstPropertyValue("rrule");
  const recurringStart = nextRecurringDate(rawStart, rrule, windowStart);
  const durationMs = rawEnd.getTime() - rawStart.getTime();
  const start = recurringStart;
  const end = new Date(start.getTime() + durationMs);

  if (end.getTime() <= start.getTime() || !withinWindow(start, end, windowStart, windowEnd)) {
    return null;
  }

  const sourceId = propertyText(component, "uid") || fallbackSourceId;
  const occurrenceDate = start.getTime() === rawStart.getTime() ? occurrenceDateFromTime(dueValue) : dateKeyFromDate(start);

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
    recurs: Boolean(rrule),
  } satisfies Task;
}

function shouldSkipIcloudTodoTask(task: Task) {
  const normalizedName = normalizedTaskName(task.name);
  return normalizedName === "the creator of this list has upgraded these reminders."
    || normalizedName === "where are my reminders?";
}

function tasksFromCalendarObject(
  object: DAVObject,
  calendar: DAVCalendar,
  sourceCalendar: string,
  windowStart: Date,
  windowEnd: Date,
  defaultReminderDurationMs = DEFAULT_REMINDER_DURATION_MS,
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
      const task = taskFromTodoComponent(
        todoComponent,
        fallbackSourceId,
        sourceCalendar,
        windowStart,
        windowEnd,
        defaultReminderDurationMs,
      );
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

function normalizedTaskName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function localDateKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10);
  }

  const parts = new Intl.DateTimeFormat("en-NZ", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Pacific/Auckland",
    year: "numeric",
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function localTaskMatchesReminder(localTask: Task, reminderTask: Task) {
  if (localTask.source !== "local" || reminderTask.source !== "icloud-reminders") {
    return false;
  }
  if (normalizedTaskName(localTask.name) !== normalizedTaskName(reminderTask.name)) {
    return false;
  }
  if (localTask.repeat) {
    return true;
  }
  return localDateKey(localTask.start) === localDateKey(reminderTask.start);
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
