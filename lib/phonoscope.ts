import { parse as parseYaml } from "yaml";

export const PHONOSCOPE_ENGINE_VERSION = 1;
export const PHONOSCOPE_MODULE_ID = /^[a-z][a-z0-9_-]{1,63}$/;
const PHONOSCOPE_PALETTE_SLOT_ID = /^[a-z][a-zA-Z0-9_-]{0,63}$/;
export const PHONOSCOPE_MODULE_VERSION = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i;
export const PHONOSCOPE_PACKAGE_NAME = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;

export const PHONOSCOPE_LIMITS = {
  compressedBytes: 25 * 1024 * 1024,
  extractedBytes: 100 * 1024 * 1024,
  textureDimension: 2048,
  expressionOperations: 64,
  spawnDepth: 4,
  particles: 65_536,
  interactiveFieldEntities: 16_384,
  renderBatches: 64,
  trailSamples: 32,
  propagationHops: 8,
  propagationDeliveriesPerTick: 8_192,
  simulationBudgetMs: 4,
} as const;

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

export const PHONOSCOPE_CORE_PALETTE_SLOTS: PhonoscopePaletteSlot[] = [
  { id: "primary", label: "Primary", defaultRgb: [115, 115, 115] },
  { id: "secondary", label: "Secondary", defaultRgb: [217, 217, 217] },
  { id: "tertiary", label: "Tertiary", defaultRgb: [166, 166, 166] },
  { id: "background", label: "Background", defaultRgb: [0, 0, 0] },
  { id: "primaryText", label: "Primary Text Colour", defaultRgb: [255, 255, 255] },
  { id: "secondaryText", label: "Secondary Text Colour", defaultRgb: [184, 184, 184] },
];

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

type Token =
  | { kind: "number"; value: number }
  | { kind: "identifier"; value: string }
  | { kind: "operator"; value: string }
  | { kind: "left" | "right" | "comma" | "eof" };

const ALLOWED_VARIABLE_ROOTS = new Set([
  "time",
  "delta",
  "screen",
  "uv",
  "position",
  "velocity",
  "age",
  "lifetime",
  "track",
  "beat",
  "bar",
  "audio",
  "spectrum",
  "lyrics",
  "field",
  "effect",
  "palette",
  "settings",
  "random",
  "pi",
  "e",
]);

const FUNCTIONS: Record<string, { min: number; max: number }> = {
  sin: { min: 1, max: 1 },
  cos: { min: 1, max: 1 },
  tan: { min: 1, max: 1 },
  abs: { min: 1, max: 1 },
  sqrt: { min: 1, max: 1 },
  floor: { min: 1, max: 1 },
  ceil: { min: 1, max: 1 },
  fract: { min: 1, max: 1 },
  exp: { min: 1, max: 1 },
  log: { min: 1, max: 1 },
  min: { min: 2, max: 4 },
  max: { min: 2, max: 4 },
  pow: { min: 2, max: 2 },
  clamp: { min: 3, max: 3 },
  mix: { min: 3, max: 3 },
  step: { min: 2, max: 2 },
  smoothstep: { min: 3, max: 3 },
  noise: { min: 1, max: 4 },
  select: { min: 3, max: 3 },
  vec2: { min: 2, max: 2 },
  vec3: { min: 3, max: 3 },
  vec4: { min: 4, max: 4 },
};

const PRECEDENCE: Record<string, number> = {
  "||": 1,
  "&&": 2,
  "==": 3,
  "!=": 3,
  "<": 4,
  "<=": 4,
  ">": 4,
  ">=": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "%": 6,
  "^": 7,
};

const BINARY_OPCODE: Record<string, PhonoscopeInstruction["op"]> = {
  "+": "add",
  "-": "sub",
  "*": "mul",
  "/": "div",
  "%": "mod",
  "^": "pow",
  "<": "lt",
  "<=": "lte",
  ">": "gt",
  ">=": "gte",
  "==": "eq",
  "!=": "neq",
  "&&": "and",
  "||": "or",
};

