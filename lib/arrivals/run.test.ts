import { beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
const apply = vi.hoisted(() => vi.fn(async (_presetId: string) => undefined));
const attributeControl = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../dashboard-config", () => ({ readDashboardConfig: vi.fn(async () => config.current) }));
vi.mock("../control-attribution", () => ({ attributeControl }));
vi.mock("./targets", () => ({
  ARRIVAL_TARGETS: { lighting: { kind: "lighting", label: "Lighting", presets: async () => [], apply } },
}));

const { runArrivalEvent } = await import("./run");

type Body = {
  member?: string;
  event?: string;
  ok?: boolean;
  states?: Array<Record<string, unknown>>;
  note?: string;
  error?: string;
  members?: string[];
};

beforeEach(() => {
  apply.mockClear();
  attributeControl.mockClear();
  apply.mockImplementation(async () => undefined);
  config.current = {
    dashboard: {
      people: [
        {
          id: "ada",
          label: "Ada",
          color: "#22d3ee",
          primary: true,
          arrival: [{ target: "lighting", presetId: "adaptive-office" }],
          departure: [],
        },
      ],
    },
  };
});

describe("runArrivalEvent", () => {
  it("applies the member's states and reports each one", async () => {
    const response = await runArrivalEvent("arrival", "Ada");
    const body = (await response.json()) as Body;

    expect(response.status).toBe(200);
    expect(body).toEqual({
      member: "ada",
      event: "arrival",
      ok: true,
      states: [{ target: "lighting", presetId: "adaptive-office", ok: true }],
    });
    expect(apply).toHaveBeenCalledWith("adaptive-office");
  });

  it("404s an unknown name and says which names it knows", async () => {
    const response = await runArrivalEvent("arrival", "fred");
    const body = (await response.json()) as Body;

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'No household member called "fred"', members: ["Ada"] });
    expect(apply).not.toHaveBeenCalled();
  });

  it("says plainly that a member has nothing configured for this event", async () => {
    const response = await runArrivalEvent("departure", "ada");
    const body = (await response.json()) as Body;

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.states).toEqual([]);
    expect(body.note).toBe("No departure states are configured for Ada");
  });

  it("reports a partial failure as a failed event, with the failing entry's message", async () => {
    apply.mockImplementationOnce(async () => {
      throw new Error("Unknown lighting preset: adaptive-office");
    });
    const response = await runArrivalEvent("arrival", "ada");
    const body = (await response.json()) as Body;

    expect(response.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.states?.[0]).toEqual({
      target: "lighting",
      presetId: "adaptive-office",
      ok: false,
      error: "Unknown lighting preset: adaptive-office",
    });
  });

  it("attributes the event when the caller passed a request", async () => {
    await runArrivalEvent("arrival", "ada", new Request("http://localhost/api/arrival/ada"));

    expect(attributeControl).toHaveBeenCalledWith(
      expect.any(Request),
      expect.objectContaining({ service: "arrivals", event: "arrival", summary: "Ada arrived" }),
    );
  });

  it("decodes a percent-escaped name", async () => {
    const response = await runArrivalEvent("arrival", "Ada%20");

    expect(response.status).toBe(200);
  });
});
