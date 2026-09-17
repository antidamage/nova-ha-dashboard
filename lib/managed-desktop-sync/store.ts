// Sole owner of the applied-wallpaper record on disk: what each computer and
// the theme-change webhook were last given.
import { chmod, mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { recordValue } from "./theme-model";
import type { AppliedWallpaperRecord, AppliedWallpaperState } from "./types";

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
    themeActionSignature: typeof record.themeActionSignature === "string" ? record.themeActionSignature : null,
    variant: record.variant,
  };
}

export async function readAppliedWallpaperState(): Promise<AppliedWallpaperState> {
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

export async function writeAppliedWallpaperState(state: AppliedWallpaperState) {
  await mkdir(path.dirname(APPLY_STATE_PATH), { recursive: true });
  const tempPath = `${APPLY_STATE_PATH}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await chmod(tempPath, 0o600).catch(() => undefined);
  await rename(tempPath, APPLY_STATE_PATH);
  await chmod(APPLY_STATE_PATH, 0o600).catch(() => undefined);
}
