import { createHash } from "node:crypto";
import {
  BUILTIN_PHONOSCOPE_MODULE_YAML,
  compilePhonoscopeYaml,
  stablePhonoscopeJson,
  type PhonoscopeModuleSummary,
} from "../phonoscope";

export function packageNameFor(module: Pick<PhonoscopeModuleSummary, "id"> & { packageName?: string }) {
  return module.packageName ?? `nz.skull.nova.visualiser.${module.id}`;
}


export function hashBytes(values: Uint8Array[]) {
  const hash = createHash("sha256");
  values.forEach((value) => hash.update(value));
  return hash.digest("hex");
}

export function builtinRecord() {
  const result = compilePhonoscopeYaml(BUILTIN_PHONOSCOPE_MODULE_YAML);
  if (!result.ok) throw new Error(`Built-in Phonoscope module is invalid: ${result.errors.join("; ")}`);
  const compiled = stablePhonoscopeJson(result.module);
  const hash = hashBytes([Buffer.from(compiled)]);
  const summary: PhonoscopeModuleSummary = {
    id: result.module.id,
    packageName: result.module.packageName,
    version: result.module.version,
    name: result.module.name,
    description: result.module.description,
    dimension: result.module.dimension,
    hash,
    builtin: true,
    settings: result.module.settings,
    paletteSlots: result.module.paletteSlots,
  };
  return { compiled: result.module, summary, source: BUILTIN_PHONOSCOPE_MODULE_YAML };
}


export function validateArchivePath(name: string) {
  const normalized = name.replaceAll("\\", "/");
  if (
    normalized.startsWith("/")
    || /^[A-Za-z]:/.test(normalized)
    || normalized.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    throw new Error(`Unsafe archive path: ${name}`);
  }
  return normalized;
}

export function isAllowedAsset(name: string) {
  return /^assets\/[A-Za-z0-9_./-]+\.(?:png|jpe?g)$/i.test(name) || name === "preview.png";
}

