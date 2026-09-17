import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { compilePhonoscopeYaml } from "../phonoscope";

// The public dashboard checkout does not contain the private workspace's
// sibling module catalogue. Exercise it when running the complete workspace.
const modulesRoot = path.join(process.cwd(), "..", "nova-visualiser-modules");

describe("Phonoscope module compiler", () => {
  it.skipIf(!existsSync(modulesRoot))("publishes the Particle Ripples trail-length control", () => {
    const source = readFileSync(
      path.join(process.cwd(), "..", "nova-visualiser-modules", "particle-ripples", "module.yaml"),
      "utf8",
    );
    const result = compilePhonoscopeYaml(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.module.version).toBe("2.7.0");
    expect(result.module.packageName).toBe("nz.skull.nova.visualiser.particle-ripples");
    // Defaults are the values this household actually runs. The driver panel
    // has no static layer, so an effect nobody has bound to a lane rests on its
    // declared default rather than on a shipped-from-new guess.
    expect(result.module.settings.find((setting) => setting.id === "trail_length")).toMatchObject({
      control: "slider",
      min: 0,
      max: 500,
      step: 0.5,
      default: 25.5,
      affects: ["templates.particle.render.trailLength"],
    });
    expect(result.module.settings.find((setting) => setting.id === "offset_magnifier")).toMatchObject({
      control: "slider",
      default: 13,
      min: 0,
      max: 50,
      step: 0.5,
    });
    expect(result.module.settings.find((setting) => setting.id === "fluid_speed")).toMatchObject({
      section: "motion",
      control: "slider",
      min: 0.1,
      max: 60,
      step: 0.05,
      default: 0.65,
    });
    // "Physics" is retired as a user-facing word: the panel is Visualiser
    // controls and these are its motion effects.
    expect(result.module.settings.every((setting) => setting.section !== "physics")).toBe(true);
    // The fluid background follows the visualiser frame rate, so it exposes no
    // independent frame-rate setting.
    expect(result.module.settings.find((setting) => setting.id === "fluid_frame_rate")).toBeUndefined();
    expect(JSON.stringify(result.module.templates.particle)).toContain("settings.trail_length");
    expect(result.module.settings.find((setting) => setting.id === "complexity")).toMatchObject({
      min: 0.2,
      max: 1,
      default: 1,
      affects: ["scene.particle-grid.field.density"],
    });
    // The lattice extent is a percentage, and both axes name the `grid` group so
    // the controls editor shows them under one effect with the particle blend
    // mode rather than as separate picker entries.
    expect(result.module.settings.find((setting) => setting.id === "grid_width")).toMatchObject({
      min: 0, max: 100, step: 1, default: 100, group: "grid",
    });
    expect(result.module.settings.find((setting) => setting.id === "grid_height")).toMatchObject({
      min: 0, max: 100, step: 1, default: 33, group: "grid",
    });
    // Dot size is a swept range in real device pixels with its OWN parameter
    // group, so a lane can pulse the dots without also sweeping the extents.
    // 3.8px is the authored 0.0035 clip units at the 1080-line reference.
    expect(result.module.settings.find((setting) => setting.id === "dot_size")).toMatchObject({
      min: 0, max: 50, step: 0.1, default: 3.8,
      group: "grid", parameterGroup: "dots",
      affects: ["templates.particle.render.dotSizePixels"],
      updateMode: "smooth",
    });
    // Naming no parameter group compiles to "" — NOT undefined — which lands the
    // setting in the effect's first one. The two extents rely on that, so the
    // resolver has to treat the empty string as absent.
    expect(result.module.settings.find((setting) => setting.id === "grid_width")?.parameterGroup)
      .toBe("");
    // The crest-lighting family is one effect, and the three labels that said
    // "Glow ..." or "Flash ..." no longer point at the overlay Glow.
    for (const id of ["peak_threshold", "peak_glow", "anticipation", "ramp_up", "release",
      "flash_power"]) {
      expect(result.module.settings.find((setting) => setting.id === id)?.group, id).toBe("flare");
    }
    expect(result.module.settings.find((setting) => setting.id === "anticipation")?.label)
      .toBe("Anticipation");
    expect(result.module.settings.find((setting) => setting.id === "release")?.label)
      .toBe("Release");
    // Both energy amounts feed the same beat wave, so they are one effect.
    for (const id of ["intensity", "strong_beat_multiplier"]) {
      expect(result.module.settings.find((setting) => setting.id === id)?.group, id).toBe("ripple");
    }
    // The px-to-clip divide is each engine's, because it needs the output
    // height; the manifest hands over the pixels unmodified. `transform.scale`
    // stays as the fallback for an engine that predates the key.
    expect(JSON.stringify(result.module.templates.particle)).toContain("settings.dot_size");
    expect((result.module.templates.particle as { transform?: { scale?: unknown } }).transform?.scale)
      .toEqual([0.0035, 0.0035, 1]);
    // The divide lives in the manifest, so the extent contract stays a fraction.
    expect(JSON.stringify(result.module.scene)).toContain("div");
    // The grid toggle is gone: the geometry is always built and the line
    // palette slots' opacity decides whether it is visible.
    expect(result.module.settings.find((setting) => setting.id === "grid_wireframe")).toBeUndefined();
    expect(JSON.stringify(result.module.scene)).not.toContain("settings.grid_wireframe");
    expect((result.module.scene[0] as { field?: { wireframe?: unknown } }).field?.wireframe).toBe(1);
    expect(result.module.paletteSlots.map((slot) => slot.id)).toEqual([
      "backgroundPrimary", "backgroundSecondary",
      "dotPrimary", "dotSecondary",
      "glowPrimary", "glowSecondary",
      "linePrimary", "lineSecondary",
      "trailPrimary", "trailSecondary",
      // The edge gradients framing the backdrop band are themed, so the colour
      // outside the band is a palette slot rather than the authored black.
      "vignette",
      "primaryText", "secondaryText",
    ]);
    const particle = JSON.stringify(result.module.templates.particle);
    const scene = JSON.stringify(result.module.scene);
    expect(result.module.templates.particle).toMatchObject({
      render: {
        colorStart: { $expr: "palette.dotPrimary" },
        colorEnd: { $expr: "palette.dotSecondary" },
        glowColorStart: { $expr: "palette.glowPrimary" },
        glowColorEnd: { $expr: "palette.glowSecondary" },
        trailColorStart: { $expr: "palette.trailPrimary" },
        trailColorEnd: { $expr: "palette.trailSecondary" },
      },
    });
    expect(result.module.scene[0]).toMatchObject({
      field: {
        wireframeColorStart: { $expr: "palette.linePrimary" },
        wireframeColorEnd: { $expr: "palette.lineSecondary" },
      },
    });
    const render = (result.module.templates.particle as {
      render: Record<string, { $expr?: string }>;
    }).render;
    for (const key of [
      "colorStart", "colorEnd", "glowColorStart", "glowColorEnd",
      "trailColorStart", "trailColorEnd",
    ]) {
      expect(render[key]?.$expr).not.toContain("field.energy");
    }
    const field = (result.module.scene[0] as {
      field: Record<string, { $expr?: string }>;
    }).field;
    expect(field.wireframeColorStart?.$expr).not.toContain("field.energy");
    expect(field.wireframeColorEnd?.$expr).not.toContain("field.energy");
    // Background, vignette and text are renderer-level surfaces rather than
    // module entities — the vignette is the frame around the backdrop band, read
    // straight off the palette by the engine. All other declared slots must be
    // referenced by module data.
    const rendererSlots = new Set([
      "backgroundPrimary", "backgroundSecondary", "vignette",
      "primaryText", "secondaryText",
    ]);
    const moduleData = `${particle}${scene}`;
    const unused = result.module.paletteSlots
      .map((slot) => slot.id)
      .filter((id) => !rendererSlots.has(id) && !moduleData.includes(`palette.${id}`));
    expect(unused).toEqual([]);
  });

  it.skipIf(!existsSync(modulesRoot))("keeps visualiser palette pairs as geometric gradient endpoints", () => {
    for (const entry of readdirSync(modulesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const modulePath = path.join(modulesRoot, entry.name, "module.yaml");
      if (!existsSync(modulePath)) continue;
      const source = readFileSync(modulePath, "utf8");
      expect(source, entry.name).not.toMatch(/mix\s*\(\s*palette\./i);
      const result = compilePhonoscopeYaml(source);
      expect(result.ok, entry.name).toBe(true);
    }
  });
});