function tokenizeExpression(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const rest = source.slice(index);
    const whitespace = /^\s+/.exec(rest);
    if (whitespace) {
      index += whitespace[0].length;
      continue;
    }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i.exec(rest);
    if (number) {
      tokens.push({ kind: "number", value: Number(number[0]) });
      index += number[0].length;
      continue;
    }
    const identifier = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(rest);
    if (identifier) {
      tokens.push({ kind: "identifier", value: identifier[0] });
      index += identifier[0].length;
      continue;
    }
    const pair = rest.slice(0, 2);
    if (["<=", ">=", "==", "!=", "&&", "||"].includes(pair)) {
      tokens.push({ kind: "operator", value: pair });
      index += 2;
      continue;
    }
    const char = rest[0];
    if ("+-*/%^<>!".includes(char)) {
      tokens.push({ kind: "operator", value: char });
      index += 1;
      continue;
    }
    if (char === "(") tokens.push({ kind: "left" });
    else if (char === ")") tokens.push({ kind: "right" });
    else if (char === ",") tokens.push({ kind: "comma" });
    else throw new Error(`Unexpected character '${char}' at column ${index + 1}`);
    index += 1;
  }
  tokens.push({ kind: "eof" });
  return tokens;
}

class ExpressionParser {
  private readonly tokens: Token[];
  private index = 0;
  readonly code: PhonoscopeInstruction[] = [];

  constructor(source: string) {
    this.tokens = tokenizeExpression(source);
  }

  parse() {
    this.expression(0);
    if (this.peek().kind !== "eof") throw new Error("Unexpected token after expression");
    if (this.code.length > PHONOSCOPE_LIMITS.expressionOperations) {
      throw new Error(`Expression exceeds ${PHONOSCOPE_LIMITS.expressionOperations} operations`);
    }
    return this.code;
  }

  private peek() {
    return this.tokens[this.index];
  }

  private take() {
    return this.tokens[this.index++];
  }

  private expression(minPrecedence: number) {
    this.prefix();
    while (true) {
      const token = this.peek();
      if (token.kind !== "operator" || token.value === "!") return;
      const precedence = PRECEDENCE[token.value];
      if (precedence === undefined || precedence < minPrecedence) return;
      const operator = token.value;
      this.take();
      this.expression(precedence + (operator === "^" ? 0 : 1));
      this.code.push({ op: BINARY_OPCODE[operator] as never });
    }
  }

  private prefix() {
    const token = this.take();
    if (token.kind === "number") {
      if (!Number.isFinite(token.value)) throw new Error("Numeric constants must be finite");
      this.code.push({ op: "const", value: token.value });
      return;
    }
    if (token.kind === "operator" && (token.value === "-" || token.value === "!")) {
      this.prefix();
      this.code.push({ op: token.value === "-" ? "neg" : "not" });
      return;
    }
    if (token.kind === "left") {
      this.expression(0);
      if (this.take().kind !== "right") throw new Error("Expected ')'");
      return;
    }
    if (token.kind !== "identifier") throw new Error("Expected a number, variable, function, or '('");

    if (this.peek().kind === "left") {
      this.take();
      const signature = FUNCTIONS[token.value];
      if (!signature) throw new Error(`Unknown function '${token.value}'`);
      let argc = 0;
      if (this.peek().kind !== "right") {
        while (true) {
          this.expression(0);
          argc += 1;
          if (this.peek().kind !== "comma") break;
          this.take();
        }
      }
      if (this.take().kind !== "right") throw new Error(`Expected ')' after ${token.value}`);
      if (argc < signature.min || argc > signature.max) {
        throw new Error(`${token.value} expects ${signature.min === signature.max ? signature.min : `${signature.min}-${signature.max}`} arguments`);
      }
      this.code.push({ op: "call", fn: token.value, argc });
      return;
    }

    const root = token.value.split(".")[0];
    if (!ALLOWED_VARIABLE_ROOTS.has(root)) throw new Error(`Unknown input '${token.value}'`);
    if (token.value === "pi") this.code.push({ op: "const", value: Math.PI });
    else if (token.value === "e") this.code.push({ op: "const", value: Math.E });
    else this.code.push({ op: "load", key: token.value });
  }
}

