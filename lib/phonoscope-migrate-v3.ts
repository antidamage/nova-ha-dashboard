import {
  PHONOSCOPE_GLOW_BLEND_EFFECT,
  PHONOSCOPE_GLOW_BLUR_EFFECT,
  PHONOSCOPE_GLOW_OPACITY_EFFECT,
  PHONOSCOPE_MESSAGE_SCALE_EFFECT,
  PHONOSCOPE_THEME_CHANGE_EFFECT,
} from "./phonoscope-drivers";
import type {
  PhonoscopeColorGroup,
  PhonoscopeColorGroupEntry,
  PhonoscopeColorTheme,
  PhonoscopeDriver,
  PhonoscopeDriverLane,
  PhonoscopeEffectBinding,
  PhonoscopeHouseParty,
  PhonoscopeSettingsGroup,
} from "./types";

/**
 * One-shot migration from the pre-lane Phonoscope configuration.
 *
 * Before this, a setting had exactly one parameter source, colour themes owned
 * both their colours and a set of overrides, and rotation timing lived on the
 * colour group. Afterwards, behaviour lives in named settings groups made of
 * driver lanes, colours live in a flat theme library, and a colour group is an
 * ordered playlist pairing the two.
 *
 * The migration is deliberately behaviour-preserving: every theme becomes one
 * playlist entry in its original order, carrying the Default settings group
 * underneath its own, which is exactly what the old baseline-then-override
 * cascade meant.
 */

export const PHONOSCOPE_DEFAULT_SETTINGS_GROUP_ID = "default";

type LegacySource = {
  type?: unknown;
  value?: unknown;
  min?: unknown;
  max?: unknown;
  cadence?: unknown;
  intervalSeconds?: unknown;
  transitionSeconds?: unknown;
  attackSeconds?: unknown;
  holdSeconds?: unknown;
  releaseSeconds?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function numberOr(value: unknown, fallback: number) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function slug(value: string, fallback: string) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[a-z][a-z0-9_-]{1,63}$/.test(normalized) ? normalized : fallback;
}

let counter = 0;
function nextId(prefix: string) {
  counter += 1;
  return `${prefix}_${counter.toString(36)}`;
}

/** Reset the id counter so a migration run is reproducible in tests. */
export function resetPhonoscopeMigrationIds() {
  counter = 0;
}

function driverOf(partial: Partial<PhonoscopeDriver>): PhonoscopeDriver {
  return {
    type: partial.type ?? "beat",
    every: partial.every ?? 1,
    offset: partial.offset ?? 0,
    divide: partial.divide ?? 1,
    intervalSeconds: partial.intervalSeconds ?? 4,
    cadence: partial.cadence ?? "beat",
  };
}

/**
 * A pre-lane source becomes a driver plus the binding fields it carried.
 * Manual sources have no driver at all and are dropped by the caller: the new
 * model has no static layer, and their values were baked into the module
 * manifest's defaults instead.
 */
function laneDriverFor(source: LegacySource): PhonoscopeDriver | null {
  const type = String(source.type ?? "");
  if (type === "manual" || type === "fixed" || !type) return null;
  if (type === "random") {
    // `bar` was a synonym for downbeat, and `interval` is now the timer driver.
    const cadence = String(source.cadence ?? "beat");
    return driverOf({
      type: "random",
      cadence: cadence === "bar" || cadence === "downbeat"
        ? "downbeat"
        : cadence === "song"
          ? "song"
          : cadence === "interval"
            ? "timer"
            : "beat",
      intervalSeconds: numberOr(source.intervalSeconds, 4),
    });
  }
  if (["beat", "downbeat", "energy", "bass", "mid", "treble"].includes(type)) {
    return driverOf({ type: type as PhonoscopeDriver["type"] });
  }
  return null;
}

function bindingFor(
  effect: string,
  source: LegacySource,
  driver: PhonoscopeDriver,
): PhonoscopeEffectBinding {
  // A legacy random source sampled a value and glided to it, ignoring the
  // envelope entirely. Both halves of that now live on the binding: the drawn
  // value is `randomValue`, and the glide is the attack it ramps over. Its
  // stored `attackSeconds`, which the old evaluator never read, is discarded
  // rather than resurrected.
  const random = driver.type === "random";
  return {
    id: nextId("bind"),
    effect,
    min: numberOr(source.min, 0),
    max: numberOr(source.max, 0),
    attackSeconds: random
      ? Math.max(0, numberOr(source.transitionSeconds, 0.5))
      : numberOr(source.attackSeconds, 0.05),
    holdSeconds: numberOr(source.holdSeconds, 0),
    releaseSeconds: numberOr(source.releaseSeconds, 0.6),
    ...(random ? { randomValue: true } : {}),
  };
}

/**
 * A stable key so sources sharing a driver land in the same lane. Two random
 * sources that differed only by glide now merge, which is right: the glide has
 * become a per-binding attack, so one lane can carry both.
 */
function laneKey(driver: PhonoscopeDriver) {
  return driver.type === "random"
    ? `random:${driver.cadence}:${driver.intervalSeconds}`
    : driver.type;
}

