import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";
import sharp from "sharp";
import {
  BUILTIN_PHONOSCOPE_MODULE_YAML,
  compilePhonoscopeYaml,
  PHONOSCOPE_CORE_PALETTE_SLOTS,
  PHONOSCOPE_LIMITS,
  PHONOSCOPE_MODULE_ID,
  PHONOSCOPE_MODULE_VERSION,
  stablePhonoscopeJson,
  type PhonoscopeCompiledModule,
  type PhonoscopeModuleSummary,
  type PhonoscopeSetting,
} from "./phonoscope";
import { publishPhonoscopeConfig } from "./dashboard-events";
import { mergeDashboardPreferences, readDashboardPreferences } from "./preferences";
import { normalizeThemeLibrary } from "./theme-library";
import { decimalStepGranularity } from "./slider-step";
import type {
  PhonoscopeColorGroup,
  PhonoscopeGlowOverlay,
  PhonoscopeColorTheme,
  PhonoscopeColorValue,
  PhonoscopeParameterSource,
  PhonoscopePreferences,
  PhonoscopeThemeGroup,
} from "./types";

const MODULE_ROOT =
  process.env.NOVA_PHONOSCOPE_MODULES_DIR ?? path.join(process.cwd(), "data", "phonoscope", "modules");
const RETIRED_PHONOSCOPE_MODULE_IDS = new Set(["hypervault"]);

export const DEFAULT_PHONOSCOPE_CONFIG: Required<Omit<PhonoscopePreferences, "updatedAt">> = {
  activeModuleId: "bpm-pulse",
  activeModuleVersion: "1.0.0",
  idleBehavior: "ambient",
  message: "",
  messageScaleSource: { type: "manual", value: 1 },
  glowOverlay: {
    // 0 is screen, 1 is multiply.
    blendModeSource: { type: "manual", value: 0 },
    blurSource: { type: "manual", value: 0 },
    // Opacity 0 is the identity, and it is what both engines check to skip the
    // pass entirely. A new install therefore pays nothing for this layer.
    opacitySource: { type: "manual", value: 0 },
  },
  statusOverlay: true,
  transitionMs: 600,
  housePartyRandomHueOffset: 0,
  providers: {
    spotify: true,
    songle: true,
    essentia: true,
    reccoBeats: true,
    lrclib: true,
  },
  moduleSettings: {},
  moduleParameterSources: {},
  pendingStructuralModuleSettings: {},
  moduleReloadGenerations: {},
  colorGroups: [],
  moduleColorGroupIds: {},
  editorPreviewColorGroupId: "",
  editorPreviewColorThemeId: "",
  themeGroups: [],
  moduleThemeGroupIds: {},
};

const DEFAULT_COLORS: Record<string, PhonoscopeColorValue> = Object.fromEntries(
  PHONOSCOPE_CORE_PALETTE_SLOTS.map((slot) => [slot.id, {
    rgb: slot.defaultRgb,
    intensity: 100,
    opacity: 100,
    cursor: { x: 0.5, y: 0.5 },
  }]),
);

function cloneDefaultColors() {
  return structuredClone(DEFAULT_COLORS);
}

function mixedColor(
  from: PhonoscopeColorValue,
  to: PhonoscopeColorValue,
  amount: number,
  opacity = from.opacity,
): PhonoscopeColorValue {
  return {
    rgb: from.rgb.map((part, index) =>
      Math.round(part + (to.rgb[index] - part) * amount)) as [number, number, number],
    intensity: from.intensity + (to.intensity - from.intensity) * amount,
    opacity,
    cursor: { x: 0.5, y: 0.5 },
  };
}

function particleRippleColors(
  colors: Record<string, PhonoscopeColorValue>,
  explicitlyConfigured: ReadonlySet<string> = new Set(),
) {
  const primary = colors.dotPrimary ?? colors.primary ?? DEFAULT_COLORS.primary;
  const secondary = colors.dotSecondary ?? colors.secondary ?? DEFAULT_COLORS.secondary;
  const tertiary = colors.tertiary ?? mixedColor(primary, secondary, 0.5);
  const background = colors.backgroundPrimary ?? colors.background ?? DEFAULT_COLORS.background;
  const assign = (id: string, value: PhonoscopeColorValue) => {
    if (!explicitlyConfigured.has(id)) colors[id] = structuredClone(value);
  };
  assign("backgroundPrimary", background);
  assign("backgroundSecondary", mixedColor(background, primary, 0.22, background.opacity));
  assign("dotPrimary", primary);
  assign("dotSecondary", secondary);
  assign("glowPrimary", mixedColor(secondary, { ...secondary, rgb: [255, 255, 255] }, 0.28));
  assign("glowSecondary", mixedColor(tertiary, secondary, 0.62));
  assign("linePrimary", { ...structuredClone(tertiary), opacity: 42 });
  assign("lineSecondary", { ...structuredClone(secondary), opacity: 58 });
  assign("trailPrimary", { ...structuredClone(primary), opacity: 72 });
  assign("trailSecondary", { ...structuredClone(secondary), opacity: 38 });
  delete colors.primary;
  delete colors.secondary;
  delete colors.tertiary;
  delete colors.background;
  return colors;
}

function starterColorGroup(): PhonoscopeColorGroup {
  return {
    id: "default_visualiser",
    moduleId: "particle-ripples",
    name: "Default Visualiser",
    themes: [{
      id: "default",
      name: "Default",
      colors: particleRippleColors(cloneDefaultColors()),
      parameterOverrides: {},
    }],
    order: "sequential",
    changeMode: "interval",
    waitSeconds: 60,
    transitionSeconds: 3,
    housePartyHueMode: "follow",
    housePartyBrightnessMode: "follow",
  };
}