export function compilePhonoscopeExpression(value: string): PhonoscopeCompiledExpression {
  const source = value.startsWith("=") ? value.slice(1).trim() : value.trim();
  if (!source) throw new Error("Expression is empty");
  return { $expr: source, code: new ExpressionParser(source).parse() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function compileValues(value: unknown, path: string, errors: string[]): unknown {
  if (typeof value === "string" && value.trimStart().startsWith("=")) {
    try {
      return compilePhonoscopeExpression(value);
    } catch (error) {
      errors.push(`${path}: ${error instanceof Error ? error.message : "invalid expression"}`);
      return value;
    }
  }
  if (Array.isArray(value)) return value.map((entry, index) => compileValues(entry, `${path}[${index}]`, errors));
  if (!isRecord(value)) return value;
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (["shader", "script", "javascript", "metalSource", "executable", "binary"].includes(key)) {
      errors.push(`${path}.${key}: executable content is not allowed`);
      continue;
    }
    output[key] = compileValues(entry, `${path}.${key}`, errors);
  }
  return output;
}

function normalizeBoundary(value: unknown, errors: string[]) {
  const raw = typeof value === "string" ? { mode: value } : isRecord(value) ? value : { mode: "bounce" };
  const modes: PhonoscopeBoundaryMode[] = ["despawn", "wrap", "bounce", "slide", "clamp", "respawn", "trigger"];
  const mode = modes.includes(raw.mode as PhonoscopeBoundaryMode) ? raw.mode as PhonoscopeBoundaryMode : "bounce";
  if (raw.mode !== undefined && raw.mode !== mode) errors.push(`boundary.mode: unsupported mode '${String(raw.mode)}'`);
  const result: PhonoscopeCompiledModule["boundary"] = {
    mode,
    restitution: Math.max(0, Math.min(1.5, finiteNumber(raw.restitution, 0.82))),
  };
  if (mode === "trigger") {
    const then = raw.then;
    if (typeof then === "string" && modes.includes(then as PhonoscopeBoundaryMode) && then !== "trigger") result.then = then as Exclude<PhonoscopeBoundaryMode, "trigger">;
    else result.then = "bounce";
    if (typeof raw.effect === "string" && raw.effect.trim()) result.effect = raw.effect.trim();
  }
  return result;
}

function normalizeSettings(value: unknown, errors: string[]): PhonoscopeSetting[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    errors.push("settings: expected an array");
    return [];
  }
  const seen = new Set<string>();
  return value.flatMap((entry, index) => {
    if (!isRecord(entry) || typeof entry.id !== "string" || !PHONOSCOPE_MODULE_ID.test(entry.id)) {
      errors.push(`settings[${index}]: invalid id`);
      return [];
    }
    if (seen.has(entry.id)) {
      errors.push(`settings[${index}]: duplicate id '${entry.id}'`);
      return [];
    }
    seen.add(entry.id);
    const supportedControls: PhonoscopeControlType[] = ["slider", "number", "toggle", "select"];
    const control = entry.control === undefined
      ? "slider"
      : supportedControls.includes(entry.control as PhonoscopeControlType)
        ? entry.control as PhonoscopeControlType
        : "slider";
    if (entry.control !== undefined && entry.control !== control) {
      errors.push(`settings[${index}].control: unsupported control '${String(entry.control)}'`);
    }

    const options: PhonoscopeControlOption[] = [];
    if (control === "select") {
      if (!Array.isArray(entry.options) || entry.options.length < 2) {
        errors.push(`settings[${index}].options: select controls require at least two options`);
      } else {
        entry.options.forEach((option, optionIndex) => {
          if (!isRecord(option) || typeof option.label !== "string" || !option.label.trim()
            || typeof option.value !== "number" || !Number.isFinite(option.value)) {
            errors.push(`settings[${index}].options[${optionIndex}]: expected a label and finite numeric value`);
            return;
          }
          if (options.some((existing) => existing.value === option.value)) {
            errors.push(`settings[${index}].options[${optionIndex}]: duplicate value`);
            return;
          }
          options.push({ label: option.label.trim(), value: option.value });
        });
      }
    }

    const optionValues = options.map((option) => option.value);
    const min = control === "toggle" ? 0
      : control === "select" && optionValues.length ? Math.min(...optionValues)
        : finiteNumber(entry.min, 0);
    const max = control === "toggle" ? 1
      : control === "select" && optionValues.length ? Math.max(...optionValues)
        : finiteNumber(entry.max, 1);
    if (max < min) errors.push(`settings[${index}]: max must be >= min`);
    let defaultValue = Math.max(min, Math.min(max, finiteNumber(entry.default, min)));
    if (control === "toggle") defaultValue = defaultValue >= 0.5 ? 1 : 0;
    if (control === "select" && optionValues.length && !optionValues.includes(defaultValue)) {
      errors.push(`settings[${index}].default: expected one of the declared option values`);
      defaultValue = optionValues[0];
    }

    const curveValue = isRecord(entry.curve) ? entry.curve : {};
    const curveType = curveValue.type === undefined || curveValue.type === "linear"
      ? "linear"
      : curveValue.type === "power"
        ? "power"
        : "linear";
    if (curveValue.type !== undefined && curveValue.type !== curveType) {
      errors.push(`settings[${index}].curve.type: unsupported curve '${String(curveValue.type)}'`);
    }
    const exponent = finiteNumber(curveValue.exponent, curveType === "power" ? 2 : 1);
    if (exponent < 0.1 || exponent > 8) {
      errors.push(`settings[${index}].curve.exponent: expected a value from 0.1 to 8`);
    }

    const affects = Array.isArray(entry.affects)
      ? entry.affects.flatMap((target, targetIndex) => {
          if (typeof target !== "string" || !/^[A-Za-z][A-Za-z0-9_.\-[\]]{0,127}$/.test(target)) {
            errors.push(`settings[${index}].affects[${targetIndex}]: invalid target path`);
            return [];
          }
          return [target];
        })
      : [];
    if (entry.affects !== undefined && !Array.isArray(entry.affects)) {
      errors.push(`settings[${index}].affects: expected an array of target paths`);
    }

    return [{
      id: entry.id,
      label: typeof entry.label === "string" && entry.label.trim() ? entry.label.trim() : entry.id,
      description: typeof entry.description === "string" ? entry.description.trim().slice(0, 512) : "",
      control,
      min,
      max,
      step: control === "toggle" || control === "select"
        ? 1
        : Math.max(Number.EPSILON, finiteNumber(entry.step, Math.max((max - min) / 100, 0.01))),
      default: defaultValue,
      affects,
      curve: {
        type: curveType,
        exponent: Math.max(0.1, Math.min(8, exponent)),
      },
      options,
      section: typeof entry.section === "string" ? entry.section.trim().slice(0, 64) : "",
      group: typeof entry.group === "string" ? entry.group.trim().slice(0, 64) : "",
      updateMode: entry.updateMode === "structural" ? "structural" : "smooth",
    }];
  });
}

