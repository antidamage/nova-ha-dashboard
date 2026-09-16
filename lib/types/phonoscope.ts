import type { PhonoscopeColorGroup, PhonoscopeColorTheme } from "./phonoscope-color";

export type PhonoscopePreferences = {
  /**
   * Which migrations the stored shape has already been through. Absent on
   * anything written before the percentage-geometry conversion, which is
   * exactly how `readPhonoscopeConfig` knows to apply it. See
   * `lib/phonoscope-migrate-v4.ts`.
   */
  schemaVersion?: number;
  activeModuleId?: string;
  activeModuleVersion?: string;
  idleBehavior?: "ambient" | "black" | "return";
  /**
   * Seconds of silence before the picture fades to black and a randomly chosen
   * centre image bounces around the frame. 0 (or absent) disables it.
   *
   * Global rather than per-module: it is what the screen does when there is no
   * music at all, so it cannot belong to whichever visualiser was going to draw
   * that music. It sits beside `idleBehavior` because it is the same subject —
   * what happens when nothing is playing — and it reuses that setting's fade to
   * black rather than introducing a second one.
   */
  screensaverSeconds?: number;
  message?: string;
  statusOverlay?: boolean;
  transitionMs?: number;
  providers?: {
    spotify?: boolean;
    songle?: boolean;
    essentia?: boolean;
    reccoBeats?: boolean;
    lrclib?: boolean;
  };
  moduleSettings?: Record<string, Record<string, number>>;
  pendingStructuralModuleSettings?: Record<string, Record<string, number>>;
  moduleReloadGenerations?: Record<string, number>;
  /** Named sets of driver lanes. Colour group entries name the ones they ride with. */
  settingsGroups?: PhonoscopeSettingsGroup[];
  /** Flat library of colour-only themes, referenced by colour group entries. */
  colorThemes?: PhonoscopeColorTheme[];
  /** The rotation playlists. */
  colorGroups?: PhonoscopeColorGroup[];
  moduleColorGroupIds?: Record<string, string>;
  /** Route the colour group by the playing track's genre rather than the manual pick. */
  chooseColorGroupByGenre?: boolean;
  /** Undriveable parameters that apply across every settings group. */
  structuralSettings?: Record<string, number>;
  houseParty?: PhonoscopeHouseParty;
  /**
   * Solo locks the visualiser to one colour theme and/or one settings group,
   * overriding the rotation until it is switched off. Unlike the editor preview
   * it is persisted and deliberately survives leaving the page — it is a
   * "hold it here while I work on it" switch, not a transient pin.
   */
  soloColorThemeId?: string;
  soloSettingsGroupId?: string;
  /** Transient dashboard editor preview; cleared when the editor closes. */
  editorPreviewColorGroupId?: string;
  editorPreviewColorEntryId?: string;
  updatedAt?: string;
};

/**
 * One signal a driver lane runs on.
 *
 * `beat`, `downbeat`, `timer` and `song` are pulses; `energy`, `bass`, `mid`
 * and `treble` are continuous levels; `random` is a pulse too — it fires once
 * per `cadence` window, at a random point inside it. The shape is deliberately
 * flat and total rather than a discriminated union, because `config_client.cpp`
 * and `PhonoscopeModels.swift` hand-parse the same JSON and a union costs them a
 * branch per field.
 */
export type PhonoscopeDriverType =
  | "beat"
  | "downbeat"
  | "timer"
  | "song"
  | "energy"
  | "bass"
  | "mid"
  | "treble"
  | "random";

/** The driver types that fire discrete events rather than carrying a level. */
export type PhonoscopePulseType = "beat" | "downbeat" | "timer" | "song";

