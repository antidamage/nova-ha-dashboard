"use client";

// Client-side access to status orb modules.
//
// Modules come from two places, merged by id:
//   1. The built-ins compiled into the bundle (instant, offline-safe).
//   2. `GET /api/orb-modules`, which overlays JSON files dropped into
//      `config/orb-modules/` on the host — the hot-deploy path for new orb
//      looks without an app release.
//
// A single module-level cache is shared by every hook instance so the global
// avatar and any config previews stay consistent, and a custom window event
// fans fetched updates out to all mounted hooks.

import { useEffect, useMemo, useState } from "react";
import {
  BUILTIN_ORB_MODULES,
  normalizeOrbModule,
  resolveOrbModule,
  type OrbModule,
  type OrbPalette,
} from "../../lib/orb-modules";
import { appliedThemeRgb } from "./accentColor";
import type { NovaAvatarTheme } from "./avatarThemeModel";

/** Dispatched on window whenever the module cache changes. */
const ORB_MODULES_CHANGE_EVENT = "nova-orb-modules-change";

/** How often a mounted hook re-fetches the module list from the host. */
const ORB_MODULES_POLL_MS = 5 * 60 * 1000;

/** Shared cache: built-ins first, overlaid by whatever the server returns. */
let moduleCache: Map<string, OrbModule> = new Map(
  BUILTIN_ORB_MODULES.map((module) => [module.id, module]),
);
let lastFetchAt = 0;
let inflight: Promise<void> | null = null;

/** Snapshot the cache as a list, preserving insertion (picker) order. */
function cachedModuleList(): OrbModule[] {
  return [...moduleCache.values()];
}

/**
 * Fetch the merged module list from the host and fold it into the cache.
 * Failures are silent by design: the built-ins always keep the orb alive,
 * and the next poll retries.
 */
async function fetchOrbModules(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const response = await fetch("/api/orb-modules", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as { modules?: unknown[] };
      if (!Array.isArray(data.modules)) return;

      // Re-normalize defensively — the server already normalizes, but the
      // client must never trust the wire format with its render loop.
      const next = new Map<string, OrbModule>(
        BUILTIN_ORB_MODULES.map((module) => [module.id, module]),
      );
      for (const entry of data.modules) {
        const normalized = normalizeOrbModule(entry);
        if (normalized) next.set(normalized.id, normalized);
      }
      moduleCache = next;
      window.dispatchEvent(new Event(ORB_MODULES_CHANGE_EVENT));
    } catch {
      // Network/parse errors: keep the current cache (built-ins at worst).
    } finally {
      lastFetchAt = Date.now();
      inflight = null;
    }
  })();
  return inflight;
}

/** Kick a fetch if the cache is stale; cheap to call from every mount. */
function ensureFresh() {
  if (Date.now() - lastFetchAt > ORB_MODULES_POLL_MS) {
    void fetchOrbModules();
  }
}

/**
 * All available orb modules, for the Status Orb config picker. Starts with
 * the built-ins synchronously and refreshes from the host in the background.
 */
export function useOrbModules(): OrbModule[] {
  const [modules, setModules] = useState<OrbModule[]>(cachedModuleList);

  useEffect(() => {
    const onChange = () => setModules(cachedModuleList());
    window.addEventListener(ORB_MODULES_CHANGE_EVENT, onChange);
    ensureFresh();
    const interval = window.setInterval(() => void fetchOrbModules(), ORB_MODULES_POLL_MS);
    return () => {
      window.removeEventListener(ORB_MODULES_CHANGE_EVENT, onChange);
      window.clearInterval(interval);
    };
  }, []);

  return modules;
}

/**
 * The module a given id resolves to right now, with the classic built-in as
 * the universal fallback (missing id, unknown id, fetch not landed yet).
 */
export function useOrbModule(id: string | undefined): OrbModule {
  const modules = useOrbModules();
  return useMemo(() => {
    const map = new Map(modules.map((module) => [module.id, module]));
    return resolveOrbModule(id, map);
  }, [id, modules]);
}

/**
 * Resolve the avatar theme into the per-slot palette the renderer consumes.
 * This is where theme semantics get baked in:
 *   - line1..3 carry their per-line 0-100 theme opacities as alpha,
 *   - gymNumber carries its theme opacity,
 *   - innerShadow is black at the theme's innerShadowOpacity,
 * so module authors reference slots without re-implementing theme rules.
 */
export function buildOrbPalette(theme: NovaAvatarTheme): OrbPalette {
  const lineAlpha = (index: 0 | 1 | 2) =>
    Math.max(0, Math.min(1, theme.lineOpacities[index] / 100));
  return {
    gradientCenter: { rgb: appliedThemeRgb(theme.gradientCenter), alpha: 1 },
    gradientOuter: { rgb: appliedThemeRgb(theme.gradientOuter), alpha: 1 },
    gradientAlert: { rgb: appliedThemeRgb(theme.gradientAlert), alpha: 1 },
    line1: { rgb: appliedThemeRgb(theme.lineColors[0]), alpha: lineAlpha(0) },
    line2: { rgb: appliedThemeRgb(theme.lineColors[1]), alpha: lineAlpha(1) },
    line3: { rgb: appliedThemeRgb(theme.lineColors[2]), alpha: lineAlpha(2) },
    gymNumber: {
      rgb: appliedThemeRgb(theme.gymNumberColor),
      alpha: Math.max(0, Math.min(1, theme.gymNumberOpacity / 100)),
    },
    innerShadow: { rgb: [0, 0, 0], alpha: theme.innerShadowOpacity },
  };
}
