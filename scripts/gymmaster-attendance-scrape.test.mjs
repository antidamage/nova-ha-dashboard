import { describe, expect, it } from "vitest";
import {
  assertWatchfaceEcho,
  extractVisitCandidatesFromJson,
  extractVisitCandidatesFromText,
  pickLatestVisitCandidate,
} from "./gymmaster-attendance-scrape.mjs";

const NOW = new Date("2026-06-03T10:00:00.000Z");
const TIME_ZONE = "Pacific/Auckland";

describe("GymMaster attendance scrape parsing", () => {
  it("extracts the newest NZ visit timestamp from visit-history text", () => {
    const candidates = extractVisitCandidatesFromText(
      "Visit History 01/06/2026 09:00 03/06/2026 18:45",
      { now: NOW, timeZone: TIME_ZONE },
    );

    expect(pickLatestVisitCandidate(candidates)?.iso).toBe("2026-06-03T06:45:00.000Z");
  });

  it("understands month-name dates with am/pm times", () => {
    const candidates = extractVisitCandidatesFromText(
      "Last visits: 2 June 2026 at 7:15 pm, 31 May 2026 at 10:03 am",
      { now: NOW, timeZone: TIME_ZONE },
    );

    expect(pickLatestVisitCandidate(candidates)?.iso).toBe("2026-06-02T07:15:00.000Z");
  });

  it("combines JSON date and time fields from relevant visit records", () => {
    const candidates = extractVisitCandidatesFromJson(
      {
        visits: [
          { visit_date: "30/05/2026", visit_time: "08:30" },
          { visit_date: "03/06/2026", visit_time: "20:00" },
        ],
      },
      { now: new Date("2026-06-03T11:00:00.000Z"), timeZone: TIME_ZONE },
    );

    expect(pickLatestVisitCandidate(candidates)?.iso).toBe("2026-06-03T08:00:00.000Z");
  });

  it("filters unrelated future datepicker bounds", () => {
    const candidates = extractVisitCandidatesFromText(
      "startDate: 01-01-1900 endDate: 01-01-2032 visit 03-06-2026",
      { now: NOW, timeZone: TIME_ZONE },
    );

    expect(candidates.map((candidate) => candidate.raw)).toEqual(["03-06-2026"]);
  });
});

describe("dashboard watchface write verification", () => {
  const jsonResponse = (body, ok = true) => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  });

  it("accepts a response that echoes the value back", async () => {
    await expect(
      assertWatchfaceEcho(jsonResponse({ watchface: { gymLastResetAt: "2026-09-07T09:21:00.000Z" } }), "2026-09-07T09:21:00.000Z"),
    ).resolves.toBeUndefined();
  });

  it("rejects the port-80 catch-all that answers 200 with an empty body", async () => {
    await expect(
      assertWatchfaceEcho({ ok: true, status: 200, json: async () => { throw new Error("Unexpected end of JSON input"); } }, "2026-09-07T09:21:00.000Z"),
    ).rejects.toThrow(/did not reach/);
  });

  it("rejects a stale echo", async () => {
    await expect(
      assertWatchfaceEcho(jsonResponse({ watchface: { gymLastResetAt: "2026-08-30T09:47:00.000Z" } }), "2026-09-07T09:21:00.000Z"),
    ).rejects.toThrow(/expected/);
  });

  it("rejects a non-ok response", async () => {
    await expect(assertWatchfaceEcho(jsonResponse({}, false), "2026-09-07T09:21:00.000Z")).rejects.toThrow(/HTTP 500/);
  });
});
