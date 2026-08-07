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
import { decimalStepGranularity } from "./slider-step";
import { migratePhonoscopeToV3, PHONOSCOPE_DEFAULT_SETTINGS_GROUP_ID } from "./phonoscope-migrate-v3";
import {
  migratePhonoscopeModuleSettingsToPercent,
  migratePhonoscopeScalarsToPercent,
  migratePhonoscopeSettingsGroupsToPercent,
  PHONOSCOPE_PERCENT_GEOMETRY_VERSION,
} from "./phonoscope-migrate-v4";
import {
  migratePhonoscopeRandomLanes,
  PHONOSCOPE_SCHEMA_VERSION,
} from "./phonoscope-migrate-v5";
import { phonoscopeEffectDeclarations } from "./phonoscope-effects";
import { isPhonoscopeThemePulseEffect, PHONOSCOPE_DIVIDE_CHOICES } from "./phonoscope-drivers";
import type {
  PhonoscopeColorGroup,
  PhonoscopeColorGroupEntry,
  PhonoscopeColorTheme,
  PhonoscopeColorValue,
  PhonoscopeCombineMode,
  PhonoscopeDriver,
  PhonoscopeDriverLane,
  PhonoscopeEffectBinding,
  PhonoscopeHouseParty,
  PhonoscopePreferences,
  PhonoscopeSettingsGroup,
} from "./types";

const MODULE_ROOT =
  process.env.NOVA_PHONOSCOPE_MODULES_DIR ?? path.join(process.cwd(), "data", "phonoscope", "modules");
const RETIRED_PHONOSCOPE_MODULE_IDS = new Set(["hypervault"]);

export type PhonoscopeConfig = {
  /**
   * Which migrations have already been applied to the stored shape. Read
   * bumps it to `PHONOSCOPE_SCHEMA_VERSION`; the next write persists it. See
   * `phonoscope-migrate-v4.ts` for why the percentage conversion cannot be
   * sniffed from the values themselves.
   */
  schemaVersion: number;
  activeModuleId: string;
  activeModuleVersion: string;
  idleBehavior: "ambient" | "black" | "return";
  /**
   * The centre of the picture, when it is text.
   *
   * The image half comes from the live colour theme, never from here. A
   * non-blank message overrides whatever image the theme supplies; blank means
   * the theme's image shows, and a theme with no image means nothing is drawn.
   */
  message: string;
  statusOverlay: boolean;
  transitionMs: number;
  providers: {
    spotify: boolean;
    songle: boolean;
    essentia: boolean;
    reccoBeats: boolean;
    lrclib: boolean;
  };
  moduleSettings: Record<string, Record<string, number>>;
  pendingStructuralModuleSettings: Record<string, Record<string, number>>;
  moduleReloadGenerations: Record<string, number>;
  settingsGroups: PhonoscopeSettingsGroup[];
  colorThemes: PhonoscopeColorTheme[];
  colorGroups: PhonoscopeColorGroup[];
  moduleColorGroupIds: Record<string, string>;
  chooseColorGroupByGenre: boolean;
  structuralSettings: Record<string, number>;
  houseParty: PhonoscopeHouseParty;
  soloColorThemeId: string;
  soloSettingsGroupId: string;
  editorPreviewColorGroupId: string;
  editorPreviewColorEntryId: string;
  updatedAt?: string;
};

