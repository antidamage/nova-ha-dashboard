/**
 * The design registry — the only place that knows which designs exist.
 *
 * Nothing outside this file imports a design folder. That is what lets a
 * runtime-installed design become a second source here later without any
 * caller changing (specs/design-modules.md, "Contract").
 */
import { novaClassicDesign } from "../designs/nova-classic";
import { plainDesign } from "../designs/plain";
import { DESIGN_ID_PATTERN, type DesignModule } from "./contract";

/**
 * The design a dashboard falls back to: on a fresh install, when preferences
 * name a design that no longer exists, and during the first (pre-swap) client
 * render. It must always be present in `builtinDesigns`.
 */
export const DEFAULT_DESIGN_ID = "nova-classic";

const builtinDesigns: DesignModule[] = [novaClassicDesign, plainDesign];

export function listDesigns(): DesignModule[] {
  return builtinDesigns;
}

/**
 * Never throws and never returns undefined: an unknown id falls back to the
 * default, so a stale or hand-edited preferences file cannot blank the
 * dashboard.
 */
export function resolveDesign(id: string | null | undefined): DesignModule {
  const found = id ? builtinDesigns.find((design) => design.manifest.id === id) : undefined;
  return found ?? builtinDesigns.find((design) => design.manifest.id === DEFAULT_DESIGN_ID)!;
}

export function isKnownDesignId(id: unknown): id is string {
  return typeof id === "string" && DESIGN_ID_PATTERN.test(id)
    && builtinDesigns.some((design) => design.manifest.id === id);
}
