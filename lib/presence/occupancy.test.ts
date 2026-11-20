import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// specs/home-users.md section 5: an action that fails leaves the transition
// pending, and a retry of the same event replays it instead of reading as
// "already there". Real presence file in a temp dir; the house is mocked.

const dir = mkdtempSync(path.join(tmpdir(), "presence-"));
process.env.NOVA_DASHBOARD_PRESENCE_PATH = path.join(dir, "presence.json");

const apply = vi.hoisted(() => vi.fn());
vi.mock("./apply", () => ({ applyPresenceActions: apply }));
vi.mock("./night-recheck", () => ({ reapplyNightCaps: vi.fn(async () => 0) }));
vi.mock("../state", () => ({ buildDashboardState: vi.fn(async () => ({ sun: { state: "above_horizon" } })) }));

const { runOccupancy } = await import("./occupancy");
const { readPresence } = await import("./store");

const bo = { id: "bo", label: "Bo", color: "#39ff14", rooms: ["loft"], arrival: [], departure: [] };
const config = {
  dashboard: { people: [bo], zones: [{ zoneId: "loft", bedroom: true, arrivalLight: false }] },
} as never;

const ok = (actions: Array<Record<string, unknown>>) => actions.map((action) => ({ ...action, ok: true }));
const fail = (actions: Array<Record<string, unknown>>) => actions.map((action) => ({ ...action, ok: false, error: "HA down" }));

beforeEach(() => {
  rmSync(process.env.NOVA_DASHBOARD_PRESENCE_PATH!, { force: true });
  apply.mockReset();
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("runOccupancy", () => {
  it("replays a departure whose actions failed, then stops once they land", async () => {
    apply.mockImplementation(async (actions) => ok(actions));
    await runOccupancy("arrival", bo as never, config);

    apply.mockImplementation(async (actions) => fail(actions));
    const first = await runOccupancy("departure", bo as never, config);
    expect(first.changed).toBe(true);
    expect(first.actions.every((action) => action.ok)).toBe(false);
    expect((await readPresence()).members.bo.pending?.event).toBe("departure");

    apply.mockImplementation(async (actions) => ok(actions));
    const retry = await runOccupancy("departure", bo as never, config);
    expect(retry.replayed).toBe(true);
    expect(retry.actions.map((action) => action.kind)).toEqual(["lights-off-house", "heater-off"]);
    expect((await readPresence()).members.bo.pending).toBeUndefined();

    const again = await runOccupancy("departure", bo as never, config);
    expect(again.replayed).toBe(false);
    expect(again.actions).toEqual([]);
  });

  it("drops a pending transition when the opposite event arrives", async () => {
    apply.mockImplementation(async (actions) => fail(actions));
    await runOccupancy("arrival", bo as never, config);
    expect((await readPresence()).members.bo.pending?.event).toBe("arrival");

    apply.mockImplementation(async (actions) => ok(actions));
    await runOccupancy("departure", bo as never, config);
    expect((await readPresence()).members.bo).toMatchObject({ home: false });
    expect((await readPresence()).members.bo.pending).toBeUndefined();
  });
});
