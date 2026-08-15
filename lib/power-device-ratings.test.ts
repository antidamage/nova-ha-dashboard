import { existsSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { readDefaultDashboardConfig } from "./dashboard-config";
import type { PowerDeviceRating } from "./config-schema";

/**
 * Device ratings are config, not code, and not product data.
 *
 * They began as a table in lib/power.ts mirrored to
 * data/power/device-ratings.json, where the on-disk copy silently outranked the
 * source — deleting a device from one left the other to resurrect it. They then
 * moved into dashboard config, which fixed the two-sources problem but still
 * shipped one household's 17 devices to every install. They now live in the
 * household package, and the product ships none.
 */

/** Invariants any ratings list must satisfy, wherever it comes from. */
function assertRatingsAreCoherent(ratings: PowerDeviceRating[]) {
  const ids = ratings.map((rating) => rating.id);
  expect(new Set(ids).size, "rating ids must be unique: state and MQTT discovery are keyed by id").toBe(ids.length);

  const owner = new Map<string, string>();
  for (const rating of ratings) {
    expect(rating.entityIds.length).toBeGreaterThan(0);
    expect(rating.ratedWatts).toBeGreaterThanOrEqual(0);
    for (const entityId of rating.entityIds) {
      expect(owner.get(entityId) ?? rating.id, `${entityId} is claimed by two devices`).toBe(rating.id);
      owner.set(entityId, rating.id);
    }
  }
}

describe("power device ratings", () => {
  it("ships none, because a device inventory belongs to one household", async () => {
    const config = await readDefaultDashboardConfig();
    expect(config.power.deviceRatings).toEqual([]);
  });

  it("ships no electricity plan either, so no install inherits another's tariff", async () => {
    const config = await readDefaultDashboardConfig();
    expect(config.power.rates.tariff).toBeUndefined();
    expect(config.power.accountHistory).toEqual([]);
  });

  it("holds ratings to their invariants wherever they are configured", () => {
    assertRatingsAreCoherent([
      {
        id: "study_lamp",
        name: "Study lamp",
        zone: "Study",
        kind: "light",
        entityIds: ["light.study_lamp", "light.study_lamp_cloud"],
        ratedWatts: 9,
        confidence: "high",
        source: "Manufacturer specification",
      },
      {
        id: "garage_heater",
        name: "Garage heater",
        zone: "Garage",
        kind: "switch",
        entityIds: ["switch.garage_heater"],
        ratedWatts: 2000,
        confidence: "assumed",
        source: "Nameplate",
      },
    ]);
  });

  it("rejects two devices claiming the same entity", () => {
    expect(() =>
      assertRatingsAreCoherent([
        {
          id: "a",
          name: "A",
          zone: "Study",
          kind: "light",
          entityIds: ["light.shared"],
          ratedWatts: 1,
          confidence: "high",
          source: "test",
        },
        {
          id: "b",
          name: "B",
          zone: "Study",
          kind: "light",
          entityIds: ["light.shared"],
          ratedWatts: 1,
          confidence: "high",
          source: "test",
        },
      ]),
    ).toThrow();
  });

  // The on-disk mirror is the bug this whole line of work started from.
  it("has no on-disk ratings mirror to drift out of sync with config", () => {
    expect(existsSync(path.join(process.cwd(), "data", "power", "device-ratings.json"))).toBe(false);
  });
});
