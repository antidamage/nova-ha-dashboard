import { describe, expect, it } from "vitest";
import { builtInModuleIds, CONTROL_MODULES } from "./catalogue";
import { knownBehaviourIds, modulePackageDocument, parseModulePackage } from "./library";

/**
 * Installed device-module packages (specs/control-modules.md).
 *
 * The refusals are the contract. A package that named a behaviour this build
 * does not have, or claimed a shipped module's id, would install cleanly and
 * then be a device type that renders and does nothing — or worse, one that
 * changes what every existing preset means. Both are rejected before a byte is
 * written.
 */

const context = () => ({
  behaviours: knownBehaviourIds(),
  builtInIds: builtInModuleIds(),
  moduleIds: new Set(CONTROL_MODULES.map((module) => module.id)),
});

function packageFor(module: Record<string, unknown>) {
  return {
    packageVersion: 1,
    module: {
      behaviours: [],
      category: "Climate",
      detail: "A device type from another household.",
      driverFor: null,
      driverIds: [],
      features: [],
      fields: [],
      id: "my-thermostat",
      layer: "control",
      name: "My Thermostat",
      placeable: true,
      region: "climate",
      renderer: "climate-knob",
      summary: "A thermostat",
      variants: [],
      ...module,
    },
  };
}

describe("parseModulePackage", () => {
  it("accepts a control module naming a renderer this build ships", () => {
    const result = parseModulePackage(packageFor({}), context());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.module.id).toBe("my-thermostat");
      expect(result.module.renderer).toBe("climate-knob");
    }
  });

  it("refuses an unknown behaviour id, naming it", () => {
    const result = parseModulePackage(packageFor({ behaviours: ["levitation"] }), context());
    expect(result).toEqual({ ok: false, error: "unknown behaviour id: levitation" });
  });

  it("refuses a module that claims an id this build ships", () => {
    const result = parseModulePackage(packageFor({ id: "room-lighting" }), context());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("already ships");
    }
  });

  it("refuses a control module with no renderer, because nothing could draw it", () => {
    const result = parseModulePackage(packageFor({ renderer: null }), context());
    expect(result).toEqual({ ok: false, error: "a control module must name a renderer this build ships" });
  });

  it("refuses a renderer this build does not have", () => {
    const result = parseModulePackage(packageFor({ renderer: "hologram" }), context());
    expect(result.ok).toBe(false);
  });

  it("round-trips: what an install writes is a package that installs again", () => {
    // The defect this pins: the resolved module carries field OBJECTS, the
    // package schema reads field IDS, so an install used to write a file the
    // next read rejected — and a downloaded package could never be installed
    // anywhere. Every shipped control has no fields of its own, which is why
    // nothing noticed until a driver travelled.
    const parsed = parseModulePackage(
      packageFor({
        fields: ["switchEntityIds", "temperatureEntityIds"],
        id: "round-trip-heater",
        layer: "driver",
        region: null,
        renderer: null,
        driverFor: { renderer: "climate-knob", variant: "heater" },
      }),
      context(),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const document = modulePackageDocument(parsed.module);
    // What goes on the wire is an id, never a definition.
    expect(document.module.fields).toEqual(["switchEntityIds", "temperatureEntityIds"]);

    const again = parseModulePackage(document, context());
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.module).toEqual(parsed.module);
    }
  });

  it("carries a feature's variant gate through the package, not just its fields", () => {
    // The defect this pins is the same one the strict schema closes: zod drops an
    // unknown key silently, so `variantIds` survived the round trip as a field of
    // the module and vanished as a feature gate — the "switch that changes
    // nothing" bug let back in through the package path.
    const parsed = parseModulePackage(
      packageFor({
        features: [{ default: true, detail: "Show the fan step ring", id: "fan-ring", label: "Fan ring", variantIds: ["aircon"] }],
        id: "gated-control",
        // A feature may only gate on a variant its own module declares, which
        // `parseModulePackage` now refuses by name — so the fixture declares it.
        variants: [{ detail: "Cooling", id: "aircon", label: "Air conditioner" }],
      }),
      context(),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.module.features[0].variantIds).toEqual(["aircon"]);

    const again = parseModulePackage(modulePackageDocument(parsed.module), context());
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.module.features[0].variantIds).toEqual(["aircon"]);
    }
  });

  it("refuses an unknown key by name instead of quietly dropping it", () => {
    const result = parseModulePackage(
      packageFor({ features: [{ default: true, detail: "", id: "fan-ring", label: "Fan ring", levitation: true }] }),
      context(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("levitation");
    }
  });

  it("refuses a feature gated on hardware this build does not have", () => {
    const driver = parseModulePackage(
      packageFor({ features: [{ default: true, detail: "", driverIds: ["not-a-driver"], id: "fan-ring", label: "Fan ring" }] }),
      context(),
    );
    expect(driver.ok).toBe(false);
    if (!driver.ok) {
      expect(driver.error).toBe("feature fan-ring needs an unknown driver module: not-a-driver");
    }

    const variant = parseModulePackage(
      packageFor({ features: [{ default: true, detail: "", id: "fan-ring", label: "Fan ring", variantIds: ["hologram"] }] }),
      context(),
    );
    expect(variant.ok).toBe(false);
    if (!variant.ok) {
      expect(variant.error).toBe("feature fan-ring needs a variant this module does not have: hologram");
    }
  });

  it("resolves a driver's declared fields to the shipped definitions", () => {
    const result = parseModulePackage(
      packageFor({ fields: ["switchEntityIds", "temperatureEntityIds"], layer: "driver", renderer: null, region: null, driverFor: { renderer: "climate-knob", variant: "heater" } }),
      context(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The labels and the picker candidates are the product's, not the package's.
      expect(result.module.fields.map((field) => field.label)).toEqual(["Switch entities", "Room temperature sensors"]);
      expect(result.module.fields[0].required).toBe(true);
      expect(result.module.fields[0].candidates).toBe("switch");
    }
  });
});