function normalizePaletteSlots(value: unknown, errors: string[]): PhonoscopePaletteSlot[] {
  if (value === undefined) return PHONOSCOPE_CORE_PALETTE_SLOTS.map((slot) => ({ ...slot }));
  if (!Array.isArray(value)) {
    errors.push("paletteSlots: expected an array");
    return PHONOSCOPE_CORE_PALETTE_SLOTS.map((slot) => ({ ...slot }));
  }
  const slots: PhonoscopePaletteSlot[] = [];
  const seen = new Set<string>();
  value.forEach((entry, index) => {
    if (!isRecord(entry) || typeof entry.id !== "string" || !PHONOSCOPE_PALETTE_SLOT_ID.test(entry.id)) {
      errors.push(`paletteSlots[${index}]: invalid id`);
      return;
    }
    if (seen.has(entry.id)) {
      errors.push(`paletteSlots[${index}]: duplicate id`);
      return;
    }
    if (typeof entry.label !== "string" || !entry.label.trim()) {
      errors.push(`paletteSlots[${index}].label: expected a label`);
      return;
    }
    const rawRgb = entry.defaultRgb;
    if (!Array.isArray(rawRgb) || rawRgb.length !== 3 || rawRgb.some((part) => !Number.isFinite(Number(part)))) {
      errors.push(`paletteSlots[${index}].defaultRgb: expected three numeric RGB components`);
      return;
    }
    seen.add(entry.id);
    slots.push({
      id: entry.id,
      label: entry.label.trim().slice(0, 60),
      defaultRgb: rawRgb.map((part) => Math.max(0, Math.min(255, Math.round(Number(part))))) as [number, number, number],
    });
  });
  return slots;
}

