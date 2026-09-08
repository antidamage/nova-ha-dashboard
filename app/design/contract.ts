/**
 * The Design contract — a swappable presentation layer for the dashboard route.
 *
 * `specs/design-modules.md` owns the design; this file is the type it agrees
 * on. A Design owns the markup and CSS of `/`; it does not own `/config`, and
 * it is orthogonal to the colour theme (changing one never alters the other).
 *
 * Designs are registered at build time today. The shape is deliberately the
 * same one a runtime-installed design would satisfy, so adding that later is a
 * new source for the registry rather than a second architecture.
 */
import type { ComponentType } from "react";

/** Same id grammar as installable modules, so one rule covers both. */
export const DESIGN_ID_PATTERN = /^[a-z][a-z0-9-]{1,38}$/;

export type DesignManifest = {
  id: string;
  name: string;
  /** One line, shown under the name in the config selector. */
  description: string;
  version: string;
  author?: string;
};

/**
 * Experience-mode parity (SPEC.md §2) is not optional: a design that has not
 * said what it does on a lite device does not ship. These four mirror
 * `ExperienceFeatureKey` — `true` means the design renders that feature when
 * the device allows it, `false` means it never does regardless.
 */
export type DesignLiteSupport = {
  statusOrb: boolean;
  background: boolean;
  camera: boolean;
  worldMap: boolean;
};

export type DesignModule = {
  manifest: DesignManifest;
  /** Renders the whole dashboard route. Mounted with a key, so it may hold state. */
  Root: ComponentType;
  lite: DesignLiteSupport;
};
