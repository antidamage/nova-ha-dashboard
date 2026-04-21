import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { DashboardPreferences } from "./types";

const PREFERENCES_PATH =
  process.env.NOVA_DASHBOARD_PREFERENCES ?? path.join(process.cwd(), "data", "dashboard-preferences.json");

let writeQueue = Promise.resolve();

function withoutUndefined<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>;
}

export async function readDashboardPreferences(): Promise<DashboardPreferences> {
  try {
    return JSON.parse(await readFile(PREFERENCES_PATH, "utf8")) as DashboardPreferences;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

export async function mergeDashboardPreferences(next: DashboardPreferences) {
  writeQueue = writeQueue.then(async () => {
    const current = await readDashboardPreferences();
    const merged: DashboardPreferences = {
      ...current,
      ...withoutUndefined(next as Record<string, unknown>),
    };

    if (next.aircon) {
      merged.aircon = {
        ...(current.aircon ?? {}),
        ...withoutUndefined(next.aircon as Record<string, unknown>),
        updatedAt: new Date().toISOString(),
      };
    }

    await mkdir(path.dirname(PREFERENCES_PATH), { recursive: true });
    const tempPath = `${PREFERENCES_PATH}.${process.pid}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
    await rename(tempPath, PREFERENCES_PATH);
  });

  await writeQueue;
}