function normalizeBounds(value: unknown, dimension: "2d" | "3d", errors: string[]) {
  const size = dimension === "2d" ? 2 : 3;
  const fallbackMin = Array(size).fill(-1);
  const fallbackMax = Array(size).fill(1);
  if (!isRecord(value) || !Array.isArray(value.min) || !Array.isArray(value.max)) {
    errors.push(`bounds: expected min/max vectors with ${size} values`);
    return { min: fallbackMin, max: fallbackMax };
  }
  const min = value.min.map(Number);
  const max = value.max.map(Number);
  if (min.length !== size || max.length !== size || [...min, ...max].some((item) => !Number.isFinite(item))) {
    errors.push(`bounds: expected finite ${size}D min/max vectors`);
    return { min: fallbackMin, max: fallbackMax };
  }
  if (min.some((item, index) => item >= max[index])) errors.push("bounds: every min component must be below max");
  return { min, max };
}

function countPotentialEntities(value: unknown): { particles: number; fields: number; batches: number } {
  let particles = 0;
  let fields = 0;
  let batches = 0;
  const visit = (entry: unknown) => {
    if (Array.isArray(entry)) {
      entry.forEach(visit);
      return;
    }
    if (!isRecord(entry)) return;
    if (isRecord(entry.emitter)) particles += Math.max(0, finiteNumber(entry.emitter.maxParticles, finiteNumber(entry.emitter.count, 0)));
    if (isRecord(entry.field)) fields += Math.max(0, finiteNumber(entry.field.count, 0));
    if (entry.render !== undefined || entry.sprite !== undefined || entry.mesh !== undefined || entry.text !== undefined || entry.trail !== undefined) batches += 1;
    Object.values(entry).forEach(visit);
  };
  visit(value);
  return { particles, fields, batches };
}

function validateTemplateGraph(
  templates: Record<string, unknown>,
  scene: unknown[],
  errors: string[],
) {
  const references = (value: unknown) => {
    const found: string[] = [];
    const visit = (entry: unknown) => {
      if (Array.isArray(entry)) {
        entry.forEach(visit);
        return;
      }
      if (!isRecord(entry)) return;
      for (const [key, nested] of Object.entries(entry)) {
        if (key === "template" && typeof nested === "string") found.push(nested);
        else visit(nested);
      }
    };
    visit(value);
    return found;
  };

  const graph = new Map(Object.entries(templates).map(([id, value]) => [id, references(value)]));
  const validateReference = (reference: string, path: string) => {
    if (!Object.hasOwn(templates, reference)) errors.push(`${path}: unknown template '${reference}'`);
  };
  graph.forEach((refs, id) => refs.forEach((ref) => validateReference(ref, `templates.${id}`)));
  references(scene).forEach((ref) => validateReference(ref, "scene"));

  const stack = new Set<string>();
  const complete = new Set<string>();
  const visit = (id: string, depth: number) => {
    if (stack.has(id)) {
      errors.push(`templates.${id}: recursive template cycle is not allowed`);
      return;
    }
    if (depth > PHONOSCOPE_LIMITS.spawnDepth) {
      errors.push(`templates.${id}: nesting exceeds maximum spawn depth ${PHONOSCOPE_LIMITS.spawnDepth}`);
      return;
    }
    if (complete.has(id)) return;
    stack.add(id);
    for (const child of graph.get(id) ?? []) {
      if (graph.has(child)) visit(child, depth + 1);
    }
    stack.delete(id);
    complete.add(id);
  };
  graph.forEach((_, id) => visit(id, 1));
}

