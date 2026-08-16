import { describe, expect, it } from "vitest";
import { summariseCompanionStatus } from "./voice-host-settings";

/**
 * Summarising the companion's state for the browser.
 *
 * The reading worth testing is `reportingStalled`. A suspended app
 * *disconnects* — it does not linger as a connected-but-silent session — so a
 * connected session whose telemetry has frozen can only be a fault on the
 * device. Diagnosing that as a sleeping phone instead is what cost a day, so
 * the distinction is computed once here rather than left to whoever reads the
 * card.
 */

const CONNECTED: Record<string, unknown> = {
  enabled: true,
  forceLocal: false,
  connected: true,
  identity: "companion-1",
  locality: "home_lan",
  tier: "full",
  tierReason: "charging",
  appVersion: "1.0",
  osVersion: "26.6",
  workloads: ["classify_icon", "interpret"],
  telemetryAgeSeconds: 20,
  lastHeartbeatAgeSeconds: 20,
  activeAttempts: 0,
  routes: {
    interpret: { mode: "local", eligibility: "route is local" },
    classify_icon: { mode: "companion_preferred", eligibility: "eligible" },
  },
  counters: {
    classify_icon: { offered: 4, accepted: 4, completed: 4, fellBack: 1, paused: false },
  },
};

describe("companion status summary", () => {
  it("reports a healthy device as reporting normally", () => {
    const status = summariseCompanionStatus(CONNECTED);

    expect(status?.connected).toBe(true);
    expect(status?.reportingStalled).toBe(false);
    expect(status?.tierReason).toBe("charging");
    expect(status?.identity).toBe("companion-1");
  });

  it("flags a connected device whose telemetry has frozen", () => {
    // The exact shape of the fault that looked like a sleeping phone.
    const status = summariseCompanionStatus({
      ...CONNECTED,
      tier: "off",
      tierReason: "telemetry is 995s stale",
      telemetryAgeSeconds: 995,
      lastHeartbeatAgeSeconds: 995,
    });

    expect(status?.reportingStalled).toBe(true);
  });

  it("does not call a disconnected device stalled", () => {
    // Nothing is wrong with a phone in a pocket, and saying otherwise would
    // send someone hunting a bug that is not there.
    const status = summariseCompanionStatus({
      ...CONNECTED,
      connected: false,
      telemetryAgeSeconds: null,
    });

    expect(status?.connected).toBe(false);
    expect(status?.reportingStalled).toBe(false);
  });

  it("carries the voice server's own eligibility wording through unchanged", () => {
    // Paraphrasing it would put a second, drifting explanation beside the
    // authoritative one.
    const status = summariseCompanionStatus(CONNECTED);
    const interpret = status?.routes.find((route) => route.pass === "interpret");

    expect(interpret?.eligibility).toBe("route is local");
    expect(interpret?.mode).toBe("local");
  });

  it("defaults missing counters to zero rather than dropping the pass", () => {
    const status = summariseCompanionStatus(CONNECTED);
    const interpret = status?.routes.find((route) => route.pass === "interpret");

    expect(interpret).toBeDefined();
    expect(interpret?.offered).toBe(0);
    expect(interpret?.fellBack).toBe(0);
  });

  it("sorts passes so the card does not reorder itself between polls", () => {
    // The payload lists interpret first; the card must not shuffle under the
    // reader every fifteen seconds.
    const status = summariseCompanionStatus(CONNECTED);

    expect(status?.routes.map((route) => route.pass)).toEqual(["classify_icon", "interpret"]);
  });

  it("survives a payload with no routes or counters at all", () => {
    // What the endpoint returns when nothing is connected and the router has
    // never run: the card should render, not throw.
    const status = summariseCompanionStatus({ enabled: true, connected: false });

    expect(status?.routes).toEqual([]);
    expect(status?.workloads).toEqual([]);
    expect(status?.telemetryAgeSeconds).toBeNull();
  });

  it("returns null when there is no payload", () => {
    expect(summariseCompanionStatus(null)).toBeNull();
  });
});

describe("companion presence in the summary", () => {
  it("carries a well-formed reading through with its reason", () => {
    const status = summariseCompanionStatus({
      ...CONNECTED,
      presence: {
        state: "home",
        source: "home_lan_session",
        ageSeconds: 0,
        detail: "the companion is connected on the home network",
        actionable: true,
      },
    });

    expect(status?.presence?.state).toBe("home");
    expect(status?.presence?.actionable).toBe(true);
    expect(status?.presence?.detail).toContain("home network");
  });

  it("refuses to invent a state from a malformed reading", () => {
    // There is no safe direction in which to guess where someone is, and a
    // malformed payload is not evidence of anything.
    expect(summariseCompanionStatus({ ...CONNECTED, presence: {} })?.presence).toBeNull();
    expect(
      summariseCompanionStatus({ ...CONNECTED, presence: { state: "probably" } })?.presence,
    ).toBeNull();
    expect(summariseCompanionStatus({ ...CONNECTED, presence: "home" })?.presence).toBeNull();
  });

  it("treats a reading that does not say it is actionable as not actionable", () => {
    const status = summariseCompanionStatus({
      ...CONNECTED,
      presence: { state: "away", source: "device_location", detail: "" },
    });

    expect(status?.presence?.state).toBe("away");
    expect(status?.presence?.actionable).toBe(false);
  });

  it("is null when an older voice server does not publish it", () => {
    expect(summariseCompanionStatus(CONNECTED)?.presence).toBeNull();
  });
});

