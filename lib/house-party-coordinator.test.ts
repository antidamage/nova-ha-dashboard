import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deferLightingForHouseParty,
  endHousePartySession,
  enqueueHousePartyFrame,
  housePartyClockRuntimeState,
  housePartyIgnoresBrightness,
  housePartyThemeRuntimeState,
  resetHousePartyCoordinatorForTest,
  startHousePartySession,
} from "./house-party-coordinator";

afterEach(() => {
  resetHousePartyCoordinatorForTest();
  vi.restoreAllMocks();
});

describe("House Party coordinator", () => {
  it("rejects stale frames and keeps only the newest pending frame", async () => {
    const session = startHousePartySession();
    let release!: () => void;
    const first = new Promise<void>((resolve) => { release = resolve; });
    const seen: number[] = [];
    expect(enqueueHousePartyFrame(session.id, 1, async () => {
      seen.push(1);
      await first;
    })).toBe(true);
    expect(enqueueHousePartyFrame(session.id, 1, async () => { seen.push(99); })).toBe(false);
    expect(enqueueHousePartyFrame(session.id, 2, async () => { seen.push(2); })).toBe(true);
    expect(enqueueHousePartyFrame(session.id, 3, async () => { seen.push(3); })).toBe(true);
    release();
    await vi.waitFor(() => expect(seen).toEqual([1, 3]));
  });

  it("replays the latest deferred request when House Party ends", async () => {
    const session = startHousePartySession();
    const replayed: number[] = [];
    expect(deferLightingForHouseParty("zone:lounge", async () => { replayed.push(1); })).toBe(true);
    expect(deferLightingForHouseParty("zone:lounge", async () => { replayed.push(2); })).toBe(true);
    expect(endHousePartySession(session.id)).toBe(true);
    await vi.waitFor(() => expect(replayed).toEqual([2]));
  });

  it("restores the former state before applying queued automation", async () => {
    const events: string[] = [];
    const session = startHousePartySession(async () => { events.push("restore"); });
    expect(deferLightingForHouseParty("automation:evening", async () => {
      events.push("automation");
    })).toBe(true);

    expect(endHousePartySession(session.id)).toBe(true);

    await vi.waitFor(() => expect(events).toEqual(["restore", "automation"]));
  });

  it("publishes visualiser theme telemetry only for the active House Party lease", () => {
    const session = startHousePartySession();
    expect(housePartyThemeRuntimeState()).toEqual({ active: true, theme: null });

    expect(enqueueHousePartyFrame(session.id, 1, async () => {}, {
      themeId: "neon-night",
      variant: "light",
      transitionSeconds: 3,
    })).toBe(true);
    expect(housePartyThemeRuntimeState()).toMatchObject({
      active: true,
      theme: {
        themeId: "neon-night",
        variant: "light",
        transitionSeconds: 3,
      },
    });

    expect(endHousePartySession(session.id)).toBe(true);
    expect(housePartyThemeRuntimeState()).toEqual({ active: false, theme: null });
  });

  it("exposes the Apple TV playback clock advanced to server time", () => {
    const session = startHousePartySession();
    expect(enqueueHousePartyFrame(session.id, 1, async () => {}, null, {
      trackKey: "track",
      position: 12,
      duration: 180,
      playing: true,
      sampledAtMs: 9_900,
    })).toBe(true);
    const clock = housePartyClockRuntimeState(Date.now() + 500);
    expect(clock.active).toBe(true);
    expect(clock.master?.trackKey).toBe("track");
    expect(clock.master?.position).toBeGreaterThanOrEqual(12.5);
  });

  it("tracks whether every active House Party session ignores brightness", () => {
    const first = startHousePartySession();
    expect(housePartyIgnoresBrightness()).toBe(false);
    expect(enqueueHousePartyFrame(first.id, 1, async () => {}, null, null, "ignore")).toBe(true);
    expect(housePartyIgnoresBrightness()).toBe(true);

    const second = startHousePartySession();
    expect(enqueueHousePartyFrame(second.id, 1, async () => {}, null, null, "follow")).toBe(true);
    expect(housePartyIgnoresBrightness()).toBe(false);

    expect(endHousePartySession(second.id)).toBe(true);
    expect(housePartyIgnoresBrightness()).toBe(true);
  });
});
