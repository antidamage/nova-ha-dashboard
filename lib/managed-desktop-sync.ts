import { chmod, mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import {
  copyFileToManagedComputer,
  listManagedComputers,
  remoteLockScreenCommand,
  remoteTerminalRefreshCommand,
  remoteWallpaperCommand,
  remoteWallpaperFileName,
  runManagedComputerSsh,
  type ManagedComputerOrientation,
  type ManagedComputerPublic,
} from "./managed-computers";
import { readWallpaperAssetFile } from "./wallpaper-assets";
import { isComputerSleeping } from "./sleeping-computers";
import { sendThemeChangeNotification } from "./theme-change-notification";

type ThemeVariant = "dark" | "light";

export type ManagedDesktopSyncResult = {
  action: "skipped" | "wallpaper";
  assetId?: string;
  error?: string;
  id: string;
  // Whether this push also replaced the Windows lock/sign-in screen image.
  lockScreen?: boolean;
  name: string;
  ok: boolean;
  reason?: string;
  variant?: ThemeVariant;
};

type AppliedWallpaperRecord = {
  appliedAt: string;
  assetId: string;
  assetSignature: string;
  computerSignature: string;
  // The file the lock screen was pointed at, or null when the target does not
  // take a lock screen image. Records written before lock-screen support read
  // back as null, so the first sync after the upgrade re-pushes once.
  lockScreenFileName: string | null;
  remoteFileName: string;
  variant: ThemeVariant;
};

// What the theme-change webhook was last told about. Kept alongside the
// per-computer records because it is the same question - what has already been
// pushed for this wallpaper - asked for a client that is not a managed
// computer.
type NotifiedWallpaperRecord = {
  assetId: string;
  notifiedAt: string;
  variant: ThemeVariant;
};

type AppliedWallpaperState = {
  notified?: NotifiedWallpaperRecord;
  targets: Record<string, AppliedWallpaperRecord>;
  version: 1;
};

type ManagedDesktopWallpaperPlanTarget = {
  assetId: string | null;
  computer: ManagedComputerPublic;
  reason?: "disabled" | "no-wallpaper";
};

export type ManagedDesktopWallpaperPlan = {
  targets: ManagedDesktopWallpaperPlanTarget[];
  variant: ThemeVariant;
};

type QueuedSyncWaiter = {
  reject: (error: unknown) => void;
  resolve: (value: ManagedDesktopSyncResult[]) => void;
};

type QueuedSyncRequest = {
  options: ManagedDesktopSyncOptions;
  themeValue: unknown;
  waiters: QueuedSyncWaiter[];
};

let pendingSync: QueuedSyncRequest | null = null;
let syncRunning = false;

const APPLY_STATE_PATH =
  process.env.NOVA_MANAGED_DESKTOP_WALLPAPER_STATE ??
  path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "managed-desktop-wallpaper-state.json");

function appliedWallpaperRecord(value: unknown): AppliedWallpaperRecord | null {
  const record = recordValue(value);
  if (
    typeof record?.assetId !== "string"
    || typeof record.assetSignature !== "string"
    || typeof record.computerSignature !== "string"
    || typeof record.remoteFileName !== "string"
    || (record.variant !== "dark" && record.variant !== "light")
    || typeof record.appliedAt !== "string"
  ) {
    return null;
  }
  return {
    appliedAt: record.appliedAt,
    assetId: record.assetId,
    assetSignature: record.assetSignature,
    computerSignature: record.computerSignature,
    lockScreenFileName: typeof record.lockScreenFileName === "string" ? record.lockScreenFileName : null,
    remoteFileName: record.remoteFileName,
    variant: record.variant,
  };
}

async function readAppliedWallpaperState(): Promise<AppliedWallpaperState> {
  try {
    const value = JSON.parse(await readFile(APPLY_STATE_PATH, "utf8")) as unknown;
    const targets = recordValue(recordValue(value)?.targets) ?? {};
    const notified = recordValue(recordValue(value)?.notified);
    return {
      version: 1,
      ...(typeof notified?.assetId === "string"
        && (notified.variant === "dark" || notified.variant === "light")
        && typeof notified.notifiedAt === "string"
        ? {
          notified: {
            assetId: notified.assetId,
            notifiedAt: notified.notifiedAt,
            variant: notified.variant,
          },
        }
        : {}),
      targets: Object.fromEntries(
        Object.entries(targets)
          .map(([id, value]) => [id, appliedWallpaperRecord(value)] as const)
          .filter((entry): entry is [string, AppliedWallpaperRecord] => Boolean(entry[1])),
      ),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, targets: {} };
    }
    throw error;
  }
}