function normalizedColor(value: unknown, fallback: PhonoscopeColorValue): PhonoscopeColorValue {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const rgb = Array.isArray(raw.rgb) && raw.rgb.length === 3
    ? raw.rgb.map((part, index) => Number.isFinite(Number(part))
      ? Math.max(0, Math.min(255, Math.round(Number(part))))
      : fallback.rgb[index]) as [number, number, number]
    : fallback.rgb;
  const cursor = raw.cursor && typeof raw.cursor === "object" && !Array.isArray(raw.cursor)
    ? raw.cursor as Record<string, unknown>
    : null;
  return {
    rgb,
    intensity: Number.isFinite(Number(raw.intensity))
      ? Math.max(0, Math.min(100, Number(raw.intensity)))
      : fallback.intensity,
    opacity: Number.isFinite(Number(raw.opacity))
      ? Math.max(0, Math.min(100, Number(raw.opacity)))
      : fallback.opacity,
    ...(cursor && Number.isFinite(Number(cursor.x)) && Number.isFinite(Number(cursor.y))
      ? { cursor: {
          x: Math.max(0, Math.min(1, Number(cursor.x))),
          y: Math.max(0, Math.min(1, Number(cursor.y))),
        } }
      : fallback.cursor ? { cursor: fallback.cursor } : {}),
  };
}

function finiteClamped(value: unknown, fallback: number, min: number, max: number) {
  return Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
}

export function normalizePhonoscopeParameterSource(value: unknown): PhonoscopeParameterSource | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const type = String(raw.type);
  if (type === "manual") {
    return { type, value: finiteClamped(raw.value, 0, -1e9, 1e9) };
  }
  const min = finiteClamped(raw.min, 0, -1e9, 1e9);
  const max = Math.max(min, finiteClamped(raw.max, min, -1e9, 1e9));
  if (type === "random") {
    const cadence = ["beat", "downbeat", "bar", "song", "interval"].includes(String(raw.cadence))
      ? raw.cadence as "beat" | "downbeat" | "bar" | "song" | "interval"
      : "beat";
    return {
      type,
      min,
      max,
      cadence,
      intervalSeconds: finiteClamped(raw.intervalSeconds, 4, 0.25, 60),
      transitionSeconds: finiteClamped(raw.transitionSeconds, 0.5, 0, 10),
    };
  }
  if (["beat", "downbeat", "energy", "bass", "mid", "treble"].includes(type)) {
    const attackSeconds = finiteClamped(raw.attackSeconds, 0.05, 0, 12);
    const holdSeconds = finiteClamped(raw.holdSeconds, 0, 0, 12 - attackSeconds);
    return {
      type: type as "beat" | "downbeat" | "energy" | "bass" | "mid" | "treble",
      min,
      max,
      attackSeconds,
      holdSeconds,
      releaseSeconds: finiteClamped(raw.releaseSeconds, 0.6, 0, 12 - attackSeconds - holdSeconds),
    };
  }
  return null;
}

/**
 * The glow overlay's driven parameters are bounded by the layer itself rather
 * than by any module declaration, so they are clamped here: blur 0-20, opacity
 * 0-100, blend mode 0-1 (0 screen, 1 multiply). A source whose envelope or
 * range is unusable falls back to the caller's current value rather than
 * silently disabling the layer.
 */
export function normalizePhonoscopeGlowOverlay(
  value: unknown,
  fallback: PhonoscopeGlowOverlay,
): PhonoscopeGlowOverlay {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback;
  const raw = value as Record<string, unknown>;
  const bounded = (source: unknown, max: number, previous: PhonoscopeParameterSource) => {
    const normalized = normalizePhonoscopeParameterSource(source);
    if (!normalized) return previous;
    if (normalized.type === "manual") {
      return { ...normalized, value: finiteClamped(normalized.value, 0, 0, max) };
    }
    const min = finiteClamped(normalized.min, 0, 0, max);
    return {
      ...normalized,
      min,
      max: Math.max(min, finiteClamped(normalized.max, min, 0, max)),
    };
  };
  // Configurations written before the blend mode became a driven parameter
  // carry a plain `blendMode` string instead. Read it as the manual source it
  // maps to, so an install already set to multiply stays on multiply.
  const legacyBlendMode = raw.blendModeSource === undefined && typeof raw.blendMode === "string"
    ? { type: "manual" as const, value: raw.blendMode === "multiply" ? 1 : 0 }
    : undefined;
  return {
    blendModeSource: bounded(
      raw.blendModeSource ?? legacyBlendMode,
      1,
      fallback.blendModeSource,
    ),
    blurSource: bounded(raw.blurSource, 20, fallback.blurSource),
    opacitySource: bounded(raw.opacitySource, 100, fallback.opacitySource),
  };
}

function normalizeParameterOverrides(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([moduleId, rawSettings]) => {
    if (!PHONOSCOPE_MODULE_ID.test(moduleId) || !rawSettings || typeof rawSettings !== "object" || Array.isArray(rawSettings)) return [];
    const settings = Object.fromEntries(Object.entries(rawSettings as Record<string, unknown>).flatMap(([settingId, rawSource]) => {
      if (!PHONOSCOPE_MODULE_ID.test(settingId)) return [];
      const source = normalizePhonoscopeParameterSource(rawSource);
      return source ? [[settingId, source]] : [];
    }));
    return Object.keys(settings).length ? [[moduleId, settings]] : [];
  }));
}

