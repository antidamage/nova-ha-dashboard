import { describe, expect, it, vi } from "vitest";

const emitted: unknown[] = [];
vi.mock("../event-spool", () => ({
  emitDashboardEventNoWait: (input: unknown) => void emitted.push(input),
}));

const { emitClimateControllerWrite } = await import("./attribution");

/** specs/bedroom-heater-control-integrity.md §5 — the controller's own writes. */
describe("an autonomous climate write", () => {
  it("records the reason, the modes and the reading it decided on", () => {
    emitted.length = 0;
    emitClimateControllerWrite({
      instanceId: "bedroom",
      reason: "sensor-timeout",
      modeBefore: "auto",
      modeAfter: "off",
      sensorTemperature: null,
      sensorAgeSeconds: 1800,
      sensorUnusableReason: "stale-or-non-numeric",
    });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      service: "heating",
      event: "climate-controller-write",
      // Not "user": nobody asked for this one, and it must never be attributed
      // to whichever client happened to be polling.
      source: "climate-controller",
      detail: {
        instanceId: "bedroom",
        reason: "sensor-timeout",
        modeAfter: "off",
        sensorAgeSeconds: 1800,
        sensorUnusableReason: "stale-or-non-numeric",
      },
    });
  });
});
