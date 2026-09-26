import { describe, expect, it } from "vitest";
import { ARRIVAL_TARGET_KINDS } from "../config-schema/arrivals";
import { ARRIVAL_TARGETS, arrivalTargets } from "./targets";

describe("arrival targets", () => {
  it("registers exactly the kinds the config schema allows", () => {
    expect(Object.keys(ARRIVAL_TARGETS).sort()).toEqual([...ARRIVAL_TARGET_KINDS].sort());
  });

  it("names itself, offers presets and can apply one", () => {
    for (const target of arrivalTargets()) {
      expect(target.label.length).toBeGreaterThan(0);
      expect(typeof target.presets).toBe("function");
      expect(typeof target.apply).toBe("function");
      expect(target.kind).toBe(ARRIVAL_TARGETS[target.kind].kind);
    }
  });
});
