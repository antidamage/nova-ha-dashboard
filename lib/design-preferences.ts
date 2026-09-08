/**
 * Server-side normalisation for the active design choice.
 *
 * Kept free of React and of the design registry itself: the registry imports
 * design components, and this module is used from API routes and the
 * prerendered layout, which must not pull a component tree in to answer "which
 * id is stored".
 */
import type { DesignPreferences } from "./types";

/**
 * Mirrors DESIGN_ID_PATTERN in app/design/contract.ts, which cannot be imported
 * here without pulling a React component graph into the API routes and the
 * prerendered layout. A contract test asserts the two stay identical.
 */
export const DESIGN_ID_PATTERN = /^[a-z][a-z0-9-]{1,38}$/;

/** Must match DEFAULT_DESIGN_ID in app/design/registry.ts. */
export const DEFAULT_DESIGN_ID = "nova-classic";

/**
 * Structural validation only — whether the id names a design that exists is
 * decided by the registry on the client, which is the side that knows. A
 * well-formed but unknown id is stored and later falls back at render time,
 * so removing a design cannot corrupt the preferences file.
 */
export function normalizeDesignPreferences(value: unknown): DesignPreferences {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
  const activeId = record?.activeId;
  return {
    activeId: typeof activeId === "string" && DESIGN_ID_PATTERN.test(activeId)
      ? activeId
      : DEFAULT_DESIGN_ID,
  };
}

export function activeDesignId(preferences: { design?: DesignPreferences } | null | undefined): string {
  return normalizeDesignPreferences(preferences?.design).activeId ?? DEFAULT_DESIGN_ID;
}