export const DEFAULT_PHONOSCOPE_CONFIG: Omit<PhonoscopeConfig, "updatedAt"> = {
  schemaVersion: PHONOSCOPE_SCHEMA_VERSION,
  activeModuleId: "bpm-pulse",
  activeModuleVersion: "1.0.0",
  idleBehavior: "ambient",
  message: "",
  statusOverlay: true,
  transitionMs: 600,
  providers: {
    spotify: true,
    songle: true,
    essentia: true,
    reccoBeats: true,
    lrclib: true,
  },
  moduleSettings: {},
  pendingStructuralModuleSettings: {},
  moduleReloadGenerations: {},
  settingsGroups: [],
  colorThemes: [],
  colorGroups: [],
  moduleColorGroupIds: {},
  chooseColorGroupByGenre: false,
  structuralSettings: {},
  houseParty: {
    enabled: true,
    hueMode: "follow",
    brightnessMode: "follow",
  },
  soloColorThemeId: "",
  soloSettingsGroupId: "",
  editorPreviewColorGroupId: "",
  editorPreviewColorEntryId: "",
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


function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

const PHONOSCOPE_DRIVER_TYPES = [
  "beat", "downbeat", "timer", "song", "energy", "bass", "mid", "treble", "random",
] as const;
const PHONOSCOPE_PULSE_TYPES = ["beat", "downbeat", "timer", "song"] as const;
/** An effect id is a module setting id or a private picture effect (`__glowBlur`). */
const PHONOSCOPE_EFFECT_ID = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
/** Enough modifiers to be expressive; the lane signal saturates at 4 regardless. */
const PHONOSCOPE_MAX_MODIFIERS = 4;

/**
 * Every driver field is always present on the wire. `config_client.cpp` and
 * `PhonoscopeModels.swift` hand-parse the same JSON, and a sparse driver would
 * cost each of them a branch per field.
 */
function normalizeDriver(value: unknown): PhonoscopeDriver {
  const raw = isRecord(value) ? value : {};
  const type = (PHONOSCOPE_DRIVER_TYPES as readonly string[]).includes(String(raw.type))
    ? String(raw.type) as PhonoscopeDriver["type"]
    : "beat";
  const requested = Math.round(finiteClamped(raw.divide, 1, 1, 8));
  const divide = PHONOSCOPE_DIVIDE_CHOICES.includes(requested) ? requested : 1;
  // Counting and subdividing are the two directions of one control: a
  // subdivided driver is always "every one", and its offset is nothing.
  const every = divide > 1 ? 1 : Math.round(finiteClamped(raw.every, 1, 1, 16));
  return {
    type,
    every,
    divide,
    // An offset only means anything inside the cycle it offsets within.
    offset: Math.round(finiteClamped(raw.offset, 0, 0, Math.max(0, every - 1))),
    intervalSeconds: finiteClamped(raw.intervalSeconds, 4, 0.25, 600),
    cadence: (PHONOSCOPE_PULSE_TYPES as readonly string[]).includes(String(raw.cadence))
      ? String(raw.cadence) as PhonoscopeDriver["cadence"]
      : "beat",
  };
}

/**
 * Bindings stay sparse: an absent field inherits the effect's declaration, so
 * only what the author actually set is written back. Ranges are deliberately
 * not clamped here — the declaration that bounds them belongs to the module,
 * which the evaluator resolves against at draw time.
 */
function normalizeBinding(value: unknown, index: number): PhonoscopeEffectBinding | null {
  if (!isRecord(value)) return null;
  const effect = typeof value.effect === "string" ? value.effect.trim() : "";
  if (!PHONOSCOPE_EFFECT_ID.test(effect)) return null;
  const binding: PhonoscopeEffectBinding = {
    id: typeof value.id === "string" && value.id.trim()
      ? value.id.trim().slice(0, 64)
      : `bind_${index + 1}`,
    effect,
  };
  // The rotation pulses are instructions — any non-zero contribution advances
  // the rotation or flips the alt state — so their range is fixed at the
  // declared 0-1 and the editor does not offer it. Dropping a stored range
  // keeps what runs identical to what is shown.
  if (!isPhonoscopeThemePulseEffect(effect)) {
    if (Number.isFinite(Number(value.min))) binding.min = Number(value.min);
    if (Number.isFinite(Number(value.max))) binding.max = Number(value.max);
  }
  if (Number.isFinite(Number(value.attackSeconds))) {
    binding.attackSeconds = finiteClamped(value.attackSeconds, 0.05, 0, 60);
  }
  if (Number.isFinite(Number(value.holdSeconds))) {
    binding.holdSeconds = finiteClamped(value.holdSeconds, 0, 0, 60);
  }
  if (Number.isFinite(Number(value.releaseSeconds))) {
    binding.releaseSeconds = finiteClamped(value.releaseSeconds, 0.6, 0, 600);
  }
  // Sparse like everything else: off is simply absent, so only a binding that
  // actually randomises its target carries the flag.
  if (value.randomValue === true) binding.randomValue = true;
  if (isRecord(value.params)) {
    const params: Record<string, number> = {};
    for (const [key, entry] of Object.entries(value.params)) {
      if (/^[a-z][a-zA-Z0-9_]{0,31}$/.test(key) && Number.isFinite(Number(entry))) {
        params[key] = Number(entry);
      }
    }
    if (Object.keys(params).length) binding.params = params;
  }
  return binding;
}

function normalizeLane(value: unknown, index: number): PhonoscopeDriverLane | null {
  if (!isRecord(value)) return null;
  return {
    id: typeof value.id === "string" && value.id.trim()
      ? value.id.trim().slice(0, 64)
      : `lane_${index + 1}`,
    driver: normalizeDriver(value.driver),
    modifiers: Array.isArray(value.modifiers)
      ? value.modifiers.slice(0, PHONOSCOPE_MAX_MODIFIERS).map(normalizeDriver)
      : [],
    bindings: Array.isArray(value.bindings)
      ? value.bindings.flatMap((entry, position) => {
          const binding = normalizeBinding(entry, position);
          return binding ? [binding] : [];
        })
      : [],
  };
}

/**
 * Drop bindings the installed module no longer declares, and with them any lane
 * left with nothing resolvable.
 *
 * A lane that has *never* had a binding is not stale — it is one the editor has
 * just added and the user has not wired an effect into yet. Pruning it too made
 * "Add driver lane" silently undo itself on the first save, which read as the
 * button doing nothing at all.
 */
export function prunePhonoscopeLanes(
  lanes: PhonoscopeDriverLane[],
  declarations: ReadonlyMap<string, unknown> | ReadonlySet<string>,
): PhonoscopeDriverLane[] {
  const declares = (effect: string) => declarations.has(effect);
  return lanes.flatMap((lane) => {
    const bindings = lane.bindings.filter((binding) => declares(binding.effect));
    if (lane.bindings.length > 0 && bindings.length === 0) return [];
    return [{ ...lane, bindings }];
  });
}

export function normalizePhonoscopeSettingsGroups(value: unknown): PhonoscopeSettingsGroup[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  const groups = value.flatMap((raw, index): PhonoscopeSettingsGroup[] => {
    if (!isRecord(raw)) return [];
    const id = typeof raw.id === "string" && PHONOSCOPE_MODULE_ID.test(raw.id)
      ? raw.id
      : `settings_${index + 1}`;
    if (ids.has(id)) return [];
    ids.add(id);
    const combine: Record<string, PhonoscopeCombineMode> = {};
    if (isRecord(raw.combine)) {
      for (const [effect, mode] of Object.entries(raw.combine)) {
        // Anything unrecognised reads as `add`, which is what every effect did
        // before combine modes existed — a config written by a newer dashboard
        // degrades rather than being rejected.
        if (PHONOSCOPE_EFFECT_ID.test(effect)) {
          combine[effect] = mode === "strongest" || mode === "common" || mode === "override"
            ? mode
            : "add";
        }
      }
    }
    const staticSettings: Record<string, number> = {};
    if (isRecord(raw.staticSettings)) {
      for (const [setting, entry] of Object.entries(raw.staticSettings)) {
        if (PHONOSCOPE_EFFECT_ID.test(setting) && Number.isFinite(Number(entry))) {
          staticSettings[setting] = Number(entry);
        }
      }
    }
    return [{
      id,
      name: typeof raw.name === "string" && raw.name.trim()
        ? raw.name.trim().slice(0, 60)
        : `Settings ${index + 1}`,
      moduleId: typeof raw.moduleId === "string" && PHONOSCOPE_MODULE_ID.test(raw.moduleId)
        ? raw.moduleId
        : "particle-ripples",
      lanes: Array.isArray(raw.lanes)
        ? raw.lanes.flatMap((entry, position) => {
            const lane = normalizeLane(entry, position);
            return lane ? [lane] : [];
          })
        : [],
      combine,
      staticSettings,
      isDefault: raw.isDefault === true,
    }];
  });
  if (!groups.length) return groups;
  // Exactly one group carries the default flag. Everything falls back to it, so
  // an absent or duplicated flag is repaired rather than rejected.
  const chosen = Math.max(0, groups.findIndex((group) => group.isDefault));
  groups.forEach((group, index) => { group.isDefault = index === chosen; });
  return groups;
}

export function normalizePhonoscopeColorThemes(value: unknown): PhonoscopeColorTheme[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return value.flatMap((raw, index): PhonoscopeColorTheme[] => {
    if (!isRecord(raw)) return [];
    const id = typeof raw.id === "string" && PHONOSCOPE_MODULE_ID.test(raw.id)
      ? raw.id
      : `theme_${index + 1}`;
    if (ids.has(id)) return [];
    ids.add(id);
    const colors: Record<string, PhonoscopeColorValue> = {};
    if (isRecord(raw.colors)) {
      for (const [slot, colour] of Object.entries(raw.colors)) {
        if (!/^[a-z][a-zA-Z0-9_-]{0,63}$/.test(slot)) continue;
        colors[slot] = normalizedColor(colour, DEFAULT_COLORS[slot] ?? DEFAULT_COLORS.primary);
      }
    }
    return [{
      id,
      name: typeof raw.name === "string" && raw.name.trim()
        ? raw.name.trim().slice(0, 60)
        : `Colour theme ${index + 1}`,
      moduleId: typeof raw.moduleId === "string" && PHONOSCOPE_MODULE_ID.test(raw.moduleId)
        ? raw.moduleId
        : "particle-ripples",
      colors,
      // The theme's own centre image. Null rather than "" so "this theme does
      // not supply one" is distinguishable from an id that has been cleared —
      // both mean nothing is drawn, but only one of them is a deliberate empty.
      imageId: typeof raw.imageId === "string" && raw.imageId ? raw.imageId.slice(0, 64) : null,
    }];
  });
}

/**
 * A colour group is the rotation playlist. Entries are validated against the
 * flat libraries they reference, and a theme may legitimately appear in several
 * entries with different settings groups — that is the whole point — so only
 * the entry ids are deduplicated.
 *
 * Genres are exclusive across groups. Conflicts resolve first-wins here; the
 * editor performs an explicit steal (removing the genre from its previous
 * owner) so the user's most recent assignment is the one that survives.
 */
export function normalizePhonoscopeColorGroups(
  value: unknown,
  themes: PhonoscopeColorTheme[],
  settingsGroups: PhonoscopeSettingsGroup[],
): PhonoscopeColorGroup[] {
  if (!Array.isArray(value)) return [];
  const themeIds = new Set(themes.map((theme) => theme.id));
  const settingsIds = new Set(settingsGroups.map((group) => group.id));
  const fallbackSettingsId = settingsGroups.find((group) => group.isDefault)?.id
    ?? settingsGroups[0]?.id
    ?? PHONOSCOPE_DEFAULT_SETTINGS_GROUP_ID;
  const groupIds = new Set<string>();
  const claimedGenres = new Set<string>();

  const groups = value.flatMap((raw, index): PhonoscopeColorGroup[] => {
    if (!isRecord(raw)) return [];
    const id = typeof raw.id === "string" && PHONOSCOPE_MODULE_ID.test(raw.id)
      ? raw.id
      : `group_${index + 1}`;
    if (groupIds.has(id)) return [];
    groupIds.add(id);

    const entryIds = new Set<string>();
    const entries = Array.isArray(raw.entries)
      ? raw.entries.flatMap((rawEntry, position): PhonoscopeColorGroupEntry[] => {
          if (!isRecord(rawEntry)) return [];
          const themeId = typeof rawEntry.themeId === "string" ? rawEntry.themeId : "";
          if (!themeIds.has(themeId)) return [];
          let entryId = typeof rawEntry.id === "string" && rawEntry.id.trim()
            ? rawEntry.id.trim().slice(0, 64)
            : `entry_${position + 1}`;
          while (entryIds.has(entryId)) entryId = `${entryId}_${position + 1}`;
          entryIds.add(entryId);
          const chosen = Array.isArray(rawEntry.settingsGroupIds)
            ? [...new Set(rawEntry.settingsGroupIds.filter(
                (entry): entry is string => typeof entry === "string" && settingsIds.has(entry)))]
            : [];
          // The alt is a link into the same library, so an id that no longer
          // resolves — or one pointing back at this entry's own theme, which
          // would be an alt that does nothing — is dropped rather than kept as
          // a dangling reference. The entry then simply has no alternative.
          const rawAlt = typeof rawEntry.altThemeId === "string" ? rawEntry.altThemeId : "";
          const altThemeId = rawAlt && rawAlt !== themeId && themeIds.has(rawAlt) ? rawAlt : null;
          return [{
            id: entryId,
            themeId,
            altThemeId,
            // An entry that names nothing usable still has to render, so it
            // falls back to the default settings group rather than going dark.
            settingsGroupIds: chosen.length ? chosen : [fallbackSettingsId],
          }];
        })
      : [];

    const genres = Array.isArray(raw.genres)
      ? [...new Set(raw.genres.flatMap((genre) => {
          if (typeof genre !== "string" || !genre.trim()) return [];
          const cleaned = genre.trim().slice(0, 48);
          const key = cleaned.toLowerCase();
          if (claimedGenres.has(key)) return [];
          claimedGenres.add(key);
          return [cleaned];
        }))]
      : [];

    return [{
      id,
      moduleId: typeof raw.moduleId === "string" && PHONOSCOPE_MODULE_ID.test(raw.moduleId)
        ? raw.moduleId
        : "particle-ripples",
      name: typeof raw.name === "string" && raw.name.trim()
        ? raw.name.trim().slice(0, 60)
        : `Colour group ${index + 1}`,
      entries,
      genres,
      isDefault: raw.isDefault === true,
    }];
  });

  if (!groups.length) return groups;
  // Exactly one group catches tracks with no genre or an unclaimed one.
  const chosen = Math.max(0, groups.findIndex((group) => group.isDefault));
  groups.forEach((group, index) => { group.isDefault = index === chosen; });
  return groups;
}

function normalizeHouseParty(value: unknown): PhonoscopeHouseParty {
  const raw = isRecord(value) ? value : {};
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
    hueMode: raw.hueMode === "complement" ? "complement" : "follow",
    brightnessMode: raw.brightnessMode === "oppose" || raw.brightnessMode === "ignore"
      ? raw.brightnessMode
      : "follow",
  };
}