async function writeAppliedWallpaperState(state: AppliedWallpaperState) {
  await mkdir(path.dirname(APPLY_STATE_PATH), { recursive: true });
  const tempPath = `${APPLY_STATE_PATH}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await chmod(tempPath, 0o600).catch(() => undefined);
  await rename(tempPath, APPLY_STATE_PATH);
  await chmod(APPLY_STATE_PATH, 0o600).catch(() => undefined);
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function wallpaperSettings(theme: unknown) {
  const settings = recordValue(recordValue(theme)?.desktopWallpaper);
  return {
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
    const { buildDashboardState } = await import("./ha");
    const state = await buildDashboardState();
    return state.sun?.state === "above_horizon" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function themeVariantValue(themeSet: Record<string, unknown>, variant: ThemeVariant) {
  return recordValue(recordValue(themeSet.themes)?.[variant]);
}

function assetIdForOrientation(
  themeSet: Record<string, unknown>,
  variant: ThemeVariant,
  orientation: ManagedComputerOrientation,
) {
  const settings = wallpaperSettings(themeVariantValue(themeSet, variant));
  if (orientation === "portrait") {
    return settings.portraitAssetId ?? settings.landscapeAssetId;
  }
  return settings.landscapeAssetId;
}

function assetIdForComputer(themeSet: Record<string, unknown>, variant: ThemeVariant, computer: ManagedComputerPublic) {
  return assetIdForOrientation(themeSet, variant, computer.orientation);
}

/**
 * The wallpaper a non-managed client should be showing right now: the same
 * resolved dark/light variant and the same portrait fallback the managed
 * desktops get, without needing an SSH target to ask on behalf of. Used by the
 * iOS Shortcuts endpoint.
 */
export async function currentDesktopWallpaperAssetId(
  themeValue: unknown,
  orientation: ManagedComputerOrientation,
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

function computerWallpaperSignature(computer: ManagedComputerPublic) {
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

function assetSignature(asset: { contentType: string; id: string; size: number; updatedAt: string }) {
  return JSON.stringify({
    contentType: asset.contentType,
    id: asset.id,
    size: asset.size,
    updatedAt: asset.updatedAt,
  });
}

function appliedWallpaperRecordMatches(a: AppliedWallpaperRecord | undefined, b: Omit<AppliedWallpaperRecord, "appliedAt">) {
  return a?.assetId === b.assetId
    && a.assetSignature === b.assetSignature
    && a.computerSignature === b.computerSignature
    && a.lockScreenFileName === b.lockScreenFileName
    && a.remoteFileName === b.remoteFileName;
}

export type ManagedDesktopSyncOptions = {
  force?: boolean;
};

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
    const { asset, filePath } = await readWallpaperAssetFile(assetId);
    const remoteFileName = remoteWallpaperFileName(asset.id, asset.contentType);
    // The lock screen is a Windows-only surface, and it takes the same image
    // the desktop gets rather than a separate asset.
    const lockScreen = computer.platform === "windows" && computer.capabilities.lockScreen;
    const nextApplied = {
      assetId,
      assetSignature: assetSignature(asset),
      computerSignature: computerWallpaperSignature(computer),
      lockScreenFileName: lockScreen ? remoteFileName : null,
      remoteFileName,
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
    if (computer.platform === "windows") {
      // Best effort, and deliberately after the wallpaper is already applied:
      // an open terminal that did not repaint is not a failed sync.
      try {
        await runManagedComputerSsh(computer, remoteTerminalRefreshCommand(computer.platform));
      } catch (error) {
        console.error("[managed-desktop] terminal refresh failed", computer.id, error);
      }
    }
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

function settleSyncRequest(request: QueuedSyncRequest, result: ManagedDesktopSyncResult[] | unknown, ok: boolean) {
  for (const waiter of request.waiters) {
    if (ok) {
      waiter.resolve(result as ManagedDesktopSyncResult[]);
    } else {
      waiter.reject(result);
    }
  }
}

async function runQueuedSync(request: QueuedSyncRequest) {
  try {
    const results = await syncManagedDesktopWallpapers(request.themeValue, request.options);
    settleSyncRequest(request, results, true);
  } catch (error) {
    settleSyncRequest(request, error, false);
    console.error("[managed-desktop] wallpaper sync failed", error);
  } finally {
    const next = pendingSync;
    pendingSync = null;
    if (next) {
      void runQueuedSync(next);
      return;
    }
    syncRunning = false;
  }
}

export function queueManagedDesktopWallpaperSync(themeValue: unknown, options: ManagedDesktopSyncOptions = {}) {
  return new Promise<ManagedDesktopSyncResult[]>((resolve, reject) => {
    const waiter = { reject, resolve };
    if (syncRunning) {
      if (pendingSync) {
        pendingSync.themeValue = themeValue;
        pendingSync.options = options;
        pendingSync.waiters.push(waiter);
        return;
      }
      pendingSync = { options, themeValue, waiters: [waiter] };
      return;
    }

    syncRunning = true;
    void runQueuedSync({ options, themeValue, waiters: [waiter] });
  });
}
