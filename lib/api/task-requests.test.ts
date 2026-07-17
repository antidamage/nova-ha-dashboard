import { describe, expect, it } from "vitest";
import {
  taskBulkImportInput,
  taskCommandFrom,
  taskIdsFrom,
  taskRoutePatchFrom,
  taskUpdatePatchFrom,
} from "./task-requests";

function request(url: string) {
  return new Request(url);
}

describe("task API request parsing", () => {
  it("preserves command fallback behavior", () => {
    expect(taskCommandFrom(request("http://localhost/api/tasks?command=list"))).toBe("list");
    expect(taskCommandFrom(request("http://localhost/api/tasks"), { command: "update" })).toBe("update");
    expect(taskCommandFrom(request("http://localhost/api/tasks"), { command: "unknown" })).toBe("docs");
  });

  it("parses task ids from strings and arrays", () => {
    expect(taskIdsFrom("a, b,,c")).toEqual(["a", "b", "c"]);
    expect(taskIdsFrom(["a", 2, ""])).toEqual(["a", "2"]);
  });

  it("preserves explicit patch keys only", () => {
    expect(taskUpdatePatchFrom({ name: "One", ignored: true, repeat: null })).toEqual({
      name: "One",
      repeat: null,
    });
    expect(taskRoutePatchFrom({ name: "Two", start: "start", end: null })).toEqual({
      name: "Two",
      start: "start",
      end: null,
    });
  });

  it("coerces bulk import csv like the existing route", () => {
    const input = taskBulkImportInput({ csv: 123, referenceDate: "2026-06-02T00:00:00Z" });

    expect(input.csv).toBe("123");
    expect(input.referenceDate.toISOString()).toBe("2026-06-02T00:00:00.000Z");
  });
});
