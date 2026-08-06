import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { readDefaultDashboardPreferences } from "./default-preferences";
import { ensureGenesis, recordPreferencesRevision } from "./preferences-history";
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
      return readDefaultDashboardPreferences();
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

    if (next.panelHeater) {
      merged.panelHeater = {
        ...(current.panelHeater ?? {}),
        ...withoutUndefined(next.panelHeater as Record<string, unknown>),
        updatedAt: new Date().toISOString(),
      };
    }

    if (next.lighting) {
      const nextLighting = withoutUndefined(next.lighting as Record<string, unknown>);
      merged.lighting = {
        ...(current.lighting ?? {}),
        ...nextLighting,
        adaptiveCandlelightZones: {
          ...(current.lighting?.adaptiveCandlelightZones ?? {}),
          ...(next.lighting.adaptiveCandlelightZones ?? {}),
        },
        housePartyZones: {
          ...(current.lighting?.housePartyZones ?? {}),
          ...(next.lighting.housePartyZones ?? {}),
        },
        updatedAt: new Date().toISOString(),
      };
    }

    if (next.watchface) {
      merged.watchface = {
        ...(current.watchface ?? {}),
        ...withoutUndefined(next.watchface as Record<string, unknown>),
        updatedAt: new Date().toISOString(),
      };
    }

    if (next.agent) {
      merged.agent = {
        ...(current.agent ?? {}),
        ...withoutUndefined(next.agent as Record<string, unknown>),
        updatedAt: new Date().toISOString(),
      };
    }

    if (next.voice) {
      merged.voice = {
        ...(current.voice ?? {}),
        ...withoutUndefined(next.voice as Record<string, unknown>),
        updatedAt: new Date().toISOString(),
      };
    }

    if (next.update) {
      merged.update = {
        ...(current.update ?? {}),
        ...withoutUndefined(next.update as Record<string, unknown>),
        updatedAt: new Date().toISOString(),
      };
    }

    if (next.phonoscope) {
      merged.phonoscope = {
        ...(current.phonoscope ?? {}),
        ...withoutUndefined(next.phonoscope as Record<string, unknown>),
        providers: {
          ...(current.phonoscope?.providers ?? {}),
          ...(next.phonoscope.providers ?? {}),
        },
        moduleSettings: {
          ...(current.phonoscope?.moduleSettings ?? {}),
          ...(next.phonoscope.moduleSettings ?? {}),
        },
        updatedAt: new Date().toISOString(),
      };
    }

    await mkdir(path.dirname(PREFERENCES_PATH), { recursive: true });
    const tempPath = `${PREFERENCES_PATH}.${process.pid}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
    await rename(tempPath, PREFERENCES_PATH);

    // Recorded after the save succeeds, inside the same queued turn, so the
    // history can never claim a revision for a write that did not land. It
    // swallows its own failures: losing an undo point must not fail the save.
    await ensureGenesis(current);
    await recordPreferencesRevision(current, merged);
  });

  await writeQueue;
}

/**
 * Writes the document exactly as given, rather than merging it over the current
 * one.
 *
 * The history restore needs this: merging cannot express a removal, so
 * "put lighting back to how it was" would silently keep any key that has been
 * added since. A restore is a statement about the whole of the selected
 * branches, so it has to be able to take things away.
 */
export async function replaceDashboardPreferences(next: DashboardPreferences) {
  writeQueue = writeQueue.then(async () => {
    const current = await readDashboardPreferences();
    await mkdir(path.dirname(PREFERENCES_PATH), { recursive: true });
    const tempPath = `${PREFERENCES_PATH}.${process.pid}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    await rename(tempPath, PREFERENCES_PATH);
    await ensureGenesis(current);
    await recordPreferencesRevision(current, next);
  });

  await writeQueue;
}
