import { describe, expect, it } from "vitest";
import {
  BUILTIN_PHONOSCOPE_MODULE_YAML,
  compilePhonoscopeExpression,
  compilePhonoscopeYaml,
} from "./phonoscope";

describe("Phonoscope module compiler", () => {
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
