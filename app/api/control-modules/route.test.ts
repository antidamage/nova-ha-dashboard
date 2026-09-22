import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The save route's refusals (specs/control-modules.md).
 *
 * Driven through `Request` objects rather than read off the source, because the
 * behaviour that matters here is what happens to a body that is NOT a control
 * configuration. Every field of the block defaults, so `{}` validated perfectly
 * and wrote an empty list with `configured` set — one stray POST away from
 * emptying the owner's card with no way back.
 */

const patchDashboardConfig = vi.fn(async () => ({ applied: true, config: {}, errors: [], ok: true }));
const readDashboardConfig = vi.fn(async () => ({
  dashboard: { controls: { configured: false, presets: [], slots: [] } },
}));

vi.mock("../../../lib/dashboard-config", () => ({
  patchDashboardConfig: (...args: unknown[]) => patchDashboardConfig(...(args as [])),
  readDashboardConfig: () => readDashboardConfig(),
}));

const { PUT } = await import("./route");

function put(body: unknown) {
  return PUT(new Request("http://localhost/api/control-modules", {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "PUT",
  }));
}

describe("PUT /api/control-modules", () => {
  beforeEach(() => {
    patchDashboardConfig.mockClear();
  });

  it("refuses a body with no presets list, and writes nothing", async () => {
    const response = await put({});
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "A control configuration needs a presets list (and a slots list, when it has one)",
    });
    expect(patchDashboardConfig).not.toHaveBeenCalled();
  });

  it("refuses a body whose lists are not lists", async () => {
    expect((await put({ presets: "all of them" })).status).toBe(400);
    expect((await put({ presets: [], slots: "none" })).status).toBe(400);
    expect(patchDashboardConfig).not.toHaveBeenCalled();
  });

  it("saves a real configuration and sets the flag itself", async () => {
    const response = await put({
      presets: [{
        binding: {},
        driverId: null,
        features: {},
        id: "home-lights",
        moduleId: "room-lighting",
        name: "Lights",
        roomId: "everything",
        variant: null,
      }],
      slots: [{ id: "s1", presetId: "home-lights", roomId: null, surface: "quick-access", visible: true }],
    });
    expect(response.status).toBe(200);
    const [payload] = patchDashboardConfig.mock.calls[0] as unknown as [{ dashboard: { controls: { configured: boolean } } }];
    // The client is not trusted with the flag: one that sent `configured: false`
    // would store a list that renders as the derivation.
    expect(payload.dashboard.controls.configured).toBe(true);
  });
});
