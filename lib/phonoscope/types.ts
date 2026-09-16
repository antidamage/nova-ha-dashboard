// Module-manifest and compiler shapes. Types only.

export type PhonoscopeBoundaryMode =
  | "despawn"
  | "wrap"
  | "bounce"
  | "slide"
  | "clamp"
  | "respawn"
  | "trigger";

export type PhonoscopeControlType = "slider" | "number" | "toggle" | "select";

export type PhonoscopeControlCurve = {
  type: "linear" | "power";
  exponent: number;
};

export type PhonoscopeControlOption = {
  label: string;
  value: number;
};

export type PhonoscopePaletteSlot = {
  id: string;
  label: string;
  defaultRgb: [number, number, number];
};

export type PhonoscopeSetting = {
  id: string;
  label: string;
  description: string;
  control: PhonoscopeControlType;
  min: number;
  max: number;
  step: number;
  default: number;
  affects: string[];
  curve: PhonoscopeControlCurve;
  options: PhonoscopeControlOption[];
  section: string;
  /**
   * Optional effect group this setting belongs to in the controls editor, so
   * related axes read as one effect with parameters rather than several
   * entries in the picker. Presentation only — neither engine reads it, and
   * both parse settings field by field, so it costs them nothing.
   */
  group: string;
  /**
   * Which parameter group inside that effect group, if the manifest named one.
   * Presentation only in the same way `group` is. Optional: with none named the
   * setting lands in the effect's first parameter group. `dot_size` names one
   * because a parameter group owns exactly one ramp, and it must not share the
   * lattice extent's.
   */
  parameterGroup: string;
  updateMode: "smooth" | "structural";
};

export type PhonoscopeInstruction =
  | { op: "const"; value: number }
  | { op: "load"; key: string }
  | { op: "neg" | "not" | "add" | "sub" | "mul" | "div" | "mod" | "pow" | "lt" | "lte" | "gt" | "gte" | "eq" | "neq" | "and" | "or" }
  | { op: "call"; fn: string; argc: number };

export type PhonoscopeCompiledExpression = {
  $expr: string;
  code: PhonoscopeInstruction[];
};

export type PhonoscopeCompiledModule = {
  engineVersion: 1;
  id: string;
  packageName: string;
  version: string;
  name: string;
  description: string;
  dimension: "2d" | "3d";
  bounds: {
    min: number[];
    max: number[];
  };
  boundary: {
    mode: PhonoscopeBoundaryMode;
    restitution: number;
    then?: Exclude<PhonoscopeBoundaryMode, "trigger">;
    effect?: string;
  };
  settings: PhonoscopeSetting[];
  paletteSlots: PhonoscopePaletteSlot[];
  templates: Record<string, unknown>;
  scene: unknown[];
  metadata: {
    author?: string;
    license?: string;
    tags: string[];
  };
  resources: {
    maxParticles: number;
    maxInteractiveFieldEntities: number;
    maxRenderBatches: number;
  };
};

export type PhonoscopeModuleSummary = {
  id: string;
  packageName: string;
  version: string;
  name: string;
  description: string;
  dimension: "2d" | "3d";
  hash: string;
  builtin: boolean;
  settings: PhonoscopeSetting[];
  paletteSlots: PhonoscopePaletteSlot[];
  previewUrl?: string;
};

export type PhonoscopeCompileResult =
  | { ok: true; module: PhonoscopeCompiledModule; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

export type Token =
  | { kind: "number"; value: number }
  | { kind: "identifier"; value: string }
  | { kind: "operator"; value: string }
  | { kind: "left" | "right" | "comma" | "eof" };