export function normalizePhonoscopeColorGroups(value: unknown): PhonoscopeColorGroup[] {
  if (!Array.isArray(value)) return [];
  const groupIds = new Set<string>();
  return value.flatMap((rawGroup, groupIndex) => {
    if (!rawGroup || typeof rawGroup !== "object" || Array.isArray(rawGroup)) return [];
    const group = rawGroup as Record<string, unknown>;
    const id = typeof group.id === "string" && PHONOSCOPE_MODULE_ID.test(group.id)
      ? group.id : `color_group_${groupIndex + 1}`;
    if (groupIds.has(id)) return [];
    groupIds.add(id);
    const moduleId = typeof group.moduleId === "string" && PHONOSCOPE_MODULE_ID.test(group.moduleId)
      ? group.moduleId
      : "particle-ripples";
    const themeIds = new Set<string>();
    const themes = Array.isArray(group.themes) ? group.themes.flatMap((rawTheme, themeIndex) => {
      if (!rawTheme || typeof rawTheme !== "object" || Array.isArray(rawTheme)) return [];
      const theme = rawTheme as Record<string, unknown>;
      const themeId = typeof theme.id === "string" && PHONOSCOPE_MODULE_ID.test(theme.id)
        ? theme.id : `theme_${themeIndex + 1}`;
      if (themeIds.has(themeId)) return [];
      themeIds.add(themeId);
      const rawColors = theme.colors && typeof theme.colors === "object" && !Array.isArray(theme.colors)
        ? theme.colors as Record<string, unknown>
        : {};
      const colors = cloneDefaultColors();
      for (const [slotId, rawColor] of Object.entries(rawColors)) {
        if (!/^[a-z][a-zA-Z0-9_-]{0,63}$/.test(slotId)) continue;
        colors[slotId] = normalizedColor(rawColor, colors[slotId] ?? DEFAULT_COLORS.primary);
      }
      if (moduleId === "particle-ripples") {
        particleRippleColors(colors, new Set(Object.keys(rawColors)));
      }
      return [{
        id: themeId,
        name: typeof theme.name === "string" && theme.name.trim()
          ? theme.name.trim().slice(0, 60) : `Colour theme ${themeIndex + 1}`,
        colors,
        parameterOverrides: normalizeParameterOverrides(theme.parameterOverrides),
      } satisfies PhonoscopeColorTheme];
    }) : [];
    return [{
      id,
      moduleId,
      name: typeof group.name === "string" && group.name.trim()
        ? group.name.trim().slice(0, 60) : `Colour group ${groupIndex + 1}`,
      themes: themes.length ? themes : [{
        id: "default",
        name: "Default",
        colors: moduleId === "particle-ripples"
          ? particleRippleColors(cloneDefaultColors())
          : cloneDefaultColors(),
        parameterOverrides: {},
      }],
      order: group.order === "shuffle" ? "shuffle" : "sequential",
      changeMode: group.changeMode === "song" || group.changeMode === "downbeat"
        ? group.changeMode : "interval",
      waitSeconds: finiteClamped(group.waitSeconds, 60, 0, 600),
      transitionSeconds: finiteClamped(group.transitionSeconds, 3, 0, 600),
      housePartyHueMode: group.housePartyHueMode === "complement" ? "complement" : "follow",
      housePartyBrightnessMode: group.housePartyBrightnessMode === "oppose" || group.housePartyBrightnessMode === "ignore"
        ? group.housePartyBrightnessMode : "follow",
    } satisfies PhonoscopeColorGroup];
  });
}

export function normalizePhonoscopeThemeGroups(value: unknown): PhonoscopeThemeGroup[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return value.flatMap((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const entry = raw as Record<string, unknown>;
    const id = typeof entry.id === "string" && /^[a-z][a-z0-9_-]{1,63}$/i.test(entry.id)
      ? entry.id : `group_${index + 1}`;
    if (ids.has(id)) return [];
    ids.add(id);
    const themes = Array.isArray(entry.themes) ? entry.themes.flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const theme = item as Record<string, unknown>;
      if (typeof theme.themeId !== "string" || !theme.themeId.trim()) return [];
      return [{
        themeId: theme.themeId.trim(),
        baseVariant: theme.baseVariant === "light" ? "light" as const : "dark" as const,
        swapOnDownbeat: theme.swapOnDownbeat === true,
        genres: Array.isArray(theme.genres)
          ? [...new Set(theme.genres.flatMap((genre) => typeof genre === "string" && genre.trim() ? [genre.trim().slice(0, 48)] : []))]
          : [],
      }];
    }) : [];
    return [{
      id,
      name: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim().slice(0, 60) : `Theme group ${index + 1}`,
      themes,
      useGenres: typeof entry.useGenres === "boolean"
        ? entry.useGenres
        : themes.some((theme) => theme.genres.length > 0),
      order: entry.order === "shuffle" ? "shuffle" as const : "sequential" as const,
      changeMode: entry.changeMode === "song"
        ? "song" as const
        : entry.changeMode === "downbeat"
          ? "downbeat" as const
          : "interval" as const,
      waitSeconds: Math.max(0, Math.min(600, Number(entry.waitSeconds) || 0)),
      transitionSeconds: Math.max(0, Math.min(600, Number(entry.transitionSeconds) || 0)),
      housePartyHueMode: entry.housePartyHueMode === "complement" ? "complement" as const : "follow" as const,
      housePartyBrightnessMode: ["oppose", "ignore"].includes(String(entry.housePartyBrightnessMode))
        ? entry.housePartyBrightnessMode as "oppose" | "ignore"
        : "follow" as const,
    }];
  });
}

function safeColorThemeId(value: string, fallback: string) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return PHONOSCOPE_MODULE_ID.test(normalized) ? normalized : fallback;
}

