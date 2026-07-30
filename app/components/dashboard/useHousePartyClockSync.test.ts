import { describe, expect, it } from "vitest";
import { resolveHousePartyClockSync, type HousePartyClockSnapshot } from "./useHousePartyClockSync";

describe("House Party client clock synchronisation", () => {
  const snapshot: HousePartyClockSnapshot = {
    active: true,
    serverNowMs: 10_040,
    master: {
      trackKey: "track",
      position: 30,
      duration: 180,
      playing: true,
      sampledAtMs: 9_900,
      receivedAtMs: 10_000,
    },
  };

  it("advances a playing master by half the measured round trip", () => {
    const sync = resolveHousePartyClockSync(snapshot, 10_000, 10_200);
    expect(sync).toMatchObject({
      positionAtReceipt: 30.1,
      roundTripMs: 200,
    });
    expect(sync?.positionOffsetSeconds).toBeCloseTo(19.9);
  });

  it("does not advance a paused master clock", () => {
    expect(resolveHousePartyClockSync({
      ...snapshot,
      master: { ...snapshot.master!, playing: false },
    }, 10_000, 10_200)?.positionAtReceipt).toBe(30);
  });
});
