// Which wallpaper each target should show: the resolved dark/light variant,
// the per-computer plan, and the plan signature.
import { listManagedComputers } from "../managed-computers";
import { assetIdForComputer, assetIdForOrientation, recordValue } from "./theme-model";
import type { ManagedDesktopWallpaperPlan, ThemeVariant, WallpaperClientOrientation } from "./types";

// Exported because the theme API's `?variant=resolved` form needs the identical
// dark/light decision. The GPU visualiser reads the theme to drive its fluid
// backdrop, and a second implementation of this rule in C++ would be a third
// place for the three engines to disagree about what colour the room is.
export async function resolveThemeVariant(themeSet: Record<string, unknown>): Promise<ThemeVariant> {
  if (themeSet.selection === "light") {
    return "light";
  }
  if (themeSet.selection === "dark") {
    return "dark";
  }

  try {
    const { buildDashboardState } = await import("../ha");
    const state = await buildDashboardState();
    return state.sun?.state === "above_horizon" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

/**
 * The wallpaper a non-managed client should be showing right now: the same
 * resolved dark/light variant and the same portrait fallback the managed
 * desktops get, without needing an SSH target to ask on behalf of. Used by the
 * iOS Shortcuts endpoint.
 */
export async function currentDesktopWallpaperAssetId(
  themeValue: unknown,
  orientation: WallpaperClientOrientation,
): Promise<{ assetId: string | null; variant: ThemeVariant } | null> {
  const themeSet = recordValue(themeValue);
  if (!themeSet) {
    return null;
  }
  const variant = await resolveThemeVariant(themeSet);
  return { assetId: assetIdForOrientation(themeSet, variant, orientation), variant };
}

export async function createManagedDesktopWallpaperPlan(themeValue: unknown): Promise<ManagedDesktopWallpaperPlan | null> {
  const themeSet = recordValue(themeValue);
  if (!themeSet) {
    return null;
  }
  const variant = await resolveThemeVariant(themeSet);
  const computers = await listManagedComputers();
  const targets = computers.map((computer) => {
    if (!computer.enabled || !computer.capabilities.wallpaper) {
      return { assetId: null, computer, reason: "disabled" as const };
    }
    const assetId = assetIdForComputer(themeSet, variant, computer);
    return assetId
      ? { assetId, computer }
      : { assetId: null, computer, reason: "no-wallpaper" as const };
  });
  return { targets, variant };
}

export async function managedDesktopWallpaperSignature(themeValue: unknown): Promise<string> {
  const plan = await createManagedDesktopWallpaperPlan(themeValue);
  if (!plan) {
    return "no-theme";
  }
  return JSON.stringify({
    targets: plan.targets.map(({ assetId, computer, reason }) => ({
      assetId,
      enabled: computer.enabled,
      id: computer.id,
      lockScreen: computer.capabilities.lockScreen,
      orientation: computer.orientation,
      platform: computer.platform,
      reason,
      wallpaper: computer.capabilities.wallpaper,
    })),
  });
}

export async function managedDesktopWallpaperNeedsSync(previousThemeValue: unknown, nextThemeValue: unknown) {
  return await managedDesktopWallpaperSignature(previousThemeValue) !== await managedDesktopWallpaperSignature(nextThemeValue);
}