export type PhonoscopeDriver = {
  type: PhonoscopeDriverType;
  /**
   * Pulse drivers fire on every Nth event, 1-16 — "every 4th downbeat". Level
   * drivers ignore it.
   */
  every: number;
  /** Which event within the `every` cycle, `0..every-1`. */
  offset: number;
  /**
   * Subdivisions per pulse, 1/2/4/8 — the other direction from `every`. A beat
   * driver with `divide: 4` fires four times a beat, a downbeat driver four
   * times a bar. Only `beat` and `downbeat` (and a `random` whose cadence is
   * one of them) subdivide; a subdivided driver always has `every: 1` and
   * `offset: 0`, because which of eight sub-beats a run starts on is not
   * something anyone can hear.
   */
  divide: number;
  /** Seconds between pulses when this driver, or a random driver's cadence, is `timer`. */
  intervalSeconds: number;
  /**
   * `random` only: the pulse whose interval is the window it fires somewhere
   * inside. `every` and `divide` size that window rather than selecting which
   * pulses count, so "every 4th downbeat" is one fire per four bars at a moving
   * moment, not a jittered hit inside the fourth bar.
   */
  cadence: PhonoscopePulseType;
};

/**
 * One appearance of an effect inside a lane. Sparse on purpose: an absent field
 * inherits the effect's declared default, so a binding stores only what the user
 * actually chose to change.
 */
export type PhonoscopeEffectBinding = {
  id: string;
  /** A module setting id, or a private picture effect such as `__glowBlur`. */
  effect: string;
  min?: number;
  max?: number;
  attackSeconds?: number;
  holdSeconds?: number;
  releaseSeconds?: number;
  /**
   * Draw the target at random from inside `[min, max]` on each lane event
   * instead of always driving to `max`. The envelope is untouched: it still
   * shapes the approach, so the ramp reads as the transition curve from the
   * bottom of the range up to whatever was drawn this time.
   *
   * Orthogonal to the `random` driver — that randomises *when* the lane fires,
   * this randomises *how far* it goes — so the two stack in any combination.
   */
  randomValue?: boolean;
  /** Effect-specific scalars, such as `order` on `__themeChange`. */
  params?: Record<string, number>;
};

export type PhonoscopeDriverLane = {
  id: string;
  driver: PhonoscopeDriver;
  /** Summed onto the main driver's signal; rendered inset beneath it. */
  modifiers: PhonoscopeDriver[];
  bindings: PhonoscopeEffectBinding[];
};

/**
 * How an effect resolves when more than one lane drives it at once.
 *
 * - `add` sums every lane's contribution above its resting value.
 * - `strongest` takes the contribution from the LEAST FREQUENT firing lane
 *   outright, so an every-4th-downbeat hit covers the plain downbeat rather
 *   than compounding with it.
 * - `common` is its mirror: the MOST FREQUENT firing lane takes it, so the
 *   busiest lane sets the value and the rare punctuation stays out of the way.
 * - `override` is a replacement rather than a contribution — the last lane in
 *   merge order takes the effect outright, carrying its own resting value with
 *   it. This is how an override settings group's value always beats the
 *   default group's when both are present.
 *
 * The two original ids are kept verbatim: they are already stored in saved
 * configurations and hand-parsed by `config_client.cpp` and
 * `PhonoscopeModels.swift`. The UI labels them Sum / Least frequent lane wins /
 * Most frequent lane wins / Override.
 */
export type PhonoscopeCombineMode = "add" | "strongest" | "common" | "override";

export type PhonoscopeSettingsGroup = {
  id: string;
  name: string;
  /** Bindings name module setting ids, so a group belongs to one visualiser. */
  moduleId: string;
  lanes: PhonoscopeDriverLane[];
  /** effect id -> how its lanes stack. Shared by every appearance of that effect. */
  combine: Record<string, PhonoscopeCombineMode>;
  /** Parameters that cannot be driven at all; currently just `complexity`. */
  staticSettings: Record<string, number>;
  /** Exactly one group carries this. It cannot be deleted, and it catches every gap. */
  isDefault: boolean;
};

export type PhonoscopeHouseParty = {
  enabled: boolean;
  hueMode: "follow" | "complement";
  brightnessMode: "follow" | "oppose" | "ignore";
};