export function migrateLegacyPhonoscopeColorGroups(value: unknown, themeLibraryValue: unknown): PhonoscopeColorGroup[] {
  const legacy = normalizePhonoscopeThemeGroups(value);
  if (!legacy.length) return [];
  const library = normalizeThemeLibrary(themeLibraryValue);
  const entries = new Map(library.entries.map((entry) => [entry.id, entry]));
  return legacy.map((group) => {
    const ids = new Set<string>();
    const themes: PhonoscopeColorTheme[] = group.themes.map((legacyTheme, index) => {
      let id = safeColorThemeId(legacyTheme.themeId, `theme_${index + 1}`);
      while (ids.has(id)) id = `${id}_${index + 1}`;
      ids.add(id);
      const saved = entries.get(legacyTheme.themeId);
      const set = saved?.themeSet;
      const variants = set?.themes && typeof set.themes === "object" && !Array.isArray(set.themes)
        ? set.themes as Record<string, unknown>
        : {};
      const rawVariant = variants[legacyTheme.baseVariant];
      const variant = rawVariant && typeof rawVariant === "object" && !Array.isArray(rawVariant)
        ? rawVariant as Record<string, unknown>
        : {};
      const colors = cloneDefaultColors();
      colors.primary = normalizedColor(variant.accent, colors.primary);
      colors.secondary = normalizedColor(variant.highlight, colors.secondary);
      colors.background = normalizedColor(variant.background, colors.background);
      colors.tertiary = {
        rgb: colors.primary.rgb.map((part, component) =>
          Math.round((part + colors.secondary.rgb[component]) / 2)) as [number, number, number],
        intensity: (colors.primary.intensity + colors.secondary.intensity) / 2,
        opacity: (colors.primary.opacity + colors.secondary.opacity) / 2,
        cursor: { x: 0.5, y: 0.5 },
      };
      const titleColors = variant.titleColors && typeof variant.titleColors === "object" && !Array.isArray(variant.titleColors)
        ? variant.titleColors as Record<string, unknown>
        : {};
      const textFallback = legacyTheme.baseVariant === "light" ? titleColors.dark : titleColors.light;
      colors.primaryText = normalizedColor(variant.clockColor ?? textFallback, colors.primaryText);
      colors.secondaryText = {
        ...colors.primaryText,
        intensity: colors.primaryText.intensity * 0.7,
      };
      particleRippleColors(colors);
      return {
        id,
        name: saved?.name ?? `Colour theme ${index + 1}`,
        colors,
        parameterOverrides: {},
      };
    });
    return {
      id: group.id,
      moduleId: "particle-ripples",
      name: group.name,
      themes: themes.length ? themes : starterColorGroup().themes,
      order: group.order,
      changeMode: group.changeMode,
      waitSeconds: group.waitSeconds,
      transitionSeconds: group.transitionSeconds,
      housePartyHueMode: group.housePartyHueMode,
      housePartyBrightnessMode: group.housePartyBrightnessMode,
    };
  });
}

type StoredManifest = PhonoscopeModuleSummary & {
  assets: string[];
  installedAt: string;
  warnings: string[];
};

function packageNameFor(module: Pick<PhonoscopeModuleSummary, "id"> & { packageName?: string }) {
  return module.packageName ?? `nz.skull.nova.visualiser.${module.id}`;
}