function validatePhysics(value: unknown, path: string, errors: string[]) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validatePhysics(entry, `${path}[${index}]`, errors));
    return;
  }
  if (!isRecord(value)) return;
  if (isRecord(value.physics)) {
    const physics = value.physics;
    if (typeof physics.inertia === "number" && (physics.inertia < 0 || physics.inertia > 1)) {
      errors.push(`${path}.physics.inertia: expected a momentum-retention value from 0 to 1`);
    }
    if (typeof physics.mass === "number" && physics.mass <= 0) {
      errors.push(`${path}.physics.mass: expected a value greater than 0`);
    }
    if (typeof physics.drag === "number" && physics.drag < 0) {
      errors.push(`${path}.physics.drag: expected a value of 0 or greater`);
    }
  }
  Object.entries(value).forEach(([key, entry]) => validatePhysics(entry, `${path}.${key}`, errors));
}

export function compilePhonoscopeModule(value: unknown): PhonoscopeCompileResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isRecord(value)) return { ok: false, errors: ["module: expected a YAML object"], warnings };

  const id = typeof value.id === "string" ? value.id : "";
  const packageName = typeof value.packageName === "string" && value.packageName.trim()
    ? value.packageName.trim().toLowerCase()
    : `nz.skull.nova.visualiser.${id}`;
  const version = typeof value.version === "string" ? value.version : "";
  const name = typeof value.name === "string" && value.name.trim() ? value.name.trim() : id;
  const dimension = value.dimension === "3d" ? "3d" : value.dimension === "2d" ? "2d" : null;
  if (!PHONOSCOPE_MODULE_ID.test(id)) errors.push("id: use 2-64 lowercase letters, numbers, underscores, or dashes, beginning with a letter");
  if (!PHONOSCOPE_PACKAGE_NAME.test(packageName)) errors.push("packageName: use a reverse-domain package name such as nz.skull.nova.visualiser.example");
  if (!PHONOSCOPE_MODULE_VERSION.test(version)) errors.push("version: use semantic form such as 1.0.0");
  if (!dimension) errors.push("dimension: expected '2d' or '3d'");
  if (value.engineVersion !== undefined && value.engineVersion !== PHONOSCOPE_ENGINE_VERSION) {
    errors.push(`engineVersion: only ${PHONOSCOPE_ENGINE_VERSION} is supported`);
  }

  const normalizedDimension = dimension ?? "2d";
  const settings = normalizeSettings(value.settings, errors);
  const paletteSlots = normalizePaletteSlots(value.paletteSlots, errors);
  const bounds = normalizeBounds(value.bounds, normalizedDimension, errors);
  const boundary = normalizeBoundary(value.boundary, errors);
  const templates = isRecord(value.templates) ? compileValues(value.templates, "templates", errors) as Record<string, unknown> : {};
  if (value.templates !== undefined && !isRecord(value.templates)) errors.push("templates: expected an object keyed by reusable template id");
  const scene = Array.isArray(value.scene) ? compileValues(value.scene, "scene", errors) as unknown[] : [];
  if (!Array.isArray(value.scene) || scene.length === 0) errors.push("scene: expected at least one entity instance");
  validateTemplateGraph(templates, scene, errors);
  validatePhysics(value, "module", errors);

  const declared = isRecord(value.resources) ? value.resources : {};
  const estimated = countPotentialEntities({ templates, scene });
  const resources = {
    maxParticles: Math.round(finiteNumber(declared.maxParticles, Math.max(estimated.particles, 4_096))),
    maxInteractiveFieldEntities: Math.round(finiteNumber(declared.maxInteractiveFieldEntities, Math.max(estimated.fields, 1_024))),
    maxRenderBatches: Math.round(finiteNumber(declared.maxRenderBatches, Math.max(estimated.batches, 16))),
  };
  if (resources.maxParticles > PHONOSCOPE_LIMITS.particles) errors.push(`resources.maxParticles: maximum is ${PHONOSCOPE_LIMITS.particles}`);
  if (resources.maxInteractiveFieldEntities > PHONOSCOPE_LIMITS.interactiveFieldEntities) errors.push(`resources.maxInteractiveFieldEntities: maximum is ${PHONOSCOPE_LIMITS.interactiveFieldEntities}`);
  if (resources.maxRenderBatches > PHONOSCOPE_LIMITS.renderBatches) errors.push(`resources.maxRenderBatches: maximum is ${PHONOSCOPE_LIMITS.renderBatches}`);
  if (estimated.particles > resources.maxParticles) warnings.push(`Declared emitters may request ${estimated.particles} particles; runtime clips to ${resources.maxParticles}`);
  if (estimated.fields > resources.maxInteractiveFieldEntities) warnings.push(`Declared fields may request ${estimated.fields} entities; runtime clips to ${resources.maxInteractiveFieldEntities}`);

  const metadata = isRecord(value.metadata) ? value.metadata : {};
  const module: PhonoscopeCompiledModule = {
    engineVersion: PHONOSCOPE_ENGINE_VERSION,
    id,
    packageName,
    version,
    name,
    description: typeof value.description === "string" ? value.description.trim() : "",
    dimension: normalizedDimension,
    bounds,
    boundary,
    settings,
    paletteSlots,
    templates,
    scene,
    metadata: {
      ...(typeof metadata.author === "string" ? { author: metadata.author } : {}),
      ...(typeof metadata.license === "string" ? { license: metadata.license } : {}),
      tags: Array.isArray(metadata.tags) ? metadata.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 32) : [],
    },
    resources,
  };
  return errors.length ? { ok: false, errors, warnings } : { ok: true, module, warnings };
}

