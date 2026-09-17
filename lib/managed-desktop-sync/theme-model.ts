// Pure: reading wallpaper settings out of a theme set, and the signatures that
// decide whether a computer needs a fresh push.
import type { ManagedComputerPublic } from "../managed-computers/types";
import type { AppliedWallpaperRecord, ThemeVariant, WallpaperClientOrientation } from "./types";

export function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function wallpaperSettings(theme: unknown) {
  const settings = recordValue(recordValue(theme)?.desktopWallpaper);
  return {
    ipadAssetId: typeof settings?.ipadAssetId === "string" ? settings.ipadAssetId : null,
    landscapeAssetId: typeof settings?.landscapeAssetId === "string" ? settings.landscapeAssetId : null,
    portraitAssetId: typeof settings?.portraitAssetId === "string" ? settings.portraitAssetId : null,
  };
}

function themeSelection(themeSet: Record<string, unknown>) {
  return themeSet.selection === "light" || themeSet.selection === "auto" ? themeSet.selection : "dark";
}

function desktopWallpaperSignatureForVariant(themeSet: Record<string, unknown>, variant: ThemeVariant) {
  const settings = wallpaperSettings(themeVariantValue(themeSet, variant));
  return JSON.stringify(settings);
}

export function managedDesktopThemeChangeMayAffectWallpaper(previousThemeValue: unknown, nextThemeValue: unknown) {
  const previousThemeSet = recordValue(previousThemeValue);
  const nextThemeSet = recordValue(nextThemeValue);
  if (!previousThemeSet || !nextThemeSet) {
    return true;
  }

  const previousSelection = themeSelection(previousThemeSet);
  const nextSelection = themeSelection(nextThemeSet);
  if (previousSelection !== nextSelection) {
    return true;
  }

  const variants: ThemeVariant[] = nextSelection === "auto" ? ["dark", "light"] : [nextSelection];
  return variants.some((variant) =>
    desktopWallpaperSignatureForVariant(previousThemeSet, variant) !== desktopWallpaperSignatureForVariant(nextThemeSet, variant));
}

function themeVariantValue(themeSet: Record<string, unknown>, variant: ThemeVariant) {
  return recordValue(recordValue(themeSet.themes)?.[variant]);
}

export function assetIdForOrientation(
  themeSet: Record<string, unknown>,
  variant: ThemeVariant,
  orientation: WallpaperClientOrientation,
) {
  const settings = wallpaperSettings(themeVariantValue(themeSet, variant));
  if (orientation === "portrait") {
    return settings.portraitAssetId ?? settings.landscapeAssetId;
  }
  if (orientation === "ipad") {
    return settings.ipadAssetId ?? settings.landscapeAssetId;
  }
  return settings.landscapeAssetId;
}

export function assetIdForComputer(themeSet: Record<string, unknown>, variant: ThemeVariant, computer: ManagedComputerPublic) {
  return assetIdForOrientation(themeSet, variant, computer.orientation);
}

export function computerWallpaperSignature(computer: ManagedComputerPublic) {
  return JSON.stringify({
    address: computer.address,
    hostKey: computer.hostKey,
    id: computer.id,
    lockScreen: computer.capabilities.lockScreen,
    orientation: computer.orientation,
    platform: computer.platform,
    port: computer.port ?? 22,
    username: computer.username,
  });
}

export function assetSignature(asset: { contentType: string; id: string; size: number; updatedAt: string }) {
  return JSON.stringify({
    contentType: asset.contentType,
    id: asset.id,
    size: asset.size,
    updatedAt: asset.updatedAt,
  });
}

export function appliedWallpaperRecordMatches(a: AppliedWallpaperRecord | undefined, b: Omit<AppliedWallpaperRecord, "appliedAt">) {
  return a?.assetId === b.assetId
    && a.assetSignature === b.assetSignature
    && a.computerSignature === b.computerSignature
    && a.lockScreenFileName === b.lockScreenFileName
    && a.remoteFileName === b.remoteFileName
    && a.themeActionSignature === b.themeActionSignature;
}
