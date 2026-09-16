import { publishPhonoscopeConfig } from "../dashboard-events";
import { mergeDashboardPreferences } from "../preferences";
import { PHONOSCOPE_SCHEMA_VERSION } from "../phonoscope-migrate-v6";
import { phonoscopeEffectDeclarations } from "../phonoscope-effects";
import type { PhonoscopePreferences } from "../types";
import {
  isRecord,
  normalizePhonoscopeColorThemes,
  normalizeSettingValue,
  readBoolean,
} from "./color-model";
import { normalizeHouseParty, normalizePhonoscopeColorGroups, withDefaultSettingsGroup } from "./groups-model";
import { normalizePhonoscopeSettingsGroups, prunePhonoscopeLanes } from "./lanes-model";
import { readPhonoscopeConfig } from "./read-config";
import { listPhonoscopeModules } from "./store";
import type { PhonoscopeConfig } from "./types";

/** A solo id, kept only while it still names something that exists. */
function resolveSolo(requested: unknown, ids: { id: string }[]) {
  const value = typeof requested === "string" ? requested : "";
  return ids.some((entry) => entry.id === value) ? value : "";
}

export async function writePhonoscopeConfig(value: unknown): Promise<PhonoscopeConfig> {
  if (!isRecord(value)) throw new Error("Expected a configuration object");
  const input = value;
  const current = await readPhonoscopeConfig();
  const installed = await listPhonoscopeModules();
  const moduleId = typeof input.activeModuleId === "string" ? input.activeModuleId : current.activeModuleId;
  const moduleVersion = typeof input.activeModuleVersion === "string"
    ? input.activeModuleVersion
    : current.activeModuleVersion;
  if (!installed.some((entry) => entry.id === moduleId && entry.version === moduleVersion)) {
    throw new Error(`Phonoscope module ${moduleId}@${moduleVersion} is not installed`);
  }

  const settingsGroups = withDefaultSettingsGroup(
    normalizePhonoscopeSettingsGroups(input.settingsGroups ?? current.settingsGroups),
    moduleId,
  );
  const colorThemes = normalizePhonoscopeColorThemes(input.colorThemes ?? current.colorThemes);
  const colorGroups = normalizePhonoscopeColorGroups(
    input.colorGroups ?? current.colorGroups, colorThemes, settingsGroups);

  // Bindings are checked against what the active module actually declares, so a
  // stale lane pointing at a retired setting is dropped rather than carried
  // forward as a binding that can never resolve.
  const declarations = phonoscopeEffectDeclarations(
    installed.filter((entry) => entry.id === moduleId && entry.version === moduleVersion)
      .at(-1)?.settings ?? []);
  const prunedSettingsGroups = settingsGroups.map((group) => group.moduleId !== moduleId
    ? group
    : { ...group, lanes: prunePhonoscopeLanes(group.lanes, declarations) });

  const validColorGroupIds = new Set(colorGroups.map((group) => group.id));
  const requestedAssignments = isRecord(input.moduleColorGroupIds)
    ? input.moduleColorGroupIds
    : current.moduleColorGroupIds;
  const moduleColorGroupIds = Object.fromEntries(
    Object.entries(requestedAssignments).flatMap(([id, groupId]) =>
      typeof groupId === "string"
        && validColorGroupIds.has(groupId)
        && colorGroups.some((group) => group.id === groupId && group.moduleId === id)
        ? [[id, groupId]]
        : []),
  );

  const normalizeSettingsMap = (requested: unknown, mode: "smooth" | "structural") => {
    const result: Record<string, Record<string, number>> = {};
    for (const [settingModuleId, rawValues] of Object.entries(isRecord(requested) ? requested : {})) {
      if (!isRecord(rawValues)) continue;
      // Settings are keyed by module id for backward compatibility. For an
      // inactive module retain the settings declared by its newest installed
      // version; the active module remains pinned to the selected version.
      const declared = installed.filter((entry) => entry.id === settingModuleId
        && (entry.id !== moduleId || entry.version === moduleVersion)).at(-1)?.settings;
      if (!declared) continue;
      const normalized: Record<string, number> = {};
      for (const setting of declared.filter((entry) => entry.updateMode === mode)) {
        if (!(setting.id in rawValues)) continue;
        const resolved = normalizeSettingValue(setting, rawValues[setting.id]);
        if (resolved !== undefined) normalized[setting.id] = resolved;
      }
      if (Object.keys(normalized).length) result[settingModuleId] = normalized;
    }
    return result;
  };

  // Merged per module, not spread. `normalizeSettingsMap` is keyed by module id,
  // so a shallow spread let the structural pass REPLACE the smooth pass's entry
  // for the same module rather than add to it — every smooth setting of any
  // module that also declared a structural one was silently discarded on write.
  // `particle-ripples` declares `complexity` as structural, which is why it was
  // the only value that ever persisted for it.
  const moduleSettings = ((smooth, structural) => {
    const merged: Record<string, Record<string, number>> = {};
    for (const [id, values] of Object.entries(smooth)) merged[id] = { ...values };
    for (const [id, values] of Object.entries(structural)) {
      merged[id] = { ...merged[id], ...values };
    }
    return merged;
  })(
    normalizeSettingsMap(input.moduleSettings ?? current.moduleSettings, "smooth"),
    normalizeSettingsMap(input.moduleSettings ?? current.moduleSettings, "structural"),
  );
  const pendingStructuralModuleSettings = normalizeSettingsMap(
    input.pendingStructuralModuleSettings ?? current.pendingStructuralModuleSettings, "structural");
  const moduleReloadGenerations = Object.fromEntries(
    Object.entries(isRecord(input.moduleReloadGenerations)
      ? input.moduleReloadGenerations
      : current.moduleReloadGenerations)
      .flatMap(([id, entry]) => Number.isFinite(Number(entry))
        ? [[id, Math.max(0, Math.floor(Number(entry)))]]
        : []));

  const previewGroupId = typeof input.editorPreviewColorGroupId === "string"
    ? input.editorPreviewColorGroupId
    : "";
  const previewGroup = colorGroups.find((group) => group.id === previewGroupId);
  const previewEntryId = typeof input.editorPreviewColorEntryId === "string"
    ? input.editorPreviewColorEntryId
    : "";

  const next: PhonoscopeConfig = {
    // `current` came from a read, so everything below is already on the current
    // schema. Stamping it here is what stops the read-side conversions running
    // again over values that have already been converted.
    schemaVersion: PHONOSCOPE_SCHEMA_VERSION,
    soloColorThemeId: resolveSolo(
      "soloColorThemeId" in input ? input.soloColorThemeId : current.soloColorThemeId,
      colorThemes),
    soloSettingsGroupId: resolveSolo(
      "soloSettingsGroupId" in input ? input.soloSettingsGroupId : current.soloSettingsGroupId,
      prunedSettingsGroups),
    activeModuleId: moduleId,
    activeModuleVersion: moduleVersion,
    idleBehavior: ["ambient", "black", "return"].includes(String(input.idleBehavior))
      ? input.idleBehavior as PhonoscopeConfig["idleBehavior"]
      : current.idleBehavior,
    screensaverSeconds: typeof input.screensaverSeconds === "number"
      ? Math.max(0, Math.min(3_600, Math.round(input.screensaverSeconds)))
      : current.screensaverSeconds,
    message: typeof input.message === "string"
      ? Array.from(input.message.trim()).slice(0, 160).join("")
      : current.message,
    statusOverlay: typeof input.statusOverlay === "boolean" ? input.statusOverlay : current.statusOverlay,
    transitionMs: typeof input.transitionMs === "number"
      ? Math.max(0, Math.min(3_000, Math.round(input.transitionMs)))
      : current.transitionMs,
    providers: {
      spotify: readBoolean(input.providers, "spotify", current.providers.spotify),
      songle: readBoolean(input.providers, "songle", current.providers.songle),
      essentia: readBoolean(input.providers, "essentia", current.providers.essentia),
      reccoBeats: readBoolean(input.providers, "reccoBeats", current.providers.reccoBeats),
      lrclib: readBoolean(input.providers, "lrclib", current.providers.lrclib),
    },
    moduleSettings,
    pendingStructuralModuleSettings,
    moduleReloadGenerations,
    settingsGroups: prunedSettingsGroups,
    colorThemes,
    colorGroups,
    moduleColorGroupIds,
    chooseColorGroupByGenre: typeof input.chooseColorGroupByGenre === "boolean"
      ? input.chooseColorGroupByGenre
      : current.chooseColorGroupByGenre,
    structuralSettings: Object.fromEntries(
      Object.entries(isRecord(input.structuralSettings)
        ? input.structuralSettings
        : current.structuralSettings)
        .flatMap(([id, entry]) => Number.isFinite(Number(entry)) ? [[id, Number(entry)]] : [])),
    houseParty: normalizeHouseParty(input.houseParty ?? current.houseParty),
    editorPreviewColorGroupId: previewGroup ? previewGroupId : "",
    editorPreviewColorEntryId: previewGroup?.entries.some((entry) => entry.id === previewEntryId)
      ? previewEntryId
      : "",
  };

  await mergeDashboardPreferences({ phonoscope: next as PhonoscopePreferences });
  // Nudge the GPU renderer on voiceHost. It re-reads the config itself, so this
  // stays a notification rather than a second serialisation of the same state.
  publishPhonoscopeConfig("config");
  return readPhonoscopeConfig();
}

