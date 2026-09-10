import { describe, expect, it } from "vitest";
import type { DashboardEntity, DashboardZone } from "../../../lib/types";
import { airconStateLabel, heaterStateLabel, lightsOnLabel } from "./quickAccessModel";

function entity(state: string, domain: DashboardEntity["domain"] = "climate"): DashboardEntity {
  return { entity_id: `${domain}.test`, domain, state, name: "Test", area_id: "lounge", attributes: {} };
}

describe("airconStateLabel", () => {
  it("names Off from the power selection, not the unit", () => {
    expect(airconStateLabel(entity("heat"), "off")).toBe("Off");
  });

  it("names what a running unit is doing", () => {
    expect(airconStateLabel(entity("heat"), "auto")).toBe("Heating");
    expect(airconStateLabel(entity("cool"), "auto")).toBe("Cooling");
    expect(airconStateLabel(entity("fan_only"), "auto")).toBe("Fan");
  });

  it("calls a unit resting under Auto idle", () => {
    expect(airconStateLabel(entity("off"), "auto")).toBe("Idle");
  });

  it("names Manual, which has no button on the compact card", () => {
    expect(airconStateLabel(entity("cool"), "manual")).toBe("Manual · Cooling");
  });

  it("reports an unreachable unit whatever the selection", () => {
    expect(airconStateLabel(entity("unavailable"), "auto")).toBe("Unavailable");
    expect(airconStateLabel(undefined, "off")).toBe("Unavailable");
  });
});

describe("heaterStateLabel", () => {
  it("follows the mode for Off and the switch for Heating/Idle", () => {
    expect(heaterStateLabel(entity("on", "switch"), "off")).toBe("Off");
    expect(heaterStateLabel(entity("on", "switch"), "auto")).toBe("Heating");
    expect(heaterStateLabel(entity("off", "switch"), "auto")).toBe("Idle");
    expect(heaterStateLabel(entity("unknown", "switch"), "auto")).toBe("Unavailable");
  });
});

describe("lightsOnLabel", () => {
  it("counts lit lights only", () => {
    const zone = {
      entities: [entity("on", "light"), entity("off", "light"), entity("on", "switch"), entity("on", "light")],
    } as DashboardZone;
    expect(lightsOnLabel(zone)).toBe("2 on");
    expect(lightsOnLabel({ entities: [entity("off", "light")] } as DashboardZone)).toBe("Off");
  });
});
