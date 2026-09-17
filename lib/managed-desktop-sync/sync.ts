// The push: copy and apply each computer's wallpaper over SSH, run the
// per-application theme actions, and notify the theme-change webhook.
import {
  copyFileToManagedComputer,
  remoteLockScreenCommand,
  remoteWallpaperCommand,
  remoteWallpaperFileName,
  runManagedComputerSsh,
} from "../managed-computers";
import { desktopThemeActionSignature, runDesktopThemeActions, type ThemeActionContext } from "../desktop-theme-actions";
import { readWallpaperAssetFile } from "../wallpaper-assets";
import { clampForContrast, highlightColorForAsset } from "../wallpaper-color";
import { isComputerSleeping } from "../sleeping-computers";
import { sendThemeChangeNotification } from "../theme-change-notification";
import { createManagedDesktopWallpaperPlan, currentDesktopWallpaperAssetId } from "./plan";
import { readAppliedWallpaperState, writeAppliedWallpaperState } from "./store";
import { appliedWallpaperRecordMatches, assetSignature, computerWallpaperSignature } from "./theme-model";
import type {
  AppliedWallpaperRecord,
  AppliedWallpaperState,
  ManagedDesktopSyncOptions,
  ManagedDesktopSyncResult,
  ManagedDesktopWallpaperPlanTarget,
  ThemeVariant,
} from "./types";

async function syncComputerWallpaper(
  variant: ThemeVariant,
  target: ManagedDesktopWallpaperPlanTarget,
  state: AppliedWallpaperState,
  options: ManagedDesktopSyncOptions,
): Promise<ManagedDesktopSyncResult & { applied?: AppliedWallpaperRecord }> {
  const { assetId, computer } = target;
  if (!computer.enabled || !computer.capabilities.wallpaper) {
    return {
      action: "skipped",
      id: computer.id,
      name: computer.name,
      ok: true,
      reason: target.reason ?? "disabled",
      variant,
    };
  }

  // The machine was just told to sleep. Pushing a wallpaper over SSH now would
  // wake it straight back up, so stand down until the suppression window lapses.
  if (isComputerSleeping(computer.id)) {
    return {
      action: "skipped",
      id: computer.id,
      name: computer.name,
      ok: true,
      reason: "sleeping",
      variant,
    };
  }

  if (!assetId) {
    return {
      action: "skipped",
      id: computer.id,
      name: computer.name,
      ok: true,
      reason: target.reason ?? "no-wallpaper",
      variant,
    };
  }

  try {
    const { asset, data, filePath } = await readWallpaperAssetFile(assetId);
    const remoteFileName = remoteWallpaperFileName(asset.id, asset.contentType);
    // The lock screen is a Windows-only surface, and it takes the same image
    // the desktop gets rather than a separate asset.
    const lockScreen = computer.platform === "windows" && computer.capabilities.lockScreen;
    // The theme's accent, as the per-application actions will paint it. Taken
    // from the same bytes the desktop is about to receive, so an application's
    // colour always belongs to the picture on the wall behind it.
    const highlight = clampForContrast(await highlightColorForAsset(asset, data));
    const actionContext: ThemeActionContext = { assetId, computer, highlight, remoteFileName, variant };
    const nextApplied = {
      assetId,
      assetSignature: assetSignature(asset),
      computerSignature: computerWallpaperSignature(computer),
      lockScreenFileName: lockScreen ? remoteFileName : null,
      remoteFileName,
      themeActionSignature: desktopThemeActionSignature(actionContext),
      variant,
    };
    if (!options.force && appliedWallpaperRecordMatches(state.targets[computer.id], nextApplied)) {
      return {
        action: "skipped",
        assetId,
        id: computer.id,
        name: computer.name,
        ok: true,
        reason: "unchanged-wallpaper",
        variant,
      };
    }

    await copyFileToManagedComputer(computer, filePath, remoteFileName);
    await runManagedComputerSsh(computer, remoteWallpaperCommand(computer.platform, remoteFileName));
    if (lockScreen) {
      await runManagedComputerSsh(computer, remoteLockScreenCommand(computer.platform, remoteFileName));
    }
    // Per-application theme actions, deliberately after the desktop and lock
    // screen are already applied: an application that did not repaint is not a
    // failed sync. Each action swallows its own failures - see
    // lib/desktop-theme-actions.ts.
    await runDesktopThemeActions(actionContext);
    return {
      action: "wallpaper",
      applied: {
        ...nextApplied,
        appliedAt: new Date().toISOString(),
      },
      assetId,
      id: computer.id,
      lockScreen,
      name: computer.name,
      ok: true,
      variant,
    };
  } catch (error) {
    return {
      action: "wallpaper",
      assetId,
      error: error instanceof Error ? error.message : "Wallpaper sync failed",
      id: computer.id,
      name: computer.name,
      ok: false,
      variant,
    };
  }
}

export async function syncManagedDesktopWallpapers(
  themeValue: unknown,
  options: ManagedDesktopSyncOptions = {},
): Promise<ManagedDesktopSyncResult[]> {
  const plan = await createManagedDesktopWallpaperPlan(themeValue);
  if (!plan) {
    return [];
  }
  const state = await readAppliedWallpaperState();
  const results = await Promise.all(plan.targets.map((target) => syncComputerWallpaper(plan.variant, target, state, options)));
  const applied = results.filter((result) => result.ok && result.applied);
  // Phones are not managed computers, so the webhook is decided from the
  // theme's own resolved wallpaper rather than from what any desktop did. A
  // house with no managed computers at all still notifies.
  const notified = await notifyThemeChange(themeValue, plan.variant, state, options);
  if (applied.length > 0 || notified) {
    const nextState: AppliedWallpaperState = {
      version: 1,
      ...(notified ?? (state.notified ? { notified: state.notified } : {})),
      targets: { ...state.targets },
    };
    for (const result of applied) {
      nextState.targets[result.id] = result.applied!;
    }
    await writeAppliedWallpaperState(nextState);
  }
  return results.map(({ applied: _applied, ...result }) => result);
}

/**
 * Call the theme-change webhook when the wallpaper a phone would fetch has
 * changed since the last notification. `force` (the manual Apply button)
 * notifies regardless, for the same reason it re-pushes desktops: it is the
 * repair path.
 *
 * Returns the state fragment to persist, or null when nothing was sent. A
 * webhook failure is logged and dropped - it must never fail a wallpaper sync
 * that otherwise worked, and the unchanged state means the next sync retries.
 */
async function notifyThemeChange(
  themeValue: unknown,
  variant: ThemeVariant,
  state: AppliedWallpaperState,
  options: ManagedDesktopSyncOptions,
): Promise<Pick<AppliedWallpaperState, "notified"> | null> {
  const resolved = await currentDesktopWallpaperAssetId(themeValue, "portrait");
  if (!resolved?.assetId) {
    return null;
  }
  if (!options.force && state.notified?.assetId === resolved.assetId && state.notified.variant === variant) {
    return null;
  }

  const result = await sendThemeChangeNotification({ assetId: resolved.assetId, variant });
  if (!result.sent) {
    if (result.error) {
      console.error("[managed-desktop] theme change notification failed", result.error);
    }
    return null;
  }
  return {
    notified: {
      assetId: resolved.assetId,
      notifiedAt: new Date().toISOString(),
      variant,
    },
  };
}
