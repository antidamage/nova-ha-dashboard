// Status Orb module format: a module's stored setting history.
//
// A setting that gets renamed or retyped (the Tech knob's boolean `light`
// becoming the `knobTheme` choice) would otherwise leave the owner's saved
// value orphaned under an id nothing declares, and the orb would quietly fall
// back to the default. This is where a module's own `settingMigrations` turn
// that stale value into the stop it always meant.
//
// Its own file rather than a section of settings-model.ts: this is stored-data
// revision, not per-frame resolution, and settings-model.ts is the file every
// renderer reads.

import type {
  OrbModuleSettingDecl,
  OrbModuleSettingMigration,
} from "./types";
import type { OrbModule } from "./layer-types";
import { clamp } from "./value-model";

/**
 * Apply a module's `settingMigrations` to a saved settings group, filling in
 * any setting whose own id is absent from an id an earlier version stored it
 * under. Today's value always wins; history only fills a gap. Ids the module
 * never declared are left alone, so an unknown setting stays unknown rather
 * than being silently redeclared.
 *
 * A band naming a stop is resolved against the setting's own `options`; a band
 * naming a number is written through. A band that names a stop the setting no
 * longer declares is ignored, which leaves the setting at its declared default
 * rather than at a wrong stop.
 */
export function migrateOrbModuleSettings(
  module: OrbModule,
  saved?: Record<string, number> | null,
): Record<string, number> {
  const given = saved ?? {};
  const migrations = module.settingMigrations;
  if (!migrations || migrations.length === 0) return { ...given };
  const migrated: Record<string, number> = { ...given };
  const declarations = new Map((module.settings ?? []).map((decl) => [decl.id, decl]));
  for (const migration of migrations) {
    const decl = declarations.get(migration.to);
    if (!decl || Number.isFinite(Number(given[migration.to]))) continue;
    for (const legacyId of migration.from) {
      const legacy = Number(given[legacyId]);
      if (given[legacyId] === undefined || !Number.isFinite(legacy)) continue;
      const band = migrationBand(migration.bands, legacy);
      const value = migrationBandValue(decl, band);
      if (value !== undefined) {
        migrated[migration.to] = value;
        break;
      }
    }
  }
  return migrated;
}

/**
 * The band a legacy value falls in: the one with the HIGHEST `min` the value
 * reaches. Selected by comparing the floors rather than by taking the last
 * match in array order, because a module written in TypeScript is never run
 * through `normalizeOrbMigrationBands` and so is not guaranteed to list its
 * bands in ascending order.
 */
function migrationBand(bands: OrbModuleSettingMigration["bands"], legacy: number) {
  let match: OrbModuleSettingMigration["bands"][number] | undefined;
  for (const band of bands) {
    if (legacy >= band.min && (match === undefined || band.min > match.min)) match = band;
  }
  return match;
}

/** A band's value as the declaration's own number; undefined when unusable. */
function migrationBandValue(
  decl: OrbModuleSettingDecl,
  band: OrbModuleSettingMigration["bands"][number] | undefined,
): number | undefined {
  if (!band) return undefined;
  // Stop names are user-facing labels, so match them case-insensitively. A
  // name the setting no longer declares migrates nothing, leaving the setting
  // at its own default rather than at whatever band happened to be last.
  const wanted = band.name.toLowerCase();
  const index = decl.options?.findIndex((option) => option.toLowerCase() === wanted) ?? -1;
  return index < 0 ? undefined : clamp(decl.min + index * decl.step, decl.min, decl.max);
}
