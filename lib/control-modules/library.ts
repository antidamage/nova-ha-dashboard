import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { CONTROL_BEHAVIOURS } from "./renderers";
import { controlModuleField } from "./fields";
import { CONTROL_MODULE_FIELD_IDS, SHIPPED_RENDERER_IDS, type ControlModule } from "./types";

/**
 * Installed device modules (specs/control-modules.md).
 *
 * A module package is a single JSON document describing one device type, and it
 * lives under `data/` so it survives a deploy and a self-update — the same
 * reason installed modules live there rather than in `config/`.
 *
 * One deliberate limit, stated here rather than discovered later: a package
 * names a renderer this build ships. A module cannot bring its own drawing —
 * that is the installable module system's job (`specs/module-system.md`), where
 * a package carries real code — and a control-modules package that could not be
 * drawing would be a device type nothing could render. What a package CAN do is
 * define a new device type: its name, its settings, its behaviours, the driver it
 * defaults to, and which of the SHIPPED features it offers — a renderer reads a
 * fixed set of feature ids, so a feature id this build does not know would switch
 * nothing. Feature ids are therefore not validated against a catalogue here: the
 * control that draws the preset is the only thing that can say which ids it
 * reads, and the module it belongs to is where that list lives.
 */

const SLUG = /^[a-z][a-z0-9-]{1,38}$/;

/**
 * STRICT on purpose, and every object in this package format is.
 *
 * zod's default is to drop a key the schema does not know, and a dropped key is
 * a feature gate or a setting that installs cleanly and then does not exist —
 * `variantIds` was stripped exactly this way for one afternoon, which put the
 * "a switch that changes nothing" defect back through the package path after it
 * had been fixed in the model. An unknown key means the package expects
 * behaviour this build cannot honour, so it is refused BY NAME at install
 * instead, the same call the installable module system makes for an unknown hook
 * (specs/module-system.md §1).
 */
const LeafSchema = z
  .object({
    default: z.boolean(),
    detail: z.string().max(300).default(""),
    driverIds: z.array(z.string().max(60)).max(12).optional(),
    id: z.string().min(1).max(40),
    label: z.string().min(1).max(80),
    variantIds: z.array(z.string().min(1).max(40)).max(6).optional(),
  })
  .strict();

const REGION_IDS = ["dial-line", "climate", "readings"] as const;

export const ModulePackageSchema = z
  .object({
    packageVersion: z.literal(1),
  module: z
    .object({
      behaviours: z.array(z.string().max(60)).max(24).default([]),
      category: z.string().min(1).max(40),
      detail: z.string().min(1).max(1200),
      driverFor: z
        .object({ renderer: z.enum(SHIPPED_RENDERER_IDS), variant: z.string().max(40) })
        .strict()
        .nullable()
        .default(null),
      driverIds: z.array(z.string().max(60)).max(12).default([]),
      features: z.array(LeafSchema).max(24).default([]),
      fields: z.array(z.enum(CONTROL_MODULE_FIELD_IDS)).max(12).default([]),
      id: z.string().regex(SLUG, "id must be lower-case letters, digits and hyphens"),
      layer: z.enum(["control", "driver"]),
      name: z.string().min(1).max(80),
      placeable: z.boolean().default(false),
      region: z.enum(REGION_IDS).nullable().default(null),
      renderer: z.enum(SHIPPED_RENDERER_IDS).nullable().default(null),
      summary: z.string().min(1).max(160),
      variants: z
        .array(
          z
            .object({ detail: z.string().max(300).default(""), id: z.string().min(1).max(40), label: z.string().min(1).max(80) })
            .strict(),
        )
        .max(6)
        .default([]),
    })
    .strict(),
  })
  // The root too: a package carrying anything beside its version and its module —
  // `presets`, say — is a package from a version that expected more than this
  // build does, and dropping the extra silently is the defect this format was
  // made strict to stop.
  .strict();

export type ModulePackage = z.infer<typeof ModulePackageSchema>;

const INSTALL_DIR = path.join(process.cwd(), "data", "control-modules");

export type PackageParseResult =
  | { ok: true; module: ControlModule }
  | { ok: false; error: string };

/**
 * Validate a package against the shipped vocabulary: every behaviour id and
 * every declared driver must be something this build knows, because an unknown
 * one is a load-time nothing rather than an error anyone would see.
 */