/**
 * Turn a `{ settingId: source }` map into lanes, one per distinct driver, so a
 * configuration that drove four settings from the bass ends up with one Bass
 * lane holding four effects rather than four identical lanes.
 */
function lanesFromSources(sources: Record<string, unknown>): PhonoscopeDriverLane[] {
  const byDriver = new Map<string, PhonoscopeDriverLane>();
  for (const [effect, rawSource] of Object.entries(sources)) {
    if (!isRecord(rawSource)) continue;
    const driver = laneDriverFor(rawSource);
    if (!driver) continue;
    const key = laneKey(driver);
    let lane = byDriver.get(key);
    if (!lane) {
      lane = { id: nextId("lane"), driver, modifiers: [], bindings: [] };
      byDriver.set(key, lane);
    }
    lane.bindings.push(bindingFor(effect, rawSource, driver));
  }
  return [...byDriver.values()];
}

/**
 * The colour group's old rotation controls become one `__themeChange` binding:
 * `changeMode` picks the driver, `waitSeconds` becomes the timer interval, and
 * `transitionSeconds` becomes the release — the cross-fade.
 */
function themeChangeLane(group: Record<string, unknown>): PhonoscopeDriverLane {
  const changeMode = String(group.changeMode ?? "interval");
  const driver = changeMode === "song"
    ? driverOf({ type: "song" })
    : changeMode === "downbeat"
      ? driverOf({ type: "downbeat" })
      : driverOf({ type: "timer", intervalSeconds: Math.max(0.25, numberOr(group.waitSeconds, 60)) });
  return {
    id: nextId("lane"),
    driver,
    modifiers: [],
    bindings: [{
      id: nextId("bind"),
      effect: PHONOSCOPE_THEME_CHANGE_EFFECT,
      min: 0,
      max: 1,
      attackSeconds: 0,
      holdSeconds: 0,
      releaseSeconds: Math.max(0, numberOr(group.transitionSeconds, 3)),
      params: { order: String(group.order ?? "sequential") === "shuffle" ? 1 : 0 },
    }],
  };
}

/**
 * The blend modes in the order they are numbered on the axis. Only ever
 * appended: a stored range is a pair of numbers on it, so renumbering would
 * silently repoint every configuration that drives the parameter.
 */
const GLOW_BLEND_MODE_AXIS = ["screen", "multiply", "overlay"] as const;

/** The glow overlay and message scale were already driven; they just move. */
function pictureLanes(raw: Record<string, unknown>): PhonoscopeDriverLane[] {
  const sources: Record<string, unknown> = {};
  const glow = isRecord(raw.glowOverlay) ? raw.glowOverlay : {};
  if (isRecord(glow.blurSource)) sources[PHONOSCOPE_GLOW_BLUR_EFFECT] = glow.blurSource;
  if (isRecord(glow.opacitySource)) sources[PHONOSCOPE_GLOW_OPACITY_EFFECT] = glow.opacitySource;
  if (isRecord(glow.blendModeSource)) sources[PHONOSCOPE_GLOW_BLEND_EFFECT] = glow.blendModeSource;
  if (isRecord(raw.messageScaleSource)) sources[PHONOSCOPE_MESSAGE_SCALE_EFFECT] = raw.messageScaleSource;
  return lanesFromSources(sources);
}

/**
 * Configurations written before the blend mode became a driven parameter carry
 * a plain `blendMode` string. It was a fixed choice rather than a driver, so it
 * has no lane; it survives as the module-independent default the engines fall
 * back to, which is what a manual source always meant.
 */
export function legacyGlowBlendModeIndex(raw: unknown): number | null {
  if (!isRecord(raw)) return null;
  const glow = isRecord(raw.glowOverlay) ? raw.glowOverlay : {};
  if (glow.blendModeSource !== undefined || typeof glow.blendMode !== "string") return null;
  const index = (GLOW_BLEND_MODE_AXIS as readonly string[]).indexOf(glow.blendMode);
  return index >= 0 ? index : null;
}

export type PhonoscopeMigrationResult = {
  settingsGroups: PhonoscopeSettingsGroup[];
  colorThemes: PhonoscopeColorTheme[];
  colorGroups: PhonoscopeColorGroup[];
  houseParty: PhonoscopeHouseParty;
  structuralSettings: Record<string, number>;
  /** Set only when a pre-driver `blendMode` string was the stored choice. */
  glowBlendMode?: number;
};

/**
 * `raw` is `preferences.phonoscope` in its pre-lane shape. Returns the v3
 * shape; the caller decides whether to persist it.
 */
