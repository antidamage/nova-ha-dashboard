import { parse as parseYaml } from "yaml";
import {
  PHONOSCOPE_ENGINE_VERSION,
  PHONOSCOPE_LIMITS,
  PHONOSCOPE_MODULE_ID,
  PHONOSCOPE_MODULE_VERSION,
  PHONOSCOPE_PACKAGE_NAME,
} from "./constants";
import {
  compileValues,
  finiteNumber,
  isRecord,
  normalizeBoundary,
  normalizePaletteSlots,
  normalizeSettings,
} from "./normalize-model";
import type { PhonoscopeCompiledModule, PhonoscopeCompileResult } from "./types";

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
