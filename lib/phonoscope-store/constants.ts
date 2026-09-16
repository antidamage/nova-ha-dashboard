import { PHONOSCOPE_CORE_PALETTE_SLOTS } from "../phonoscope";
import { PHONOSCOPE_SCHEMA_VERSION } from "../phonoscope-migrate-v6";
import type { PhonoscopeColorValue } from "../types";
import type { PhonoscopeConfig } from "./types";

export const RETIRED_PHONOSCOPE_MODULE_IDS = new Set(["hypervault"]);


export const DEFAULT_PHONOSCOPE_CONFIG: Omit<PhonoscopeConfig, "updatedAt"> = {
  schemaVersion: PHONOSCOPE_SCHEMA_VERSION,
  activeModuleId: "bpm-pulse",
  activeModuleVersion: "1.0.0",
  idleBehavior: "ambient",
  // Off by default: a screen that starts bouncing a logo on its own is a
  // surprise, and this is a thing to turn on rather than to discover.
  screensaverSeconds: 0,
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

export const DEFAULT_COLORS: Record<string, PhonoscopeColorValue> = Object.fromEntries(
  PHONOSCOPE_CORE_PALETTE_SLOTS.map((slot) => [slot.id, {
    rgb: slot.defaultRgb,
    intensity: 100,
    opacity: 100,
    cursor: { x: 0.5, y: 0.5 },
  }]),
);


export const PHONOSCOPE_DRIVER_TYPES = [
  "beat", "downbeat", "timer", "song", "energy", "bass", "mid", "treble", "random",
] as const;
export const PHONOSCOPE_PULSE_TYPES = ["beat", "downbeat", "timer", "song"] as const;
/** An effect id is a module setting id or a private picture effect (`__glowBlur`). */
export const PHONOSCOPE_EFFECT_ID = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
/** Enough modifiers to be expressive; the lane signal saturates at 4 regardless. */
export const PHONOSCOPE_MAX_MODIFIERS = 4;

