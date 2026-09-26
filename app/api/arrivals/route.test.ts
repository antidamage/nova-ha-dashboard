import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigImportResult } from "../../../lib/config-schema";

const config = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const patchDashboardConfig = vi.hoisted(() =>
  vi.fn(
    async (_partial: unknown) =>
      ({
        ok: true,
        applied: true,
        errors: [],
        config: config.current,
      }) as ConfigImportResult,
  ),
);

vi.mock("../../../lib/dashboard-config", () => ({
  readDashboardConfig: vi.fn(async () => config.current),
  patchDashboardConfig,
}));
vi.mock("../../../lib/arrivals/targets", () => ({
  arrivalTargets: () => [
    {
      kind: "lighting",
      label: "Lighting",
      presets: async () => [{ id: "adaptive-office", label: "Office · Adaptive", group: "Office" }],
      apply: async () => undefined,
    },
    { kind: "climate", label: "Air conditioning", presets: async () => [], apply: async () => undefined },
    { kind: "volume", label: "Volume", presets: async () => [], apply: async () => undefined },
  ],
}));

const { GET, PUT } = await import("./route");

type Body = {
  members: Array<Record<string, unknown>>;
  targets: Array<{ kind: string; label: string }>;
  presets: Record<string, Array<{ id: string; label: string }>>;
  error?: string;
};

const person = {
  id: "ada",
  label: "Ada",
  color: "#22d3ee",
  primary: true,
  arrival: [],
  departure: [],
};

beforeEach(() => {
  patchDashboardConfig.mockClear();
  config.current = { dashboard: { people: [person] } };
});

describe("/api/arrivals", () => {
  it("returns the members, the targets and each target's presets", async () => {
    const body = (await (await GET()).json()) as Body;

    expect(body.members).toHaveLength(1);
    expect(body.targets).toEqual([
      { kind: "lighting", label: "Lighting" },
      { kind: "climate", label: "Air conditioning" },
      { kind: "volume", label: "Volume" },
    ]);
    expect(body.presets.climate).toEqual([]);
    expect(body.presets.lighting[0].id).toBe("adaptive-office");
  });

  it("writes the people array it is given", async () => {
    const people = [{ ...person, arrival: [{ target: "lighting", presetId: "adaptive-office" }] }];
    const response = await PUT(
      new Request("http://localhost/api/arrivals", {
        body: JSON.stringify({ people }),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      }),
    );

    expect(response.status).toBe(200);
    expect(patchDashboardConfig).toHaveBeenCalledWith({ dashboard: { people } });
  });

  it("refuses a body that is not a people array", async () => {
    const response = await PUT(
      new Request("http://localhost/api/arrivals", {
        body: JSON.stringify({}),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      }),
    );

    expect(response.status).toBe(400);
    expect(patchDashboardConfig).not.toHaveBeenCalled();
  });

  it("reports the failing field when the schema refuses a member", async () => {
    patchDashboardConfig.mockResolvedValueOnce({
      ok: false,
      applied: false,
      errors: [{ code: "invalid_type", message: "Invalid input", path: "dashboard.people.0.color" }],
    });

    const response = await PUT(
      new Request("http://localhost/api/arrivals", {
        body: JSON.stringify({ people: [{ id: "ada", label: "Ada", color: "nope" }] }),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      }),
    );
    const body = (await response.json()) as Body;

    expect(response.status).toBe(400);
    expect(body.error).toContain("dashboard.people.0.color");
  });
});