export function compilePhonoscopeYaml(source: string): PhonoscopeCompileResult {
  try {
    return compilePhonoscopeModule(parseYaml(source, {
      maxAliasCount: 32,
      prettyErrors: true,
      uniqueKeys: true,
    }));
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : "Invalid YAML"],
      warnings: [],
    };
  }
}

export function stablePhonoscopeJson(value: unknown): string {
  const normalize = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(normalize);
    if (!isRecord(entry)) return entry;
    return Object.fromEntries(Object.keys(entry).sort().map((key) => [key, normalize(entry[key])]));
  };
  return `${JSON.stringify(normalize(value), null, 2)}\n`;
}

export const BUILTIN_PHONOSCOPE_MODULE_YAML = `engineVersion: 1
id: bpm-pulse
packageName: nz.skull.nova.visualiser.bpm-pulse
version: 1.0.0
name: BPM Pulse
description: Built-in resilient Phonoscope module driven by the best available beat signal.
dimension: 2d
bounds:
  min: [-1.7778, -1]
  max: [1.7778, 1]
boundary:
  mode: wrap
settings:
  - id: intensity
    label: Intensity
    min: 0
    max: 2
    step: 0.05
    default: 1
templates:
  pulse:
    render:
      primitive: ring
      material: emissive
      colorStart: "=palette.primary"
      colorEnd: "=palette.secondary"
      glow: "=0.4 + beat.pulse * settings.intensity"
    transform:
      scale: "=vec3(0.35 + beat.phase * 0.45, 0.35 + beat.phase * 0.45, 1)"
    lifetime: 1
scene:
  - template: pulse
    id: core-pulse
  - id: orbit-field
    field:
      layout: radial
      count: 96
      template: pulse
      radius: 0.72
      channels:
        energy: "=0.15 + audio.mid * 0.85"
resources:
  maxParticles: 4096
  maxInteractiveFieldEntities: 1024
  maxRenderBatches: 16
metadata:
  author: Nova
  license: Household use
  tags: [builtin, bpm, ambient]
`;