/**
 * The settings group everything falls back to. It can never be deleted, so a
 * configuration that somehow lost it gets an empty one rather than a rotation
 * with nowhere to resolve.
 */
function withDefaultSettingsGroup(
  groups: PhonoscopeSettingsGroup[],
  moduleId: string,
): PhonoscopeSettingsGroup[] {
  if (groups.some((group) => group.isDefault)) return groups;
  return [{
    id: PHONOSCOPE_DEFAULT_SETTINGS_GROUP_ID,
    name: "Default",
    moduleId,
    lanes: [],
    combine: {},
    staticSettings: {},
    isDefault: true,
  }, ...groups];
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
  const needsRandomSplit = storedVersion < PHONOSCOPE_SCHEMA_VERSION;

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
  const settingsGroups = needsPercentGeometry
    ? migratePhonoscopeSettingsGroupsToPercent(normalizedSettingsGroups)
    : normalizedSettingsGroups;
  const colorThemes = normalizePhonoscopeColorThemes(
    migrated ? migrated.colorThemes : raw.colorThemes);
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
      return needsPercentGeometry ? migratePhonoscopeScalarsToPercent(values) : values;
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
  // Nudge the GPU renderer on iridium. It re-reads the config itself, so this
  // stays a notification rather than a second serialisation of the same state.
  publishPhonoscopeConfig("config");
  return readPhonoscopeConfig();
}

function readBoolean(source: unknown, key: string, fallback: boolean) {
  if (!isRecord(source)) return fallback;
  return typeof source[key] === "boolean" ? source[key] : fallback;
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
