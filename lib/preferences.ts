import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { readDefaultDashboardPreferences } from "./default-preferences";
import { ensureGenesis, recordPreferencesRevision } from "./preferences-history";
import { DashboardPreferences } from "./types";

const PREFERENCES_PATH =
  process.env.NOVA_DASHBOARD_PREFERENCES ?? path.join(process.cwd(), "data", "dashboard-preferences.json");

let writeQueue = Promise.resolve();

/**
 * Serialise a preference write behind every earlier one.
 *
 * The queue deliberately tracks only COMPLETION, never failure. Chaining with a
 * plain `writeQueue = writeQueue.then(work)` looks equivalent but is a trap: one
 * rejected write leaves `writeQueue` permanently rejected, so every later
 * `.then` short-circuits and the whole process can never write preferences again
 * until it restarts — each caller getting the first failure's stale error rather
 * than its own. Observed 2026-08-15: a single unparseable preferences file made
 * every subsequent save fail while reads kept working.
 *
 * Passing `work` as BOTH handlers runs it whether the previous write settled or
 * threw, which keeps ordering intact while isolating failures to their caller.
 */
function enqueueWrite<T>(work: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(work, work);
  writeQueue = result.then(() => undefined, () => undefined);
  return result;
}

function withoutUndefined<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>;
}

export async function readDashboardPreferences(): Promise<DashboardPreferences> {
  try {
    const raw = await readFile(PREFERENCES_PATH, "utf8");
    // Strip a UTF-8 BOM before parsing. JSON.parse rejects one outright, and any
    // Windows-side tool that rewrites this file (PowerShell's `Out-File
    // -Encoding utf8` is the usual culprit) adds one silently — which otherwise
    // makes the whole preference store unreadable over an invisible character.
    return JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw) as DashboardPreferences;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return readDefaultDashboardPreferences();
    }
    throw error;
  }
}

export async function mergeDashboardPreferences(next: DashboardPreferences) {
  await enqueueWrite(async () => {
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

    // Must deep-merge like aircon/panelHeater above. Without this branch the
    // top-level spread REPLACES the whole object, so a request that sets only
    // the auto window silently erases mode and temperature — which strands the
    // server thermostat (it sees no "auto" and stands down mid-heat).
    if (next.bedroomHeater) {
      merged.bedroomHeater = {
        ...(current.bedroomHeater ?? {}),
        ...withoutUndefined(next.bedroomHeater as Record<string, unknown>),
        updatedAt: new Date().toISOString(),
      };
    }

    // Same hazard as bedroomHeater above, one level deeper. A patch names ONE
    // instance and usually ONE field of it, so both levels must merge: the
    // top-level spread would drop every other instance, and replacing the
    // instance would erase the rest of that device's settings — stranding its
    // thermostat exactly as described above.
    if (next.climate) {
      const nextClimate = next.climate as NonNullable<DashboardPreferences["climate"]>;
      const mergedClimate: NonNullable<DashboardPreferences["climate"]> = { ...(current.climate ?? {}) };
      for (const [instanceId, entry] of Object.entries(nextClimate)) {
        if (!entry) continue;
        const existing = mergedClimate[instanceId] ?? {};
        mergedClimate[instanceId] = {
          ...existing,
          ...(entry.aircon
            ? {
                aircon: {
                  ...(existing.aircon ?? {}),
                  ...withoutUndefined(entry.aircon as Record<string, unknown>),
                  updatedAt: new Date().toISOString(),
                },
              }
            : {}),
          ...(entry.heater
            ? {
                heater: {
                  ...(existing.heater ?? {}),
                  ...withoutUndefined(entry.heater as Record<string, unknown>),
                  updatedAt: new Date().toISOString(),
                },
              }
            : {}),
        };
      }
      merged.climate = mergedClimate;
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

    // Two levels deep, and BOTH need merging. The top-level spread would replace
    // the whole orbInfo object (losing every module's display config when only
    // the selected module changes), and a plain orbInfo spread would replace the
    // whole `modules` map (losing every OTHER module's config when one is
    // edited). Saving the gym's decimal places must not wipe the clock's
    // 12-hour setting.
    if (next.orbInfo) {
      merged.orbInfo = {
        ...(current.orbInfo ?? {}),
        ...withoutUndefined(next.orbInfo as Record<string, unknown>),
        modules: {
          ...(current.orbInfo?.modules ?? {}),
          ...(next.orbInfo.modules ?? {}),
        },
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
      // `companionRoutes` is a nested object inside `voice`, so the spread
      // above replaces it wholesale — a request that moves one reasoning pass
      // would silently reset every other pass to the server's default. Merged
      // per pass so each dropdown only ever changes its own row.
      if (next.voice.companionRoutes) {
        merged.voice.companionRoutes = {
          ...(current.voice?.companionRoutes ?? {}),
          ...next.voice.companionRoutes,
        };
      }
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
        // House Party carries an on/off plus two colour-behaviour modes, and
        // callers legitimately write only one of them — the voice `nova.mode`
        // tool flips `enabled` alone. Without this branch the outer spread
        // replaces the whole object and silently drops the other two.
        ...(next.phonoscope.houseParty
          ? {
            houseParty: {
              ...(current.phonoscope?.houseParty ?? {}),
              ...withoutUndefined(next.phonoscope.houseParty as Record<string, unknown>),
            } as NonNullable<typeof current.phonoscope>["houseParty"],
          }
          : {}),
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
  await enqueueWrite(async () => {
    const current = await readDashboardPreferences();
    await mkdir(path.dirname(PREFERENCES_PATH), { recursive: true });
    const tempPath = `${PREFERENCES_PATH}.${process.pid}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    await rename(tempPath, PREFERENCES_PATH);
    await ensureGenesis(current);
    await recordPreferencesRevision(current, next);
  });
}