export function parseModulePackage(
  value: unknown,
  known: { behaviours: ReadonlySet<string>; moduleIds: ReadonlySet<string>; builtInIds: ReadonlySet<string> },
): PackageParseResult {
  const parsed = ModulePackageSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; "),
    };
  }
  const module = parsed.data.module;
  if (known.builtInIds.has(module.id)) {
    return { ok: false, error: `"${module.id}" is a module this build already ships` };
  }
  const unknownBehaviour = module.behaviours.find((id) => !known.behaviours.has(id));
  if (unknownBehaviour) {
    return { ok: false, error: `unknown behaviour id: ${unknownBehaviour}` };
  }
  const unknownDriver = module.driverIds.find((id) => !known.moduleIds.has(id) && !known.builtInIds.has(id));
  if (unknownDriver) {
    return { ok: false, error: `unknown driver module: ${unknownDriver}` };
  }
  // A FEATURE's own gates get the same treatment. Without this a package could
  // gate a feature on a driver this build does not have, install cleanly, and
  // then grey the row out for ever with a raw id as the reason — no error, no
  // way to clear it, because the missing module cannot be un-missing.
  for (const feature of module.features) {
    const unknownFeatureDriver = (feature.driverIds ?? []).find((id) => !known.moduleIds.has(id) && !known.builtInIds.has(id));
    if (unknownFeatureDriver) {
      return { ok: false, error: `feature ${feature.id} needs an unknown driver module: ${unknownFeatureDriver}` };
    }
    const unknownVariant = (feature.variantIds ?? []).find(
      (id) => !module.variants.some((variant) => variant.id === id),
    );
    if (unknownVariant) {
      return { ok: false, error: `feature ${feature.id} needs a variant this module does not have: ${unknownVariant}` };
    }
  }
  if (module.layer === "control" && !module.renderer) {
    return { ok: false, error: "a control module must name a renderer this build ships" };
  }
  return {
    ok: true,
    module: {
      ...module,
      fields: module.fields.map(controlModuleField),
      // A driver is drawn by the control that owns it; never by itself.
      region: module.layer === "driver" ? null : module.region,
      driverIds: module.layer === "driver" ? [] : module.driverIds,
      renderer: module.layer === "driver" ? null : module.renderer,
    },
  };
}

async function readDir(): Promise<string[]> {
  try {
    return (await readdir(INSTALL_DIR)).filter((name) => name.endsWith(".json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/** Every installed package, invalid ones skipped with their reason. */
export async function readInstalledModules(
  known: { behaviours: ReadonlySet<string>; moduleIds: ReadonlySet<string>; builtInIds: ReadonlySet<string> },
): Promise<{ modules: ControlModule[]; errors: string[] }> {
  const modules: ControlModule[] = [];
  const errors: string[] = [];
  for (const name of await readDir()) {
    try {
      const result = parseModulePackage(JSON.parse(await readFile(path.join(INSTALL_DIR, name), "utf8")), known);
      if (result.ok) {
        modules.push(result.module);
      } else {
        errors.push(`${name}: ${result.error}`);
      }
    } catch (error) {
      errors.push(`${name}: ${error instanceof Error ? error.message : "unreadable"}`);
    }
  }
  return { errors, modules };
}

/**
 * A module as a PACKAGE carries it: the binding fields by id, not by their
 * shipped definitions.
 *
 * One shape, used for both halves of the round trip — what an install writes and
 * what a download serves. Writing the resolved module instead was a real defect
 * for one afternoon: the resolved `fields` is an array of objects, the package
 * schema reads ids, so every install wrote a file the next read rejected and no
 * module could travel between dashboards at all. `modulePackageDocument` is the
 * single place that conversion happens, and `library.test.ts` round-trips through
 * it rather than trusting the two halves to agree.
 */
export function modulePackageDocument(module: ControlModule): ModulePackage {
  return {
    module: { ...module, fields: module.fields.map((field) => field.id) } as ModulePackage["module"],
    packageVersion: 1,
  };
}

/** Written whole and atomically, so a half-written package is never readable. */
export async function writeInstalledModule(module: ControlModule): Promise<void> {
  await mkdir(INSTALL_DIR, { recursive: true });
  const file = path.join(INSTALL_DIR, `${module.id}.json`);
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(modulePackageDocument(module), null, 2)}\n`, "utf8");
  await rename(temp, file);
}

export async function removeInstalledModule(id: string): Promise<void> {
  await rm(path.join(INSTALL_DIR, `${id}.json`), { force: true });
}

/** The behaviours this build understands, as a set for package validation. */
export function knownBehaviourIds(): Set<string> {
  return new Set(Object.keys(CONTROL_BEHAVIOURS));
}
