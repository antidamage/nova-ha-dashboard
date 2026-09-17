// Turns CalDAV objects (VEVENT and VTODO) into read-only mirror tasks.
import { createHash } from "crypto";
import ICAL from "ical.js";
import type { DAVCalendar, DAVObject } from "tsdav";
import type { Task, TaskSource } from "../types";
import { DEFAULT_DATE_ONLY_REMINDER_HOUR, DEFAULT_REMINDER_DURATION_MS } from "./constants";
import { normalizedTaskName } from "./mirror-model";
import {
  dateKeyFromDate,
  nextRecurringDate,
  occurrenceDateFromTime,
  withinWindow,
  zonedDateToUtcDate,
} from "./time-model";
import type { IcalComponent, IcalTime } from "./types";

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

function taskIdFor(source: TaskSource, sourceId: string, occurrenceDate: string) {
  const hash = createHash("sha1").update(`${source}|${sourceId}|${occurrenceDate}`).digest("hex").slice(0, 20);
  return `${source}-${hash}`;
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

export function shouldSkipIcloudTodoTask(task: Task) {
  const normalizedName = normalizedTaskName(task.name);
  return normalizedName === "the creator of this list has upgraded these reminders."
    || normalizedName === "where are my reminders?";
}

export function tasksFromCalendarObject(
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