export function migratePhonoscopeToV3(raw: unknown): PhonoscopeMigrationResult {
  resetPhonoscopeMigrationIds();
  const source = isRecord(raw) ? raw : {};
  const activeModuleId = typeof source.activeModuleId === "string"
    ? source.activeModuleId
    : "particle-ripples";

  const legacyGroups = Array.isArray(source.colorGroups) ? source.colorGroups.filter(isRecord) : [];
  const selectedGroup = legacyGroups[0] ?? {};

  // The Default settings group: everything that applied regardless of theme.
  const baselineSources = isRecord(source.moduleParameterSources)
    && isRecord(source.moduleParameterSources[activeModuleId])
    ? source.moduleParameterSources[activeModuleId] as Record<string, unknown>
    : {};
  const defaultGroup: PhonoscopeSettingsGroup = {
    id: PHONOSCOPE_DEFAULT_SETTINGS_GROUP_ID,
    name: "Default",
    moduleId: activeModuleId,
    lanes: [
      ...lanesFromSources(baselineSources),
      ...pictureLanes(source),
      ...(legacyGroups.length ? [themeChangeLane(selectedGroup)] : []),
    ],
    combine: {},
    staticSettings: {},
    isDefault: true,
  };

  // Structural settings could never be driven, so they move across as values.
  const moduleSettings = isRecord(source.moduleSettings)
    && isRecord(source.moduleSettings[activeModuleId])
    ? source.moduleSettings[activeModuleId] as Record<string, unknown>
    : {};
  if (Number.isFinite(Number(moduleSettings.complexity))) {
    defaultGroup.staticSettings.complexity = Number(moduleSettings.complexity);
  }

  const settingsGroups: PhonoscopeSettingsGroup[] = [defaultGroup];
  const colorThemes: PhonoscopeColorTheme[] = [];
  const colorGroups: PhonoscopeColorGroup[] = [];
  const usedThemeIds = new Set<string>();
  const usedGroupIds = new Set<string>([PHONOSCOPE_DEFAULT_SETTINGS_GROUP_ID]);

  legacyGroups.forEach((rawGroup, groupIndex) => {
    const moduleId = typeof rawGroup.moduleId === "string" ? rawGroup.moduleId : activeModuleId;
    const themes = Array.isArray(rawGroup.themes) ? rawGroup.themes.filter(isRecord) : [];
    const entries: PhonoscopeColorGroupEntry[] = [];

    themes.forEach((rawTheme, themeIndex) => {
      const name = typeof rawTheme.name === "string" && rawTheme.name.trim()
        ? rawTheme.name.trim().slice(0, 60)
        : `Colour theme ${themeIndex + 1}`;
      let themeId = typeof rawTheme.id === "string" && rawTheme.id
        ? slug(rawTheme.id, `theme_${themeIndex + 1}`)
        : slug(name, `theme_${themeIndex + 1}`);
      while (usedThemeIds.has(themeId)) themeId = `${themeId}_${themeIndex + 1}`;
      usedThemeIds.add(themeId);
      colorThemes.push({
        id: themeId,
        name,
        moduleId,
        colors: isRecord(rawTheme.colors)
          ? rawTheme.colors as PhonoscopeColorTheme["colors"]
          : {},
        // Both image slots postdate the shape this migration reads from, so
        // there is never one to carry across.
        imageId: null,
        backgroundImageId: null,
      });

      // A theme that carried overrides becomes its own settings group, layered
      // on top of Default exactly as the old cascade applied it.
      const settingsGroupIds = [PHONOSCOPE_DEFAULT_SETTINGS_GROUP_ID];
      const overrides = isRecord(rawTheme.parameterOverrides)
        && isRecord(rawTheme.parameterOverrides[moduleId])
        ? rawTheme.parameterOverrides[moduleId] as Record<string, unknown>
        : {};
      const lanes = lanesFromSources(overrides);
      if (lanes.length) {
        let ownId = `${themeId}_settings`;
        while (usedGroupIds.has(ownId)) ownId = `${ownId}_x`;
        usedGroupIds.add(ownId);
        settingsGroups.push({
          id: ownId,
          name,
          moduleId,
          lanes,
          combine: {},
          staticSettings: {},
          isDefault: false,
        });
        settingsGroupIds.push(ownId);
      }
      entries.push({ id: nextId("entry"), themeId, settingsGroupIds });
    });

    colorGroups.push({
      id: typeof rawGroup.id === "string" && rawGroup.id
        ? slug(rawGroup.id, `group_${groupIndex + 1}`)
        : `group_${groupIndex + 1}`,
      moduleId,
      name: typeof rawGroup.name === "string" && rawGroup.name.trim()
        ? rawGroup.name.trim().slice(0, 60)
        : `Colour group ${groupIndex + 1}`,
      entries,
      genres: [],
      // The first group catches every track until genres are assigned by hand.
      isDefault: groupIndex === 0,
    });
  });

  const legacyBlend = legacyGlowBlendModeIndex(source);
  return {
    settingsGroups,
    colorThemes,
    colorGroups,
    ...(legacyBlend === null ? {} : { glowBlendMode: legacyBlend }),
    houseParty: {
      // The renderer only ever took House Party as a launch flag, so there is
      // no stored value to carry: true preserves what the stack actually does.
      enabled: true,
      hueMode: selectedGroup.housePartyHueMode === "complement" ? "complement" : "follow",
      brightnessMode: selectedGroup.housePartyBrightnessMode === "oppose"
        || selectedGroup.housePartyBrightnessMode === "ignore"
        ? selectedGroup.housePartyBrightnessMode
        : "follow",
    },
    structuralSettings: {},
  };
}
