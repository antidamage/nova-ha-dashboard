// Root-layout data: demo-mode flags and public-asset path rewriting, plus the
// server-side reads the layout needs before first paint.
import { readDashboardConfig, readDefaultDashboardConfig } from "../../lib/dashboard-config";
import { readDefaultDashboardPreferences } from "../../lib/default-preferences";
import { readDashboardPreferences } from "../../lib/preferences";
import { themeResponseValue } from "../../lib/theme-values";
import { normalizeVoiceSettings, VOICE_SETTINGS_DEFAULTS } from "../../lib/voice-settings";
import type { ThemeStorageValue } from "../components/accentColor";

export const isDemoMode =process.env.NEXT_PUBLIC_NOVA_DEMO_MODE === "true";
export const demoBasePath = process.env.NEXT_PUBLIC_NOVA_DEMO_BASE_PATH?.trim().replace(/\/+$/, "") ?? "";
export const appleTouchIconSizes = [57, 60, 72, 76, 114, 120, 144, 152, 167, 180] as const;

export function publicAssetPath(path: string) {
  return isDemoMode && demoBasePath ? `${demoBasePath}${path}` : path;
}

// The demo default theme references public assets (e.g. the perturbation
// texture) with root-relative paths. When the demo is served under a base path
// (GitHub Pages: /nova-ha-dashboard), those assets live under that prefix, so we
// rewrite the texture URLs to match before injecting the theme.
export function demoThemeWithAssetPaths<T>(theme: T): T {
  if (!isDemoMode || !demoBasePath) {
    return theme;
  }

  const clone = JSON.parse(JSON.stringify(theme)) as {
    theme?: { themes?: Record<string, { backgroundEffect?: { textureUrl?: string | null } }> };
  };
  const variants = clone.theme?.themes;
  if (variants) {
    for (const variant of Object.values(variants)) {
      const textureUrl = variant?.backgroundEffect?.textureUrl;
      if (typeof textureUrl === "string" && textureUrl.startsWith("/")) {
        variant.backgroundEffect!.textureUrl = publicAssetPath(textureUrl);
      }
    }
  }
  return clone as T;
}

// Same asset-path rewrite as above, but for every saved entry in the demo theme
// library so a theme selected from the library renders its texture correctly.
export function demoThemeLibraryWithAssetPaths<T>(library: T): T {
  if (!isDemoMode || !demoBasePath) {
    return library;
  }

  const clone = JSON.parse(JSON.stringify(library)) as {
    entries?: Array<{ themeSet?: { themes?: Record<string, { backgroundEffect?: { textureUrl?: string | null } }> } }>;
  };
  for (const entry of clone.entries ?? []) {
    const variants = entry?.themeSet?.themes;
    if (!variants) {
      continue;
    }
    for (const variant of Object.values(variants)) {
      const textureUrl = variant?.backgroundEffect?.textureUrl;
      if (typeof textureUrl === "string" && textureUrl.startsWith("/")) {
        variant.backgroundEffect!.textureUrl = publicAssetPath(textureUrl);
      }
    }
  }
  return clone as T;
}


// Resolve the saved shared theme on the server so the status orb canvas can
// paint the correct colours on its first frame. This mirrors exactly what
// GET /api/theme returns (per-variant avatar, with the legacy global avatar as
// fallback); the orb otherwise has no synchronous source and flashes the
// compiled-in default until the client-side /api/theme fetch lands. Demo mode
// serves the theme through a client-side fetch shim, so it stays null here.
export async function readInitialOrbTheme(): Promise<ThemeStorageValue | null> {
  if (isDemoMode) {
    try {
      const [preferences, config] = await Promise.all([
        readDefaultDashboardPreferences(),
        readDefaultDashboardConfig(),
      ]);
      return themeResponseValue(preferences.theme, config.dashboard.avatar) as ThemeStorageValue | null;
    } catch {
      return null;
    }
  }

  try {
    const [preferences, config] = await Promise.all([
      readDashboardPreferences(),
      readDashboardConfig(),
    ]);
    return themeResponseValue(preferences.theme, config.dashboard.avatar) as ThemeStorageValue | null;
  } catch {
    // Fall back to the client's existing cache/default path on any read error.
    return null;
  }
}

export async function readInitialAgentName(): Promise<string> {
  if (isDemoMode) {
    return "Johnny Silverhand";
  }
  try {
    return normalizeVoiceSettings((await readDashboardPreferences()).voice).agentName;
  } catch {
    return VOICE_SETTINGS_DEFAULTS.agentName;
  }
}
