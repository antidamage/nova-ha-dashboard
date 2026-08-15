import { existsSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { readDefaultDashboardConfig } from "./dashboard-config";

describe("power device ratings come from config", () => {
  it("ships a populated ratings table in the default config", async () => {
    const config = await readDefaultDashboardConfig();

    expect(config.power.deviceRatings.length).toBeGreaterThan(0);
    for (const rating of config.power.deviceRatings) {
      expect(rating.entityIds.length).toBeGreaterThan(0);
      expect(rating.ratedWatts).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps rating ids unique, since state and MQTT discovery are keyed by id", async () => {
    const config = await readDefaultDashboardConfig();
    const ids = config.power.deviceRatings.map((rating) => rating.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never lists an entity id against two different devices", async () => {
    const config = await readDefaultDashboardConfig();
    const owner = new Map<string, string>();

    for (const rating of config.power.deviceRatings) {
      for (const entityId of rating.entityIds) {
        expect(owner.get(entityId) ?? rating.id).toBe(rating.id);
        owner.set(entityId, rating.id);
      }
    }
  });

  // The ratings table used to live in lib/power.ts and be mirrored to
  // data/power/device-ratings.json, where the on-disk copy silently outranked
  // the source. Removing a device from only one of them left it resurrected by
  // the other, so re-introducing that file would restore a real bug.
  it("has no on-disk ratings mirror to drift out of sync with config", () => {
    expect(existsSync(path.join(process.cwd(), "data", "power", "device-ratings.json"))).toBe(false);
  });
});
