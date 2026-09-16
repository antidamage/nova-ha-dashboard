import { readDashboardPreferences } from "../preferences";
import { migratePhonoscopeToV3 } from "../phonoscope-migrate-v3";
import {
  migratePhonoscopeModuleSettingsToPercent,
  migratePhonoscopeScalarsToPercent,
  migratePhonoscopeSettingsGroupsToPercent,
  PHONOSCOPE_PERCENT_GEOMETRY_VERSION,
} from "../phonoscope-migrate-v4";
import {
  migratePhonoscopeRandomLanes,
  PHONOSCOPE_RANDOM_SPLIT_VERSION,
} from "../phonoscope-migrate-v5";
import {
  migratePhonoscopeCentreScalars,
  migratePhonoscopeCentreSettingsGroups,
  migratePhonoscopeProportionalDefault,
  PHONOSCOPE_SCHEMA_VERSION,
  PHONOSCOPE_WIDTH_AUTHORED_VERSION,
} from "../phonoscope-migrate-v6";
import { finiteClamped, isRecord, normalizePhonoscopeColorThemes } from "./color-model";
import { DEFAULT_PHONOSCOPE_CONFIG, RETIRED_PHONOSCOPE_MODULE_IDS } from "./constants";
import { normalizeHouseParty, normalizePhonoscopeColorGroups, withDefaultSettingsGroup } from "./groups-model";
import { normalizePhonoscopeSettingsGroups } from "./lanes-model";
import type { PhonoscopeConfig } from "./types";

/**
 * Reads the stored configuration, converting a pre-lane one on the way through.
 *
 * The conversion is not persisted here: a read stays free of side effects, and
 * the next write puts the v3 shape on disk. Until then every reader — both
 * engines included — sees the same migrated view.
 */