describe("route timings in the summary", () => {
  const WITH_TIMINGS = {
    ...CONNECTED,
    comparing: ["interpret"],
    timings: {
      classify_icon: {
        companion: { n: 8, p50: 340.2, p95: 980.0 },
        local: { n: 3, p50: 620.5, p95: 640.0 },
        fallbackOverhead: { n: 3, p50: 1500.0, p95: 1600.0 },
      },
    },
  };

  it("splits latency by where the work ran", () => {
    const status = summariseCompanionStatus(WITH_TIMINGS);
    const icon = status?.routes.find((route) => route.pass === "classify_icon");

    expect(icon?.companionMs).toEqual({ n: 8, p50: 340.2, p95: 980.0 });
    expect(icon?.localMs.p50).toBe(620.5);
  });

  it("keeps the cost of a failed attempt separate from the local run", () => {
    // Charging a failed companion attempt to the local arm would make the
    // voice server look slower exactly when the phone had let it down.
    const status = summariseCompanionStatus(WITH_TIMINGS);
    const icon = status?.routes.find((route) => route.pass === "classify_icon");

    expect(icon?.fallbackOverheadMs.p50).toBe(1500.0);
    expect(icon?.localMs.p50).toBe(620.5);
  });

  it("reports an arm with no runs as absent rather than instant", () => {
    // Zero would read as "0ms", which is the opposite of "never ran".
    const status = summariseCompanionStatus(CONNECTED);
    const interpret = status?.routes.find((route) => route.pass === "interpret");

    expect(interpret?.companionMs).toEqual({ n: 0, p50: null, p95: null });
  });

  it("marks which passes are being compared", () => {
    const status = summariseCompanionStatus(WITH_TIMINGS);

    // The fixture's routes are classify_icon and interpret, so the flag is
    // asserted against a pass that exists rather than one invented here.
    expect(status?.routes.find((r) => r.pass === "interpret")?.comparing).toBe(true);
    expect(status?.routes.find((r) => r.pass === "classify_icon")?.comparing).toBe(false);
  });

  it("carries both answers when comparison mode has produced any", () => {
    const status = summariseCompanionStatus({
      ...CONNECTED,
      comparisons: [
        {
          workload: "render_response",
          at: "2026-08-16T02:00:00Z",
          spoken: "companion",
          companion: { text: "On it.", elapsedMs: 900 },
          local: { text: "Consider it done.", elapsedMs: 2100 },
        },
      ],
    });

    expect(status?.comparisons).toHaveLength(1);
    expect(status?.comparisons[0].companion.text).toBe("On it.");
    expect(status?.comparisons[0].local.text).toBe("Consider it done.");
    expect(status?.comparisons[0].spoken).toBe("companion");
  });

  it("has no comparisons when the mode has never been switched on", () => {
    expect(summariseCompanionStatus(CONNECTED)?.comparisons).toEqual([]);
  });
});

describe("route modes as the operator sees them", () => {
  it("reads both flavours of phone-routing back as Companion", () => {
    // They differ only in what happens when the phone cannot answer, which is
    // a safety detail rather than a choice of machine.
    const status = summariseCompanionStatus({
      ...CONNECTED,
      routes: {
        a: { mode: "companion_preferred", eligibility: "eligible" },
        b: { mode: "companion_only", eligibility: "eligible" },
        c: { mode: "both", eligibility: "eligible" },
        d: { mode: "local", eligibility: "route is local" },
      },
    });

    const modes = Object.fromEntries(
      (status?.routes ?? []).map((route) => [route.pass, route.mode]),
    );
    expect(modes).toEqual({
      a: "companion_preferred",
      b: "companion_only",
      c: "both",
      d: "local",
    });
  });

  it("marks a both-route as comparing without a second flag", () => {
    // Comparison used to be separate runtime state that silently reset on
    // deploy; it is now implied by the route itself.
    const status = summariseCompanionStatus({
      ...CONNECTED,
      comparing: ["classify_icon"],
      routes: { classify_icon: { mode: "both", eligibility: "eligible" } },
    });

    expect(status?.routes[0].comparing).toBe(true);
  });
});
