import type { Task, TaskRepeat } from "./types";

export type ParseTaskCsvError = {
  line: number;
  message: string;
};

export type ParseTaskCsvResult = {
  tasks: Task[];
  errors: ParseTaskCsvError[];
};

const TIME_ONLY_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function randomTaskId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function localDateForTime(referenceDate: Date, value: string) {
  const match = TIME_ONLY_PATTERN.exec(value.trim());
  if (!match) {
    return null;
  }

  return new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
    Number(match[1]),
    Number(match[2]),
    0,
    0,
  );
}

function parsedDate(value: string, referenceDate: Date) {
  const timeOnly = localDateForTime(referenceDate, value);
  if (timeOnly) {
    return { date: timeOnly, timeOnly: true };
  }

  const date = new Date(value.trim());
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return { date, timeOnly: false };
}

function splitTaskCsvLine(line: string) {
  const firstComma = line.indexOf(",");
  if (firstComma < 0) {
    return null;
  }

  const secondComma = line.indexOf(",", firstComma + 1);
  if (secondComma < 0) {
    return null;
  }

  const thirdComma = line.indexOf(",", secondComma + 1);

  return {
    start: line.slice(0, firstComma).trim(),
    end: line.slice(firstComma + 1, secondComma).trim(),
    name: line.slice(secondComma + 1, thirdComma < 0 ? undefined : thirdComma).trim(),
    repeat: thirdComma < 0 ? "" : line.slice(thirdComma + 1).trim(),
  };
}

function parsedRepeat(value: string): TaskRepeat | undefined {
  const text = value.trim().toLowerCase();
  if (!text || text === "none" || text === "no repeat") {
    return undefined;
  }
  if (text === "hourly") {
    return { kind: "hourly" };
  }
  if (text === "morning-night" || text === "morning/night") {
    return { kind: "morning-night" };
  }

  const daysMatch = /^(?:days?|every\s*)[:= ]?(\d+)$/.exec(text);
  if (daysMatch) {
    return { kind: "days", intervalDays: Number(daysMatch[1]) };
  }

  const bareDays = Number(text);
  if (Number.isInteger(bareDays)) {
    return { kind: "days", intervalDays: bareDays };
  }

  return undefined;
}

export function parseTaskCsv(text: string, referenceDate: Date): ParseTaskCsvResult {
  const tasks: Task[] = [];
  const errors: ParseTaskCsvError[] = [];
  const createdAt = new Date().toISOString();

  text.split(/\r?\n/).forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      return;
    }

    const fields = splitTaskCsvLine(rawLine);
    if (!fields) {
      errors.push({ line: lineNumber, message: "Expected start,end,name[,repeat]" });
      return;
    }

    if (!fields.name) {
      errors.push({ line: lineNumber, message: "Task name is required" });
      return;
    }

    const start = parsedDate(fields.start, referenceDate);
    const end = fields.end ? parsedDate(fields.end, referenceDate) : null;
    if (!start) {
      errors.push({ line: lineNumber, message: "Start time is invalid" });
      return;
    }
    if (fields.end && !end) {
      errors.push({ line: lineNumber, message: "End time is invalid" });
      return;
    }

    if (end?.timeOnly && end.date.getTime() < start.date.getTime()) {
      end.date = new Date(end.date.getTime() + 24 * 60 * 60 * 1000);
    }

    if (end && end.date.getTime() <= start.date.getTime()) {
      errors.push({ line: lineNumber, message: "End time must be after start time" });
      return;
    }

    const repeat = parsedRepeat(fields.repeat);
    if (fields.repeat && !repeat) {
      errors.push({ line: lineNumber, message: "Repeat must be hourly, morning/night, or days:N" });
      return;
    }
    if (repeat?.kind === "days" && (repeat.intervalDays < 1 || repeat.intervalDays > 365)) {
      errors.push({ line: lineNumber, message: "Repeat days must be between 1 and 365" });
      return;
    }

    tasks.push({
      id: randomTaskId(),
      name: fields.name,
      start: start.date.toISOString(),
      end: end?.date.toISOString(),
      createdAt,
      repeat,
      source: "local",
    });
  });

  return { tasks, errors };
}