export async function readPhonoscopeConfig(): Promise<PhonoscopeConfig> {
  const preferences = await readDashboardPreferences();
  const raw = (preferences.phonoscope ?? {}) as Record<string, unknown>;
  const needsMigration = !Array.isArray(raw.settingsGroups) || raw.settingsGroups.length === 0;
  const migrated = needsMigration ? migratePhonoscopeToV3(raw) : null;

  // Each conversion is gated on the version it applies below, not on the
  // current one — otherwise the next schema bump would re-run every earlier
  // conversion over data that has already had it. Converting on read (never
  // persisting here) keeps this consistent with the v3 conversion above; the
  // next write stamps `schemaVersion` and it stops happening.
  //
  // v4 turned the frame and lattice geometry into percentages: a configuration
  // written before it carries 0-1 values that would clamp to near-zero on the
  // new axes.
  const storedVersion = Number(raw.schemaVersion ?? 0);
  const needsPercentGeometry = storedVersion < PHONOSCOPE_PERCENT_GEOMETRY_VERSION;
  // v5 split the random driver into random timing and random value: a random
  // lane written before it needs both halves turned on to keep its character.
  const needsRandomSplit = storedVersion < PHONOSCOPE_RANDOM_SPLIT_VERSION;
  // v6 made the centre slot width-authored like the backdrop, which inverts the
  // arithmetic a stored `__centreHeight` was chosen under.
  const needsWidthAuthored = storedVersion < PHONOSCOPE_WIDTH_AUTHORED_VERSION;

  const activeModuleId = typeof raw.activeModuleId === "string"
    ? raw.activeModuleId
    : DEFAULT_PHONOSCOPE_CONFIG.activeModuleId;
  // v5 runs before normalisation because normalisation drops the driver's old
  // `transitionSeconds` — the very value it converts.
  const storedGroups = migrated ? migrated.settingsGroups : raw.settingsGroups;
  const normalizedSettingsGroups = withDefaultSettingsGroup(
    normalizePhonoscopeSettingsGroups(
      needsRandomSplit ? migratePhonoscopeRandomLanes(storedGroups) : storedGroups,
    ),
    activeModuleId,
  );
  const percentGeometrySettingsGroups = needsPercentGeometry
    ? migratePhonoscopeSettingsGroupsToPercent(normalizedSettingsGroups)
    : normalizedSettingsGroups;
  const colorThemes = normalizePhonoscopeColorThemes(
    migrated ? migrated.colorThemes : raw.colorThemes);
  const settingsGroups = needsWidthAuthored
    ? migratePhonoscopeCentreSettingsGroups(percentGeometrySettingsGroups)
    : percentGeometrySettingsGroups;
  const colorGroups = normalizePhonoscopeColorGroups(
    migrated ? migrated.colorGroups : raw.colorGroups, colorThemes, settingsGroups);

  const validColorGroupIds = new Set(colorGroups.map((group) => group.id));
  const rawAssignments = isRecord(raw.moduleColorGroupIds) ? raw.moduleColorGroupIds : {};
  const moduleColorGroupIds = Object.fromEntries(
    Object.entries(rawAssignments).flatMap(([moduleId, groupId]) =>
      typeof groupId === "string"
        && validColorGroupIds.has(groupId)
        && colorGroups.some((group) => group.id === groupId && group.moduleId === moduleId)
        ? [[moduleId, groupId]]
        : []),
  );

  const withoutRetiredModules = <T>(value: unknown): Record<string, T> =>
    Object.fromEntries(Object.entries(isRecord(value) ? value : {})
      .filter(([moduleId]) => !RETIRED_PHONOSCOPE_MODULE_IDS.has(moduleId))) as Record<string, T>;

  const percentGeometry = (value: Record<string, Record<string, number>>) =>
    needsPercentGeometry ? migratePhonoscopeModuleSettingsToPercent(value) : value;

  const previewGroupId = typeof raw.editorPreviewColorGroupId === "string"
    ? raw.editorPreviewColorGroupId
    : "";
  const previewGroup = colorGroups.find((group) => group.id === previewGroupId);
  const previewEntryId = typeof raw.editorPreviewColorEntryId === "string"
    ? raw.editorPreviewColorEntryId
    : "";

  return {
    ...DEFAULT_PHONOSCOPE_CONFIG,
    activeModuleId,
    activeModuleVersion: typeof raw.activeModuleVersion === "string"
      ? raw.activeModuleVersion
      : DEFAULT_PHONOSCOPE_CONFIG.activeModuleVersion,
    idleBehavior: ["ambient", "black", "return"].includes(String(raw.idleBehavior))
      ? raw.idleBehavior as PhonoscopeConfig["idleBehavior"]
      : DEFAULT_PHONOSCOPE_CONFIG.idleBehavior,
    // Capped at an hour: past that it is indistinguishable from off, and the
    // control would be mostly dead travel.
    screensaverSeconds: finiteClamped(
      raw.screensaverSeconds, DEFAULT_PHONOSCOPE_CONFIG.screensaverSeconds, 0, 3_600),
    message: typeof raw.message === "string" ? raw.message : "",
    statusOverlay: typeof raw.statusOverlay === "boolean"
      ? raw.statusOverlay
      : DEFAULT_PHONOSCOPE_CONFIG.statusOverlay,
    transitionMs: finiteClamped(raw.transitionMs, DEFAULT_PHONOSCOPE_CONFIG.transitionMs, 0, 3_000),
    providers: { ...DEFAULT_PHONOSCOPE_CONFIG.providers, ...(isRecord(raw.providers) ? raw.providers : {}) },
    schemaVersion: PHONOSCOPE_SCHEMA_VERSION,
    moduleSettings: percentGeometry(withoutRetiredModules(raw.moduleSettings)),
    pendingStructuralModuleSettings:
      percentGeometry(withoutRetiredModules(raw.pendingStructuralModuleSettings)),
    moduleReloadGenerations: withoutRetiredModules(raw.moduleReloadGenerations),
    settingsGroups,
    colorThemes,
    colorGroups,
    moduleColorGroupIds,
    chooseColorGroupByGenre: raw.chooseColorGroupByGenre === true,
    structuralSettings: (() => {
      const values = Object.fromEntries(
        Object.entries(isRecord(raw.structuralSettings) ? raw.structuralSettings : {})
          .flatMap(([id, value]) => Number.isFinite(Number(value)) ? [[id, Number(value)]] : []),
      ) as Record<string, number>;
      const scaled = needsPercentGeometry ? migratePhonoscopeScalarsToPercent(values) : values;
      if (!needsWidthAuthored) return scaled;
      // Both halves of v6: the old centre height is repointed at the width axis
      // with its number intact, and Proportional is stamped on explicitly so
      // absent can never later read as "the user turned this off".
      return migratePhonoscopeProportionalDefault(migratePhonoscopeCentreScalars(scaled));
    })(),
    houseParty: normalizeHouseParty(migrated ? migrated.houseParty : raw.houseParty),
    // A solo pointing at something deleted is simply not soloed, rather than a
    // lock on a theme or settings group that no longer exists.
    soloColorThemeId: colorThemes.some((theme) => theme.id === raw.soloColorThemeId)
      ? String(raw.soloColorThemeId)
      : "",
    soloSettingsGroupId: settingsGroups.some((group) => group.id === raw.soloSettingsGroupId)
      ? String(raw.soloSettingsGroupId)
      : "",
    editorPreviewColorGroupId: previewGroup ? previewGroupId : "",
    editorPreviewColorEntryId: previewGroup?.entries.some((entry) => entry.id === previewEntryId)
      ? previewEntryId
      : "",
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : undefined,
  };
}