function safeSegment(value: string, pattern: RegExp, label: string) {
  if (!pattern.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}

function moduleDirectory(id: string, version: string) {
  return path.join(
    MODULE_ROOT,
    safeSegment(id, PHONOSCOPE_MODULE_ID, "module id"),
    safeSegment(version, PHONOSCOPE_MODULE_VERSION, "module version"),
  );
}

function hashBytes(values: Uint8Array[]) {
  const hash = createHash("sha256");
  values.forEach((value) => hash.update(value));
  return hash.digest("hex");
}

function builtinRecord() {
  const result = compilePhonoscopeYaml(BUILTIN_PHONOSCOPE_MODULE_YAML);
  if (!result.ok) throw new Error(`Built-in Phonoscope module is invalid: ${result.errors.join("; ")}`);
  const compiled = stablePhonoscopeJson(result.module);
  const hash = hashBytes([Buffer.from(compiled)]);
  const summary: PhonoscopeModuleSummary = {
    id: result.module.id,
    packageName: result.module.packageName,
    version: result.module.version,
    name: result.module.name,
    description: result.module.description,
    dimension: result.module.dimension,
    hash,
    builtin: true,
    settings: result.module.settings,
    paletteSlots: result.module.paletteSlots,
  };
  return { compiled: result.module, summary, source: BUILTIN_PHONOSCOPE_MODULE_YAML };
}

export async function readPhonoscopeConfig() {
  const preferences = await readDashboardPreferences();
  const raw = preferences.phonoscope ?? {};
  const currentColorGroups = normalizePhonoscopeColorGroups(raw.colorGroups);
  const migratedColorGroups = currentColorGroups.length
    ? currentColorGroups
    : migrateLegacyPhonoscopeColorGroups(raw.themeGroups, preferences.themeLibrary);
  const colorGroups = migratedColorGroups.length ? migratedColorGroups : [starterColorGroup()];
  const validColorGroupIds = new Set(colorGroups.map((group) => group.id));
  const rawColorAssignments = raw.moduleColorGroupIds && typeof raw.moduleColorGroupIds === "object"
    ? raw.moduleColorGroupIds
    : raw.moduleThemeGroupIds ?? {};
  const moduleColorGroupIds = Object.fromEntries(Object.entries(rawColorAssignments).flatMap(([moduleId, groupId]) =>
    typeof groupId === "string"
      && validColorGroupIds.has(groupId)
      && colorGroups.some((group) => group.id === groupId && group.moduleId === moduleId)
      ? [[moduleId, groupId]]
      : [],
  ));
  const withoutRetiredModules = <T>(value: Record<string, T> | undefined) =>
    Object.fromEntries(Object.entries(value ?? {}).filter(([moduleId]) => !RETIRED_PHONOSCOPE_MODULE_IDS.has(moduleId)));
  return {
    ...DEFAULT_PHONOSCOPE_CONFIG,
    ...raw,
    messageScaleSource: normalizePhonoscopeParameterSource(raw.messageScaleSource)
      ?? DEFAULT_PHONOSCOPE_CONFIG.messageScaleSource,
    glowOverlay: normalizePhonoscopeGlowOverlay(
      raw.glowOverlay,
      DEFAULT_PHONOSCOPE_CONFIG.glowOverlay,
    ),
    providers: { ...DEFAULT_PHONOSCOPE_CONFIG.providers, ...(raw.providers ?? {}) },
    moduleSettings: withoutRetiredModules(raw.moduleSettings),
    moduleParameterSources: withoutRetiredModules(normalizeParameterOverrides(raw.moduleParameterSources)),
    pendingStructuralModuleSettings: {
      ...DEFAULT_PHONOSCOPE_CONFIG.pendingStructuralModuleSettings,
      ...withoutRetiredModules(raw.pendingStructuralModuleSettings),
    },
    moduleReloadGenerations: withoutRetiredModules(raw.moduleReloadGenerations),
    colorGroups,
    moduleColorGroupIds,
    themeGroups: normalizePhonoscopeThemeGroups(raw.themeGroups),
    moduleThemeGroupIds: { ...DEFAULT_PHONOSCOPE_CONFIG.moduleThemeGroupIds, ...(raw.moduleThemeGroupIds ?? {}) },
  };
}

export async function writePhonoscopeConfig(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a configuration object");
  const input = value as Record<string, unknown>;
  const current = await readPhonoscopeConfig();
  const installed = await listPhonoscopeModules();
  const moduleId = typeof input.activeModuleId === "string" ? input.activeModuleId : current.activeModuleId;
  const moduleVersion = typeof input.activeModuleVersion === "string" ? input.activeModuleVersion : current.activeModuleVersion;
  if (!installed.some((entry) => entry.id === moduleId && entry.version === moduleVersion)) {
    throw new Error(`Phonoscope module ${moduleId}@${moduleVersion} is not installed`);
  }
  const idleBehavior = ["ambient", "black", "return"].includes(String(input.idleBehavior))
    ? input.idleBehavior as PhonoscopePreferences["idleBehavior"]
    : current.idleBehavior;
  const providers =input.providers && typeof input.providers === "object" && !Array.isArray(input.providers)
    ? input.providers as Record<string, unknown>
    : {};
  const themeGroups = normalizePhonoscopeThemeGroups(input.themeGroups ?? current.themeGroups);
  const validGroupIds = new Set(themeGroups.map((group) => group.id));
  const requestedAssignments = input.moduleThemeGroupIds && typeof input.moduleThemeGroupIds === "object"
    && !Array.isArray(input.moduleThemeGroupIds)
    ? input.moduleThemeGroupIds as Record<string, unknown>
    : current.moduleThemeGroupIds;
  const moduleThemeGroupIds = Object.fromEntries(Object.entries(requestedAssignments).flatMap(([id, groupId]) =>
    typeof groupId === "string" && validGroupIds.has(groupId) ? [[id, groupId]] : [],
  ));
  const colorGroups = normalizePhonoscopeColorGroups(input.colorGroups ?? current.colorGroups);
  const resolvedColorGroups = colorGroups.length ? colorGroups : [starterColorGroup()];
  const validColorGroupIds = new Set(resolvedColorGroups.map((group) => group.id));
  const requestedColorAssignments = input.moduleColorGroupIds && typeof input.moduleColorGroupIds === "object"
    && !Array.isArray(input.moduleColorGroupIds)
    ? input.moduleColorGroupIds as Record<string, unknown>
    : current.moduleColorGroupIds;
  const moduleColorGroupIds = Object.fromEntries(Object.entries(requestedColorAssignments).flatMap(([id, groupId]) =>
    typeof groupId === "string"
      && validColorGroupIds.has(groupId)
      && resolvedColorGroups.some((group) => group.id === groupId && group.moduleId === id)
      ? [[id, groupId]]
      : [],
  ));
  const requestedSettings = input.moduleSettings && typeof input.moduleSettings === "object" && !Array.isArray(input.moduleSettings)
    ? input.moduleSettings as Record<string, unknown>
    : current.moduleSettings;
  const moduleSettings: Record<string, Record<string, number>> = {};
  const normalizeSettingsMap = (requested: Record<string, unknown>, mode: "smooth" | "structural") => {
    const result: Record<string, Record<string, number>> = {};
    for (const [settingModuleId, rawValues] of Object.entries(requested)) {
      if (!rawValues || typeof rawValues !== "object" || Array.isArray(rawValues)) continue;
      const declarations = installed.filter((entry) => entry.id === settingModuleId
        && (entry.id !== moduleId || entry.version === moduleVersion)).at(-1)?.settings;
      if (!declarations) continue;
      const values = rawValues as Record<string, unknown>;
      const normalized: Record<string, number> = {};
      for (const setting of declarations.filter((setting) => setting.updateMode === mode)) {
        if (!(setting.id in values)) continue;
        const resolved = normalizeSettingValue(setting, values[setting.id]);
        if (resolved !== undefined) normalized[setting.id] = resolved;
      }
      if (Object.keys(normalized).length) result[settingModuleId] = normalized;
    }
    return result;
  };
  for (const [settingModuleId, rawValues] of Object.entries(requestedSettings)) {
    if (!rawValues || typeof rawValues !== "object" || Array.isArray(rawValues)) continue;
    // Settings are keyed by module id for backward compatibility.  For an
    // inactive module retain the settings declared by its newest installed
    // version; the active module remains pinned to the selected version.
    const declarations = installed.filter(
      (entry) => entry.id === settingModuleId
        && (entry.id !== moduleId || entry.version === moduleVersion),
    ).at(-1)?.settings;
    if (!declarations) continue;
    const values = rawValues as Record<string, unknown>;
    const normalized: Record<string, number> = {};
    for (const setting of declarations) {
      if (!(setting.id in values)) continue;
      const resolved = normalizeSettingValue(setting, values[setting.id]);
      if (resolved !== undefined) normalized[setting.id] = resolved;
    }
    if (Object.keys(normalized).length) moduleSettings[settingModuleId] = normalized;
  }
  const pendingInput = input.pendingStructuralModuleSettings
    && typeof input.pendingStructuralModuleSettings === "object"
    && !Array.isArray(input.pendingStructuralModuleSettings)
    ? input.pendingStructuralModuleSettings as Record<string, unknown>
    : current.pendingStructuralModuleSettings;
  const pendingStructuralModuleSettings = normalizeSettingsMap(pendingInput, "structural");
  const reloadInput = input.moduleReloadGenerations && typeof input.moduleReloadGenerations === "object"
    && !Array.isArray(input.moduleReloadGenerations)
    ? input.moduleReloadGenerations as Record<string, unknown> : current.moduleReloadGenerations;
  const moduleReloadGenerations = Object.fromEntries(Object.entries(reloadInput).flatMap(([id, value]) =>
    typeof value === "number" && Number.isFinite(value) ? [[id, Math.max(0, Math.floor(value))]] : [],
  ));
  const requestedParameterSources = normalizeParameterOverrides(
    input.moduleParameterSources ?? current.moduleParameterSources,
  );
  const moduleParameterSources: Record<string, Record<string, PhonoscopeParameterSource>> = {};
  Object.entries(requestedParameterSources).forEach(([settingModuleId, sources]) => {
    const declarations = installed.filter(
      (entry) => entry.id === settingModuleId
        && (entry.id !== moduleId || entry.version === moduleVersion),
    ).at(-1)?.settings;
    if (!declarations) return;
    const settings = new Map(declarations.map((setting) => [setting.id, setting]));
    const normalized: Record<string, PhonoscopeParameterSource> = {};
    Object.entries(sources).forEach(([settingId, source]) => {
      const setting = settings.get(settingId);
      if (!setting || setting.updateMode === "structural"
        || setting.control === "toggle" || setting.control === "select") return;
      if (source.type === "manual") {
        const value = normalizeSettingValue(setting, source.value);
        if (value !== undefined) normalized[settingId] = { type: "manual", value };
        return;
      }
      const min = normalizeSettingValue(setting, source.min);
      const max = normalizeSettingValue(setting, source.max);
      if (min === undefined || max === undefined) return;
      normalized[settingId] = { ...source, min: Math.min(min, max), max: Math.max(min, max) };
    });
    if (Object.keys(normalized).length) moduleParameterSources[settingModuleId] = normalized;
  });
  const requestedPreviewGroupId = typeof input.editorPreviewColorGroupId === "string"
    ? input.editorPreviewColorGroupId : "";
  const editorPreviewColorGroupId = validColorGroupIds.has(requestedPreviewGroupId)
    ? requestedPreviewGroupId : "";
  const previewGroup = resolvedColorGroups.find((group) => group.id === editorPreviewColorGroupId);
  const requestedPreviewThemeId = typeof input.editorPreviewColorThemeId === "string"
    ? input.editorPreviewColorThemeId : "";
  const editorPreviewColorThemeId = previewGroup?.themes.some((theme) => theme.id === requestedPreviewThemeId)
    ? requestedPreviewThemeId : "";
  await mergeDashboardPreferences({
    phonoscope: {
      activeModuleId: moduleId,
      activeModuleVersion: moduleVersion,
      idleBehavior,
      message: typeof input.message === "string"
        ? Array.from(input.message.trim()).slice(0, 160).join("")
        : current.message,
      messageScaleSource: normalizePhonoscopeParameterSource(input.messageScaleSource)
        ?? current.messageScaleSource,
      glowOverlay: normalizePhonoscopeGlowOverlay(input.glowOverlay, current.glowOverlay),
      statusOverlay: typeof input.statusOverlay === "boolean" ? input.statusOverlay : current.statusOverlay,
      transitionMs: typeof input.transitionMs === "number"
        ? Math.max(0, Math.min(3_000, Math.round(input.transitionMs)))
        : current.transitionMs,
      housePartyRandomHueOffset: typeof input.housePartyRandomHueOffset === "number"
        ? Math.max(0, Math.min(180, input.housePartyRandomHueOffset))
        : current.housePartyRandomHueOffset,
      providers: {
        spotify: typeof providers.spotify === "boolean" ? providers.spotify : current.providers.spotify,
        songle: typeof providers.songle === "boolean" ? providers.songle : current.providers.songle,
        essentia: typeof providers.essentia === "boolean" ? providers.essentia : current.providers.essentia,
        reccoBeats: typeof providers.reccoBeats === "boolean" ? providers.reccoBeats : current.providers.reccoBeats,
        lrclib: typeof providers.lrclib === "boolean" ? providers.lrclib : current.providers.lrclib,
      },
      moduleSettings,
      moduleParameterSources,
      pendingStructuralModuleSettings,
      moduleReloadGenerations,
      colorGroups: normalizeColorGroupsForModules(resolvedColorGroups, installed),
      moduleColorGroupIds,
      editorPreviewColorGroupId,
      editorPreviewColorThemeId,
      themeGroups,
      moduleThemeGroupIds,
    },
  });
  // Nudge the GPU renderer on iridium. It re-reads the config itself, so this
  // stays a notification rather than a second serialisation of the same state.
  publishPhonoscopeConfig("config");
  return readPhonoscopeConfig();
}

function normalizeColorGroupsForModules(
  groups: PhonoscopeColorGroup[],
  installed: PhonoscopeModuleSummary[],
): PhonoscopeColorGroup[] {
  const newestById = new Map<string, PhonoscopeModuleSummary>();
  installed.forEach((module) => newestById.set(module.id, module));
  return groups.map((group) => {
    const module = newestById.get(group.moduleId);
    const slots = new Map(module?.paletteSlots.map((slot) => [slot.id, slot]) ?? []);
    return {
      ...group,
      themes: group.themes.map((theme) => {
        const colors: PhonoscopeColorTheme["colors"] = {};
        slots.forEach((slot) => {
          colors[slot.id] = theme.colors[slot.id] ?? {
            rgb: slot.defaultRgb,
            intensity: 100,
            opacity: 100,
            cursor: { x: 0.5, y: 0.5 },
          };
        });
        const parameterOverrides: PhonoscopeColorTheme["parameterOverrides"] = {};
        Object.entries(theme.parameterOverrides).forEach(([moduleId, sources]) => {
          if (moduleId !== group.moduleId) return;
          const module = newestById.get(moduleId);
          if (!module) return;
          const declarations = new Map(module.settings.map((setting) => [setting.id, setting]));
          const normalizedSources: Record<string, PhonoscopeParameterSource> = {};
          Object.entries(sources).forEach(([settingId, source]) => {
            const setting = declarations.get(settingId);
            if (!setting || setting.updateMode === "structural") return;
            if ((setting.control === "toggle" || setting.control === "select") && source.type !== "manual") return;
            if (source.type === "manual") {
              const value = normalizeSettingValue(setting, source.value);
              if (value !== undefined) normalizedSources[settingId] = { type: "manual", value };
              return;
            }
            const min = normalizeSettingValue(setting, source.min);
            const max = normalizeSettingValue(setting, source.max);
            if (min === undefined || max === undefined) return;
            normalizedSources[settingId] = {
              ...source,
              min: Math.min(min, max),
              max: Math.max(min, max),
            };
          });
          if (Object.keys(normalizedSources).length) parameterOverrides[moduleId] = normalizedSources;
        });
        return { ...theme, colors, parameterOverrides };
      }),
    };
  });
}

function normalizeSettingValue(setting: PhonoscopeSetting, value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (setting.control === "toggle") return value >= 0.5 ? 1 : 0;
  if (setting.control === "select") {
    return setting.options.some((option) => option.value === value) ? value : setting.default;
  }
  const clamped = Math.max(setting.min, Math.min(setting.max, value));
  const step = decimalStepGranularity(setting.step);
  const stepped = setting.min + Math.round((clamped - setting.min) / step) * step;
  return Number(Math.max(setting.min, Math.min(setting.max, stepped)).toFixed(12));
}

async function readStoredManifest(directory: string) {
  return JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")) as StoredManifest;
}

export async function listPhonoscopeModules(): Promise<PhonoscopeModuleSummary[]> {
  const modules: PhonoscopeModuleSummary[] = [builtinRecord().summary];
  let ids: string[];
  try {
    ids = await readdir(MODULE_ROOT);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return modules;
    throw error;
  }
  for (const id of ids.sort()) {
    if (!PHONOSCOPE_MODULE_ID.test(id) || RETIRED_PHONOSCOPE_MODULE_IDS.has(id)) continue;
    let versions: string[] = [];
    try {
      versions = await readdir(path.join(MODULE_ROOT, id));
    } catch {
      continue;
    }
    for (const version of versions.sort()) {
      if (!PHONOSCOPE_MODULE_VERSION.test(version)) continue;
      try {
        const manifest = await readStoredManifest(path.join(MODULE_ROOT, id, version));
        modules.push({
          ...manifest,
          paletteSlots: manifest.paletteSlots ?? PHONOSCOPE_CORE_PALETTE_SLOTS,
        });
      } catch {
        // An interrupted or manually damaged directory is not publishable.
      }
    }
  }
  return modules;
}

function validateArchivePath(name: string) {
  const normalized = name.replaceAll("\\", "/");
  if (
    normalized.startsWith("/")
    || /^[A-Za-z]:/.test(normalized)
    || normalized.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    throw new Error(`Unsafe archive path: ${name}`);
  }
  return normalized;
}

function isAllowedAsset(name: string) {
  return /^assets\/[A-Za-z0-9_./-]+\.(?:png|jpe?g)$/i.test(name) || name === "preview.png";
}

export async function installPhonoscopePackage(bytes: Uint8Array) {
  if (bytes.byteLength > PHONOSCOPE_LIMITS.compressedBytes) {
    throw new Error(`Package exceeds ${PHONOSCOPE_LIMITS.compressedBytes / 1024 / 1024} MB compressed limit`);
  }
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch (error) {
    throw new Error(`Unreadable ZIP: ${error instanceof Error ? error.message : "invalid archive"}`);
  }
  const normalizedFiles = new Map<string, Uint8Array>();
  let extractedBytes = 0;
  for (const [rawName, value] of Object.entries(files)) {
    if (rawName.replaceAll("\\", "/").endsWith("/")) continue;
    const name = validateArchivePath(rawName);
    extractedBytes += value.byteLength;
    if (extractedBytes > PHONOSCOPE_LIMITS.extractedBytes) throw new Error("Package exceeds extracted size limit");
    if (name !== "module.yaml" && !isAllowedAsset(name)) throw new Error(`Unsupported package file: ${name}`);
    normalizedFiles.set(name, value);
  }
  const yamlBytes = normalizedFiles.get("module.yaml");
  if (!yamlBytes) throw new Error("Package must contain module.yaml at its root");
  const source = new TextDecoder("utf-8", { fatal: true }).decode(yamlBytes);
  const result = compilePhonoscopeYaml(source);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  if (RETIRED_PHONOSCOPE_MODULE_IDS.has(result.module.id)) {
    throw new Error(`Phonoscope module ${result.module.id} is retired`);
  }

  for (const [name, value] of normalizedFiles) {
    if (!isAllowedAsset(name)) continue;
    const metadata = await sharp(value).metadata();
    if (!metadata.width || !metadata.height || metadata.width > PHONOSCOPE_LIMITS.textureDimension || metadata.height > PHONOSCOPE_LIMITS.textureDimension) {
      throw new Error(`${name}: texture must be at most ${PHONOSCOPE_LIMITS.textureDimension}×${PHONOSCOPE_LIMITS.textureDimension}`);
    }
  }

  const target = moduleDirectory(result.module.id, result.module.version);
  const replacedModules = (await listPhonoscopeModules()).filter(
    (module) => !module.builtin && packageNameFor(module) === result.module.packageName,
  );

  const compiledText = stablePhonoscopeJson(result.module);
  const orderedBytes = [...normalizedFiles.entries()].sort(([a], [b]) => a.localeCompare(b)).flatMap(([name, value]) => [Buffer.from(name), value]);
  const hash = hashBytes([Buffer.from(compiledText), ...orderedBytes]);
  const assets = [...normalizedFiles.keys()].filter(isAllowedAsset).sort();
  const manifest: StoredManifest = {
    id: result.module.id,
    packageName: result.module.packageName,
    version: result.module.version,
    name: result.module.name,
    description: result.module.description,
    dimension: result.module.dimension,
    hash,
    builtin: false,
    settings: result.module.settings,
    paletteSlots: result.module.paletteSlots,
    assets,
    installedAt: new Date().toISOString(),
    warnings: result.warnings,
    ...(normalizedFiles.has("preview.png")
      ? { previewUrl: `/api/phonoscope/modules/${encodeURIComponent(result.module.id)}/${encodeURIComponent(result.module.version)}/assets/preview.png` }
      : {}),
  };
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.install-${randomUUID()}`;
  const replacedTarget = `${target}.replace-${randomUUID()}`;
  let targetWasReplaced = false;
  await mkdir(temporary, { recursive: true });
  try {
    await writeFile(path.join(temporary, "module.yaml"), source, "utf8");
    await writeFile(path.join(temporary, "compiled.json"), compiledText, "utf8");
    await writeFile(path.join(temporary, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    for (const [name, value] of normalizedFiles) {
      if (!isAllowedAsset(name)) continue;
      const destination = path.join(temporary, ...name.split("/"));
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, value);
    }
    try {
      await stat(target);
      await rename(target, replacedTarget);
      targetWasReplaced = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await rename(temporary, target);

    const config = await readPhonoscopeConfig();
    const replacedActiveModule = replacedModules.some(
      (module) => module.id === config.activeModuleId && module.version === config.activeModuleVersion,
    );
    if (replacedActiveModule && (config.activeModuleId !== result.module.id || config.activeModuleVersion !== result.module.version)) {
      await mergeDashboardPreferences({
        phonoscope: {
          ...config,
          activeModuleId: result.module.id,
          activeModuleVersion: result.module.version,
        },
      });
    }
    await Promise.all(replacedModules
      .filter((module) => module.id !== result.module.id || module.version !== result.module.version)
      .map((module) => rm(moduleDirectory(module.id, module.version), { recursive: true, force: true })));
    if (targetWasReplaced) await rm(replacedTarget, { recursive: true, force: true });
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
  return manifest;
}

export async function readPhonoscopeCompiledModule(id: string, version: string): Promise<{ module: PhonoscopeCompiledModule; hash: string }> {
  if (id === "bpm-pulse" && version === "1.0.0") {
    const builtin = builtinRecord();
    return { module: builtin.compiled, hash: builtin.summary.hash };
  }
  const directory = moduleDirectory(id, version);
  const [compiled, manifest] = await Promise.all([
    readFile(path.join(directory, "compiled.json"), "utf8"),
    readStoredManifest(directory),
  ]);
  const parsed = JSON.parse(compiled) as PhonoscopeCompiledModule;
  return {
    module: {
      ...parsed,
      paletteSlots: parsed.paletteSlots ?? PHONOSCOPE_CORE_PALETTE_SLOTS,
    },
    hash: manifest.hash,
  };
}

export async function readPhonoscopeSource(id: string, version: string) {
  if (id === "bpm-pulse" && version === "1.0.0") return builtinRecord().source;
  return readFile(path.join(moduleDirectory(id, version), "module.yaml"), "utf8");
}

export async function readPhonoscopeAsset(id: string, version: string, assetPath: string) {
  if (id === "bpm-pulse" && version === "1.0.0") throw new Error("Built-in module has no downloadable assets");
  const normalized = validateArchivePath(assetPath);
  if (!isAllowedAsset(normalized)) throw new Error("Unsupported asset path");
  return readFile(path.join(moduleDirectory(id, version), ...normalized.split("/")));
}

export async function removePhonoscopeModule(id: string, version: string) {
  if (id === "bpm-pulse" && version === "1.0.0") throw new Error("The built-in module cannot be removed");
  const config = await readPhonoscopeConfig();
  if (config.activeModuleId === id && config.activeModuleVersion === version) {
    throw new Error("Select another module before deleting the active version");
  }
  const target = moduleDirectory(id, version);
  await rm(target, { recursive: true, force: false });
}
