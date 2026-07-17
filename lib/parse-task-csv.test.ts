import { describe, expect, it } from "vitest";
import { parseTaskCsv } from "./parse-task-csv";

// A fixed reference date keeps time-only rows deterministic.
const REFERENCE = new Date(2026, 5, 15, 9, 0, 0); // 2026-06-15 09:00 local

describe("parseTaskCsv", () => {
  it("parses a simple start,end,name row using the reference day for time-only values", () => {
    const { tasks, errors } = parseTaskCsv("08:00,09:30,Standup", REFERENCE);
    expect(errors).toEqual([]);
    expect(tasks).toHaveLength(1);
    const [task] = tasks;
    expect(task.name).toBe("Standup");
    expect(task.source).toBe("local");
    expect(new Date(task.start!).getHours()).toBe(8);
    expect(new Date(task.end!).getHours()).toBe(9);
    expect(task.id).toBeTruthy();
  });

  it("skips blank lines and comments", () => {
    const { tasks, errors } = parseTaskCsv("# header\n\n10:00,11:00,Lunch\n   \n", REFERENCE);
    expect(errors).toEqual([]);
    expect(tasks.map((t) => t.name)).toEqual(["Lunch"]);
  });

  it("allows an empty end and stores no end time", () => {
    const { tasks, errors } = parseTaskCsv("07:15,,Wake", REFERENCE);
    expect(errors).toEqual([]);
    expect(tasks[0].end).toBeUndefined();
  });

  it("wraps a time-only end past midnight when it precedes the start", () => {
    const { tasks, errors } = parseTaskCsv("23:00,00:30,Night shift", REFERENCE);
    expect(errors).toEqual([]);
    const start = new Date(tasks[0].start!);
    const end = new Date(tasks[0].end!);
    expect(end.getTime() - start.getTime()).toBe(90 * 60 * 1000);
  });

  it.each([
    ["hourly", { kind: "hourly" }],
    ["morning/night", { kind: "morning-night" }],
    ["days:3", { kind: "days", intervalDays: 3 }],
    ["every 2", { kind: "days", intervalDays: 2 }],
    ["5", { kind: "days", intervalDays: 5 }],
  ])("parses repeat field %s", (repeatText, expected) => {
    const { tasks, errors } = parseTaskCsv(`08:00,09:00,Task,${repeatText}`, REFERENCE);
    expect(errors).toEqual([]);
    expect(tasks[0].repeat).toEqual(expected);
  });

  it("treats none/no repeat as no repeat", () => {
    const { tasks } = parseTaskCsv("08:00,09:00,Task,none", REFERENCE);
    expect(tasks[0].repeat).toBeUndefined();
  });

  it("reports an error for missing fields", () => {
    const { tasks, errors } = parseTaskCsv("just one field", REFERENCE);
    expect(tasks).toHaveLength(0);
    expect(errors[0]).toMatchObject({ line: 1, message: expect.stringContaining("start,end,name") });
  });

  it("requires a name", () => {
    const { errors } = parseTaskCsv("08:00,09:00,", REFERENCE);
    expect(errors[0].message).toContain("name is required");
  });

  it("rejects an invalid start time", () => {
    const { errors } = parseTaskCsv("not-a-time,09:00,Task", REFERENCE);
    expect(errors[0].message).toBe("Start time is invalid");
  });

  it("rejects an end before the start when both are absolute", () => {
    const { errors } = parseTaskCsv("2026-06-15T10:00,2026-06-15T09:00,Task", REFERENCE);
    expect(errors[0].message).toContain("after start time");
  });

  it("rejects an unparseable repeat", () => {
    const { errors } = parseTaskCsv("08:00,09:00,Task,sometimes", REFERENCE);
    expect(errors[0].message).toContain("hourly");
  });

  it("rejects a days interval outside 1..365", () => {
    const { errors } = parseTaskCsv("08:00,09:00,Task,days:400", REFERENCE);
    expect(errors[0].message).toContain("between 1 and 365");
  });

  it("reports the correct line number for the failing row", () => {
    const { errors } = parseTaskCsv("08:00,09:00,Good\nbad-row", REFERENCE);
    expect(errors[0].line).toBe(2);
  });
});
