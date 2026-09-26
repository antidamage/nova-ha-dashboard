import { describe, expect, it } from "vitest";
import {
  ARRIVAL_TARGET_KINDS,
  ArrivalStateSchema,
  ArrivalsConfigSchema,
  ClimateArrivalPresetSchema,
  VolumeArrivalPresetSchema,
} from "./arrivals";

describe("arrival state schema", () => {
  it("accepts a lighting state and rejects an unknown target kind", () => {
    expect(ArrivalStateSchema.parse({ target: "lighting", presetId: "adaptive-office" }))
      .toEqual({ target: "lighting", presetId: "adaptive-office" });
    expect(ArrivalStateSchema.safeParse({ target: "sprinkler", presetId: "x" }).success).toBe(false);
    expect(ArrivalStateSchema.safeParse({ target: "lighting", presetId: "" }).success).toBe(false);
  });

  it("names exactly the three target kinds", () => {
    expect([...ARRIVAL_TARGET_KINDS]).toEqual(["lighting", "climate", "volume"]);
  });

  it("keeps the volume preset inside the slider's range", () => {
    expect(VolumeArrivalPresetSchema.safeParse({ id: "quiet", label: "Quiet", volumePct: 100 }).success).toBe(true);
    expect(VolumeArrivalPresetSchema.safeParse({ id: "loud", label: "Loud", volumePct: 140 }).success).toBe(false);
  });

  it("requires a climate preset to name a mode and an instance", () => {
    expect(ClimateArrivalPresetSchema.safeParse({ id: "off", label: "Off", instanceId: "lounge", mode: "off" }).success).toBe(true);
    expect(ClimateArrivalPresetSchema.safeParse({ id: "off", label: "Off", instanceId: "lounge", mode: "sleep" }).success).toBe(false);
    expect(ClimateArrivalPresetSchema.safeParse({ id: "off", label: "Off", mode: "off" }).success).toBe(false);
  });

  it("ships both preset lists empty", () => {
    expect(ArrivalsConfigSchema.parse({})).toEqual({ climatePresets: [], volumePresets: [] });
  });
});
