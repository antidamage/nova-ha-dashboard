import { mkdir, mkdtemp, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readAllPowershopUsage,
  readLatestPowershopUsage,
  readPowershopAccountMetadata,
  readPowershopDailyUsage,
  readPowershopUsageRange,
} from "./powershop-usage";

let dir: string;

function record(targetDate: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    source: "powershop",
    targetDate,
    capturedAt: `${targetDate}T06:00:00Z`,
    status: "ok",
    values: { costNzd: 5, kwh: 12 },
    ...extra,
  });
}

async function writeDaily(date: string, body: string) {
  await mkdir(path.join(dir, "daily"), { recursive: true });
  await writeFile(path.join(dir, "daily", `${date}.json`), body);
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "powershop-"));
});
afterEach(() => undefined);

describe("readPowershopDailyUsage", () => {
  it("reads and normalizes a valid daily record", async () => {
    await writeDaily("2026-06-10", record("2026-06-10"));
    const result = await readPowershopDailyUsage("2026-06-10", dir);
    expect(result?.values?.kwh).toBe(12);
  });

  it("rejects a malformed date key without touching disk", async () => {
    expect(await readPowershopDailyUsage("2026/06/10", dir)).toBeNull();
  });

  it("returns null for a record that is not from powershop", async () => {
    await writeDaily("2026-06-11", JSON.stringify({ source: "other", targetDate: "2026-06-11" }));
    expect(await readPowershopDailyUsage("2026-06-11", dir)).toBeNull();
  });

  it("returns null when the file is missing", async () => {
    expect(await readPowershopDailyUsage("2026-06-12", dir)).toBeNull();
  });
});

describe("readLatestPowershopUsage", () => {
  it("reads latest.json", async () => {
    await writeFile(path.join(dir, "latest.json"), record("2026-06-13"));
    expect((await readLatestPowershopUsage(dir))?.targetDate).toBe("2026-06-13");
  });
});

describe("readPowershopAccountMetadata", () => {
  it("reads a valid retailer billing window", async () => {
    await writeFile(
      path.join(dir, "account.json"),
      JSON.stringify({
        billing: {
          currentPeriodEndDate: "2026-08-16",
          currentPeriodStartDate: "2026-07-17",
          isFixed: true,
          nextBillingDate: "2026-08-17",
          periodStartDay: 17,
        },
        capturedAt: "2026-08-15T00:00:00Z",
        schemaVersion: 1,
        source: "powershop",
      }),
    );

    expect((await readPowershopAccountMetadata(dir))?.billing.currentPeriodEndDate).toBe("2026-08-16");
  });

  it("rejects invalid retailer billing metadata", async () => {
    await writeFile(path.join(dir, "account.json"), JSON.stringify({ source: "powershop", billing: {} }));
    expect(await readPowershopAccountMetadata(dir)).toBeNull();
  });
});

describe("readPowershopUsageRange", () => {
  it("returns sorted records within the inclusive range, skipping invalid ones", async () => {
    await writeDaily("2026-06-01", record("2026-06-01"));
    await writeDaily("2026-06-05", record("2026-06-05"));
    await writeDaily("2026-06-09", record("2026-06-09"));
    await writeDaily("2026-06-05b", "not json"); // ignored: not a date key

    const range = await readPowershopUsageRange("2026-06-02", "2026-06-09", dir);
    expect(range.map((r) => r.targetDate)).toEqual(["2026-06-05", "2026-06-09"]);
  });

  it("returns an empty array for invalid bounds", async () => {
    expect(await readPowershopUsageRange("bad", "2026-06-09", dir)).toEqual([]);
  });

  it("returns an empty array when the directory is missing", async () => {
    expect(await readPowershopUsageRange("2026-06-01", "2026-06-09", path.join(dir, "nope"))).toEqual([]);
  });
});

describe("readAllPowershopUsage", () => {
  it("returns all date-named daily records in order", async () => {
    await writeDaily("2026-06-03", record("2026-06-03"));
    await writeDaily("2026-06-01", record("2026-06-01"));
    await writeDaily("summary", record("2026-06-02"));

    expect((await readAllPowershopUsage(dir)).map((entry) => entry.targetDate)).toEqual([
      "2026-06-01",
      "2026-06-03",
    ]);
  });
});
