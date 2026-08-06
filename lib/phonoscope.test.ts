import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  BUILTIN_PHONOSCOPE_MODULE_YAML,
  compilePhonoscopeExpression,
  compilePhonoscopeYaml,
} from "./phonoscope";

describe("Phonoscope module compiler", () => {
  it("uses a module's explicit visualiser-dependent palette slots", () => {
    const result = compilePhonoscopeYaml(`
engineVersion: 1
id: palette-demo
version: 1.0.0
name: Palette demo
dimension: 2d
bounds: { min: [-1, -1], max: [1, 1] }
boundary: wrap
paletteSlots:
  - { id: ambientGlow, label: Ambient Glow, defaultRgb: [10, 20, 30] }
templates: {}
scene:
  - { id: dot, render: { primitive: point, color: "=palette.ambientGlow" } }
resources: { maxParticles: 16, maxInteractiveFieldEntities: 16, maxRenderBatches: 2 }
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.module.paletteSlots.map((slot) => slot.id)).toEqual(["ambientGlow"]);
  });

  it("publishes the Particle Ripples trail-length control", () => {
    const source = readFileSync(
      path.join(process.cwd(), "..", "nova-visualiser-modules", "particle-ripples", "module.yaml"),
      "utf8",
    );
    const result = compilePhonoscopeYaml(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.module.version).toBe("2.5.0");
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

  it("keeps visualiser palette pairs as geometric gradient endpoints", () => {
    const modulesRoot = path.join(process.cwd(), "..", "nova-visualiser-modules");
    for (const entry of readdirSync(modulesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const modulePath = path.join(modulesRoot, entry.name, "module.yaml");
      if (!existsSync(modulePath)) continue;
      const source = readFileSync(modulePath, "utf8");
      expect(source, entry.name).not.toMatch(/mix\s*\(\s*palette\./i);
      const result = compilePhonoscopeYaml(source);
      expect(result.ok, entry.name).toBe(true);
    }
    expect(BUILTIN_PHONOSCOPE_MODULE_YAML).not.toMatch(/mix\s*\(\s*palette\./i);
  });

  it("compiles the resilient built-in module and its field", () => {
    const result = compilePhonoscopeYaml(BUILTIN_PHONOSCOPE_MODULE_YAML);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.module.id).toBe("bpm-pulse");
    expect(result.module.scene).toHaveLength(2);
    expect(result.module.resources.maxParticles).toBeLessThanOrEqual(65_536);
  });

  it("turns signal expressions into bounded data-only bytecode", () => {
    const expression = compilePhonoscopeExpression(
      "=clamp(sin(time * 2) + spectrum.3 * beat.pulse, 0, settings.intensity)",
    );
    expect(expression.$expr).toContain("spectrum.3");
    expect(expression.code.length).toBeGreaterThan(6);
    expect(expression.code.length).toBeLessThanOrEqual(64);
    expect(expression.code.some((instruction) => instruction.op === "load")).toBe(true);
    expect(expression.code.some((instruction) => instruction.op === "call")).toBe(true);
  });

  it("rejects executable module content", () => {
    const result = compilePhonoscopeYaml(`
id: bad-module
version: 1.0.0
dimension: 2d
bounds: { min: [-1, -1], max: [1, 1] }
boundary: wrap
templates:
  bad:
    metalSource: kernel void surprise() {}
scene: [{ template: bad }]
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/executable content/i);
  });

  it("rejects recursive over-budget emitters before publication", () => {
    const result = compilePhonoscopeYaml(`
id: particle-bomb
version: 1.0.0
dimension: 3d
bounds: { min: [-1, -1, -1], max: [1, 1, 1] }
boundary: bounce
templates:
  child:
    emitter: { count: 70000, template: child }
scene: [{ template: child }]
resources: { maxParticles: 65536 }
`);
    expect(result.ok).toBe(false);
  });

  it("validates entity inertia as a normalized momentum-retention value", () => {
    const result = compilePhonoscopeYaml(`
id: bad-inertia
version: 1.0.0
name: Bad inertia
dimension: 2d
bounds: { min: [-1, -1], max: [1, 1] }
boundary: wrap
templates:
  mote:
    physics: { inertia: 1.2 }
    render: { primitive: point }
scene: [{ template: mote }]
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/physics\.inertia/);
  });

  it("normalizes typed controls, curves, options, and affected paths", () => {
    const result = compilePhonoscopeYaml(`
id: controlled-wave
version: 1.0.0
name: Controlled wave
dimension: 2d
bounds: { min: [-1, -1], max: [1, 1] }
settings:
  - id: flash
    label: Flash
    section: physics
    updateMode: structural
    description: Shapes the crest.
    control: slider
    min: 0
    max: 10
    step: 0.1
    default: 4
    curve: { type: power, exponent: 2.2 }
    affects: [templates.dot.render.glow]
  - id: enabled
    label: Enabled
    control: toggle
    default: 1
  - id: mode
    label: Mode
    control: select
    default: 2
    options:
      - { label: Soft, value: 1 }
      - { label: Hard, value: 2 }
templates:
  dot: { render: { primitive: point, glow: "=settings.flash" } }
scene: [{ template: dot }]
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.module.settings[0]).toMatchObject({
      control: "slider",
      curve: { type: "power", exponent: 2.2 },
      affects: ["templates.dot.render.glow"],
      section: "physics",
      updateMode: "structural",
    });
    expect(result.module.settings[1]).toMatchObject({ control: "toggle", min: 0, max: 1, step: 1 });
    expect(result.module.settings[2]).toMatchObject({
      control: "select",
      min: 1,
      max: 2,
      options: [{ label: "Soft", value: 1 }, { label: "Hard", value: 2 }],
    });
  });

  it("rejects malformed control metadata", () => {
    const result = compilePhonoscopeYaml(`
id: bad-controls
version: 1.0.0
name: Bad controls
dimension: 2d
bounds: { min: [-1, -1], max: [1, 1] }
settings:
  - id: mode
    control: select
    default: 3
    options: [{ label: Only, value: 1 }]
    curve: { type: power, exponent: 20 }
    affects: ["not a path"]
templates:
  dot: { render: { primitive: point } }
scene: [{ template: dot }]
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join(" ")).toMatch(/options/);
    expect(result.errors.join(" ")).toMatch(/curve\.exponent/);
    expect(result.errors.join(" ")).toMatch(/affects/);
  });
});
